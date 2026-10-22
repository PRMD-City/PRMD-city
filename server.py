"""PRMD City web server and SQLite order API.

Run with: python server.py
Configure an admin password with PRMD_ADMIN_PASSWORD before starting.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import sys
import time
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


ROOT = Path(__file__).resolve().parent
HOST = os.environ.get("PRMD_HOST", "127.0.0.1")
PORT = int(os.environ.get("PRMD_PORT", "8765"))
ADMIN_PASSWORD = os.environ.get("PRMD_ADMIN_PASSWORD", "")
ALLOWED_ORIGINS = {origin.strip().rstrip("/") for origin in os.environ.get("PRMD_ALLOWED_ORIGINS", "").split(",") if origin.strip()}
if os.environ.get("PRMD_DB_PATH"):
    DB_PATH = Path(os.environ["PRMD_DB_PATH"]).expanduser().resolve()
elif sys.platform == "win32":
    DB_PATH = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "PRMD City" / "prmd.sqlite3"
else:
    DB_PATH = Path.home() / ".local" / "share" / "prmd-city" / "prmd.sqlite3"

ALLOWED_CATEGORIES = {"Backpacks", "Exotic Elytra", "Exotic Hats", "PRMD+"}
ADMIN_TOKENS: dict[str, float] = {}
ORDER_ATTEMPTS: dict[str, list[float]] = {}

SEED_PRODUCTS = [
    ("backpack-big", "Big Backpack", "Backpacks", 200, "🎒", "Storage", "Carry more supplies on your adventures around PRMD City."),
    ("backpack-medium", "Medium Backpack", "Backpacks", 100, "🎒", "Storage", "A practical pack for everyday journeys."),
    ("backpack-small", "Small Backpack", "Backpacks", 50, "🎒", "Storage", "A compact pack for your essentials."),
    ("elytra-armored-wings", "Armored Wings", "Exotic Elytra", 350, "🪽", "Exotic Elytra", "Take flight with a fortified wing design."),
    ("elytra-auto-boost", "Auto-Boost Elytra", "Exotic Elytra", 350, "🪽", "Exotic Elytra", "A high-powered Elytra design for fast escapes."),
    ("elytra-rainbow", "Rainbow Elytra", "Exotic Elytra", 200, "🌈", "Exotic Elytra", "Bring a bright spectrum of color to every flight."),
    ("elytra-ender-dragon", "Ender Dragon Wings", "Exotic Elytra", 50, "🐉", "Exotic Elytra", "A wing style inspired by the Ender Dragon."),
    ("elytra-skeleton", "Skeleton Elytra", "Exotic Elytra", 50, "🪽", "Exotic Elytra", "A skeletal look for your next flight."),
    ("hat-pancakes", "Pancakes", "Exotic Hats", 20, "🥞", "Exotic Hat", "Stack up a playful breakfast-themed look."),
    ("hat-penguin", "Penguin", "Exotic Hats", 20, "🐧", "Exotic Hat", "A cool penguin-inspired hat."),
    ("hat-melon", "Melon", "Exotic Hats", 20, "🍉", "Exotic Hat", "A bright melon-themed look."),
    ("hat-shark", "Shark", "Exotic Hats", 20, "🦈", "Exotic Hat", "Bring a little bite to your outfit."),
    ("hat-cone", "Cone", "Exotic Hats", 20, "🚧", "Exotic Hat", "A classic traffic cone hat."),
    ("hat-pizza", "Pizza", "Exotic Hats", 20, "🍕", "Exotic Hat", "Wear your favorite slice."),
    ("hat-elephant", "Elephant", "Exotic Hats", 20, "🐘", "Exotic Hat", "An elephant-inspired character look."),
    ("hat-plunger", "Plunger", "Exotic Hats", 20, "🪠", "Exotic Hat", "A silly plunger hat for the city."),
    ("rank-prmd-plus", "PRMD+ Patreon Program", "PRMD+", None, "+", "Monthly support", "Support the server and receive the PRMD+ in-server rank plus monthly rewards."),
]


def connect_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def initialize_db() -> None:
    with connect_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                price REAL,
                icon TEXT NOT NULL DEFAULT '✦',
                tag TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS orders (
                order_code TEXT PRIMARY KEY,
                tracking_hash TEXT NOT NULL,
                minecraft_name TEXT NOT NULL,
                discord_contact TEXT NOT NULL DEFAULT '',
                total REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'Awaiting payment',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS order_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_code TEXT NOT NULL REFERENCES orders(order_code) ON DELETE CASCADE,
                product_id TEXT NOT NULL,
                product_name TEXT NOT NULL,
                unit_price REAL NOT NULL,
                quantity INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS order_items_order_code_idx ON order_items(order_code);
            CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at);
            """
        )
        if db.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 0:
            now = datetime.now(timezone.utc).isoformat()
            db.executemany(
                "INSERT INTO products (id,name,category,price,icon,tag,description,created_at) VALUES (?,?,?,?,?,?,?,?)",
                [(*product, now) for product in SEED_PRODUCTS],
            )


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class PRMDHandler(SimpleHTTPRequestHandler):
    server_version = "PRMD-City/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Cache-Control", "no-store" if self.path.startswith("/api/") else "no-cache")
        origin = self.headers.get("Origin", "").rstrip("/")
        if self.path.startswith("/api/") and origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        if not self.path.startswith("/api/"):
            self.send_error(404)
            return
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt: str, *args) -> None:
        # API paths can include private order tracking keys; keep access logs quiet.
        return

    def json_response(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 16_384:
            raise ValueError("Request body is missing or too large.")
        data = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("Expected a JSON object.")
        return data

    def require_admin(self) -> bool:
        header = self.headers.get("Authorization", "")
        token = header[7:].strip() if header.startswith("Bearer ") else ""
        expires = ADMIN_TOKENS.get(token, 0)
        if expires <= time.time():
            ADMIN_TOKENS.pop(token, None)
            self.json_response(401, {"error": "Staff session expired. Sign in again."})
            return False
        return True

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        if parsed.path == "/api/health":
            self.json_response(200, {"ok": True, "service": "PRMD City orders"})
            return
        if parsed.path == "/api/products":
            with connect_db() as db:
                rows = db.execute("SELECT id,name,category,price,icon,tag,description FROM products WHERE active=1 ORDER BY rowid").fetchall()
            self.json_response(200, {"products": [dict(row) for row in rows]})
            return
        if parsed.path == "/api/admin/orders":
            if not self.require_admin():
                return
            with connect_db() as db:
                orders = db.execute("SELECT order_code,minecraft_name,discord_contact,total,status,created_at FROM orders ORDER BY created_at DESC LIMIT 250").fetchall()
                result = []
                for order in orders:
                    record = dict(order)
                    record["items"] = [dict(item) for item in db.execute("SELECT product_name,unit_price,quantity FROM order_items WHERE order_code=?", (record["order_code"],))]
                    result.append(record)
            self.json_response(200, {"orders": result})
            return
        if parsed.path.startswith("/api/"):
            self.json_response(404, {"error": "API route not found."})
            return
        if parsed.path == "/server.py" or "/.git" in parsed.path or parsed.path.startswith("/data/"):
            self.send_error(404)
            return
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlsplit(self.path)
        try:
            payload = self.read_json()
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc:
            self.json_response(400, {"error": str(exc) or "Invalid JSON."})
            return

        if parsed.path == "/api/orders":
            self.create_order(payload)
            return
        track_match = re.fullmatch(r"/api/orders/([A-Z0-9-]+)/track", parsed.path)
        if track_match:
            self.track_order(track_match.group(1), payload)
            return
        if parsed.path == "/api/admin/login":
            if not ADMIN_PASSWORD:
                self.json_response(503, {"error": "Staff login is disabled until PRMD_ADMIN_PASSWORD is configured on the server."})
                return
            supplied = str(payload.get("password", ""))
            if not hmac.compare_digest(supplied.encode("utf-8"), ADMIN_PASSWORD.encode("utf-8")):
                self.json_response(401, {"error": "Password not accepted."})
                return
            token = secrets.token_urlsafe(32)
            ADMIN_TOKENS[token] = time.time() + 12 * 60 * 60
            self.json_response(200, {"token": token, "expiresIn": 43200})
            return
        if parsed.path == "/api/admin/logout":
            header = self.headers.get("Authorization", "")
            token = header[7:].strip() if header.startswith("Bearer ") else ""
            ADMIN_TOKENS.pop(token, None)
            self.json_response(200, {"ok": True})
            return
        if parsed.path == "/api/admin/products":
            if not self.require_admin():
                return
            self.create_product(payload)
            return
        self.json_response(404, {"error": "API route not found."})

    def do_PATCH(self) -> None:
        parsed = urlsplit(self.path)
        match = re.fullmatch(r"/api/admin/orders/([A-Z0-9-]+)", parsed.path)
        if not match:
            self.json_response(404, {"error": "API route not found."})
            return
        if not self.require_admin():
            return
        try:
            payload = self.read_json()
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc:
            self.json_response(400, {"error": str(exc) or "Invalid JSON."})
            return
        status = str(payload.get("status", ""))
        if status not in {"Awaiting payment", "Paid", "Fulfilled", "Cancelled"}:
            self.json_response(400, {"error": "Choose a valid order status."})
            return
        with connect_db() as db:
            cursor = db.execute("UPDATE orders SET status=? WHERE order_code=?", (status, match.group(1)))
        if cursor.rowcount == 0:
            self.json_response(404, {"error": "Order not found."})
            return
        self.json_response(200, {"ok": True, "status": status})

    def do_DELETE(self) -> None:
        parsed = urlsplit(self.path)
        match = re.fullmatch(r"/api/admin/products/([a-zA-Z0-9_-]{1,64})", parsed.path)
        if not match:
            self.json_response(404, {"error": "API route not found."})
            return
        if not self.require_admin():
            return
        with connect_db() as db:
            cursor = db.execute("UPDATE products SET active=0 WHERE id=?", (match.group(1),))
        if cursor.rowcount == 0:
            self.json_response(404, {"error": "Product not found."})
            return
        self.json_response(200, {"ok": True})

    def create_order(self, payload: dict) -> None:
        client_ip = self.client_address[0]
        attempts = [moment for moment in ORDER_ATTEMPTS.get(client_ip, []) if moment > time.time() - 600]
        if len(attempts) >= 6:
            self.json_response(429, {"error": "Too many order attempts. Please wait a few minutes and try again."})
            return
        attempts.append(time.time())
        ORDER_ATTEMPTS[client_ip] = attempts
        username = str(payload.get("minecraftName", "")).strip()
        discord = str(payload.get("discordContact", "")).strip()
        items = payload.get("items")
        if not re.fullmatch(r"[A-Za-z0-9_]{3,16}", username):
            self.json_response(400, {"error": "Enter a valid Minecraft Java username (3–16 letters, numbers, or underscores)."})
            return
        if len(discord) > 80:
            self.json_response(400, {"error": "Discord contact must be 80 characters or fewer."})
            return
        if not isinstance(items, list) or not 1 <= len(items) <= 30:
            self.json_response(400, {"error": "Your basket must contain between 1 and 30 line items."})
            return
        quantities: dict[str, int] = {}
        for item in items:
            if not isinstance(item, dict):
                self.json_response(400, {"error": "Invalid basket item."})
                return
            product_id = str(item.get("productId", ""))
            quantity = item.get("quantity")
            if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", product_id) or not isinstance(quantity, int) or not 1 <= quantity <= 25:
                self.json_response(400, {"error": "Each item needs a valid product and quantity from 1 to 25."})
                return
            quantities[product_id] = quantities.get(product_id, 0) + quantity
            if quantities[product_id] > 25:
                self.json_response(400, {"error": "A product quantity cannot exceed 25."})
                return

        tracking_key = secrets.token_urlsafe(32)
        tracking_hash = hashlib.sha256(tracking_key.encode("utf-8")).hexdigest()
        order_code = "PRMD-" + secrets.token_hex(4).upper()
        created_at = utc_now()
        try:
            with connect_db() as db:
                db.execute("BEGIN IMMEDIATE")
                products = {}
                for product_id in quantities:
                    row = db.execute("SELECT id,name,price,active FROM products WHERE id=?", (product_id,)).fetchone()
                    if not row or not row["active"] or row["price"] is None or row["price"] <= 0:
                        db.rollback()
                        self.json_response(400, {"error": "A basket item is unavailable. Refresh the store and try again."})
                        return
                    products[product_id] = row
                total = sum(float(products[pid]["price"]) * qty for pid, qty in quantities.items())
                db.execute("INSERT INTO orders (order_code,tracking_hash,minecraft_name,discord_contact,total,status,created_at) VALUES (?,?,?,?,?,'Awaiting payment',?)", (order_code, tracking_hash, username, discord, total, created_at))
                db.executemany("INSERT INTO order_items (order_code,product_id,product_name,unit_price,quantity) VALUES (?,?,?,?,?)", [(order_code, pid, products[pid]["name"], float(products[pid]["price"]), qty) for pid, qty in quantities.items()])
        except sqlite3.IntegrityError:
            self.json_response(409, {"error": "Please submit your order again."})
            return
        self.json_response(201, {"orderCode": order_code, "trackingKey": tracking_key, "createdAt": created_at, "total": total, "status": "Awaiting payment"})

    def track_order(self, order_code: str, payload: dict) -> None:
        key = str(payload.get("trackingKey", ""))
        if not key or len(key) > 128:
            self.json_response(401, {"error": "A valid tracking key is required."})
            return
        hashed = hashlib.sha256(key.encode("utf-8")).hexdigest()
        with connect_db() as db:
            order = db.execute("SELECT order_code,minecraft_name,total,status,created_at FROM orders WHERE order_code=? AND tracking_hash=?", (order_code, hashed)).fetchone()
            items = db.execute("SELECT product_name,unit_price,quantity FROM order_items WHERE order_code=?", (order_code,)).fetchall() if order else []
        if not order:
            self.json_response(404, {"error": "Order not found."})
            return
        self.json_response(200, {"order": dict(order), "items": [dict(item) for item in items]})

    def create_product(self, payload: dict) -> None:
        name = str(payload.get("name", "")).strip()
        category = str(payload.get("category", "")).strip()
        icon = str(payload.get("icon", "✦"))[:12]
        tag = str(payload.get("tag", category))[:32]
        description = str(payload.get("description", ""))[:240]
        try:
            price = float(payload.get("price"))
        except (TypeError, ValueError):
            price = 0
        if not 1 <= len(name) <= 64 or category not in ALLOWED_CATEGORIES or not 0 < price <= 1_000_000:
            self.json_response(400, {"error": "Provide an item name, supported category, and price between 0.01 and 1,000,000 EGP."})
            return
        product_id = "item-" + secrets.token_hex(8)
        with connect_db() as db:
            db.execute("INSERT INTO products (id,name,category,price,icon,tag,description,created_at) VALUES (?,?,?,?,?,?,?,?)", (product_id, name, category, price, icon, tag, description, utc_now()))
            product = db.execute("SELECT id,name,category,price,icon,tag,description FROM products WHERE id=?", (product_id,)).fetchone()
        self.json_response(201, {"product": dict(product)})


if __name__ == "__main__":
    initialize_db()
    print(f"PRMD City site: http://{HOST}:{PORT}")
    print(f"SQLite database: {DB_PATH}")
    print("Staff login: enabled" if ADMIN_PASSWORD else "Staff login: disabled (set PRMD_ADMIN_PASSWORD before launch)")
    ThreadingHTTPServer((HOST, PORT), PRMDHandler).serve_forever()

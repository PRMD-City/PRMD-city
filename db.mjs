import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(fileURLToPath(import.meta.url));
const configuredPath = process.env.PRMD_DB_PATH || './data/prmd-city.sqlite';
const dbPath = resolve(ROOT, configuredPath);
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  minecraft_username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  discord_contact TEXT NOT NULL DEFAULT '',
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('player', 'admin')),
  points_balance INTEGER NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('backpacks', 'elytra', 'hats', 'plus')),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  image_path TEXT NOT NULL,
  price_piasters INTEGER NOT NULL CHECK (price_piasters >= 0),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS products_category_published ON products(category, published);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  minecraft_username TEXT NOT NULL,
  discord_contact TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('Awaiting Payment', 'Paid', 'Fulfilled', 'Cancelled')),
  total_piasters INTEGER NOT NULL CHECK (total_piasters >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS orders_user_date ON orders(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_piasters INTEGER NOT NULL CHECK (unit_price_piasters >= 0)
);
CREATE TABLE IF NOT EXISTS point_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL CHECK (delta <> 0),
  reason TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS point_ledger_user_date ON point_transactions(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
`);


const bootstrapAdminUsername = process.env.PRMD_BOOTSTRAP_ADMIN_USERNAME?.trim();
const bootstrapAdminPassword = process.env.PRMD_BOOTSTRAP_ADMIN_PASSWORD;
if (bootstrapAdminUsername || bootstrapAdminPassword) {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(bootstrapAdminUsername || '') || !bootstrapAdminPassword || bootstrapAdminPassword.length < 12 || bootstrapAdminPassword.length > 128) {
    throw new Error('PRMD_BOOTSTRAP_ADMIN_USERNAME and a 12–128 character PRMD_BOOTSTRAP_ADMIN_PASSWORD must both be configured.');
  }
  const existingAdmin = db.prepare('SELECT role FROM users WHERE minecraft_username=? COLLATE NOCASE').get(bootstrapAdminUsername);
  if (existingAdmin && existingAdmin.role !== 'admin') {
    throw new Error('Bootstrap admin username already belongs to a player account; choose a separate staff username.');
  }
  if (!existingAdmin) {
    const { randomBytes, scryptSync } = await import('node:crypto');
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(bootstrapAdminPassword, salt, 64).toString('hex');
    db.prepare("INSERT INTO users(minecraft_username,discord_contact,password_salt,password_hash,role) VALUES(?,'',?,?, 'admin')").run(bootstrapAdminUsername, salt, hash);
  }
}

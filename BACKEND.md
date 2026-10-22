# PRMD City backend

The site uses a small Python standard-library server and SQLite. No package installation is required. Orders are stored in a persistent database on the server machine; product prices are read from that database when an order is submitted, so a browser cannot set its own total.

## Run locally on Windows

Open PowerShell in this folder, set the staff password for this session, and start the server:

```powershell
$env:PRMD_ADMIN_PASSWORD = Read-Host "Choose a staff password"
python server.py
```

Then open `http://127.0.0.1:8765`. Keep the terminal open while using the site. Stop the server with Ctrl+C. The database is saved under `%LOCALAPPDATA%\PRMD City\prmd.sqlite3` and is not served by the website.

Set a different port with `PRMD_PORT`. Set `PRMD_DB_PATH` to place the database on a persistent volume when deploying.

## Orders

Checkout asks for the buyer’s Minecraft Java username and an optional Discord contact. The server validates the basket against the database catalog and records each order as **Awaiting payment**. The customer receives an order code and private tracking key. Staff can update the order to Paid, Fulfilled, or Cancelled in the admin page. Payment itself remains manual through your Discord ticket process; the site does not collect payment details.

## Admin

The admin password is read from `PRMD_ADMIN_PASSWORD`; there is no built-in public password. Staff sessions expire after 12 hours or when the server restarts. Product changes and order status updates are stored in SQLite.

## Hosting

For public use, deploy the Python server behind a host that provides HTTPS, keep the SQLite database on persistent storage, and set a strong `PRMD_ADMIN_PASSWORD` in the host’s secret/environment settings. Do not expose the server directly to the public internet without HTTPS and operational protections. The default bind address is local-only (`127.0.0.1`); a hosting platform may require `PRMD_HOST=0.0.0.0` behind its HTTPS proxy.

## GitHub Pages

The repository includes a GitHub Actions workflow that publishes the static site files to GitHub Pages. Pages cannot run the Python server or SQLite database, so checkout and the staff portal will not work publicly until the API is deployed separately.

After the API has a public HTTPS address, set `window.PRMD_API_BASE` in `api-config.js` to that address. Configure the backend’s `PRMD_ALLOWED_ORIGINS` to the site origin (for a project page, this is `https://<account>.github.io`, without the repository path). Keep `PRMD_ADMIN_PASSWORD` in the backend host’s secret settings and put the SQLite database on persistent storage.

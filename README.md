# PRMD City

A responsive React storefront and community site for the PRMD City Java Edition 26.2 Paper server. React renders every page and interactive feature; Node.js and SQLite provide the secure account, order, points, and staff APIs. Orders are requests for staff follow-up; the site does not take or process payments.

## Run locally

Requires Node.js 22.13 or later (`node:sqlite`). Copy `.env.example` to `.env` and set a unique `SESSION_SECRET` of at least 48 characters. Export the variables in your shell; the server intentionally does not read `.env` files automatically.

```powershell
$env:SESSION_SECRET = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
$env:PORT = "3000"
npm start
```

Run `npm run build` after changing the React source, then open `http://localhost:3000`. The database is created at `data/prmd-city.sqlite` and persists across restarts. The Windows launcher builds the React client before starting the site.

On Windows, `launch-site.cmd` starts the local preview on port 3002. Use this if port 3001 is already occupied; open `http://127.0.0.1:3002` while its Command Prompt window stays open.

## Deploy on Render

The included `render.yaml` describes a Node web service in Frankfurt with a persistent 1 GB disk for SQLite. The disk-backed service requires a paid Render plan. Push this project to GitHub, then in Render choose **New + → Blueprint** and select the repository. Render generates `SESSION_SECRET` and builds the React client before starting the Node server. Set `PRMD_MAP_URL` in the Render dashboard if the BlueMap or Dynmap is ready.

After deployment, open a Render shell and run `npm run admin:create` to create the first staff account. Do not create it in a local copy because that writes to a different database. The database lives at `/var/data/prmd-city.sqlite` on Render's persistent disk. Back it up before changing disk settings or moving hosts.

Deployment does not configure real products, map connectivity, or payment instructions; staff still arrange payments through Discord.

Create the first staff account from a terminal:

```powershell
npm run admin:create
```

The command prompts for a staff username and password, hashes the password with scrypt, and stores only the hash. Keep the database and session secret private. Do not put credentials in frontend files.

## Before launch

1. The supplied original artwork is in `assets/` and has been copied unchanged into `public/assets/brand/`. The PRMD Presents mark is used in the masthead, the full PRMD Presents composition anchors the opening, the Pharaoh/Egypt title appears in the identity chapter, and the server wordmark appears with server details. The Ranks and Cosmetics title images appear on their related store pages. Every supplied image is rendered with `object-fit: contain`, without cropping, recolouring, or redrawing.
2. Add original product images under `public/assets/items/`. Staff can then create products from `/admin` using a local image path such as `/assets/items/backpack.webp`.
3. Sign in at `/admin`, add real products and EGP prices, and publish them. Empty catalogues stay unpublished until staff configure them.
4. Set `PRMD_MAP_URL` to the public BlueMap or Dynmap URL to enable the Live Map page. Leave it blank for the setup state.
5. Set `NODE_ENV=production`, use a long random `SESSION_SECRET`, and serve the app behind HTTPS. Set `HOST=127.0.0.1` when a local reverse proxy is on the same machine. Keep `PRMD_DB_PATH` on durable storage and back up the SQLite database.
6. Configure a real server address and payment instructions before publishing those details. The current flow only records an order and tells the player to contact staff in Discord. Staff confirm mobile-wallet or InstaPay instructions through Discord and update the order status manually.
7. Connect a trusted Paper-side integration before treating points or Minecraft identity as verified server data. The current website stores account names, orders, and staff-entered point ledger entries in its own database; it does not connect to the game server.

## React client

- React pages live in `src/main.jsx`; `npm run build` bundles React and React DOM into `public/app-react.js` with esbuild.
- `server.mjs` serves the React shell for each page route. Account, order, catalogue, and staff data continue to come from server APIs with server-side authorization.
- Install locked dependencies with `npm ci` before building on a fresh checkout.
## Pages

Home, Backpacks, Exotic Elytra, Exotic Hats, PRMD+, Live Map, Shopping Basket, Points, Order History, player Account, and staff Admin.

## Security and data

- Admin pages and product/order/points mutations are protected by server-side session and role checks. There is no browser-only staff password or authorization check.
- Passwords use Node's `scrypt`; session cookies are HttpOnly and SameSite Strict, and become Secure in production.
- Mutating requests require a same-origin request. Login attempts are rate limited.
- SQLite stores player accounts, product records, order snapshots, order status, admin accounts, sessions, and point transactions.
- Checkout requires a signed-in player account and asks again for the Minecraft Java username. Orders begin as `Awaiting Payment`; the only payment handoff is the PRMD Discord.

The site does not verify a Minecraft username with Mojang or Paper, accept card or wallet credentials, or report live server status. The exact server address, product item images, product prices, map URL, and real points integration still need to be supplied/configured.

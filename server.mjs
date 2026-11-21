import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db, ROOT } from './db.mjs';

const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === 'production';
const HOST = process.env.HOST || (PROD ? '0.0.0.0' : '127.0.0.1');
const SESSION_SECRET = process.env.SESSION_SECRET || 'prmd-city-local-development-secret';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const DISCORD_URL = 'https://discord.gg/AC2DExcnP8';
const ORDER_STATUSES = ['Awaiting Payment', 'Paid', 'Fulfilled', 'Cancelled'];
const CATEGORIES = {
  backpacks: { title: 'Backpacks', eyebrow: 'Carry more of your world', description: 'Server backpacks for the journeys you make in PRMD City.' },
  elytra: { title: 'Exotic Elytra', eyebrow: 'Take the long way home', description: 'Distinctive elytra for seeing the city from above.' },
  hats: { title: 'Exotic Hats', eyebrow: 'A small mark of your own', description: 'Exotic hats for players who like their own look.' },
  plus: { title: 'PRMD+', eyebrow: 'A monthly place in the city', description: 'The monthly PRMD+ rewards, gathered under one membership.' },
};
const ROUTES = new Map([
  ['/', { title: 'Home', kind: 'home' }],
  ['/store/backpacks', { title: 'Backpacks', kind: 'store', category: 'backpacks' }],
  ['/store/exotic-elytra', { title: 'Exotic Elytra', kind: 'store', category: 'elytra' }],
  ['/store/exotic-hats', { title: 'Exotic Hats', kind: 'store', category: 'hats' }],
  ['/store/prmd-plus', { title: 'PRMD+', kind: 'plus' }],
  ['/live-map', { title: 'Live Map', kind: 'map' }],
  ['/basket', { title: 'Shopping Basket', kind: 'basket' }],
  ['/points', { title: 'Points', kind: 'points' }],
  ['/orders', { title: 'Order History', kind: 'orders' }],
  ['/account', { title: 'Player Account', kind: 'account' }],
  ['/admin', { title: 'Staff Admin', kind: 'admin' }],
]);

if (PROD && SESSION_SECRET.length < 48) {
  console.error('Set SESSION_SECRET to a random value of at least 48 characters before production start.');
  process.exit(1);
}

const esc = (value = '') => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const formatEgp = (piasters) => new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(piasters / 100);
const dateLabel = (date) => new Intl.DateTimeFormat('en-EG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(new Date(date));
const imagePathIsSafe = (value) => /^\/assets\/items\/[\w./-]+\.(?:png|jpe?g|webp|avif)$/i.test(value) && !value.includes('..');
const slugify = (value) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 64);

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

function passwordMatches(password, salt, storedHash) {
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const tokenHash = (token) => createHmac('sha256', SESSION_SECRET).update(token).digest('hex');
const attempts = new Map();

function limited(req, bucket, max = 8, windowMs = 10 * 60 * 1000) {
  const key = `${req.socket.remoteAddress || 'unknown'}:${bucket}`;
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || now - current.started > windowMs) attempts.set(key, { started: now, count: 1 });
  else current.count += 1;
  return attempts.get(key).count <= max;
}

function sessionFor(req) {
  const token = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('prmd_session='))?.slice('prmd_session='.length);
  if (!token || token.length > 128) return null;
  const row = db.prepare(`SELECT u.id, u.minecraft_username, u.discord_contact, u.role, u.points_balance
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`).get(tokenHash(decodeURIComponent(token)));
  return row || null;
}

function issueSession(user, res) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(tokenHash(token), user.id, expiresAt);
  db.prepare("DELETE FROM sessions WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')").run();
  res.setHeader('Set-Cookie', `prmd_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${PROD ? '; Secure' : ''}`);
}

function clearSession(req, res) {
  const token = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('prmd_session='))?.slice('prmd_session='.length);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(decodeURIComponent(token)));
  res.setHeader('Set-Cookie', `prmd_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${PROD ? '; Secure' : ''}`);
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

function html(res, body, req) {
  const mapUrl = safeMapUrl();
  const mapOrigin = mapUrl ? ` ${new URL(mapUrl).origin}` : '';
  const csp = `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-src 'self'${mapOrigin}; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; object-src 'none'`;
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': csp,
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...(PROD ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
    'Cache-Control': 'no-store',
  };
  res.writeHead(200, headers);
  res.end(body);
}

function requireSameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === host && (PROD ? parsed.protocol === 'https:' : ['http:', 'https:'].includes(parsed.protocol));
  } catch { return false; }
}

async function readJson(req, limit = 128 * 1024) {
  const parts = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw Object.assign(new Error('Request is too large.'), { status: 413 });
    parts.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Send valid JSON.'), { status: 400 }); }
}

function safeMapUrl() {
  const value = (process.env.PRMD_MAP_URL || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || (PROD && parsed.protocol !== 'https:')) return '';
    return parsed.href;
  } catch { return ''; }
}

function findBrandAsset(name) {
  const extensions = ['png', 'webp', 'avif', 'jpg', 'jpeg', 'svg'];
  const extension = extensions.find((candidate) => existsSync(join(PUBLIC, 'assets', 'brand', `${name}.${candidate}`)));
  return extension ? `/assets/brand/${name}.${extension}` : '';
}

function brandMark() {
  const image = findBrandAsset('prmd-logo') || findBrandAsset('prmd-presents-mark');
  return image ? `<img class="brand__logo" src="${image}" alt="PRMD City">` : `<span class="brand__name">PRMD City</span>`;
}

function navLink(path, label, activePath, className = '') {
  const current = activePath === path || (path === '/orders' && activePath === '/orders') ? ' aria-current="page"' : '';
  return `<a class="${className}" href="${path}"${current}>${label}</a>`;
}

function header(activePath) {
  const storeActive = activePath.startsWith('/store/');
  const desktopStore = `<details class="nav-store"${storeActive ? ' open' : ''}><summary${storeActive ? ' aria-current="page"' : ''}>store</summary><div class="store-menu">${navLink('/store/backpacks', 'backpacks', activePath)}${navLink('/store/exotic-elytra', 'exotic elytra', activePath)}${navLink('/store/exotic-hats', 'exotic hats', activePath)}${navLink('/store/prmd-plus', 'PRMD+', activePath)}</div></details>`;
  const mobileStore = `<details><summary>store</summary><div class="store-menu">${navLink('/store/backpacks', 'backpacks', activePath)}${navLink('/store/exotic-elytra', 'exotic elytra', activePath)}${navLink('/store/exotic-hats', 'exotic hats', activePath)}${navLink('/store/prmd-plus', 'PRMD+', activePath)}</div></details>`;
  return `<header class="site-header"><div class="container masthead">
    <a class="brand" href="/" aria-label="PRMD City home"><span class="brand-logo-slot">${brandMark()}</span></a>
    <nav class="primary-nav" aria-label="Main navigation">${navLink('/', 'home', activePath)}${desktopStore}${navLink('/live-map', 'live map', activePath)}${navLink('/points', 'points', activePath)}${navLink('/orders', 'order history', activePath)}</nav>
    <div class="nav-actions">${navLink('/basket', 'basket<span class="basket-count" data-basket-count>0</span>', activePath)}${navLink('/account', 'account', activePath)}<a href="/admin" aria-label="Staff admin sign in">staff</a></div>
  </div><nav class="container mobile-nav" aria-label="Store and community navigation">${mobileStore}${navLink('/live-map', 'live map', activePath)}${navLink('/points', 'points', activePath)}${navLink('/orders', 'orders', activePath)}</nav></header>`;
}

function footer() {
  return `<footer class="site-footer"><div class="container footer-inner">
    <p class="footer-signoff">A city built by friends, block by block.</p>
    <div class="footer-columns">
      <section class="footer-column"><h2>the shelves</h2><a href="/store/backpacks">backpacks</a><a href="/store/exotic-elytra">exotic elytra</a><a href="/store/exotic-hats">exotic hats</a><a href="/store/prmd-plus">PRMD+</a></section>
      <section class="footer-column"><h2>the city</h2><a href="/">home</a><a href="/live-map">live map</a><a href="${DISCORD_URL}" target="_blank" rel="noopener noreferrer">Discord</a></section>
      <section class="footer-column"><h2>your account</h2><a href="/basket">shopping basket</a><a href="/points">points</a><a href="/orders">order history</a><a href="/admin">staff admin</a></section>
    </div>
    <div class="footer-legal"><span>PRMD City runs Java Edition 26.2 on Paper.</span><span>Not an official Minecraft product. Minecraft is a trademark of Mojang Studios.</span></div>
  </div></footer>`;
}

function productCard(product) {
  const image = imagePathIsSafe(product.image_path) ? `<img src="${esc(product.image_path)}" alt="${esc(product.name)}" loading="lazy">` : `<span>image not configured</span>`;
  return `<article class="product-card"><div class="product-media">${image}</div><div class="product-info"><h2>${esc(product.name)}</h2><p>${esc(product.description)}</p><div class="product-buy"><span class="product-price">${formatEgp(product.price_piasters)}</span><button type="button" data-add-product="${product.id}">add to basket</button></div></div></article>`;
}

function publicProducts(category = null, limit = null) {
  const query = category
    ? db.prepare('SELECT id,slug,category,name,description,image_path,price_piasters FROM products WHERE category=? AND published=1 ORDER BY id DESC')
    : db.prepare('SELECT id,slug,category,name,description,image_path,price_piasters FROM products WHERE published=1 ORDER BY id DESC');
  const rows = category ? query.all(category) : query.all();
  return limit ? rows.slice(0, limit) : rows;
}

function emptyCatalogue(title, isPlus = false) {
  return `<div class="catalogue-empty"><h2>No ${esc(title.toLowerCase())} products are listed yet.</h2><p>Staff are adding the verified item details and original images. Ask in Discord if you need current availability.</p><a class="text-link" href="${DISCORD_URL}" target="_blank" rel="noopener noreferrer">ask the PRMD staff team</a>${isPlus ? '<p class="price-pending">The monthly EGP price will appear after staff configure it.</p>' : ''}</div>`;
}

function renderHome() {
  const featured = publicProducts(null, 3);
  const serverLogoFile = findBrandAsset('server-logo') || findBrandAsset('pharaoh-server-wordmark');
  const serverLogo = serverLogoFile ? `<img src="${serverLogoFile}" alt="PRMD server logo" loading="lazy">` : '<p class="status-text">Server logo will appear here when the supplied file is added.</p>';
  return `<div class="intro-story">
    <section class="intro-stage" aria-labelledby="intro-title"><div class="container intro-stage__inner"><div class="intro-copy"><h1 class="intro-title" id="intro-title">PRMD presents</h1><p class="intro-line">An Egyptian-themed Minecraft world, made by friends and shaped one block at a time.</p><div class="intro-actions"><a class="button intro-skip" href="#city-home">skip the introduction</a></div></div><figure class="intro-art"><img src="/assets/brand/prmd-presents.png" alt="PRMD presents, Egypt’s first Minecraft server" width="3840" height="2160"></figure></div><span class="scroll-cue" aria-hidden="true">scroll to enter</span></section>
    <section class="identity-stage" id="the-city" aria-labelledby="identity-title"><div class="container identity-stage__inner"><div class="identity-copy"><h2 class="identity-title" id="identity-title"><span class="visually-hidden">Egypt’s 1st Minecraft Server</span><img class="identity-title-art" src="/assets/brand/pharaoh-egypt-logo.png" alt="" width="3840" height="940"></h2><p class="identity-note">PRMD City is a world made by friends. Find your place, meet the city, and leave a little of your own work behind.</p></div><span class="identity-mark" aria-hidden="true">𓂀</span></div><span class="scroll-cue" aria-hidden="true">enter PRMD City</span></section>
  </div>
  <main class="page-main home-main" id="city-home">
    <section class="home-band"><div class="container"><div class="section-head"><div><p class="section-label">the server</p><h2 class="section-title">The city, in its own edition.</h2></div><p class="section-summary">Bring Minecraft Java Edition 26.2. PRMD City runs on Paper. Ask the staff team on Discord for the current server address and connection details.</p></div><dl class="server-spec"><div class="server-spec__row"><dt>edition</dt><dd>Java Edition 26.2</dd></div><div class="server-spec__row"><dt>server software</dt><dd>Paper</dd></div><div class="server-spec__row"><dt>built by</dt><dd>friends</dd></div><div class="server-spec__row"><dt>connection details</dt><dd><a class="text-link" href="${DISCORD_URL}" target="_blank" rel="noopener noreferrer">ask on Discord</a></dd></div></dl><div class="server-logo" aria-label="PRMD server logo">${serverLogo}</div></div></section>
    <section class="home-band home-band--shade"><div class="container"><div class="section-head"><div><p class="section-label">a tiny desert arcade</p><h2 class="section-title">Raid the pyramid.</h2></div><p class="section-summary">Run, leap traps, and collect scarabs through three increasingly tricky routes. A rotating sun dial follows your journey.</p></div><section class="pyramid-arcade" data-pyramid-game aria-label="Pyramid Run mini-game"><div class="arcade-topline"><span class="arcade-level" data-game-level-label>Level 1 · Dune path</span><span class="arcade-score"><span data-game-scarabs>0</span> / 3 scarabs</span></div><nav class="arcade-levels" data-game-levels aria-label="Choose an unlocked level"></nav><div class="arcade-screen"><canvas class="arcade-canvas" data-game-canvas width="960" height="420" tabindex="0" role="img" aria-label="Pyramid Run. A pixel-art desert platform game. Use the arrow keys or A and D to run, and Space or Up to jump.">Pyramid Run: use the on-screen controls to collect three scarabs and reach the pyramid door.</canvas><div class="arcade-overlay" data-game-overlay><p class="arcade-overlay__title" data-game-title>Ready, adventurer?</p><p class="arcade-overlay__copy" data-game-copy>Find three scarabs, dodge the cacti, reach the pyramid.</p><button class="button" type="button" data-game-start>start the run</button></div></div><div class="arcade-console"><div class="arcade-controls" aria-label="Game controls"><button type="button" data-game-key="left" aria-label="Run left">←</button><button type="button" data-game-key="right" aria-label="Run right">→</button><button type="button" data-game-key="jump" aria-label="Jump">jump</button></div><div class="arcade-readout"><p data-game-status aria-live="polite">Press start, then use the arrows, A and D, or the touch controls.</p><p class="arcade-best">Personal best <strong data-game-best>—</strong></p></div></div><p class="arcade-note">A little browser game, made for fun. Level access and best times are saved on this device; no points or server items are awarded.</p></section></div></section>
    <section class="home-band chamber-band"><div class="container"><div class="section-head"><div><p class="section-label">a new chamber every day</p><h2 class="section-title">The Scarab Vault.</h2></div><p class="section-summary">Turn over the stones, remember the glyphs, and find all eight pairs. A new board arrives each day at Cairo midnight.</p></div><section class="daily-chamber" data-daily-chamber aria-labelledby="chamber-heading"><div class="chamber-intro"><div><p class="chamber-date" data-chamber-date>today’s chamber</p><h3 id="chamber-heading">Eight pairs. One hidden vault.</h3><p class="chamber-description">Clear the chamber to add a relic to your collection. Your streak and best run stay on this browser.</p></div><button class="button chamber-start" type="button" data-chamber-start>enter today’s chamber</button></div><div class="chamber-play"><div class="chamber-grid" data-chamber-grid role="group" aria-label="Daily Scarab Vault memory board" hidden></div><div class="chamber-sidebar"><div class="chamber-stats"><div><span>turns</span><strong data-chamber-moves>0</strong></div><div><span>time</span><strong data-chamber-time>00:00</strong></div><div><span>best</span><strong data-chamber-best>—</strong></div></div><p class="chamber-message" data-chamber-message aria-live="polite">Ready when you are.</p><div class="chamber-collection"><span class="chamber-relic" aria-hidden="true">𓆣</span><p><strong><span data-chamber-relics>0</span> relics</strong><br><span data-chamber-streak>Start a streak today.</span></p></div><p class="chamber-note">Browser collection only. Relics are for fun and do not add account points or in-game items.</p></div></div><p class="chamber-reset">Next chamber in <span data-chamber-countdown>--:--:--</span></p></section></div></section>
    <section class="home-band"><div class="container"><div class="section-head"><div><p class="section-label">from the shelves</p><h2 class="section-title">Bring a little more to the world.</h2></div><p class="section-summary">Browse the server store. Staff publish each item with its original image and current price.</p></div>${featured.length ? `<div class="catalogue-grid">${featured.map(productCard).join('')}</div>` : emptyCatalogue('Featured items')}<div class="intro-actions"><a class="button button--quiet" href="/store/backpacks">browse the store</a></div></div></section>
    <section class="home-band home-band--shade"><div class="container rewards"><div><p class="section-label">monthly membership</p><h2>PRMD+</h2><p class="page-deck">One monthly bundle of in-server rewards. Staff will publish the EGP price when it is ready.</p><a class="button button--quiet" href="/store/prmd-plus">see PRMD+ rewards</a></div><ul class="rewards-list"><li>Custom PRMD+ in-server rank</li><li>One medium backpack</li><li>One rainbow elytra</li><li>One random exotic hat</li><li>25,000 in-game cash per month</li></ul></div></section>
    <section class="home-band"><div class="container"><div class="section-head"><div><p class="section-label">above the rooftops</p><h2 class="section-title">Look around before you set out.</h2></div><p class="section-summary">The live map will appear here when the server connects BlueMap or Dynmap.</p></div><a class="button button--quiet" href="/live-map">open the live map</a></div></section>
    <section class="home-band home-band--shade"><div class="container"><div class="section-head"><div><p class="section-label">meet the players</p><h2 class="section-title">The next block starts with you.</h2></div><p class="section-summary">Ask questions, find the current address, and get payment instructions from staff through the PRMD Discord.</p></div><a class="button" href="${DISCORD_URL}" target="_blank" rel="noopener noreferrer">join the Discord</a></div></section>
  </main>`;
}

function renderStore(category) {
  const data = CATEGORIES[category];
  const products = publicProducts(category);
  const links = [['/store/backpacks', 'backpacks', 'backpacks'], ['/store/exotic-elytra', 'elytra', 'exotic elytra'], ['/store/exotic-hats', 'hats', 'exotic hats'], ['/store/prmd-plus', 'plus', 'PRMD+']];
  const categoryArt = ['elytra', 'hats'].includes(category) ? '<img class="category-title-art" src="/assets/brand/cosmetics-title.png" alt="Cosmetics" width="2050" height="240">' : '';
  return `<main class="page-main store-page"><div class="container"><header class="page-intro">${categoryArt}<p class="section-label">PRMD City store</p><h1 class="page-title">${esc(data.title)}</h1><p class="page-deck">${esc(data.description)}</p></header><nav class="store-subnav" aria-label="Store categories">${links.map(([path, key, label]) => navLink(path, label, `/store/${category === 'elytra' ? 'exotic-elytra' : category === 'hats' ? 'exotic-hats' : category === 'plus' ? 'prmd-plus' : category}`, 'store-tab')).join('')}</nav>${products.length ? `<div class="catalogue-grid">${products.map(productCard).join('')}</div>` : emptyCatalogue(data.title, false)}<p class="payment-note margin-top-2xl">Orders are paid manually. The site does not process payments; staff share mobile-wallet or InstaPay instructions through <a href="${DISCORD_URL}" target="_blank" rel="noopener noreferrer">Discord</a>.</p></div></main>`;
}

function renderPlus() {
  const product = publicProducts('plus', 1)[0];
  return `<main class="page-main store-page"><div class="container"><header class="page-intro"><img class="category-title-art category-title-art--ranks" src="/assets/brand/ranks-title.png" alt="Ranks" width="1240" height="240"><p class="section-label">PRMD City store</p><h1 class="page-title">PRMD+</h1><p class="page-deck">The monthly bundle of in-server rewards. The exact price and item image will be listed here after staff configure them.</p></header><section class="rewards"><div><p class="section-label">monthly bundle</p><h2>Made for your time in the city.</h2>${product ? `<p class="product-price margin-top-lg">${formatEgp(product.price_piasters)}</p><button class="button" type="button" data-add-product="${product.id}">add PRMD+ to basket</button>` : '<p class="price-pending">Monthly price pending staff setup.</p>'}</div><ul class="rewards-list"><li>Custom PRMD+ in-server rank</li><li>One medium backpack</li><li>One rainbow elytra</li><li>One random exotic hat</li><li>25,000 in-game cash per month</li></ul></section><p class="payment-note margin-top-2xl">Payment is arranged with staff through Discord after the order is placed. No payment details are collected on this website.</p></div></main>`;
}

function renderMap() {
  const map = safeMapUrl();
  return `<main class="page-main utility-page"><div class="container"><header class="page-intro"><p class="section-label">a view of the city</p><h1 class="page-title">Live Map</h1><p class="page-deck">${map ? 'Explore the connected server map.' : 'A BlueMap or Dynmap address has not been configured yet.'}</p></header>${map ? `<iframe class="map-frame" src="${esc(map)}" title="PRMD City live map" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>` : `<section class="map-placeholder"><div><h2>Map connection pending</h2><p>Set <code>PRMD_MAP_URL</code> to the server’s public BlueMap or Dynmap URL, then restart this site. Until then, ask the PRMD staff team for help on Discord.</p><a class="button button--quiet margin-top-lg" href="${DISCORD_URL}" target="_blank" rel="noopener noreferrer">ask the staff team</a></div></section>`}</div></main>`;
}

function renderBasket(user) {
  const loginMessage = user ? '' : `<p class="payment-note">Sign in or create a player account before checkout. This keeps your order history private and linked to you. <a href="/account">open your account</a>.</p>`;
  return `<main class="page-main utility-page"><div class="container"><header class="page-intro"><p class="section-label">your basket</p><h1 class="page-title">Shopping Basket</h1><p class="page-deck">Review the items you selected. Checkout records an order for staff follow-up; it does not charge you.</p></header><div class="basket-layout"><section><div data-basket-items aria-live="polite"><p class="empty-state">Your basket is empty. Visit the store to find available items.</p><a class="text-link" href="/store/backpacks">browse the store</a></div></section><aside><div class="summary-block"><h2>Order summary</h2><p class="summary-line"><span>items</span><strong data-basket-total>EGP 0</strong></p></div>${loginMessage}<form class="checkout-form" data-checkout-form novalidate><h2>Checkout details</h2><div class="field"><label for="checkout-username">Minecraft Java username (required)</label><input id="checkout-username" name="minecraftUsername" autocomplete="username" required minlength="3" maxlength="16" pattern="[A-Za-z0-9_]{3,16}" value="${esc(user?.minecraft_username || '')}" aria-describedby="checkout-username-hint"><p class="field-hint" id="checkout-username-hint">Use the Java username staff should deliver to.</p></div><div class="field"><label for="checkout-discord">Discord contact (optional)</label><input id="checkout-discord" name="discordContact" autocomplete="off" maxlength="80" value="${esc(user?.discord_contact || '')}" aria-describedby="checkout-discord-hint"><p class="field-hint" id="checkout-discord-hint">A staff member will share manual payment instructions through Discord.</p></div><button class="button" type="submit"${user ? '' : ' disabled aria-disabled="true"'}>place order request</button><p class="form-message" data-checkout-message aria-live="polite"></p></form><div class="payment-note">Payment is handled manually by PRMD staff through mobile wallets or InstaPay. Instructions are shared through Discord after your order is recorded.</div></aside></div></div></main>`;
}

function orderRows(orders) {
  if (!orders.length) return '<p class="empty-state">No orders are linked to this account yet. A completed checkout request will appear here.</p>';
  return `<div class="order-list">${orders.map((order) => `<article class="order-item"><div><h2>${esc(order.order_number)}</h2><p>${dateLabel(order.created_at)}, ${order.items.map((item) => `${esc(item.product_name)} × ${item.quantity}`).join(', ')}</p></div><div><span class="status-badge">${esc(order.status)}</span><p>${formatEgp(order.total_piasters)}</p></div></article>`).join('')}</div>`;
}

function userOrders(user) {
  if (!user) return [];
  const orders = db.prepare('SELECT id,order_number,minecraft_username,discord_contact,status,total_piasters,created_at FROM orders WHERE user_id=? ORDER BY created_at DESC').all(user.id);
  return orders.map((order) => ({ ...order, items: db.prepare('SELECT product_name,quantity FROM order_items WHERE order_id=? ORDER BY id').all(order.id) }));
}

function renderOrders(user) {
  if (!user) return `<main class="page-main utility-page"><div class="container"><header class="page-intro"><p class="section-label">your account</p><h1 class="page-title">Order History</h1><p class="page-deck">Sign in to see orders attached to your player account.</p></header><p class="payment-note"><a href="/account">sign in or create an account</a> to keep your order history private.</p></div></main>`;
  const orders = userOrders(user);
  return `<main class="page-main utility-page"><div class="container"><header class="page-intro"><p class="section-label">your account</p><h1 class="page-title">Order History</h1><p class="page-deck">Orders for ${esc(user.minecraft_username)}. Payment and delivery status is updated by PRMD staff.</p></header>${orderRows(orders)}</div></main>`;
}

function renderPoints(user) {
  if (!user) return `<main class="page-main utility-page"><div class="container"><header class="page-intro"><p class="section-label">player account</p><h1 class="page-title">Points</h1><p class="page-deck">Points are account-specific. The ledger below is example activity only, not a live player balance.</p></header><p class="demo-tag">demo examples, not real account data</p><div class="summary-block margin-top-xl"><p class="section-label">sample balance</p><h2>Not connected to an account</h2><p class="page-deck">Sign in to see your real balance and staff-entered transaction history.</p></div><ul class="ledger-examples"><li><span>Example earning method: verified community event</span><span>amount set by staff</span></li><li><span>Example earning method: server activity configured by staff</span><span>amount set by staff</span></li><li><span>Example redemption: configured store reward</span><span>cost set by staff</span></li></ul><a class="button button--quiet margin-top-xl" href="/account">open your account</a></div></main>`;
  const ledger = db.prepare('SELECT delta,reason,created_at FROM point_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(user.id);
  return `<main class="page-main utility-page"><div class="container"><header class="page-intro"><p class="section-label">points for ${esc(user.minecraft_username)}</p><h1 class="page-title">Points</h1><p class="page-deck">This is the balance and ledger stored for your site account. It only reflects real server points after staff or a trusted Paper integration records them.</p></header><section class="summary-block"><p class="section-label">account balance</p><h2 class="num">${new Intl.NumberFormat('en-EG').format(user.points_balance)} points</h2></section>${ledger.length ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>change</th><th>reason</th><th>recorded</th></tr></thead><tbody>${ledger.map((entry) => `<tr><td class="num" data-label="change">${entry.delta > 0 ? '+' : ''}${entry.delta}</td><td data-label="reason">${esc(entry.reason)}</td><td data-label="recorded">${dateLabel(entry.created_at)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty-state">No point transactions are linked to this account yet. Staff can record an adjustment in the Admin area.</p>'}</div></main>`;
}

function renderAccount(user) {
  if (user) return `<main class="page-main utility-page"><div class="container"><header class="page-intro"><p class="section-label">player account</p><h1 class="page-title">Welcome, ${esc(user.minecraft_username)}.</h1><p class="page-deck">Your account keeps your orders and site points ledger together.</p></header><div class="admin-tools"><a class="button button--quiet" href="/orders">view order history</a><a class="button button--quiet" href="/points">view points</a><button class="button button--quiet" type="button" data-logout>sign out</button></div><p class="form-message" data-account-message aria-live="polite"></p></div></main>`;
  return `<main class="page-main utility-page"><div class="container"><header class="page-intro"><p class="section-label">player account</p><h1 class="page-title">Keep your place.</h1><p class="page-deck">Create a private account for order history and the points ledger. This site does not verify your Minecraft identity with Mojang or Paper.</p></header><div class="account-layout"><section><h2 data-auth-heading>Sign in</h2><form class="auth-form" data-auth-form novalidate><div class="field"><label for="account-username">Minecraft Java username (required)</label><input id="account-username" name="minecraftUsername" autocomplete="username" required minlength="3" maxlength="16" pattern="[A-Za-z0-9_]{3,16}"></div><div class="field"><label for="account-password">Password (required)</label><input id="account-password" name="password" type="password" autocomplete="current-password" required minlength="12" maxlength="128"></div><div class="field" data-discord-field hidden><label for="account-discord">Discord contact (optional)</label><input id="account-discord" name="discordContact" autocomplete="off" maxlength="80"></div><button class="button" type="submit" data-auth-submit>sign in</button><p class="form-message" data-auth-message aria-live="polite"></p></form><p class="account-switch"><span data-auth-switch-label>Need an account?</span> <button type="button" data-auth-switch>create one</button></p></section><aside class="payment-note">Use a unique password. Your site account is separate from your Minecraft login; never enter your Minecraft password here.</aside></div></div></main>`;
}

function renderAdmin(user) {
  if (!user || user.role !== 'admin') return `<main class="page-main utility-page"><div class="container"><header class="page-intro"><p class="section-label">staff only</p><h1 class="page-title">Admin sign in</h1><p class="page-deck">Staff credentials are checked and authorized on the server.</p></header><form class="auth-form" data-admin-login novalidate><div class="field"><label for="staff-username">Staff username</label><input id="staff-username" name="username" required autocomplete="username"></div><div class="field"><label for="staff-password">Password</label><input id="staff-password" name="password" type="password" required autocomplete="current-password"></div><button class="button" type="submit">sign in to admin</button><p class="form-message" data-admin-message aria-live="polite"></p></form></div></main>`;
  const orders = db.prepare('SELECT order_number,minecraft_username,discord_contact,status,total_piasters,created_at FROM orders ORDER BY created_at DESC LIMIT 100').all();
  const products = db.prepare('SELECT id,category,name,description,image_path,price_piasters,published FROM products ORDER BY created_at DESC').all();
  const users = db.prepare("SELECT id,minecraft_username,points_balance FROM users WHERE role='player' ORDER BY minecraft_username COLLATE NOCASE LIMIT 100").all();
  return `<main class="page-main utility-page"><div class="container"><header class="page-intro"><p class="section-label">staff only</p><h1 class="page-title">City admin</h1><p class="page-deck">Manage the live store records and update orders after staff confirm payments or delivery.</p><div class="admin-tools"><span class="status-badge">signed in as ${esc(user.minecraft_username)}</span><button class="button button--quiet" type="button" data-logout>sign out</button></div></header><div class="notice">Payments are handled manually through Discord. Mark an order Paid only after a staff member verifies the transfer; mark it Fulfilled after delivery.</div><p class="form-message" data-admin-feedback aria-live="polite"></p>
    <div class="admin-shell">
      <section class="admin-section" id="products"><header><div><p class="section-label">store catalogue</p><h2>Products and prices</h2></div><span class="status-badge">${products.length} records</span></header><form class="admin-form" data-product-form novalidate><div class="field"><label for="product-name">Item name (required)</label><input id="product-name" name="name" required maxlength="80"></div><div class="field"><label for="product-category">Category</label><select id="product-category" name="category" required><option value="backpacks">Backpacks</option><option value="elytra">Exotic Elytra</option><option value="hats">Exotic Hats</option><option value="plus">PRMD+</option></select></div><div class="field field--wide"><label for="product-description">Description (required)</label><textarea id="product-description" name="description" required maxlength="500"></textarea></div><div class="field"><label for="product-price">Price in EGP</label><input id="product-price" name="price" type="number" min="0" step="0.01" required inputmode="decimal"></div><div class="field"><label for="product-image">Original item image path</label><input id="product-image" name="imagePath" required pattern="/assets/items/.+" placeholder="/assets/items/item.webp"><p class="field-hint">Add the supplied file under public/assets/items first.</p></div><div class="field"><label for="product-published">Visibility</label><select id="product-published" name="published"><option value="0">Draft</option><option value="1">Published</option></select></div><button class="button" type="submit">save product</button><input type="hidden" name="id" value=""></form><div class="data-table-wrap"><table class="data-table"><thead><tr><th>item</th><th>category</th><th>price</th><th>visibility</th><th>action</th></tr></thead><tbody>${products.length ? products.map((p) => `<tr><td data-label="item">${esc(p.name)}<br><code>${esc(p.image_path)}</code></td><td data-label="category">${esc(CATEGORIES[p.category]?.title || p.category)}</td><td data-label="price">${formatEgp(p.price_piasters)}</td><td data-label="visibility">${p.published ? 'published' : 'draft'}</td><td data-label="action"><div class="admin-inline"><button type="button" data-edit-product="${p.id}">edit</button><button type="button" data-hide-product="${p.id}">${p.published ? 'unpublish' : 'remove'}</button></div></td></tr>`).join('') : '<tr><td colspan="5">No products yet. Add verified item details and image paths above.</td></tr>'}</tbody></table></div></section>
      <section class="admin-section" id="orders"><header><div><p class="section-label">manual fulfilment</p><h2>Orders</h2></div><span class="status-badge">${orders.length} recent</span></header><div class="data-table-wrap"><table class="data-table"><thead><tr><th>order</th><th>player</th><th>items and total</th><th>status</th><th>update</th></tr></thead><tbody>${orders.length ? orders.map((o) => `<tr><td data-label="order"><code>${esc(o.order_number)}</code><br>${dateLabel(o.created_at)}</td><td data-label="player">${esc(o.minecraft_username)}${o.discord_contact ? `<br>${esc(o.discord_contact)}` : ''}</td><td data-label="items and total">${orderItemsLabel(o.order_number)}<br>${formatEgp(o.total_piasters)}</td><td data-label="status">${esc(o.status)}</td><td data-label="update"><form class="admin-inline" data-status-form data-order="${esc(o.order_number)}"><label class="visually-hidden" for="status-${esc(o.order_number)}">Status for ${esc(o.order_number)}</label><select id="status-${esc(o.order_number)}" name="status">${ORDER_STATUSES.map((s) => `<option value="${esc(s)}"${o.status === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select><button type="submit">save</button></form></td></tr>`).join('') : '<tr><td colspan="5">No orders have been placed.</td></tr>'}</tbody></table></div></section>
      <section class="admin-section" id="points"><header><div><p class="section-label">account ledger</p><h2>Player points</h2></div><span class="status-badge">${users.length} accounts</span></header><form class="admin-form" data-points-form novalidate><div class="field"><label for="points-player">Player account</label><select id="points-player" name="userId" required>${users.length ? users.map((u) => `<option value="${u.id}">${esc(u.minecraft_username)}: ${u.points_balance} points</option>`).join('') : '<option value="">No player accounts yet</option>'}</select></div><div class="field"><label for="points-delta">Point change (positive adds)</label><input id="points-delta" name="delta" type="number" step="1" required></div><div class="field field--wide"><label for="points-reason">Reason for the ledger</label><input id="points-reason" name="reason" maxlength="160" required></div><button class="button" type="submit"${users.length ? '' : ' disabled aria-disabled="true"'}>record point change</button></form><p class="field-hint">Every change is attached to the signed-in staff account and remains in the player ledger.</p></section>
    </div></div></main>`;
}

function orderItemsLabel(orderNumber) {
  const row = db.prepare('SELECT id FROM orders WHERE order_number=?').get(orderNumber);
  if (!row) return '';
  return db.prepare('SELECT product_name,quantity FROM order_items WHERE order_id=?').all(row.id).map((i) => `${esc(i.product_name)} × ${i.quantity}`).join(', ');
}

function reactShell(path) {
  const route = ROUTES.get(path);
  const title = route?.title || 'PRMD City';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="PRMD City, an Egyptian-themed Minecraft community built by friends."><meta name="theme-color" content="#21160f"><title>${esc(title)} — PRMD City</title><link rel="stylesheet" href="/css/site.css"></head><body><div id="root" data-path="${esc(path)}"><main class="page-main utility-page"><div class="container"><h1 class="page-title">Entering PRMD City…</h1><p class="page-deck">Loading the city and checking your account.</p></div></main></div><noscript><main class="page-main utility-page"><div class="container"><h1 class="page-title">Enable JavaScript to enter the city.</h1><p class="page-deck">The PRMD City interactive shop and player area need JavaScript.</p></div></main></noscript><script src="/app-react.js" defer></script></body></html>`;
}

function renderPage(path, user) {
  const route = ROUTES.get(path);
  if (!route) return '';
  let content = '';
  if (route.kind === 'home') content = renderHome();
  if (route.kind === 'store') content = renderStore(route.category);
  if (route.kind === 'plus') content = renderPlus();
  if (route.kind === 'map') content = renderMap();
  if (route.kind === 'basket') content = renderBasket(user);
  if (route.kind === 'orders') content = renderOrders(user);
  if (route.kind === 'points') content = renderPoints(user);
  if (route.kind === 'account') content = renderAccount(user);
  if (route.kind === 'admin') content = renderAdmin(user);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="PRMD City, an Egyptian-themed Minecraft community built by friends."><title>${esc(route.title)} — PRMD City</title><link rel="stylesheet" href="/css/site.css"><script src="/app.js" defer></script></head><body>${header(path)}<p class="sr-live" data-product-message aria-live="polite"></p>${content}${footer()}</body></html>`;
}

function userView(user) {
  if (!user) return null;
  return { id: user.id, minecraftUsername: user.minecraft_username, discordContact: user.discord_contact, role: user.role, pointsBalance: user.points_balance };
}

function validateUsername(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(value);
}

function validatePassword(value) {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128;
}

function cleanContact(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 80);
}

function productFromBody(body, partial = false) {
  const result = {};
  if (!partial || 'name' in body) {
    if (typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.trim().length > 80) throw Object.assign(new Error('Enter an item name between 2 and 80 characters.'), { status: 400 });
    result.name = body.name.trim();
  }
  if (!partial || 'category' in body) {
    if (!Object.hasOwn(CATEGORIES, body.category)) throw Object.assign(new Error('Choose a valid store category.'), { status: 400 });
    result.category = body.category;
  }
  if (!partial || 'description' in body) {
    if (typeof body.description !== 'string' || body.description.trim().length < 3 || body.description.trim().length > 500) throw Object.assign(new Error('Enter an item description between 3 and 500 characters.'), { status: 400 });
    result.description = body.description.trim();
  }
  if (!partial || 'imagePath' in body) {
    if (typeof body.imagePath !== 'string' || !imagePathIsSafe(body.imagePath.trim())) throw Object.assign(new Error('Use an image file under /assets/items with a supported image extension.'), { status: 400 });
    result.image_path = body.imagePath.trim();
  }
  if (!partial || 'price' in body) {
    const value = String(body.price ?? '');
    if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) throw Object.assign(new Error('Enter an EGP price with up to two decimal places.'), { status: 400 });
    result.price_piasters = Math.round(Number(value) * 100);
  }
  if (!partial || 'published' in body) {
    const published = body.published === true || body.published === 1 || body.published === '1';
    result.published = published ? 1 : 0;
  }
  return result;
}

function requireRole(user, role) {
  return Boolean(user && user.role === role);
}

function accountOrdersFor(userId) {
  const orders = db.prepare('SELECT id,order_number,minecraft_username,discord_contact,status,total_piasters,created_at FROM orders WHERE user_id=? ORDER BY created_at DESC').all(userId);
  return orders.map((order) => ({ ...order, items: db.prepare('SELECT product_name,quantity,unit_price_piasters FROM order_items WHERE order_id=? ORDER BY id').all(order.id) }));
}

function adminCounts() {
  return {
    products: db.prepare('SELECT COUNT(*) AS count FROM products').get().count,
    publishedProducts: db.prepare('SELECT COUNT(*) AS count FROM products WHERE published=1').get().count,
    orders: db.prepare('SELECT COUNT(*) AS count FROM orders').get().count,
    awaiting: db.prepare("SELECT COUNT(*) AS count FROM orders WHERE status='Awaiting Payment'").get().count,
  };
}

async function handleApi(req, res, url, user) {
  const pathname = url.pathname;
  if (req.method === 'GET' && pathname === '/api/site') return json(res, 200, { user: userView(user), mapUrl: safeMapUrl(), discordUrl: DISCORD_URL });
  if (req.method === 'GET' && pathname === '/api/account/me') return json(res, 200, { user: userView(user) });
  if (req.method === 'GET' && pathname === '/api/products') return json(res, 200, { products: publicProducts() });

  if (req.method === 'POST') {
    if (!requireSameOrigin(req)) return json(res, 403, { error: 'This request must come from the PRMD City site.' });
    const body = await readJson(req);
    if (pathname === '/api/account/register') {
      if (!limited(req, 'register', 5)) return json(res, 429, { error: 'Too many attempts. Wait a while, then try again.' });
      if (!validateUsername(body.minecraftUsername)) return json(res, 400, { error: 'Use a Minecraft Java username with 3 to 16 letters, numbers, or underscores.' });
      if (!validatePassword(body.password)) return json(res, 400, { error: 'Choose a password from 12 to 128 characters.' });
      const { salt, hash } = hashPassword(body.password);
      try {
        const result = db.prepare("INSERT INTO users(minecraft_username,discord_contact,password_salt,password_hash,role) VALUES(?,?,?,?, 'player')").run(body.minecraftUsername.trim(), cleanContact(body.discordContact), salt, hash);
        const created = db.prepare('SELECT id,minecraft_username,discord_contact,role,points_balance FROM users WHERE id=?').get(result.lastInsertRowid);
        issueSession(created, res);
        return json(res, 201, { user: userView(created) });
      } catch { return json(res, 409, { error: 'That player username already has an account. Sign in or choose the right account.' }); }
    }
    if (pathname === '/api/account/login' || pathname === '/api/admin/login') {
      const role = pathname.includes('/admin/') ? 'admin' : 'player';
      if (!limited(req, `login-${role}`, 8)) return json(res, 429, { error: 'Too many sign-in attempts. Wait a while, then try again.' });
      if (typeof body.username !== 'string' || typeof body.password !== 'string') return json(res, 400, { error: 'Enter your username and password.' });
      const account = db.prepare('SELECT id,minecraft_username,discord_contact,role,points_balance,password_salt,password_hash FROM users WHERE minecraft_username=? COLLATE NOCASE AND role=?').get(body.username.trim(), role);
      if (!account || !passwordMatches(body.password, account.password_salt || '', account.password_hash || '')) return json(res, 401, { error: 'The username or password did not match.' });
      issueSession(account, res);
      return json(res, 200, { user: userView(account) });
    }
    if (pathname === '/api/logout') {
      clearSession(req, res);
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/orders') {
      if (!requireRole(user, 'player')) return json(res, 401, { error: 'Sign in to your player account before placing an order.' });
      if (!validateUsername(body.minecraftUsername)) return json(res, 400, { error: 'Enter the Minecraft Java username for item delivery.' });
      const discord = cleanContact(body.discordContact);
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) return json(res, 400, { error: 'Your basket is empty or contains too many separate products.' });
      const quantities = new Map();
      for (const item of body.items) {
        const id = Number(item?.id), quantity = Number(item?.quantity);
        if (!Number.isInteger(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) return json(res, 400, { error: 'Check each item quantity and try again.' });
        quantities.set(id, (quantities.get(id) || 0) + quantity);
      }
      const rows = [];
      for (const [id, quantity] of quantities) {
        const product = db.prepare('SELECT id,name,price_piasters FROM products WHERE id=? AND published=1').get(id);
        if (!product) return json(res, 400, { error: 'An item in your basket is no longer available. Review the basket and try again.' });
        if (quantity > 20) return json(res, 400, { error: 'Each product is limited to 20 per order.' });
        rows.push({ ...product, quantity });
      }
      const total = rows.reduce((sum, item) => sum + item.price_piasters * item.quantity, 0);
      const orderNumber = `PRMD-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
      db.exec('BEGIN IMMEDIATE');
      try {
        const created = db.prepare("INSERT INTO orders(order_number,user_id,minecraft_username,discord_contact,status,total_piasters) VALUES(?,?,?,?, 'Awaiting Payment',?)").run(orderNumber, user.id, body.minecraftUsername.trim(), discord, total);
        const addLine = db.prepare('INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price_piasters) VALUES(?,?,?,?,?)');
        for (const item of rows) addLine.run(created.lastInsertRowid, item.id, item.name, item.quantity, item.price_piasters);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return json(res, 201, { orderNumber, status: 'Awaiting Payment', totalPiasters: total, discordUrl: DISCORD_URL });
    }
    if (pathname === '/api/admin/products') {
      if (!requireRole(user, 'admin')) return json(res, 403, { error: 'Staff access is required.' });
      const fields = productFromBody(body);
      if (!existsSync(join(PUBLIC, fields.image_path.slice(1)))) return json(res, 400, { error: 'That image file is not in public/assets/items yet.' });
      const baseSlug = slugify(fields.name) || `item-${Date.now()}`;
      let slug = baseSlug, suffix = 2;
      while (db.prepare('SELECT id FROM products WHERE slug=?').get(slug)) slug = `${baseSlug}-${suffix++}`;
      const result = db.prepare('INSERT INTO products(slug,category,name,description,image_path,price_piasters,published) VALUES(?,?,?,?,?,?,?)').run(slug, fields.category, fields.name, fields.description, fields.image_path, fields.price_piasters, fields.published);
      return json(res, 201, { id: Number(result.lastInsertRowid) });
    }
    return json(res, 404, { error: 'Route not found.' });
  }

  if (req.method === 'GET' && pathname === '/api/account/orders') {
    if (!requireRole(user, 'player')) return json(res, 401, { error: 'Sign in to see your order history.' });
    return json(res, 200, { orders: accountOrdersFor(user.id) });
  }
  if (req.method === 'GET' && pathname === '/api/account/points') {
    if (!requireRole(user, 'player')) return json(res, 401, { error: 'Sign in to see your points ledger.' });
    const ledger = db.prepare('SELECT delta,reason,created_at FROM point_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(user.id);
    return json(res, 200, { balance: user.points_balance, ledger });
  }
  if (req.method === 'GET' && pathname === '/api/admin/summary') {
    if (!requireRole(user, 'admin')) return json(res, 403, { error: 'Staff access is required.' });
    return json(res, 200, { summary: adminCounts() });
  }
  if (req.method === 'GET' && pathname === '/api/admin/products') {
    if (!requireRole(user, 'admin')) return json(res, 403, { error: 'Staff access is required.' });
    return json(res, 200, { products: db.prepare('SELECT * FROM products ORDER BY created_at DESC').all() });
  }
  if (req.method === 'GET' && pathname === '/api/admin/accounts') {
    if (!requireRole(user, 'admin')) return json(res, 403, { error: 'Staff access is required.' });
    return json(res, 200, { accounts: db.prepare("SELECT id,minecraft_username,points_balance FROM users WHERE role='player' ORDER BY minecraft_username COLLATE NOCASE LIMIT 100").all() });
  }
  if (req.method === 'GET' && pathname === '/api/admin/orders') {
    if (!requireRole(user, 'admin')) return json(res, 403, { error: 'Staff access is required.' });
    const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200').all();
    return json(res, 200, { orders: orders.map((order) => ({ ...order, items: db.prepare('SELECT product_name,quantity,unit_price_piasters FROM order_items WHERE order_id=?').all(order.id) })) });
  }

  if (['PATCH', 'DELETE'].includes(req.method)) {
    if (!requireSameOrigin(req)) return json(res, 403, { error: 'This request must come from the PRMD City site.' });
    if (!requireRole(user, 'admin')) return json(res, 403, { error: 'Staff access is required.' });
    const body = req.method === 'PATCH' ? await readJson(req) : {};
    const productMatch = pathname.match(/^\/api\/admin\/products\/(\d+)$/);
    if (productMatch && req.method === 'PATCH') {
      const product = db.prepare('SELECT id FROM products WHERE id=?').get(Number(productMatch[1]));
      if (!product) return json(res, 404, { error: 'Product not found.' });
      const fields = productFromBody(body, true);
      if (fields.image_path && !existsSync(join(PUBLIC, fields.image_path.slice(1)))) return json(res, 400, { error: 'That image file is not in public/assets/items yet.' });
      const columns = Object.keys(fields);
      if (!columns.length) return json(res, 400, { error: 'No product fields were provided.' });
      const values = columns.map((column) => fields[column]);
      db.prepare(`UPDATE products SET ${columns.map((column) => `${column}=?`).join(',')},updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(...values, Number(productMatch[1]));
      return json(res, 200, { ok: true });
    }
    if (productMatch && req.method === 'DELETE') {
      const result = db.prepare('UPDATE products SET published=0,updated_at=strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id=?').run(Number(productMatch[1]));
      return json(res, result.changes ? 200 : 404, result.changes ? { ok: true } : { error: 'Product not found.' });
    }
    const orderMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/status$/);
    if (orderMatch) {
      if (!ORDER_STATUSES.includes(body.status)) return json(res, 400, { error: 'Choose a valid order status.' });
      const result = db.prepare("UPDATE orders SET status=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE order_number=?").run(body.status, decodeURIComponent(orderMatch[1]));
      return json(res, result.changes ? 200 : 404, result.changes ? { ok: true } : { error: 'Order not found.' });
    }
    const pointsMatch = pathname.match(/^\/api\/admin\/accounts\/(\d+)\/points$/);
    if (pointsMatch) {
      const userId = Number(pointsMatch[1]);
      const delta = Number(body.delta);
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 160) : '';
      if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 10000000 || reason.length < 3) return json(res, 400, { error: 'Enter a non-zero whole point change and its reason.' });
      db.exec('BEGIN IMMEDIATE');
      try {
        const player = db.prepare("SELECT id,points_balance FROM users WHERE id=? AND role='player'").get(userId);
        if (!player) { db.exec('ROLLBACK'); return json(res, 404, { error: 'Player account not found.' }); }
        const next = player.points_balance + delta;
        if (next < 0) { db.exec('ROLLBACK'); return json(res, 400, { error: 'A points change cannot make the balance negative.' }); }
        db.prepare('UPDATE users SET points_balance=? WHERE id=?').run(next, userId);
        db.prepare('INSERT INTO point_transactions(user_id,delta,reason,created_by) VALUES(?,?,?,?)').run(userId, delta, reason, user.id);
        db.exec('COMMIT');
        return json(res, 200, { balance: next });
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  }
  return json(res, 404, { error: 'Route not found.' });
}

const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };

function serveStatic(pathname, res) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end('Bad path'); }
  const normalized = normalize(decoded).replace(/^[/\\]+/, '');
  const filePath = resolve(PUBLIC, normalized);
  const relativePath = relative(resolve(PUBLIC), filePath);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) { res.writeHead(403); return res.end('Forbidden'); }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=300' });
  createReadStream(filePath).pipe(res);
}

const app = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { status: 'ok' });
    const user = sessionFor(req);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url, user);
    const routePath = url.pathname === '/index.html' ? '/' : url.pathname.replace(/\/$/, '') || '/';
    if (req.method === 'GET' && ROUTES.has(routePath)) return html(res, reactShell(routePath), req);
    if (req.method === 'GET' && routePath !== '/') return serveStatic(routePath, res);
    res.writeHead(405, { 'Allow': 'GET, HEAD' });
    res.end('Method not allowed');
  } catch (error) {
    console.error('Request failed:', error.message);
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'The request could not be completed. Try again.' });
    else res.destroy();
  }
});

app.listen(PORT, HOST, () => console.log(`PRMD City is listening on http://${HOST}:${PORT}`));

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  app.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
});


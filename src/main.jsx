import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const h = React.createElement;
const DISCORD = 'https://discord.gg/AC2DExcnP8';
const CATEGORIES = [
  { path: '/store/backpacks', key: 'backpacks', label: 'Backpacks', description: 'Server backpacks for the journeys you make in PRMD City.' },
  { path: '/store/exotic-elytra', key: 'elytra', label: 'Exotic Elytra', description: 'Distinctive elytra for seeing the city from above.' },
  { path: '/store/exotic-hats', key: 'hats', label: 'Exotic Hats', description: 'Exotic hats for players who like their own look.' },
  { path: '/store/prmd-plus', key: 'plus', label: 'PRMD+', description: 'The monthly PRMD+ rewards, gathered under one membership.' },
];
const STATUSES = ['Awaiting Payment', 'Paid', 'Fulfilled', 'Cancelled'];
const money = (piasters) => new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format((Number(piasters) || 0) / 100);
const dateLabel = (date) => new Intl.DateTimeFormat('en-EG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(new Date(date));
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'That request did not go through. Try again.');
  return result;
}
function useLoad(path, deps = []) {
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); setError(''); try { setData(await api(path)); } catch (err) { setError(err.message); } finally { setLoading(false); } }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load };
}
function Notice({ children, tone = '' }) { return h('p', { className: 'form-message', 'data-tone': tone, role: tone === 'error' ? 'alert' : undefined, 'aria-live': tone === 'error' ? 'assertive' : 'polite' }, children); }
function PageIntro({ label, title, children }) { return h('header', { className: 'page-intro' }, label && h('p', { className: 'section-label' }, label), h('h1', { className: 'page-title' }, title), children && h('p', { className: 'page-deck' }, children)); }
function ButtonLink({ href, children, quiet = false }) { return h('a', { className: `button${quiet ? ' button--quiet' : ''}`, href }, children); }
function Header({ path, user, basketCount }) {
  const storeOpen = path.startsWith('/store/');
  const storeMenu = h('details', { className: `nav-store${storeOpen ? ' nav-store--active' : ''}`, open: storeOpen }, h('summary', { 'aria-current': storeOpen ? 'page' : undefined }, 'store'), h('div', { className: 'store-menu' }, ...CATEGORIES.map((item) => h('a', { key: item.key, href: item.path, 'aria-current': path === item.path ? 'page' : undefined }, item.label))));
  const link = (url, title, current = url) => h('a', { href: url, 'aria-current': path === current ? 'page' : undefined }, title);
  const mobileStore = h('details', null, h('summary', null, 'store'), h('div', { className: 'store-menu' }, ...CATEGORIES.map((item) => h('a', { key: item.key, href: item.path }, item.label))));
  return h('header', { className: 'site-header' },
    h('div', { className: 'container masthead' },
      h('a', { className: 'brand', href: '/', 'aria-label': 'PRMD City home' }, h('span', { className: 'brand-logo-slot' }, h('img', { className: 'brand__logo', src: '/assets/brand/prmd-city-logo.png', alt: 'PRMD City' }))),
      h('nav', { className: 'primary-nav', 'aria-label': 'Main navigation' }, link('/', 'home'), storeMenu, link('/live-map', 'live map'), link('/points', 'points'), link('/orders', 'order history')),
      h('div', { className: 'nav-actions' }, h('a', { href: '/basket', 'aria-current': path === '/basket' ? 'page' : undefined }, 'basket', h('span', { className: 'basket-count' }, basketCount)), link('/account', user ? user.minecraftUsername : 'account'), link('/admin', 'staff'))),
    h('nav', { className: 'container mobile-nav', 'aria-label': 'Store and community navigation' }, mobileStore, link('/live-map', 'live map'), link('/points', 'points'), link('/orders', 'orders')));
}
function Footer({ discord = DISCORD }) {
  const columns = [['the shelves', ...CATEGORIES.map((c) => [c.path, c.label])], ['the city', ['/', 'home'], ['/live-map', 'live map'], [discord, 'Discord']], ['your account', ['/basket', 'shopping basket'], ['/points', 'points'], ['/orders', 'order history'], ['/admin', 'staff admin']]];
  const columnNodes = columns.map(([title, ...links]) => {
    const linkNodes = links.map(([url, label]) => h('a', { key: url, href: url, ...(url.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }, label));
    return h('section', { className: 'footer-column', key: title }, [h('h2', { key: 'title' }, title), ...linkNodes]);
  });
  return h('footer', { className: 'site-footer' }, h('div', { className: 'container footer-inner' }, [
    h('p', { className: 'footer-signoff', key: 'signoff' }, 'A city built by friends, block by block.'),
    h('div', { className: 'footer-columns', key: 'columns' }, columnNodes),
    h('div', { className: 'footer-legal', key: 'legal' }, [h('span', { key: 'edition' }, 'PRMD City runs Java Edition 26.2 on Paper.'), h('span', { key: 'trademark' }, 'Not an official Minecraft product. Minecraft is a trademark of Mojang Studios.')]),
  ]));
}
function ProductCard({ product, add }) {
  return h('article', { className: 'product-card' }, h('div', { className: 'product-media' }, product.image_path?.startsWith('/assets/items/') ? h('img', { src: product.image_path, alt: product.name, loading: 'lazy' }) : h('span', null, 'image not configured')), h('div', { className: 'product-info' }, h('h2', null, product.name), h('p', null, product.description), h('div', { className: 'product-buy' }, h('span', { className: 'product-price' }, money(product.price_piasters)), h('button', { type: 'button', onClick: () => add(product) }, 'add to basket'))));
}
function ProductGrid({ products, add }) { return products.length ? h('div', { className: 'catalogue-grid' }, ...products.map((item) => h(ProductCard, { key: item.id, product: item, add }))) : h('div', { className: 'catalogue-empty' }, h('h2', null, 'No items are listed yet.'), h('p', null, 'Staff are adding verified item details, images, and current prices.'), h('a', { className: 'text-link', href: DISCORD, target: '_blank', rel: 'noopener noreferrer' }, 'ask the PRMD staff team'));
}
function Rewards() { return h('ul', { className: 'rewards-list' }, ...['Custom PRMD+ in-server rank', 'One medium backpack', 'One rainbow elytra', 'One random exotic hat', '25,000 in-game cash per month'].map((x) => h('li', { key: x }, x))); }
function Home({ products, add, mapUrl }) {
  const featured = products.slice(0, 3);
  return <>
    <div className="intro-story">
      <section className="intro-stage" aria-labelledby="intro-title">
        <div className="container intro-stage__inner">
          <div className="intro-copy">
            <h1 className="intro-title" id="intro-title">PRMD presents</h1>
            <p className="intro-line">An Egyptian-themed Minecraft world, made by friends and shaped one block at a time.</p>
            <div className="intro-actions"><a className="button intro-skip" href="#city-home">skip the introduction</a></div>
          </div>
          <figure className="intro-art"><img src="/assets/brand/prmd-city-logo.png" alt="PRMD City" width="1000" height="525" /></figure>
        </div>
        <span className="scroll-cue" aria-hidden="true">scroll to enter</span>
      </section>
      <section className="identity-stage" id="the-city" aria-labelledby="identity-title">
        <div className="container identity-stage__inner">
          <div className="identity-copy">
            <h2 className="identity-title" id="identity-title"><span className="visually-hidden">Egypt’s 1st Minecraft Server</span><img className="identity-title-art" src="/assets/brand/prmd-city-minecraft-logo.png" alt="" width="2048" height="612" /></h2>
            <p className="identity-note">PRMD City is a world made by friends. Find your place, meet the city, and leave a little of your own work behind.</p>
          </div>
          <span className="identity-mark" aria-hidden="true">𓂀</span>
        </div>
        <span className="scroll-cue" aria-hidden="true">enter PRMD City</span>
      </section>
    </div>
    <main className="page-main home-main" id="city-home">
      <section className="home-band"><div className="container">
        <div className="section-head"><div><p className="section-label">the server</p><h2 className="section-title">The city, in its own edition.</h2></div><p className="section-summary">Bring Minecraft Java Edition 26.2. PRMD City runs on Paper. Ask the staff team on Discord for the current server address and connection details.</p></div>
        <dl className="server-spec">
          {[['edition', 'Java Edition 26.2'], ['server software', 'Paper'], ['built by', 'friends']].map(([label, value]) => <div className="server-spec__row" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          <div className="server-spec__row"><dt>connection details</dt><dd><a className="text-link" href={DISCORD} target="_blank" rel="noopener noreferrer">ask on Discord</a></dd></div>
        </dl>
        <div className="server-logo" aria-label="PRMD server logo"><img src="/assets/brand/prmd-city-minecraft-logo.png" alt="PRMD City Minecraft Server" width="2048" height="612" loading="lazy" /></div>
      </div></section>
      <section className="home-band home-band--shade"><div className="container">
        <div className="section-head"><div><p className="section-label">a tiny desert arcade</p><h2 className="section-title">Raid the pyramid.</h2></div><p className="section-summary">Run, leap traps, and collect scarabs through three increasingly tricky routes. A rotating sun dial follows your journey.</p></div>
        <Arcade />
      </div></section>
      <section className="home-band chamber-band"><div className="container">
        <div className="section-head"><div><p className="section-label">a small daily challenge</p><h2 className="section-title">The Scarab Vault.</h2></div><p className="section-summary">Turn over the stones, remember the glyphs, and find all eight pairs. A new board arrives each day at Cairo midnight.</p></div>
        <DailyVault />
      </div></section>
      <section className="home-band"><div className="container">
        <div className="section-head"><div><p className="section-label">from the shelves</p><h2 className="section-title">Bring a little more to the world.</h2></div><p className="section-summary">Browse the server store. Staff publish each item with its original image and current price.</p></div>
        <ProductGrid products={featured} add={add} />
        <div className="intro-actions"><ButtonLink href="/store/backpacks" quiet>browse the store</ButtonLink></div>
      </div></section>
      <section className="home-band home-band--shade"><div className="container rewards">
        <div><p className="section-label">monthly membership</p><h2>PRMD+</h2><p className="page-deck">One monthly bundle of in-server rewards. Staff will publish the EGP price when it is ready.</p><ButtonLink href="/store/prmd-plus" quiet>see PRMD+ rewards</ButtonLink></div>
        <Rewards />
      </div></section>
      <section className="home-band"><div className="container">
        <div className="section-head"><div><p className="section-label">above the rooftops</p><h2 className="section-title">Look around before you set out.</h2></div><p className="section-summary">{mapUrl ? 'Explore the connected city map before you join the adventure.' : 'The live map will appear here when the server connects BlueMap or Dynmap.'}</p></div>
        <ButtonLink href="/live-map" quiet>open the live map</ButtonLink>
      </div></section>
      <section className="home-band home-band--shade"><div className="container">
        <div className="section-head"><div><p className="section-label">meet the players</p><h2 className="section-title">The next block starts with you.</h2></div><p className="section-summary">Ask questions, find the current address, and get payment instructions from staff through the PRMD Discord.</p></div>
        <a className="button" href={DISCORD} target="_blank" rel="noopener noreferrer">join the Discord</a>
      </div></section>
    </main>
  </>;
}function Store({ path, products, add }) {
  const category = CATEGORIES.find((item) => item.path === path) || CATEGORIES[0];
  const items = products.filter((product) => product.category === category.key);
  if (category.key === 'plus') return h('main', { className: 'page-main store-page' }, h('div', { className: 'container' }, h('header', { className: 'page-intro' }, h('img', { className: 'category-title-art category-title-art--ranks', src: '/assets/brand/ranks-title.png', alt: 'Ranks', width: '1240', height: '240' }), h('p', { className: 'section-label' }, 'PRMD City store'), h('h1', { className: 'page-title' }, 'PRMD+'), h('p', { className: 'page-deck' }, 'The monthly bundle of in-server rewards. The exact price and item image will be listed here after staff configure them.')), h('section', { className: 'rewards' }, h('div', null, h('p', { className: 'section-label' }, 'monthly bundle'), h('h2', null, 'Made for your time in the city.'), items[0] ? h(React.Fragment, null, h('p', { className: 'product-price margin-top-lg' }, money(items[0].price_piasters)), h('button', { className: 'button', type: 'button', onClick: () => add(items[0]) }, 'add PRMD+ to basket')) : h('p', { className: 'price-pending' }, 'Monthly price pending staff setup.')), h(Rewards)), h('p', { className: 'payment-note margin-top-2xl' }, 'Payment is arranged with staff through Discord after the order is placed. No payment details are collected on this website.')));
  return h('main', { className: 'page-main store-page' }, h('div', { className: 'container' }, h('header', { className: 'page-intro' }, ['elytra', 'hats'].includes(category.key) && h('img', { className: 'category-title-art', src: '/assets/brand/cosmetics-title.png', alt: 'Cosmetics', width: '2050', height: '240' }), h('p', { className: 'section-label' }, 'PRMD City store'), h('h1', { className: 'page-title' }, category.label), h('p', { className: 'page-deck' }, category.description)), h('nav', { className: 'store-subnav', 'aria-label': 'Store categories' }, ...CATEGORIES.map((item) => h('a', { className: 'store-tab', key: item.key, href: item.path, 'aria-current': path === item.path ? 'page' : undefined }, item.label))), h(ProductGrid, { products: items, add }), h('p', { className: 'payment-note margin-top-2xl' }, 'Orders are paid manually. The site does not process payments; staff share mobile-wallet or InstaPay instructions through ', h('a', { href: DISCORD, target: '_blank', rel: 'noopener noreferrer' }, 'Discord'), '.')));
}
function MapPage({ mapUrl }) {
  return <main className="page-main utility-page"><div className="container">
    <PageIntro label="a view of the city" title="Live Map">{mapUrl ? 'Explore the connected server map.' : 'A BlueMap or Dynmap address has not been configured yet.'}</PageIntro>
    {mapUrl ? <iframe className="map-frame" src={mapUrl} title="PRMD City live map" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" /> : <section className="map-placeholder"><div><h2>Map connection pending</h2><p>Set PRMD_MAP_URL to the server’s public BlueMap or Dynmap URL, then restart this site. Until then, ask the PRMD staff team for help on Discord.</p><a className="button button--quiet margin-top-lg" href={DISCORD} target="_blank" rel="noopener noreferrer">ask the staff team</a></div></section>}
  </div></main>;
}function Basket({ user, addMessage }) {
  const [items, setItems] = useState(() => { try { return JSON.parse(localStorage.getItem('prmd-city-basket-v1') || '[]'); } catch { return []; } });
  const [message, setMessage] = useState(''); const [error, setError] = useState(false);
  useEffect(() => { addMessage(items.reduce((sum, item) => sum + item.quantity, 0)); }, [items, addMessage]);
  const persist = (next) => { setItems(next); try { localStorage.setItem('prmd-city-basket-v1', JSON.stringify(next)); } catch {} };
  const total = items.reduce((sum, item) => sum + (Number(item.price_piasters) || 0) * item.quantity, 0);
  const quantity = (id, delta) => persist(items.map((item) => item.id === id ? { ...item, quantity: Math.max(1, Math.min(20, item.quantity + delta)) } : item));
  const checkout = async (event) => { event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return; if (!items.length) { setError(true); setMessage('Your basket is empty. Add an item before checkout.'); return; } const data = new FormData(form); try { const order = await api('/api/orders', { method: 'POST', body: JSON.stringify({ minecraftUsername: data.get('minecraftUsername'), discordContact: data.get('discordContact'), items }) }); persist([]); setError(false); setMessage(`Order ${order.orderNumber} is saved as Awaiting Payment. Contact staff through Discord for manual payment instructions.`); } catch (err) { setError(true); setMessage(err.message); } };
  return h('main', { className: 'page-main utility-page' }, h('div', { className: 'container' }, h(PageIntro, { label: 'your basket', title: 'Shopping Basket' }, 'Review the items you selected. Checkout records an order for staff follow-up; it does not charge you.'), h('div', { className: 'basket-layout' }, h('section', null, items.length ? h('div', { className: 'basket-list' }, ...items.map((item) => h('article', { className: 'basket-row', key: item.id }, h('div', null, h('h2', null, item.name), h('p', null, `${money(item.price_piasters)} each`)), h('div', { className: 'basket-row__controls' }, h('button', { type: 'button', 'aria-label': `Remove one ${item.name}`, onClick: () => quantity(item.id, -1) }, '−'), h('span', { className: 'num' }, item.quantity), h('button', { type: 'button', 'aria-label': `Add one ${item.name}`, onClick: () => quantity(item.id, 1) }, '+')), h('button', { type: 'button', className: 'basket-remove', onClick: () => persist(items.filter((row) => row.id !== item.id)) }, 'remove')))) : h(React.Fragment, null, h('p', { className: 'empty-state' }, 'Your basket is empty. Visit the store to find available items.'), h('a', { className: 'text-link', href: '/store/backpacks' }, 'browse the store'))), h('aside', null, h('div', { className: 'summary-block' }, h('h2', null, 'Order summary'), h('p', { className: 'summary-line' }, h('span', null, 'items'), h('strong', null, money(total)))), !user && h('p', { className: 'payment-note' }, 'Sign in or create a player account before checkout. ', h('a', { href: '/account' }, 'open your account'), '.'), h('form', { className: 'checkout-form', onSubmit: checkout }, h('h2', null, 'Checkout details'), h('div', { className: 'field' }, h('label', { htmlFor: 'checkout-username' }, 'Minecraft Java username (required)'), h('input', { id: 'checkout-username', name: 'minecraftUsername', autoComplete: 'username', required: true, minLength: 3, maxLength: 16, pattern: '[A-Za-z0-9_]{3,16}', defaultValue: user?.minecraftUsername || '' }), h('p', { className: 'field-hint' }, 'Use the Java username staff should deliver to.')), h('div', { className: 'field' }, h('label', { htmlFor: 'checkout-discord' }, 'Discord contact (optional)'), h('input', { id: 'checkout-discord', name: 'discordContact', maxLength: 80, defaultValue: user?.discordContact || '' }), h('p', { className: 'field-hint' }, 'A staff member will share manual payment instructions through Discord.')), h('button', { className: 'button', type: 'submit', disabled: !user }, 'place order request'), message && h(Notice, { tone: error ? 'error' : 'success' }, message)), h('div', { className: 'payment-note' }, 'Payment is handled manually by PRMD staff through mobile wallets or InstaPay. Instructions are shared through Discord after your order is recorded.')))));
}
function Auth({ admin = false, onSignedIn }) {
  const [mode, setMode] = useState('login'); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (event) => { event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return; const data = new FormData(form); setBusy(true); setMessage(''); try { const payload = admin ? { username: data.get('username'), password: data.get('password') } : { minecraftUsername: data.get('minecraftUsername'), username: data.get('minecraftUsername'), password: data.get('password'), discordContact: data.get('discordContact') }; await api(admin ? '/api/admin/login' : mode === 'register' ? '/api/account/register' : '/api/account/login', { method: 'POST', body: JSON.stringify(payload) }); onSignedIn(); } catch (err) { setMessage(err.message); } finally { setBusy(false); } };
  return h('main', { className: 'page-main utility-page' }, h('div', { className: 'container' }, h(PageIntro, { label: admin ? 'staff only' : 'player account', title: admin ? 'Admin sign in' : 'Keep your place.' }, admin ? 'Staff credentials are checked and authorized on the server.' : 'Create a private account for order history and the points ledger. This site does not verify your Minecraft identity with Mojang or Paper.'), h('div', { className: admin ? '' : 'account-layout' }, h('section', null, !admin && h('h2', null, mode === 'login' ? 'Sign in' : 'Create an account'), h('form', { className: 'auth-form', onSubmit: submit }, h('div', { className: 'field' }, h('label', { htmlFor: 'auth-name' }, admin ? 'Staff username' : 'Minecraft Java username (required)'), h('input', { id: 'auth-name', name: admin ? 'username' : 'minecraftUsername', required: true, autoComplete: 'username', ...(!admin ? { minLength: 3, maxLength: 16, pattern: '[A-Za-z0-9_]{3,16}' } : {}) })), h('div', { className: 'field' }, h('label', { htmlFor: 'auth-pass' }, 'Password (required)'), h('input', { id: 'auth-pass', name: 'password', type: 'password', required: true, minLength: admin || mode === 'login' ? 1 : 12, maxLength: 128, autoComplete: mode === 'register' ? 'new-password' : 'current-password' })), !admin && mode === 'register' && h('div', { className: 'field' }, h('label', { htmlFor: 'auth-discord' }, 'Discord contact (optional)'), h('input', { id: 'auth-discord', name: 'discordContact', maxLength: 80 })), h('button', { className: 'button', type: 'submit', disabled: busy }, busy ? 'checking details' : admin ? 'sign in to admin' : mode === 'register' ? 'create account' : 'sign in'), message && h(Notice, { tone: 'error' }, message)), !admin && h('p', { className: 'account-switch' }, mode === 'login' ? 'Need an account? ' : 'Already have an account? ', h('button', { type: 'button', onClick: () => { setMode(mode === 'login' ? 'register' : 'login'); setMessage(''); } }, mode === 'login' ? 'create one' : 'sign in'))), !admin && h('aside', { className: 'payment-note' }, 'Use a unique password. Your site account is separate from your Minecraft login; never enter your Minecraft password here.'))));
}
function Account({ user, signOut }) {
  const [message, setMessage] = useState(''); const [error, setError] = useState(false);
  return h('main', { className: 'page-main utility-page' }, h('div', { className: 'container' }, h(PageIntro, { label: 'player account', title: user ? `Welcome, ${user.minecraftUsername}.` : 'Keep your place.' }, user ? 'Your account keeps your orders and site points ledger together.' : 'Sign in or create a private account for order history and the points ledger.'), user ? h('div', { className: 'admin-tools' }, h(ButtonLink, { href: '/orders', quiet: true }, 'view order history'), h(ButtonLink, { href: '/points', quiet: true }, 'view points'), h('button', { className: 'button button--quiet', type: 'button', onClick: async () => { try { await api('/api/logout', { method: 'POST', body: '{}' }); signOut(); } catch (err) { setError(true); setMessage(err.message); } } }, 'sign out'), message && h(Notice, { tone: error ? 'error' : 'success' }, message)) : h(ButtonLink, { href: '/account', quiet: true }, 'sign in or create an account')));
}
function Points({ user }) {
  const { data, error, loading } = useLoad('/api/account/points', [user?.id]);
  return h('main', { className: 'page-main utility-page' }, h('div', { className: 'container' }, h(PageIntro, { label: 'player account', title: 'Points' }, user ? 'This is the balance and ledger stored for your site account. It only reflects real server points after staff or a trusted Paper integration records them.' : 'Points are account-specific. The examples below are not a live player balance.'), user ? loading ? h('p', { className: 'empty-state' }, 'Loading account points…') : error ? h(Notice, { tone: 'error' }, error) : h(React.Fragment, null, h('section', { className: 'summary-block' }, h('p', { className: 'section-label' }, 'account balance'), h('h2', { className: 'num' }, `${new Intl.NumberFormat('en-EG').format(data.balance)} points`)), data.ledger.length ? h('div', { className: 'data-table-wrap' }, h('table', { className: 'data-table' }, h('thead', null, h('tr', null, h('th', null, 'change'), h('th', null, 'reason'), h('th', null, 'recorded'))), h('tbody', null, ...data.ledger.map((entry) => h('tr', { key: `${entry.created_at}-${entry.reason}` }, h('td', { className: 'num', 'data-label': 'change' }, `${entry.delta > 0 ? '+' : ''}${entry.delta}`), h('td', { 'data-label': 'reason' }, entry.reason), h('td', { 'data-label': 'recorded' }, dateLabel(entry.created_at))))))) : h('p', { className: 'empty-state' }, 'No point transactions are linked to this account yet.')) : h(React.Fragment, null, h('p', { className: 'demo-tag' }, 'demo examples, not real account data'), h('div', { className: 'summary-block margin-top-xl' }, h('p', { className: 'section-label' }, 'sample balance'), h('h2', null, 'Not connected to an account'), h('p', { className: 'page-deck' }, 'Sign in to see your real balance and staff-entered transaction history.')), h('ul', { className: 'ledger-examples' }, ...['Example earning method: verified community event', 'Example earning method: server activity configured by staff', 'Example redemption: configured store reward'].map((x) => h('li', { key: x }, h('span', null, x), h('span', null, 'amount set by staff')))), h(ButtonLink, { href: '/account', quiet: true }, 'open your account'))));
}
function Orders({ user }) {
  const { data, error, loading } = useLoad('/api/account/orders', [user?.id]);
  return h('main', { className: 'page-main utility-page' }, h('div', { className: 'container' }, h(PageIntro, { label: 'your account', title: 'Order History' }, user ? `Orders for ${user.minecraftUsername}. Payment and delivery status is updated by PRMD staff.` : 'Sign in to see orders attached to your player account.'), !user ? h('p', { className: 'payment-note' }, h('a', { href: '/account' }, 'sign in or create an account'), ' to keep your order history private.') : loading ? h('p', { className: 'empty-state' }, 'Loading your orders…') : error ? h(Notice, { tone: 'error' }, error) : data.orders.length ? h('div', { className: 'order-list' }, ...data.orders.map((order) => h('article', { className: 'order-item', key: order.order_number }, h('div', null, h('h2', null, order.order_number), h('p', null, `${dateLabel(order.created_at)}, ${order.items.map((item) => `${item.product_name} × ${item.quantity}`).join(', ')}`)), h('div', null, h('span', { className: 'status-badge' }, order.status), h('p', null, money(order.total_piasters)))))) : h('p', { className: 'empty-state' }, 'No orders are linked to this account yet.')));
}
function Admin({ user, onSignedIn }) {
  const summary = useLoad('/api/admin/summary', [user?.id, user?.role]);
  const products = useLoad('/api/admin/products', [user?.id, user?.role]);
  const orders = useLoad('/api/admin/orders', [user?.id, user?.role]);
  const accounts = useLoad('/api/admin/accounts', [user?.id, user?.role]);
  const [feedback, setFeedback] = useState('');
  const [isError, setIsError] = useState(false);
  const [edit, setEdit] = useState(null);
  const refresh = () => { summary.reload(); products.reload(); orders.reload(); accounts.reload(); };
  if (!user || user.role !== 'admin') return <Auth admin onSignedIn={onSignedIn} />;
  const busy = summary.loading || products.loading || orders.loading || accounts.loading;
  const error = summary.error || products.error || orders.error || accounts.error;
  if (busy) return <main className="page-main utility-page"><div className="container"><PageIntro label="staff only" title="City admin">Loading staff records…</PageIntro></div></main>;
  if (error) return <main className="page-main utility-page"><div className="container"><PageIntro label="staff only" title="City admin" /><Notice tone="error">{error}</Notice></div></main>;
  const productList = products.data.products;
  const orderList = orders.data.orders;
  const players = accounts.data.accounts;
  const saveProduct = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const body = Object.fromEntries(data.entries());
    try {
      await api(edit ? `/api/admin/products/${edit.id}` : '/api/admin/products', { method: edit ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      setFeedback('Product saved.'); setIsError(false); setEdit(null); form.reset(); refresh();
    } catch (err) { setFeedback(err.message); setIsError(true); }
  };
  const changeStatus = async (number, status) => {
    try { await api(`/api/admin/orders/${encodeURIComponent(number)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); setFeedback('Order status saved.'); setIsError(false); orders.reload(); }
    catch (err) { setFeedback(err.message); setIsError(true); }
  };
  const changePoints = async (event) => {
    event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
    const data = new FormData(form);
    try { await api(`/api/admin/accounts/${data.get('userId')}/points`, { method: 'PATCH', body: JSON.stringify({ delta: Number(data.get('delta')), reason: data.get('reason') }) }); setFeedback('Player points ledger updated.'); setIsError(false); form.reset(); refresh(); }
    catch (err) { setFeedback(err.message); setIsError(true); }
  };
  return <main className="page-main utility-page"><div className="container">
    <header className="page-intro"><p className="section-label">staff only</p><h1 className="page-title">City admin</h1><p className="page-deck">Manage store records and update orders after staff confirm payments or delivery.</p><div className="admin-tools"><span className="status-badge">signed in as {user.minecraftUsername}</span><button className="button button--quiet" type="button" onClick={async () => { await api('/api/logout', { method: 'POST', body: '{}' }); onSignedIn(); }}>sign out</button></div></header>
    <div className="notice">Payments are handled manually through Discord. Mark an order Paid only after a staff member verifies the transfer; mark it Fulfilled after delivery.</div>
    {feedback && <Notice tone={isError ? 'error' : 'success'}>{feedback}</Notice>}
    <div className="admin-shell">
      <section className="admin-section" id="products"><header><div><p className="section-label">store catalogue</p><h2>Products and prices</h2></div><span className="status-badge">{productList.length} records</span></header>
        <form className="admin-form" onSubmit={saveProduct} key={edit?.id || 'new'}>
          <div className="field"><label htmlFor="product-name">Item name (required)</label><input id="product-name" name="name" required maxLength="80" defaultValue={edit?.name || ''} /></div>
          <div className="field"><label htmlFor="product-category">Category</label><select id="product-category" name="category" defaultValue={edit?.category || 'backpacks'}>{CATEGORIES.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select></div>
          <div className="field field--wide"><label htmlFor="product-description">Description (required)</label><textarea id="product-description" name="description" required maxLength="500" defaultValue={edit?.description || ''} /></div>
          <div className="field"><label htmlFor="product-price">Price in EGP</label><input id="product-price" name="price" type="number" min="0" step=".01" required defaultValue={edit ? (edit.price_piasters / 100).toFixed(2) : ''} /></div>
          <div className="field"><label htmlFor="product-image">Original item image path</label><input id="product-image" name="imagePath" required pattern="/assets/items/.+" placeholder="/assets/items/item.webp" defaultValue={edit?.image_path || ''} /><p className="field-hint">Add the supplied file under public/assets/items first.</p></div>
          <div className="field"><label htmlFor="product-published">Visibility</label><select id="product-published" name="published" defaultValue={edit ? String(edit.published) : '0'}><option value="0">Draft</option><option value="1">Published</option></select></div>
          <button className="button" type="submit">{edit ? 'update product' : 'save product'}</button>{edit && <button className="button button--quiet" type="button" onClick={() => setEdit(null)}>cancel edit</button>}
        </form>
        <div className="data-table-wrap"><table className="data-table"><thead><tr>{['item', 'category', 'price', 'visibility', 'action'].map((x) => <th key={x}>{x}</th>)}</tr></thead><tbody>{productList.length ? productList.map((p) => <tr key={p.id}><td data-label="item">{p.name}<br /><code>{p.image_path}</code></td><td data-label="category">{p.category}</td><td data-label="price">{money(p.price_piasters)}</td><td data-label="visibility">{p.published ? 'published' : 'draft'}</td><td data-label="action"><div className="admin-inline"><button type="button" onClick={() => { setEdit(p); document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' }); }}>edit</button><button type="button" onClick={async () => { try { await api(`/api/admin/products/${p.id}`, { method: 'DELETE' }); refresh(); } catch (err) { setFeedback(err.message); setIsError(true); } }}>{p.published ? 'unpublish' : 'remove'}</button></div></td></tr>) : <tr><td colSpan="5">No products yet. Add verified item details and image paths above.</td></tr>}</tbody></table></div>
      </section>
      <section className="admin-section" id="orders"><header><div><p className="section-label">manual fulfilment</p><h2>Orders</h2></div><span className="status-badge">{orderList.length} recent</span></header>
        <div className="data-table-wrap"><table className="data-table"><thead><tr>{['order', 'player', 'items and total', 'status', 'update'].map((x) => <th key={x}>{x}</th>)}</tr></thead><tbody>{orderList.length ? orderList.map((o) => <tr key={o.order_number}><td data-label="order"><code>{o.order_number}</code><br />{dateLabel(o.created_at)}</td><td data-label="player">{o.minecraft_username}{o.discord_contact && <><br />{o.discord_contact}</>}</td><td data-label="items and total">{o.items.map((i) => `${i.product_name} × ${i.quantity}`).join(', ')}<br />{money(o.total_piasters)}</td><td data-label="status">{o.status}</td><td data-label="update"><label className="visually-hidden" htmlFor={`status-${o.id}`}>Status for {o.order_number}</label><select id={`status-${o.id}`} defaultValue={o.status} onChange={(e) => changeStatus(o.order_number, e.target.value)}>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select></td></tr>) : <tr><td colSpan="5">No orders have been placed.</td></tr>}</tbody></table></div>
      </section>
      <section className="admin-section" id="points"><header><div><p className="section-label">account ledger</p><h2>Player points</h2></div><span className="status-badge">{players.length} accounts</span></header>
        <form className="admin-form" onSubmit={changePoints}><div className="field"><label htmlFor="points-player">Player account</label><select id="points-player" name="userId" required>{players.length ? players.map((p) => <option key={p.id} value={p.id}>{p.minecraft_username}: {p.points_balance} points</option>) : <option value="">No player accounts yet</option>}</select></div><div className="field"><label htmlFor="points-delta">Point change (positive adds)</label><input id="points-delta" name="delta" type="number" step="1" required /></div><div className="field field--wide"><label htmlFor="points-reason">Reason for the ledger</label><input id="points-reason" name="reason" minLength="3" maxLength="160" required /></div><button className="button" type="submit" disabled={!players.length}>record point change</button></form>
        <p className="field-hint">Every change is attached to the signed-in staff account and remains in the player ledger.</p>
      </section>
    </div>
  </div></main>;
}
const LEVELS = [
  { name: 'Dune path', end: 1880, speed: 4.1, traps: [340, 555, 785, 1040, 1280, 1515], loot: [470, 905, 1390], sky: ['#283444', '#b87647', '#e2a45e'] },
  { name: 'Sunken court', end: 2180, speed: 4.4, traps: [310, 500, 710, 880, 1080, 1270, 1490, 1740], loot: [425, 960, 1570], sky: ['#283b47', '#a96c53', '#d89461'] },
  { name: 'Horus summit', end: 2480, speed: 4.7, traps: [300, 475, 650, 825, 1010, 1190, 1375, 1555, 1750, 1960], loot: [405, 1080, 1810], sky: ['#263047', '#95634d', '#d1a063'] },
];
function Arcade() {
  const canvasRef = useRef(null); const input = useRef(new Set()); const frame = useRef(0);
  const [saved, setSaved] = useState(() => { try { const value = JSON.parse(localStorage.getItem('prmd-pyramid-run-progress-v1') || '{"unlocked":1,"best":{}}'); const oldBest = Number(localStorage.getItem('prmd-pyramid-run-best-v1')) || 0; const bestMap = value.best && typeof value.best === 'object' ? value.best : {}; if (!bestMap[1] && oldBest) bestMap[1] = oldBest; return { unlocked: Math.max(1, Math.min(3, Number(value.unlocked) || 1)), best: bestMap }; } catch { return { unlocked: 1, best: {} }; } });
  const [level, setLevel] = useState(0); const [game, setGame] = useState(null); const [notice, setNotice] = useState(''); const [gameScore, setGameScore] = useState(0);
  const stage = LEVELS[level]; const best = Number(saved.best?.[level + 1]) || 0;
  const start = () => { input.current.clear(); setNotice(''); setGameScore(0); setGame({ x: 65, y: 312, vy: 0, found: [], started: performance.now(), running: true }); canvasRef.current?.focus(); };
  const finish = (won) => { setGame((old) => old ? { ...old, running: false, won, seconds: (performance.now() - old.started) / 1000 } : old); };
  useEffect(() => {
    if (!game?.running) return undefined;
    const canvas = canvasRef.current; const ctx = canvas.getContext('2d'); const floor = 350; let last = performance.now(); let raf;
    const paint = (now) => {
      const dt = Math.min((now - last) / 16.67, 2.2); last = now; frame.current += 1;
      const state = gameRef.current; const direction = Number(input.current.has('right') || input.current.has('d')) - Number(input.current.has('left') || input.current.has('a'));
      state.x = Math.max(0, Math.min(stage.end - 60, state.x + direction * stage.speed * dt));
      if (input.current.has('jump') && state.grounded) { state.vy = -11.2; state.grounded = false; }
      state.vy += .62 * dt; state.y += state.vy * dt;
      if (state.y + 38 >= floor) { state.y = floor - 38; state.vy = 0; state.grounded = true; }
      const camera = Math.max(0, Math.min(stage.end - 880, state.x - 260));
      const box = (x, y, w, hh, color) => { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), w, hh); };
      const sky = ctx.createLinearGradient(0, 0, 0, 420); sky.addColorStop(0, stage.sky[0]); sky.addColorStop(.68, stage.sky[1]); sky.addColorStop(1, stage.sky[2]); ctx.fillStyle = sky; ctx.fillRect(0, 0, 960, 420);
      const sunX = 765 - camera * .09; const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      ctx.save(); ctx.translate(sunX, 90); ctx.rotate(reduced ? 0 : frame.current * .00028); ctx.strokeStyle = 'rgba(255,222,164,.45)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 55, 0, Math.PI * 2); ctx.stroke(); for (let ray = 0; ray < 12; ray += 1) { ctx.rotate(Math.PI / 6); ctx.fillStyle = ray % 2 ? '#f1c477' : '#d7985e'; ctx.fillRect(-2, -78, 4, 11); } ctx.restore(); ctx.fillStyle = '#f1c477'; ctx.beginPath(); ctx.arc(sunX, 90, 36, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 8; i += 1) box((i * 170 - camera * .22) % 1140, 245 + (i % 3) * 12, 130, 120, i % 2 ? '#8e6049' : '#9c6949');
      const px = stage.end - 160 - camera * .82; ctx.fillStyle = '#8f674f'; ctx.beginPath(); ctx.moveTo(px - 255, floor); ctx.lineTo(px, 86); ctx.lineTo(px + 255, floor); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#c38c5d'; ctx.beginPath(); ctx.moveTo(px, 86); ctx.lineTo(px + 255, floor); ctx.lineTo(px, floor); ctx.closePath(); ctx.fill();
      for (let i = 0; i < 5; i += 1) box(px - ((145 + i * 39 - 86) * 1.82) / 2, 145 + i * 39, (145 + i * 39 - 86) * 1.82, 4, '#684c40');
      box(0, floor, 960, 70, '#b67b49'); box(0, floor, 960, 8, '#ddaa68');
      for (let i = 0; i < 34; i += 1) box((i * 89 - camera * .7) % 960, floor + 20 + (i * 17) % 55, 3, 3, '#d29458');
      stage.traps.forEach((worldX, i) => { const x = worldX - camera; if (x < -40 || x > 990) return; box(x + 8, floor - (i % 2 ? 26 : 32), 8, i % 2 ? 26 : 32, '#356f55'); box(x, floor - (i % 2 ? 20 : 23), 24, 9, '#478562'); box(x + 2, floor - 22, 6, 5, '#478562'); box(x + 18, floor - 30, 6, 6, '#478562'); });
      stage.loot.forEach((worldX, i) => { if (state.found.includes(i)) return; const x = worldX - camera, y = floor - 30 + Math.sin(frame.current / 10 + i) * 4; ctx.fillStyle = '#f2c565'; ctx.beginPath(); ctx.ellipse(x, y, 12, 8, 0, 0, Math.PI * 2); ctx.fill(); box(x - 3, y - 10, 6, 19, '#5b392f'); box(x - 12, y - 2, 24, 4, '#5b392f'); });
      const sx = state.x - camera; box(sx + 4, state.y, 19, 13, '#dab765'); box(sx + 2, state.y + 11, 23, 15, '#2b5652'); box(sx + 1, state.y + 26, 9, 12, '#443936'); box(sx + 17, state.y + 26, 9, 12, '#443936'); box(sx + 16, state.y + 5, 3, 3, '#211c1a'); box(sx, state.y + 12, 4, 8, '#f0c85f');
      box(stage.end - 147 - camera, floor - 34, 30, 34, '#3c2d2a'); box(stage.end - 140 - camera, floor - 26, 16, 26, '#f0b857');
      if (stage.traps.some((x) => Math.abs(state.x + 13.5 - (x + 12)) < 22 && state.y + 38 > floor - 28)) { finish(false); return; }
      stage.loot.forEach((x, i) => { if (!state.found.includes(i) && Math.abs(state.x + 13.5 - x) < 30) { state.found.push(i); setGameScore(state.found.length); } });
      if (state.found.length === 3 && state.x > stage.end - 240) { finish(true); return; }
      raf = requestAnimationFrame(paint);
    };
    const gameRefCleanup = () => cancelAnimationFrame(raf);
    const first = gameRef.current; if (first) { Object.assign(first, game); }
    raf = requestAnimationFrame(paint);
    return gameRefCleanup;
  }, [game?.running, level]);
  const gameRef = useRef(null);
  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => { if (!game || game.running || !game.won) return; const nextBest = !best || game.seconds < best ? game.seconds : best; const next = { unlocked: Math.max(saved.unlocked, Math.min(3, level + 2)), best: { ...saved.best, [level + 1]: nextBest } }; setSaved(next); try { localStorage.setItem('prmd-pyramid-run-progress-v1', JSON.stringify(next)); } catch {} }, [game?.running, game?.won]);
  useEffect(() => { const down = (e) => { const key = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'jump', ' ': 'jump', a: 'a', A: 'a', d: 'd', D: 'd' })[e.key]; if (key && document.activeElement === canvasRef.current) { e.preventDefault(); input.current.add(key); } }; const up = (e) => { const key = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'jump', ' ': 'jump', a: 'a', A: 'a', d: 'd', D: 'd' })[e.key]; if (key) input.current.delete(key); }; window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', () => input.current.clear()); return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); }; }, []);
  useEffect(() => { if (!game?.running) { const canvas = canvasRef.current; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#382d2a'; ctx.fillRect(0, 0, 960, 420); ctx.fillStyle = '#bd8e60'; ctx.font = '28px Georgia'; ctx.textAlign = 'center'; ctx.fillText(`Level ${level + 1} · ${stage.name}`, 480, 210); } }, [game?.running, level]);
  const controls = ['left', 'right', 'jump']; const bestText = best ? `${best.toFixed(1)}s` : '—';
  const clickStart = () => { if (game?.won && level < LEVELS.length - 1 && notice === 'next') setLevel((n) => n + 1); start(); };
  const selectLevel = (index) => { setLevel(index); setGame(null); setNotice(''); setGameScore(0); };
  const won = game && !game.running && game.won; const lost = game && !game.running && !game.won;
  return h('section', { className: 'pyramid-arcade', 'aria-label': 'Pyramid Run mini-game' }, h('div', { className: 'arcade-topline' }, h('span', { className: 'arcade-level' }, `Level ${level + 1} · ${stage.name}`), h('span', { className: 'arcade-score', 'aria-live': 'polite' }, `${gameScore} / 3 scarabs`)), h('nav', { className: 'arcade-levels', 'aria-label': 'Choose an unlocked level' }, ...LEVELS.map((item, i) => h('button', { type: 'button', key: item.name, className: 'arcade-level-button', disabled: i + 1 > saved.unlocked || game?.running, 'aria-pressed': i === level, onClick: () => selectLevel(i) }, `${i + 1}. ${item.name}`))), h('div', { className: 'arcade-screen' }, h('canvas', { className: 'arcade-canvas', ref: canvasRef, width: 960, height: 420, tabIndex: 0, role: 'img', 'aria-label': 'Pyramid Run. Use arrows or A and D to run, and Space or Up to jump.' }), !game?.running && h('div', { className: 'arcade-overlay' }, h('p', { className: 'arcade-overlay__title' }, won ? (level === 2 ? 'The pyramid is yours.' : `Level ${level + 1} cleared!`) : lost ? 'The sandstorm caught you.' : 'Ready, adventurer?'), h('p', { className: 'arcade-overlay__copy' }, won ? `Three scarabs recovered in ${game.seconds.toFixed(1)} seconds.${game.seconds <= best ? ' New personal best!' : ''}` : lost ? 'The scarabs are still there. Take another run.' : 'Find three scarabs, dodge the traps, reach the pyramid.'), h('button', { className: 'button', type: 'button', onClick: () => { if (won && level < 2) { setLevel((n) => n + 1); setGame(null); window.setTimeout(start, 0); } else start(); } }, won && level < 2 ? `next: ${LEVELS[level + 1].name}` : lost ? 'try again' : 'start the run'))), h('div', { className: 'arcade-console' }, h('div', { className: 'arcade-controls', 'aria-label': 'Game controls' }, ...controls.map((key) => h('button', { type: 'button', key, 'data-game-key': key, 'aria-label': key === 'jump' ? 'Jump' : `Run ${key}`, onPointerDown: (e) => { e.preventDefault(); input.current.add(key); }, onPointerUp: () => input.current.delete(key), onPointerLeave: () => input.current.delete(key), onPointerCancel: () => input.current.delete(key) }, key === 'left' ? '←' : key === 'right' ? '→' : 'jump'))), h('div', { className: 'arcade-readout' }, h('p', null, game?.running ? 'Run right, jump the traps, gather scarabs, and find the gate.' : 'Use the arrows, A and D, or the touch controls.'), h('p', { className: 'arcade-best' }, 'Personal best ', h('strong', null, bestText)))), h('p', { className: 'arcade-note' }, 'Browser game for fun. Level access and best times are saved on this device; no points or server items are awarded.'));
}

function DailyVault() {
  const [stats, setStats] = useState(() => { try { return JSON.parse(localStorage.getItem('prmd-scarab-vault-v1') || '{"relics":0,"streak":0,"lastClear":"","bestMoves":0}'); } catch { return { relics: 0, streak: 0, lastClear: '', bestMoves: 0 }; } });
  const [deck, setDeck] = useState([]); const [open, setOpen] = useState([]); const [matched, setMatched] = useState([]); const [moves, setMoves] = useState(0); const [message, setMessage] = useState('Ready when you are.'); const [seconds, setSeconds] = useState(0);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(clock));
  const cleared = stats.lastClear === today;
  useEffect(() => { setDeck([]); setOpen([]); setMatched([]); setMoves(0); setMessage('Ready when you are.'); }, [today]);
  const begin = () => { const symbols = ['𓂀', '𓆣', '𓃭', '𓅃', '𓇳', '𓋴', '𓊖', '𓏏']; let seed = 2166136261; for (const ch of `prmd-scarab-vault-${today}`) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0; const random = () => { seed = (seed + 0x6D2B79F5) >>> 0; let x = seed; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; const shuffled = [...symbols, ...symbols]; for (let i = shuffled.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; } setDeck(shuffled); setOpen([]); setMatched([]); setMoves(0); setSeconds(0); setMessage('The chamber is open. Find all eight matching pairs.'); };
  useEffect(() => { if (!deck.length || matched.length === 8) return undefined; const timer = window.setInterval(() => setSeconds((n) => n + 1), 1000); return () => clearInterval(timer); }, [deck.length, matched.length]);
  const pick = (i) => { if (open.includes(i) || matched.includes(i) || open.length === 2) return; const next = [...open, i]; setOpen(next); if (next.length === 2) { setMoves((n) => n + 1); if (deck[next[0]] === deck[next[1]]) { const pairs = [...matched, next[0], next[1]]; setMatched(pairs); setOpen([]); setMessage(`${pairs.length / 2} of 8 pairs found.`); if (pairs.length === 16) { const nextStats = { ...stats, relics: (stats.relics || 0) + 1, streak: (stats.streak || 0) + 1, lastClear: today, bestMoves: stats.bestMoves ? Math.min(stats.bestMoves, moves + 1) : moves + 1 }; setStats(nextStats); try { localStorage.setItem('prmd-scarab-vault-v1', JSON.stringify(nextStats)); } catch {} setMessage(`Vault opened in ${moves + 1} turns. Your relic is saved in this browser.`); } } else { setMessage('No match. Remember the stones and try another pair.'); setTimeout(() => setOpen([]), matchMedia('(prefers-reduced-motion: reduce)').matches ? 120 : 700); } } };
  const remaining = (() => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(clock)).reduce((a, v) => (a[v.type] = Number(v.value), a), {}); const n = 86400 - p.hour * 3600 - p.minute * 60 - p.second; return `${String(Math.floor(n / 3600)).padStart(2, '0')}:${String(Math.floor(n % 3600 / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; })();
  return h('section', { className: 'daily-chamber' }, h('div', { className: 'chamber-intro' }, h('div', null, h('p', { className: 'chamber-date' }, `${new Intl.DateTimeFormat('en-EG', { timeZone: 'Africa/Cairo', dateStyle: 'full' }).format(new Date())} · daily board`), h('h3', null, 'Eight pairs. One hidden vault.'), h('p', { className: 'chamber-description' }, 'Clear the chamber to add a relic to your browser collection. A new board arrives at Cairo midnight.')), !deck.length && h('button', { className: 'button chamber-start', type: 'button', disabled: cleared, onClick: begin }, cleared ? 'relic claimed' : 'enter today’s chamber')), h('div', { className: 'chamber-play' }, deck.length > 0 && h('div', { className: 'chamber-grid', role: 'group', 'aria-label': 'Daily Scarab Vault memory board' }, ...deck.map((symbol, i) => h('button', { className: `chamber-tile${open.includes(i) || matched.includes(i) ? ' is-revealed' : ''}${matched.includes(i) ? ' is-matched' : ''}`, type: 'button', key: i, disabled: matched.includes(i), 'aria-pressed': open.includes(i) || matched.includes(i), 'aria-label': `Stone tile ${i + 1} of 16${open.includes(i) || matched.includes(i) ? `, glyph ${symbol}` : ', hidden. Reveal glyph.'}`, onClick: () => pick(i) }, h('span', { className: 'chamber-tile__glyph', 'aria-hidden': true }, open.includes(i) || matched.includes(i) ? symbol : '𓂀')))), h('div', { className: 'chamber-sidebar' }, h('div', { className: 'chamber-stats' }, h('div', null, h('span', null, 'turns'), h('strong', null, moves)), h('div', null, h('span', null, 'time'), h('strong', null, `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`)), h('div', null, h('span', null, 'best'), h('strong', null, stats.bestMoves || '—'))), h('p', { className: 'chamber-message', 'aria-live': 'polite' }, message), h('div', { className: 'chamber-collection' }, h('span', { className: 'chamber-relic', 'aria-hidden': true }, '𓆣'), h('p', null, h('strong', null, `${stats.relics || 0} relics`), h('br'), `${stats.streak || 0} day streak`)), h('p', { className: 'chamber-note' }, 'Browser collection only. Relics do not add account points or in-game items.'))), h('p', { className: 'chamber-reset' }, 'Next chamber in ', h('span', null, remaining)));
}

function App() {
  const root = document.getElementById('root'); const path = root.dataset.path || '/';
  const [site, setSite] = useState(null); const [products, setProducts] = useState([]); const [loadError, setLoadError] = useState(''); const [basketCount, setBasketCount] = useState(() => { try { return JSON.parse(localStorage.getItem('prmd-city-basket-v1') || '[]').reduce((sum, item) => sum + item.quantity, 0); } catch { return 0; } });
  const refresh = useCallback(async () => { try { const [config, catalogue] = await Promise.all([api('/api/site'), api('/api/products')]); setSite(config); setProducts(catalogue.products); setLoadError(''); } catch (error) { setLoadError(error.message); } }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { const names = new Map([['/', 'Home'], ...CATEGORIES.map((item) => [item.path, item.label]), ['/live-map', 'Live Map'], ['/basket', 'Shopping Basket'], ['/points', 'Points'], ['/orders', 'Order History'], ['/account', 'Player Account'], ['/admin', 'Staff Admin']]); document.title = `${names.get(path) || 'PRMD City'} — PRMD City`; }, [path]);
  const add = (product) => { let basket; try { basket = JSON.parse(localStorage.getItem('prmd-city-basket-v1') || '[]'); } catch { basket = []; } const row = basket.find((item) => item.id === product.id); if (row) row.quantity = Math.min(20, row.quantity + 1); else basket.push({ id: product.id, quantity: 1, name: product.name, price_piasters: product.price_piasters }); try { localStorage.setItem('prmd-city-basket-v1', JSON.stringify(basket)); } catch { setLoadError('Your browser could not save the basket.'); return; } setBasketCount(basket.reduce((sum, item) => sum + item.quantity, 0)); setLoadError('Added to your basket.'); window.setTimeout(() => setLoadError(''), 1800); };
  const user = site?.user;
  let page;
  if (path === '/') page = h(Home, { products, add, mapUrl: site?.mapUrl });
  else if (CATEGORIES.some((item) => item.path === path)) page = h(Store, { path, products, add });
  else if (path === '/live-map') page = h(MapPage, { mapUrl: site?.mapUrl });
  else if (path === '/basket') page = h(Basket, { user, addMessage: setBasketCount });
  else if (path === '/account') page = user ? h(Account, { user, signOut: refresh }) : h(Auth, { onSignedIn: refresh });
  else if (path === '/points') page = h(Points, { user });
  else if (path === '/orders') page = h(Orders, { user });
  else if (path === '/admin') page = h(Admin, { user, onSignedIn: refresh });
  else page = h('main', { className: 'page-main utility-page' }, h('div', { className: 'container' }, h(PageIntro, { title: 'Page not found' }, 'That path does not lead to a PRMD City page.'), h(ButtonLink, { href: '/', quiet: true }, 'return home')));
  return h(React.Fragment, null, h(Header, { path, user, basketCount }), loadError && h('p', { className: 'sr-live', role: 'status' }, loadError), page, h(Footer, { discord: site?.discordUrl || DISCORD }));
}

createRoot(document.getElementById('root')).render(h(React.StrictMode, null, h(App)));

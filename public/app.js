const BASKET_KEY = 'prmd-city-basket-v1';

function readBasket() {
  try {
    const value = JSON.parse(localStorage.getItem(BASKET_KEY) || '[]');
    return Array.isArray(value) ? value.filter((row) => Number.isInteger(row.id) && Number.isInteger(row.quantity) && row.quantity > 0) : [];
  } catch { return []; }
}

function writeBasket(items) {
  try { localStorage.setItem(BASKET_KEY, JSON.stringify(items)); } catch { /* The order form remains available if local storage is disabled. */ }
}

function egp(piasters) {
  return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(piasters / 100);
}

function setMessage(node, message, tone = '') {
  if (!node) return;
  node.textContent = message;
  node.dataset.tone = tone;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'That request did not go through. Try again.');
  return data;
}

function updateBasketCount() {
  const count = readBasket().reduce((sum, item) => sum + item.quantity, 0);
  document.querySelectorAll('[data-basket-count]').forEach((node) => { node.textContent = String(count); });
}

function initPyramidGame() {
  const root = document.querySelector('[data-pyramid-game]');
  if (!root) return;
  const canvas = root.querySelector('[data-game-canvas]');
  const ctx = canvas.getContext('2d');
  const overlay = root.querySelector('[data-game-overlay]');
  const title = root.querySelector('[data-game-title]');
  const copy = root.querySelector('[data-game-copy]');
  const start = root.querySelector('[data-game-start]');
  const levelsNode = root.querySelector('[data-game-levels]');
  const levelLabel = root.querySelector('[data-game-level-label]');
  const status = root.querySelector('[data-game-status]');
  const score = root.querySelector('[data-game-scarabs]');
  const bestNode = root.querySelector('[data-game-best]');
  const levels = [
    { name: 'Dune path', end: 1880, speed: 4.1, traps: [340, 555, 785, 1040, 1280, 1515], treasures: [470, 905, 1390], sky: ['#283444', '#b87647', '#e2a45e'] },
    { name: 'Sunken court', end: 2180, speed: 4.4, traps: [310, 500, 710, 880, 1080, 1270, 1490, 1740], treasures: [425, 960, 1570], sky: ['#283b47', '#a96c53', '#d89461'] },
    { name: 'Horus summit', end: 2480, speed: 4.7, traps: [300, 475, 650, 825, 1010, 1190, 1375, 1555, 1750, 1960], treasures: [405, 1080, 1810], sky: ['#263047', '#95634d', '#d1a063'] },
  ];
  const progressKey = 'prmd-pyramid-run-progress-v1';
  let progress = { unlocked: 1, best: {} };
  try { const saved = JSON.parse(localStorage.getItem(progressKey) || '{}'); progress = { unlocked: Math.max(1, Math.min(3, Number(saved.unlocked) || 1)), best: saved.best && typeof saved.best === 'object' ? saved.best : {} }; } catch { /* Levels are replayable for this visit if storage is unavailable. */ }
  let levelIndex = 0, pendingNext = false;
  const width = canvas.width, height = canvas.height, floor = 350;
  const currentLevel = () => levels[levelIndex];
  const saveProgress = () => { try { localStorage.setItem(progressKey, JSON.stringify(progress)); } catch { /* Progress remains available for this visit. */ } };
  const renderLevels = () => {
    levelsNode.replaceChildren(...levels.map((level, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'arcade-level-button'; button.textContent = `${index + 1}. ${level.name}`; button.disabled = index + 1 > progress.unlocked || running; button.setAttribute('aria-pressed', String(index === levelIndex));
      if (index + 1 > progress.unlocked) button.setAttribute('aria-label', `Level ${index + 1}, ${level.name}, locked. Complete the previous level to unlock.`);
      button.addEventListener('click', () => { if (running) return; levelIndex = index; pendingNext = false; reset(); overlay.hidden = false; title.textContent = `Level ${index + 1}: ${level.name}`; copy.textContent = 'Collect all three scarabs and find the pyramid gate.'; start.textContent = 'start this level'; renderLevels(); draw(); });
      return button;
    }));
    levelLabel.textContent = `Level ${levelIndex + 1} · ${currentLevel().name}`;
    bestNode.textContent = progress.best[levelIndex + 1] ? `${Number(progress.best[levelIndex + 1]).toFixed(1)}s` : '—';
  };
  const held = new Set();
  let player, found, camera, running = false, last = 0, started = 0, frame = 0;
  const reset = () => { player = { x: 65, y: floor - 40, vy: 0, w: 27, h: 38, grounded: true }; found = new Set(); camera = 0; score.textContent = '0'; };
  const box = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
  const draw = () => {
    const stage = currentLevel();
    const sky = ctx.createLinearGradient(0, 0, 0, height); sky.addColorStop(0, stage.sky[0]); sky.addColorStop(0.68, stage.sky[1]); sky.addColorStop(1, stage.sky[2]); ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
    const sunX = 765 - camera * 0.09;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ctx.save(); ctx.translate(sunX, 90); ctx.rotate(reducedMotion ? 0 : frame * 0.00028); ctx.strokeStyle = 'rgba(255, 222, 164, 0.45)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 55, 0, Math.PI * 2); ctx.stroke();
    for (let ray = 0; ray < 12; ray += 1) { ctx.rotate(Math.PI / 6); ctx.fillStyle = ray % 2 ? '#f1c477' : '#d7985e'; ctx.fillRect(-2, -78, 4, 11); }
    ctx.restore(); ctx.fillStyle = '#f1c477'; ctx.beginPath(); ctx.arc(sunX, 90, 36, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 8; i += 1) { const x = (i * 170 - camera * 0.22) % (width + 180); box(x, 245 + (i % 3) * 12, 130, 120, i % 2 ? '#8e6049' : '#9c6949'); }
    const py = 86, px = stage.end - 160 - camera * 0.82;
    ctx.fillStyle = '#8f674f'; ctx.beginPath(); ctx.moveTo(px - 255, floor); ctx.lineTo(px, py); ctx.lineTo(px + 255, floor); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c38c5d'; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + 255, floor); ctx.lineTo(px, floor); ctx.closePath(); ctx.fill();
    for (let i = 0; i < 5; i += 1) { const y = 145 + i * 39, span = (y - py) * 1.82; box(px - span / 2, y, span, 4, '#684c40'); }
    box(0, floor, width, height - floor, '#b67b49');
    box(0, floor, width, 8, '#ddaa68');
    for (let i = 0; i < 34; i += 1) { const x = (i * 89 - camera * 0.7) % width; box(x, floor + 20 + (i * 17) % 55, 3, 3, '#d29458'); }
    stage.traps.forEach((worldX, i) => { const x = worldX - camera; if (x < -40 || x > width + 30) return; box(x + 8, floor - (i % 2 ? 26 : 32), 8, i % 2 ? 26 : 32, '#356f55'); box(x, floor - (i % 2 ? 20 : 23), 24, 9, '#478562'); box(x + 2, floor - (i % 2 ? 22 : 25), 6, 5, '#478562'); box(x + 18, floor - (i % 2 ? 27 : 33), 6, 6, '#478562'); });
    stage.treasures.forEach((worldX, i) => { if (found.has(i)) return; const x = worldX - camera, y = floor - 30 + Math.sin(frame / 10 + i) * 4; ctx.fillStyle = '#f2c565'; ctx.beginPath(); ctx.ellipse(x, y, 12, 8, 0, 0, Math.PI * 2); ctx.fill(); box(x - 3, y - 10, 6, 19, '#5b392f'); box(x - 12, y - 2, 24, 4, '#5b392f'); });
    const sx = player.x - camera, sy = player.y;
    box(sx + 4, sy, 19, 13, '#dab765'); box(sx + 2, sy + 11, 23, 15, '#2b5652'); box(sx + 1, sy + 26, 9, 12, '#443936'); box(sx + 17, sy + 26, 9, 12, '#443936'); box(sx + 16, sy + 5, 3, 3, '#211c1a'); box(sx, sy + 12, 4, 8, '#f0c85f');
    box(stage.end - 147 - camera, floor - 34, 30, 34, '#3c2d2a'); box(stage.end - 140 - camera, floor - 26, 16, 26, '#f0b857');
  };
  const end = (won) => {
    running = false;
    const seconds = (Date.now() - started) / 1000;
    overlay.hidden = false;
    if (won) {
      title.textContent = levelIndex === levels.length - 1 ? 'The pyramid is yours.' : `Level ${levelIndex + 1} cleared!`;
      copy.textContent = `Three scarabs recovered in ${seconds.toFixed(1)} seconds.`;
      const levelNumber = levelIndex + 1;
      pendingNext = levelIndex < levels.length - 1;
      const oldBest = Number(progress.best[levelNumber]) || 0;
      if (!oldBest || seconds < oldBest) { progress.best[levelNumber] = seconds; copy.textContent += ' New personal best!'; }
      progress.unlocked = Math.max(progress.unlocked, Math.min(levels.length, levelNumber + 1)); saveProgress(); renderLevels();
      status.textContent = `Level ${levelNumber} complete in ${seconds.toFixed(1)} seconds. Your scarabs are browser keepsakes.`;
      start.textContent = levelIndex < levels.length - 1 ? `next: ${levels[levelIndex + 1].name}` : 'run it again';
    } else { pendingNext = false; title.textContent = 'The sandstorm caught you.'; copy.textContent = 'The scarabs are still there. Take another run.'; status.textContent = 'Run ended. Start again whenever you are ready.'; start.textContent = 'try again'; }
    start.focus();
  };
  const tick = (now) => {
    if (!running) return;
    const dt = Math.min((now - last) / 16.67, 2.2); last = now; frame += 1;
    const direction = Number(held.has('right') || held.has('d')) - Number(held.has('left') || held.has('a'));
    const stage = currentLevel();
    player.x = Math.max(0, Math.min(stage.end - 60, player.x + direction * stage.speed * dt));
    if (held.has('jump') && player.grounded) { player.vy = -11.2; player.grounded = false; }
    player.vy += 0.62 * dt; player.y += player.vy * dt;
    if (player.y + player.h >= floor) { player.y = floor - player.h; player.vy = 0; player.grounded = true; }
    const hit = stage.traps.some((x) => Math.abs((player.x + player.w / 2) - (x + 12)) < 22 && player.y + player.h > floor - 28);
    if (hit) { end(false); draw(); return; }
    stage.treasures.forEach((x, i) => { if (!found.has(i) && Math.abs(player.x + player.w / 2 - x) < 30) { found.add(i); score.textContent = String(found.size); status.textContent = `Scarab ${found.size} of 3 recovered.`; } });
    camera = Math.max(0, Math.min(stage.end - width + 80, player.x - 260));
    draw();
    if (found.size === stage.treasures.length && player.x > stage.end - 240) { end(true); draw(); return; }
    frame = frame % 12000; requestAnimationFrame(tick);
  };
  const begin = () => { if (pendingNext) levelIndex += 1; pendingNext = false; reset(); held.clear(); overlay.hidden = true; running = true; started = Date.now(); last = performance.now(); renderLevels(); status.textContent = 'Run right, jump over the green traps, and gather the floating scarabs.'; canvas.focus(); requestAnimationFrame(tick); };
  const keyName = (key) => ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'jump', ' ': 'jump', a: 'a', A: 'a', d: 'd', D: 'd' })[key];
  canvas.addEventListener('keydown', (event) => { const value = keyName(event.key); if (value) { event.preventDefault(); held.add(value); } });
  canvas.addEventListener('keyup', (event) => { const value = keyName(event.key); if (value) held.delete(value); });
  window.addEventListener('blur', () => held.clear());
  root.querySelectorAll('[data-game-key]').forEach((button) => {
    const key = button.dataset.gameKey;
    const down = (event) => { event.preventDefault(); button.setPointerCapture?.(event.pointerId); held.add(key); };
    const up = () => held.delete(key);
    button.addEventListener('pointerdown', down); button.addEventListener('pointerup', up); button.addEventListener('pointercancel', up); button.addEventListener('lostpointercapture', up); button.addEventListener('keydown', (event) => { if (event.key === ' ' || event.key.startsWith('Arrow')) { event.preventDefault(); held.add(key); } }); button.addEventListener('keyup', up); button.addEventListener('blur', up);
  });
  start.addEventListener('click', begin);
  reset(); renderLevels(); draw();
}

function initDailyChamber() {
  const root = document.querySelector('[data-daily-chamber]');
  if (!root) return;
  const grid = root.querySelector('[data-chamber-grid]');
  const startButton = root.querySelector('[data-chamber-start]');
  const message = root.querySelector('[data-chamber-message]');
  const movesNode = root.querySelector('[data-chamber-moves]');
  const timeNode = root.querySelector('[data-chamber-time]');
  const bestNode = root.querySelector('[data-chamber-best]');
  const relicsNode = root.querySelector('[data-chamber-relics]');
  const streakNode = root.querySelector('[data-chamber-streak]');
  const countdownNode = root.querySelector('[data-chamber-countdown]');
  const dateNode = root.querySelector('[data-chamber-date]');
  const storageKey = 'prmd-scarab-vault-v1';
  const glyphs = ['𓂀', '𓆣', '𓃭', '𓅃', '𓇳', '𓋴', '𓊖', '𓏏'];
  const parts = (date = new Date()) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
  const dayKey = (value) => `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
  const todayParts = parts();
  const today = dayKey(todayParts);
  const previousDay = (key) => { const [year, month, day] = key.split('-').map(Number); return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10); };
  const readState = () => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return { relics: Number.isSafeInteger(value.relics) ? Math.max(0, value.relics) : 0, streak: Number.isSafeInteger(value.streak) ? Math.max(0, value.streak) : 0, lastClear: /^\d{4}-\d{2}-\d{2}$/.test(value.lastClear || '') ? value.lastClear : '', bestMoves: Number.isSafeInteger(value.bestMoves) ? value.bestMoves : 0 };
    } catch { return { relics: 0, streak: 0, lastClear: '', bestMoves: 0 }; }
  };
  let state = readState();
  let moves = 0;
  let matches = 0;
  let first = null;
  let locked = false;
  let startedAt = 0;
  let timer = 0;
  const setMessageText = (text) => { message.textContent = text; };
  const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const renderStats = () => {
    movesNode.textContent = String(moves);
    bestNode.textContent = state.bestMoves ? String(state.bestMoves) : '—';
    relicsNode.textContent = String(state.relics);
    if (!state.streak) streakNode.textContent = 'Start a streak today.';
    else if (state.lastClear === today) streakNode.textContent = `${state.streak} day${state.streak === 1 ? '' : 's'} in a row. Come back tomorrow.`;
    else if (state.lastClear === previousDay(today)) streakNode.textContent = `${state.streak} day${state.streak === 1 ? '' : 's'} in a row. Play today to extend it.`;
    else streakNode.textContent = `Last streak: ${state.streak} day${state.streak === 1 ? '' : 's'}. Begin again today.`;
  };
  const renderCountdown = () => {
    const now = parts();
    const milliseconds = ((23 - now.hour) * 3600 + (59 - now.minute) * 60 + (60 - now.second)) * 1000;
    const total = Math.ceil(milliseconds / 1000);
    countdownNode.textContent = `${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };
  const randomForDay = () => {
    let seed = 2166136261;
    for (const character of `prmd-scarab-vault-${today}`) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
    return () => {
      seed = (seed + 0x6D2B79F5) >>> 0;
      let value = seed;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  };
  const saveState = () => { try { localStorage.setItem(storageKey, JSON.stringify(state)); return true; } catch { return false; } };
  const finish = () => {
    window.clearInterval(timer);
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    state.streak = state.lastClear === previousDay(today) ? state.streak + 1 : 1;
    state.lastClear = today;
    state.relics += 1;
    state.bestMoves = state.bestMoves ? Math.min(state.bestMoves, moves) : moves;
    const persisted = saveState();
    renderStats();
    startButton.disabled = true;
    startButton.textContent = 'relic claimed';
    setMessageText(`Vault opened in ${moves} turns and ${formatTime(seconds)}. ${persisted ? 'Your relic is saved in this browser.' : 'Your relic is unlocked for this visit; browser storage is unavailable.'}`);
    root.classList.add('is-cleared');
  };
  const reveal = (button) => {
    button.classList.add('is-revealed');
    button.setAttribute('aria-pressed', 'true');
    button.querySelector('.chamber-tile__glyph').textContent = button.dataset.glyph;
    button.setAttribute('aria-label', `Stone tile ${Number(button.dataset.index) + 1} of 16, glyph ${button.dataset.glyph}, revealed`);
  };
  const conceal = (button) => {
    button.classList.remove('is-revealed');
    button.setAttribute('aria-pressed', 'false');
    button.querySelector('.chamber-tile__glyph').textContent = '𓂀';
    button.setAttribute('aria-label', `Stone tile ${Number(button.dataset.index) + 1} of 16, hidden. Reveal glyph.`);
  };
  const begin = () => {
    if (state.lastClear === today) return;
    moves = 0; matches = 0; first = null; locked = false;
    const random = randomForDay();
    const deck = [...glyphs, ...glyphs];
    for (let index = deck.length - 1; index > 0; index -= 1) { const target = Math.floor(random() * (index + 1)); [deck[index], deck[target]] = [deck[target], deck[index]]; }
    grid.replaceChildren(...deck.map((glyph, index) => {
      const button = document.createElement('button');
      button.className = 'chamber-tile'; button.type = 'button'; button.dataset.glyph = glyph; button.dataset.index = String(index); button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-label', `Stone tile ${index + 1} of 16, hidden. Reveal glyph.`);
      const symbol = document.createElement('span'); symbol.className = 'chamber-tile__glyph'; symbol.setAttribute('aria-hidden', 'true'); symbol.textContent = '𓂀'; button.append(symbol);
      button.addEventListener('click', () => {
        if (locked || button.disabled || button === first) return;
        reveal(button);
        if (!first) { first = button; return; }
        moves += 1; movesNode.textContent = String(moves);
        if (first.dataset.glyph === button.dataset.glyph) {
          first.disabled = true; button.disabled = true; first.classList.add('is-matched'); button.classList.add('is-matched'); first.setAttribute('aria-label', `Matched pair ${first.dataset.glyph}, stone tile ${Number(first.dataset.index) + 1} of 16`); button.setAttribute('aria-label', `Matched pair ${button.dataset.glyph}, stone tile ${Number(button.dataset.index) + 1} of 16`); matches += 1; first = null;
          setMessageText(`${matches} of 8 pairs found.`);
          if (matches === 8) finish();
        } else {
          const miss = first; locked = true; setMessageText('No match. Remember the stones and try another pair.');
          window.setTimeout(() => { conceal(miss); conceal(button); first = null; locked = false; }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 120 : 700);
        }
      });
      return button;
    }));
    grid.hidden = false; startButton.hidden = true; startedAt = Date.now(); timeNode.textContent = '00:00';
    setMessageText('The chamber is open. Find all eight matching pairs.');
    timer = window.setInterval(() => { timeNode.textContent = formatTime(Math.floor((Date.now() - startedAt) / 1000)); }, 1000);
  };
  const date = new Intl.DateTimeFormat('en-EG', { timeZone: 'Africa/Cairo', dateStyle: 'full' }).format(new Date());
  dateNode.textContent = `${date} · daily board`;
  startButton.addEventListener('click', begin);
  renderStats(); renderCountdown(); window.setInterval(renderCountdown, 1000);
  if (state.lastClear === today) {
    startButton.disabled = true; startButton.textContent = 'relic claimed';
    setMessageText('Today’s vault is already open. A fresh chamber arrives at Cairo midnight.');
    root.classList.add('is-cleared');
  }
}

async function initProductButtons() {
  const buttons = [...document.querySelectorAll('[data-add-product]')];
  if (!buttons.length) return;
  for (const button of buttons) {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const { products } = await request('/api/products');
        const id = Number(button.dataset.addProduct);
        const product = products.find((row) => row.id === id);
        if (!product) throw new Error('This item is no longer listed. Refresh the page to see current items.');
        const basket = readBasket();
        const line = basket.find((row) => row.id === id);
        if (line) line.quantity = Math.min(20, line.quantity + 1);
        else basket.push({ id, quantity: 1, name: product.name, price_piasters: product.price_piasters });
        writeBasket(basket);
        updateBasketCount();
        const oldText = button.textContent;
        button.textContent = 'added';
        window.setTimeout(() => { button.textContent = oldText; }, 1800);
      } catch (error) {
        const status = document.querySelector('[data-page-message]') || document.querySelector('[data-product-message]');
        if (status) setMessage(status, error.message, 'error');
        else window.alert(error.message);
      } finally { button.disabled = false; }
    });
  }
}

function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderBasket() {
  const mount = document.querySelector('[data-basket-items]');
  const totalNode = document.querySelector('[data-basket-total]');
  if (!mount || !totalNode) return;
  const basket = readBasket();
  mount.replaceChildren();
  if (!basket.length) {
    const empty = makeElement('p', 'empty-state', 'Your basket is empty. Visit the store to find available items.');
    const link = makeElement('a', 'text-link', 'browse the store');
    link.href = '/store/backpacks';
    mount.append(empty, link);
    totalNode.textContent = egp(0);
    return;
  }
  const list = makeElement('div', 'basket-list');
  let total = 0;
  for (const item of basket) {
    const row = makeElement('article', 'basket-row');
    const info = makeElement('div');
    const name = makeElement('h2', '', item.name || `Store item ${item.id}`);
    const price = Number(item.price_piasters) || 0;
    const line = makeElement('p', '', `${egp(price)} each`);
    info.append(name, line);
    const controls = makeElement('div', 'basket-row__controls');
    const decrement = makeElement('button', '', '−');
    decrement.type = 'button'; decrement.setAttribute('aria-label', `Remove one ${item.name || 'item'}`);
    const quantity = makeElement('span', 'num', String(item.quantity));
    const increment = makeElement('button', '', '+');
    increment.type = 'button'; increment.setAttribute('aria-label', `Add one ${item.name || 'item'}`);
    decrement.addEventListener('click', () => changeQuantity(item.id, -1));
    increment.addEventListener('click', () => changeQuantity(item.id, 1));
    controls.append(decrement, quantity, increment);
    const remove = makeElement('button', 'basket-remove', 'remove');
    remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${item.name || 'item'} from basket`);
    remove.addEventListener('click', () => removeItem(item.id));
    row.append(info, controls, remove);
    list.append(row);
    total += price * item.quantity;
  }
  mount.append(list);
  totalNode.textContent = egp(total);
}

function changeQuantity(id, delta) {
  const items = readBasket();
  const item = items.find((row) => row.id === id);
  if (!item) return;
  item.quantity = Math.max(1, Math.min(20, item.quantity + delta));
  writeBasket(items); updateBasketCount(); renderBasket();
}

function removeItem(id) {
  writeBasket(readBasket().filter((item) => item.id !== id));
  updateBasketCount(); renderBasket();
}

function initCheckout() {
  const form = document.querySelector('[data-checkout-form]');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = form.querySelector('[data-checkout-message]');
    if (!form.reportValidity()) return;
    const items = readBasket();
    if (!items.length) { setMessage(message, 'Your basket is empty. Add an item before checkout.', 'error'); return; }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true; button.textContent = 'saving order';
    try {
      const formData = new FormData(form);
      const result = await request('/api/orders', { method: 'POST', body: JSON.stringify({ minecraftUsername: formData.get('minecraftUsername'), discordContact: formData.get('discordContact'), items }) });
      writeBasket([]); updateBasketCount(); renderBasket();
      setMessage(message, `Order ${result.orderNumber} is saved as Awaiting Payment. Contact staff through Discord for manual mobile-wallet or InstaPay instructions.`, 'success');
      const link = document.createElement('a'); link.href = '/orders'; link.textContent = 'view order history'; link.className = 'text-link'; message.after(link);
    } catch (error) { setMessage(message, error.message, 'error'); }
    finally { button.disabled = false; button.textContent = 'place order request'; }
  });
}

function initAuth() {
  const form = document.querySelector('[data-auth-form]');
  if (!form) return;
  let mode = 'login';
  const switchButton = document.querySelector('[data-auth-switch]');
  const switchLabel = document.querySelector('[data-auth-switch-label]');
  const submit = document.querySelector('[data-auth-submit]');
  const discordField = document.querySelector('[data-discord-field]');
  const password = form.elements.password;
  switchButton?.addEventListener('click', () => {
    mode = mode === 'login' ? 'register' : 'login';
    const registering = mode === 'register';
    document.querySelector('[data-auth-heading]').textContent = registering ? 'Create an account' : 'Sign in';
    submit.textContent = registering ? 'create account' : 'sign in';
    switchLabel.textContent = registering ? 'Already have an account?' : 'Need an account?';
    switchButton.textContent = registering ? 'sign in' : 'create one';
    discordField.hidden = !registering;
    password.autocomplete = registering ? 'new-password' : 'current-password';
    password.minLength = registering ? 12 : 1;
    setMessage(document.querySelector('[data-auth-message]'), '');
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const message = document.querySelector('[data-auth-message]');
    const formData = new FormData(form);
    const payload = { minecraftUsername: formData.get('minecraftUsername'), username: formData.get('minecraftUsername'), password: formData.get('password'), discordContact: formData.get('discordContact') };
    submit.disabled = true; submit.textContent = mode === 'register' ? 'creating account' : 'signing in';
    try {
      await request(mode === 'register' ? '/api/account/register' : '/api/account/login', { method: 'POST', body: JSON.stringify(payload) });
      window.location.assign('/account');
    } catch (error) { setMessage(message, error.message, 'error'); }
    finally { submit.disabled = false; submit.textContent = mode === 'register' ? 'create account' : 'sign in'; }
  });
}

function initAdminLogin() {
  const form = document.querySelector('[data-admin-login]');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!form.reportValidity()) return;
    const button = form.querySelector('[type="submit"]');
    const message = form.querySelector('[data-admin-message]');
    const fields = new FormData(form);
    button.disabled = true; button.textContent = 'checking staff access';
    try {
      await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: fields.get('username'), password: fields.get('password') }) });
      window.location.assign('/admin');
    } catch (error) { setMessage(message, error.message, 'error'); }
    finally { button.disabled = false; button.textContent = 'sign in to admin'; }
  });
}

function initLogout() {
  document.querySelectorAll('[data-logout]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try { await request('/api/logout', { method: 'POST', body: '{}' }); window.location.assign('/'); }
    catch { button.disabled = false; const node = document.querySelector('[data-account-message]') || document.querySelector('[data-admin-feedback]'); setMessage(node, 'Could not sign out. Try again.', 'error'); }
  }));
}

async function initAdmin() {
  const productForm = document.querySelector('[data-product-form]');
  if (!productForm) return;
  const feedback = document.querySelector('[data-admin-feedback]');
  productForm.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!productForm.reportValidity()) return;
    const data = new FormData(productForm);
    const id = data.get('id');
    const payload = { name: data.get('name'), category: data.get('category'), description: data.get('description'), price: data.get('price'), imagePath: data.get('imagePath'), published: data.get('published') };
    const button = productForm.querySelector('[type="submit"]'); button.disabled = true; button.textContent = 'saving product';
    try {
      await request(id ? `/api/admin/products/${id}` : '/api/admin/products', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      window.location.reload();
    } catch (error) { setMessage(feedback, error.message, 'error'); }
    finally { button.disabled = false; button.textContent = 'save product'; }
  });
  document.querySelectorAll('[data-edit-product]').forEach((button) => button.addEventListener('click', async () => {
    try {
      const { products } = await request('/api/admin/products');
      const product = products.find((row) => row.id === Number(button.dataset.editProduct));
      if (!product) throw new Error('Product not found. Refresh the page.');
      productForm.elements.id.value = product.id;
      productForm.elements.name.value = product.name;
      productForm.elements.category.value = product.category;
      productForm.elements.description.value = product.description;
      productForm.elements.price.value = (product.price_piasters / 100).toFixed(2);
      productForm.elements.imagePath.value = product.image_path;
      productForm.elements.published.value = String(product.published);
      productForm.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      productForm.elements.name.focus();
    } catch (error) { setMessage(feedback, error.message, 'error'); }
  }));
  document.querySelectorAll('[data-hide-product]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try { await request(`/api/admin/products/${button.dataset.hideProduct}`, { method: 'DELETE' }); window.location.reload(); }
    catch (error) { setMessage(feedback, error.message, 'error'); button.disabled = false; }
  }));
  document.querySelectorAll('[data-status-form]').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]'); button.disabled = true;
    try {
      await request(`/api/admin/orders/${encodeURIComponent(form.dataset.order)}/status`, { method: 'PATCH', body: JSON.stringify({ status: form.elements.status.value }) });
      setMessage(feedback, 'Order status saved.', 'success');
    } catch (error) { setMessage(feedback, error.message, 'error'); }
    finally { button.disabled = false; }
  }));
  const pointsForm = document.querySelector('[data-points-form]');
  pointsForm?.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!pointsForm.reportValidity()) return;
    const fields = new FormData(pointsForm); const button = pointsForm.querySelector('[type="submit"]'); button.disabled = true;
    try {
      await request(`/api/admin/accounts/${fields.get('userId')}/points`, { method: 'PATCH', body: JSON.stringify({ delta: Number(fields.get('delta')), reason: fields.get('reason') }) });
      window.location.reload();
    } catch (error) { setMessage(feedback, error.message, 'error'); button.disabled = false; }
  });
}

updateBasketCount();
initPyramidGame();
initDailyChamber();
initProductButtons();
renderBasket();
initCheckout();
initAuth();
initAdminLogin();
initLogout();
initAdmin();

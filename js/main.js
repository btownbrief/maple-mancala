// MAPLE MANCALA — a Btown Games production for the BTown Brief.
// UI only: every rule lives in js/engine.js, every bot brain in js/bot.js.
// This file owns the DOM, the sowing animation, sounds, and localStorage.

import { sound } from './audio.js';
import {
  createInitialState, legalMoves, describeMove, getStatus, ownPits,
  SOUTH, NORTH, STORE,
} from './engine.js';
import { chooseMove, LEVELS } from './bot.js';

const $ = (id) => document.getElementById(id);
const LS_SAVE = 'maple-mancala.save';

// Screen rows top→bottom: North's pits run up the left column, South's run
// down the right one, so sowing flows in a loop around the board and each
// player's big bucket sits at their own end of the phone.
const ROWS = [[12, 0], [11, 1], [10, 2], [9, 3], [8, 4], [7, 5]];
const MAX_DOTS = 18; // drops drawn per pit before we let the number carry it

let state = null;   // authoritative engine state
let view = null;    // pit counts currently on screen (lags during animation)
let mode = null;    // 'pass' | 'bot'
let level = null;   // 'sap-run' | 'sugarmaker'
let busy = false;   // an animation is running
let session = 0;    // bumped on every new/left game to cancel stale animations
let armed = -1;     // pit currently held down for the landing preview

/* ============================== board DOM ============================== */

const pitEls = {};
const grid = $('pitgrid');
for (const [n, s] of ROWS) {
  for (const pit of [n, s]) {
    const el = document.createElement('button');
    el.className = `pit ${pit <= 5 ? 'south' : 'north'}`;
    el.dataset.pit = pit;
    el.innerHTML = '<div class="drops"></div><span class="count">0</span>';
    grid.appendChild(el);
    pitEls[pit] = el;
  }
}
const storeEls = { [STORE[SOUTH]]: $('storeS'), [STORE[NORTH]]: $('storeN') };
const countEls = { [STORE[SOUTH]]: $('countS'), [STORE[NORTH]]: $('countN') };

// Candy drops sit in a sunflower spiral so buckets fill naturally.
const DOT_POS = [];
for (let k = 0; k < MAX_DOTS; k++) {
  const r = k === 0 ? 0 : Math.min(36, 9 + 7.2 * Math.sqrt(k));
  const a = k * 2.39996;
  DOT_POS.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]);
}

function renderPit(pit, popped = false) {
  if (pit === STORE[SOUTH] || pit === STORE[NORTH]) {
    countEls[pit].textContent = view[pit];
    if (popped) rePop(countEls[pit]);
    return;
  }
  const el = pitEls[pit];
  const n = view[pit];
  el.querySelector('.count').textContent = n;
  el.classList.toggle('empty', n === 0);
  const drops = el.querySelector('.drops');
  let html = '';
  for (let k = 0; k < Math.min(n, MAX_DOTS); k++) {
    const [x, y] = DOT_POS[k];
    html += `<i class="drop" style="left:${x}%;top:${y}%"></i>`;
  }
  drops.innerHTML = html;
  if (popped && drops.lastElementChild) drops.lastElementChild.classList.add('pop');
  if (popped) rePop(el);
}

function renderAll() {
  for (let p = 0; p < 14; p++) renderPit(p);
}

function rePop(el) {
  el.classList.remove('pop');
  void el.offsetWidth; // restart the animation
  el.classList.add('pop');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================== copy ============================== */

function playerName(player) {
  if (mode === 'pass') return player === SOUTH ? 'South End' : 'North End';
  return player === SOUTH ? 'You' : LEVELS[level].name;
}

const TURN_LINES = {
  pass: (p) => `${playerName(p)} — tap a bucket`,
  you: () => 'Your turn — tap a bucket',
  bot: () => `${LEVELS[level].name} is stirring the pan…`,
};

/* ============================== game flow ============================== */

function startGame(newMode, newLevel, resumed = null) {
  session += 1;
  mode = newMode;
  level = newLevel;
  state = resumed || createInitialState();
  view = state.pits.slice();
  busy = false;
  armed = -1;

  document.body.classList.toggle('mode-pass', mode === 'pass');
  $('nameS').textContent = playerName(SOUTH);
  $('nameN').textContent = mode === 'pass' ? 'North End'
    : `${LEVELS[level].name} ${level === 'sugarmaker' ? '🔥' : '🌱'}`;

  show('game');
  renderAll();
  updateTurnUI();
  saveGame();
  if (!resumed) toast(mode === 'pass' ? 'South End taps first 🍁' : 'You go first 🍁');
  maybeBot();
}

function updateTurnUI() {
  const cur = state.current;
  storeEls[STORE[SOUTH]].classList.toggle('active', cur === SOUTH);
  storeEls[STORE[NORTH]].classList.toggle('active', cur === NORTH);
  document.body.classList.toggle('turn-north', cur === NORTH);
  $('tagS').textContent = cur === SOUTH ? 'your turn' : '';
  $('tagN').textContent = cur === NORTH ? (mode === 'pass' ? 'your turn' : 'thinking…') : '';
}

function humanCanMoveNow() {
  return !busy && state && !getStatus(state).over
    && (mode === 'pass' || state.current === SOUTH);
}

async function play(move) {
  const mySession = session;
  const mover = state.current;
  const fx = describeMove(state, move);
  state = fx.state; // rules already settled; everything below is theater
  busy = true;
  clearPreview();
  saveGame();

  // Pick up the drops…
  view[move] = 0;
  renderPit(move);
  pitEls[move].classList.add('lift');
  await sleep(280);
  if (session !== mySession) return;
  pitEls[move].classList.remove('lift');

  // …and sow them one per bucket. This IS the game feel.
  const quick = fx.path.length > 10;
  for (let i = 0; i < fx.path.length; i++) {
    await sleep(Math.max(115, (quick ? 165 : 235) - i * 6));
    if (session !== mySession) return;
    const p = fx.path[i];
    view[p] += 1;
    renderPit(p, true);
    if (p === STORE[SOUTH] || p === STORE[NORTH]) sound.thunk();
    else sound.plink(i);
  }

  if (fx.capture) {
    await sleep(300);
    if (session !== mySession) return;
    pitEls[fx.capture.pit].classList.add('flash');
    pitEls[fx.capture.opposite].classList.add('flash');
    await sleep(420);
    if (session !== mySession) return;
    pitEls[fx.capture.pit].classList.remove('flash');
    pitEls[fx.capture.opposite].classList.remove('flash');
    view[fx.capture.pit] = 0;
    view[fx.capture.opposite] = 0;
    view[STORE[mover]] += fx.capture.seeds;
    renderPit(fx.capture.pit);
    renderPit(fx.capture.opposite);
    renderPit(STORE[mover], true);
    sound.capture();
    toast(`🍯 ${playerName(mover)} sugared off ${fx.capture.seeds} drops!`);
    await sleep(700);
    if (session !== mySession) return;
  }

  const status = getStatus(state);

  if (fx.sweep && fx.sweep.seeds > 0) {
    await sleep(400);
    if (session !== mySession) return;
    toast(`🧹 Board's tapped out — ${playerName(fx.sweep.player)} banks the rest`);
    for (const p of ownPits(fx.sweep.player)) {
      if (view[p] === 0) continue;
      view[STORE[fx.sweep.player]] += view[p];
      view[p] = 0;
      renderPit(p);
      renderPit(STORE[fx.sweep.player], true);
      sound.plink(6);
      await sleep(150);
      if (session !== mySession) return;
    }
  }

  busy = false;
  saveGame();

  if (status.over) {
    await sleep(700);
    if (session !== mySession) return;
    finish(status);
    return;
  }

  if (fx.extraTurn) {
    sound.extraTurn();
    toast(mode === 'bot' && mover === NORTH
      ? `🔁 ${LEVELS[level].name} goes again…`
      : '✨ Sweet! Last drop in your bucket — go again');
  } else {
    toast(mode === 'pass' ? TURN_LINES.pass(state.current)
      : state.current === SOUTH ? TURN_LINES.you() : TURN_LINES.bot());
  }
  updateTurnUI();
  maybeBot();
}

function maybeBot() {
  if (mode !== 'bot' || state.current !== NORTH || busy || getStatus(state).over) return;
  const mySession = session;
  setTimeout(() => {
    if (session !== mySession || busy || state.current !== NORTH) return;
    const move = chooseMove(state, level, Math.random);
    if (move !== null) play(move);
  }, 650);
}

function finish(status) {
  clearSave();
  const s = status.scores;
  $('res-score').textContent = `${s[SOUTH]} – ${s[NORTH]}`;
  if (status.tie) {
    $('res-title').textContent = 'DEAD EVEN';
    $('res-line').textContent = 'Split the syrup 50/50, neighborly style.';
    sound.win();
  } else if (mode === 'pass') {
    $('res-title').textContent = `${playerName(status.winner).toUpperCase()} WINS`;
    $('res-line').textContent = `${playerName(status.winner)} takes the sugarhouse. Loser stacks the cordwood.`;
    sound.win();
  } else if (status.winner === SOUTH) {
    $('res-title').textContent = 'SWEET VICTORY';
    $('res-line').textContent = level === 'sugarmaker'
      ? 'You out-boiled the Sugarmaker. Fancy Grade A stuff.'
      : 'You out-boiled the Sap Run bot. Try the Sugarmaker next?';
    sound.win();
  } else {
    $('res-title').textContent = 'SUGARED OFF';
    $('res-line').textContent = `${LEVELS[level].name} took the sugarhouse. Rematch?`;
    sound.lose();
  }
  show('result');
}

/* ============================== preview ============================== */
// Press & hold (or hover, on desktop) shows where the last drop will land —
// an amber ring, plus a “free turn!” tag when it lands in your store.

function showPreview(pit) {
  if (!humanCanMoveNow() || !legalMoves(state).includes(pit)) return;
  clearPreview();
  const fx = describeMove(state, pit);
  const last = fx.path[fx.path.length - 1];
  (pitEls[last] || storeEls[last]).classList.add('land');
  if (fx.extraTurn) {
    const tag = state.current === SOUTH ? $('tagS') : $('tagN');
    tag.textContent = '✨ free turn!';
  }
}

function clearPreview() {
  for (const el of Object.values(pitEls)) el.classList.remove('land');
  for (const el of Object.values(storeEls)) el.classList.remove('land');
}

/* ============================== input ============================== */

for (const [pitStr, el] of Object.entries(pitEls)) {
  const pit = Number(pitStr);
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { el.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (!humanCanMoveNow() || !legalMoves(state).includes(pit)) return;
    armed = pit;
    showPreview(pit);
  });
  el.addEventListener('pointerup', () => {
    const wasArmed = armed === pit;
    armed = -1;
    clearPreview();
    updateTurnUI(); // restore the turn tag the preview may have replaced
    if (wasArmed && humanCanMoveNow() && legalMoves(state).includes(pit)) play(pit);
  });
  el.addEventListener('pointerleave', () => {
    if (armed === pit) { armed = -1; clearPreview(); updateTurnUI(); }
    else if (matchMedia('(hover: hover)').matches) { clearPreview(); updateTurnUI(); }
  });
  el.addEventListener('pointercancel', () => { armed = -1; clearPreview(); updateTurnUI(); });
  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse' && armed === -1) showPreview(pit);
  });
}

document.addEventListener('pointerdown', () => sound.unlock(), { capture: true });

/* ============================== toast ============================== */

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  rePop(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('pop'); }, 2600);
}

/* ============================== save / resume ============================== */
// The engine state is plain JSON — stash it whole, revive it whole. This is
// the same serialization online multiplayer will ride on later.

function saveGame() {
  if (getStatus(state).over) { clearSave(); return; }
  localStorage.setItem(LS_SAVE, JSON.stringify({ state, mode, level }));
}

function clearSave() {
  localStorage.removeItem(LS_SAVE);
}

function loadSave() {
  try {
    const raw = localStorage.getItem(LS_SAVE);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const ok = data && data.state && Array.isArray(data.state.pits)
      && data.state.pits.length === 14
      && data.state.pits.every((n) => Number.isInteger(n) && n >= 0)
      && (data.state.current === SOUTH || data.state.current === NORTH)
      && (data.mode === 'pass' || data.mode === 'bot');
    return ok ? data : null;
  } catch {
    return null;
  }
}

/* ============================== screens ============================== */

function show(id) {
  for (const s of ['menu', 'game', 'result']) $(s).classList.toggle('hidden', s !== id);
  if (id === 'menu') {
    session += 1; // stop any animation still running behind the menu
    busy = false;
    $('resumeBtn').classList.toggle('hidden', !loadSave());
  }
}

$('passBtn').addEventListener('click', () => startGame('pass', null));
$('easyBtn').addEventListener('click', () => startGame('bot', 'sap-run'));
$('hardBtn').addEventListener('click', () => startGame('bot', 'sugarmaker'));
$('resumeBtn').addEventListener('click', () => {
  const save = loadSave();
  if (save) startGame(save.mode, save.level, save.state);
});
$('menuBtn').addEventListener('click', () => show('menu'));
$('againBtn').addEventListener('click', () => startGame(mode, level));
$('resMenuBtn').addEventListener('click', () => show('menu'));

$('mute').addEventListener('click', () => {
  sound.unlock();
  $('mute').textContent = sound.toggleMute() ? '🔇' : '🔊';
});
$('mute').textContent = sound.muted ? '🔇' : '🔊';

show('menu');

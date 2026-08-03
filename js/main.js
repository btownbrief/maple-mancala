// MAPLE MANCALA — a Btown Games production for the BTown Brief.
// UI only: every rule lives in js/engine.js, every bot brain in js/bot.js.
// This file owns the DOM, the sowing animation, sounds, and localStorage.

import { sound } from './audio.js';
import {
  createInitialState, legalMoves, describeMove, getStatus, ownPits,
  SOUTH, NORTH, STORE,
} from './engine.js';
import { chooseMove, LEVELS } from './bot.js';
import { OnlineMatch, savedSession, clearSession, getName } from './rooms.js';
import {
  lbEnabled, fetchTop, submitScore, renamePlayer, monthLabel,
  getName as lbGetName, playerId as lbPlayerId,
} from './leaderboard.js';

const $ = (id) => document.getElementById(id);
const LS_SAVE = 'maple-mancala.save';
const LS_PREVIEW_HINT = 'maple-mancala.preview-hint.v1';
const GAME = 'maple-mancala';
const RACE_MARK = 13;

// Screen rows top→bottom: North's pits run up the left column, South's run
// down the right one, so sowing flows in a loop around the board and each
// player's big bucket sits at their own end of the phone.
const ROWS = [[12, 0], [11, 1], [10, 2], [9, 3], [8, 4], [7, 5]];
const MAX_DOTS = 18; // drops drawn per pit before we let the number carry it

let state = null;   // authoritative engine state
let view = null;    // pit counts currently on screen (lags during animation)
let mode = null;    // 'pass' | 'bot' | 'online'
let level = null;   // 'sap-run' | 'sugarmaker'
let busy = false;   // an animation is running
let session = 0;    // bumped on every new/left game to cancel stale animations
let armed = -1;     // pit currently held down for the landing preview
let online = null;  // { match, myPlayer } while in an online sap crew
let pollErrors = 0;
let goAgainChain = 0;
let racePlayers = [NORTH, SOUTH];

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

// Pass-and-play keeps the original board and flips only North's top label.
// Online, every phone instead lays out its own store and sowing path nearest
// the bottom, with all labels upright.
function setBoardPerspective(player = SOUTH) {
  const rows = player === NORTH
    ? ROWS.slice().reverse().map(([north, south]) => [south, north])
    : ROWS;
  for (const pair of rows) for (const pit of pair) grid.appendChild(pitEls[pit]);
  const board = $('board');
  if (player === NORTH) {
    board.append(storeEls[STORE[SOUTH]], grid, storeEls[STORE[NORTH]]);
  } else {
    board.append(storeEls[STORE[NORTH]], grid, storeEls[STORE[SOUTH]]);
  }
  racePlayers = [1 - player, player];
  renderRace();
}

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
    renderRace();
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

function renderRace() {
  if (!view) return;
  const sides = [
    ['Left', racePlayers[0]],
    ['Right', racePlayers[1]],
  ];
  for (const [side, player] of sides) {
    const score = view[STORE[player]];
    const shown = Math.min(score, RACE_MARK);
    const name = mode === 'bot'
      ? (player === SOUTH ? 'YOU' : LEVELS[level].name.toUpperCase())
      : (mode ? playerName(player).toUpperCase() : (player === SOUTH ? 'SOUTH' : 'NORTH'));
    $(`race${side}Name`).textContent = name;
    $(`race${side}Count`).textContent = `${score} / ${RACE_MARK}`;
    $(`race${side}Fill`).style.width = `${(shown / RACE_MARK) * 100}%`;
    const track = $(`race${side}Track`);
    track.setAttribute('aria-valuenow', shown);
    track.setAttribute('aria-valuetext', `${name}: ${score} drops; ${RACE_MARK}-drop marker`);
  }
}

function rePop(el) {
  el.classList.remove('pop');
  void el.offsetWidth; // restart the animation
  el.classList.add('pop');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================== transient effects ============================== */

let toastTimer = 0;
let bannerTimer = 0;
let flourishTimer = 0;

function reducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function clearTransientEffects() {
  clearTimeout(toastTimer);
  clearTimeout(bannerTimer);
  clearTimeout(flourishTimer);
  toastTimer = 0;
  bannerTimer = 0;
  flourishTimer = 0;
  $('toast').textContent = '';
  $('toast').classList.remove('pop');
  $('previewHint').classList.add('hidden');
  const banner = $('momentBanner');
  banner.textContent = '';
  banner.className = '';
  const fxLayer = $('gameFx');
  if (fxLayer.getAnimations) {
    for (const animation of fxLayer.getAnimations()) animation.cancel();
  }
  fxLayer.replaceChildren();
  $('mapleFlourish').replaceChildren();
  $('res-card').classList.remove('celebrate');
  for (const el of Object.values(pitEls)) el.classList.remove('lift', 'flash', 'pop', 'land');
  for (const el of Object.values(storeEls)) el.classList.remove('land');
  for (const el of Object.values(countEls)) el.classList.remove('pop');
}

function showMoment(text, kind, chain = 1) {
  const banner = $('momentBanner');
  clearTimeout(bannerTimer);
  banner.className = '';
  void banner.offsetWidth;
  banner.textContent = text;
  banner.classList.add(kind);
  if (kind === 'again' && chain > 1) banner.classList.add(`chain-${Math.min(chain, 3)}`);
  bannerTimer = setTimeout(() => {
    banner.textContent = '';
    banner.className = '';
  }, kind === 'capture' ? 920 : 1080);
}

async function arcCapture(capture, mover, mySession) {
  showMoment('🍯 CAPTURE!', 'capture');
  if (reducedMotion()) {
    await sleep(620);
    return;
  }

  const target = storeEls[STORE[mover]].getBoundingClientRect();
  const sources = [
    pitEls[capture.pit].getBoundingClientRect(),
    pitEls[capture.opposite].getBoundingClientRect(),
  ];
  const count = Math.min(capture.seeds, 18);
  const flights = [];

  for (let i = 0; i < count; i++) {
    const source = sources[i === 0 ? 0 : 1];
    const startX = source.left + source.width / 2 + ((i * 7) % 19) - 9;
    const startY = source.top + source.height / 2 + ((i * 11) % 17) - 8;
    const endX = target.left + target.width / 2 + ((i * 13) % 25) - 12;
    const endY = target.top + target.height / 2 + ((i * 5) % 15) - 7;
    const dx = endX - startX;
    const dy = endY - startY;
    const arc = Math.max(56, Math.hypot(dx, dy) * 0.24);
    const drop = document.createElement('i');
    drop.className = 'capture-drop';
    drop.style.left = `${startX}px`;
    drop.style.top = `${startY}px`;
    $('gameFx').appendChild(drop);

    if (!drop.animate) {
      drop.remove();
      continue;
    }
    const animation = drop.animate([
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - arc}px)) scale(1.18)`, opacity: 1, offset: 0.52 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.55)`, opacity: 0.35 },
    ], {
      duration: 390 + (i % 4) * 22,
      delay: i * 14,
      easing: 'cubic-bezier(0.35, 0.05, 0.65, 1)',
      fill: 'forwards',
    });
    flights.push(animation.finished.catch(() => {}).finally(() => drop.remove()));
  }

  if (flights.length) await Promise.all(flights);
  else await sleep(300);
  if (session !== mySession) $('gameFx').replaceChildren();
}

function createMapleFlourish(mySession) {
  if (reducedMotion()) return;
  const layer = $('mapleFlourish');
  layer.replaceChildren();
  const colors = ['🍁', '🍂'];
  for (let i = 0; i < 16; i++) {
    const leaf = document.createElement('span');
    leaf.className = 'flourish-leaf';
    leaf.textContent = colors[i % colors.length];
    leaf.style.setProperty('--leaf-x', `${8 + ((i * 37) % 84)}%`);
    leaf.style.setProperty('--leaf-size', `${15 + (i % 4) * 4}px`);
    leaf.style.setProperty('--leaf-delay', `${(i % 6) * 45}ms`);
    leaf.style.setProperty('--leaf-drift', `${-80 + ((i * 53) % 160)}px`);
    leaf.style.setProperty('--leaf-spin', `${-240 + ((i * 97) % 480)}deg`);
    layer.appendChild(leaf);
  }
  flourishTimer = setTimeout(() => {
    if (session === mySession) layer.replaceChildren();
  }, 1800);
}

function showPreviewHintOnce() {
  if (localStorage.getItem(LS_PREVIEW_HINT) === '1') return;
  $('previewHint').classList.remove('hidden');
}

function dismissPreviewHint() {
  if ($('previewHint').classList.contains('hidden')) return;
  $('previewHint').classList.add('hidden');
  localStorage.setItem(LS_PREVIEW_HINT, '1');
}

/* ============================== copy ============================== */

function playerName(player) {
  if (mode === 'pass') return player === SOUTH ? 'South End' : 'North End';
  if (mode === 'online' && online) {
    if (player === online.myPlayer) return 'You';
    const opponent = online.match.seats.find((seat) => seat.seat === player);
    return (opponent && opponent.name) || 'Other Sugarmaker';
  }
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
  clearTransientEffects();
  online = null;
  mode = newMode;
  level = newLevel;
  state = resumed || createInitialState();
  view = state.pits.slice();
  busy = false;
  armed = -1;
  goAgainChain = 0;

  resetLbPanel();
  document.body.classList.toggle('mode-pass', mode === 'pass');
  setBoardPerspective(SOUTH);
  $('nameS').textContent = playerName(SOUTH);
  $('nameN').textContent = mode === 'pass' ? 'North End'
    : `${LEVELS[level].name} ${level === 'sugarmaker' ? '🔥' : '🌱'}`;

  show('game');
  renderAll();
  updateTurnUI();
  saveGame();
  if (!resumed) {
    toast(mode === 'pass' ? 'South End taps first 🍁' : 'You go first 🍁');
    showPreviewHintOnce();
  }
  maybeBot();
}

function updateTurnUI() {
  const cur = state.current;
  storeEls[STORE[SOUTH]].classList.toggle('active', cur === SOUTH);
  storeEls[STORE[NORTH]].classList.toggle('active', cur === NORTH);
  document.body.classList.toggle('turn-north', cur === NORTH);
  $('tagS').textContent = '';
  $('tagN').textContent = '';
  if (mode === 'online' && online) {
    const mine = online.myPlayer;
    const theirs = 1 - mine;
    const opponent = online.match.opponents()[0];
    if (cur === mine && online.match.status === 'playing') {
      (mine === SOUTH ? $('tagS') : $('tagN')).textContent = 'your turn';
    } else if (cur === theirs) {
      (theirs === SOUTH ? $('tagS') : $('tagN')).textContent =
        opponent && opponent.away ? 'away' : 'their turn';
    }
  } else {
    $('tagS').textContent = cur === SOUTH ? 'your turn' : '';
    $('tagN').textContent = cur === NORTH ? (mode === 'pass' ? 'your turn' : 'thinking…') : '';
  }
}

function humanCanMoveNow() {
  return !busy && state && !getStatus(state).over
    && (mode === 'pass'
      || (mode === 'bot' && state.current === SOUTH)
      || (mode === 'online' && online && online.match.status === 'playing'
        && state.current === online.myPlayer));
}

async function play(move) {
  const mySession = session;
  const mover = state.current;
  const fx = describeMove(state, move);
  state = fx.state; // rules already settled; everything below is theater
  busy = true;
  clearPreview();
  if (online) pushOnline(state); // publish while this phone performs the sowing theater
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
    await sleep(180);
    if (session !== mySession) return;
    await arcCapture(fx.capture, mover, mySession);
    if (session !== mySession) return;
    view[fx.capture.pit] = 0;
    view[fx.capture.opposite] = 0;
    view[STORE[mover]] += fx.capture.seeds;
    renderPit(fx.capture.pit);
    renderPit(fx.capture.opposite);
    renderPit(STORE[mover], true);
    pitEls[fx.capture.pit].classList.add('flash');
    pitEls[fx.capture.opposite].classList.add('flash');
    sound.capture();
    toast(`🍯 ${playerName(mover)} sugared off ${fx.capture.seeds} drops!`);
    await sleep(420);
    if (session !== mySession) return;
    pitEls[fx.capture.pit].classList.remove('flash');
    pitEls[fx.capture.opposite].classList.remove('flash');
    await sleep(280);
    if (session !== mySession) return;
  }

  const status = getStatus(state);
  const scoreBeforeSweep = [view[STORE[SOUTH]], view[STORE[NORTH]]];

  if (fx.sweep && fx.sweep.seeds > 0) {
    await sleep(400);
    if (session !== mySession) return;
    toast(`🧹 Board's tapped out — ${playerName(fx.sweep.player)} banks the rest`);
    if (reducedMotion()) {
      view = state.pits.slice();
      renderAll();
    } else {
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
  }

  busy = false;
  saveGame();

  if (status.over) {
    await sleep(700);
    if (session !== mySession) return;
    finish(status, { celebrate: true, scoreFrom: scoreBeforeSweep });
    return;
  }

  if (fx.extraTurn) {
    goAgainChain += 1;
    sound.extraTurn(goAgainChain);
    showMoment(
      goAgainChain > 1 ? `🍁 GO AGAIN ×${goAgainChain}` : '🍁 GO AGAIN!',
      'again',
      goAgainChain,
    );
    toast(mode === 'bot' && mover === NORTH
      ? `🔁 ${LEVELS[level].name} goes again…`
      : '✨ Sweet! Last drop in your bucket — go again');
  } else {
    goAgainChain = 0;
    if (mode === 'pass') toast(TURN_LINES.pass(state.current));
    else if (mode === 'online') {
      toast(state.current === online.myPlayer
        ? TURN_LINES.you()
        : `${playerName(state.current)} is tapping a bucket…`);
    } else {
      toast(state.current === SOUTH ? TURN_LINES.you() : TURN_LINES.bot());
    }
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

function resultScores(scores) {
  return mode === 'online'
    ? [scores[online.myPlayer], scores[1 - online.myPlayer]]
    : [scores[SOUTH], scores[NORTH]];
}

function setResultScore(scores) {
  $('res-score').textContent = `${scores[0]} – ${scores[1]}`;
}

function countUpResult(from, to, mySession) {
  if (reducedMotion() || (from[0] === to[0] && from[1] === to[1])) {
    setResultScore(to);
    return;
  }
  const started = performance.now();
  const duration = 650;
  const frame = (now) => {
    if (session !== mySession) return;
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - ((1 - progress) ** 3);
    setResultScore(from.map((score, i) => Math.round(score + (to[i] - score) * eased)));
    if (progress < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------- leaderboard */
// Monthly board for vs-bot wins only. Score = candy margin in your bucket,
// +1000 for Sugarmaker wins so any Sugarmaker win outranks any Sap Run win.

const lbBox = $('lb');
const lbList = $('lbList');
const lbStatusEl = $('lbStatus');
const lbForm = $('lbForm');
const lbNameInput = $('lbNameInput');
const lbThisBtn = $('lbThisBtn');
const lbLastBtn = $('lbLastBtn');
const lbRenameBtn = $('lbRenameBtn');
let lbMonthOffset = 0;

if (lbEnabled()) {
  lbThisBtn.textContent = `🏆 ${monthLabel(0)}`;
  lbLastBtn.textContent = monthLabel(-1);
}

function resetLbPanel() {
  lbBox.classList.add('hidden');
  lbForm.classList.add('hidden');
  lbForm.dataset.pendingScore = '';
}

function botWinScore(status) {
  const margin = status.scores[SOUTH] - status.scores[NORTH];
  return level === 'sugarmaker' ? 1000 + margin : margin;
}

// s >= 1000 means a Sugarmaker win (margin = s - 1000); otherwise a Sap Run win
function lbScoreLabel(s) {
  return s >= 1000 ? `🔥 +${s - 1000} candies` : `🌱 +${s} candies`;
}

// score > 0 submits a fresh win; score 0 just shows the standings read-only
async function updateLeaderboard(score) {
  if (!lbEnabled()) return;
  lbBox.classList.remove('hidden');
  if (score > 0 && !lbGetName()) {
    // first win with no saved name: hold the score until they pick one
    lbForm.classList.remove('hidden');
    lbRenameBtn.classList.add('hidden');
    lbStatusEl.textContent = 'Pick a name to join the monthly leaderboard!';
    lbList.innerHTML = '';
    lbForm.dataset.pendingScore = String(score);
    return;
  }
  if (score > 0) {
    try { await submitScore(score); } catch { /* offline — still show the board */ }
  }
  renderLbBoard();
}

async function renderLbBoard() {
  lbForm.classList.add('hidden');
  lbRenameBtn.classList.remove('hidden');
  lbStatusEl.textContent = 'Loading…';
  try {
    const rows = await fetchTop(lbMonthOffset);
    const me = lbPlayerId();
    lbList.innerHTML = '';
    rows.slice(0, 10).forEach((r, i) => {
      const li = document.createElement('li');
      if (r.player_id === me) li.className = 'me';
      const medal = ['🥇', '🥈', '🥉'][i];
      li.innerHTML = '<span class="rank"></span><span class="nm"></span><span class="sc"></span>';
      li.querySelector('.rank').textContent = medal || `${i + 1}.`;
      li.querySelector('.nm').textContent = r.name;
      li.querySelector('.sc').textContent = lbScoreLabel(r.score);
      lbList.appendChild(li);
    });
    const myRank = rows.findIndex((r) => r.player_id === me);
    lbStatusEl.textContent = rows.length === 0
      ? 'No scores yet this month — be the first!'
      : myRank >= 0 ? `You're #${myRank + 1} of ${rows.length} this month` : '';
  } catch {
    lbStatusEl.textContent = 'Leaderboard unavailable (offline?)';
  }
}

$('lbSaveBtn').addEventListener('click', async () => {
  const name = lbNameInput.value.trim();
  if (!name) { lbNameInput.focus(); return; }
  const pending = Number(lbForm.dataset.pendingScore || 0);
  lbForm.dataset.pendingScore = '';
  try {
    await renamePlayer(name); // saves locally + renames any existing rows
    if (pending > 0) await submitScore(pending);
  } catch { /* offline — the name is still saved locally */ }
  renderLbBoard();
});
lbNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('lbSaveBtn').click();
});
lbRenameBtn.addEventListener('click', () => {
  lbNameInput.value = lbGetName();
  lbForm.classList.remove('hidden');
  lbRenameBtn.classList.add('hidden');
  lbNameInput.focus();
});
lbThisBtn.addEventListener('click', () => {
  lbMonthOffset = 0;
  lbThisBtn.classList.add('sel');
  lbLastBtn.classList.remove('sel');
  renderLbBoard();
});
lbLastBtn.addEventListener('click', () => {
  lbMonthOffset = -1;
  lbLastBtn.classList.add('sel');
  lbThisBtn.classList.remove('sel');
  renderLbBoard();
});

function finish(status, { celebrate = false, scoreFrom = null } = {}) {
  if (mode !== 'online') clearSave();
  const s = status.scores;
  const finalScores = resultScores(s);
  const startingScores = scoreFrom ? resultScores(scoreFrom) : finalScores;
  const gap = Math.abs(s[SOUTH] - s[NORTH]);
  const close = gap <= 4;
  $('againBtn').classList.remove('hidden');
  $('res-score').setAttribute('aria-label', `Final score ${finalScores[0]} to ${finalScores[1]}`);
  setResultScore(celebrate ? startingScores : finalScores);
  if (status.tie) {
    $('res-title').textContent = 'DEAD EVEN';
    $('res-line').textContent = 'Two sugarmakers, one exact boil. Call it Fancy Grade Even.';
  } else if (mode === 'online') {
    if (status.winner === online.myPlayer) {
      $('res-title').textContent = 'SWEET VICTORY';
      $('res-line').textContent = close
        ? `Last drip decided it — ${playerName(1 - online.myPlayer)} nearly had the sugarhouse.`
        : `You out-sweetened ${playerName(1 - online.myPlayer)}. Fancy Grade A stuff.`;
    } else {
      $('res-title').textContent = 'SUGARED OFF';
      $('res-line').textContent = close
        ? `${playerName(1 - online.myPlayer)} got the last sweet drop. Another boil?`
        : `${playerName(1 - online.myPlayer)} took the sugarhouse. Time to fire it up again.`;
    }
  } else if (mode === 'pass') {
    $('res-title').textContent = `${playerName(status.winner).toUpperCase()} WINS`;
    $('res-line').textContent = close
      ? `${playerName(status.winner)} wins by a maple whisker. Call the rematch before the pan cools.`
      : `${playerName(status.winner)} boiled the sweeter batch. Loser stacks the cordwood.`;
  } else if (status.winner === SOUTH) {
    $('res-title').textContent = 'SWEET VICTORY';
    $('res-line').textContent = level === 'sugarmaker'
      ? (close
        ? 'The Sugarmaker tips their felt hat: “Down to the last drip. Fine boil.”'
        : 'The Sugarmaker nods: “Clean boil. You earned that Grade A.”')
      : (close
        ? 'Sap Run tips its tin pail: “Sweet squeaker! Ready for another?”'
        : 'Sap Run cheers: “Sweet work! Ready for the hot sugarhouse?”');
  } else {
    $('res-title').textContent = 'SUGARED OFF';
    $('res-line').textContent = level === 'sugarmaker'
      ? (close
        ? 'The Sugarmaker skims the pan: “One good scoop from stealing it.”'
        : 'The Sugarmaker stokes the arch: “Good run. The next boil’s yours to steal.”')
      : (close
        ? 'Sap Run whistles: “That was one sticky drop apart. Again?”'
        : 'Sap Run grins: “Found the sweet spot this time. Another boil?”');
  }
  show('result');
  if (mode === 'bot') {
    // Submit only on a fresh (celebrated) human win, exactly once per game:
    // bot-mode finish() is reached solely from play()'s game-over path with
    // celebrate:true. Losses and ties still show the standings read-only.
    const humanWon = celebrate && !status.tie && status.winner === SOUTH;
    updateLeaderboard(humanWon ? botWinScore(status) : 0);
  }
  const mySession = session;
  if (celebrate) {
    const card = $('res-card');
    card.classList.remove('celebrate');
    void card.offsetWidth;
    card.classList.add('celebrate');
    createMapleFlourish(mySession);
    countUpResult(startingScores, finalScores, mySession);
    if (status.tie) sound.tie();
    else {
      const won = mode === 'pass'
        || (mode === 'online' ? status.winner === online.myPlayer : status.winner === SOUTH);
      if (won) sound.win();
      else sound.lose();
    }
  }
  ($('againBtn').classList.contains('hidden') ? $('resMenuBtn') : $('againBtn'))
    .focus({ preventScroll: true });
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
    dismissPreviewHint();
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

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  rePop(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('pop'); }, 2600);
}

/* ============================== save / resume ============================== */
// The engine state is plain JSON — stash it whole, revive it whole. This is
// the same serialization online multiplayer rides on.

function saveGame() {
  if (mode === 'online') return;
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

/* ============================== online play ============================== */
// Two phones share one plain engine state through the fleet rooms layer.
// Seat 0 is South (the host and createInitialState()'s opening player);
// seat 1 is North. Remote moves, rematches, and conflict truth repaint cold.

const onlinePanel = $('onlinePanel');
const opTitle = $('opTitle');
const opName = $('opName');
const opCodeWrap = $('opCodeWrap');
const opCode = $('opCode');
const opError = $('opError');
const lobbyEl = $('lobby');
const lobbyCode = $('lobbyCode');
const rejoinBtn = $('rejoinBtn');
let panelIntent = 'host';

$('hostBtn').addEventListener('click', () => openPanel('host'));
$('joinBtn').addEventListener('click', () => openPanel('join'));
$('opCancel').addEventListener('click', closePanel);
$('opGo').addEventListener('click', onlineGo);
$('lobbyCancel').addEventListener('click', cancelLobby);
rejoinBtn.addEventListener('click', rejoinCrew);
opCode.addEventListener('input', () => {
  opCode.value = opCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
[opName, opCode].forEach((el) => el.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') onlineGo();
}));

function openPanel(intent) {
  panelIntent = intent;
  opTitle.textContent = intent === 'host' ? 'START A SAP CREW' : 'JOIN A SAP CREW';
  $('opGo').textContent = intent === 'host' ? 'GET A CODE' : 'TAP IN';
  opCodeWrap.classList.toggle('hidden', intent === 'host');
  opError.classList.add('hidden');
  opName.value = opName.value || getName();
  onlinePanel.classList.remove('hidden');
  (intent === 'join' && opName.value ? opCode : opName).focus();
}

function closePanel() {
  onlinePanel.classList.add('hidden');
}

const FRIENDLY_ERRORS = {
  not_found: 'No sap crew with that code — double-check the letters.',
  room_full: 'That sugarhouse is already full.',
  room_started: 'That crew already started tapping without you.',
  not_ready: "Online play isn't switched on yet — check back soon!",
  offline: "Can't reach the sugarhouse — are you online?",
};

function friendly(err) {
  if (err && err.code === 'wrong_game') {
    return `That code is for ${String(err.detail || 'another game').replace(/-/g, ' ')} — head there to use it.`;
  }
  return (err && FRIENDLY_ERRORS[err.code]) || 'The sap line got crossed — please try again.';
}

async function onlineGo() {
  if ($('opGo').disabled) return; // Enter key can't double-submit
  const name = opName.value.trim();
  if (!name) {
    opError.textContent = 'Every sugarmaker needs a name.';
    opError.classList.remove('hidden');
    opName.focus();
    return;
  }

  const go = $('opGo');
  go.disabled = true;
  opError.classList.add('hidden');
  try {
    if (panelIntent === 'host') {
      const match = await OnlineMatch.create({
        game: GAME, name, state: createInitialState(), seats: 2,
      });
      closePanel();
      openLobby(match);
    } else {
      const code = opCode.value.trim();
      if (code.length !== 4) {
        opError.textContent = 'The crew code is 4 letters.';
        opError.classList.remove('hidden');
        opCode.focus();
        return;
      }
      const match = await OnlineMatch.join({ game: GAME, code, name });
      closePanel();
      enterOnlineGame(match);
    }
  } catch (err) {
    opError.textContent = friendly(err);
    opError.classList.remove('hidden');
  } finally {
    go.disabled = false;
  }
}

function openLobby(match) {
  if (lobbyEl._match && lobbyEl._match !== match) lobbyEl._match.stop();
  lobbyCode.textContent = match.code;
  lobbyEl.classList.remove('hidden');
  match.start({
    onStatus: (status) => {
      if (status === 'playing') {
        lobbyEl.classList.add('hidden');
        enterOnlineGame(match);
      }
    },
    onError: () => {}, // a waiting-room hiccup can resolve on the next poll
  });
  lobbyEl._match = match;
}

function cancelLobby() {
  const match = lobbyEl._match;
  if (match) match.leave();
  lobbyEl._match = null;
  lobbyEl.classList.add('hidden');
  refreshRejoin();
}

async function rejoinCrew() {
  rejoinBtn.disabled = true;
  try {
    const match = await OnlineMatch.resume({ game: GAME });
    if (match.status === 'waiting') openLobby(match);
    else enterOnlineGame(match);
  } catch (err) {
    // Only a room that's truly gone forfeits the session — a flaky
    // connection must not delete the one path back to the game.
    if (err && (err.code === 'not_found' || err.code === 'not_seated' || err.code === 'room_started')) {
      clearSession(GAME);
      refreshRejoin();
    }
  } finally {
    rejoinBtn.disabled = false;
  }
}

function refreshRejoin() {
  const saved = savedSession(GAME);
  rejoinBtn.classList.toggle('hidden', !saved);
  if (saved) rejoinBtn.textContent = `↩ REJOIN SAP CREW (${saved.code})`;
}

function updateOnlineNames() {
  // Opponent names came from the room. Keep them in textContent only.
  $('nameS').textContent = playerName(SOUTH);
  $('nameN').textContent = playerName(NORTH);
  renderRace();
}

function enterOnlineGame(match) {
  session += 1;
  clearTransientEffects();
  mode = 'online';
  level = null;
  online = { match, myPlayer: match.seat };
  pollErrors = 0;
  state = match.state;
  view = state.pits.slice();
  busy = false;
  armed = -1;
  goAgainChain = 0;
  resetLbPanel();
  document.body.classList.remove('mode-pass');
  setBoardPerspective(online.myPlayer);
  updateOnlineNames();
  onlinePanel.classList.add('hidden');
  lobbyEl.classList.add('hidden');
  show('game');
  renderAll();
  updateTurnUI();
  if (state.current === online.myPlayer) showPreviewHintOnce();
  toast(state.current === online.myPlayer
    ? 'Your buckets are ready — you tap first 🍁'
    : `${playerName(state.current)} is tapping first 🍁`);
  match.start({
    onState: onRemoteState,
    onStatus: onRemoteStatus,
    onPresence: onRemotePresence,
    onError: onPollError,
  });
  if (match.status === 'over' && !getStatus(state).over) onRemoteStatus('over');
  else if (getStatus(state).over) finish(getStatus(state));
}

function rebuildOnlineBoard() {
  session += 1; // cancel any local sowing animation before accepting room truth
  clearTransientEffects();
  busy = false;
  armed = -1;
  goAgainChain = 0;
  clearPreview();
  for (const el of Object.values(pitEls)) el.classList.remove('lift', 'flash');
  view = state.pits.slice();
  setBoardPerspective(online.myPlayer);
  updateOnlineNames();
  show('game');
  renderAll();
  const status = getStatus(state);
  if (status.over) finish(status);
  else {
    updateTurnUI();
    if (state.current === online.myPlayer) showPreviewHintOnce();
  }
}

function onRemoteState(newState) {
  state = newState;
  rebuildOnlineBoard();
}

function onRemoteStatus(status) {
  if (status !== 'over' || getStatus(state).over) return;
  const opponent = online && online.match.opponents()[0];
  if (!opponent || !opponent.left) return;
  session += 1;
  clearTransientEffects();
  busy = false;
  $('res-title').textContent = 'SAP CREW ENDED';
  $('res-score').textContent =
    `${state.pits[STORE[online.myPlayer]]} – ${state.pits[STORE[1 - online.myPlayer]]}`;
  $('res-line').textContent = `${opponent.name || 'Your fellow sugarmaker'} left the sugarhouse.`;
  $('againBtn').classList.add('hidden');
  show('result');
  $('resMenuBtn').focus({ preventScroll: true });
}

function onRemotePresence(opponents) {
  pollErrors = 0; // this callback only fires on a successful poll
  if (!online) return;
  updateOnlineNames();
  const opponent = opponents[0];
  if (opponent && opponent.left) $('againBtn').classList.add('hidden');
  if (!busy && pollErrors === 0 && !getStatus(state).over) updateTurnUI();
}

function onPollError(err) {
  if (err && err.code === 'not_found') {
    if (online) online.match.stop();
    clearSession(GAME);
    online = null;
    mode = null;
    document.body.classList.remove('turn-north');
    setBoardPerspective(SOUTH);
    show('menu');
    return;
  }
  pollErrors += 1;
  if (pollErrors >= 3 && !getStatus(state).over) {
    toast('Sap line is shaky — hang tight…');
  }
}

async function pushOnline(attemptedState) {
  const activeOnline = online;
  try {
    await activeOnline.match.push(attemptedState, { over: getStatus(attemptedState).over });
    pollErrors = 0;
  } catch (err) {
    if (err && err.code === 'version_conflict') {
      state = activeOnline.match.state;
      rebuildOnlineBoard();
      return;
    }
    // One calm retry. If room truth changed meanwhile, discard this attempt.
    setTimeout(async () => {
      if (online !== activeOnline || state !== attemptedState) return;
      try {
        await activeOnline.match.push(attemptedState, { over: getStatus(attemptedState).over });
        pollErrors = 0;
      } catch (retryErr) {
        onPollError(retryErr);
      }
    }, 1500);
  }
}

async function onlineRematch() {
  if (!online) return;
  const fresh = createInitialState();
  state = fresh;
  rebuildOnlineBoard();
  try {
    await online.match.push(fresh, {});
    pollErrors = 0;
    updateTurnUI();
  } catch (err) {
    if (err && err.code === 'version_conflict') {
      state = online.match.state;
      rebuildOnlineBoard();
    } else {
      onPollError(err);
    }
  }
}

function backToMenu(button) {
  if (!online) {
    show('menu');
    return;
  }
  if (button.dataset.armed !== '1') {
    button.dataset.armed = '1';
    button.dataset.originalLabel = button.textContent;
    button.textContent = 'LEAVE SAP CREW?';
    setTimeout(() => {
      if (button.dataset.armed !== '1') return;
      button.dataset.armed = '';
      button.textContent = button.dataset.originalLabel;
    }, 2500);
    return;
  }
  const match = online.match;
  online = null;
  mode = null;
  match.leave();
  button.dataset.armed = '';
  button.textContent = button.dataset.originalLabel;
  document.body.classList.remove('turn-north');
  setBoardPerspective(SOUTH);
  show('menu');
}

/* ============================== screens ============================== */

function show(id) {
  for (const s of ['menu', 'game', 'result']) $(s).classList.toggle('hidden', s !== id);
  if (id === 'menu') {
    session += 1; // stop any animation still running behind the menu
    clearTransientEffects();
    busy = false;
    $('resumeBtn').classList.toggle('hidden', !loadSave());
    refreshRejoin();
  }
}

$('passBtn').addEventListener('click', () => startGame('pass', null));
$('easyBtn').addEventListener('click', () => startGame('bot', 'sap-run'));
$('hardBtn').addEventListener('click', () => startGame('bot', 'sugarmaker'));
$('resumeBtn').addEventListener('click', () => {
  const save = loadSave();
  if (save) startGame(save.mode, save.level, save.state);
});
$('menuBtn').addEventListener('click', () => backToMenu($('menuBtn')));
$('againBtn').addEventListener('click', () => {
  if (online) onlineRematch();
  else startGame(mode, level);
});
$('resMenuBtn').addEventListener('click', () => backToMenu($('resMenuBtn')));
$('previewHintClose').addEventListener('click', dismissPreviewHint);

$('mute').addEventListener('click', () => {
  sound.unlock();
  $('mute').textContent = sound.toggleMute() ? '🔇' : '🔊';
});
$('mute').textContent = sound.muted ? '🔇' : '🔊';

show('menu');

/* ------------------------------------------------- crew-link invites */
// Text a link instead of reading letters aloud: ?join=ABCD opens the join
// panel with the code filled in, then scrubs the URL so refreshes don't
// re-trigger it. Canonical pattern: four-in-a-rowboat (ROOMS-INTEGRATION §6).

$('inviteBtn').addEventListener('click', async () => {
  const code = ($('lobbyCode').textContent || '').trim();
  if (!code) return;
  const url = `${location.origin}${location.pathname}?join=${code}`;
  const text = `🌰 Race me bucket for bucket — tap to join my Maple Mancala game: ${url}`;
  try {
    if (navigator.share && /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)) {
      await navigator.share({ text });
    } else {
      await navigator.clipboard.writeText(url);
      $('inviteBtn').textContent = '✓ LINK COPIED';
      setTimeout(() => { $('inviteBtn').textContent = '📲 SEND AN INVITE'; }, 1800);
    }
  } catch { /* share sheet closed */ }
});

(() => {
  const code = new URLSearchParams(location.search).get('join');
  if (!code || !/^[A-Za-z0-9]{4}$/.test(code)) return;
  history.replaceState(null, '', location.pathname);
  openPanel('join');
  $('opCode').value = code.toUpperCase();
})();

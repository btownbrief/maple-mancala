// MAPLE MANCALA — the two bots. Only ever calls the engine's public API;
// no rule logic lives here, so the bots can never disagree with the board.
//
//   sap-run     easy — greedy for the obvious sweet move, with enough
//               randomness to stay beatable
//   sugarmaker  hard — minimax with alpha-beta pruning, iteratively
//               deepened from 6 up to 12 plies under a time budget: the
//               floor pass always completes (a few ms), deeper passes run
//               only while the clock allows, so even a slow phone answers
//               inside the promised ~300ms

import { legalMoves, describeMove, getStatus, STORE, ownPits } from './engine.js';

export const LEVELS = {
  'sap-run': { name: 'Sap Run', blurb: 'first-year tapper, easily distracted' },
  'sugarmaker': { name: 'Sugarmaker', blurb: 'thinks twelve moves deep' },
};

// rng is injectable so tests can be deterministic; the UI passes Math.random.
export function chooseMove(state, level, rng = Math.random) {
  const moves = legalMoves(state);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];
  return level === 'sugarmaker' ? sugarmaker(state) : sapRun(state, moves, rng);
}

/* ============================ Sap Run ============================ */
// Greedy one-ply: loves extra turns and captures, but about a third of
// the time it daydreams and plays a random pit.

function sapRun(state, moves, rng) {
  if (rng() < 0.35) return moves[Math.floor(rng() * moves.length)];
  let best = moves[0];
  let bestScore = -Infinity;
  for (const move of moves) {
    const fx = describeMove(state, move);
    const banked = fx.state.pits[STORE[state.current]] - state.pits[STORE[state.current]];
    const score = banked + (fx.extraTurn ? 3 : 0) + rng(); // rng breaks ties
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

/* =========================== Sugarmaker =========================== */

const MIN_DEPTH = 6;  // this pass always runs to completion — a few ms
const MAX_DEPTH = 12; // plies; branching factor ≤ 6 and alpha-beta prunes hard
const TIME_BUDGET_MS = 250;

// Search bookkeeping for the time budget. The clock lives here in bot.js —
// the engine itself stays clock-free and pure.
let deadline = 0;
let abortable = false;
let aborted = false;
let nodeCount = 0;

function now() {
  return (typeof performance !== 'undefined' ? performance : Date).now();
}

function sugarmaker(state) {
  deadline = now() + TIME_BUDGET_MS;
  let best = null;
  for (let depth = MIN_DEPTH; depth <= MAX_DEPTH; depth++) {
    abortable = depth > MIN_DEPTH;
    aborted = false;
    nodeCount = 0;
    const move = rootSearch(state, depth);
    if (aborted) break; // out of time mid-pass: keep the previous depth's answer
    best = move;
    if (now() >= deadline) break;
  }
  return best;
}

function rootSearch(state, depth) {
  const me = state.current;
  let best = null;
  let alpha = -Infinity;
  for (const { move, fx } of orderedMoves(state)) {
    const value = search(fx.state, depth - 1, alpha, Infinity, me);
    if (aborted) break;
    if (value > alpha) {
      alpha = value;
      best = move;
    }
  }
  return best;
}

function search(state, depth, alpha, beta, me) {
  if (abortable && (++nodeCount & 1023) === 0 && now() >= deadline) {
    aborted = true;
  }
  if (aborted) return 0; // value is discarded once aborted

  const status = getStatus(state);
  if (status.over) {
    // Won games score by margin; finishing sooner (higher depth left) is
    // worth a nudge so the bot closes games out instead of toying.
    return (status.scores[me] - status.scores[1 - me]) * 1000 + depth;
  }
  if (depth === 0) return evaluate(state, me);

  // Extra turns keep state.current unchanged, so who is maximizing follows
  // the state itself rather than alternating by depth.
  const maximizing = state.current === me;
  let value = maximizing ? -Infinity : Infinity;
  for (const { fx } of orderedMoves(state)) {
    const v = search(fx.state, depth - 1, alpha, beta, me);
    if (aborted) return 0;
    if (maximizing) {
      value = Math.max(value, v);
      alpha = Math.max(alpha, value);
    } else {
      value = Math.min(value, v);
      beta = Math.min(beta, value);
    }
    if (alpha >= beta) break;
  }
  return value;
}

// Trying extra-turn and capture moves first makes alpha-beta cut far more.
function orderedMoves(state) {
  return legalMoves(state)
    .map((move) => ({ move, fx: describeMove(state, move) }))
    .sort((a, b) => quickScore(b) - quickScore(a));
}

function quickScore({ fx }) {
  return (fx.extraTurn ? 10 : 0) + (fx.capture ? fx.capture.seeds : 0);
}

function evaluate(state, me) {
  const p = state.pits;
  const storeDiff = p[STORE[me]] - p[STORE[1 - me]];
  let sideDiff = 0;
  for (const pit of ownPits(me)) sideDiff += p[pit];
  for (const pit of ownPits(1 - me)) sideDiff -= p[pit];
  return storeDiff * 4 + sideDiff; // banked drops beat drops still in play
}

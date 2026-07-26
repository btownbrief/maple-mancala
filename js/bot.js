// MAPLE MANCALA — the two bots. Only ever calls the engine's public API;
// no rule logic lives here, so the bots can never disagree with the board.
//
//   sap-run     easy — greedy for the obvious sweet move, with enough
//               randomness to stay beatable
//   sugarmaker  hard — minimax with alpha-beta pruning, 12 plies deep
//               (Kalah is cheap to search), still well under ~300ms

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

const DEPTH = 12; // plies; branching factor ≤ 6 and alpha-beta prunes hard

function sugarmaker(state) {
  const me = state.current;
  let best = null;
  let alpha = -Infinity;
  for (const { move, fx } of orderedMoves(state)) {
    const value = search(fx.state, DEPTH - 1, alpha, Infinity, me);
    if (value > alpha) {
      alpha = value;
      best = move;
    }
  }
  return best;
}

function search(state, depth, alpha, beta, me) {
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

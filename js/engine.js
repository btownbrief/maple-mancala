// MAPLE MANCALA — the rules of Kalah, and nothing else.
//
// Every function here is pure and operates on a plain JSON-serializable
// state object:
//
//   { pits: number[14], current: 0 | 1 }
//
// Pit indices run in sowing order around the board:
//   0–5   South's six pits          6   South's store (sap bucket barn)
//   7–12  North's six pits          13  North's store
//
// This file imports nothing and never touches the DOM, timers, Date, or
// Math.random. applyMove() returns a NEW state and never mutates its input.
// The whole game must survive JSON.stringify → JSON.parse → resume: online
// multiplayer will later sync this exact state object between phones, so
// any rule logic living outside this file breaks that plan.

export const SOUTH = 0;
export const NORTH = 1;
export const STORE = [6, 13];               // STORE[player]
const OWN_PITS = [[0, 1, 2, 3, 4, 5], [7, 8, 9, 10, 11, 12]];

export function createInitialState() {
  const pits = new Array(14).fill(4);       // four maple drops in every pit…
  pits[STORE[SOUTH]] = 0;
  pits[STORE[NORTH]] = 0;                   // …and empty stores
  return { pits, current: SOUTH };
}

export function ownPits(player) {
  return OWN_PITS[player].slice();
}

export function oppositePit(pit) {
  return 12 - pit;
}

export function legalMoves(state) {
  if (sideEmpty(state.pits, SOUTH) || sideEmpty(state.pits, NORTH)) return [];
  return OWN_PITS[state.current].filter((p) => state.pits[p] > 0);
}

// The full account of one move — the new state plus everything the UI needs
// to animate it (sowing path, extra turn, capture, endgame sweep). All still
// pure: applyMove() below is just describeMove().state.
export function describeMove(state, move) {
  if (!legalMoves(state).includes(move)) {
    throw new Error(`illegal move: pit ${move} for player ${state.current}`);
  }
  const pits = state.pits.slice();
  const me = state.current;
  const opp = 1 - me;

  // Pick up every seed and sow one per pit counter-clockwise,
  // dropping into your own store but skipping the opponent's.
  let inHand = pits[move];
  pits[move] = 0;
  const path = [];
  let pos = move;
  while (inHand > 0) {
    pos = (pos + 1) % 14;
    if (pos === STORE[opp]) continue;
    pits[pos] += 1;
    path.push(pos);
    inHand -= 1;
  }

  const last = path[path.length - 1];
  const extraTurn = last === STORE[me];

  // Capture: last seed landed in one of MY pits that was empty (holds
  // exactly the one seed now) and the opposite pit has seeds — take both.
  let capture = null;
  if (!extraTurn && OWN_PITS[me].includes(last) && pits[last] === 1) {
    const opposite = oppositePit(last);
    if (pits[opposite] > 0) {
      capture = { pit: last, opposite, seeds: pits[opposite] + 1 };
      pits[STORE[me]] += capture.seeds;
      pits[last] = 0;
      pits[opposite] = 0;
    }
  }

  // Endgame sweep: the moment either side's six pits are all empty, the
  // other player banks every seed still sitting on their side.
  let sweep = null;
  if (sideEmpty(pits, SOUTH) || sideEmpty(pits, NORTH)) {
    const drained = sideEmpty(pits, SOUTH) ? SOUTH : NORTH;
    const other = 1 - drained;
    let swept = 0;
    for (const p of OWN_PITS[other]) {
      swept += pits[p];
      pits[p] = 0;
    }
    pits[STORE[other]] += swept;
    sweep = { player: other, seeds: swept };
  }

  return {
    state: { pits, current: extraTurn ? me : opp },
    path,
    extraTurn,
    capture,
    sweep,
  };
}

export function applyMove(state, move) {
  return describeMove(state, move).state;
}

export function getStatus(state) {
  const scores = [state.pits[STORE[SOUTH]], state.pits[STORE[NORTH]]];
  // After the sweep in describeMove, a finished game always has every pit
  // empty — all 48 drops are in the two stores.
  const over = sideEmpty(state.pits, SOUTH) && sideEmpty(state.pits, NORTH);
  let winner = null;
  if (over && scores[SOUTH] !== scores[NORTH]) {
    winner = scores[SOUTH] > scores[NORTH] ? SOUTH : NORTH;
  }
  return { over, scores, winner, tie: over && scores[SOUTH] === scores[NORTH] };
}

function sideEmpty(pits, player) {
  return OWN_PITS[player].every((p) => pits[p] === 0);
}

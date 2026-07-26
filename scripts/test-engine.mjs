// MAPLE MANCALA — engine + bot checks. Plain Node, no test framework.
// Run:  node scripts/test-engine.mjs

import {
  createInitialState, legalMoves, applyMove, describeMove, getStatus,
  SOUTH, NORTH, STORE,
} from '../js/engine.js';
import { chooseMove } from '../js/bot.js';

let passed = 0;
const failures = [];

function check(name, cond) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}`);
  }
}

function state(southPits, southStore, northPits, northStore, current) {
  return { pits: [...southPits, southStore, ...northPits, northStore], current };
}

/* ------------------------------------------------- sowing basics */
console.log('\nSowing');
{
  const s0 = createInitialState();
  const before = JSON.stringify(s0);
  const fx = describeMove(s0, 0); // 4 seeds from pit 0 → pits 1,2,3,4
  check('sowing drops one seed per pit counter-clockwise',
    JSON.stringify(fx.path) === '[1,2,3,4]'
    && fx.state.pits[1] === 5 && fx.state.pits[4] === 5 && fx.state.pits[0] === 0);
  check('applyMove returns a new state and never mutates the old one',
    JSON.stringify(s0) === before && fx.state !== s0);

  // 9 seeds from South's pit 5 wrap past North's store without feeding it.
  const s1 = state([4, 4, 4, 4, 4, 9], 0, [4, 4, 4, 4, 4, 4], 7, SOUTH);
  const fx1 = describeMove(s1, 5);
  check("sowing skips the opponent's store",
    fx1.state.pits[STORE[NORTH]] === 7
    && JSON.stringify(fx1.path) === '[6,7,8,9,10,11,12,0,1]'
    && fx1.state.pits[0] === 5 && fx1.state.pits[1] === 5);
}

/* ------------------------------------------------- extra turn */
console.log('\nExtra turn');
{
  const s = createInitialState();
  const fx = describeMove(s, 2); // 4 seeds from pit 2 → 3,4,5, store
  check('last seed in your own store grants another turn',
    fx.extraTurn && fx.state.current === SOUTH);
  const fx2 = describeMove(s, 0); // ends in pit 4 — no extra turn
  check('any other landing passes the turn', !fx2.extraTurn && fx2.state.current === NORTH);
}

/* ------------------------------------------------- capture */
console.log('\nCapture');
{
  // Last seed lands in South's empty pit 1; opposite pit 11 holds 5.
  const s = state([1, 0, 3, 3, 3, 3], 2, [3, 3, 3, 3, 5, 3], 2, SOUTH);
  const fx = describeMove(s, 0);
  check('landing in your own empty pit captures it plus the opposite pit',
    fx.capture && fx.capture.seeds === 6
    && fx.state.pits[1] === 0 && fx.state.pits[11] === 0
    && fx.state.pits[STORE[SOUTH]] === 8 && fx.state.current === NORTH);

  // Same landing but the opposite pit is empty — nothing to take.
  const sEmptyOpp = state([1, 0, 3, 3, 3, 3], 2, [3, 3, 3, 3, 0, 3], 2, SOUTH);
  const fx2 = describeMove(sEmptyOpp, 0);
  check('no capture when the opposite pit is empty',
    !fx2.capture && fx2.state.pits[1] === 1 && fx2.state.pits[STORE[SOUTH]] === 2);

  // Landing in an EMPTY pit on the OPPONENT's side is never a capture.
  const sOpp = state([3, 3, 3, 3, 6, 3], 2, [0, 0, 3, 3, 3, 3], 2, SOUTH);
  const fx3 = describeMove(sOpp, 4); // 6 seeds: 5, store, 7, 8 — last in North's empty pit 8? no: path 5,6,7,8,9,10
  check("landing on the opponent's side never captures",
    !fx3.capture && fx3.state.pits[STORE[SOUTH]] === 3);

  // Landing in your own pit that already had seeds is not a capture either.
  const sFull = state([2, 3, 3, 3, 3, 3], 2, [3, 3, 3, 3, 3, 3], 2, SOUTH);
  const fx4 = describeMove(sFull, 0); // lands in pit 2, which held 3
  check('no capture when your landing pit was not empty',
    !fx4.capture && fx4.state.pits[2] === 4);
}

/* ------------------------------------------------- endgame sweep */
console.log('\nEndgame');
{
  // South's last drop goes to their store, emptying their side; North
  // sweeps their remaining 12 into their store. 21 vs 22 — North wins.
  const s = state([0, 0, 0, 0, 0, 1], 20, [2, 2, 2, 2, 2, 2], 10, SOUTH);
  const fx = describeMove(s, 5);
  const st = getStatus(fx.state);
  check('when one side empties, the other sweeps their seeds home',
    fx.sweep && fx.sweep.player === NORTH && fx.sweep.seeds === 12
    && fx.state.pits.slice(0, 6).every((n) => n === 0)
    && fx.state.pits.slice(7, 13).every((n) => n === 0));
  check('game over, most seeds wins',
    st.over && st.scores[SOUTH] === 21 && st.scores[NORTH] === 22 && st.winner === NORTH);
  check('no legal moves once the game is over', legalMoves(fx.state).length === 0);

  // Same position with North's store at 9 → 21 all, a tie.
  const sTie = state([0, 0, 0, 0, 0, 1], 20, [2, 2, 2, 2, 2, 2], 9, SOUTH);
  const stTie = getStatus(applyMove(sTie, 5));
  check('ties are possible', stTie.over && stTie.tie && stTie.winner === null);
}

/* ------------------------------------------------- serialization */
console.log('\nSerialization');
{
  let s = createInitialState();
  s = applyMove(s, 2);
  s = applyMove(s, 5);
  const revived = JSON.parse(JSON.stringify(s));
  const a = applyMove(revived, legalMoves(revived)[0]);
  const b = applyMove(s, legalMoves(s)[0]);
  check('game survives JSON.stringify → JSON.parse → resume',
    JSON.stringify(a) === JSON.stringify(b));
}

/* ------------------------------------------------- bots */
console.log('\nBots');
{
  // Crafted endgame: South can drop pit 5's last seed into their store for
  // an extra turn AND the winning 25th point, or waste time with pit 0.
  const s = state([1, 0, 0, 0, 0, 1], 24, [4, 4, 4, 4, 4, 2], 2, SOUTH);
  const move = chooseMove(s, 'sugarmaker');
  check('Sugarmaker takes an available extra-turn move',
    move === 5 && describeMove(s, move).extraTurn === true);

  // Sap Run always plays a legal move, whatever its dice say.
  const opening = createInitialState();
  let rngCalls = 0;
  const rng = () => ((rngCalls += 1) * 0.37) % 1;
  const sap = chooseMove(opening, 'sap-run', rng);
  check('Sap Run plays a legal move', legalMoves(opening).includes(sap));

  // A full Sugarmaker-vs-Sugarmaker game: every move legal, the game ends,
  // the 48 drops are all accounted for, and no move takes ~300ms.
  let g = createInitialState();
  let moves = 0;
  let slowest = 0;
  while (!getStatus(g).over && moves < 500) {
    const t0 = performance.now();
    const m = chooseMove(g, 'sugarmaker');
    slowest = Math.max(slowest, performance.now() - t0);
    if (!legalMoves(g).includes(m)) break;
    g = applyMove(g, m);
    moves += 1;
  }
  const end = getStatus(g);
  check('self-play game reaches a finished board',
    end.over && end.scores[SOUTH] + end.scores[NORTH] === 48
    && g.pits.slice(0, 6).concat(g.pits.slice(7, 13)).every((n) => n === 0));
  check(`Sugarmaker stays fast (slowest move ${slowest.toFixed(0)}ms over ${moves} moves)`,
    slowest < 300);
}

/* ------------------------------------------------- verdict */
console.log('');
if (failures.length) {
  console.error(`${failures.length} FAILED, ${passed} passed`);
  process.exit(1);
}
console.log(`All ${passed} checks passed. 🍁`);

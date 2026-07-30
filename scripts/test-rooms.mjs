// Maple Mancala online-rooms wiring test: drives the real vendored client
// against the local shim as two simulated phones, then plays a full random
// game through the real engine. No network or Supabase is involved.
//
//   node scripts/test-rooms.mjs

import { createRooms } from './rooms-shim.mjs';
import {
  createInitialState, legalMoves, applyMove, getStatus, SOUTH, NORTH,
} from '../js/engine.js';

const GAME = 'maple-mancala';
const CAP = 400;

/* ------------------------------------------------- two-phone environment */

const stores = new Map();
let current = 'A';
globalThis.localStorage = {
  getItem: (key) => (stores.get(current).has(key) ? stores.get(current).get(key) : null),
  setItem: (key, value) => stores.get(current).set(key, String(value)),
  removeItem: (key) => stores.get(current).delete(key),
};
function device(id) {
  if (!stores.has(id)) stores.set(id, new Map());
  current = id;
}
device('A');
device('B');

let passed = 0;
function t(condition, label) {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`  ok — ${label}`);
}
async function expectCode(promise, code, label) {
  try {
    await promise;
    t(false, `${label} (no error thrown)`);
  } catch (err) {
    t(err && err.code === code, `${label} (got ${err && err.code})`);
  }
}

// This workspace cannot bind localhost ports, so route fetch calls directly
// through the shim's same RPC handlers. The real rooms client still performs
// its normal HTTP-shaped requests and parses normal Response objects.
const shim = createRooms();
globalThis.BTOWN_ROOMS_URL = 'http://rooms-shim.test';
globalThis.fetch = async (url, options = {}) => {
  if (String(url).startsWith('http://not-ready.test/')) {
    return new Response('{}', { status: 404 });
  }
  const match = String(url).match(/\/rest\/v1\/rpc\/(\w+)$/);
  if (!match || !shim.rpcs[match[1]]) {
    return new Response(JSON.stringify({ message: 'not a room rpc' }), { status: 404 });
  }
  try {
    const body = shim.rpcs[match[1]](JSON.parse(options.body || '{}')) ?? {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ message: err.message }), {
      status: err.rpc ? 400 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
const { OnlineMatch, savedSession } = await import('../js/rooms.js');

/* ------------------------------------------------------------ the tests */

// Create + join: seat number is the engine player number.
device('A');
const host = await OnlineMatch.create({
  game: GAME, name: 'Maple A', state: createInitialState(), seats: 2,
});
t(
  /^[A-Z2-9]{4}$/.test(host.code)
    && host.seat === SOUTH
    && host.state.current === SOUTH
    && host.status === 'waiting',
  'host creates room in seat 0 and owns the opening move',
);
t(savedSession(GAME)?.roomId === host.roomId, 'host session saved');

device('B');
await expectCode(
  OnlineMatch.join({ game: GAME, code: 'ZZZZ', name: 'X' }),
  'not_found',
  'bad code rejected',
);
await expectCode(
  OnlineMatch.join({ game: 'four-in-a-rowboat', code: host.code, name: 'X' }),
  'wrong_game',
  'wrong game rejected',
);
const guest = await OnlineMatch.join({
  game: GAME, code: ` ${host.code.toLowerCase()} `, name: 'Maple B',
});
t(guest.seat === NORTH && guest.status === 'playing', 'guest joins seat 1 and game starts');
t(
  guest.opponents().length === 1 && guest.opponents()[0].name === 'Maple A',
  'guest sees host name',
);

device('A');
await host._fetch();
t(
  host.status === 'playing' && host.opponents()[0].name === 'Maple B',
  'host poll sees game start and guest name',
);

// Referee: push, sync, and reject a stale version.
const firstState = applyMove(host.state, legalMoves(host.state)[0]);
await host.push(firstState);
t(host.version === 1, 'host pushes move, version 1');

device('B');
await guest._fetch();
t(
  JSON.stringify(guest.state) === JSON.stringify(firstState)
    && guest.state.current === NORTH,
  'guest poll receives the opening move',
);
const replyState = applyMove(guest.state, legalMoves(guest.state)[0]);
await guest.push(replyState);
t(guest.version === 2, 'guest pushes reply, version 2');

device('A');
const staleState = applyMove(firstState, legalMoves(firstState)[0]);
await expectCode(host.push(staleState), 'version_conflict', 'stale push rejected');
t(
  host.version === 2 && JSON.stringify(host.state) === JSON.stringify(replyState),
  'conflict refetches the room truth',
);

// Full game: seeded random legal moves, with both phones syncing every turn.
device('B');
await guest._fetch();
const phones = {
  [SOUTH]: { match: host, id: 'A' },
  [NORTH]: { match: guest, id: 'B' },
};
let seed = 0x4d41504c;
function randomMove(moves) {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return moves[seed % moves.length];
}

let movesPlayed = 0;
while (!getStatus(host.state).over && movesPlayed < CAP) {
  t(
    JSON.stringify(host.state) === JSON.stringify(guest.state),
    `phones synced before move ${movesPlayed + 1}`,
  );
  const phone = phones[host.state.current];
  device(phone.id);
  await phone.match._fetch();
  const move = randomMove(legalMoves(phone.match.state));
  const next = applyMove(phone.match.state, move);
  await phone.match.push(next, { over: getStatus(next).over });

  device('A');
  await host._fetch();
  device('B');
  await guest._fetch();
  movesPlayed += 1;
}

const finished = getStatus(host.state).over;
t(
  JSON.stringify(host.state) === JSON.stringify(guest.state),
  `phones have identical state after ${movesPlayed} random moves`,
);
t(
  finished ? host.status === 'over' : movesPlayed === CAP,
  finished ? 'full online game reaches engine game-over' : `cap of ${CAP} moves exits cleanly`,
);

// Rematch: either phone can push a fresh engine state into a finished room.
if (finished) {
  device('B');
  const priorVersion = guest.version;
  await guest.push(createInitialState(), {});
  t(
    guest.status === 'playing'
      && guest.version === priorVersion + 1
      && guest.state.current === SOUTH,
    'guest starts a rematch with the normal host-first engine state',
  );
}

// Resume after a refresh.
device('A');
const resumed = await OnlineMatch.resume({ game: GAME });
t(
  resumed.roomId === host.roomId && resumed.seat === SOUTH,
  'resume reattaches host to the room',
);

// Leave: other phone sees it and the local session disappears.
await resumed.leave();
t(savedSession(GAME) === null, 'leave clears the session');
device('B');
await guest._fetch();
t(
  guest.status === 'over' && guest.opponents()[0].left === true,
  'guest sees host left',
);

// A full room turns away a third phone.
device('A');
const secondHost = await OnlineMatch.create({
  game: GAME, name: 'A', state: createInitialState(),
});
device('B');
await OnlineMatch.join({ game: GAME, code: secondHost.code, name: 'B' });
device('C');
await expectCode(
  OnlineMatch.join({ game: GAME, code: secondHost.code, name: 'C' }),
  'room_started',
  'third phone turned away',
);

// Missing backend SQL becomes a clean not_ready error.
globalThis.BTOWN_ROOMS_URL = 'http://not-ready.test';
const fresh = await import('../js/rooms.js?not-ready');
await expectCode(
  fresh.OnlineMatch.create({ game: GAME, name: 'A', state: {} }),
  'not_ready',
  'missing backend reads as not_ready',
);

console.log(`\nALL ROOMS TESTS PASSED (${passed} checks)`);
process.exit(0);

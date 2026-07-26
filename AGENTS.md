# Maple Mancala — agent instructions

Shared brain for any AI agent working in this repo (Codex, Claude Code, etc.).
Read `README.md` first for the rules and architecture — this file adds the
rules an agent needs. Stephen is non-technical — explain consequential
changes in plain language.

## What this is

Mancala (exact Kalah rules) dressed in Vermont maple: sap buckets, candy
drops, pass-and-play plus two bot levels. Plain static site, **no build
step**: `index.html` + `style.css` + ES modules in `js/`. Deployed by GitHub
Pages via `.github/workflows/deploy.yml` on push.

## The one non-negotiable

**Every rule lives in `js/engine.js` as pure functions over a plain
JSON-serializable state object** (`createInitialState`, `legalMoves`,
`applyMove` — returns a NEW state, never mutates — `describeMove`,
`getStatus`). engine.js imports nothing and never touches the DOM, timers,
Date, or Math.random. The whole game must survive
`JSON.stringify → JSON.parse → resume` (the save/resume feature already
rides on this). Online multiplayer will later sync this exact state object
between phones — any rule logic that leaks into `main.js` or `bot.js`
breaks that plan. `js/bot.js` may only call the engine's public API;
`js/main.js` is UI only.

## The moving parts

- `js/engine.js` — the rules (see above; touch with care, run the tests)
- `js/bot.js` — Sap Run (greedy + randomness) and Sugarmaker (alpha-beta
  minimax, 12 plies, must stay under ~300ms a move on a phone)
- `js/main.js` — board DOM, sowing animation, landing preview, localStorage
  save/resume, mode/turn flow
- `js/audio.js` — procedural WebAudio, no audio files

## Before you finish

Run `node scripts/test-engine.mjs` — it must pass. If you changed the
engine or bots, keep those tests honest (they assert the rules themselves,
not implementation details) and extend them for anything new. If you
changed the UI, play at least one full game at a phone-sized viewport, or
clearly say you could not and what you inspected instead. Say what you
verified.

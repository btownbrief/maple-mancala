# 🍁 MAPLE MANCALA

The world's oldest board game, Vermont-ified: the board is a maple plank,
the pits are sap buckets, and the seeds are maple-candy drops. Part of the
[Btown Games](https://play.btownbrief.com) arcade from the
[BTown Brief](https://www.btownbrief.com).

**Play it live:** https://play.btownbrief.com/maple-mancala/

## How to play (Kalah rules)

Tap one of your six buckets to scoop up its drops and sow them one per
bucket counter-clockwise — including your own big bucket, skipping your
opponent's. Land the last drop:

- **in your big bucket** → take another turn
- **in an empty bucket of yours** (with drops across from it) → capture
  that drop plus everything opposite

When either side runs dry, the other player banks whatever's left on their
side. Most drops wins; ties are possible. Press & hold a bucket to preview
where your last drop lands.

**Modes:** pass-and-play on one phone (the top player's bucket flips to
face them), or vs. two bots — **Sap Run** (easygoing, greedy with a wandering
mind) and **Sugarmaker** (minimax with alpha-beta pruning, 12 moves deep,
still under ~300ms a move).

## How it works

Plain static site — no build step. `index.html` + `style.css` + ES modules in `js/`:

| file | what it does |
| --- | --- |
| `js/engine.js` | ALL the rules, as pure functions over a plain JSON state — see AGENTS.md before touching |
| `js/bot.js` | the two bots; only ever calls the engine's public API |
| `js/main.js` | UI: board DOM, the sowing animation, landing preview, save/resume |
| `js/audio.js` | procedural WebAudio sfx, no audio files |
| `js/leaderboard.js` | monthly leaderboard client (Supabase); vs-bot wins only, no accounts |

Every push to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.

## Tests

```bash
node scripts/test-engine.mjs
```

Plain Node, no framework. Covers sowing, the extra turn, the capture rule,
the endgame sweep, winner/tie math, serialization round-trips, and both bots
(including a speed check on Sugarmaker).

## Regenerating the social/app images

`og-image.png` and `icon-180.png` are rendered by `tools/og.html`:

```bash
python3 -m http.server 8000  # from the repo root
chrome --headless --screenshot=og-image.png --window-size=1200,630 "http://localhost:8000/tools/og.html"
chrome --headless --screenshot=icon-180.png --window-size=180,180 "http://localhost:8000/tools/og.html?icon"
```

# AGENTS.md — Physics Tetris

> Compact, repo-verified guide for OpenCode sessions. Specs (`demo.txt`, `README.md`) win
> on intent; executable code wins on facts. Where they diverge, the divergence is called out below.

## 1. Target architecture (authoritative — the model to build toward)

A tetromino has **two phases**. The transition between them is **contact-triggered**, never key-triggered.

```
Phase 1 — Kinematic (classic Tetris control while airborne)
  · auto-descends one cell per drop-tick (deterministic; no gravity/torque/COM)
  · player: MOVE_LEFT / MOVE_RIGHT / ROTATE_CW / SOFT_DROP (accelerate) / HARD_DROP (instant to contact)
  · movement uses collision-preview vs [platform, ...placed] — never overlaps the stack
        │
        │  first contact with platform OR any placed piece
        ▼
Phase 2 — Dynamic rigid body (real Matter.js physics)
  · Body.setStatic(false) + Sleeping.set(false)
  · gravity, friction, torque, COM, collisions, sleeping all active
  · player loses control; structure may slide / rotate / topple / collapse
```

This is the desired model — classic-Tetris kinematic descent until contact, then full rigid-body physics. It matches `demo.txt` Phase 1/2 and the original intent of this file's §6.

**This is now implemented** (migration complete — see §8). The kinematic piece auto-descends one cell per `DROP_INTERVAL_MS` (`SOFT_DROP` accelerates, `HARD_DROP` fast-forwards to contact); on first contact (`canDescend()==false`) it converts in place via `releaseActive`.

## 2. What this repo actually is (verified)

- **Single-process browser game.** No backend, no WebSocket, no Python, no Box2D/PyBullet. Game / physics / env / agent / renderer all run in one page in JS.
- **Physics engine:** Matter.js, vendored at `vendor/matter.min.js` (offline). API is the global `Matter`.
- **Entry:** `index.html`. Scripts load in **strict order — do not reorder** (globals depend on it):
  `vendor/matter.min.js` → `js/constants.js` → `shapes.js` → `physics.js` → `renderer.js` → `game.js` → `main.js`
- **No build step, no `package.json`, no tests, no lint/typecheck config, no CI.** Pure static files.

## 3. Run / develop

- Open `index.html` directly, or serve: `python3 -m http.server 8000` → http://localhost:8000
- Edit a JS file → reload the page (no transpile).
- `window.game` / `window.ACTION` are exposed for console debugging (human-only; no RL/agent layer).

## 4. File responsibilities

| File | Role |
|---|---|
| `js/constants.js` | All tunables: grid/`CELL`, platform (width 10, centered, no side walls), gravity, friction, scoring `α/β/γ`, RL rewards, action enum. Single source for magic numbers. |
| `js/shapes.js` | 7 tetrominoes as cell-offset arrays around COM; `rotateCW`/`centroidOf`; `PieceBag` (standard 7-bag randomizer). |
| `js/physics.js` | Matter world: platform, `createPiece` (composite body, COM-centered), `collidesAt` (`Query.collides` preview), `tryMove`/`tryRotate` (wall-kick), `releaseActive` (static→dynamic), `getDropped`, `stableBodies`, `heightmap`, `peakStableHeight`. **THE file for the kinematic→dynamic transition.** |
| `js/renderer.js` | Canvas-only draw, stateless (reads physics+game). Must not compute game state. |
| `js/game.js` | State machine (ready/playing/paused/over), spawn, `applyAction`, stability→placement reward, drop→life, scoring, DAS auto-repeat. |
| `js/main.js` | Boot, `requestAnimationFrame` loop, keyboard, HUD, exposes `window.game/ACTION`. Human-only. |

## 5. Physics integration (Matter.js gotchas — verified in `physics.js`)

- Pieces are **composite bodies** (4× 1×1 cells); COM auto-computed; `Body.setAngle` rotates about COM (matches real rigid bodies).
- Kinematic piece = Matter `isStatic:true` (no gravity). To convert to dynamic:
  1. `Body.setStatic(body, false)` — but this does **NOT** auto-wake a sleeping static body; an unwoken body receives no gravity and sticks at spawn.
  2. **`Sleeping.set(body, false)`** + reset `isSleeping`/`sleepCounter`.
  3. Re-apply per-part `friction`/`frictionStatic`/`restitution` — `setStatic` can reset them.
- `enableSleeping=true`; sleeping bodies count as "stable" for scoring/heightmap.
- Collision preview = `Query.collides` vs `[platform, ...placed]`; **restore position/angle after probing**.
- `tryRotate` has a wall-kick table for rotation near walls/stack.
- `isSpawnClear` blocks next-piece spawn while a previous piece still occupies the top spawn zone; `SPAWN_FORCE_FRAMES` forces spawn to avoid softlock.
- Engine solver iterations are bumped to `positionIterations=12`/`velocityIterations=8`/`constraintIterations=3` (Matter defaults 6/4/2) and pieces carry **no `chamfer`**. Both prevent tall-narrow bodies (e.g. a vertical I-piece) from jittering on a single contact and toppling spuriously. Visual rounding is the renderer's job, not the collision shape's.
- Locking happens at the **exact contact Y** via `PhysicsWorld.contactY()` (CELL coarse scan + `LOCK_FINE_STEP` fine scan), not the cell-aligned Y. `_descend`/`_hardDrop` snap to this Y before `_lockActive`. This kills the up-to-1-cell gap that otherwise free-fell under gravity, impact-penetrated the piece below, and got frozen by sleeping as a visible overlap.

## 6. Scoring & RL (verified in `constants.js`)

```
S_total = α·T + Σ β·h_i + γ·H²     (α=1, β=5, γ=10)
  S_time   = α·T                 — 1 pt/sec
  S_place  = Σ β·h_i             — per piece once stable; h_i = COM height above platform (units)
  S_height = γ·H²                 — H = peak stable height (units); quadratic, main score driver
```
- "Stable" = sleeping OR (`|v|<STABLE_SPEED` and `|ω|<STABLE_OMEGA`) for `STABLE_FRAMES` consecutive frames. (Used internally for placement scoring; no longer surfaced as a red debug frame — see §8.)

## 7. Life / drop

- `lives = 3`. A piece is "dropped" (loses a life) when `bounds.max.y > DROP_Y` (canvas bottom + margin) — i.e. fell into the void.
- Platform is 10 wide, centered, **no side walls, no hidden floor**. Overhanging/unstable structures topple into the void. Removing a dropped piece also removes its `S_place` contribution and disturbs the rest of the stack.

## 8. Migration: release-model → contact-trigger (DONE)

The previous release-model path (`game._spawn` static hang → `applyAction(HARD_DROP)` → `_releaseAndSpawn` → `physics.releaseActive` free fall) is replaced. What changed:

1. **Kinematic auto-descent** — `game.update` accumulates `dropTimer`; interval = `keys.down ? SOFT_DROP_INTERVAL_MS : DROP_INTERVAL_MS`; on tick → `_descend()`.
2. **Contact-triggered transition** — `_descend`/`_hardDrop` probe with `physics.canDescend()` (=`!collidesAt(pos+CELL)`); on first block they call `_lockActive()` (= `releaseActive`) at the last non-overlapping position. Reused existing `collidesAt`/`tryMove`/`tryRotate`/`releaseActive` — no physics rewrite.
3. **Action space → 5** — re-added `SOFT_DROP`; `HARD_DROP` now = "drop instantly until contact" then auto-transition (no longer a manual "release").
4. **Keys (`main.js`)** — `↓` = soft drop (hold to accelerate via `keys.down`), `Space` = hard drop. Transition is always contact-triggered.
5. **`constants.js`/`env.js`** — `ACTION`/`ACTION_NAMES`/`ACTION_SPACE_SIZE` = 5; `flatObservation` unchanged (still `number[32]`).
6. **`README.md`/`index.html`** — updated to the contact-trigger model + 5-action space.

Verified: a piece left untouched auto-descends and converts on touching the platform with no key pressed; horizontal moves still can't overlap the stack; tall stacks still topple under physics.

Follow-up fixes:
- **RL / agent layer fully removed** — `js/agent.js` (heuristic auto-play) and `js/env.js` (MDP wrapper) are both deleted; `main.js` is human-only. `constants.js` RL rewards (`R_*`), `ACTION_NAMES`/`ACTION_SPACE_SIZE`, and `game.pendingReward`/`flushReward` are gone; `ACTION` is kept only as the keyboard→`applyAction` mapping. `index.html` MDP card removed.
- **Spawn grid alignment** — all 7 `SHAPES` now use half-integer cell offsets; `createPiece` no longer calls `Body.setPosition` to force the COM to `(px,py)`. `Body.create` auto-computes the COM (= parts' centroid), and because parts are created at `(integer·CELL + half-integer·CELL)` they land exactly on grid-cell centers. `tryRotate` additionally snaps the piece back to grid-cell centers after each 90° turn (kinematic phase = classic-Tetris control, not real-rigid-body rotation), so pieces stay grid-aligned through moves, descent and rotation. Cells stay grid-aligned through `±CELL` moves/`canDescend` so tetrominoes nest cleanly like classic Tetris. (After contact→dynamic, rotation is about the true COM as normal.)
- **Next-piece preview** — `Renderer._roundRect` now takes the target `ctx` as a parameter; previously it always built the path on the main canvas `ctx` while `_roundRectScaled` filled on `nextCtx`, so the preview cells never rendered (the box appeared blank). Preview now draws correctly.
- **Danger red-frame hidden** — `Renderer._drawDangerZones` (the red `strokeRect` around unstable/tilting placed bodies) is removed from `draw()` and deleted. `_isStable` in `physics.js` is kept for placement scoring.
- **Soft drop = 2× auto-drop** — `SOFT_DROP_INTERVAL_MS = DROP_INTERVAL_MS / 2` (was 45ms, far too fast).
- **Solver stability for tall-narrow pieces** — engine iterations bumped to 12/8/3 and pieces carry **no `chamfer`**, so a vertical I-piece rests on a flat face instead of jittering on a rounded pivot and toppling spuriously.
- **Stacked-piece overlap** — `_descend`/`_hardDrop` now lock at `contactY()` (fine-scanned exact contact) instead of the cell-aligned Y, so pieces settle with ≤`LOCK_FINE_STEP` gap and no impact-penetration-frozen overlap. Verified: no overlap at lock position; lock Y is the exact contact surface.

## 9. Action space

- **5 actions (contact-trigger, classic Tetris):** `MOVE_LEFT`, `MOVE_RIGHT`, `ROTATE_CW`, `SOFT_DROP`, `HARD_DROP`. No "release" action; transition is automatic on contact.
- `NOOP=99` is an internal sentinel (no active piece), **not** part of the action space.
- Prevailing (now-removed) model was the 4-action "release" space (`HARD_DROP`=release) — kept here only as history.

## 10. MUST / MUST NOT

**MUST**
- Transition kinematic→dynamic on **first contact** (platform or placed piece), not on a player key.
- Keep kinematic control behind collision-preview (`Query.collides`); a kinematic piece must never overlap placed bodies.
- Keep the renderer stateless; all state authority lives in `Game`/`PhysicsWorld`.
- After `Body.setStatic(false)`: always `Sleeping.set(body,false)` + re-apply per-part friction/restitution.
- Keep `SHAPES` on half-integer offsets (and do **not** re-add `Body.setPosition` in `createPiece`) so spawned pieces stay grid-aligned.

**MUST NOT**
- Implement physics, collision, or game rules in `renderer.js`.
- Reintroduce a manual "release" action — the transition is contact-triggered.
- Reorder the script load in `index.html` (globals depend on order).
- Assume a backend / Python / WebSocket layer — none exists; everything is in-page JS.

## 11. Specs vs reality

- `demo.txt` — original design spec (two-phase model; risk-reward scoring). Its scoring (`S_time=10·t`, `S_height=C·H²(1+Risk)` C=20, `S_stability`, `S_combo`, drop `=500×n`) is **not implemented**; code uses the simpler verified constants in §6. Treat `demo.txt` scoring as aspirational.
- `README.md` — Chinese player-facing readme; currently describes the OLD release model + 4-action space. Update alongside §8.

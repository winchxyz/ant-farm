# Ant Farm — bug ledger

Hand-written WebGL2 game, no libraries, no build step. `index.html` loads
`src/*.js` with a `?v=NN` cache key — **bump that number in `index.html`
after every source edit**, or browsers serve the old file and nothing you
changed appears.

Live build: https://winchxyz.github.io/ant-farm/ · repo: https://github.com/winchxyz/ant-farm

---

## How to reproduce and measure anything here

The game exposes its internals, so bugs can be measured instead of guessed.

```js
AF.Game                    // Game.digScoop, Game.pruneFloatingProps, Game.scoops, Game.DIG
AF.Game.player.farms[0]    // the tank: .props .soilSDF(x,y,z) .localTop(x,z) .digZ .center .half
AF.Game.PROP_DRAW          // how each prop kind is drawn AND how solid it is
AF.Game.propBlockR(prop)   // its blocking radius, the same number the renderer draws
AF.Game.resolveProps(...)  // the one push-out every surface mover calls
AF.PS                      // fluid/grain sim: .spawn(mat,x,y,z,vx,vy,vz,farm) .px .py .pz .alive .mat .remove(i)
AF.Wet                     // soil wetness volume: .add .tick .upload .at .stats — farm.wet holds one
AF.WR                      // screen-space water renderer: .draw() .gather()
AF.__loop(tMs)             // step one frame by hand — drive time deterministically
AF.__loopStrict(tMs)       // same, but rethrows instead of swallowing (see below)
AF.Game.lastError          // stage, name, message, stack and a world snapshot of the last throw
AF.Game.errorLog           // the last 24 of them · AF.Game.clearErrors() wipes and resumes
```

Deterministic frame stepping:

```js
window.__T = 1e6;
for (var i = 0; i < 300; i++) { window.__T += 16.7; AF.__loop(window.__T); }
```

**Four traps that made earlier verification worthless — do not repeat them:**

1. **Browser-pane screenshots come back black.** The WebGL canvas is not
   composited into them. Read pixels instead, inside the *same* JS task as
   the `AF.__loop` call that drew the frame:

   ```js
   var cv = document.querySelector('canvas'), gl = cv.getContext('webgl2');
   gl.bindFramebuffer(gl.FRAMEBUFFER, null);
   gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
   ```

   Across separate tool calls the drawing buffer is already cleared and you
   get black. A JPEG of ~4 KB at 900x488 means you captured nothing.

   To actually *look* at a frame, run the server with `--dev` and POST the
   pixels back as a PNG: `fetch('/__shot?tag=name', {method:'POST', body:
   canvas.toDataURL()})` writes `tools/shots/name.png`. Remember to flip the
   rows — `readPixels` hands them back bottom-up.

2. **Test where the bug is, not where it is convenient.** A prop test that
   digs at an arbitrary spot reports `propsNearDig: 0` and "passes" while
   grass floats everywhere. Find the actual props first, then dig under
   them. The stone bug below sat open for three releases because the harness
   never walked an ant *at* a stone: measured over 1800 frames of ordinary
   play, ants came within a big rock's radius 36 times. Driving them across
   one deliberately put it at 30% of frames.

3. **The headless harness has no mouse, so a whole class of bug is
   invisible to it.** `AF.__loop` is driven with `drag.active` false and
   `input.dx` zero, so every camera-gesture branch is dead in every frame
   ever stepped. A permanent, 100%-reproducible crash in the pan code
   survived two nine-thousand-frame runs that way. If you are measuring
   anything that input can reach, set `input.drag` and `input.dx/dy` by hand.

4. **`AF.__loop` now tolerates a bad frame, which is exactly what a
   measurement does not want.** Use `AF.__loopStrict(t)` when you are
   measuring: it records the error the same way and then rethrows.

To A/B a rendering change, run the same measurement against the live site
(old shader) and against localhost (new shader) — or, better, `git stash`
the one file, measure, and restore it, so the water is identical in both
runs. **Normalise against the water that is actually there**, not against
"pixels that changed a lot": the latter counts the pool's own dim interior
as halo and moves when the pour does. Project the live particles to screen
and use that footprint as the denominator.

---

## Fixed — with the mechanism and the measurement

### 1. Every camera pan threw, and killed the game (the `state: 'error'` bug)

`src/input.js`, `Rig.update`, the mouse-pan branch.

Two lines read `rx` and `rz`. **No such variables exist** — not in that
function, not in that file, not on `window`. Reading an unbound identifier
is a `ReferenceError`, so every middle-drag, Ctrl+drag, Space+drag and
Shift+right-drag that actually moved the mouse threw out of `Rig.update`,
out of `Game.update`, and into the frame `try/catch` in `main.js` — which
set `state:'error'` and put the boot overlay back up permanently.

Reproduced deterministically:

```js
var inp = AF.Game.input;
inp.drag.active = true; inp.drag.button = 1; inp.dx = 12; inp.dy = 4;
AF.__loop(performance.now());
// before: Game.state === 'error', bootMsg "Runtime error: rx is not defined"
```

It is not related to the queen dying. That was when the player reached for
the camera. Every hypothesis in the old entry — unguarded `farms[0]` after
`col.farms.length = 0`, the defeat path, a queen corpse — was checked and is
not reachable: `col.defeated` is set before the array is emptied and
`Colony.update` and the AI brain are both skipped from then on. A 9500-frame
chaos soak that kills the queen mid-run throws nothing.

Fixed by deriving the camera-right axis in the branch itself
(`cos(yaw), -sin(yaw)` — the same expression the keyboard block uses; it
cannot borrow `rgtX/rgtZ` from there, because those are computed inside
`if (kx || kz || kyUp)` and would be hoisted-undefined with no key held,
trading a loud throw for a silent NaN focus). Verified: the focus now traces
a circle as yaw turns, so it slides along the camera's right axis rather
than along world X.

**Two regressions that fell out of making pan work, and are also fixed.**
Nothing downstream had ever seen a live pan, so nothing guarded against one:

- the selection rectangle (`main.js`) tested `ctrl || alt`, so a Space+drag
  drew a marquee across the tank while the player moved the camera;
- hold-to-dig (`excavate.js`) and hold-to-pour (`player.js`) tested
  `mouse.down` alone, so a Ctrl+drag with the shovel in hand would have
  carved a trench along the whole camera path.

There is now one predicate — `Input.prototype.panGesture` / `orbitGesture` /
`camGesture` — and all five callers ask it instead of each re-deriving half
of it.

### 2. Frame errors kept nothing and stopped nothing

`src/main.js`.

The old handler logged `err` to the console, dropped the stack, set
`state:'error'` and raised the overlay — and then the loop carried on
running `update`, `render` and `UI.update` behind it, sixty times a second,
throwing the same exception and burning the evidence of the first one.

Now: the frame runs as five attributed stages, every throw is recorded with
its stage, `err.stack` and a world snapshot (frame, sim clock, ant/colony/
corpse/item/creature/particle counts, player farms, queenDead, defeated)
into `Game.lastError` and a bounded `Game.errorLog`; the overlay prints the
stack; input, render and UI errors are tolerated for a frame; and it goes
terminal on the second occurrence of an identical stack, the second
`update` throw in a 4 s window, or eight errors of any kind in that window.
`AF.__loopStrict` rethrows for measurement, `Game.clearErrors()` resumes.

### 3. Ants and creatures walked through stones — the radius was never the one on screen

`src/game.js` (`Game.PROP_DRAW`, `propBlockR`, `propAxis`, `resolveProps`),
`src/renderer.js` (`Batch.meshR`), `src/ants.js`, `src/creatures.js`,
`src/render_scene.js`.

The collision code existed and ran. It defended a circle of
`prop.scale * 0.60` (ants) or `* 0.62` (creatures) — while `Game.pushProps`
draws each kind at a *different* instance scale against a *different* mesh.
Measured off the vertex arrays that become `aPos`:

| kind | instance scale | mesh XZ radius | drawn radius | old blocking radius |
|---|---|---|---|---|
| bigrock | `p.scale` | 0.898 | **0.898·s** | 0.62·s |
| pebble | `p.scale * 0.55` | 0.895 | 0.492·s | 0.60·s *(over-blocked)* |
| leaf | `p.scale` | 1.258 | 1.258·s | 0.60·s |
| mushroom | `p.scale` | 0.584 | 0.584·s | 0.60·s |
| twig | `p.scale * 0.70` | 2.423 | a 1.7-long *stick* | 0.60·s disc at the butt |

`bigrock` is `rng.range(1.1, 2.1)` and is the most conspicuous object in the
tank. On the tested tank the largest was drawn 1.596 across and blocked at
1.066; with the body term a worker stood 1.32 from the centre — a quarter of
a unit inside the outline, with its whole body in the stone.

Measured, driving ten ants back and forth across that rock through the real
`doMove` → `surfaceMove` path (`framesInsideTheDrawnRock / antFrames`):

| game speed | before | after |
|---|---|---|
| 1x | **30.3%**, worst 0.338 deep | **0%** |
| 2x | 17.7%, worst 0.278 | **0%** |
| 4x | 36.1%, worst 0.597 | 0.01% |
| 8x | 34.2%, worst 0.508 | 0.03%, worst 0.377 |

All five bestiary species, driven straight at the same rock for 900 frames
each: **0 frames inside**, every one of them. Every solid kind separately,
5000 ant-frames each: 0 at 1x. `propBlockR` and the drawn radius are now
equal by construction, for every kind.

The fix is one table. `Game.PROP_DRAW` holds the instance scale and the y
lift for each kind; `render_scene.js` draws from it and `propBlockR` blocks
from it, so the two cannot drift again. The mesh radii are measured once at
load from the very position array that becomes the vertex attribute
(`Batch.meshR`), not written down. Six further faults went with it:

- the ant push-out sat inside `if (d > 0.02)`, so an ant standing still was
  never resolved out of a stone it was already in;
- the creature glass clamp ran *before* the push-out, so a push-out could
  leave an animal outside the tank with nothing left to catch it;
- props were resolved in array order and the last one won, so one push could
  shove a body into a prop already cleared — normal, not exotic, with
  pebbles scattered in overlapping drifts. Now deepest-overlap-first, three
  passes, clamped every iteration;
- only the step's endpoint was tested. `dt` reaches 0.40 s at 8x and a scout
  covers 1.95 units in one frame — wider than most props — so a body passed
  through the middle with both endpoints on clean sand. The segment is now
  swept, but *only as a tunnelling guard*: if the step ends inside a prop
  the endpoint is resolved, exactly as before, because resolving every
  contact at closest approach threw a grazing body sideways by up to a full
  radius;
- `pushOutOfEnemy` shoves a body up to nine units, ignoring glass and props.
  The resolve now runs after it;
- the no-teleport clamp in `Ant.update` limits a frame's movement to
  walking pace and was undoing part of the push-out — the only remaining
  cause of penetration once the radius was right (2 ant-frames in 11912 at
  8x). A push-out is a constraint, not travel, so it is now added to that
  frame's allowance.

**Two props changed solidity, deliberately.** `leaf` is a flat thing
0.344·s tall lying on the sand and was fenced off by a disc up to 0.90
wide — 40 to 70 of them per jungle tank. It is now passable, like grass.
`twig` is the opposite case: a stick up to 1.7 long and half a unit tall,
taller than a worker, which a disc at `p.x,p.z` cannot describe at all. It
gets a real capsule — `seg` along the local +z axis, `rad` across it —
verified against the mesh by transforming `buildTwig(4)` through the same
instance transform the shader uses and projecting onto the collider axis:
the axis spans the twig 0.000 to 1.000 with the mesh a mean 0.215 from it.

Colony health is unchanged: 33 ants on day 2 with food rising. (The note
below about `stickToSurface` records an earlier movement change that took
population 34 → 3 by day 2; this one does not.)

### 4. Ground now looks wet where the water soaked in

`src/particles.js` (`AF.Wet` + `PS.soakIntoSoil`), `src/shaders.js`
(`S.WETLIB`, `SOIL_FS`), `src/renderer.js`, `src/gl.js`
(`GLX.texture3DSub`), `src/game.js`, `src/render_scene.js`.

**The old entry's stated reason for this bug was wrong.** It said "a damp
patch cannot be a decal: the decal pass is additive, so it can only
brighten." There has always been a dedicated wet pass — `Game.pushWet`,
`S.WET_FS`, `R.drawWet` — and it uses `GLX.blend('multalpha')`, which is
`blendFuncSeparate(DST_COLOR, ONE_MINUS_SRC_ALPHA, ZERO, ONE)`, a true
per-pixel darkening. The real reason is different: that pass is keyed off
**live water clusters**, so the damp patch vanishes in the same step as the
last drop, and it lies on the analytic heightfield, so inside a dug pit it
hangs in the air at the old ground level. Confirmed: with the pool fully
drained, `R.B.wet.n === 0`, `PS.clusters.length === 0`, and `farm.wetness`
is the unchanged per-biome constant. Nothing anywhere recorded that water
had entered the soil.

Fixed with a wetness **volume**, because `SOIL_FS` is a raymarch and there
is no surface to hang a texture on: 90×40×30 R8 over exactly the SDF box
(108,000 texels, a sixth of the R16F SDF), written by `soakIntoSoil` — both
by water that merely sits on soil and by the drop that finishes draining —
dried on a throttled tick, uploaded as a dirty sub-box, and sampled in
`main()` after `soilAlbedo` returns, so it cannot miss one of that
function's three exits. The splat is placed on the soil *surface* using the
gradient `PS.sdf` already hands back, so it works identically on a pit floor
and a vertical tunnel wall.

Measured, on a 350-drop puddle poured, drained to zero, then A/B'd against
the same frame with the volume forced dry:

- water 350 → 0 over ~2000 frames; volume peak 0.93, 400-odd cells;
- the damp patch **survives the water** and fades with a 75 s e-folding
  time: peak 0.964 → 0.878 → 0.768 → 0.672 over the following minute;
- **17.5% peak relative darkening** on screen with no water left at all,
  over 3.3% of the frame;
- shader response is close to linear — wetness 0.25/0.50/0.75/1.00 gives
  5.8% / 12.3% / 19.3% / 27.2% mean relative darkening.

`WET_BURY` matters more than it looks: the raymarch stops essentially *at*
the surface, so burying the splat centre half a cell down costs half the
mark. At 0.30 the same pour peaked at 7.6%; at 0.14 (a quarter of the
0.575-unit cell) it peaks at 17.5%.

The live-pool decal is retired, since the volume covers it and keeping both
double-darkens the rim.

Wetness deliberately survives digging — it is a property of a world point,
so a tunnel carved through a damp region shows damp walls. It is not saved:
`save.js` stores no particles, no heap and no soil state, and a loaded
colony has no water in it either.

### 5. Water halo — reduced again, still not gone (see open bug 1)

`src/water_render.js`.

The previous round removed about 35% by gating Fresnel on thickness,
dropping a 1.15 over-brighten, and raising the coverage ramp to 0.14. This
round measured where the rest actually comes from, by switching post passes
off one at a time against an identical frame. Of everything painted more
than 16 px from real water:

| pass | share |
|---|---|
| **SSAO** | **71%** |
| bloom | 14% |
| the composite itself | 11% |
| `R.drawWet`'s 1.35×-radius disc | 9% |
| ink / outline / DOF / rays / CA | <2% |

Two of the ledger's three leads are **refuted**, from the code:

- *(b) the bilateral blur spreads the surface outward.* It cannot. `FS_BLUR`
  early-returns on `c.r <= 0.0` and skips taps with `d <= 0.0`, so the zero
  set is preserved exactly and the depth footprint after blurring is
  bit-identical in extent to the footprint before it. What the blur does do
  is corrupt the depth *values* inside the rim — which is lead (c).
- *(a) subtract a floor from `th.r`.* The 0.14 threshold already cuts
  *inside* the real water: a one-particle-deep film puts about 4.8 splats on
  a ray at `uScale` 0.055, i.e. `th.r ≈ 0.13`. Lowering the floor further
  eats water, not halo.

Lead (c) is confirmed and is now fixed properly. `FS_BLUR` already walks the
exact neighbourhood that decides whether a fragment is near the silhouette,
and the depth pass already writes alpha 1 where a particle landed — so
box-averaging that alpha over the same reach costs two adds per tap and no
extra fetch, and gives a real **silhouette confidence**. `FS_COMP` gates
both Fresnel and the 190-exponent specular lobe on it, so nothing is derived
from a normal the filter invented.

The other half was a half-applied fix. `oNormal` was written as
`vec4((N*0.5+0.5)*cov, cov*0.03)` under `premul` — and under
`(ONE, ONE_MINUS_SRC_ALPHA)` it is the **alpha**, not the colour, that
removes the destination. With alpha 0.03 the scene normal was never removed
and the water normal was simply *added* on top of it; attachment 1 is
`RGBA8`, so it clamped, and SSAO read back a saturated normal. The alpha is
now `cov`, making the write the lerp it was always meant to be. (Attachment
1's alpha is roughness elsewhere, but nothing in post reads it — SSAO and
the ink pass both take `.xyz` only.)

Coverage also gates the depth write now, so a fragment drawn at 1% coverage
no longer stamps a water surface into the buffer SSAO, DOF and the ink Sobel
all read.

Measured with **identical water** (seeded pour, same camera, one file
swapped), normalising against the projected footprint of the live particles
rather than against "pixels that changed":

| | before | after |
|---|---|---|
| pale brightening outside the water | 666 px | **480 px (−28%)** |
| its energy | 2.30 | **1.71 (−26%)** |
| anything painted outside the water | 13029 px | 12451 px (−4.4%) |
| more than 16 px out | 4097 px | 3698 px (−9.7%) |
| the water itself | 32585 px | 32124 px (−1.4%) |

So: about another quarter of the pale wash, for 1.4% of the water. **Still
not eliminated** — but see open bug 1, because what is left is no longer
mostly the thing the ledger has been chasing.

### 6. Dragging the shovel skipped every follow-up

`src/excavate.js` — `Game.digScoop`, the scoop-merge branch.

A scoop within `DIG_R * 0.45` of an existing one **merges**: it grows that
scoop's radius and returns. Growing the radius removes soil exactly like
carving a new scoop does, but the branch returned *before*
`AF.Heap.rebakeGround()`, `Game.pruneFloatingProps(farm)` and
`AF.PS.wakeNear(...)`. Only the fresh-scoop branch below it did that work.

Measured on a normal drag (steps of `DIG_R * 0.12`): **414 merge scoops vs
72 fresh** — 85% of a drag took the branch that did nothing. This is the
single root cause behind three separate reports:

- grass and stones left standing in the air over a dug hollow
- objects resting on ground that had already been dug away (stale
  `rebakeGround`)
- water asleep on a surface that no longer existed under it

Fixed by giving the merge branch the same three calls. After: floating
props in a drag-dug cluster went **11 to 0**.

### 7. Ground did not absorb water; water skated like ice

`src/particles.js`.

There was **no absorption path at all**. `PS.updateWetness` wets *sugar*
grains touching water; soil is never involved. A pool sat on the surface
forever. And `MU_SOIL_WATER` was `0.10` — near-frictionless against soil.

Added `PS.soakIntoSoil(farm, dt)`: a live water particle within
`PR * 1.25` of soil accumulates contact time and is removed when it passes
its own `soakCap`. Three details matter:

- `soakCap[i] = SOAK_TIME * (0.5 + random())` per drop. With one shared
  timer a pool poured in one go touches soil in one go and vanishes in one
  step — measured 700 to 4 in four seconds, a cliff rather than a drain.
- neighbours are woken on removal (`PS.wakeNear`), or the bottom layer
  drains and the sleeping layer above never settles onto the soil — the
  pool stalls part-drained forever (measured: stuck at 131 of 700).
- only the layer actually touching soil drains, so deep pools sink
  gradually instead of evaporating all at once.

`MU_SOIL_WATER` 0.10 to 0.38.

Measured after: 700 poured, curve 700 → 526 → 356 → 165 → 56 → 21 → 6 over
~48 s. Smooth, no cliff, drains to nothing. Peak solve 33.8 ms on a
900-drop stress pour.

### 8. Earlier, in this same area (already shipped)

- particles buried inside solid soil are skipped in `WR.gather()`
- water colour is premultiplied for the `premul` composite
- `soilTopAt()` in `src/heap.js` marches down to real soil so objects rest
  on dug ground instead of the analytic terrain height

---

## Open

### 1. Water halo — what is left is a dark surround, not a pale wash

Measured after the fix above, against the projected footprint of the live
particles: **480 px of faint brightening outside the water, carrying 1.71
luminance-units in total** — against a water footprint of 62,861 px. The
pale wash the ledger has been chasing since the beginning is now about 1%
of the water's own area and is close to done.

What remains outside the water is **darkening**: 12,451 px carrying 132
luminance-units, and it is 71% SSAO, 14% bloom, 9% `R.drawWet`. Some of that
is legitimate — a puddle sitting on sand really does occlude the sand at its
rim — but the *extent* is not: `aoRadius` 0.55 world units is ~24 px at
depth 32, and the AO blur adds ~11 px on top.

The next thing to try, in order:

- The water surface the composite writes into the depth buffer is the
  *blurred impostor* surface, which sits up to a particle radius (0.37)
  above the true water line. SSAO therefore sees a raised plateau with a
  cliff at its rim where there is really a film flush with the sand. Biasing
  the depth write down toward the true surface, or damping the AO term where
  thickness is low, attacks the cause rather than the radius.
- `R.drawWet` still paints a soft multiply disc at 1.35× the cluster radius
  under every live pool, on the analytic heightfield. Now that the wetness
  volume exists and covers the same ground properly, this pass has no job
  left except the first two seconds of a pour, before the volume has
  accumulated. Consider deleting it and letting the volume ramp faster.
- A dark contact ring is not obviously wrong. Before tuning it away, get a
  human to look at a pool at a shallow angle and say whether it reads as
  "wet sand at the edge" or as "a smudge".

Reproduce: pour, then read the frame twice in one JS task - once normally
and once with `AF.WR.draw = function(){}` - and write the amplified signed
difference out through `/__shot` (orange = brightening, blue = darkening).
`tools/shots/` is gitignored, so those images are yours to regenerate, not
something you will find checked in.

### 2. A lone stationary drop rises instead of falling

`PS.spawn(MAT_WATER, x, y, z, 0, 0, 0, farm)` for **exactly one** particle
with **exactly zero** initial velocity climbs at roughly 28 units/s — about
`GRAV` upward — instead of falling. Measured over 30 frames: +0.67.

Everything else is fine: the same drop given `vy = -1` falls 3.07; five
drops fall; forty drops fall. It is the degenerate case of a particle with
no neighbours, where the density correction has nothing to balance against.
Real play always pours with velocity, so nothing in the game hits it.

It is recorded because **it will waste your afternoon if you meet it in a
test harness** — it did here. A 400-drop probe that spawned into a tight
column with zero velocity sent the whole pour through the ceiling and read
as "the wetness volume is broken".

### 3. `buildMushroom` builds the cap in the wrong place

`src/geometry.js`. The builder's rotation is set to -PI/2 for the stem limb
and never reset, so the cap inherits it: (x,y,z) → (x, z, -y). The stem
comes out correctly vertical and the cap comes out as a *vertical disc lying
on the sand behind it*. Measured bbox of `buildMushroom(0)`: x -0.226..0.226,
**y -0.226..0.462, z -0.584..0.067** — the z extent is the cap, on the
ground, where its y extent should be.

Not fixed here because it is a geometry bug and this pass was about the four
open entries above. It does affect them: `PROP_DRAW.mushroom` blocks at the
silhouette (0.584·s) because the silhouette is what a player sees, and once
the cap is a dome on top of the stem the right answer is probably the stem
radius (0.070) plus a cap the ant walks under.

### 4. Residual stone penetration at 8x game speed

3 ant-frames in 9000, worst 0.377 into a 1.596-radius rock, and only against
the largest `bigrock`. Zero at 1x and 2x, 1 frame in 9000 at 4x. The cause
is the interaction between a 0.40 s frame and the three-pass resolver; a
fourth pass or a proper continuous sweep would close it. Not worth it yet.

---

## Constraints that apply to this repo

- `C:/Users/oxman` is itself a git repo — check the toplevel before any
  `git add`.
- Never round-trip a source file through PowerShell `Get-Content` /
  `Set-Content`: it double-encodes UTF-8 silently. Use Python with an
  explicit `encoding='utf-8'`, or a heredoc.
- Read *and* write with `newline=''` in Python. The index is LF throughout
  but `core.autocrlf` is `true`, so a read without it silently converts the
  whole file and turns a three-line patch into a whole-file diff.
- Watch for apostrophes inside single-quoted GLSL strings when patching
  `src/shaders.js` through a shell heredoc.
- `tools/glsl_lint.js` covers `src/shaders.js` and `src/shaders_post.js`
  only. The GLSL in `src/water_render.js` is inline and **is not linted** —
  scrutinise it by hand, or it compiles at runtime and fails silently into a
  black frame.
- Validate with `node tools/check.js` (every procedural mesh) and
  `node tools/glsl_lint.js` (every named shader) before believing anything.

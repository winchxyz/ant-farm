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
AF.Game.player.farms[0]    // the tank: .props .soilSDF(x,y,z) .digZ .center .half
  .localTop(x,z)           //   ANALYTIC terrain height - ignores every scoop
  .surfaceTop(x,z)         //   where the ground REALLY is, dug holes included
AF.Game.PROP_DRAW          // how each prop kind is drawn AND how solid it is
AF.Game.propBlockR(prop)   // its blocking radius, the same number the renderer draws
AF.Game.resolveProps(...)  // the one push-out every surface mover calls
AF.PS                      // fluid/grain sim: .spawn(mat,x,y,z,vx,vy,vz,farm) .px .py .pz .alive .mat .remove(i)
AF.Wet                     // soil wetness volume: .add .tick .upload .at .stats — farm.wet holds one
AF.WR                      // screen-space water renderer: .draw() .gather()
AF.WR.thickScale           // thickness per splat - the knob that decides whether
                           //   water has any colour at all. Live; see fixed 7.
AF.WR.thickK               // thickness multiplier for absorption only, not coverage
AF.WR.tint                 // how hard a one-particle film is tinted
AF.__loop(tMs)             // step one frame by hand — drive time deterministically
AF.__loopStrict(tMs)       // same, but rethrows instead of swallowing (see below)
AF.Game.lastError          // stage, name, message, stack and a world snapshot of the last throw
AF.Game.errorLog           // the last 24 of them · AF.Game.clearErrors() wipes and resumes
```

Deterministic frame stepping:

```js
window.__T = performance.now();          // NOT 1e6 - see trap 5
for (var i = 0; i < 300; i++) { window.__T += 16.7; AF.__loop(window.__T); }
```

**Five traps that made earlier verification worthless — do not repeat them:**

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

5. **Seed `window.__T` from `performance.now()`, not from `1e6`.** The
   snippet above manufactures crashes that are not in the game. `loop`
   clamps `dt` from above (`if (dt > 0.25)`) but never from below, and it
   re-arms `requestAnimationFrame` on every call — so once manual stepping
   has pushed `last` out to 1e6 ms, the next *real* rAF tick arrives with a
   `now` of maybe 30,000 and hands the frame a `dt` of about **-970
   seconds**. `Game.time` goes negative and the first thing to fail on it is
   an `AudioParam` ramp scheduled in the past:

   ```
   frame error in update TypeError: ... 'exponentialRampToValueAtTime' ...
   non-finite   {frame: 180, simTime: -842.78, day: 1, state: play}
   ```

   The stack reads `Audio._env` ← `Audio.play` ← `Ant.doForage` and looks
   exactly like a live foraging bug. It is not one. **`simTime` in the
   snapshot is the tell: if it is negative, the harness broke, not the
   game.** `window.__T = performance.now()` puts both clocks on one
   timeline; 4600 strict frames then run clean.

   Two things hide this. A *hidden* browser pane throttles rAF to nothing,
   so `Game.frame` stays 0, only manual steps advance the sim, and the two
   clocks never meet — the collision appears only on the runs where the pane
   was visible at some point.

   **`loop` now clamps `dt` at both ends** (`if (!(dt > 0)) dt = 0;`), which
   closes the real gap this exposed: `performance.now()` is monotonic so live
   play could not reach a negative `dt`, but a stalled or rewound clock could,
   and nothing in the frame body survives one. Seed from `performance.now()`
   anyway — a clamped `dt` of 0 still means the harness and rAF are fighting
   over the same `last`.

**To A/B a rendering change, freeze the particles.** This is the only method
here that has produced a number worth trusting, and the round before it
reported a 28% improvement on a change that turned out to do nothing at all
(fixed 6). Pouring "the same" water twice does not give you the same water:
it spreads, it soaks, the cluster the camera aims at is a different one, and
the difference between the two builds disappears into the difference between
the two pours.

```js
// once, on either build: settle a pour, then freeze everything that matters
var fr = [];
for (var i = 0; i < PS.MAX_RESIDENT; i++) {
  if (!PS.alive[i] || PS.mat[i] !== PS.MAT_WATER) continue;
  fr.push(PS.px[i], PS.py[i], PS.pz[i], PS.nbrN[i], PS.rad[i]);
}
localStorage.setItem('FROZEN', JSON.stringify(fr));   // survives the reload

// on each build: replay it with the solver stubbed, so nothing can move
var realStep = PS.step; PS.step = function () {};
var ids = [];
for (i = 0; i < fr.length; i += 5) ids.push(PS.spawn(PS.MAT_WATER, fr[i], fr[i+1], fr[i+2], 0,0,0, farm));
for (i = 0; i < ids.length; i++) { PS.nbrN[ids[i]] = fr[i*5+3]; PS.rad[ids[i]] = fr[i*5+4]; }
```

`nbrN` and `rad` have to be restored by hand or every drop draws at 26% size
(`VS_PART` shrinks lone particles), and `PS.step` has to be stubbed or
re-spawning a settled configuration blows it apart — see open bug 2. Pin the
camera to a fixed world point, not to the water's centroid.

**Normalise against the water that is actually there**, not against "pixels
that changed a lot": the latter counts the pool's own dim interior as halo
and moves when the pour does. Project the live particles to screen, mark
each one's disc, and use that footprint as the denominator. Beware that the
mask ignores occlusion — at a shallow angle most of it can be behind a dune,
which makes the water look invisible and the halo look enormous.

---

## Fixed — with the mechanism and the measurement

### 1. Ants ran in the air over anything you dug

`src/world.js`, `src/ants.js`, `src/creatures.js`, `src/heap.js`.

`Farm.localTop` is `topY + surfaceH(x, z)` — a closed-form function of two
coordinates that knows nothing whatever about excavation. Every surface
mover stood on it. Measured: sixty scoops at one spot, `localTop` **6.11
before, 6.11 after**. Dig a pit under a column of foragers and they keep
walking at the height the ground used to be.

`heap.js` already had the right answer and had had it for releases — a
private `soilTopAt` that starts at the analytic top and marches the real
distance field down to solid. That is why *objects* rest on dug ground and
ants did not: two implementations of "where is the ground", only one of them
correct, and nothing pointing the second at the first.

Promoted to `Farm.surfaceTop(x, z)`, which `heap.js` now delegates to. Ants
use it for standing height and for the two probes that set pitch and roll,
creatures for walking, spawning and carcass placement. On undug ground the
first sample is already inside soil, so it costs one SDF lookup, which is
what makes it affordable three times per ant per frame.

After: same pit reads **6.11 analytic, 2.54 real**, and an ant driven across
it has a worst air gap of **0.000** over 200 frames.

### 2. Every bite shook the camera

`src/creatures.js`, `src/game.js`.

A wolf spider bites every 0.62 s and a centipede faster, and each bite called
`fx.shake`. A raid therefore shook the camera continuously, which does not
read as danger — it reads as a broken camera. Removed from both predator
paths; the bite keeps its sound and its spray of gore. Shake survives only
where something genuinely jolts the tank, which is the shelf tremor.

Measured: 900 frames with a spider hunting a live colony, **0 shake calls**.

### 3. Digging under a sugar heap shattered it into blades

`src/heap.js`.

Pour sugar, dig the soil out from under it, and the heap came apart into a
crown of white spikes and slivers — the "shards fly off the sugar" report.

The sugar physics were fine: the height field slumped into the hole exactly
as it should, measured 1.3–1.8 units of sugar sitting on a pit floor at 3.0
where it had been at 7.2. The fault is one line in the mesh builder. A quad
is a patch of ground with sugar on it and its corners sit at `gnd + H`;
nothing checked whether those four grounds belonged to the same surface.
Sampled across the pit rim: ground **7.24 at one node and 3.19 at the next,
0.22 apart**. The quad spanning that is a three-metre vertical blade one
cell wide, and there is one for every cell along the rim.

There is no such surface. The sugar on the lip and the sugar that slumped
into the hole are two separate sheets. The builder now skips a quad whose
four ground samples span more than `CELL * 4` — repose is `0.66 * CELL`, so
that is about four times the steepest wall sugar can actually hold, and no
real slope can reach it. A heap poured on ordinary sloping ground is
unchanged: 750 triangles, one continuous mound, no holes.

### 4. You could not see the queen lay, and the nursery was always empty

`src/colony.js`, `src/ants.js`, `src/render_scene.js`.

Two reports, one cause. An egg hatched in about ten seconds and one was laid
every six, so the standing brood population was **1.5 — measured over 3000
frames, never more than 2 at once**. All three stages worked perfectly and
had done all along; there was simply almost never anything in the chamber to
look at, which is what "ants have no larvae" means.

Development and laying are now scaled by the same factor, `BROOD_SPREAD`, so
ants per minute, food per egg and every balance number built on them are
untouched — measured 14 born in 70 s against ~12.6 before. What changes is
how many are in the pile at once: **2 → 16**, with eggs, larvae and pupae
all present together.

And the laying itself was invisible. The egg appeared in the middle of the
nursery with three sparkles fired at the queen, who might be in another
chamber entirely. It is now born *at her*, drifts to its place over a second
and a half, and she takes a visible beat over it — `layT`, a dip and a
slight swell, decayed in `Ant.update` and read by the renderer. Measured:
**115 laying poses** in 4200 frames.

### 5. Sugar and protein were added together and shown as one number

`src/ui.js`, `index.html`.

The HUD read `p.sugar + p.protein + p.water` into a single FOOD figure. A
colony drowning in sugar with no meat looked exactly like a balanced one,
and the beetle four soldiers died killing — then butchered and hauled home
piece by piece — moved the same number a spoonful of sugar moves. `layEggs`
spends the two in a fixed ratio, so which one you are short of decides
whether the queen can lay at all, and the player could not see it.

Split into SUGAR and PROTEIN. The bar still holds at 900 px with nothing
clipped.

`index.html` was also **double-encoded UTF-8** — the HUD icons were
rendering as `â—†`, `â–¤`, `âœ¦` and the boot line as `substrateâ€¦`. This is
the failure the constraints section at the bottom of this file warns about,
already in the tree. Repaired to `◆ ▤ ✦ …`; the repair has to be done run by
run, because parts of the file (`·` in the credit line) are correct Latin-1
and re-decoding the whole thing destroys them.

### 6. Water soaked away for ever, so a pool could not exist

`src/particles.js`.

The soak model had no concept of capacity: touch soil for `SOAK_TIME`
seconds and vanish, however wet that patch of ground already was. Fill a dug
basin to the brim and forty seconds later it is dry, which is not what a
basin does.

Real ground has a capacity, and the wetness volume added for the damp-patch
work *is* that capacity — already indexed by position, already written by
this very function, already drained by the drying tick. It was never read. A
drop now only drains where the soil under it still has room, so the first
water into dry ground soaks away, the rest sits on top once that patch is
saturated, and as the drying tick pulls the wetness down the pool starts
seeping again from the bottom.

Measured: **700 poured into a dug basin, 699 still there after 36 s**, soil
saturating at 0.73 and levelling off. Previously the same pour drained to
nothing in about 45 s.

That fix has a cost, and it is worth knowing about: persistent water
*accumulates*, and `soakIntoSoil` walked every live drop every frame doing
an SDF lookup with a gradient for each. Measured **22.9 ms a frame with 906
drops against 1.9 ms with none**. It is now amortised over six frames at six
times the elapsed time, so every drop advances at the same average rate and
the drain curve is unchanged: **4.8 ms, and the pool still holds**.

### 7. The pour indicator slid off to somewhere you had not aimed

`src/render_scene.js`.

`updatePourGhost` runs `predictFlow` and, whenever the water would run more
than half a unit from the cursor, `pushPourGhost` drew a second ring at the
predicted basin — the same colour, the same pulse, brighter than the cursor
ring because it was tighter — plus a dotted trail leading to it. On any
sloped ground that fires constantly.

A cursor is a promise about where the thing in your hand will land. Where
the water runs afterwards is the water's business and the player can watch
it happen. The rival ring and the trail are gone; `g.dest` and `g.runs` are
still computed, so anything that wants the prediction can read it.

### 8. `buildMushroom` built the cap in the wrong place, and the collider followed it there

`src/geometry.js`. A `Builder` carries one rotation until something clears
it. The stem is a `limb`, and `limb` runs along +z, so it is built under
`rotEuler(-PI/2, 0, 0)` to stand upright. The cap immediately below is
authored in world axes — its `y` already has `stemH` added in — and nothing
reset the builder in between, so the cap went through the stem's rotation
too: `(x,y,z) → (x, z, -y)`. The stem came out correctly vertical; the cap
came out as a vertical disc lying on the sand *behind* it, which is why it
read as a dartboard in the dirt.

The fix is `b.reset()` between the two, which is what every other builder in
the file already does between limbs.

Measured bbox of `buildMushroom(0)`:

| axis | before | after |
|---|---|---|
| x | -0.226..0.226 | -0.226..0.226 |
| y | -0.226..0.462 | **-0.029..0.584** |
| z | **-0.584..0.067** | -0.226..0.218 |

The 0.584 that was the cap's reach along the ground is its height now, z is
symmetric about the stem, and the -0.029 is the limb's rounded base cap at
`-r0*0.6`, buried in the sand like every other limb in the game. Silhouette
radius (`Batch.meshR`, the number `propBlockR` reads): **0.584 → 0.238**.

**The collision entry moved with it.** The previous pass recorded, on the
entry itself, why `PROP_DRAW.mushroom` blocked at its silhouette: with the
cap on the ground the disc *was* the visible object, and pinning collision to
a 0.070 stem in the middle of it would have been the same mistake that table
exists to remove — defending a circle that is not the one on screen. That
reason is gone. Measured on the fixed mesh over seeds 0..5:

- the stem is the limb, radius 0.048 at the sand to **0.070** under the cap
- the lowest point of the cap is y **0.332** (0.329..0.332 across seeds)
- `pushProps` spawns mushrooms at `p.scale` 0.45..1.15, so the cap underside
  sits 0.149..0.382 above the sand, against a worker ant 0.317 mesh at
  instance scale 0.52 — **0.165** tall

So the cap is overhead and the stem is what a body walks into. `rFix: 0.070`
is back on the entry and `propBlockR` honours it again. Blocking radius for a
mushroom at the smallest, middle and largest spawn scale:

| p.scale | broken mesh, silhouette | fixed mesh, silhouette | shipped (`rFix`) |
|---|---|---|---|
| 0.45 | 0.263 | 0.107 | **0.032** |
| 0.80 | 0.467 | 0.190 | **0.056** |
| 1.15 | 0.672 | 0.274 | **0.081** |

The middle column is the open air that would be fenced off around every stem
in the tank — 60 of them in the rot biome, 44 in the jungle — by a disc drawn
where nothing solid is.

On the real path, not the harness: a loam tank started through the menu and
driven 4000 frames through `AF.__loopStrict`, **23,538 surface ant-frames**
against its four mushrooms. The two the foragers actually walked past were
approached to **0.263** and **0.253** of the stem, where the radius shipping
before this change would have stopped them at 0.435 and 0.342. No ant ended
up inside any prop on any frame, mushroom or otherwise. Note what this does
*not* show: the soak never routed an ant under a cap, so "an ant walks under
it" remains an argument from the geometry — cap underside 0.332·s against a
worker 0.165 tall — and not a measurement.

`rFix` is the documented exception to "block at the outline" and it is the
only one. It does mean a spider (0.98 tall) walks through a cap it could not
fit under: the collider has no height term, there is one disc per prop, so
the choice is which single circle to defend. Leaf and grass are already
fully passable on the same reasoning.

`node tools/check.js` (27 meshes) and `node tools/glsl_lint.js` (34 shaders)
both pass. Cache key bumped to `v=91`.

### 9. Every camera pan threw, and killed the game (the `state: 'error'` bug)

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

### 10. Frame errors kept nothing and stopped nothing

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

### 11. Ants and creatures walked through stones — the radius was never the one on screen

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
equal by construction, for every kind. *(One exception since: `mushroom`
blocks at its stem and not its outline — fixed entry 1.)*

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

### 12. Ground now looks wet where the water soaked in

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

### 13. Water halo — gone, and it was the fabricated normals all along

`src/water_render.js`.

**Read the measurement note first: the round before this one claimed −28%
and it was wrong.** That number came from one big-pool scene and did not
generalise. Re-measured properly — identical 700 frozen particles, identical
camera, one file swapped — the coverage/alpha work scored *identically to
the original build*, to three significant figures. It removed nothing.

| build | pale px outside the water | energy |
|---|---|---|
| original | 170,630 | 627.8 |
| after the coverage/alpha round | 170,662 | 627.9 |
| after the normal-flattening round | **1,838** | **5.95** |

99%, and all of it from one change. The lesson is the same one this file
keeps recording: a rendering A/B on a scene you happened to build is not a
measurement. Freeze the particle state, stub `PS.step`, restore `nbrN` and
`rad` by hand, and render the *same* input through both builds.

Where it comes from, by switching post passes off one at a time against an
identical frame. Of everything painted more than 16 px from real water:

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

Lead (c) is confirmed and is what actually mattered. `FS_BLUR` already walks
the exact neighbourhood that decides whether a fragment is near the
silhouette, and the depth pass already writes alpha 1 where a particle
landed — so box-averaging that alpha over the same reach costs two adds per
tap and no extra fetch, and gives a real **silhouette confidence**.

The first attempt used it to *gate the reflection off* where the normal was
suspect. That removes the ring and also removes the sheen from every pool
too small to have a trusted middle: measured on a shallow spread, the water
stopped being drawn at all. A pool lies on the ground, so the honest
fallback is not "no reflection" but "flat" —

```glsl
N = normalize(mix(vec3(0.0,1.0,0.0), N, edge));
```

— and Fresnel is then computed from a normal the surface could plausibly
have, everywhere. `nv` never collapses, so the mirror ring never forms, and
small pools keep their sheen. **That one line is the 99%.**

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

The wash in the original build was not a ring at all once you look at a
whole frame: it lifted the *entire sheet of sand*. `tools/shots/H_orig.png`
against `H_current.png` shows it plainly — same water, same camera, and the
sand is visibly paler in the first.

### 14. Water looked like a bag of blobs, then like nothing at all

`src/water_render.js`, `src/shaders_post.js`, `src/particles.js`.

Reported as "why does water now look like a lot of small blobs, it's not
like a liquid", and then "I need flowing water with water physics". Four
separate causes, and the first thing to establish was that **none of them
were new**. The build before the halo work rendered the same shallow spread
with **0 visibly-water pixels**: thin water was being discarded, not drawn.
Fixing the halo stopped discarding it, and what appeared was the particle
structure that had always been underneath. Nothing got worse; something
stopped being hidden.

**The blur could not reach across a particle.** `FS_BLUR` exists to melt
neighbouring spheres into one sheet, and its reach was `#define R 10` —
ten *texels*, at every zoom. `gl_PointSize` gives a particle
`uPointScale*0.37/depth` pixels: about 9 across the tank at depth 55, and
about 59 at depth 10. Zoomed out the kernel covered whole spheres and the
pool read as liquid; zoomed in it smoothed a fifth of one and every sphere
kept its own bump. The taps now stride by the projected particle radius, so
the ten of them always span one sphere. The gaussian weight is unchanged
because `i` is now counted in strides rather than texels.

**Thickness was never filtered at all, and thickness carries the colour.**
`exp(-uAbsorb*thick)` over a deep pool is already a smooth integral and
nobody noticed; over a film one particle deep it has exactly one bump per
particle, so the water came out as a pale sheet stamped with a blue dot at
every sphere centre. That is the blob report. Widening the depth kernel does
not touch it — measured, the dots survive unchanged. Added `FS_TBLUR`,
masked by the depth buffer so it smooths the interior and cannot spread
outward and re-open the halo, at half a particle radius (a full radius
averages the film over a far larger area than its own variation and pulls
the peak down to the area mean — the dots vanish and so does the colour).

**Thin water was colourless because the thickness written per splat was ten
times too small for a smoothed field.** `uScale` was 0.055, tuned when the
peaks carried the colour and the gaps carried none. Swept against a real
puddle, measuring the blue-minus-red shift the water introduces and how much
it darkens what is behind it:

| `uScale` | blue shift | darkening |
|---|---|---|
| 0.055 | 0.023 | 0.051 |
| 0.10 | 0.230 | 0.132 |
| **0.13** | **0.298** | **0.168** |
| 0.16 | 0.367 | 0.217 |

0.055 is the "water is transparent" report; 0.16 is poster paint. Safe to
raise because the thickness blur is depth-masked, so a bigger number cannot
push the film past its own silhouette. `uThickK` 1.0 → 2.2 alongside it,
which scales thickness for absorption only and leaves coverage alone.

**The ink pass stippled every pool with soot.** Confirmed by zeroing each of
its two terms in turn: it is the **normal** term, `(1-dot(n,n0))*0.55`. The
fluid composite writes its reconstructed normal into attachment 1, the Sobel
finds "creases" in the filter's ripple, and draws a black mark at each one.
Fixed at the source rather than in the ink pass — attachment 1 is read only
by SSAO and the ink outline, neither of which is shading the water, and a
pool is a horizontal sheet, so the composite now hands that buffer a
flattened normal. Creases on ants, props and dug soil are untouched, and the
depth term still draws the outline round the pool, which is wanted.

While in there, the ink depth term was rewritten to measure in linear eye
space. It was `abs(d-d0)/max(1.0-d0,1e-4)` on the raw depth-buffer value,
which is not a distance: the buffer is 1/z, so the same physical step reads
hundreds of times larger far away, and the `1/(1-d0)` amplifies exactly
where the value is already densest. `linz()` both samples and divide by the
local distance makes the test scale-free — a silhouette is a step of order
the size of the thing casting it, a flat surface is a fraction of a percent.
Grazing ground stops being inked for free.

### 15. A negative `dt` could reach the whole frame body

`src/main.js`.

`loop` clamped `dt` from above and never from below. Nothing in the frame
body survives a negative one: `Game.time` and `Game.sim.time` run backwards,
every `damp()` and timer goes the wrong way, and an `AudioParam` ramp
scheduled in the past throws outright — with a stack pointing at whatever
happened to be making a noise, which is never where the fault is.

`performance.now()` is monotonic so live play could not reach it, but the
harness recipe this file used to prescribe could and did (trap 5), and a
stalled or rewound clock would too. Now `if (!(dt > 0)) dt = 0;`.

`Audio.play` and `Audio._env` were hardened in the same pass, because
`M.clamp(NaN,0,1)` returns NaN — both comparisons are false for NaN — so a
non-finite distance sailed through the quiet-enough early-out and into
`exponentialRampToValueAtTime`. The distance is tested directly now, and
`_env` refuses a non-finite envelope rather than taking the frame down over
a sound effect.

### 16. Dragging the shovel skipped every follow-up

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

### 17. Ground did not absorb water; water skated like ice

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

### 18. Earlier, in this same area (already shipped)

- particles buried inside solid soil are skipped in `WR.gather()`
- water colour is premultiplied for the `premul` composite
- `soilTopAt()` in `src/heap.js` marches down to real soil so objects rest
  on dug ground instead of the analytic terrain height

---

## Open

### 1. Water halo — what is left is a dark surround, not a pale wash

The pale wash is **done**: 170,630 px → 1,838 px on the matched measurement
(fixed 6). What is recorded here is the remainder, which is a different
thing and may not be a bug at all.

What remains outside the water is **darkening**: on the shallow-angle scene
it measured 12,451 px carrying 132 luminance-units, 71% SSAO, 14% bloom, 9%
`R.drawWet`. Some of that
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

### 3. Nothing here — the 8x stone residual closed

Kept as a note because it was open for one round and someone will look for
it. It was 3 ant-frames in 9000 at 8x speed, worst 0.377 into a
1.596-radius rock. Re-measured after the `dt` clamp (fixed 8) and the
mushroom collision entry: **0 in 4000 ant-frames at 1x and 0 at 8x**, for
all four solid prop kinds, and 0 in 700 frames for each of the five
bestiary species driven straight at the big rock. `propBlockR` and the
drawn radius are equal to three decimals for every kind.

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
- **Anything standing on the surface wants `farm.surfaceTop`, never
  `farm.localTop`.** The second is the analytic landscape and does not move
  when you dig. See fixed 1 — it put every ant in the air over a fresh pit,
  and the correct version had already existed in `heap.js` for releases.
- Git on this machine has `core.autocrlf=true`, so a branch checkout hands
  the working tree CRLF while the index is LF. Python patches written
  against LF then silently match nothing. Check with
  `b.count(b'
')` before a batch of edits and normalise once if needed —
  writing LF back leaves the content diff empty, so nothing spurious lands
  in the commit.
- `tools/glsl_lint.js` covers `src/shaders.js` and `src/shaders_post.js`
  only. The GLSL in `src/water_render.js` is inline and **is not linted** —
  scrutinise it by hand, or it compiles at runtime and fails silently into a
  black frame.
- Validate with `node tools/check.js` (every procedural mesh) and
  `node tools/glsl_lint.js` (every named shader) before believing anything.

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
AF.PS                      // fluid/grain sim: .spawn(mat,x,y,z,vx,vy,vz,farm) .px .py .pz .alive .mat .remove(i)
AF.WR                      // screen-space water renderer: .draw() .gather()
AF.__loop(tMs)             // step one frame by hand — drive time deterministically
```

Deterministic frame stepping:

```js
window.__T = 1e6;
for (var i = 0; i < 300; i++) { window.__T += 16.7; AF.__loop(window.__T); }
```

**Two traps that made earlier verification worthless — do not repeat them:**

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

2. **Test where the bug is, not where it is convenient.** A prop test that
   digs at an arbitrary spot reports `propsNearDig: 0` and "passes" while
   grass floats everywhere. Find the actual props first, then dig under
   them.

To A/B a rendering change, run the same measurement against the live site
(old shader) and against localhost (new shader). Normalise by the amount of
real water on screen, or pours of different size are not comparable.

---

## Fixed — with the mechanism and the measurement

### 1. Dragging the shovel skipped every follow-up (the big one)

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

This also explains why every earlier "verified" fix looked fine: the test
harnesses dug in single spaced taps, which always take the fresh-scoop
branch.

### 2. Ground did not absorb water; water skated like ice

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

### 3. Water halo — reduced, not eliminated (see open bug 1)

`src/water_render.js`, composite fragment shader.

Mechanism, confirmed: at the feathered edge of the thickness splats the
reconstructed normal is edge-on, so `nv = dot(N,V)` goes to zero, therefore
`F = 0.02 + 0.98*pow(1-nv,5)` goes to **1.0**, and `col = mix(trans,refl,F)`
collapses to **pure sky reflection** — which was additionally multiplied by
`1.15`, i.e. brighter than the sky itself. That pale wash was painted across
a soft ring far wider than the pool, over sand and past the tank.

Three changes: reflection is gated on real thickness
(`F = mix(0.02, F, smoothstep(0.10,0.60,th.r))`); the `1.15`
over-brightening is gone; the coverage ramp opens at `0.14` instead of
`0.045`, above the splat feather where the normals are noise.

A/B, live old build vs fixed, normalised per pixel of real water: pale
pixels **3.93 → 2.54**, total brightening **15.6 → 10.4**. About a third
removed. **Still visible.**

### 4. Earlier, in this same area (already shipped)

- particles buried inside solid soil are skipped in `WR.gather()`
- water colour is premultiplied for the `premul` composite
- `soilTopAt()` in `src/heap.js` marches down to real soil so objects rest
  on dug ground instead of the analytic terrain height
- stone collision for ants (`src/ants.js`, `surfaceMove`) and for creatures
  (`src/creatures.js`, after the glass clamp) — **but see open bug 3**

---

## Open

### 1. Water halo still visible

Reduced by about 35%, not gone. The remaining contribution has not been
isolated. Next things to try, in order:

- The thickness texture is additive (`blendFunc(ONE,ONE)`) with soft
  gaussian splats, so a wide low-value tail exists by construction. Either
  shrink the splat kernel or subtract a floor from `th.r` before the ramp
  rather than only thresholding it.
- The bilateral blur that smooths the depth/normal buffer spreads the
  surface outward past the sprites. Check its radius against the pool
  silhouette.
- Reconstructed normals at the silhouette are unreliable by nature. The
  principled fix is to reject fragments whose neighbouring depth samples
  differ by more than a threshold — a real silhouette test — rather than
  tuning constants.

Reproduce: pour a lot of water on the surface, look from a shallow angle.
Bisect with `AF.WR.draw = function(){}` and diff the framebuffer.

### 2. Ground does not *look* wet where water soaked in

Water now physically drains into the soil, but nothing darkens. A damp
patch cannot be a decal: the decal pass is additive
(`src/render_scene.js:491` says so explicitly), so it can only brighten.
Doing this properly means a low-resolution wetness volume uploaded
alongside the baked SDF 3D texture (96x60x56) and sampled in the soil
shader to darken albedo.

### 3. Creatures and ants walking through stones — reported still broken

Collision code exists, measured clean for all five species and for ants,
and the live site serves it. The user reports it still happens in real
play. Given bug 1 above, the likely explanation is the same class of
mistake: the measurement drove the creatures through a code path that real
play does not take. **Do not re-verify with the old harness.** Watch an
actual creature walk into a stone at normal speed and log `pos` per frame
against the stone's centre and radius. Suspects: the hunting/fleeing branch
may move the creature after the push-out; `feeding` skips the move but not
the clamp; ants have a separate `surfaceMove` and tunnel path.

### 4. Game entered `state: 'error'` once, about 20 s after the queen died

Not reproduced in two 9000-frame runs. No stack captured.

---

## Constraints that apply to this repo

- `C:/Users/oxman` is itself a git repo — check the toplevel before any
  `git add`.
- Never round-trip a source file through PowerShell `Get-Content` /
  `Set-Content`: it double-encodes UTF-8 silently. Use Python with an
  explicit `encoding='utf-8'`, or a heredoc.
- Watch for apostrophes inside single-quoted GLSL strings when patching
  `src/shaders.js` through a shell heredoc.

# MIGRATION BRIEF — moving the Ant Farm renderer to three.js

Repo: `C:/Users/oxman/ant_farm`. No package.json, no bundler, no build step. `index.html` loads `src/*.js` as plain script tags with a `?v=95` cache key (`index.html:120-148`) — **bump that number after every source edit or the browser serves the old file and your change does not exist.**

The decision to migrate is made. This document exists only to stop the migration silently breaking things that work today. Every claim below carries a `file:line`.

---

## 1. WHAT THIS GAME'S RENDERER IS

A hand-written WebGL2 deferred-ish forward renderer whose entire frame is one fixed, non-reorderable sequence of ~41 passes into ~26 framebuffers, ending with a single FXAA blit to the default framebuffer (`src/renderer.js:793-798`). The scene target is an MRT pair — RGBA16F colour plus an RGBA8 world-normal/roughness buffer — with a sampleable DEPTH_COMPONENT32F depth texture (`src/renderer.js:217-220`), and two of its producers compute their own depth in the fragment shader: the volumetric soil raymarch (`src/shaders.js:500`) and the screen-space water composite (`src/water_render.js:356`). Everything visible is instanced through 32 fixed-capacity `Batch` objects rebuilt from live simulation state every frame (`src/renderer.js:143-178`, `src/renderer.js:801-804`), with all culling, LOD and world placement done on the CPU or in the vertex shader — there is no scene graph and no model matrix anywhere in the instanced path (`src/shaders.js:653`). There are no asset files: all 27 meshes are procedural (`node tools/check.js`), all 34 named shaders are string literals (`node tools/glsl_lint.js`), and non-render code reaches directly into the renderer for gameplay answers (collision radii from `Batch.meshR` at `src/game.js:385`, picking rays from `R.Camera.ray` at `src/renderer.js:315`).

---

## 2. WHAT MUST STILL BE TRUE AFTERWARDS

### 2.1 BLOCKERS — context, targets, and the frame graph

**B1. `EXT_color_buffer_float` must be acquired and every float target must remain float.**
`src/gl.js:40` fetches it; without it RGBA16F/R16F are not colour-renderable. Consumers: `src/renderer.js:216` (`F16` used at 219, 221, 226-230, 237-238), the five water targets at `src/water_render.js:544, 556-560`, the R16F SDF at `src/renderer.js:248`. *Breaks as:* every FBO reports incomplete (`src/gl.js:325`) and the screen is black. Values above 1.0 are load-bearing — the water glint measures 6.27 against a bloom threshold of 1.45 (`src/water_render.js:452-457`) and the storybook soil deliberately scales past 1.0 (`src/shaders.js:333`). LDR targets = no bloom, no glint, banded soil.

**B2. `sceneFB` is MRT(2) + a depth TEXTURE, and attachment 1 is a world-normal buffer.**
`src/renderer.js:217-220`; depth is DEPTH_COMPONENT32F/NEAREST (`src/gl.js:310-316`). Eight programs write both outputs: `src/shaders.js:284-285` (soil), `675-676` (creature), `823-824` (static), `892-893` (flora), `1002-1003` (glass), `1193-1194` (sky), `1240-1241` (liquid), `src/heap_render.js:38-39`, `src/water_render.js:309-310`. Attachment 1 is read by exactly two consumers: SSAO (`src/renderer.js:662`) and the ink Sobel (`src/renderer.js:786`). *Breaks as:* lose the depth texture and SSAO, DOF and the entire ink outline die — that is most of the art direction. Lose attachment 1 and every object loses its drawn black line and the tank gains blotchy AO.

**B3. Four single-output passes must mask attachment 1 off and back on.**
`R.colorOnly()` / `R.restoreMRT()` at `src/renderer.js:511-516`, bracketing decals (`527/530`), ghosts (`545/548`), transparents (`558/580`), wet (`642/645`). Those shaders declare one output: `src/shaders.js:1060, 1101, 1156, 1296`. WebGL2 treats fewer outputs than active draw buffers as an error and drops the draw. *Breaks as:* pheromone trails, particles, selection rings, the build preview and the damp ring all silently stop rendering.

**B4. `copyFB` is the only legal refraction source, written at exactly one point in the frame.**
`R.copyScene()` (`src/renderer.js:583-592`) blits `sceneFB.color[0]` into `copyFB` and re-binds `sceneFB` with `bind(false)` — **clear = false** (`src/renderer.js:591`). It is called once, at `src/render_scene.js:274`, after all opaque + wet + decals + ghosts + transparents and before glass (`275`), tubes (`287`), liquids (`288`) and water (`293`). Sampled at `src/renderer.js:599`, `src/renderer.js:618`, `src/water_render.js:718`. *Breaks as:* sampling the live scene target is a framebuffer feedback loop — `INVALID_OPERATION`, draw dropped, **no glass and no water at all** (the prohibition is written out at `src/water_render.js:351-355`). Clearing on re-bind wipes the whole opaque scene twice per frame, leaving glass and a water film floating on black. Moving the copy makes glass refract glass, or water refract itself.

**B5. Global pass order is fixed and non-reorderable.**
Sky → statics → soil → vitrine frames → creatures/props → flora → heap → wet → decals → ghost → transparents → copyScene → glass → tubes → liquids → water(7 sub-passes) → post(17 passes) → FXAA-to-screen. Anchors: `src/render_scene.js:190` (shadow), `197` (beginScene), `231` (soil), `243-259` (creatures), `262` (heap), `266/269/270/271` (wet/decals/ghost/transparents), `274` (copy), `275-288` (refractive), `293` (water), then `src/renderer.js:652-799` (post). Producers must precede consumers; no reordering raises a GL error.

**B6. Shadow pass runs first, writes `R.lightVP` and the depth texture together, and casts from exactly three batch groups.**
`src/render_scene.js:190-194` draws only `antBatches`, `propBatches`, `floraBatches`. `R.lightVP` is computed inside the same call (`src/renderer.js:376`) and bound with the texture (`src/renderer.js:358-362`). *Breaks as:* run it after the scene and shadows lag a frame and swim during camera moves. Add soil or the room to the caster list and the whole tank goes black — the ortho light box is fitted to the ant-scale focus radius (`src/renderer.js:374-375`), not the room.

**B7. `bakeFB` renders into individual layers of a 3D R16F texture, and the SDF is never CPU-uploaded.**
`src/renderer.js:192` creates an attachment-less FBO; the layer is attached per slice at `src/renderer.js:275-279` (`gl.framebufferTextureLayer` + `uLayer` + fullscreen triangle), viewport set to the grid at `src/renderer.js:262`. Grid 96×60×56, or 64×40×36 on Low (`src/game.js:94-96`). `BAKE_FS` derives its voxel from `gl_FragCoord.xy` plus `uLayer` (`src/shaders.js:217-219`) and carves tunnels from a 1024×1 RGBA32F capsule texture in a `for(int i=0;i<512;i++)` loop (`src/shaders.js:201`, `src/renderer.js:189-191, 273`). *Breaks as:* no field to march — the tank renders as a solid block or an empty box and digging does nothing visible.

**B8. The bake hijacks the viewport and never restores it.**
`src/renderer.js:261-262` then `src/renderer.js:280` (`bindFramebuffer(null)`, no viewport restore). It runs during *update*, one dirty farm per frame (`src/game.js:1119`), and survives only because the next FBO bind resets the viewport (`src/gl.js:330`). *Breaks as:* on any frame after a dig the whole game renders into a 96×60 box in the bottom-left corner.

### 2.2 BLOCKERS — shaders

**B9. Soil writes `gl_FragDepth` from the raymarch hit point.**
`src/shaders.js:499-500`, with `if(!hit) discard;` (`src/shaders.js:433`) and the box-miss discard (`src/shaders.js:411`). The rasterized geometry is a unit cube (`src/renderer.js:181`) expanded in the VS from `uBoxCenter`/`uBoxHalf` (`src/shaders.js:257`), so the interpolated depth is the glass-facing box face, metres in front of the soil. *Breaks as:* the tank becomes a solid slab — every ant, larva, pebble, ring and pool inside fails the depth test. **No depth pre-pass, no auto-generated depth/shadow variant of this material may exist**; either would lay down box-face depth and the colour pass (default `LESS`) would then reject every raymarch hit. Losing the miss-discard paints a solid lid over the air inside the box.

**B10. Soil culling flips when the camera is inside the box.**
`src/renderer.js:452-456`, `GLX.cull(inside ? 'front' : 'back')`, recomputed per farm per frame against `farm.center`/`farm.half + 0.05`. Reason at `src/renderer.js:448-451`. *Breaks as:* the entire tank vanishes the moment the camera pushes inside the soil volume — which is the normal close-up view.

**B11. Water impostors and the water composite both write `gl_FragDepth`.**
Impostor: `src/water_render.js:88-92` reconstructs the sphere front and writes depth so the eye-space depth in `oDepth.r` and hardware depth agree. Composite: `src/water_render.js:356`, drawn with `GLX.depth(true, true)` (`src/water_render.js:714`) and gated by coverage *before* the write — `if(nd.w <= 0.0 || th.r <= 0.14) discard;` (`326`) and `float cov = smoothstep(0.14,0.46,th.r); if(cov <= 0.004) discard;` (`345-346`). *Breaks as:* impostor depth lost → the blur, normal rebuild and thickness reject all run on a flat billboard and pools return as cardboard discs. Composite depth-write lost → pools get no ink outline (the Sobel is over depth+normals, `src/shaders_post.js:272-302`) and are ignored by DOF/SSAO. Coverage gate removed → a 1%-coverage fragment stamps water into depth and SSAO/DOF/ink draw a dark fringe metres past the puddle.

**B12. Fixed attribute locations 0-8, bound by name before link, for every program.**
`src/gl.js:76-79` and `src/gl.js:87`. `Mesh` wires buffers from that table, not from what the program declares (`src/gl.js:156-157`). This is what lets one VAO feed the main pass and the shadow pass (`src/gl.js:74-75`, exercised at `src/render_scene.js:183-193` → `244-259`). Three shaders instead pin locations in GLSL against hand-built VAOs: `src/water_render.js:61-62` (stride 6 floats, pointers at `535-538`) and `src/heap_render.js:26-28` (stride 32 bytes, pointers at `78-80`). *Breaks as:* the shadow pass reads the wrong buffer — ants cast shadows of the wrong shape, or exploded geometry across the tank; water particles read radius as position; the heap reads normals as positions.

**B13. Per-instance attributes carry divisor 1, and the draw count is `n`, not capacity.**
Five vec4 streams appended per batch with `divisor: 1` (`src/renderer.js:55-59`, applied at `src/gl.js:165`), drawn instanced (`src/gl.js:195, 198`). `Batch.draw` uses `this.n` (`src/renderer.js:85-86`); the backing arrays are capacity-sized and **never cleared** — `begin()` only rewinds the cursor (`src/renderer.js:63`). *Breaks as:* divisor 0 collapses 4000 ants into one smear; drawing at capacity resurrects up to 4200 ants, 700 pebbles and 5000 particles frozen at last frame's positions, with a ~10× framerate collapse.

**B14. Instance positions are absolute world coordinates; the object matrix is identity.**
`vec3 wp=R*(p*aIPos.w)+aIPos.xyz;` (`src/shaders.js:653`); no `uModel` in `CREATURE_VS`, `FLORA_VS` (`875`), `LIQUID_VS` (`1228`), `DECAL_VS` (`1146`), `PART_VS` (`1090`) or `PHERO_VS` (`1049`). All visibility is CPU-side per instance (`src/render_scene.js:114, 352-353, 423, 549, 796-797, 911, 926`). *Breaks as:* any bounding-volume culling based on the base mesh drops entire batches at once — all ants, all props, all grass pop out together the moment the camera looks away from the world origin.

**B15. The 20-slot positional `Batch.push` signature.**
`src/renderer.js:64-75`: `aIPos=(x,y,z,scale)`, `aIRot=(yaw,pitch,roll,phase)`, `aIAnim=(walk,attack,extra,variant)`, `aIColA=(r,g,b,rough)`, `aIData=(health,sel,glow,flags)`. 41 unlabelled positional call sites. Slots are **reinterpreted per program**: `PART_VS` reads `aIData` as `(life01, kind, spin, seed)` (`src/shaders.js:1082-1084`, producer note at `src/fx.js:94`); `PHERO_VS` as `(age, type, seed, pulse)` (`src/shaders.js:1045`); `DECAL_VS` as `(style, phase, thickness, orientation-flag)` (`src/shaders.js:1136, 1143-1145`); `FLORA_VS` uses `aIAnim.w` as a wind seed (`src/shaders.js:865`) where `CREATURE_VS` uses it as brood stage. *Breaks as:* one transposed slot silently rewires the game — matte-black ants, ants standing on their noses, grass swaying in lockstep, chamber previews lying flat in the dirt like a dartboard.

**B16. Brood stage selection works by pushing vertices outside the clip volume, and props ride the same path.**
`if(uIsAnt<0.5 && abs(aPart.w-aIAnim.w)>0.5){ gl_Position=vec4(2.0,2.0,2.0,1.0); ... return; }` (`src/shaders.js:642-647`). `uIsAnt` is a tri-state set by draw grouping: 2 for ants+spider (`src/renderer.js:471`, drawn `src/render_scene.js:244-246`), 1 for the bestiary (`251-252`), 0 for brood **and all seven prop batches** (`253-255`). Props pass because every prop mesh has `aPart.w == 0` (`src/geometry.js:21, 508, 617, 676`) and every prop push passes `variant 0`. *Breaks as:* drop the selector and every nursery is a row of identical white beans (egg+larva+pupa stacked); give a prop a non-zero `aPart.w` or variant and all pebbles or all sugar vanish with no error; regroup the draws and beetles get ant colouring, spiders lose their tagma tint.

**B17. Two vertex shaders draw with no attributes, from `gl_VertexID`, as a single triangle.**
`src/gl.js:364-368` and `src/water_render.js:135`, driven by `GLX.fullscreen()` which binds an empty VAO and issues `drawArrays(TRIANGLES, 0, 3)` (`src/gl.js:371-375`). Shared by 14 post/bake programs and 4 water programs. *Breaks as:* every post pass, the SDF bake and the water blur/normal/composite chain draw nothing — black screen. A fullscreen *quad* substituted for the triangle introduces a diagonal seam in derivative-based effects; the ink pass and FXAA were tuned on one triangle.

**B18. Water uses `GL_POINTS` with shader-computed `gl_PointSize` and a Y-flipped `gl_PointCoord`.**
`gl_PointSize = clamp(uPointScale*vRad/max(0.02,-e.z),1.0,220.0);` (`src/water_render.js:75`) with `uPointScale = h * cam.proj[5]` (`622`); `vec2 c = vec2(gl_PointCoord.x, 1.0-gl_PointCoord.y)*2.0-1.0;` (`84`, `116`). The same `pointScale` sets the blur stride (`663`). *Breaks as:* one-pixel sprites (invisible water) or 200-pixel sprites (the tank floods blue); losing the Y flip tips every sphere normal upside down and the pool lights from below.

**B19. The shadow map is a LINEAR-filtered DEPTH_COMPONENT32F texture read as a plain `sampler2D`, with compare mode OFF.**
`src/renderer.js:184` (`depth:'texture', depthFilter: gl.LINEAR`, realised at `src/gl.js:312-313`); `uniform sampler2D uShadowMap;` (`src/shaders.js:108`) with hand-rolled 3×3 PCF and an explicit compare (`src/shaders.js:121-124`). Compare parameters are only set when `o.compare` is passed (`src/gl.js:230-233`) and `depthCompare` is never passed anywhere. The FBO has no colour attachment → `drawBuffers([NONE])` (`src/gl.js:317`), though `SHADOW_FS` still declares an unused output (`src/shaders.js:791-792`). Fixed 2048 (`src/renderer.js:183`), untouched by resize, with `uShadowTexel = 1/2048` hard-linked to the tap spacing (`src/renderer.js:361`). *Breaks as:* a comparison sampler makes `.r` a 0/1 result and shadows invert or disappear; NEAREST makes every shadow edge hard and stair-stepped; a resolution tied to the adaptive scaler makes shadow softness pump with the framerate.

### 2.3 BLOCKERS — blend, depth and cull state

**B20. `'addpre'` is `blendFunc(ONE, ONE)`.** `src/gl.js:388`. Sites: decals `src/renderer.js:525`, ghosts `543`, pheromones+particles `556`, water thickness `src/water_render.js:637`. Thickness is an *accumulation* buffer whose splats write alpha 0 in one channel (`src/water_render.js:128`), so any `SRC_ALPHA` source factor multiplies by zero: the field collapses, `th.r` never clears the `0.14` reject (`326`), and **every pool loses its colour entirely**. Decals, trails and dust stop stacking and go flat.

**B21. `'premul'` is `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)` and the shaders premultiply.** `src/gl.js:389`. Glass `src/renderer.js:603`, liquids `623`, water composite `src/water_render.js:715`, and re-armed at `src/renderer.js:646`. Shaders premultiply to match: `src/water_render.js:484`, `src/shaders.js:1128, 1283`. **Attachment 1 rides the same blend and its alpha must equal coverage**: `oNormal = vec4((Ngb*0.5+0.5)*cov, cov);` (`src/water_render.js:513`), reasoned at `491-499`. *Breaks as:* a second alpha multiply makes pools and glass dark translucent grey; a wrong attachment-1 alpha saturates the RGBA8 normal buffer to white, SSAO decodes N=(1,1,1) and smears a dark fringe ~35 px past every pool — the exact halo bug this file already fixed once.

**B22. `'multalpha'` is `blendFuncSeparate(DST_COLOR, ONE_MINUS_SRC_ALPHA, ZERO, ONE)` — the only darkening pass in the frame.** `src/gl.js:395`, used at exactly one site, `src/renderer.js:640`. Reason at `src/renderer.js:630-632` and `src/gl.js:393-395`. It must run **before** the additive decals (`src/render_scene.js:266` vs `269`, reason at `264-265`). *Breaks as:* made additive, the damp ring under a puddle renders as bright arcs. Reordered after decals, cursor highlights over damp ground go muddy. (This pass is **dormant** — `Game.pushWet` returns immediately at `src/render_scene.js:620` — so a regression here will not show on screen until that `return` is deleted, which `src/render_scene.js:615-618` says is the intended re-enable.)

**B23. Depth state per pass.** Sky: test off, write off (`src/renderer.js:393`, restored `407`) — and the fullscreen triangle sits at clip z = 0, i.e. **window depth 0.5, not 1.0** (`src/gl.js:366`), so a sky that wrote depth would stamp 0.5 over the whole screen and depth-reject the room, the table and the far half of every tank. The 1.0 far-plane sentinel is read at `src/shaders_post.js:36` (SSAO) and `src/shaders_post.js:274` (ink). Transparent passes: test on, write off — `src/renderer.js:524, 555, 602, 622, 639`. Ghost: **test off, write off** (`src/renderer.js:542`, restored `549`), because a room you have not dug is buried in soil (`src/renderer.js:533-535`). Water composite: test on, write **on** (`src/water_render.js:714`). Water thickness: both off with a shader-side occlusion test instead (`src/water_render.js:637` + `126`).

**B24. `depthFunc` is never called anywhere in `src/` — every pass runs on the GL default `LESS`.** Coplanar geometry is separated by hand: the glass panes are built `+0.10` outside the soil box precisely because flush panes z-fight across the whole face of the tank (`src/render_scene.js:26-30`). There is also **no `polygonOffset` anywhere** (`src/gl.js:398-402` is the only face-state helper). *Breaks as:* under `LEQUAL`, coplanar pairs flip to "last drawn wins" and the shimmer reappears elsewhere as a stable-but-wrong surface; a polygon offset detaches puddle rings and cursor highlights from the ground at some zooms.

**B25. Two-sided vs one-sided is per pass, and two shaders read `gl_FrontFacing`.** `GLX.cull(false)` for flora (`src/renderer.js:486`), heap (`src/heap_render.js:125`), decals/ghost/transparents (`526, 544, 557`), glass (`604`), liquids (`621`), wet (`641`), water composite (`src/water_render.js:716`) and every fullscreen pass. Back-face culling only for statics/creatures/shadow (`src/renderer.js:382, 474, 503`). Flora and glass flip the normal on back faces: `if(!gl_FrontFacing) N=-N;` (`src/shaders.js:896`, `src/shaders.js:1006`). Nothing in `src/` ever calls `gl.frontFace`, so the whole codebase assumes CCW-is-front. *Breaks as:* culled flora loses half of every blade and leaf; culled sprite passes lose half the quads depending on winding; a winding flip inverts `gl_FrontFacing` and lights grass and glass from the wrong side.

### 2.4 BLOCKERS — where non-render code reaches in

**B26. `R.B[batch].meshR` is the gameplay collision radius.** Measured from the base mesh's own position array at `src/renderer.js:43-48`; read by `src/game.js:385` and cached into `S._r` on first use. The whole point (`src/renderer.js:22-42`) is that the drawn silhouette and the blocking radius are one number. Fallback when absent: `0.9 * S.s * p.scale` (`src/game.js:387-388`). *Breaks as:* mushrooms and twigs grow invisible fences ~3× and ~12× too wide, ants detour around empty sand, and the documented "ant standing inside the big rock" regression reopens — and because `S._r` is cached, the wrong value sticks for the session.

**B27. `R.Camera` is a public gameplay type with plain fields.** `new R.Camera()` at `src/game.js:21`; `cam.pos`/`cam.target` written as `Float32Array(3)` at `src/input.js:449-453`; `cam.fov` written in **radians** at `src/input.js:455`; `Rig.avoidSoil` pushes `cam.pos` out of solid soil (`src/input.js:461-492`, reason at `458-460`); `cam.pos` feeds audio panning (`src/game.js:984`); `cam.vp` feeds box-select (`src/player.js:532`) and the god-ray sun projection (`src/render_scene.js:1091-1097`, hand-multiplied column-major). `cam.update(aspect)` rebuilds `proj/view/vp/invVP/invProj` together (`src/renderer.js:300-306`) during the *update* stage (`src/game.js:983`, stage at `src/main.js:307`), before render. *Breaks as:* lose `avoidSoil` and the eye buries itself in soil — the raymarch finds no surface and the tank reads as props floating in an empty room. Degrees where radians are expected gives a ~57× field of view.

**B28. `Camera.ray(ndcX, ndcY, o, d)` is the only path from mouse to world, using WebGL NDC z −1..+1.** `src/renderer.js:315-320`. Consumers: `Game.pickRay` (`src/player.js:23-26`) → `pickAnt/pickItem/pickNode/pickFarm` (`28-70`), `digPlanePoint` (`73`), the hover block (`144`), the shovel (`src/excavate.js:240-258`), zoom-toward-cursor (`src/input.js:304-315`). *Breaks as:* hover picks the wrong ant, orders land offset from the click, the shovel digs somewhere else, the wheel zooms away from the cursor — all silent.

**B29. `R.project` returns clip **w** in `out[2]`, not NDC z.** `src/renderer.js:328`, tested as `if (_proj[2] <= 0) continue;` at `src/player.js:533`. *Breaks as:* a project function returning NDC z inverts the sign test — the marquee selects ants behind the camera and refuses the ones inside the rectangle, while the drawn rectangle (`src/main.js:346`) still looks correct.

**B30. Picking uses CSS pixels; post uniforms use drawing-buffer pixels. They must not be unified.** `src/input.js:169-174` derives NDC from `getBoundingClientRect()` and caches `viewW/viewH` in CSS px (re-derived independently at `src/player.js:523-527`); `uRes`/`uTexel` are drawing-buffer px (`src/renderer.js:600, 619, 770, 796`; `src/water_render.js:737`). The canvas CSS box is owned solely by `css/ui.css:61` — the renderer writes only `R.canvas.width/height` (`src/renderer.js:207`). *Breaks as:* clicks land off by the DPR factor and drift as `perfScale` adapts; or FXAA, grain, paper tooth and the ink line all come out the wrong scale. An inline pixel style on the canvas causes both at once, plus a marquee drawn at half the size of the region it selects.

**B31. The finished frame must be in the default framebuffer when `Game.render()` returns.** `GLX.bindScreen` + FXAA at `src/renderer.js:793-798` (`src/gl.js:351-354`). The measurement harness reads back in the same JS task (`BUGS.md` trap 1) and `tools/harness.js:73` calls `toDataURL`. *Breaks as:* a final pass that leaves an offscreen target bound shows a black or stale canvas, and every readPixels verification in `BUGS.md` returns black.

**B32. `AF.__loop` / `AF.__loopStrict` must draw synchronously inside the call, and render throws must stay catchable by `runStage`.** `src/main.js:318, 324-328`; five attributed stages at `src/main.js:306-310`; errors recorded with a world snapshot at `src/main.js:104-121` and tolerated until a repeat. *Breaks as:* deferred work (async shader compile, promise-based upload, an internal rAF) makes readPixels sample the *previous* frame — every A/B in `BUGS.md` compares the wrong pair — and a throw escaping via a microtask leaves `Game.lastError` null and the game silently stops drawing.

**B33. `R.init(canvas)` must be synchronous and return a boolean.** `src/main.js:202-205`, then `UI.setBoot(34, 'compiling ' + Object.keys(R.P).length + ' shader programs…')` at `src/main.js:206`, then `Game.init` at `208`. `R.init` returns `true` at `src/renderer.js:195`. *Breaks as:* an async init returns a truthy Promise, boot proceeds, the boot line reads "compiling 0 shader programs", and the first frame draws nothing behind a "ready" overlay.

**B34. `R.width`/`R.height` are plain writable numbers equal to the drawing-buffer size, and the resize is polled.** `src/renderer.js:203-207` (`Math.max(320, floor(cssW*dpr))`, `Math.max(240, ...)`, early-out at `205`); polled at `src/main.js:291-292`, with forced resizes defeating the early-out by writing `R.width = 0`. `effectiveDpr()` = `min(devicePixelRatio, Game.dprCap||1.35) * Game.perfScale` (`src/main.js:247-250`), with `dprCap` from the quality preset (`src/ui.js:140-143`) and `perfScale` walked 0.62↔1.0 by the fps governor (`src/main.js:286-287`). Resize destroys and rebuilds every target (`src/renderer.js:210-241`, including `AF.WR.resize` at `232`). *Breaks as:* if the size no longer matches `targetWidth()` exactly, ~26 render targets are reallocated 60×/second and the game becomes a slideshow with climbing GPU memory; if `R.width` becomes read-only, `R.width = 0` throws on the first quality change.

**B35. `AF.WR` and `AF.HeapR` are separate modules initialised from `R`, resized by `R.resize`, and compositing into `R.sceneFB` while sampling `R.copyFB`.** `src/renderer.js:125-126, 232`; lazy catch-up at `src/water_render.js:614`; composite at `src/water_render.js:712-718`; heap at `src/render_scene.js:262`. **`AF.WR.draw` must remain a replaceable property looked up on the global each frame** (`src/render_scene.js:293`) and `WR.thickScale`/`thickK`/`tint` must stay read at draw time (`src/water_render.js:642, 751, 755`), because `BUGS.md` line 843 documents the only trusted water measurement as reading the frame twice in one JS task with `AF.WR.draw = function(){}`.

**B36. `AF.Wet` owns a raw R8 3D texture created and sub-updated from simulation code.** `src/particles.js:741-745` and `src/particles.js:816`; `UNPACK_ALIGNMENT` forced to 1 and back to 4 around the sub-upload (`src/gl.js:273-280`, reason at `266-272`) because a 90-wide R8 row is not 4-byte aligned. The CPU deposit subtracts the same half texel the bake adds (`src/particles.js:748-756`). A 1×1 black fallback `R.zeroVol` is built eagerly in `R.init` (`src/renderer.js:121-124`) and bound when a farm has none (`src/renderer.js:433`) — reason at `src/renderer.js:424-432`: lazy creation would unbind the SDF just bound on the same unit, and `Program.tex` clears the other target on the unit before binding (`src/gl.js:135-136`). *Breaks as:* wrong alignment → `INVALID_OPERATION` and the ground never darkens; wrong addressing → damp patches land a third of a cell off the puddle; no fallback → the soil samples the 2D shadow map through a `sampler3D` and the tank flickers black.

**B37. `R.createSDF`/`R.bakeSDF` must be re-run on every dig, in the order `Game.rebake` uses.** `src/game.js:915-923`: bake → `SDFCache.invalidate` → `PS.wakeAll` → `Heap.rebakeGround` → `pruneFloatingProps`. *Breaks as:* miss the bake and digging changes nothing on screen while ants re-path into an invisible tunnel; miss the ordering and grass hangs in the air over a fresh shaft.

**B38. `S.SURFACE` in GLSL must stay byte-identical to `AF.World.surfaceH`.** `src/shaders.js:181-189`, offset by `uSurfOrigin` at `src/shaders.js:224` (fed `[farm.center[0], farm.center[2]]`, `src/game.js:916`). *Breaks as:* ants walk sunk into or hovering above the ground and dug pits do not line up with the shovel.

### 2.5 HIGH — things that visibly change but do not black-screen

- **Half/quarter-res post targets, sampled bilinearly at full res.** AO/DOF at `w>>1` (`src/renderer.js:222-227`, AO is R8), god rays at `w>>2` (`228-230`), composite full-res RGBA8 (`231`), bloom a 6-level pyramid halving until `bw <= 8` (`233-240`). FBO colour attachments default to LINEAR (`src/gl.js:301`). *Breaks as:* NEAREST turns bloom into a checkerboard and AO into chunky 2×2 patches; full-res rays shorten the 48-tap shafts (`src/shaders_post.js:222-225`) into a halo round the sun; mismatched `bloom`/`bloomUp` lengths throw at `src/renderer.js:714`.
- **Disabled-effect targets are cleared to specific neutral values.** AO → white (`src/renderer.js:687`), DOF → alpha 0 (`739`, consumed at `src/shaders_post.js:323`), rays → black (`758`). *Breaks as:* clear AO to black on the Low preset (`src/ui.js:140` sets `fx.ao = 0`) and the composite multiplies the whole frame by zero — a black screen on Low graphics.
- **Water targets are FULL resolution.** `src/water_render.js:555`, correcting note at `552-554`: half-res was tried and reverted because the silhouette stair-steps and the ink pass then outlines the steps.
- **`FB.depth`'s ALPHA carries silhouette confidence after the blur.** Impostor writes alpha 1 (`src/water_render.js:93`), clear writes alpha 0 (`627`), the blur box-averages it (`206`, `213`), the composite reads it as `solid`/`edge` (`337-338`) and blends the normal toward world up (`375`). *Breaks as:* clear alpha to 1 and `edge` never falls — Fresnel goes to 1 and every pool gets a bright mirror ring. This one line is documented as 99% of the halo fix (`BUGS.md` fixed 13).
- **Water pass order inside the module.** depth → thickness (rejects against depth, `src/water_render.js:640` + `126`) → depth blur ping-pong ending **in `FB.depth`** (`665-677`) → thickness blur ping-pong ending **in `FB.thick`** (`684-702`) → normals rebuilt from the *smoothed* depth (`705-706`) → composite reading `FB.depth`, `FB.thick`, `FB.nrm`, `copyFB` (`718-726`). Ordering rationale at `105-107`, `681-683`, `721-725`.
- **The water normal handed to attachment 1 is deliberately flattened.** `src/water_render.js:512`, reasoned at `500-511`. *Breaks as:* every pool is stippled with black ink speckle and reads as a bag of marbles.
- **AO ping-pong ends in `aoFB`, not `aoFB2`** (`src/renderer.js:659, 672-681, 766`); bloom up-pass uses the **source** level's texel size and adds `uPrev` (`src/renderer.js:714-716`, `src/shaders_post.js:157`); god rays copy `bloom[1]` (`src/renderer.js:744-746`) so they depend on the down chain having run.
- **`uNear`/`uFar` must be the real camera values** (0.35 / 420, `src/renderer.js:292-293`, bound at `727, 789-790`) because `linz()` linearises depth for both the ink edge test and DOF (`src/shaders_post.js:269, 297-298, 339-340, 172-176`).
- **Composite → offscreen RGBA8, FXAA → screen.** Tonemap/grade happen only in the composite (`src/shaders_post.js:304-362`) into `compFB`; FXAA+sharpen is the only screen pass (`src/renderer.js:793-798`). *Breaks as:* double tonemapping (milky frame) or FXAA over an HDR buffer (everything bright clips to white).
- **Batch overflow silently drops the instance; only `pushAnts` has a fallback** (`src/renderer.js:66`, fallback at `src/render_scene.js:820-829`). Producers can outrun caps by design: `pushParticles` emits up to 5200 sugar crystals into a 4200 cap (`src/render_scene.js:578-591` vs `src/renderer.js:177`); bestiary batches are shared between living animals and carcasses against caps of 12/16/24 (`src/render_scene.js:157, 436`).
- **Nothing is depth-sorted.** The only sort in the render path is `lights.sort` (`src/render_scene.js:131`). Droplets then puddles, in that fixed order, with premul blending and depth-write off (`src/renderer.js:622-627`).
- **The billboard quad spans −1..1 with 0..1 UVs, and `DECAL_VS` uses `aPos.xy` AS the UV.** `src/geometry.js:1046-1056`; `vUV=aPos.xy;` (`src/shaders.js:1147`) read as a signed radius against literals like `abs(r-0.86)` (`src/shaders.js:1163, 1171, 1299`), while `PART_FS`/`PHERO_FS` use the real UV remapped (`1103, 1063`). *Breaks as:* a −0.5..0.5 plane quarters every particle's area and puts every ring radius outside the quad — selection rings, rally marker, pour contour and dig preview all disappear.
- **Billboards are built from view-matrix rows passed as `uRight`/`uUp`** (`src/shaders.js:1049, 1090`, fed from `src/renderer.js:553-554`); decals are NOT billboards (`src/shaders.js:1143-1145`).
- **Context flags:** `alpha:false` (`src/gl.js:14`), `antialias:false` (`15`) — the game owns its own AA, `depth:true`/`stencil:false` (`16-17`), `powerPreference:'high-performance'` (`18`), `preserveDrawingBuffer` gated on `?shot` (`19`, fed from `src/renderer.js:98`). *Breaks as:* losing `high-performance` hands back the integrated GPU on dual-GPU laptops and `perfScale` walks down to 0.62 permanently; losing `preserveDrawingBuffer` makes every harness screenshot blank while the game still looks fine.
- **Context-loss handling must survive.** `src/gl.js:27-38` calls `preventDefault()` and raises the boot overlay with "The graphics context was lost." *Breaks as:* a lost context makes every GL call a silent no-op — blank canvas, no message (reason at `src/gl.js:24-26`).
- **`R.quality` (0.0/0.3/0.65/1.0) is written by the UI (`src/ui.js:140-143`) and read inside the soil raymarch (`src/renderer.js:442`).** *Breaks as:* the LOW preset stops shortening the march and the quality menu becomes decorative.
- **`R.stats` is reset by `R.frameStart` (`src/renderer.js:801-804`), which is also what resets every batch's `n`.** Read by the harness (`tools/harness.js:191-193`). *Breaks as:* drop the reset half and batches accumulate until they hit `cap` and things stop appearing seconds into play.
- **The menu path clears the screen through raw GL, outside any `runStage` try/catch** (`src/main.js:297-302`). *Breaks as:* if `R.gl` or `GLX.bindScreen` disappear, the first frame after boot throws where nothing catches it, rAF is never re-armed, and the main menu freezes.

### 2.6 EXPLICITLY DO NOT PORT / DO NOT "FIX"

- `GLX.blend('add')` (`src/gl.js:387`), `'multiply'` (`393`) and the fall-through branch (`396`) are **dead** — no call site selects them. Porting them creates untested blend paths.
- `EXT_texture_filter_anisotropic` is acquired (`src/gl.js:42`) and used by one line nothing calls with an `aniso` key; `WEBGL_debug_renderer_info`'s result (`src/gl.js:47-48`) is only read by the harness for provenance. Do not spend time on anisotropy.
- **`B.water` is filled every frame and never drawn** (`src/render_scene.js:561-564` vs its absence from every draw list; construction at `src/renderer.js:176`). Wiring it up renders every pool twice — the "bag of marbles" look the screen-space pass replaced — and overflows (1200 cap vs 2600 particles).
- **`B.wet`/`Game.pushWet` are dormant** (`src/render_scene.js:619-620`). Keep the pass and its multiply blend correct; do not delete it, do not enable it.
- **The shadow-map depth clear currently runs under a false depth mask.** `src/renderer.js:378-380` clears before re-enabling `depthMask`, and `R.post` leaves `GLX.depth(false,false)` at `src/renderer.js:654`. The 2048² map is therefore effectively never cleared after the first frame. A correct clear **will change how shadows look** (crisper). Expect and A/B that change; do not chase it as a regression, and do not faithfully reproduce the masked clear.
- **`SHADOW_VS` has no brood stage selector** (`src/shaders.js:774-788`), so a brood instance casts all three stages' shadow at once. Shipped behaviour. "Fixing" it changes the look of every nursery.
- Props inherit a `(1.06,1.05,1.02)` "egg" tint because they draw at `uIsAnt 0` (`src/shaders.js:755-760`), and skip the chitin block (`690-733`) so `health` is inert for them. A "clean" per-batch material makes every stone and sugar grain ~5% darker — a uniform, hard-to-diagnose shift.

---

## 3. THE LANDMINES

Ordered by how much damage the default does. **[RAW GL]** marks the two places that need `renderer.getContext()`.

**L1 — GLSL version. `ShaderMaterial`/`RawShaderMaterial` default to `glslVersion: null` = GLSL ES 1.00, even on WebGL2.** `gl_FragDepth` does not exist there, and `layout(location=1) out` does not either. Every shader in this repo already carries `#version 300 es` in its own head (`src/shaders.js:13`, `src/water_render.js:55`).
**Fix:** `new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, ... })` for *every* ported program, and **strip the leading `#version 300 es`** from the source string — three emits the directive itself and a duplicate is a compile error. Use `RawShaderMaterial`, never `ShaderMaterial`: the latter injects a preamble ahead of the version line and would also rewrite the two fragment outputs into a single `pc_fragColor`.

**L2 — `Material.transparent` defaults to `false`, and three uses it as the ARM for blending, not just for sorting.** `setMaterial` does `(blending === NormalBlending && transparent === false) ? setBlending(NoBlending) : setBlending(...)`. A material with correct blend factors but default `transparent` draws with `GL_BLEND` **off**.
**Fix:** `transparent = true` on every one of the nine blended passes (decals, ghost, phero, particle, wet, glass, tubes, liquids, water composite, water thickness).

**L3 — `THREE.AdditiveBlending` is NOT `ONE, ONE`.** With `premultipliedAlpha:false` (the default) it emits `blendFunc(SRC_ALPHA, ONE)` — i.e. `src/gl.js:387`'s dead `'add'` mode, not `'addpre'`. That is the exact failure B20 forbids.
**Fix — the mode table, all four via `CustomBlending`:**
```js
// 'addpre'  (gl.js:388)
blending=CustomBlending; blendEquation=AddEquation;
blendSrc=OneFactor;      blendDst=OneFactor;
blendSrcAlpha=OneFactor; blendDstAlpha=OneFactor;

// 'premul'  (gl.js:389)
blendSrc=OneFactor;      blendDst=OneMinusSrcAlphaFactor;   // leave alpha pair null -> copies RGB factors

// 'multalpha' (gl.js:395)
blendSrc=DstColorFactor; blendDst=OneMinusSrcAlphaFactor;
blendSrcAlpha=ZeroFactor;blendDstAlpha=OneFactor;           // MUST be set, or three emits blendFunc and multiplies dst alpha down
```
Do not use `MultiplyBlending` for `'multalpha'` — it is `ZERO, SRC_COLOR` and drops the `dst*(1-srcA)` term that is the whole per-pixel-strength half of the mode. Do not use bare `AdditiveBlending` anywhere; treat it as a bug in review.

**L4 — `Material.depthWrite` defaults to `true` for transparent materials too.** three never infers depth state from blending, and `depthTest:false` alone does not stop writes (mask and test are independent, same as `src/gl.js:380-382`).
**Fix:** set both explicitly on all five state groups — B23. Also set **`depthFunc = THREE.LessDepth`**: three defaults to `LessEqualDepth`, this codebase runs on GL's `LESS` (B24).

**L5 — three has no per-draw `drawBuffers` mask. [RAW GL]** `setRenderTarget` issues `gl.drawBuffers` once from `renderTarget.textures.length` and caches it per framebuffer; there is no equivalent of `R.colorOnly()`/`R.restoreMRT()` (B3).
**Preferred fix (no raw GL):** give the four single-output shaders a second output writing `vec4(0.0)`. This is provably a no-op: under `addpre` (`ONE,ONE`) `dst + 0 = dst`, and under `multalpha` RGB = `0*dst + dst*(1-0) = dst`, A = `0*srcA + 1*dstA = dstA`. Then delete `colorOnly`/`restoreMRT`.
**Escape hatch if the shaders must stay verbatim:** `renderer.getContext().drawBuffers([C0, NONE])` around the pass — but three's state cache compares only array length and element 0, so it will **never restore** the mask for you. You must restore it yourself every time; a missed restore leaves attachment 1 dead for the rest of the frame, which is far worse than the bug avoided.

**L6 — `WebGLRenderTarget` defaults give you none of what `sceneFB` is.** Default is one RGBA8 colour texture and a depth *renderbuffer* (not sampleable).
**Fix:**
```js
const depthTex = new THREE.DepthTexture(w, h, THREE.FloatType);   // -> DEPTH_COMPONENT32F, matches gl.js:312
depthTex.format = THREE.DepthFormat;        // not DepthStencilFormat
depthTex.compareFunction = null;            // keeps TEXTURE_COMPARE_MODE off -> plain sampler2D stays legal
const sceneRT = new THREE.WebGLRenderTarget(w, h, {
  count: 2, type: THREE.HalfFloatType, format: THREE.RGBAFormat,
  depthBuffer: true, stencilBuffer: false,  // a stencil forces DEPTH24_STENCIL8 and silently demotes 32F
  depthTexture: depthTex
});
sceneRT.textures[1].type = THREE.UnsignedByteType;   // count:2 clones attachment 0's settings; attachment 1 MUST be RGBA8
```
That last line is load-bearing: the premultiplied-alpha reasoning at `src/water_render.js:491-499` is about a fixed-point RGBA8 buffer that clamps.

**L7 — three's shadow system will substitute materials behind your back.** With `renderer.shadowMap.enabled = true` and `castShadow` objects, `WebGLShadowMap` swaps in `MeshDepthMaterial`, renders RGBA-packed depth into an RGBA8 target, pins it to `NearestFilter`, and uses `light.shadow.matrix` (which folds the `*0.5+0.5` bias in) rather than the bare `uLightVP` that `src/shaders.js:112-113` remaps by hand. `DepthTexture` also defaults to `NearestFilter` and `UnsignedIntType`.
**Fix:** `renderer.shadowMap.enabled = false`, every light `castShadow = false`, `soilMesh.castShadow = false`. Keep the manual pass (`src/renderer.js:368-386`) with `scene.overrideMaterial` = a GLSL3 `RawShaderMaterial` carrying `SHADOW_VS`/`SHADOW_FS`. Build the target per L6 but with `minFilter = magFilter = THREE.LinearFilter` on the depth texture (B19), and guard it: `if (!renderer.extensions.get('OES_texture_float_linear')) depthTex.minFilter = depthTex.magFilter = THREE.NearestFilter;` — strictly better than today, where `src/gl.js:41` fetches the extension and never checks it. Feed `uLightVP` yourself from `projectionMatrix * matrixWorldInverse`, never from `light.shadow.matrix`. Accept the wasted 2048² RGBA8 colour attachment; three cannot express `drawBuffers([NONE])`.
**Also: never set `logarithmicDepthBuffer: true` on the renderer.** It injects three's own `gl_FragDepth` write into every generated material, fighting B9/B11 and putting every other object in a depth space the soil's `(cp.z/cp.w)*0.5+0.5` does not share.

**L8 — `material.side` is fixed at construction; the soil needs it flipped per farm per frame (B10).** Note `BackSide` is not `cullFace(FRONT)` — three implements it as `frontFace(CW)` plus `cullFace(BACK)`, which **inverts `gl_FrontFacing`**.
**Fix:** in `soilMesh.onBeforeRender`, set `material.side = inside ? THREE.BackSide : THREE.FrontSide` with the same `+0.05` slack as `src/renderer.js:453-455`. Do **not** set `needsUpdate`/bump `material.version` — leave it alone and the flip is a pure state change with no recompile. Safe here only because the soil FS does not read `gl_FrontFacing`. For flora and glass (which do, `src/shaders.js:896, 1006`) use `THREE.DoubleSide` — never `BackSide` — so the winding stays CCW and `gl_FrontFacing` keeps its current meaning. Keep every instance scale positive: three ORs `matrixWorld.determinant() < 0` into `setFlipSided`.

**L9 — `Object3D.frustumCulled` defaults to `true` and tests the base geometry's bounding sphere (B14, and the soil box at `src/renderer.js:181`).**
**Fix:** `frustumCulled = false` on every InstancedMesh and on the soil box. Mandatory, not optional — otherwise whole batches pop out together the moment the world origin leaves the frustum.

**L10 — `renderer.autoClear = true` clears colour+depth+stencil at every `render()` call.** The frame clears exactly once (`src/renderer.js:391-392`) and then 30 passes depend on that buffer (B4, B23).
**Fix:** `renderer.autoClear = false` globally; clear explicitly once, matching `src/renderer.js:390-392`. For the shadow target use `renderer.clear(false, true, false)` (depth only, matching `src/renderer.js:379`).

**L11 — `renderer.sortObjects = true` reorders the transparent bucket back-to-front by centroid.** The frame's order is hand-fixed and blend modes do not commute (B22, and droplets-then-puddles at `src/renderer.js:624-627`).
**Fix:** `renderer.sortObjects = false` plus explicit ascending `object.renderOrder`, or keep each pass as its own `renderer.render()` call — which you need anyway, since `copyScene` has to run *between* passes.

**L12 — `renderer.setSize(w,h)` writes inline `style.width/height` because `updateStyle` defaults to `true`, and `setPixelRatio` has no lower clamp and no dirty check.** `css/ui.css:61` is the sole owner of the CSS box (B30), and there is no equivalent of the `Math.max(320,240)` floor or the early-out at `src/renderer.js:205`.
**Fix:** construct with the existing element — `new THREE.WebGLRenderer({ canvas: document.getElementById('gl'), alpha:false, antialias:false, stencil:false, powerPreference:'high-performance', preserveDrawingBuffer: /[?&]shot/.test(location.search), context: gl })` — then `renderer.setPixelRatio(1)` and `renderer.setDrawingBufferSize(w, h, 1)` with `w`/`h` computed exactly as `src/renderer.js:203-204`, including the 320/240 floor. `setDrawingBufferSize` is the one sizing entry point with no `updateStyle` branch. Keep the app-side early-out. If three creates its own canvas instead of adopting `#gl`, `getBoundingClientRect()` returns 0×0 → NaN NDC → every pick fails, and the cursor rules at `css/ui.css:63-67` stop matching.
**Also:** all `uRes`/`uTexel`/`uInvRes` must come from `renderer.getDrawingBufferSize(v2)`, **never** `getSize()`; and `renderer.setViewport` takes CSS pixels and multiplies by the pixel ratio internally, the opposite convention from `gl.viewport` at `src/gl.js:353` and `src/water_render.js:713`.

**L13 — three cannot draw the attribute-less `gl_VertexID` triangle (B17).** It derives the vertex count from `geometry.attributes.position`.
**Fix:** a 3-vertex `BufferGeometry` with an explicit position attribute reproducing `src/gl.js:364`'s NDC (−1,−1)/(3,−1)/(−1,3), driven by a pass-through vertex shader — not `PlaneGeometry`, which is a two-triangle quad with a diagonal seam.

**L14 — state-cache desynchronisation during the hybrid phase. [RAW GL]** three's `WebGLState` caches blend factors, depth mask, cull face and drawBuffers and **skips redundant-looking calls**. Any raw `gl.blendFunc`/`gl.depthMask`/`gl.drawBuffers` issued outside three leaves the cache lying, after which three silently omits the call that would have restored the correct state.
**Fix:** call `renderer.resetState()` after **every** raw-GL block, for the entire duration of the migration. Where possible go through `renderer.state.*` (e.g. `renderer.state.setCullFace`) instead of raw GL, since those update the cache — but note `setMaterial` never restores `cullFace`, so `material.side` is the only self-restoring path.

**L15 — never bind a render target's own depth texture as a uniform on a material rendering into it.** three will happily let you (B4, `src/water_render.js:351-355`). The result is `INVALID_OPERATION`, the pass draws nothing, and there is no console error beyond a GL warning.

**L16 — `THREE.Vector3.project()` is not `R.project` (B29), and `Raycaster` reads matrices three updates lazily inside `render()`.** Today `cam.update()` runs eagerly in the update stage (`src/game.js:983`) before the pick at `src/player.js:144`.
**Fix:** keep the CPU picking path exactly as it is. Reimplement `Camera.ray`/`R.project` against the three camera's `projectionMatrixInverse`/`matrixWorldInverse`, preserving `out[2] = w` and the −1..+1 NDC z convention. If you adopt `Raycaster`, call `camera.updateMatrixWorld()` at the `src/game.js:983` site.

**L17 — three's `UnsignedByteType` default on any accumulation target clamps the sum at 1.0.** The water thickness target must be `HalfFloatType` (B1, and the `min(thick,1.4)` at `src/water_render.js:407` with `WR.thickK = 2.2` at `src/water_render.js:49`).

**L18 — three sets `UNPACK_FLIP_Y_WEBGL` and `UNPACK_PREMULTIPLY_ALPHA_WEBGL` per texture upload; this codebase never touches either** (grep: only `UNPACK_ALIGNMENT` at `src/gl.js:273-280`). If three leaves either set, the manual `Wet` sub-upload (B36) is silently transformed. Re-assert `pixelStorei` around that upload, or keep it inside a `resetState()`-bracketed block.

**L19 — `EffectComposer`/`UnrealBloomPass` do not match this pipeline.** `EffectComposer.setSize` takes CSS px and unconditionally resizes its targets; `UnrealBloomPass` runs its own 5-mip halving that is not the 6-level `bw <= 8` loop at `src/renderer.js:235-240`. Write the post chain by hand as explicit target/material pairs.

---

## 4. A STAGED ORDER

Every stage ends with a game that boots, plays and passes the checklist. Bump `?v=` in `index.html` after each.

**Stage 0 — Baseline. No code change.**
Serve with `node tools/serve.js --dev`. Capture the golden numbers in §5.0. Record `H.stats()`, a `tools/shots/` set at a pinned camera, and the frozen-particle water A/B. **Do not start until you have these** — after Stage 3 you cannot recover them from the old build in the same page.

**Stage 1 — Adopt, do not render.**
Add `three.min.js` to `index.html` before `src/gl.js`. In `R.init` (after `src/renderer.js:98-100`), construct `new THREE.WebGLRenderer({ canvas, context: gl, ... })` per L12 and store it as `R.three`. **Render nothing with it.** Add `renderer.resetState()` at the top of `R.frameStart` (`src/renderer.js:801`) and after the SDF bake (`src/renderer.js:280`). Set `autoClear=false`, `sortObjects=false`, `shadowMap.enabled=false` immediately. Fully reversible; expect zero pixel change.

**Stage 2 — Leaf post passes.**
Port the passes with no downstream consumers other than the composite: bright/down/up/copy bloom chain (`src/renderer.js:691-719`), god rays (`744-758`), CoC/DoF (`723-739`). Each becomes a `THREE.WebGLRenderTarget` + GLSL3 `RawShaderMaterial` + the 3-vertex quad (L13). The scene target stays a `GLX.FBO`; sample it by wrapping its texture with `THREE.ExternalTexture` or by keeping those specific reads on raw GL. Verify the disabled-effect clears (§2.5). Still reversible by file swap.

**Stage 3 — Scene target + frame plumbing. ⚠️ POINT OF NO RETURN.**
`sceneFB`, `copyFB`, `compFB`, the AO pair and the shadow target become three render targets (L6, L7). All remaining raw passes are issued *inside* `renderer.setRenderTarget(...)` so the state cache stays coherent, each followed by `resetState()`. `R.copyScene`, `AF.WR` (`src/water_render.js:614, 712-718`) and `AF.HeapR` must be edited to accept the new target objects, and `R.resize` (`src/renderer.js:201-241`) rewritten around `setSize` with the early-out preserved (B34).
This is the point of no return because `water_render.js`, `heap_render.js` and `particles.js` all reach into `R.sceneFB`/`R.copyFB`/`R.width` directly — from here the old and new paths can no longer coexist in one page and the "swap one file and re-measure" method from `BUGS.md` fixed 13 stops working. **Re-run the full §5 checklist here, not at the end.**

**Stage 4 — Remaining post + SSAO + composite + FXAA.**
Port SSAO (`src/renderer.js:659-687`), its bilateral blur, the composite (`762-791`) and the FXAA screen blit (`793-798`). The FXAA pass must end with `renderer.setRenderTarget(null)` (B31). This is the stage where the ink outline and the far-plane sentinel (B23) are most likely to break; check them explicitly.

**Stage 5 — Instanced scene batches.**
`Batch` → `InstancedBufferGeometry` + five `InstancedBufferAttribute` streams with `DynamicDrawUsage`, `geometry.instanceCount = n`, `frustumCulled = false`. Do the passes in this order, one commit each, verifying between: creatures/props (B13-B16), flora, decal+ghost (two separate materials — they differ only in depth state, `src/renderer.js:524` vs `542`), phero+particle, liquids, wet. Keep `Batch.meshR` and the `R.B[name]` registry byte-identical (B26) — game logic reads them. Keep the single upload feeding both shadow and beauty (`src/render_scene.js:183-193`).

**Stage 6 — Soil, sky, statics, glass, tubes, heap.**
Soil last of the opaque work: it carries `gl_FragDepth` (B9), the per-frame cull flip (L8), the two `sampler3D`s (B7, B36) and `uQuality`. Sky needs `depthTest=false, depthWrite=false` (B23/L4) and must still write attachment 1.

**Stage 7 — Water module.**
`src/water_render.js` in one piece, in its documented internal order. Its GLSL is **not covered by `tools/glsl_lint.js`** — review by hand or it fails silently into a black frame.

**Stage 8 — Delete `src/gl.js`'s raw paths.**
Remove `GLX.FBO`, `GLX.Program`, `GLX.blend/depth/cull`, `GLX.fullscreen`, the dead blend modes, the unused extensions. Keep `GLX.init`'s context-loss handling (`src/gl.js:27-38`), `GLX.bindScreen` and `GLX.renderer` — `src/main.js:297-300` and `tools/harness.js:193` use them. Keep `GLX.texture3D`/`texture3DSub` or provide exact replacements for `src/particles.js:741-745, 816`.

---

## 5. ACCEPTANCE CHECKLIST

**Method (from `BUGS.md`, do not improvise):**
- Serve with `node tools/serve.js --dev`. `H.shot('tag')` (`tools/harness.js:71-77`) POSTs to `/__shot` and writes `tools/shots/<tag>.png` (`tools/serve.js:27-42`). Requires `?shot` in the URL for `preserveDrawingBuffer`. **A ~4 KB PNG at 900×488 means you captured nothing.**
- Browser-pane screenshots come back black. `readPixels` must run **in the same JS task** as the `AF.__loop` call that drew the frame; `readPixels` hands rows back bottom-up.
- Step deterministically: `window.__T = performance.now();` — **never `1e6`** — then `for (i=0;i<N;i++){ window.__T += 16.7; AF.__loopStrict(window.__T); }`. A negative `simTime` in an error snapshot means the harness broke, not the game.
- For any water/rendering A/B: freeze the particles. Save `px,py,pz,nbrN,rad` for every live `MAT_WATER` particle to `localStorage`, stub `PS.step = function(){}`, respawn, and **restore `nbrN` and `rad` by hand** or every drop draws at 26% size. Pin the camera with `H.cam({focus, dist, yaw, pitch})` to a fixed world point, not the water's centroid.

**5.0 Baseline to capture at Stage 0 (and reproduce at every later stage):**
- `node tools/check.js` → `33668 triangles across 27 meshes · failures: 0`
- `node tools/glsl_lint.js` → 34 shaders `ok`, `shaders with problems: 0`
- Boot line reads `compiling 24 shader programs…` (`src/main.js:206` reads `Object.keys(R.P).length`; the full roster is 31 = 24 + 6 water + 1 heap). If programs become materials, keep a table so this does not read 0.
- `H.stats()` → `{fps, draws, instances, tris, w, h, renderer}` at a pinned camera on a pinned save. Record all seven.
- 4000 strict frames from a menu-started loam tank: `Game.lastError === null`, `Game.errorLog.length === 0`.
- `tools/shots/`: pinned-camera stills of (a) the tank from outside, (b) camera inside the soil, (c) a settled pool, (d) a nursery with brood, (e) the dig ghost over undug soil, (f) a menu frame.

**Per stage — every stage, no exceptions:**
1. Both node validators pass with the numbers above.
2. 4000 `AF.__loopStrict` frames, zero recorded errors.
3. `H.stats().w/h` equals `Math.max(320, floor(innerWidth*effectiveDpr()))` / `Math.max(240, ...)`; toggling quality Low↔Ultra (`dprCap` 1.0/1.0/1.4/2.0) changes it and does **not** reallocate targets on a steady frame.
4. Pixel A/B against the previous stage's stills at the same pinned camera. Anything that moves must be explainable; unexplained deltas are regressions.

**Stage 1:** stills must be **bit-identical** to Stage 0. Any difference means `resetState()` discipline is already wrong.

**Stage 2:** bloom soft, not blocky (the smallest mip is 8 px stretched full-screen — NEAREST shows as a checkerboard). Set quality to **Low** (`fx.ao = 0`) and confirm the screen is **not black** — the AO target must clear to white (`src/renderer.js:687`). Confirm god-ray shafts still streak across the room rather than forming a halo at the sun.

**Stage 3 (point of no return) — full re-measure:**
- Water halo, frozen-particle A/B, same 700 particles, same camera: pale pixels outside the water **≤ 1,838 / energy ≤ 5.95**. The pre-fix build measured **170,630 px / 627.8 energy**; anything trending back toward those numbers means the attachment-1 alpha or the normal flattening broke (B21, §2.5).
- Remaining dark surround (open bug 1): ~12,451 px / 132 luminance-units on the shallow-angle scene, 71% SSAO / 14% bloom / 9% `drawWet`. Reproduce by reading the frame twice in one task, once with `AF.WR.draw = function(){}`, and writing the amplified signed difference through `/__shot`.
- Confirm `AF.WR.draw = function(){}` still suppresses the water pass and `AF.WR.thickScale/thickK/tint` still take effect live from the console. If either has been folded into a closure or cached into a material at init, **stop and fix it** — that is the only working water measurement in the repo.
- Wetness volume A/B (volume forced dry vs live): **17.5% peak relative darkening over 3.3% of the frame** with no water present; shader response near-linear at wetness 0.25/0.50/0.75/1.00 → **5.8% / 12.3% / 19.3% / 27.2%**.

**Stage 4:** ink outline present around ants, props and the pool rim; **absent** from the sky and from flat ground. Verify the far-plane sentinel directly: read one sky pixel of the scene depth texture and assert it is **1.0, not 0.5** (B23). Sky must show no AO. DOF must focus on the dig pane, not the empty air in front of it.

**Stage 5:**
- `AF.Game.propBlockR(prop)` equals the drawn radius **to three decimals for every kind**. Spot values: bigrock mesh XZ radius **0.898**, pebble **0.895**, mushroom `rFix` **0.032 / 0.056 / 0.081** at `p.scale` 0.45 / 0.80 / 1.15.
- Drive ten ants back and forth across the largest bigrock through the real `doMove` → `surfaceMove` path: **0% frames inside at 1×**, ≤0.03% at 8×. All five bestiary species driven at the same rock, 900 frames each: **0 frames inside**.
- 4000 strict frames of ordinary play → ~23,538 surface ant-frames with **no ant inside any prop on any frame**.
- Nursery: eggs, larvae and pupae all visibly present and **distinct** (standing brood ~16, not a row of identical beans) — that is the B16 selector.
- Crowd test: 4000+ ants on screen. Nothing frozen at the world origin, nothing duplicated at last frame's positions (B13).
- `H.stats().instances` and `.tris` within a few percent of baseline. A 10× jump means capacity is being drawn instead of `n`.

**Stage 6:**
- Zoom the camera **inside** the soil box: the tank must not vanish (B10/L8).
- Dig a scoop: the tunnel appears immediately, and the next frame renders full-screen, not into a corner (B8). Ants walk on the dug floor — `probeGround` worst air gap **0.000 over 200 frames** (`tools/harness.js:82-100`), and a dug pit reads `localTop 6.11 analytic / 2.54 real`.
- Build preview visible through solid soil; pheromone trails and particles **not** visible through soil (B23 — the ghost restores the depth test at `src/renderer.js:549`).
- Glass panes show no shimmer against the soil face (B24).

**Stage 7:**
- Water halo numbers from Stage 3 hold unchanged.
- Thickness sweep against a real puddle: at `WR.thickScale = 0.13`, blue shift **0.298**, darkening **0.168**. (0.055 is the "water is transparent" report; 0.16 is poster paint.)
- A one-particle-deep film is drawn, is tinted, and carries **no** blue dot per sphere and **no** ink stipple.
- Water occludes correctly against ants and glass, has an ink outline, and receives DOF.
- Drain a pool to zero: no ghost puddle remains painted on the sand (the water pass early-returns and leaves stale targets, `src/water_render.js:610-615`).

**Stage 8:** the entire checklist once more, plus a context-loss test (`WEBGL_lose_context`): the boot overlay must reappear with "The graphics context was lost." rather than a silently blank canvas.

---

## 6. WHAT NOT TO TOUCH

**Zero edits. These files have nothing to do with rendering, and every one of them is a place where a "while I'm here" change would be invisible until it is a gameplay bug:**

```
src/math.js          src/world.js         src/ants.js        src/colony.js
src/geometry.js      src/sdf_cache.js     src/creatures.js   src/ai.js
src/geometry_bugs.js src/heap.js          src/excavate.js    src/grains.js
src/audio.js         src/save.js          src/icons.js       src/fx.js
tools/check.js  tools/glsl_lint.js  tools/harness.js  tools/serve.js
css/ui.css
```

`src/geometry.js` in particular: all 27 meshes, the `Builder`, `buildQuad`'s −1..1 corners with 0..1 UVs (`src/geometry.js:1046-1056`), the `setPart` defaults that keep props alive through the brood selector (`src/geometry.js:21, 391-397, 508, 617, 676`). `node tools/check.js` must keep printing `33668 triangles across 27 meshes · failures: 0` unchanged at every stage. `css/ui.css:61` must remain the sole owner of the canvas CSS box.

**Minimal edits only, with the named API preserved exactly:**

| file | what may change | what must not |
|---|---|---|
| `src/main.js` | the resize body (`247-255`) | the five-stage loop (`306-310`), `AF.__loop`/`AF.__loopStrict` (`318-328`), the `dt` clamps (`275-276`), the menu clear path (`297-302`), `R.width` staying a writable device-pixel number |
| `src/game.js` | `Game.rebake`'s call into `R.bakeSDF` (`915-916`) | `Game.PROP_DRAW`, `propBlockR` reading `R.B[name].meshR` (`385`), the rebake ordering (`915-923`), `new R.Camera()` (`21`), `cam.update(R.width/R.height)` (`983`) |
| `src/player.js` | nothing | `Game.pickRay` (`23-26`), `R.project`'s `out[2] = w` convention (`532-533`), the `getBoundingClientRect` NDC math (`523-527`) |
| `src/input.js` | nothing | the CSS-pixel NDC derivation (`169-174`), `Rig.avoidSoil` writing `cam.pos` (`461-492`), `cam.fov` in radians (`455`) |
| `src/particles.js` | only the two `GLX.texture3D*` call sites, if those helpers move | the `UNPACK_ALIGNMENT` 1↔4 discipline, the half-texel deposit convention (`748-756`), `AF.Wet`'s public surface |
| `src/ui.js` | nothing | `R.quality` values 0.0/0.3/0.65/1.0 and `dprCap` 1.0/1.0/1.4/2.0 (`140-144`) |
| `index.html` | the `?v=` cache key, one added `<script>` for three.js | the script load order |

And one repo-wide rule from `BUGS.md`: **never round-trip a source file through PowerShell `Get-Content`/`Set-Content`** — it double-encodes UTF-8 silently and has already corrupted `index.html` once. Use Python with explicit `encoding='utf-8'` and `newline=''`, or a heredoc.
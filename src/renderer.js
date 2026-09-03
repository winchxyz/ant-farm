/* =============================================================
   FORMICARIUM :: DEEP COLONY
   renderer.js - frame graph, instancing, SDF bake, post chain
   ============================================================= */
(function (AF) {
  'use strict';

  var M = AF.M, m4 = M.m4, v3 = M.v3;
  var GLX = AF.GLX, S = AF.S, SP = AF.SP, G = AF.G;
  var gl;

  var R = {};
  R.stats = { draws: 0, tris: 0, instances: 0, bakeMs: 0 };

  // ==================================================================
  //  Instance batch
  // ==================================================================
  function Batch(name, builder, capacity, program) {
    this.name = name;
    this.cap = capacity;
    this.n = 0;
    //  HOW WIDE THIS MESH IS, MEASURED RATHER THAN GUESSED.
    //
    //  Prop collision used to answer "how big is that stone" with a hand
    //  written multiple of prop.scale, and the answer drifted away from what
    //  this file actually draws. A bigrock is pushed at instance scale
    //  p.scale against a mesh whose widest XZ ring is 0.898 units, so the
    //  stone on screen was 0.898*p.scale across while both movers defended
    //  0.62*p.scale - and a worker ant stood entirely inside the outline of
    //  the biggest rock in the tank. Two hand-maintained numbers in two files
    //  cannot be kept in agreement; there has to be one number.
    //
    //  So take it from the geometry. This walks the position array that is
    //  about to become the aPos attribute and records the largest distance
    //  from the mesh origin in the XZ plane. The instance transform is
    //  R*(p*aIPos.w) + aIPos.xyz with R = Ry*Rx*Rz (shaders.js, eulerM), and
    //  props carry only yaw plus a tilt of at most 0.2 rad; yaw cannot change
    //  an XZ radius at all and the tilt moves these by under 0.4% (bigrock
    //  0.8981 -> 0.8955, pebble 0.8951 -> 0.8917), so
    //  worldRadius = meshR * aIPos.w to well inside a millimetre.
    //
    //  Cost: 25 meshes, a few thousand vertices, once, at load.
    var _bp = builder.pos, _mr = 0;
    for (var _v = 0; _v < _bp.length; _v += 3) {
      var _rr = _bp[_v] * _bp[_v] + _bp[_v + 2] * _bp[_v + 2];
      if (_rr > _mr) _mr = _rr;
    }
    this.meshR = Math.sqrt(_mr);
    this.iPos = new Float32Array(capacity * 4);
    this.iRot = new Float32Array(capacity * 4);
    this.iAnim = new Float32Array(capacity * 4);
    this.iCol = new Float32Array(capacity * 4);
    this.iData = new Float32Array(capacity * 4);
    this.mesh = builder.build(program, [
      { name: 'aIPos', size: 4, data: this.iPos, divisor: 1, dynamic: true },
      { name: 'aIRot', size: 4, data: this.iRot, divisor: 1, dynamic: true },
      { name: 'aIAnim', size: 4, data: this.iAnim, divisor: 1, dynamic: true },
      { name: 'aIColA', size: 4, data: this.iCol, divisor: 1, dynamic: true },
      { name: 'aIData', size: 4, data: this.iData, divisor: 1, dynamic: true }
    ]);
    this.triCount = this.mesh.triCount;
    //  MIGRATION STAGE 5. A second body over the same five typed arrays, so
    //  push() and the 41 unlabelled call sites behind it never learn which
    //  path draws. Both are built; drawThree() picks.
    this._builder = builder;
    if (AF.T3B && AF.T3B.ready) this._geo = AF.T3B.geometry(this, builder);
  }
  Batch.prototype.begin = function () { this.n = 0; };
  Batch.prototype.push = function (px, py, pz, scale, yaw, pitch, roll, phase,
    walk, attack, extra, variant, r, g, b, rough, health, sel, glow, flags) {
    if (this.n >= this.cap) return false;
    var i = this.n * 4;
    this.iPos[i] = px; this.iPos[i + 1] = py; this.iPos[i + 2] = pz; this.iPos[i + 3] = scale;
    this.iRot[i] = yaw; this.iRot[i + 1] = pitch; this.iRot[i + 2] = roll; this.iRot[i + 3] = phase;
    this.iAnim[i] = walk; this.iAnim[i + 1] = attack; this.iAnim[i + 2] = extra; this.iAnim[i + 3] = variant;
    this.iCol[i] = r; this.iCol[i + 1] = g; this.iCol[i + 2] = b; this.iCol[i + 3] = rough;
    this.iData[i] = health; this.iData[i + 1] = sel; this.iData[i + 2] = glow; this.iData[i + 3] = flags;
    this.n++;
    return true;
  };
  Batch.prototype.upload = function () {
    if (this.n === 0) return;
    var c = this.n * 4;
    this.mesh.update('aIPos', this.iPos, c);
    this.mesh.update('aIRot', this.iRot, c);
    this.mesh.update('aIAnim', this.iAnim, c);
    this.mesh.update('aIColA', this.iCol, c);
    this.mesh.update('aIData', this.iData, c);
  };
  Batch.prototype.draw = function () {
    if (this.n === 0) return;
    this.mesh.draw(this.n);
    R.stats.draws++;
    R.stats.instances += this.n;
    R.stats.tris += this.triCount * this.n;
  };
  //  The three-backed draw. Same instance count, same stats, same place in
  //  the frame - only the API underneath differs. Falls back to the raw
  //  path if this batch never got a geometry, so a half-migrated frame
  //  still draws everything.
  //  Draw this batch into a NAMED target - the shadow map. Same instance
  //  data, same geometry, a different material; one upload feeds both passes.
  Batch.prototype.drawThreeInto = function (material, fbo) {
    if (this.n === 0) { if (this._geo) this._geo.instanceCount = 0; return; }
    if (!this._geo || !material) { this.draw(); return; }
    var g = this._geo;
    g.instanceCount = this.n;
    var ia = this._ia;
    ia.aIPos.needsUpdate = true; ia.aIRot.needsUpdate = true;
    ia.aIAnim.needsUpdate = true; ia.aIColA.needsUpdate = true;
    ia.aIData.needsUpdate = true;
    if (!this._mesh) {
      this._mesh = new THREE.Mesh(g, material);
      this._mesh.frustumCulled = false;
      this._mesh.matrixAutoUpdate = false;
      this._mesh.matrixWorld.identity();
    }
    this._mesh.material = material;
    AF.T3B.drawObjectInto(this._mesh, fbo);
  };
  Batch.prototype.drawThree = function (material) {
    //  An empty batch draws nothing, but leave instanceCount at last frame's
    //  value and the geometry is quietly holding a stale count. Nothing
    //  renders it today; that is not a reason to leave a loaded gun in it.
    if (this.n === 0) { if (this._geo) this._geo.instanceCount = 0; return; }
    if (!this._geo || !material) { this.draw(); return; }
    AF.T3B.draw(this, material);
  };
  R.Batch = Batch;

  //  RESYNC THREE'S STATE CACHE - AND PUT BACK WHAT IT MOVES.
  //
  //  three caches blend factors, depth mask, cull face and drawBuffers and
  //  skips calls it thinks are redundant, so every raw GL call this renderer
  //  makes leaves that cache lying. resetState() is the documented cure.
  //
  //  What the migration brief does not say is that resetState in r180 does
  //  not only reset the CACHE - it writes GL state to three's own defaults.
  //  Measured at frameStart: depth mask false -> true, blend dst
  //  ONE_MINUS_SRC_ALPHA -> ZERO, current program -> null, and
  //  clear colour (0,0,0,1) -> (0,0,0,0).
  //
  //  The clear colour is the one that shows. With three merely adopted and
  //  drawing nothing, the frame changed by 222,547 pixels of 960,000; pin
  //  the clear colour around resetState and the difference is exactly zero.
  //  This renderer sets a clear colour before the scene clear but inherits
  //  the ambient one elsewhere, so it has always depended on nobody else
  //  touching it - true until now.
  //
  //  Restoring it here rather than at each clear keeps the fix in one place
  //  and means later stages cannot reintroduce it by adding a resetState.
  function threeResync() {
    R.three.resetState();
    gl.clearColor(0, 0, 0, 1);
  }
  //  three_post.js hands state back through this after every pass it draws.
  R.threeResync = function () { if (R.three) threeResync(); };

  //  MIGRATION STAGE 3. Flip this to false and every target below is a
  //  GLX.FBO again - the adapter in three_post.js presents the same
  //  surface, so nothing else in the engine can tell which it got. That is
  //  the only reason a change this size is bisectable at all.
  R.useThreeTargets = true;
  function mkFBO(spec) {
    return (AF.T3 && AF.T3.ready && R.useThreeTargets)
      ? AF.T3.fbo(spec) : new GLX.FBO(spec);
  }
  R.mkFBO = mkFBO;

  // ==================================================================
  //  INIT
  // ==================================================================
  R.init = function (canvas) {
    gl = GLX.init(canvas, { preserve: /[?&]shot/.test(location.search) });
    if (!gl) return false;
    R.gl = gl;
    R.canvas = canvas;
    R.quality = 1.0;
    R.dpr = 1;

    //  THREE.JS, ADOPTED BUT NOT YET DRAWING (migration stage 1).
    //
    //  It takes over the EXISTING canvas and the EXISTING context rather than
    //  making its own - a second context would give a 0x0 bounding rect, and
    //  every pick in player.js/input.js derives NDC from getBoundingClientRect.
    //  Nothing renders through it yet; this stage exists only to prove the
    //  state cache can be kept coherent alongside the hand-written passes.
    //
    //  The three defaults that would silently rewrite this frame are turned
    //  off here, once: autoClear would wipe the scene target that thirty
    //  later passes depend on, sortObjects would reorder a hand-fixed
    //  sequence whose blend modes do not commute, and shadowMap would
    //  substitute MeshDepthMaterial behind the manual shadow pass.
    if (window.THREE) {
      try {
        R.three = new THREE.WebGLRenderer({
          canvas: canvas, context: gl,
          alpha: false, antialias: false, stencil: false, depth: true,
          powerPreference: 'high-performance',
          preserveDrawingBuffer: /[?&]shot/.test(location.search)
        });
        R.three.autoClear = false;
        R.three.autoClearColor = false;
        R.three.autoClearDepth = false;
        R.three.autoClearStencil = false;
        R.three.sortObjects = false;
        R.three.shadowMap.enabled = false;
        //  css/ui.css owns the canvas CSS box; setSize would write inline
        //  style and break both the cursor rules and the pick maths.
        R.three.setPixelRatio(1);
        R.threeVersion = THREE.REVISION;
      } catch (e) {
        R.three = null;
        console.error('three.js adoption failed, staying on raw GL: ' + e.message);
      }
    }

    var P = {};
    //  One black texel, for a farm that has no wetness volume of its own.
    //  Made here so that binding it never has to allocate mid-frame - see
    //  the note in R.drawSoil.
    R.zeroVol = GLX.texture3D({
      width: 1, height: 1, depth: 1,
      internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE
    });
    if (AF.T3) AF.T3.init(R);
    if (AF.T3B) AF.T3B.init(R);
    if (AF.WR) AF.WR.init(R);
    if (AF.HeapR) AF.HeapR.init(R);
    //  MIGRATION STAGE 8. Every per-frame pass draws through three now -
    //  measured, not assumed: instrumenting Program.use for a whole frame
    //  reports zero raw programs. The twenty-three that used to be compiled
    //  here are gone.
    //
    //  BAKE STAYS. It renders into individual LAYERS of a 3D texture through
    //  gl.framebufferTextureLayer on an attachment-less FBO, which is not a
    //  shape three's render targets express, and the brief keeps
    //  GLX.texture3D for exactly this. It runs on dig, not per frame.
    P.bake = GLX.program(GLX.FS_VS, S.BAKE_FS, 'bake');
    R.P = P;

    var B = {};
    var cr = P.creature;
    B.ant = new Batch('ant', G.buildAnt(0), 700, cr);
    B.antMid = new Batch('antMid', G.buildAnt(1), 2200, cr);
    B.antLow = new Batch('antLow', G.buildAnt(2), 4200, cr);
    B.soldier = new Batch('soldier', G.buildSoldier(0), 400, cr);
    B.soldierMid = new Batch('soldierMid', G.buildSoldier(1), 1200, cr);
    B.queen = new Batch('queen', G.buildQueen(0), 24, cr);
    B.alate = new Batch('alate', G.buildAlate(0), 160, cr);
    B.brood = new Batch('brood', G.buildBrood(), 800, cr);
    B.spider = new Batch('spider', G.buildSpider(), 12, cr);
    B.aphid = new Batch('aphid', G.buildAphid(), 160, cr);
    //  the bestiary. Small caps: a tank never holds many at once, and a
    //  carcass is drawn from the same batch as the living animal.
    B.woodlouse = new Batch('woodlouse', G.buildWoodlouse(), 24, cr);
    B.cricket = new Batch('cricket', G.buildCricket(), 24, cr);
    B.beetle = new Batch('beetle', G.buildBeetle(), 24, cr);
    B.centipede = new Batch('centipede', G.buildCentipede(), 16, cr);
    B.crystal = new Batch('crystal', G.buildCrystal(5), 400, cr);
    B.seed = new Batch('seed', G.buildSeed(), 260, cr);
    B.pebble = new Batch('pebble', G.buildPebble(3, 10), 400, cr);
    B.pebbleSm = new Batch('pebbleSm', G.buildPebble(9, 7), 700, cr);
    B.grass = new Batch('grass', G.buildGrassBlade(11), 1600, P.flora);
    B.grass2 = new Batch('grass2', G.buildGrassBlade(29), 1600, P.flora);
    B.leaf = new Batch('leaf', G.buildLeaf(0), 400, P.flora);
    B.mushroom = new Batch('mushroom', G.buildMushroom(0), 300, P.flora);
    B.twig = new Batch('twig', G.buildTwig(4), 100, cr);
    B.droplet = new Batch('droplet', G.buildDroplet(), 200, P.liquid);
    B.puddle = new Batch('puddle', G.buildPuddle(), 260, P.liquid);
    B.particle = new Batch('particle', G.buildQuad(), 5000, P.particle);
    B.phero = new Batch('phero', G.buildQuad(), 2600, P.phero);
    B.decal = new Batch('decal', G.buildQuad(), 800, P.decal);
    B.ghost = new Batch('ghost', G.buildQuad(), 260, P.decal);
    //  Poured material. Persistent particles, so these have to be sized
    //  for a full tank, not for the 34-grain handful the old system threw.
    B.water = new Batch('water', G.buildBlob(1), 1200, P.liquid);
    B.sugar = new Batch('sugar', G.buildCrystal(5), 4200, cr);
    B.wet = new Batch('wet', G.buildQuad(), 300, P.wet);
    R.B = B;

    var boxB = G.buildBox(1, 1, 1, false);
    R.boxMesh = boxB.build(P.soil, null);
    if (AF.T3B && AF.T3B.ready) R.boxGeo = AF.T3B.geoFromBuilder(boxB);

    R.shadowSize = 2048;
    R.shadowFB = mkFBO({ width: R.shadowSize, height: R.shadowSize, depth: 'texture', depthFilter: gl.LINEAR });
    R.lightVP = m4.create();

    R.segTexW = 1024;
    R.segData = new Float32Array(R.segTexW * 4);
    R.segTex = GLX.texture2D({
      width: R.segTexW, height: 1, internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.NEAREST
    });
    R.bakeFB = gl.createFramebuffer();

    R.resize(canvas.clientWidth || 1280, canvas.clientHeight || 720, 1);
    return true;
  };

  // ==================================================================
  //  RESIZE / RENDER TARGETS
  // ==================================================================
  R.resize = function (cssW, cssH, dpr) {
    dpr = dpr || 1;
    var w = Math.max(320, Math.floor(cssW * dpr));
    var h = Math.max(240, Math.floor(cssH * dpr));
    if (R.width === w && R.height === h) return;
    R.width = w; R.height = h; R.dpr = dpr;
    R.canvas.width = w; R.canvas.height = h;
    //  three keeps its own viewport and has to be told. setDrawingBufferSize
    //  is the one sizing entry point with no updateStyle branch, so it
    //  cannot write inline style onto the canvas - css/ui.css owns that box
    //  and the pick maths reads it (brief L12, B30).
    if (R.three) R.three.setDrawingBufferSize(w, h, 1);

    var i;
    if (R.sceneFB) {
      R.sceneFB.destroy(); R.copyFB.destroy(); R.aoFB.destroy(); R.aoFB2.destroy();
      R.dofA.destroy(); R.dofB.destroy(); R.raysFB.destroy(); R.raysFB2.destroy(); R.compFB.destroy();
      for (i = 0; i < R.bloom.length; i++) R.bloom[i].destroy();
      for (i = 0; i < R.bloomUp.length; i++) R.bloomUp[i].destroy();
    }
    var F16 = { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
    R.sceneFB = mkFBO({
      width: w, height: h, depth: 'texture',
      color: [F16, { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE }]
    });
    R.copyFB = mkFBO({ width: w, height: h, color: [F16] });
    var aw = Math.max(1, w >> 1), ah = Math.max(1, h >> 1);
    var R8 = { internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE };
    R.aoFB = mkFBO({ width: aw, height: ah, color: [R8] });
    R.aoFB2 = mkFBO({ width: aw, height: ah, color: [R8] });
    R.dofA = mkFBO({ width: aw, height: ah, color: [F16] });
    R.dofB = mkFBO({ width: aw, height: ah, color: [F16] });
    var rw = Math.max(1, w >> 2), rh = Math.max(1, h >> 2);
    R.raysFB = mkFBO({ width: rw, height: rh, color: [F16] });
    R.raysFB2 = mkFBO({ width: rw, height: rh, color: [F16] });
    R.compFB = mkFBO({ width: w, height: h, color: [{ internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE }] });
    if (AF.WR && AF.WR.ready) AF.WR.resize(w, h);
    R.bloom = []; R.bloomUp = [];
    var bw = w, bh = h;
    for (var k = 0; k < 6; k++) {
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      R.bloom.push(new GLX.FBO({ width: bw, height: bh, color: [F16] }));
      R.bloomUp.push(new GLX.FBO({ width: bw, height: bh, color: [F16] }));
      if (bw <= 8 || bh <= 8) break;
    }
    //  MIGRATION STAGE 2. Level 0 of the down pyramid is written by three
    //  now, so it needs a three target at exactly the same size and format
    //  as the GLX.FBO it replaces - half float, LINEAR, no depth. The
    //  GLX.FBO at R.bloom[0] stays allocated and unused so that the
    //  pyramid's sizes, the `bw <= 8` stop and the bloomUp pairing are
    //  read from one place; dropping it would silently shorten the chain.
    //  MIGRATION STAGE 2. A three-side mirror of the pyramid, same sizes and
    //  same format. The GLX.FBO pyramid above stays allocated: it is what
    //  decides the level count and the `bw <= 8` stop, and reading those
    //  from one place is what keeps the two in step.
    if (AF.T3 && AF.T3.ready) {
      if (R.T3bloom) {
        for (var q = 0; q < R.T3bloom.down.length; q++) {
          R.T3bloom.down[q].dispose(); R.T3bloom.up[q].dispose();
        }
      }
      var T = { down: [], up: [], texel: [] };
      for (var m = 0; m < R.bloom.length; m++) {
        var lw = R.bloom[m].width, lh = R.bloom[m].height;
        T.down.push(AF.T3.target(lw, lh));
        T.up.push(AF.T3.target(lw, lh));
        T.texel.push(new THREE.Vector2(1 / lw, 1 / lh));
      }
      R.T3bloom = T;
      if (!R.brightPass) {
        var V2 = function () { return new THREE.Vector2(1, 1); };
        var V3 = function () { return new THREE.Vector3(); };
        var M4 = function () { return new THREE.Matrix4(); };
        R.brightPass = AF.T3.pass('bright', SP.BRIGHT_FS,
          { uTex: null, uThreshold: 1.45, uSoft: 0.7 });
        R.downPass = AF.T3.pass('down', SP.DOWN_FS,
          { uTex: null, uTexel: V2() });
        R.upPass = AF.T3.pass('up', SP.UP_FS,
          { uTex: null, uPrev: null, uTexel: V2(), uScatter: 1 });
        R.copyPass = AF.T3.pass('copy', SP.COPY_FS, { uTex: null });
        R.copyPass2 = AF.T3.pass('copy2', SP.COPY_FS, { uTex: null });
        R.ssaoPass = AF.T3.pass('ssao', SP.SSAO_FS, {
          uDepth: null, uNormal: null, uInvProj: M4(), uProj: M4(), uView: M4(),
          uRes: V2(), uRadius: 0.55, uStrength: 1, uTime: 0
        });
        R.blurPass = AF.T3.pass('blur', SP.BLUR_FS,
          { uTex: null, uDepth: null, uDir: V2(), uTexel: V2() });
        R.cocPass = AF.T3.pass('coc', SP.COC_FS, {
          uColor: null, uDepth: null, uNear: 0.35, uFar: 420,
          uFocus: 1, uAperture: 1, uMaxCoC: 1
        });
        R.dofPass = AF.T3.pass('dof', SP.DOF_FS,
          { uTex: null, uTexel: V2(), uMaxCoC: 1 });
        R.godrayPass = AF.T3.pass('godray', SP.GODRAY_FS, {
          uTex: null, uSunUV: V2(), uDecay: 0.965, uDensity: 0.72,
          uWeight: 0.11, uExposure: 0.30
        });
        R.compPass = AF.T3.pass('comp', SP.COMPOSITE_FS, {
          uColor: null, uBloom: null, uAO: null, uDOF: null, uRays: null,
          uDepth: null, uNormalTex: null, uRes: V2(), uTime: 0,
          uBloomAmt: 1, uAOAmt: 1, uExposure: 1, uVignette: 0, uGrain: 0,
          uCA: 0, uSat: 1, uContrast: 1, uLift: V3(), uGain: V3(),
          uRaysAmt: 0, uDofAmt: 0, uFlash: 0, uFlashCol: V3(),
          uOutline: 0.85, uPaper: 0.02, uNear: 0.35, uFar: 420
        });
        R.fxaaPass = AF.T3.pass('fxaa', SP.FXAA_FS,
          { uTex: null, uTexel: V2(), uSharp: 0 });
      }
    }
  };

  // ==================================================================
  //  SDF BAKE
  // ==================================================================
  R.createSDF = function (gx, gy, gz) {
    return {
      tex: GLX.texture3D({ width: gx, height: gy, depth: gz, internalFormat: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT }),
      gx: gx, gy: gy, gz: gz
    };
  };

  R.bakeSDF = function (sdf, boxMin, boxMax, topY, segments, segCount, surfOrigin) {
    var t0 = performance.now();
    var P = R.P.bake;
    var n = Math.min(segCount, (R.segTexW / 2) | 0);
    var i;
    for (i = 0; i < n * 8; i++) R.segData[i] = segments[i];
    gl.bindTexture(gl.TEXTURE_2D, R.segTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, R.segTexW, 1, gl.RGBA, gl.FLOAT, R.segData);
    gl.bindFramebuffer(gl.FRAMEBUFFER, R.bakeFB);
    gl.viewport(0, 0, sdf.gx, sdf.gy);
    GLX.depth(false, false);
    GLX.blend(false);
    GLX.cull(false);
    P.use();
    P.tex('uSegTex', R.segTex);
    P.i('uSegCount', n);
    P.v3('uBoxMin', boxMin);
    P.v3('uBoxMax', boxMax);
    P.v3('uGrid', sdf.gx, sdf.gy, sdf.gz);
    P.f('uTopY', topY);
    P.f('uTexW', R.segTexW);
    P.v2('uSurfOrigin', surfOrigin ? surfOrigin[0] : 0, surfOrigin ? surfOrigin[1] : 0);
    for (var z = 0; z < sdf.gz; z++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, sdf.tex, 0, z);
      P.f('uLayer', z);
      GLX.fullscreen();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    //  The bake runs during UPDATE, outside the frame, and hijacks the
    //  viewport without restoring it (it survives because the next FBO bind
    //  resets it). Resync three here too, or its cache carries the bake's
    //  framebuffer and viewport into the first pass that goes through it.
    if (R.three) threeResync();
    R.stats.bakeMs = performance.now() - t0;
  };

  // ==================================================================
  //  CAMERA
  // ==================================================================
  function Camera() {
    this.pos = v3.create(0, 14, 34);
    this.target = v3.create(0, 4, 0);
    this.up = v3.create(0, 1, 0);
    this.fov = 42 * M.DEG;
    this.near = 0.35;
    this.far = 420;
    this.view = m4.create();
    this.proj = m4.create();
    this.vp = m4.create();
    this.invVP = m4.create();
    this.invProj = m4.create();
  }
  Camera.prototype.update = function (aspect) {
    this._aspect = aspect;
    m4.perspective(this.proj, this.fov, aspect, this.near, this.far);
    m4.lookAt(this.view, this.pos, this.target, this.up);
    m4.multiply(this.vp, this.proj, this.view);
    m4.invert(this.invVP, this.vp);
    m4.invert(this.invProj, this.proj);
  };
  function unproject(out, ndc, invVP) {
    var x = ndc[0], y = ndc[1], z = ndc[2];
    var w = invVP[3] * x + invVP[7] * y + invVP[11] * z + invVP[15];
    out[0] = (invVP[0] * x + invVP[4] * y + invVP[8] * z + invVP[12]) / w;
    out[1] = (invVP[1] * x + invVP[5] * y + invVP[9] * z + invVP[13]) / w;
    out[2] = (invVP[2] * x + invVP[6] * y + invVP[10] * z + invVP[14]) / w;
    return out;
  }
  var _ra = new Float32Array(3), _rb = new Float32Array(3);
  Camera.prototype.ray = function (ndcX, ndcY, outO, outD) {
    unproject(_ra, [ndcX, ndcY, -1], this.invVP);
    unproject(_rb, [ndcX, ndcY, 1], this.invVP);
    v3.copy(outO, _ra);
    v3.sub(outD, _rb, _ra);
    v3.normalize(outD, outD);
  };
  R.Camera = Camera;
  R.project = function (out, p, vp) {
    var w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
    out[0] = (vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12]) / w;
    out[1] = (vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13]) / w;
    out[2] = w;
    return out;
  };

  // ==================================================================
  //  LIGHTS
  // ==================================================================
  R.lightPos = new Float32Array(16 * 4);
  R.lightCol = new Float32Array(16 * 4);
  R.lightCount = 0;
  R.clearLights = function () { R.lightCount = 0; };
  R.addLight = function (x, y, z, radius, r, g, b, intensity) {
    if (R.lightCount >= 16) return;
    var i = R.lightCount * 4;
    R.lightPos[i] = x; R.lightPos[i + 1] = y; R.lightPos[i + 2] = z; R.lightPos[i + 3] = radius;
    R.lightCol[i] = r; R.lightCol[i + 1] = g; R.lightCol[i + 2] = b; R.lightCol[i + 3] = intensity;
    R.lightCount++;
  };
  function bindEnv(P, env, cam) {
    P.v4v('uLightPos', R.lightPos);
    P.v4v('uLightCol', R.lightCol);
    P.i('uLightCount', R.lightCount);
    P.v3('uSunDir', env.sunDir);
    P.v3('uSunCol', env.sunCol);
    P.v3('uSkyCol', env.skyCol);
    P.v3('uGndCol', env.gndCol);
    P.v3('uCamPos', cam.pos);
    P.f('uToon', R.toon === undefined ? 1 : R.toon);
  }
  function bindShadow(P) {
    P.tex('uShadowMap', R.shadowFB.depthTex);
    P.m4('uLightVP', R.lightVP);
    P.v2('uShadowTexel', 1 / R.shadowSize, 1 / R.shadowSize);
  }
  R.bindEnv = bindEnv;

  // ==================================================================
  //  PASSES
  // ==================================================================
  R.shadowPass = function (env, center, radius, drawCB) {
    var eye = v3.create(
      center[0] + env.sunDir[0] * radius * 2.2,
      center[1] + env.sunDir[1] * radius * 2.2,
      center[2] + env.sunDir[2] * radius * 2.2);
    var view = m4.create(), proj = m4.create();
    m4.lookAt(view, eye, center, [0, 1, 0]);
    m4.ortho(proj, -radius, radius, -radius, radius, 0.1, radius * 5.0);
    m4.multiply(R.lightVP, proj, view);

    R.shadowFB.bind(false);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    GLX.depth(true, true);
    GLX.blend(false);
    GLX.cull('back');
    //  MIGRATION STAGE 8: the shadow caster material.
    //
    //  One material over SHADOW_VS/SHADOW_FS, handed to the same batches
    //  that draw the beauty pass - which is the whole point of the fixed
    //  attribute layout the raw path used, preserved here by attribute name
    //  instead. One upload feeds both passes.
    //
    //  SHADOW_VS has NO brood stage selector, so a brood instance casts all
    //  three stages' shadow at once. That is shipped behaviour and the brief
    //  is explicit that fixing it would change the look of every nursery.
    //
    //  The target has a colour attachment three insists on and the shader
    //  never writes; the raw path masked it off with drawBuffers([NONE]),
    //  which three cannot express. An unwritten attachment is harmless.
    if (AF.T3B && AF.T3B.ready && R.shadowFB.rt) {
      if (!R._shadowMat) {
        R._shadowMat = AF.T3B.material('shadow', S.SHADOW_VS, S.SHADOW_FS,
          { uVP: { value: new THREE.Matrix4() } },
          { side: THREE.FrontSide, depthTest: true, depthWrite: true });
      }
      R._shadowMat.uniforms.uVP.value.fromArray(R.lightVP);
      AF.T3B.setCamera({ vp: R.lightVP });
      drawCB(null, R._shadowMat, R.shadowFB);
      return;
    }
  };

  //  MIGRATION STAGE 6: the sky.
  //
  //  A fullscreen pass that writes BOTH outputs and NEITHER depth. The
  //  triangle sits at clip z = 0, which is window depth 0.5, so a sky that
  //  wrote depth would stamp 0.5 across the whole screen and depth-reject
  //  the room, the table and the far half of every tank. The 1.0 far-plane
  //  sentinel that SSAO and the ink pass both read would be gone with it
  //  (B23). T3.Pass is already depthTest false / depthWrite false, which is
  //  exactly right here.
  var _skyPass = null;
  R.beginScene = function (env, cam) {
    R.sceneFB.bind(false);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (AF.T3 && AF.T3.ready && R.sceneFB.rt) {
      var T = window.THREE;
      if (!_skyPass) _skyPass = AF.T3.pass('sky', S.SKY_FS, {
        uInvVP: new T.Matrix4(), uCamPos: new T.Vector3(), uSunDir: new T.Vector3(),
        uSunCol: new T.Vector3(), uRoomA: new T.Vector3(), uRoomB: new T.Vector3(), uTime: 0
      });
      var u = _skyPass.uniforms;
      u.uInvVP.value.fromArray(cam.invVP);
      u.uCamPos.value.fromArray(cam.pos);
      u.uSunDir.value.fromArray(env.sunDir);
      u.uSunCol.value.fromArray(env.sunCol);
      u.uRoomA.value.fromArray(env.roomA);
      u.uRoomB.value.fromArray(env.roomB);
      u.uTime.value = env.time;
      _skyPass.render(R.sceneFB);
      R.stats.draws++;
      //  REBIND. T3.Pass.render restores the default framebuffer when it is
      //  done, which is right for a post pass and wrong here: every raw
      //  scene pass after this one assumes sceneFB is still bound and binds
      //  nothing itself. Without this the whole opaque scene draws into the
      //  default framebuffer - the frame still looks broadly right, so the
      //  tell is elsewhere: sceneFB's depth stays empty at 1.0 everywhere,
      //  and drawTransparents raises INVALID_OPERATION because colorOnly()
      //  calls drawBuffers([COLOR_ATTACHMENT0]) on the default framebuffer,
      //  which only accepts BACK or NONE.
      R.sceneFB.bind(false);
      GLX.depth(true, true);
      GLX.blend(false);
      GLX.cull(false);
      return;
    }
  };

  //  MIGRATION STAGE 6: the soil. Left until last, and it earns it.
  //
  //  This is a volumetric raymarch, not a surface. The rasterized geometry is
  //  a unit cube expanded in the vertex shader to the farm's bounding box;
  //  the fragment shader marches the baked signed distance field inside it
  //  and writes gl_FragDepth from the hit point. Four things follow, and
  //  three's defaults are wrong about all four:
  //
  //  * NO DEPTH PRE-PASS AND NO AUTO-GENERATED DEPTH VARIANT MAY EXIST. The
  //    interpolated depth of the cube is the glass-facing box face, metres
  //    in front of the soil. Anything that lays that down first and then
  //    runs the colour pass under LESS rejects every raymarch hit, and the
  //    tank becomes a solid slab with every ant, pebble and pool inside it
  //    invisible (B9). RawShaderMaterial generates nothing, which is why it
  //    and not ShaderMaterial.
  //
  //  * THE CULL FLIP IS PER FARM PER FRAME. Standing inside the box the
  //    front faces are behind the eye, so back-face culling draws nothing
  //    and the tank vanishes - which is the normal close-up view. side is
  //    swapped on the material rather than through GLX.cull, and deliberately
  //    WITHOUT touching needsUpdate or material.version: that keeps it a pure
  //    state change with no recompile. Safe only because SOIL_FS does not
  //    read gl_FrontFacing - flora and glass do, which is why those two use
  //    DoubleSide instead (B10, L8).
  //
  //  * TWO sampler3Ds, neither of which three owns. See T3.extern3D.
  //
  //  * uQuality shortens the march on the Low preset, so it has to keep
  //    arriving or the quality menu becomes decorative.
  var _soilU = null, _soilMat = null;
  R.soilMaterial = function (env, cam, farm) {
    if (!AF.T3B || !AF.T3B.ready || !R.boxGeo) return null;
    var T = window.THREE;
    if (!_soilU) {
      var lp = [], lc = [];
      for (var i = 0; i < 16; i++) { lp.push(new T.Vector4()); lc.push(new T.Vector4()); }
      _soilU = {
        uVP: { value: new T.Matrix4() }, uLightVP: { value: new T.Matrix4() },
        uLightPos: { value: lp }, uLightCol: { value: lc }, uLightCount: { value: 0 },
        uSunDir: { value: new T.Vector3() }, uSunCol: { value: new T.Vector3() },
        uSkyCol: { value: new T.Vector3() }, uGndCol: { value: new T.Vector3() },
        uCamPos: { value: new T.Vector3() }, uToon: { value: 1 },
        uShadowMap: { value: null }, uShadowTexel: { value: new T.Vector2() },
        uBoxCenter: { value: new T.Vector3() }, uBoxHalf: { value: new T.Vector3() },
        uSDF: { value: null }, uWetVol: { value: null },
        uSdfMin: { value: new T.Vector3() }, uSdfMax: { value: new T.Vector3() },
        uSoilA: { value: new T.Vector3() }, uSoilB: { value: new T.Vector3() },
        uSoilTop: { value: new T.Vector3() },
        uWetness: { value: 0 }, uGrainScale: { value: 1 }, uTime: { value: 0 },
        uQuality: { value: 1 }, uTopY: { value: 0 }, uHygiene: { value: 1 },
        uMold: { value: 0 }
      };
    }
    var u = _soilU;
    u.uVP.value.fromArray(cam.vp);
    u.uLightVP.value.fromArray(R.lightVP);
    var lp2 = u.uLightPos.value, lc2 = u.uLightCol.value;
    for (var j = 0; j < 16; j++) {
      lp2[j].set(R.lightPos[j*4], R.lightPos[j*4+1], R.lightPos[j*4+2], R.lightPos[j*4+3]);
      lc2[j].set(R.lightCol[j*4], R.lightCol[j*4+1], R.lightCol[j*4+2], R.lightCol[j*4+3]);
    }
    u.uLightCount.value = R.lightCount;
    u.uSunDir.value.fromArray(env.sunDir);
    u.uSunCol.value.fromArray(env.sunCol);
    u.uSkyCol.value.fromArray(env.skyCol);
    u.uGndCol.value.fromArray(env.gndCol);
    u.uCamPos.value.fromArray(cam.pos);
    u.uToon.value = R.toon === undefined ? 1 : R.toon;
    u.uShadowMap.value = AF.T3.depth(R.shadowFB);
    u.uShadowTexel.value.set(1 / R.shadowSize, 1 / R.shadowSize);
    u.uBoxCenter.value.fromArray(farm.center);
    u.uBoxHalf.value.fromArray(farm.half);
    u.uSDF.value = AF.T3.extern3D(farm.sdf.tex);
    //  A farm without a wetness volume still has to bind SOMETHING - an
    //  unbound sampler3D reads whatever is on its unit, and the shadow map
    //  is a 2D texture. One black texel is the honest answer.
    u.uWetVol.value = AF.T3.extern3D((farm.wet && farm.wet.tex) || R.zeroVol);
    u.uSdfMin.value.fromArray(farm.sdfMin);
    u.uSdfMax.value.fromArray(farm.sdfMax);
    u.uSoilA.value.fromArray(farm.soilA);
    u.uSoilB.value.fromArray(farm.soilB);
    u.uSoilTop.value.fromArray(farm.soilTop);
    u.uWetness.value = farm.wetness;
    u.uGrainScale.value = farm.grainScale;
    u.uTime.value = env.time;
    u.uQuality.value = R.quality;
    u.uTopY.value = farm.topY;
    u.uHygiene.value = farm.hygiene;
    u.uMold.value = farm.mold;
    if (!_soilMat) _soilMat = AF.T3B.material('soil', S.SOIL_VS, S.SOIL_FS, u,
      { side: THREE.FrontSide, depthTest: true, depthWrite: true });
    var inside =
      Math.abs(cam.pos[0] - farm.center[0]) < farm.half[0] + 0.05 &&
      Math.abs(cam.pos[1] - farm.center[1]) < farm.half[1] + 0.05 &&
      Math.abs(cam.pos[2] - farm.center[2]) < farm.half[2] + 0.05;
    _soilMat.side = inside ? THREE.BackSide : THREE.FrontSide;
    AF.T3B.setCamera(cam);
    return _soilMat;
  };

  R.drawSoil = function (env, cam, farm) {
    var sm = R.soilMaterial ? R.soilMaterial(env, cam, farm) : null;
    if (sm) { AF.T3B.drawGeo(R.boxGeo, sm); return; }
  };

  //  MIGRATION STAGE 5, group 4: ants, the bestiary and brood.
  //
  //  uIsAnt is a tri-state set by DRAW GROUPING, not by anything in the
  //  instance data: 2 for real ants and the spider, 1 for the bestiary, 0
  //  for brood and every prop. It does two jobs at once. The tagma tint is
  //  an ant colour pattern that must not reach a beetle, and the brood stage
  //  selector keys off it:
  //
  //    if(uIsAnt<0.5 && abs(aPart.w-aIAnim.w)>0.5) gl_Position=vec4(2,2,2,1);
  //
  //  which is how one brood mesh draws as an egg OR a larva OR a pupa - the
  //  other two stages are pushed outside the clip volume. Regroup these
  //  draws and beetles get ant colouring; drop the selector and every
  //  nursery becomes a row of identical white beans (B16).
  //
  //  So this is three materials over one shader, one per uIsAnt value, and
  //  the grouping is preserved exactly as the raw path had it.
  var _antMat = null, _bestMat = null, _broodMat = null;
  R.creatureMaterial = function (env, cam, isAnt) {
    if (!AF.T3B || !AF.T3B.ready) return null;
    var key = isAnt === 2 ? 'ant' : (isAnt === 1 ? 'bestiary' : 'brood');
    var u = creatureUniforms(key);
    fillCreatureUniforms(u, env, cam, isAnt);
    var m = isAnt === 2 ? _antMat : (isAnt === 1 ? _bestMat : _broodMat);
    if (!m) {
      m = AF.T3B.material('creature:' + key, S.CREATURE_VS, S.CREATURE_FS, u, {});
      if (isAnt === 2) _antMat = m; else if (isAnt === 1) _bestMat = m; else _broodMat = m;
    }
    AF.T3B.setCamera(cam);
    return m;
  };

    //  MIGRATION STAGE 5, group 1: the seven prop batches.
  //
  //  Props ride the CREATURE program at uIsAnt 0, the same slot brood uses.
  //  They survive the brood stage selector only because every prop mesh
  //  carries aPart.w == 0 and every prop push passes variant 0 - give a prop
  //  a non-zero either and the whole batch vanishes with no GL error (B16).
  //  Nothing here touches that; the shader is carried across verbatim.
  //
  //  The uniform set is the linked program's own, all fifteen of it, read
  //  off gl.getActiveUniform rather than guessed from the source - the
  //  lighting block arrives through a shared chunk and is easy to miss.
  //  ONE UNIFORM OBJECT PER MATERIAL, not one shared between them.
  //
  //  three reads material.uniforms at draw time, so four materials sharing
  //  one object share one uIsAnt - and uIsAnt is exactly what separates an
  //  ant from a beetle from a brood stage. Stamping it per group before each
  //  draw would appear to work, because the groups are drawn in sequence,
  //  and would break silently the first time anything reordered or batched
  //  them. Keyed cache instead.
  var _creatureU = {}, _propMat = null;
  function creatureUniforms(key) {
    if (_creatureU[key]) return _creatureU[key];
    var T = window.THREE;
    var lp = [], lc = [];
    for (var i = 0; i < 16; i++) { lp.push(new T.Vector4()); lc.push(new T.Vector4()); }
    return (_creatureU[key] = {
      uVP: { value: new T.Matrix4() },
      uLightVP: { value: new T.Matrix4() },
      uLightPos: { value: lp },
      uLightCol: { value: lc },
      uLightCount: { value: 0 },
      uSunDir: { value: new T.Vector3() },
      uSunCol: { value: new T.Vector3() },
      uSkyCol: { value: new T.Vector3() },
      uGndCol: { value: new T.Vector3() },
      uCamPos: { value: new T.Vector3() },
      uToon: { value: 1 },
      uTime: { value: 0 },
      uIsAnt: { value: 0 },
      uShadowMap: { value: null },
      uShadowTexel: { value: new T.Vector2() }
    });
  }
  function fillCreatureUniforms(u, env, cam, isAnt) {
    u.uVP.value.fromArray(cam.vp);
    u.uLightVP.value.fromArray(R.lightVP);
    var lp = u.uLightPos.value, lc = u.uLightCol.value;
    for (var i = 0; i < 16; i++) {
      lp[i].set(R.lightPos[i * 4], R.lightPos[i * 4 + 1], R.lightPos[i * 4 + 2], R.lightPos[i * 4 + 3]);
      lc[i].set(R.lightCol[i * 4], R.lightCol[i * 4 + 1], R.lightCol[i * 4 + 2], R.lightCol[i * 4 + 3]);
    }
    u.uLightCount.value = R.lightCount;
    u.uSunDir.value.fromArray(env.sunDir);
    u.uSunCol.value.fromArray(env.sunCol);
    u.uSkyCol.value.fromArray(env.skyCol);
    u.uGndCol.value.fromArray(env.gndCol);
    u.uCamPos.value.fromArray(cam.pos);
    u.uToon.value = R.toon === undefined ? 1 : R.toon;
    u.uTime.value = env.time;
    u.uIsAnt.value = isAnt;
    //  the shadow map is still a raw GL texture until Stage 6 moves it
    u.uShadowMap.value = AF.T3.depth(R.shadowFB);
    u.uShadowTexel.value.set(1 / R.shadowSize, 1 / R.shadowSize);
  }
  R.propMaterial = function (env, cam) {
    if (!AF.T3B || !AF.T3B.ready) return null;
    var u = creatureUniforms('prop');
    fillCreatureUniforms(u, env, cam, 0);
    if (!_propMat) {
      _propMat = AF.T3B.material('creature:prop', S.CREATURE_VS, S.CREATURE_FS, u, {});
    }
    AF.T3B.setCamera(cam);
    return _propMat;
  };

  //  MIGRATION STAGE 5, group 2: the four flora batches.
  //
  //  Same uniform set as the creature program minus uIsAnt, so it shares the
  //  factory - three only assigns uniforms the program actually declares, so
  //  the spare entry is inert.
  //
  //  DoubleSide, never BackSide. The raw pass runs GLX.cull(false) because a
  //  blade of grass is a single sheet and culling loses half of every one.
  //  three implements BackSide as frontFace(CW) + cullFace(BACK), which
  //  INVERTS gl_FrontFacing - and FLORA_FS reads it, flipping the normal on
  //  back faces. BackSide here would light every blade from the wrong side
  //  (brief L8).
  var _floraMat = null;
  R.floraMaterial = function (env, cam) {
    if (!AF.T3B || !AF.T3B.ready) return null;
    var u = creatureUniforms('flora');
    fillCreatureUniforms(u, env, cam, 0);
    if (!_floraMat) {
      _floraMat = AF.T3B.material('flora', S.FLORA_VS, S.FLORA_FS, u,
        { side: THREE.DoubleSide });
    }
    AF.T3B.setCamera(cam);
    return _floraMat;
  };

    //  MIGRATION STAGE 6: the static meshes - the room, the table and its
  //  legs, the vitrine frames. These are the only geometry here that carries
  //  a real uModel rather than absolute per-instance world positions, and
  //  the only geometry that could legitimately be frustum culled. It still
  //  is not: the object matrix lives in a uniform the shader applies itself,
  //  so three's bounds would be computed in the wrong space entirely.
  var _statU = null, _statMat = null;
  R.staticMaterial = function (env, cam) {
    if (!AF.T3B || !AF.T3B.ready) return null;
    var T = window.THREE;
    if (!_statU) {
      var lp = [], lc = [];
      for (var i = 0; i < 16; i++) { lp.push(new T.Vector4()); lc.push(new T.Vector4()); }
      _statU = {
        uVP: { value: new T.Matrix4() }, uModel: { value: new T.Matrix4() },
        uLightVP: { value: new T.Matrix4() },
        uLightPos: { value: lp }, uLightCol: { value: lc }, uLightCount: { value: 0 },
        uSunDir: { value: new T.Vector3() }, uSunCol: { value: new T.Vector3() },
        uSkyCol: { value: new T.Vector3() }, uGndCol: { value: new T.Vector3() },
        uCamPos: { value: new T.Vector3() }, uToon: { value: 1 },
        uAlbedo: { value: new T.Vector3() }, uRough: { value: 0.5 },
        uMetal: { value: 0 }, uMatType: { value: 0 },
        uShadowMap: { value: null }, uShadowTexel: { value: new T.Vector2() }
      };
    }
    var u = _statU;
    u.uVP.value.fromArray(cam.vp);
    u.uLightVP.value.fromArray(R.lightVP);
    var lp2 = u.uLightPos.value, lc2 = u.uLightCol.value;
    for (var j = 0; j < 16; j++) {
      lp2[j].set(R.lightPos[j*4], R.lightPos[j*4+1], R.lightPos[j*4+2], R.lightPos[j*4+3]);
      lc2[j].set(R.lightCol[j*4], R.lightCol[j*4+1], R.lightCol[j*4+2], R.lightCol[j*4+3]);
    }
    u.uLightCount.value = R.lightCount;
    u.uSunDir.value.fromArray(env.sunDir);
    u.uSunCol.value.fromArray(env.sunCol);
    u.uSkyCol.value.fromArray(env.skyCol);
    u.uGndCol.value.fromArray(env.gndCol);
    u.uCamPos.value.fromArray(cam.pos);
    u.uToon.value = R.toon === undefined ? 1 : R.toon;
    u.uShadowMap.value = AF.T3.depth(R.shadowFB);
    u.uShadowTexel.value.set(1 / R.shadowSize, 1 / R.shadowSize);
    if (!_statMat) _statMat = AF.T3B.material('static', S.STATIC_VS, S.STATIC_FS, u,
      { side: THREE.FrontSide, depthTest: true, depthWrite: true });
    AF.T3B.setCamera(cam);
    return _statMat;
  };

  R.drawStatic = function (env, cam, mesh, geo, model, albedo, rough, metal, matType) {
    if (geo && AF.T3B && AF.T3B.ready) {
      var m = R.staticMaterial(env, cam);
      if (m) {
        m.uniforms.uModel.value.fromArray(model);
        m.uniforms.uAlbedo.value.fromArray(albedo);
        m.uniforms.uRough.value = rough;
        m.uniforms.uMetal.value = metal;
        m.uniforms.uMatType.value = matType || 0;
        AF.T3B.drawGeo(geo, m);
        return;
      }
    }
  };

  //  The scene target has two draw buffers, but the additive passes below
  //  only declare one fragment output - WebGL2 treats that as an error, so
  //  the normal attachment is switched off for the duration.
  R.colorOnly = function () {
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
  };
  R.restoreMRT = function () {
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  };

  //  MIGRATION STAGE 5, group 3: decals and the build ghost.
  //
  //  One program, two materials, differing only in the depth test: a decal
  //  tests depth so it lies on the ground it is painted over, while the
  //  ghost does NOT, because a room you have not dug yet is buried in soil
  //  and has to be visible through it (B23).
  //
  //  THE SECOND OUTPUT IS THE INTERESTING PART. The raw pass brackets itself
  //  in colorOnly()/restoreMRT(), masking attachment 1 off with drawBuffers
  //  because DECAL_FS declares one output and WebGL2 drops a draw that
  //  writes fewer outputs than the framebuffer has draw buffers. three has
  //  no per-draw drawBuffers mask and caches the one it set per framebuffer
  //  (L5), so instead of fighting it the shader gets a second output that
  //  writes vec4(0.0). Under 'addpre' - blendFunc(ONE, ONE) - that is
  //  provably a no-op: dst + 0 = dst. Attachment 1 comes out untouched, the
  //  mask is unnecessary, and nothing can forget to restore it.
  //  Give a single-output fragment shader a second output that writes
  //  vec4(0.0), so it can draw into the MRT pair without a drawBuffers mask.
  //
  //  Provably a no-op for every blend mode this is used with:
  //    addpre    (ONE, ONE)                     dst + 0            = dst
  //    multalpha (DST_COLOR, ONE_MINUS_SRC_ALPHA / ZERO, ONE)
  //              RGB 0*dst + dst*(1-0) = dst,  A 0*srcA + 1*dstA = dstA
  //  Verified on attachment 1 read back in full: 0 differing bytes.
  function withNullNormal(fs) {
    return fs
      .replace('out vec4 oColor;',
        'layout(location=0) out vec4 oColor;\nlayout(location=1) out vec4 oNormal;')
      .replace(/\}\s*$/, '  oNormal = vec4(0.0);\n}');
  }
  function decalFS() { return withNullNormal(S.DECAL_FS); }
  var _decalU = null, _decalMat = null, _ghostMat = null;
  function decalUniforms(env, cam) {
    var T = window.THREE;
    if (!_decalU) _decalU = { uVP: { value: new T.Matrix4() }, uTime: { value: 0 } };
    _decalU.uVP.value.fromArray(cam.vp);
    _decalU.uTime.value = env.time;
    return _decalU;
  }
  R.decalMaterial = function (env, cam, isGhost) {
    if (!AF.T3B || !AF.T3B.ready) return null;
    var u = decalUniforms(env, cam);
    if (isGhost) {
      if (!_ghostMat) _ghostMat = AF.T3B.material('decal:ghost', S.DECAL_VS, decalFS(), u,
        { side: THREE.DoubleSide, depthTest: false, depthWrite: false, blend: 'addpre' });
      AF.T3B.setCamera(cam); return _ghostMat;
    }
    if (!_decalMat) _decalMat = AF.T3B.material('decal', S.DECAL_VS, decalFS(), u,
      { side: THREE.DoubleSide, depthTest: true, depthWrite: false, blend: 'addpre' });
    AF.T3B.setCamera(cam); return _decalMat;
  };

  R.drawDecals = function (env, cam) {
    if (R.B.decal.n === 0) return;
    var m = R.decalMaterial ? R.decalMaterial(env, cam, false) : null;
    if (m) { R.B.decal.drawThree(m); return; }
  };

  //  Build previews ignore depth. A silhouette of a room you have not dug yet
  //  is by definition buried in solid soil, so depth-testing it hides the one
  //  thing the player needs to see before committing.
  R.drawGhost = function (env, cam) {
    if (R.B.ghost.n === 0) return;
    var mg = R.decalMaterial ? R.decalMaterial(env, cam, true) : null;
    if (mg) { R.B.ghost.drawThree(mg); return; }
  };

  //  MIGRATION STAGE 5, group 5: pheromone trails and particles.
  //
  //  Both are camera-facing billboards built in the vertex shader from the
  //  view matrix rows handed in as uRight/uUp - not from a model matrix, and
  //  not by three. Both reinterpret the shared instance slots: PART_VS reads
  //  aIData as (life01, kind, spin, seed) and PHERO_VS as (age, type, seed,
  //  pulse), which is why the twenty-slot push signature has to stay
  //  positional and unlabelled (B15).
  var _billU = null, _pheroMat = null, _partMat = null;
  function billboardUniforms(env, cam) {
    var T = window.THREE;
    if (!_billU) _billU = { uVP: { value: new T.Matrix4() }, uRight: { value: new T.Vector3() },
                            uUp: { value: new T.Vector3() }, uTime: { value: 0 } };
    _billU.uVP.value.fromArray(cam.vp);
    _billU.uRight.value.set(cam.view[0], cam.view[4], cam.view[8]);
    _billU.uUp.value.set(cam.view[1], cam.view[5], cam.view[9]);
    _billU.uTime.value = env.time;
    return _billU;
  }
  R.billboardMaterial = function (env, cam, which) {
    if (!AF.T3B || !AF.T3B.ready) return null;
    var u = billboardUniforms(env, cam);
    if (which === 'phero') {
      if (!_pheroMat) _pheroMat = AF.T3B.material('phero', S.PHERO_VS, withNullNormal(S.PHERO_FS), u,
        { side: THREE.DoubleSide, depthTest: true, depthWrite: false, blend: 'addpre' });
      AF.T3B.setCamera(cam); return _pheroMat;
    }
    if (!_partMat) _partMat = AF.T3B.material('particle', S.PART_VS, withNullNormal(S.PART_FS), u,
      { side: THREE.DoubleSide, depthTest: true, depthWrite: false, blend: 'addpre' });
    AF.T3B.setCamera(cam); return _partMat;
  };

  R.useThreeBillboards = true;    // see drawTransparents
  R.drawTransparents = function (env, cam) {
    var right = v3.create(cam.view[0], cam.view[4], cam.view[8]);
    var up = v3.create(cam.view[1], cam.view[5], cam.view[9]);
    //  HELD BACK FOR TWO STAGES, AND THE CAUSE WAS SOMEWHERE ELSE.
    //
    //  When this pass was first ported it drew 20 of 49 on-screen particles
    //  brighter than the raw path and 0 dimmer - systematic, one-directional
    //  and reproducible. Everything local checked out: the GL state at the
    //  draw was byte-identical, attachment 1 was byte-identical, and the
    //  geometry, uniforms and instance arrays were the same objects. With no
    //  explanation it was left switched off rather than shipped.
    //
    //  It was the same fault the glass pass turned up a stage later, and it
    //  was not in this file at all: T3B.drawObject relied on whatever
    //  framebuffer the raw code had left bound, and three's resetState
    //  unbinds the render target. The sprites were going to the back buffer.
    //  Once drawObject named its target explicitly and resynced on entry,
    //  this pass came right on its own.
    //
    //  Re-measured with the particle system frozen so both paths draw the
    //  same sprites: 211 particles on screen, 0 brighter through three and 0
    //  through raw. Attachment 1 still byte-identical.
    if (R.useThreeBillboards && AF.T3B && AF.T3B.ready) {
      if (R.B.phero.n > 0) R.B.phero.drawThree(R.billboardMaterial(env, cam, 'phero'));
      if (R.B.particle.n > 0) R.B.particle.drawThree(R.billboardMaterial(env, cam, 'particle'));
      return;
    }
  };

  R.copyScene = function () {
    R.copyFB.bind(false);
    if (R.copyPass3 || (AF.T3 && AF.T3.ready && R.copyFB.rt)) {
      if (!R.copyPass3) R.copyPass3 = AF.T3.pass('copyScene', SP.COPY_FS, { uTex: null });
      //  This is the ONLY legal refraction source and it is written exactly
      //  once a frame, here, after all opaque work and before glass, tubes,
      //  liquids and water. Sampling the live scene target instead is a
      //  framebuffer feedback loop: GL answers with INVALID_OPERATION, drops
      //  the draw, and there is no glass and no water at all.
      R.copyPass3.render(R.copyFB, { uTex: AF.T3.tex(R.sceneFB, 0) });
      //  Re-bind WITHOUT clearing. Clearing here wipes the whole opaque
      //  scene twice a frame and leaves glass and a water film on black.
      R.sceneFB.bind(false);
      return;
    }
  };

  //  MIGRATION STAGE 6: glass and the connecting tubes.
  //
  //  DoubleSide, never BackSide - GLASS_FS reads gl_FrontFacing to flip the
  //  normal on back faces, and three implements BackSide as frontFace(CW) +
  //  cullFace(BACK), which would invert it and light every pane from the
  //  wrong side (L8).
  //
  //  It refracts, so it samples copyFB: the one legal refraction source,
  //  written once per frame before this pass. Sampling the live scene target
  //  would be a framebuffer feedback loop and GL would drop the draw with no
  //  console error beyond a warning (B4, L15).
  //
  //  depthWrite is OFF and depthFunc stays LESS. The panes are built +0.10
  //  outside the soil box precisely because flush panes are coplanar with
  //  the raymarched soil surface and z-fight across the whole face of the
  //  tank; LEQUAL would turn that pair into last-drawn-wins (B24).
  var _glassU = null, _glassMat = null;
  R.glassMaterial = function (env, cam) {
    if (!AF.T3B || !AF.T3B.ready) return null;
    var T = window.THREE;
    if (!_glassU) _glassU = {
      uVP: { value: new T.Matrix4() }, uModel: { value: new T.Matrix4() },
      uScene: { value: null }, uRes: { value: new T.Vector2() },
      uCamPos: { value: new T.Vector3() }, uSunDir: { value: new T.Vector3() },
      uSunCol: { value: new T.Vector3() }, uSkyCol: { value: new T.Vector3() },
      uGndCol: { value: new T.Vector3() }, uGlassCol: { value: new T.Vector3() },
      uTint: { value: 0.55 }
    };
    _glassU.uVP.value.fromArray(cam.vp);
    _glassU.uScene.value = AF.T3.tex(R.copyFB, 0);
    _glassU.uRes.value.set(R.width, R.height);
    _glassU.uCamPos.value.fromArray(cam.pos);
    _glassU.uSunDir.value.fromArray(env.sunDir);
    _glassU.uSunCol.value.fromArray(env.sunCol);
    _glassU.uSkyCol.value.fromArray(env.skyCol);
    _glassU.uGndCol.value.fromArray(env.gndCol);
    if (!_glassMat) _glassMat = AF.T3B.material('glass', S.GLASS_VS, S.GLASS_FS, _glassU,
      { side: THREE.DoubleSide, depthTest: true, depthWrite: false, blend: 'premul' });
    AF.T3B.setCamera(cam);
    return _glassMat;
  };
  //  Per-draw uniforms, written between draws of the same material.
  R.glassPer = function (mat, model, tint, col) {
    mat.uniforms.uModel.value.fromArray(model);
    mat.uniforms.uTint.value = tint;
    mat.uniforms.uGlassCol.value.fromArray(col);
  };

  
  //  Water WRITES DEPTH. That is not a detail: the ink outline in the post
  //  chain is a Sobel over depth + normals, so with depth-write off - which
  //  is what this pass used to do - water could never receive an outline at
  //  all. In a game drawn in ink that is most of "the water looks wrong".
  //  MIGRATION STAGE 5, group 6: droplets and puddles.
  //
  //  LIQUID_FS already declares both outputs, so no null-normal transform.
  //  It refracts, so it samples copyFB - the one legal refraction source,
  //  written once per frame before the refractive passes. Sampling the live
  //  scene target here would be a feedback loop and GL would drop the draw
  //  (B4). Droplets before puddles, premultiplied, depth test on and write
  //  off - nothing in this renderer is depth sorted, so that order is the
  //  only thing keeping them stacked correctly.
  var _liqU = null, _liqMat = null;
  R.liquidMaterial = function (env, cam) {
    if (!AF.T3B || !AF.T3B.ready) return null;
    var T = window.THREE;
    if (!_liqU) {
      var lp = [], lc = [];
      for (var i = 0; i < 16; i++) { lp.push(new T.Vector4()); lc.push(new T.Vector4()); }
      _liqU = { uVP: { value: new T.Matrix4() }, uScene: { value: null },
        uRes: { value: new T.Vector2() }, uTime: { value: 0 },
        uLightPos: { value: lp }, uLightCol: { value: lc }, uLightCount: { value: 0 },
        uSunDir: { value: new T.Vector3() }, uSunCol: { value: new T.Vector3() },
        uSkyCol: { value: new T.Vector3() }, uGndCol: { value: new T.Vector3() },
        uCamPos: { value: new T.Vector3() }, uToon: { value: 1 } };
    }
    _liqU.uVP.value.fromArray(cam.vp);
    _liqU.uScene.value = AF.T3.tex(R.copyFB, 0);
    _liqU.uRes.value.set(R.width, R.height);
    _liqU.uTime.value = env.time;
    var lp2 = _liqU.uLightPos.value, lc2 = _liqU.uLightCol.value;
    for (var j = 0; j < 16; j++) {
      lp2[j].set(R.lightPos[j * 4], R.lightPos[j * 4 + 1], R.lightPos[j * 4 + 2], R.lightPos[j * 4 + 3]);
      lc2[j].set(R.lightCol[j * 4], R.lightCol[j * 4 + 1], R.lightCol[j * 4 + 2], R.lightCol[j * 4 + 3]);
    }
    _liqU.uLightCount.value = R.lightCount;
    _liqU.uSunDir.value.fromArray(env.sunDir);
    _liqU.uSunCol.value.fromArray(env.sunCol);
    _liqU.uSkyCol.value.fromArray(env.skyCol);
    _liqU.uGndCol.value.fromArray(env.gndCol);
    _liqU.uCamPos.value.fromArray(cam.pos);
    _liqU.uToon.value = R.toon === undefined ? 1 : R.toon;
    if (!_liqMat) _liqMat = AF.T3B.material('liquid', S.LIQUID_VS, S.LIQUID_FS, _liqU,
      { side: THREE.DoubleSide, depthTest: true, depthWrite: false, blend: 'premul' });
    AF.T3B.setCamera(cam);
    return _liqMat;
  };

  R.drawLiquids = function (env, cam) {
    if (R.B.droplet.n === 0 && R.B.puddle.n === 0) return;
    var lm = R.liquidMaterial ? R.liquidMaterial(env, cam) : null;
    if (lm) {
      R.B.droplet.drawThree(lm);
      R.B.puddle.drawThree(lm);
      return;
    }
  };

  //  Damp soil under a pool. This is a MULTIPLY pass: an additive one cannot
  //  darken anything, which is why the previous attempt at a "dark ring"
  //  rendered as bright arcs around every puddle.
  //  MIGRATION STAGE 5, group 7: the damp ring under a pool.
  //
  //  DORMANT. Game.pushWet returns immediately, so this batch is always
  //  empty and nothing below runs in a shipping frame. The brief is explicit
  //  that it must be kept correct and NOT enabled, so it is ported with its
  //  multiply blend intact and left switched off. It is the only darkening
  //  pass in the frame: made additive it draws bright arcs instead of a
  //  shadow, and it has to precede the additive decals or cursor highlights
  //  over damp ground go muddy.
  //
  //  Untested by construction - there is no way to exercise it without
  //  enabling it, which the brief forbids.
  var _wetU = null, _wetMat = null;
  R.wetMaterial = function (env, cam) {
    if (!AF.T3B || !AF.T3B.ready) return null;
    var T = window.THREE;
    if (!_wetU) _wetU = { uVP: { value: new T.Matrix4() }, uTime: { value: 0 } };
    _wetU.uVP.value.fromArray(cam.vp);
    _wetU.uTime.value = env.time;
    if (!_wetMat) _wetMat = AF.T3B.material('wet', S.DECAL_VS, withNullNormal(S.WET_FS), _wetU,
      { side: THREE.DoubleSide, depthTest: true, depthWrite: false, blend: 'multalpha' });
    AF.T3B.setCamera(cam);
    return _wetMat;
  };

  R.drawWet = function (env, cam) {
    if (R.B.wet.n === 0) return;
    var wm = R.wetMaterial ? R.wetMaterial(env, cam) : null;
    if (wm) { R.B.wet.drawThree(wm); return; }
  };

  // ==================================================================
  //  POST CHAIN
  // ==================================================================
  //  Scratch uniform objects. three keeps a reference to whatever is put
  //  in uniform.value, so handing it a fresh Vector2 per pass per frame
  //  would allocate a few hundred objects a second for no reason.
  var _v2 = [], _v2n = 0, _v3 = [], _v3n = 0, _m4 = [], _m4n = 0;
  function vec2Of(x, y) {
    var v = _v2[_v2n] || (_v2[_v2n] = new THREE.Vector2());
    _v2n = (_v2n + 1) % 16; return v.set(x, y);
  }
  function vec3Of(a) {
    var v = _v3[_v3n] || (_v3[_v3n] = new THREE.Vector3());
    _v3n = (_v3n + 1) % 8; return v.set(a[0], a[1], a[2]);
  }
  function mat4Of(m) {
    var v = _m4[_m4n] || (_m4[_m4n] = new THREE.Matrix4());
    _m4n = (_m4n + 1) % 8; return v.fromArray(m);
  }

  R.post = function (env, cam, fx) {
    var P, i;
    GLX.depth(false, false);
    GLX.blend(false);
    GLX.cull(false);

    if (fx.ao > 0.001 && R.ssaoPass) {
      //  MIGRATION STAGE 4. SSAO and its separable bilateral blur. The
      //  ping-pong still ends in aoFB, never aoFB2 - the composite samples
      //  aoFB and swapping the last write silently halves the effect.
      var T3 = AF.T3, aoT = new THREE.Vector2(1 / R.aoFB.width, 1 / R.aoFB.height);
      R.ssaoPass.render(R.aoFB, {
        uDepth: T3.depth(R.sceneFB), uNormal: T3.tex(R.sceneFB, 1),
        uInvProj: mat4Of(cam.invProj), uProj: mat4Of(cam.proj), uView: mat4Of(cam.view),
        uRes: vec2Of(R.aoFB.width, R.aoFB.height),
        uRadius: fx.aoRadius, uStrength: fx.aoStrength, uTime: env.time
      });
      R.blurPass.render(R.aoFB2, {
        uTex: T3.tex(R.aoFB), uDepth: T3.depth(R.sceneFB),
        uDir: vec2Of(1, 0), uTexel: aoT
      });
      R.blurPass.render(R.aoFB, {
        uTex: T3.tex(R.aoFB2), uDepth: T3.depth(R.sceneFB),
        uDir: vec2Of(0, 1), uTexel: aoT
      });
} else {
      R.aoFB.bind(true, 1, 1, 1, 1);
    }

    // bloom
    //  MIGRATION STAGE 2: the bright pass is drawn by three. Everything
    //  downstream is still raw GL and reads the result through T3.raw,
    //  which is the interop the rest of the stage depends on - a three
    //  material samples this renderer's textures through ExternalTexture,
    //  and raw passes sample three's targets through the WebGLTexture
    //  inside them.
    var last = R.bloom.length - 1;
    if (R.T3bloom) {
      //  MIGRATION STAGE 2. The whole bloom pyramid - bright, the down
      //  chain, the copy at the smallest mip and the up chain - is drawn by
      //  three. Only the composite still reads the result, and it does so
      //  through T3.raw.
      //
      //  Every level moved together rather than one at a time: the up pass
      //  reads bloomUp[i+1] AND bloom[i], so a half-converted pyramid means
      //  a T3.raw call inside the inner loop for one level and not the
      //  next, which is exactly the kind of asymmetry that hides a mistake.
      var T = R.T3bloom;
      R.brightPass.render(T.down[0], {
        uTex: AF.T3.extern(R.sceneFB.color[0]),
        uThreshold: fx.bloomThreshold, uSoft: 0.7
      });
      for (i = 1; i < T.down.length; i++) {
        R.downPass.render(T.down[i], {
          uTex: T.down[i - 1].texture,
          uTexel: T.texel[i - 1]
        });
      }
      R.copyPass.render(T.up[last], { uTex: T.down[last].texture });
      for (i = last - 1; i >= 0; i--) {
        R.upPass.render(T.up[i], {
          uTex: T.up[i + 1].texture,
          uPrev: T.down[i].texture,
          uTexel: T.texel[i + 1],
          uScatter: fx.bloomScatter
        });
      }
    }
    // dof
    if (fx.dof > 0.001 && R.cocPass) {
      R.cocPass.render(R.dofA, {
        uColor: AF.T3.tex(R.sceneFB, 0), uDepth: AF.T3.depth(R.sceneFB),
        uNear: cam.near, uFar: cam.far, uFocus: fx.focus,
        uAperture: fx.aperture, uMaxCoC: fx.maxCoC
      });
      R.dofPass.render(R.dofB, {
        uTex: AF.T3.tex(R.dofA),
        uTexel: vec2Of(1 / R.dofA.width, 1 / R.dofA.height),
        uMaxCoC: fx.maxCoC
      });
} else {
      //  DISABLED MEANS ALPHA 0, not black. The composite reads uDOF.a as
      //  the blend weight, so clearing this to opaque black would blur the
      //  whole frame to nothing on the Low preset.
      R.dofB.bind(true, 0, 0, 0, 0);
    }

    // god rays
    if (fx.rays > 0.001 && fx.sunOnScreen && R.godrayPass) {
      //  the shafts are grown from bloom level 1, so this depends on the
      //  down chain having already run
      R.copyPass2.render(R.raysFB, {
        uTex: R.T3bloom ? R.T3bloom.down[1].texture : AF.T3.tex(R.bloom[1])
      });
      R.godrayPass.render(R.raysFB2, {
        uTex: AF.T3.tex(R.raysFB),
        uSunUV: vec2Of(fx.sunUV[0], fx.sunUV[1]),
        uDecay: 0.965, uDensity: 0.72, uWeight: 0.11, uExposure: 0.30
      });
} else {
      R.raysFB2.bind(true, 0, 0, 0, 1);
    }

    // composite
    if (R.compPass) {
      R.compPass.render(R.compFB, {
        uColor: AF.T3.tex(R.sceneFB, 0),
        uBloom: R.T3bloom ? R.T3bloom.up[0].texture : AF.T3.tex(R.bloomUp[0]),
        uAO: AF.T3.tex(R.aoFB), uDOF: AF.T3.tex(R.dofB), uRays: AF.T3.tex(R.raysFB2),
        uDepth: AF.T3.depth(R.sceneFB), uNormalTex: AF.T3.tex(R.sceneFB, 1),
        uRes: vec2Of(R.width, R.height), uTime: env.time,
        uBloomAmt: fx.bloom, uAOAmt: fx.ao, uExposure: fx.exposure,
        uVignette: fx.vignette, uGrain: fx.grain, uCA: fx.ca,
        uSat: fx.saturation, uContrast: fx.contrast,
        uLift: vec3Of(fx.lift), uGain: vec3Of(fx.gain),
        uRaysAmt: fx.rays, uDofAmt: fx.dof, uFlash: fx.flash,
        uFlashCol: vec3Of(fx.flashCol),
        uOutline: fx.outline === undefined ? 0.85 : fx.outline,
        uPaper: fx.paper === undefined ? 0.02 : fx.paper,
        uNear: cam.near, uFar: cam.far
      });
      //  FXAA is the only pass that writes the default framebuffer, and the
      //  frame has to END there: the harness reads the canvas back in the
      //  same JS task (B31).
      R.fxaaPass.render(null, {
        uTex: AF.T3.tex(R.compFB),
        uTexel: vec2Of(1 / R.width, 1 / R.height),
        uSharp: fx.sharpen
      });
      return;
    }
  };

  R.frameStart = function () {
    //  three caches blend factors, depth mask, cull face and drawBuffers and
    //  skips calls it believes are redundant. Every raw GL call this renderer
    //  makes leaves that cache lying, after which three would omit exactly
    //  the call needed to put the state back. Resynchronise once a frame for
    //  the whole duration of the migration.
    if (R.three) threeResync();
    R.stats.draws = 0; R.stats.tris = 0; R.stats.instances = 0;
    for (var k in R.B) R.B[k].begin();
  };

  AF.R = R;
})(window.AF = window.AF || {});

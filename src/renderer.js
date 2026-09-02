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
    P.sky = GLX.program(GLX.FS_VS, S.SKY_FS, 'sky');
    P.soil = GLX.program(S.SOIL_VS, S.SOIL_FS, 'soil');
    P.creature = GLX.program(S.CREATURE_VS, S.CREATURE_FS, 'creature');
    P.shadow = GLX.program(S.SHADOW_VS, S.SHADOW_FS, 'shadow');
    P.staticM = GLX.program(S.STATIC_VS, S.STATIC_FS, 'static');
    P.flora = GLX.program(S.FLORA_VS, S.FLORA_FS, 'flora');
    P.glass = GLX.program(S.GLASS_VS, S.GLASS_FS, 'glass');
    P.liquid = GLX.program(S.LIQUID_VS, S.LIQUID_FS, 'liquid');
    P.phero = GLX.program(S.PHERO_VS, S.PHERO_FS, 'phero');
    P.particle = GLX.program(S.PART_VS, S.PART_FS, 'particle');
    P.decal = GLX.program(S.DECAL_VS, S.DECAL_FS, 'decal');
    P.wet = GLX.program(S.DECAL_VS, S.WET_FS, 'wet');
    //  One black texel, for a farm that has no wetness volume of its own.
    //  Made here so that binding it never has to allocate mid-frame - see
    //  the note in R.drawSoil.
    R.zeroVol = GLX.texture3D({
      width: 1, height: 1, depth: 1,
      internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE
    });
    if (AF.T3) AF.T3.init(R);
    if (AF.WR) AF.WR.init(R);
    if (AF.HeapR) AF.HeapR.init(R);
    P.bake = GLX.program(GLX.FS_VS, S.BAKE_FS, 'bake');
    P.ssao = GLX.program(GLX.FS_VS, SP.SSAO_FS, 'ssao');
    P.blur = GLX.program(GLX.FS_VS, SP.BLUR_FS, 'blur');
    P.bright = GLX.program(GLX.FS_VS, SP.BRIGHT_FS, 'bright');
    P.down = GLX.program(GLX.FS_VS, SP.DOWN_FS, 'down');
    P.up = GLX.program(GLX.FS_VS, SP.UP_FS, 'up');
    P.coc = GLX.program(GLX.FS_VS, SP.COC_FS, 'coc');
    P.dof = GLX.program(GLX.FS_VS, SP.DOF_FS, 'dof');
    P.godray = GLX.program(GLX.FS_VS, SP.GODRAY_FS, 'godray');
    P.comp = GLX.program(GLX.FS_VS, SP.COMPOSITE_FS, 'comp');
    P.fxaa = GLX.program(GLX.FS_VS, SP.FXAA_FS, 'fxaa');
    P.copy = GLX.program(GLX.FS_VS, SP.COPY_FS, 'copy');
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

    R.boxMesh = G.buildBox(1, 1, 1, false).build(P.soil, null);

    R.shadowSize = 2048;
    R.shadowFB = new GLX.FBO({ width: R.shadowSize, height: R.shadowSize, depth: 'texture', depthFilter: gl.LINEAR });
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

    var i;
    if (R.sceneFB) {
      R.sceneFB.destroy(); R.copyFB.destroy(); R.aoFB.destroy(); R.aoFB2.destroy();
      R.dofA.destroy(); R.dofB.destroy(); R.raysFB.destroy(); R.raysFB2.destroy(); R.compFB.destroy();
      for (i = 0; i < R.bloom.length; i++) R.bloom[i].destroy();
      for (i = 0; i < R.bloomUp.length; i++) R.bloomUp[i].destroy();
    }
    var F16 = { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
    R.sceneFB = new GLX.FBO({
      width: w, height: h, depth: 'texture',
      color: [F16, { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE }]
    });
    R.copyFB = new GLX.FBO({ width: w, height: h, color: [F16] });
    var aw = Math.max(1, w >> 1), ah = Math.max(1, h >> 1);
    var R8 = { internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE };
    R.aoFB = new GLX.FBO({ width: aw, height: ah, color: [R8] });
    R.aoFB2 = new GLX.FBO({ width: aw, height: ah, color: [R8] });
    R.dofA = new GLX.FBO({ width: aw, height: ah, color: [F16] });
    R.dofB = new GLX.FBO({ width: aw, height: ah, color: [F16] });
    var rw = Math.max(1, w >> 2), rh = Math.max(1, h >> 2);
    R.raysFB = new GLX.FBO({ width: rw, height: rh, color: [F16] });
    R.raysFB2 = new GLX.FBO({ width: rw, height: rh, color: [F16] });
    R.compFB = new GLX.FBO({ width: w, height: h, color: [{ internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE }] });
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
        R.brightPass = AF.T3.pass('bright', SP.BRIGHT_FS,
          { uTex: null, uThreshold: 1.45, uSoft: 0.7 });
        R.downPass = AF.T3.pass('down', SP.DOWN_FS,
          { uTex: null, uTexel: new THREE.Vector2(1, 1) });
        R.upPass = AF.T3.pass('up', SP.UP_FS,
          { uTex: null, uPrev: null, uTexel: new THREE.Vector2(1, 1), uScatter: 1 });
        R.copyPass = AF.T3.pass('copy', SP.COPY_FS, { uTex: null });
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
    var P = R.P.shadow;
    P.use();
    P.m4('uVP', R.lightVP);
    drawCB(P);
  };

  R.beginScene = function (env, cam) {
    R.sceneFB.bind(false);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    GLX.depth(false, false);
    GLX.blend(false);
    GLX.cull(false);
    var P = R.P.sky;
    P.use();
    P.m4('uInvVP', cam.invVP);
    P.v3('uCamPos', cam.pos);
    P.v3('uSunDir', env.sunDir);
    P.v3('uSunCol', env.sunCol);
    P.v3('uRoomA', env.roomA);
    P.v3('uRoomB', env.roomB);
    P.f('uTime', env.time);
    GLX.fullscreen();
    R.stats.draws++;
    GLX.depth(true, true);
  };

  R.drawSoil = function (env, cam, farm) {
    var P = R.P.soil;
    P.use();
    bindEnv(P, env, cam);
    bindShadow(P);
    P.m4('uVP', cam.vp);
    P.v3('uBoxCenter', farm.center);
    P.v3('uBoxHalf', farm.half);
    P.tex('uSDF', farm.sdf.tex, gl.TEXTURE_3D);
    //  Where the water soaked in. Shares the SDF box exactly, so uSdfMin and
    //  uSdfMax below serve both samplers.
    //
    //  A farm without a volume - an old save, or one built before AF.Wet
    //  existed - still has to bind SOMETHING. An unbound sampler3D reads
    //  texture unit 0, which bindShadow has already filled with the 2D
    //  shadow map, and what a sampler returns when no texture of its own
    //  target is bound there is not worth relying on. One black texel is.
    //
    //  Built in R.init, NOT lazily here. GLX.texture3D finishes with
    //  bindTexture(TEXTURE_3D, null), and Program.tex leaves its unit
    //  active - so creating it at this point would unbind the SDF that the
    //  line above had just bound, on that same unit, and the soil would
    //  raymarch an empty field for the one frame it happened on.
    P.tex('uWetVol', (farm.wet && farm.wet.tex) || R.zeroVol, gl.TEXTURE_3D);
    P.v3('uSdfMin', farm.sdfMin);
    P.v3('uSdfMax', farm.sdfMax);
    P.v3('uSoilA', farm.soilA);
    P.v3('uSoilB', farm.soilB);
    P.v3('uSoilTop', farm.soilTop);
    P.f('uWetness', farm.wetness);
    P.f('uGrainScale', farm.grainScale);
    P.f('uTime', env.time);
    P.f('uQuality', R.quality);
    P.f('uTopY', farm.topY);
    P.f('uHygiene', farm.hygiene);
    P.f('uMold', farm.mold);
    GLX.depth(true, true);
    GLX.blend(false);
    //  The raymarch is driven by the bounding box. Standing inside it, the
    //  front faces are behind the eye, so back-face culling would draw
    //  nothing at all and the tank would vanish. Flip to front-culling and
    //  march from the inside instead.
    var inside =
      Math.abs(cam.pos[0] - farm.center[0]) < farm.half[0] + 0.05 &&
      Math.abs(cam.pos[1] - farm.center[1]) < farm.half[1] + 0.05 &&
      Math.abs(cam.pos[2] - farm.center[2]) < farm.half[2] + 0.05;
    GLX.cull(inside ? 'front' : 'back');
    R.boxMesh.draw();
    R.stats.draws++;
  };

  R.useCreature = function (env, cam, isAnt) {
    var P = R.P.creature;
    P.use();
    bindEnv(P, env, cam);
    bindShadow(P);
    P.m4('uVP', cam.vp);
    P.f('uTime', env.time);
    //  0 = brood, 1 = bestiary creature, 2 = a real ant. The split matters
    //  because the tagma tint below is an ANT colour pattern; applied to a
    //  beetle or a woodlouse it would re-tune bodies that are already tuned.
    P.f('uIsAnt', isAnt ? 2 : 0);
    GLX.depth(true, true);
    GLX.blend(false);
    GLX.cull('back');
    return P;
  };
  R.useFlora = function (env, cam) {
    var P = R.P.flora;
    P.use();
    bindEnv(P, env, cam);
    bindShadow(P);
    P.m4('uVP', cam.vp);
    P.f('uTime', env.time);
    GLX.depth(true, true);
    GLX.blend(false);
    GLX.cull(false);
    return P;
  };
  R.drawStatic = function (env, cam, mesh, model, albedo, rough, metal, matType) {
    var P = R.P.staticM;
    P.use();
    bindEnv(P, env, cam);
    bindShadow(P);
    P.m4('uVP', cam.vp);
    P.m4('uModel', model);
    P.v3('uAlbedo', albedo);
    P.f('uRough', rough);
    P.f('uMetal', metal);
    P.f('uMatType', matType || 0);
    P.f('uTime', env.time);
    GLX.depth(true, true);
    GLX.blend(false);
    GLX.cull('back');
    mesh.draw();
    R.stats.draws++;
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

  R.drawDecals = function (env, cam) {
    if (R.B.decal.n === 0) return;
    var P = R.P.decal;
    P.use();
    P.m4('uVP', cam.vp);
    P.f('uTime', env.time);
    GLX.depth(true, false);
    GLX.blend('addpre');
    GLX.cull(false);
    R.colorOnly();
    R.B.decal.upload();
    R.B.decal.draw();
    R.restoreMRT();
  };

  //  Build previews ignore depth. A silhouette of a room you have not dug yet
  //  is by definition buried in solid soil, so depth-testing it hides the one
  //  thing the player needs to see before committing.
  R.drawGhost = function (env, cam) {
    if (R.B.ghost.n === 0) return;
    var P = R.P.decal;
    P.use();
    P.m4('uVP', cam.vp);
    P.f('uTime', env.time);
    GLX.depth(false, false);
    GLX.blend('addpre');
    GLX.cull(false);
    R.colorOnly();
    R.B.ghost.upload();
    R.B.ghost.draw();
    R.restoreMRT();
    GLX.depth(true, false);
  };

  R.drawTransparents = function (env, cam) {
    var right = v3.create(cam.view[0], cam.view[4], cam.view[8]);
    var up = v3.create(cam.view[1], cam.view[5], cam.view[9]);
    GLX.depth(true, false);
    GLX.blend('addpre');
    GLX.cull(false);
    R.colorOnly();
    var P;
    if (R.B.phero.n > 0) {
      P = R.P.phero;
      P.use();
      P.m4('uVP', cam.vp);
      P.v3('uRight', right);
      P.v3('uUp', up);
      P.f('uTime', env.time);
      R.B.phero.upload();
      R.B.phero.draw();
    }
    if (R.B.particle.n > 0) {
      P = R.P.particle;
      P.use();
      P.m4('uVP', cam.vp);
      P.v3('uRight', right);
      P.v3('uUp', up);
      P.f('uTime', env.time);
      R.B.particle.upload();
      R.B.particle.draw();
    }
    R.restoreMRT();
  };

  R.copyScene = function () {
    R.copyFB.bind(false);
    GLX.depth(false, false);
    GLX.blend(false);
    var P = R.P.copy;
    P.use();
    P.tex('uTex', R.sceneFB.color[0]);
    GLX.fullscreen();
    R.sceneFB.bind(false);
  };

  R.useGlass = function (env, cam) {
    var P = R.P.glass;
    P.use();
    bindEnv(P, env, cam);
    P.m4('uVP', cam.vp);
    P.tex('uScene', R.copyFB.color[0]);
    P.v2('uRes', R.width, R.height);
    P.f('uTime', env.time);
    GLX.depth(true, false);
    GLX.blend('premul');
    GLX.cull(false);
    return P;
  };

  //  Water WRITES DEPTH. That is not a detail: the ink outline in the post
  //  chain is a Sobel over depth + normals, so with depth-write off - which
  //  is what this pass used to do - water could never receive an outline at
  //  all. In a game drawn in ink that is most of "the water looks wrong".
  R.drawLiquids = function (env, cam) {
    if (R.B.droplet.n === 0 && R.B.puddle.n === 0) return;
    var P = R.P.liquid;
    P.use();
    bindEnv(P, env, cam);
    P.m4('uVP', cam.vp);
    P.tex('uScene', R.copyFB.color[0]);
    P.v2('uRes', R.width, R.height);
    P.f('uTime', env.time);
    GLX.cull(false);
    GLX.depth(true, false);
    GLX.blend('premul');
    R.B.droplet.upload();
    R.B.droplet.draw();
    R.B.puddle.upload();
    R.B.puddle.draw();
  };

  //  Damp soil under a pool. This is a MULTIPLY pass: an additive one cannot
  //  darken anything, which is why the previous attempt at a "dark ring"
  //  rendered as bright arcs around every puddle.
  R.drawWet = function (env, cam) {
    if (R.B.wet.n === 0) return;
    var P = R.P.wet;
    P.use();
    P.m4('uVP', cam.vp);
    P.f('uTime', env.time);
    GLX.depth(true, false);
    GLX.blend('multalpha');
    GLX.cull(false);
    R.colorOnly();
    R.B.wet.upload();
    R.B.wet.draw();
    R.restoreMRT();
    GLX.blend('premul');
  };

  // ==================================================================
  //  POST CHAIN
  // ==================================================================
  R.post = function (env, cam, fx) {
    var P, i;
    GLX.depth(false, false);
    GLX.blend(false);
    GLX.cull(false);

    if (fx.ao > 0.001) {
      R.aoFB.bind(false);
      P = R.P.ssao; P.use();
      P.tex('uDepth', R.sceneFB.depthTex);
      P.tex('uNormal', R.sceneFB.color[1]);
      P.m4('uInvProj', cam.invProj);
      P.m4('uProj', cam.proj);
      P.m4('uView', cam.view);
      P.v2('uRes', R.aoFB.width, R.aoFB.height);
      P.f('uRadius', fx.aoRadius);
      P.f('uStrength', fx.aoStrength);
      P.f('uTime', env.time);
      GLX.fullscreen();
      P = R.P.blur;
      R.aoFB2.bind(false);
      P.use();
      P.tex('uTex', R.aoFB.color[0]);
      P.tex('uDepth', R.sceneFB.depthTex);
      P.v2('uDir', 1, 0);
      P.v2('uTexel', 1 / R.aoFB.width, 1 / R.aoFB.height);
      GLX.fullscreen();
      R.aoFB.bind(false);
      P.use();
      P.tex('uTex', R.aoFB2.color[0]);
      P.tex('uDepth', R.sceneFB.depthTex);
      P.v2('uDir', 0, 1);
      P.v2('uTexel', 1 / R.aoFB.width, 1 / R.aoFB.height);
      GLX.fullscreen();
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
    } else {
      R.bloom[0].bind(false);
      P = R.P.bright; P.use();
      P.tex('uTex', R.sceneFB.color[0]);
      P.f('uThreshold', fx.bloomThreshold);
      P.f('uSoft', 0.7);
      GLX.fullscreen();
      P = R.P.down;
      for (i = 1; i < R.bloom.length; i++) {
        R.bloom[i].bind(false);
        P.use();
        P.tex('uTex', R.bloom[i - 1].color[0]);
        P.v2('uTexel', 1 / R.bloom[i - 1].width, 1 / R.bloom[i - 1].height);
        GLX.fullscreen();
      }
      R.bloomUp[last].bind(false);
      P = R.P.copy; P.use();
      P.tex('uTex', R.bloom[last].color[0]);
      GLX.fullscreen();
      P = R.P.up;
      for (i = last - 1; i >= 0; i--) {
        R.bloomUp[i].bind(false);
        P.use();
        P.tex('uTex', R.bloomUp[i + 1].color[0]);
        P.tex('uPrev', R.bloom[i].color[0]);
        P.v2('uTexel', 1 / R.bloomUp[i + 1].width, 1 / R.bloomUp[i + 1].height);
        P.f('uScatter', fx.bloomScatter);
        GLX.fullscreen();
      }
    }

    // dof
    if (fx.dof > 0.001) {
      R.dofA.bind(false);
      P = R.P.coc; P.use();
      P.tex('uColor', R.sceneFB.color[0]);
      P.tex('uDepth', R.sceneFB.depthTex);
      P.f('uNear', cam.near); P.f('uFar', cam.far);
      P.f('uFocus', fx.focus);
      P.f('uAperture', fx.aperture);
      P.f('uMaxCoC', fx.maxCoC);
      GLX.fullscreen();
      R.dofB.bind(false);
      P = R.P.dof; P.use();
      P.tex('uTex', R.dofA.color[0]);
      P.v2('uTexel', 1 / R.dofA.width, 1 / R.dofA.height);
      P.f('uMaxCoC', fx.maxCoC);
      GLX.fullscreen();
    } else {
      R.dofB.bind(true, 0, 0, 0, 0);
    }

    // god rays
    if (fx.rays > 0.001 && fx.sunOnScreen) {
      R.raysFB.bind(false);
      P = R.P.copy; P.use();
      P.tex('uTex', (R.T3bloom ? AF.T3.raw(R.T3bloom.down[1]) : R.bloom[1].color[0]));
      GLX.fullscreen();
      R.raysFB2.bind(false);
      P = R.P.godray; P.use();
      P.tex('uTex', R.raysFB.color[0]);
      P.v2('uSunUV', fx.sunUV[0], fx.sunUV[1]);
      P.f('uDecay', 0.965);
      P.f('uDensity', 0.72);
      P.f('uWeight', 0.11);
      P.f('uExposure', 0.30);
      GLX.fullscreen();
    } else {
      R.raysFB2.bind(true, 0, 0, 0, 1);
    }

    // composite
    R.compFB.bind(false);
    P = R.P.comp; P.use();
    P.tex('uColor', R.sceneFB.color[0]);
    P.tex('uBloom', R.T3bloom ? AF.T3.raw(R.T3bloom.up[0]) : R.bloomUp[0].color[0]);
    P.tex('uAO', R.aoFB.color[0]);
    P.tex('uDOF', R.dofB.color[0]);
    P.tex('uRays', R.raysFB2.color[0]);
    P.tex('uDepth', R.sceneFB.depthTex);
    P.v2('uRes', R.width, R.height);
    P.f('uTime', env.time);
    P.f('uBloomAmt', fx.bloom);
    P.f('uAOAmt', fx.ao);
    P.f('uExposure', fx.exposure);
    P.f('uVignette', fx.vignette);
    P.f('uGrain', fx.grain);
    P.f('uCA', fx.ca);
    P.f('uSat', fx.saturation);
    P.f('uContrast', fx.contrast);
    P.v3('uLift', fx.lift);
    P.v3('uGain', fx.gain);
    P.f('uRaysAmt', fx.rays);
    P.f('uDofAmt', fx.dof);
    P.f('uFlash', fx.flash);
    P.v3('uFlashCol', fx.flashCol);
    P.tex('uNormalTex', R.sceneFB.color[1]);
    P.f('uOutline', fx.outline === undefined ? 0.85 : fx.outline);
    P.f('uPaper', fx.paper === undefined ? 0.02 : fx.paper);
    P.f('uNear', cam.near);
    P.f('uFar', cam.far);
    GLX.fullscreen();

    GLX.bindScreen(R.width, R.height);
    P = R.P.fxaa; P.use();
    P.tex('uTex', R.compFB.color[0]);
    P.v2('uTexel', 1 / R.width, 1 / R.height);
    P.f('uSharp', fx.sharpen);
    GLX.fullscreen();
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

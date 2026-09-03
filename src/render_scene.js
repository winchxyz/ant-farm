/* =============================================================
   FORMICARIUM :: DEEP COLONY
   render_scene.js - build the frame: cull, instance, draw
   ============================================================= */
(function (AF) {
  'use strict';

  var M = AF.M, v3 = M.v3, m4 = M.m4;
  var W = AF.W, A = AF.A, R = AF.R, G = AF.G;
  var Game = AF.Game;

  // ------------------------------------------------------------------
  //  static world geometry
  // ------------------------------------------------------------------
  //  Height of the table legs, and therefore where the room floor has to be.
  //  Both the geometry and the draw code need it, so it lives up here.
  var TABLE_LEG_H = 15.0;

  Game.buildStatics = function () {
    var P = R.P.staticM;
    var world = this.world;
    var f0 = world.farms[0];
    this.st = {};
    this.st.room = G.buildBox(160, 90, 120, true).build(P, null);
    this.st.frame = G.buildFrame(f0.half[0] + 0.32, f0.half[1] + 0.32, f0.half[2] + 0.32, 0.34).build(P, null);
    //  The panes must sit OUTSIDE the soil volume. Built flush with it they
    //  are exactly coplanar with the raymarched soil surface, and the two
    //  z-fight across the whole face of the tank - which is the constant
    //  shimmer. Real glass has thickness anyway.
    this.st.glass = G.buildGlassBox(f0.half[0] + 0.10, f0.half[1] + 0.10, f0.half[2] + 0.10)
      .build(R.P.glass, null);
    // one plain table slab under the tank - no shelf, no legs
    this.st.table = G.buildBox(f0.half[0] + 3.0, 0.7, f0.half[2] + 2.4, false).build(P, null);
    //  ...and something to stand the table ON. Without legs the whole
    //  assembly hung in mid-air over a floor 37 units below it.
    this.st.tableLeg = G.buildBox(0.85, TABLE_LEG_H * 0.5, 0.85, false).build(P, null);
    this.st.tube = G.buildTube(14, 12).build(R.P.glass, null);
    this.st.model = m4.create();
  };

  // ------------------------------------------------------------------
  //  frustum
  // ------------------------------------------------------------------
  var planes = new Float32Array(24);
  function extractFrustum(vp) {
    for (var i = 0; i < 6; i++) {
      var s = (i % 2) ? -1 : 1;
      var r = Math.floor(i / 2);
      var o = i * 4;
      planes[o] = vp[3] + s * vp[r];
      planes[o + 1] = vp[7] + s * vp[4 + r];
      planes[o + 2] = vp[11] + s * vp[8 + r];
      planes[o + 3] = vp[15] + s * vp[12 + r];
      var l = Math.sqrt(planes[o] * planes[o] + planes[o + 1] * planes[o + 1] + planes[o + 2] * planes[o + 2]) || 1;
      planes[o] /= l; planes[o + 1] /= l; planes[o + 2] /= l; planes[o + 3] /= l;
    }
  }
  function boxVisible(c, h) {
    for (var i = 0; i < 6; i++) {
      var o = i * 4;
      var d = planes[o] * c[0] + planes[o + 1] * c[1] + planes[o + 2] * c[2] + planes[o + 3];
      var r = Math.abs(planes[o]) * h[0] + Math.abs(planes[o + 1]) * h[1] + Math.abs(planes[o + 2]) * h[2];
      if (d + r < 0) return false;
    }
    return true;
  }
  function sphereVisible(p, r) {
    for (var i = 0; i < 6; i++) {
      var o = i * 4;
      if (planes[o] * p[0] + planes[o + 1] * p[1] + planes[o + 2] * p[2] + planes[o + 3] + r < 0) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------
  //  caste colours
  // ------------------------------------------------------------------
  var CT = [];
  function casteTint(col, caste, out) {
    var c = col.color, a = col.accent;
    var k;
    switch (caste) {
      case A.C.SOLDIER: k = 0.16; break;
      case A.C.MAJOR: k = 0.30; break;
      case A.C.FORAGER: k = 0.34; break;
      case A.C.NURSE: k = 0.46; break;
      case A.C.CLEANER: k = 0.10; break;
      case A.C.SCOUT: k = 0.40; break;
      case A.C.QUEEN: k = 0.55; break;
      case A.C.ALATE: k = 0.62; break;
      default: k = 0.0;
    }
    var dark = caste === A.C.SOLDIER || caste === A.C.MAJOR ? 0.78 : 1.0;
    out[0] = M.lerp(c[0], a[0], k) * dark;
    out[1] = M.lerp(c[1], a[1], k) * dark;
    out[2] = M.lerp(c[2], a[2], k) * dark;
    return out;
  }
  var _tint = [0, 0, 0];

  // ------------------------------------------------------------------
  //  MAIN RENDER
  // ------------------------------------------------------------------
  Game.render = function () {
    var i, k;
    var cam = this.cam, env = this.env, B = R.B;
    R.frameStart();
    extractFrustum(cam.vp);

    // ---- which farms matter this frame ----
    var vis = [];
    for (i = 0; i < this.world.farms.length; i++) {
      var f = this.world.farms[i];
      if (boxVisible(f.center, f.half)) vis.push(f);
    }
    this.visibleFarms = vis;

    // ---- lights ----
    R.clearLights();
    var lights = [];
    for (i = 0; i < vis.length; i++) {
      var farm = vis[i];
      for (k = 0; k < farm.nodes.length; k++) {
        var n = farm.nodes[k];
        if (n.build < 0.5) continue;
        var def = W.CHAMBERS[n.type];
        if (!def.light) continue;
        lights.push({ n: n, def: def, d: v3.dist2(cam.pos, n.pos) });
      }
    }
    lights.sort(function (a, b) { return a.d - b.d; });
    var pulse = 0.86 + 0.14 * Math.sin(this.time * 1.7);
    for (i = 0; i < lights.length && i < 13; i++) {
      var L = lights[i];
      R.addLight(L.n.pos[0], L.n.pos[1] + L.def.radius * 0.35, L.n.pos[2] - 0.4,
        L.def.radius * 4.4, L.def.glow[0], L.def.glow[1], L.def.glow[2],
        L.def.light * 1.45 * pulse);
    }
    // warm key fill above the shelf
    R.addLight(0, this.world.shelfHeight + 24, 26, 190, 1.0, 0.88, 0.70, 1.35);

    // ---- props ----
    for (i = 0; i < vis.length; i++) this.pushProps(vis[i], cam);
    // ---- items ----
    this.pushItems(cam);
    // ---- ants ----
    this.pushAnts(cam);
    // ---- brood ----
    this.pushBrood(cam);
    // ---- corpses ----
    this.pushCorpses(cam);
    // ---- creatures ----
    for (i = 0; i < this.predators.length; i++) {
      var p = this.predators[i];
      if (p.dead) continue;
      var pd = p.def || (Game.BESTIARY && Game.BESTIARY.spider);
      var bat = B[pd && pd.mesh ? pd.mesh : 'spider'] || B.spider;
      //  A woodlouse pulls its plates in when threatened, so squash it a
      //  little and let the shell close over the legs.
      var cu = p.curl || 0;
      bat.push(p.pos[0], p.pos[1], p.pos[2], (pd ? pd.scale : 0.62) * (1 - cu * 0.14),
        p.yaw, 0, 0, p.phase,
        1, 0, 0, 0,
        pd.col[0], pd.col[1], pd.col[2], 0.42,
        1, 0, 0, 0);
    }
    // ---- pheromones, decals, particles ----
    this.pushPheromones(cam);
    this.pushDecals(cam);
    this.pushParticles(cam);
    this.pushWet(cam);
    this.pushPourGhost();
    this.pushDigGhost();
    this.pushSpawnGhost();
    this.pushBreaches();
    this.fx.sys.push(B.particle);

    // ---- upload the instanced buffers used by two passes ----
    var antBatches = ['ant', 'antMid', 'antLow', 'soldier', 'soldierMid', 'queen', 'alate', 'brood', 'spider',
      'woodlouse', 'cricket', 'beetle', 'centipede'];
    var propBatches = ['crystal', 'seed', 'aphid', 'pebble', 'pebbleSm', 'twig', 'sugar'];
    var floraBatches = ['grass', 'grass2', 'leaf', 'mushroom'];
    for (i = 0; i < antBatches.length; i++) B[antBatches[i]].upload();
    for (i = 0; i < propBatches.length; i++) B[propBatches[i]].upload();
    for (i = 0; i < floraBatches.length; i++) B[floraBatches[i]].upload();

    // ================= SHADOW =================
    var focus = this.activeFarm ? this.activeFarm.center : [0, 8, 0];
    var srad = this.rig.dist > 62 ? this.world.shelfWidth * 0.78 : 26;
    R.shadowPass(env, focus, srad, function () {
      for (var q = 0; q < antBatches.length; q++) B[antBatches[q]].draw();
      for (q = 0; q < propBatches.length; q++) B[propBatches[q]].draw();
      for (q = 0; q < floraBatches.length; q++) B[floraBatches[q]].draw();
    });

    // ================= SCENE =================
    R.beginScene(env, cam);

    //  Everything stacks off one number: the tank's lowest point is its
    //  bottom frame rail, the table meets that, the legs hang off the table,
    //  and the room floor meets the legs. Get any link wrong and the whole
    //  assembly floats.
    var f0 = this.world.farms[0];
    var frameBottom = f0.half[1] + 0.32 + 0.34;   // distance below centre
    var tableCentreY = -(frameBottom + 0.7) + 0.02;
    var tableBottomY = tableCentreY - 0.7;
    var floorY = tableBottomY - TABLE_LEG_H;

    // room: 90 is its half-height, so shift it so the floor lands on floorY
    m4.identity(this.st.model);
    m4.translate(this.st.model, this.st.model, [0, floorY + 90, -10]);
    R.drawStatic(env, cam, this.st.room, this.st.model, [0.115, 0.118, 0.132], 0.92, 0, 3);

    // table top
    m4.identity(this.st.model);
    m4.translate(this.st.model, this.st.model, [0, tableCentreY, 0]);
    R.drawStatic(env, cam, this.st.table, this.st.model, [0.30, 0.225, 0.155], 0.80, 0, 1);

    // four legs, inset from the corners, reaching the floor exactly
    var lx = f0.half[0] + 3.0 - 1.6, lz = f0.half[2] + 2.4 - 1.6;
    for (var sx = -1; sx <= 1; sx += 2) {
      for (var sz = -1; sz <= 1; sz += 2) {
        m4.identity(this.st.model);
        m4.translate(this.st.model, this.st.model,
          [sx * lx, tableBottomY - TABLE_LEG_H * 0.5, sz * lz]);
        R.drawStatic(env, cam, this.st.tableLeg, this.st.model, [0.255, 0.185, 0.125], 0.82, 0, 1);
      }
    }

    // soil volumes
    for (i = 0; i < vis.length; i++) R.drawSoil(env, cam, vis[i]);

    // vitrine frames
    for (i = 0; i < vis.length; i++) {
      m4.identity(this.st.model);
      m4.translate(this.st.model, this.st.model, vis[i].center);
      var owner = this.colonyOf(vis[i].owner);
      var fc = owner ? [owner.color[0] * 0.5 + 0.06, owner.color[1] * 0.5 + 0.05, owner.color[2] * 0.5 + 0.05] : [0.14, 0.145, 0.155];
      R.drawStatic(env, cam, this.st.frame, this.st.model, fc, 0.42, 0.75, 2);
    }

    // creatures
    var P = R.useCreature(env, cam, true);
    B.ant.draw(); B.antMid.draw(); B.antLow.draw();
    B.soldier.draw(); B.soldierMid.draw();
    B.queen.draw(); B.alate.draw(); B.spider.draw();
    //  The bestiary. This list is separate from antBatches above, which
    //  only uploads and casts shadows - a batch missing from HERE is
    //  simulated, uploaded, and shadowed, but never actually drawn.
    //  The bestiary keeps the chitin detail but not the ant tagma pattern.
    P.f('uIsAnt', 1);
    B.woodlouse.draw(); B.cricket.draw(); B.beetle.draw(); B.centipede.draw();
    P.f('uIsAnt', 0);
    B.brood.draw();
    //  MIGRATION STAGE 5, group 1. The props draw through three from here;
    //  ants, the bestiary and brood are still raw above. Both write the same
    //  MRT pair with the same depth state, so they interleave in one pass.
    var propMat = R.propMaterial ? R.propMaterial(env, cam) : null;
    if (propMat) {
      for (i = 0; i < propBatches.length; i++) B[propBatches[i]].drawThree(propMat);
    } else {
      for (i = 0; i < propBatches.length; i++) B[propBatches[i]].draw();
    }

    // flora
    var floraMat = R.floraMaterial ? R.floraMaterial(env, cam) : null;
    if (floraMat) {
      for (i = 0; i < floraBatches.length; i++) B[floraBatches[i]].drawThree(floraMat);
    } else {
      R.useFlora(env, cam);
      for (i = 0; i < floraBatches.length; i++) B[floraBatches[i]].draw();
    }

    // the sugar heap: one mesh, one silhouette, one ink outline
    if (AF.HeapR) { AF.HeapR.sync(); AF.HeapR.draw(R, env, cam); }

    // damp soil under the pools, multiplied into the ground BEFORE the
    // additive decals so cursor highlights stay bright on top of it
    R.drawWet(env, cam);

    // ground decals + additive volumetrics
    R.drawDecals(env, cam);
    R.drawGhost(env, cam);   // build preview, drawn through the soil
    R.drawTransparents(env, cam);

    // glass needs a copy of what is behind it
    R.copyScene();
    var GP = R.useGlass(env, cam);
    if (!this.hideGlass) {
      for (i = 0; i < vis.length; i++) {
        m4.identity(this.st.model);
        m4.translate(this.st.model, this.st.model, vis[i].center);
        GP.m4('uModel', this.st.model);
        GP.f('uTint', 0.55);
        GP.v3('uGlassCol', vis[i].biome.glass);
        this.st.glass.draw();
        R.stats.draws++;
      }
    }
    this.drawTubes(env, cam, GP);
    R.drawLiquids(env, cam);

    //  Screen-space water. It has to come after copyScene so it can refract
    //  the scene behind it, and it writes depth + normals so the ink pass
    //  outlines the pool.
    if (AF.WR) AF.WR.draw(R, env, cam);

    // ---- post ----
    this.updateFxParams();
    R.post(env, cam, this.fxSettings);
  };

  Game.colonyOf = function (id) {
    if (id === undefined || id < 0) return null;
    for (var i = 0; i < this.colonies.length; i++) if (this.colonies[i].id === id) return this.colonies[i];
    return null;
  };

  // ------------------------------------------------------------------
  //  connection tubes between vitrines
  // ------------------------------------------------------------------
  Game.drawTubes = function (env, cam, GP) {
    var mdl = m4.create();
    for (var i = 0; i < this.world.links.length; i++) {
      var L = this.world.links[i];
      var a = L.pa.pos, b = L.pb.pos;
      var t = Math.max(0.06, L.edge.build);
      var bx = a[0] + (b[0] - a[0]) * t, by = a[1] + (b[1] - a[1]) * t, bz = a[2] + (b[2] - a[2]) * t;
      var dx = bx - a[0], dy = by - a[1], dz = bz - a[2];
      var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
      // basis with Z along the tube
      var zx = dx / len, zy = dy / len, zz = dz / len;
      var ux = 0, uy = 1, uz = 0;
      if (Math.abs(zy) > 0.95) { ux = 1; uy = 0; }
      var xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
      var xl = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1;
      xx /= xl; xy /= xl; xz /= xl;
      var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      var rad = 0.85;
      mdl[0] = xx * rad; mdl[1] = xy * rad; mdl[2] = xz * rad; mdl[3] = 0;
      mdl[4] = yx * rad; mdl[5] = yy * rad; mdl[6] = yz * rad; mdl[7] = 0;
      mdl[8] = zx * len; mdl[9] = zy * len; mdl[10] = zz * len; mdl[11] = 0;
      mdl[12] = a[0]; mdl[13] = a[1]; mdl[14] = a[2]; mdl[15] = 1;
      GP.m4('uModel', mdl);
      GP.f('uTint', 0.35);
      GP.v3('uGlassCol', L.edge.build >= 1 ? [0.72, 0.92, 0.86] : [0.95, 0.62, 0.35]);
      this.st.tube.draw();
      R.stats.draws++;
    }
  };

  // ------------------------------------------------------------------
  //  instancing helpers
  // ------------------------------------------------------------------
  Game.pushProps = function (farm, cam) {
    var B = R.B;
    var camDist2 = v3.dist2(cam.pos, farm.center);
    var far = camDist2 > 90 * 90;
    var tint = farm.biome.soilTop;
    var PD = Game.PROP_DRAW;
    for (var i = 0; i < farm.props.length; i++) {
      var p = farm.props[i];
      var d2 = (p.x - cam.pos[0]) * (p.x - cam.pos[0]) + (p.z - cam.pos[2]) * (p.z - cam.pos[2]);
      if (far && (i % 3)) continue;
      if (d2 > 8000) continue;
      //  Instance scale and lift come out of Game.PROP_DRAW, which is the
      //  same table Game.propBlockR reads to decide how solid the thing is.
      //  These used to be loose magic numbers here - 0.55 for a pebble, 1.0
      //  for a bigrock, 0.7 for a twig - against a single 0.62*prop.scale in
      //  the collision code, and the gap between them is why animals walked
      //  through the big stones for three releases. Change how a prop is
      //  drawn by editing the table and the collision changes with it.
      //
      //  (The LOD culls two lines up are a genuine remaining divergence:
      //  past 89 units two thirds of the props are not drawn but are still
      //  solid. At that zoom the tank is a thumbnail, so it is left alone.)
      var S = PD[p.kind];
      if (!S) continue;
      var sc = p.scale * S.s;
      var py = p.y + p.scale * S.yMul + S.yAdd;
      var g = 0;
      switch (p.kind) {
        case 'grass':
          // hue rides in the `variant` slot so the shader can de-correlate
          // veins, scorch and sway per blade
          (i % 2 ? B.grass2 : B.grass).push(p.x, py, p.z, sc,
            p.rot, 0, 0, 0, 0, 0, 0, p.hue,
            0.185 + p.hue * 0.170, 0.430 + p.hue * 0.320, 0.105 + p.hue * 0.090, 0.42,
            1, 0, 0, 0);
          break;
        case 'leaf':
          B.leaf.push(p.x, py, p.z, sc,
            p.rot, p.tilt, 0, 0, 0, 0, 0, p.hue,
            0.255 + p.hue * 0.280, 0.395 + p.hue * 0.270, 0.115 + p.hue * 0.060, 0.38,
            1, 0, 0, 0);
          break;
        case 'mushroom':
          g = farm.biome.humid > 0.6 ? 0.28 : 0.05;
          B.mushroom.push(p.x, py, p.z, sc,
            p.rot, 0, 0, 0, 0, 0, 0, p.hue,
            0.40 + p.hue * 0.24, 0.33 + p.hue * 0.17, 0.27 + p.hue * 0.19, 0.62,
            1, 0, g, 0);
          break;
        case 'pebble':
          B.pebbleSm.push(p.x, py, p.z, sc,
            p.rot, p.tilt, 0, 0, 0, 0, 0, 0,
            tint[0] * (0.7 + p.hue * 0.8), tint[1] * (0.7 + p.hue * 0.8), tint[2] * (0.7 + p.hue * 0.8), 0.68,
            1, 0, 0, 0);
          break;
        case 'bigrock':
          B.pebble.push(p.x, py, p.z, sc,
            p.rot, p.tilt * 0.4, 0, 0, 0, 0, 0, 0,
            tint[0] * 0.85, tint[1] * 0.85, tint[2] * 0.88, 0.74,
            1, 0, 0, 0);
          break;
        case 'twig':
          B.twig.push(p.x, py, p.z, sc,
            p.rot, 0, 0, 0, 0, 0, 0, 0,
            0.16, 0.11, 0.065, 0.80,
            1, 0, 0, 0);
          break;
      }
    }
  };

  Game.pushItems = function (cam) {
    var B = R.B;
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i];
      if (it.dead) continue;
      //  A cluster entry exists only so the foraging code has something to
      //  aim at; the material itself is already drawn as particles. Without
      //  this the pile renders twice - once real, once as a legacy prop
      //  floating in the middle of it.
      if (it.hidden) continue;
      if (!sphereVisible(it.pos, 1.2)) continue;
      if (it.falling) {
        var gy = it.farm.localTop(it.pos[0], it.pos[2]);
        it.pos[1] -= 0.35;
        if (it.pos[1] <= gy) { it.pos[1] = gy; it.falling = false; this.fx.burst(it.pos, 6, 'dirt', it.farm.soilTop); }
      }
      var def = Game.ITEMS[it.visual] || Game.ITEMS.sugar;
      var bobY = Math.sin(it.bob) * 0.02;
      var amt = M.clamp(it.amount / 40, 0.35, 1.3);
      //  A carcass is drawn with the creature's own mesh, so the player can
      //  see WHAT the ants are taking apart. It sinks and shrinks as the
      //  colony carries it away piece by piece.
      if (it.visual === 'carcass' && it.carcass) {
        var cb = B[it.carcass.mesh];
        if (cb) {
          var left = M.clamp(it.amount / (it.maxAmount || it.carcass.meat), 0.12, 1);
          //  DEATH POSE. It used to go down with roll 0 and walk 1 - upright on
          //  planted legs, mid-stride - so a dead spider read as a live one
          //  standing still and a dead woodlouse lay flat with its antennae
          //  out. Each species now records how it ends up (creatures.js), and
          //  walk drops to 0 so nothing holds a walking stance.
          var dth = it.carcass.death || { roll: Math.PI * 0.5, pitch: 0.1, curl: 0, hy: 0.2 };
          //  Roll happens about the origin, which sits on the ground, so an
          //  animal tipped over swings its body DOWN through the terrain -
          //  first attempt buried the spider and left its legs standing out of
          //  the sand. A point at height h lands at h*cos(roll), so lifting by
          //  h*(1 - cos roll) puts it back and rests the body on the surface.
          var lift = (dth.hy || 0.2) * it.carcass.scale * (1 - Math.cos(dth.roll || 0));
          //  A woodlouse dies balled up. Curl is a scale squash, the same knob
          //  the living animal uses when it pulls its plates in.
          var csq = 1 - (dth.curl || 0) * 0.14;
          //  Rot tracks how far the colony has stripped it, since an item has
          //  no age of its own - a half-eaten carcass is visibly further gone.
          var crot = M.clamp((1 - left) * 0.6, 0, 1);
          //  hp 0.25, NOT 1. That is what turns on the shader's death dimming
          //  (albedo *= mix(0.42, 1.0, health), shaders.js), which is why the
          //  hand-rolled 0.62 multiplier is gone: stacking both on top of
          //  deadTint would bury the spider, already the darkest animal in the
          //  tank and deliberately lightened once so the ink pass would not
          //  swallow its creases. Shader dimming alone lands at 0.565, near
          //  the old 0.62, and the colour drain does the "dead" reading.
          deadTint(it.carcass.col, crot, _dead);
          cb.push(it.pos[0], it.pos[1] + lift - (1 - left) * 0.16, it.pos[2],
            it.carcass.scale * (0.45 + 0.55 * left) * csq,
            it.yaw || 0, dth.pitch || 0, dth.roll || 0, 0,
            0, 0, 0, 0,
            _dead[0], _dead[1], _dead[2], 0.60,
            0.25, 0, 0, 0);
        }
        continue;
      }
      switch (def.mesh) {
        case 'crystal':
          //  Tumble each grain. Upright identical prisms read as little white
          //  tombstones; tipped over at random they read as spilled sugar.
          //  Sugar is a scatter of hard little crystals, so each grain gets a
          //  different size and a full random tumble, and a low roughness so
          //  it actually catches a highlight instead of reading as chalk.
          var tw = (it.rot || 0);
          var gsz = it.poured ? (0.72 + ((tw * 7.13) % 1) * 0.72) : 1.0;
          B.crystal.push(it.pos[0], it.pos[1] + bobY, it.pos[2],
            0.42 * it.scale * amt * gsz,
            tw, Math.sin(tw * 3.1) * 1.4, Math.cos(tw * 2.3) * 1.4, 0, 0, 0, 0, 0,
            def.color[0], def.color[1], def.color[2], 0.04,
            1, 0, def.glow, 0);
          break;
        case 'seed':
          B.seed.push(it.pos[0], it.pos[1], it.pos[2], 0.42 * it.scale * amt,
            it.rot, 0.2, 0, 0, 0, 0, 0, 0,
            def.color[0], def.color[1], def.color[2], 0.55,
            1, 0, 0, 0);
          break;
        case 'aphid':
          B.aphid.push(it.pos[0], it.pos[1], it.pos[2], 0.55 * it.scale * amt,
            it.rot, 0, 0, 0, 0, 0, 0, 0,
            def.color[0], def.color[1], def.color[2], 0.45,
            1, 0, 0, 0);
          break;
        case 'droplet':
          //  Settled water is a puddle lying in the soil; only a loose drop
          //  that has not pooled yet keeps the bead shape.
          if (it.pooled) {
            var pgy = it.farm.localTop(it.pos[0], it.pos[2]);
            var pr = 0.55 * it.scale * (0.75 + amt * 0.75);
            //  No damp ring here: the decal pass is additive, so a "dark"
            //  ring came out as bright arcs around every puddle. Wet soil
            //  needs a multiply pass, which this pipeline does not have yet.
            B.puddle.push(it.pos[0], pgy + 0.03, it.pos[2], pr,
              it.rot, 0, 0, 0, 0, 0, 0, 0,
              def.color[0], def.color[1], def.color[2], 0.04,
              1, 0, 0, 0);
          } else {
            B.droplet.push(it.pos[0], it.pos[1] + bobY, it.pos[2], 0.40 * it.scale * amt,
              it.rot, 0, 0, 0, 0, 0, 0, 0,
              def.color[0], def.color[1], def.color[2], 0.05,
              1, 0, 0, 0);
          }
          break;
        case 'leaf':
          B.leaf.push(it.pos[0], it.pos[1] + 0.05, it.pos[2], 0.75 * it.scale,
            it.rot, 0.1, 0, 0, 0, 0, 0, (it.rot || 0) * 0.159,
            def.color[0], def.color[1], def.color[2], 0.40,
            1, 0, 0, 0);
          break;
      }
    }
  };

  // ------------------------------------------------------------------
  //  Poured material
  // ------------------------------------------------------------------
  //  Every particle the solver holds is drawn. There is no "settled" prop
  //  any more: the pile you see IS the pile the physics is holding up.
  var _pp = [0, 0, 0];
  Game.pushParticles = function (cam) {
    var PS = AF.PS;
    if (!PS) return;
    var B = R.B, n = PS.count();
    if (!n) return;
    var px = PS.px, py = PS.py, pz = PS.pz;
    var mat = PS.mat, alive = PS.alive, rad = PS.rad, wet = PS.wet;
    var nbrN = PS.nbrN, cid = PS.cid, cl = PS.clusters;
    var lim = PS.MAX_RESIDENT;
    for (var i = 0; i < lim; i++) {
      if (!alive[i]) continue;
      _pp[0] = px[i]; _pp[1] = py[i]; _pp[2] = pz[i];
      if (!sphereVisible(_pp, rad[i] + 0.3)) continue;
      if (mat[i] === PS.MAT_WATER) {
        //  vData.x - how buried this blob is, used by LIQUID_FS to flatten
        //  interior normals so the ink outline wraps the pool, not each bead.
        //  vData.y - real submergence in world units, for the depth tint.
        var packed = Math.min(1, nbrN[i] / 28);
        var c = cid[i] >= 0 ? cl[cid[i]] : null;
        //  How much water is UNDER this blob. Using the blob's own
        //  submergence tinted only the buried particles - and the ones
        //  you actually see are the surface ones, which then came out
        //  colourless. A pool has to darken with the column below it.
        var sub = c ? Math.max(0, py[i] - c.bottom) : 0.0;
        B.water.push(px[i], py[i], pz[i], rad[i],
          0, 0, 0, 0, 0, 0, 0, 0,
          0.42, 0.68, 0.95, 0.05,
          packed, sub, 0, 0);
      } else {
        //  Sugar is a height field now (src/heap.js); any sugar particle
        //  still resident is a leftover from an old save.
        //  THREE small crystals per particle, not one big one.
        //
        //  Drawing the collision radius directly gave every grain a 0.27-unit
        //  boulder with a full ink outline round it, and a poured heap read as
        //  a pile of gravel. Sugar is small and many; splitting each particle
        //  into a hashed little cluster costs nothing (the solver still sees
        //  one body) and is the difference between rubble and sugar.
        var w = wet[i];
        var cr = 1.0 - w * 0.10, cg = 0.995 - w * 0.13, cb = 0.965 - w * 0.16;
        var gloss = w > 0.5 ? 0.05 : 0.36;
        for (var s = 0; s < 2; s++) {
          var hs = ((i * 2654435761 + s * 40503) >>> 0) % 4096 / 4096;
          var h2 = ((i * 1597334677 + s * 22695) >>> 0) % 4096 / 4096;
          var h3 = ((i * 2246822519 + s * 3266489) >>> 0) % 4096 / 4096;
          var sp = rad[i] * 0.52;
          B.sugar.push(
            px[i] + (hs - 0.5) * sp,
            py[i] + (h2 - 0.5) * sp * 0.8,
            pz[i] + (h3 - 0.5) * sp,
            rad[i] * (0.42 + hs * 0.16),
            hs * 6.283, h2 * 6.283, h3 * 3.1, 0, 0, 0, 0, 0,
            cr, cg, cb, gloss,
            1, 0, w > 0.5 ? 0.20 : 0.02, 0);
        }
      }
    }
  };

  //  Damp soil under each pool - RETIRED, superseded by the wetness volume
  //  (AF.Wet in src/particles.js, sampled by SOIL_FS).
  //
  //  Three reasons this had to go rather than stay alongside it:
  //
  //  It is keyed off PS.clusters, which are rebuilt from ALIVE particles, so
  //  the damp ring vanished in the same step as the last drop - the exact
  //  moment the ground is supposed to look wet.
  //
  //  It is a flat quad at farm.localTop(), the analytic heightfield. Inside
  //  a dug Water Pit - the one chamber built for holding water - that puts
  //  the disc in mid-air at the old ground level, and on a tunnel wall it
  //  cannot appear at all.
  //
  //  And running both would double-darken. This quad is 35% wider than its
  //  cluster and the volume splats spread about a cell past the water edge,
  //  so the two overlap in a ring around every pool that would be multiplied
  //  by roughly 0.55 twice. The volume already covers the whole footprint,
  //  including the part under the water that the water hides anyway.
  //
  //  R.drawWet, S.WET_FS and the R.B.wet batch are left in place and cost
  //  nothing while the batch stays empty (drawWet returns on n === 0), so
  //  restoring the old behaviour is a matter of deleting the return below.
  Game.pushWet = function (cam) {
    return;
    /* eslint-disable no-unreachable */
    var PS = AF.PS;
    if (!PS || !PS.clusters) return;
    var B = R.B;
    for (var i = 0; i < PS.clusters.length; i++) {
      var c = PS.clusters[i];
      if (c.mat !== PS.MAT_WATER || c.n < 4) continue;
      var farm = this.player.farms[0] || this.activeFarm;
      if (!farm) continue;
      _pp[0] = c.cx; _pp[1] = c.cy; _pp[2] = c.cz;
      if (!sphereVisible(_pp, c.radius + 1.0)) continue;
      var gy = farm.localTop(c.cx, c.cz);
      B.wet.push(c.cx, gy + 0.02, c.cz, c.radius * 1.35,
        0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, Math.min(0.75, 0.25 + c.n * 0.012),
        0, 0, 0, 0);
    }
    /* eslint-enable no-unreachable */
  };

  // ------------------------------------------------------------------
  //  Aim preview - the contour that was missing entirely
  // ------------------------------------------------------------------
  //  Drawn as a ring of separate marks, each dropped onto the ground at its
  //  own height, rather than as one rigid disc. A disc floats through every
  //  hill; individual marks hug the terrain, follow the floor of a dug pit,
  //  and read as hand-drawn, which is the art direction.
  Game.pushPourGhost = function () {
    var g = this.pourGhost;
    if (!g || !this.pourType) return;
    var B = R.B, farm = this.player.farms[0] || this.activeFarm;
    if (!farm) return;
    var C = AF.SDFCache;
    var col = g.col || [1, 1, 1];
    var pulse = 0.72 + 0.28 * Math.sin(this.time * 4.0);

    //  contour: marks around the real footprint, each sitting on the ground
    var SEG = 30;
    for (var i = 0; i < SEG; i++) {
      var a = i / SEG * Math.PI * 2;
      var mx = g.impact[0] + Math.cos(a) * g.radius;
      var mz = g.impact[2] + Math.sin(a) * g.radius;
      //  drop onto whatever surface is actually there, pit floor included
      var my = farm.localTop(mx, mz);
      for (var s = 0; s < 14; s++) {
        if (C.sample(farm, mx, my, mz, null) < 0.02) break;
        my -= 0.18;
      }
      var dash = (i % 3) === 0 ? 0.35 : 1.0;
      B.ghost.push(mx, my + 0.05, mz, 0.115,
        0, 0, 0, 0, 0, 0, 0, 0,
        col[0], col[1], col[2], 0.95 * pulse * dash,
        2, 0, 0.5, 0);
    }
    //  soft fill so the footprint reads as an area, not just an edge
    B.ghost.push(g.impact[0], g.impact[1] + 0.03, g.impact[2], g.radius,
      0, 0, 0, 0, 0, 0, 0, 0,
      col[0], col[1], col[2], 0.16 * pulse,
      2, 0, 0.04, 0);

    //  THE INDICATOR STAYS UNDER THE CURSOR.
    //
    //  There used to be a second, equally bright ring drawn at the basin
    //  predictFlow said the water would run into, plus a dotted trail
    //  leading to it. On any sloped ground that fires constantly, so the
    //  marker the player is aiming with appeared to slide off sideways to
    //  somewhere they had not pointed at - reported, fairly, as the pour
    //  indicator drifting and being misleading.
    //
    //  A cursor is a promise about where the thing you are holding will
    //  land. Where the water runs afterwards is the water's business, and
    //  the player can watch it run. predictFlow is still called and g.dest
    //  is still set, so anything that wants the prediction can read it -
    //  nothing draws it as a rival cursor.
  };

  //  Shovel preview. Red when the scoop would break into the nest, so the
  //  player can see the consequence before they commit to it rather than
  //  finding out from a notification afterwards.
  Game.pushDigGhost = function () {
    var g = this.digGhost;
    if (!g || !this.digMode) return;
    var B = R.B, farm = this.player.farms[0] || this.activeFarm;
    if (!farm) return;
    var pulse = 0.70 + 0.30 * Math.sin(this.time * 4.2);
    var col = !g.afford ? [0.85, 0.30, 0.25]
      : (g.breach ? [0.95, 0.45, 0.20] : [0.95, 0.88, 0.62]);
    var SEG = 26;
    for (var i = 0; i < SEG; i++) {
      var a = i / SEG * Math.PI * 2;
      var mx = g.pos[0] + Math.cos(a) * g.radius;
      var mz = g.pos[2] + Math.sin(a) * g.radius;
      var my = farm.localTop(mx, mz);
      B.ghost.push(mx, my + 0.05, mz, 0.12,
        0, 0, 0, 0, 0, 0, 0, 0,
        col[0], col[1], col[2], 0.95 * pulse * ((i % 2) ? 1.0 : 0.45),
        2, 0, 0.5, 0);
    }
    B.ghost.push(g.pos[0], g.pos[1] + 0.03, g.pos[2], g.radius * 0.92,
      0, 0, 0, 0, 0, 0, 0, 0,
      col[0], col[1], col[2], 0.18 * pulse,
      2, 0, 0.04, 0);
  };

  //  Scoops the colony is actively filling back in get a working marker, so
  //  the repair is legible instead of the hole just quietly shrinking.
  Game.pushBreaches = function () {
    if (!this.scoops || !this.scoops.length) return;
    var B = R.B;
    for (var i = 0; i < this.scoops.length; i++) {
      var sc = this.scoops[i];
      if (!sc.breach || sc.workers <= 0) continue;
      var p = sc.node.pos;
      var t = this.time * 3.0 + i;
      B.ghost.push(p[0], p[1] + sc.node.radius * 0.6, p[2], 0.34 + 0.10 * Math.sin(t),
        0, 0, 0, 0, 0, 0, 0, 0,
        0.95, 0.62, 0.28, 0.55,
        2, 0, 0.4, 0);
    }
  };

  //  Where the creature will land, and whether it is going to eat you.
  Game.pushSpawnGhost = function () {
    var g = this.spawnGhost;
    if (!g || !this.spawnType) return;
    var B = R.B, farm = this.player.farms[0] || this.activeFarm;
    if (!farm) return;
    var pulse = 0.70 + 0.30 * Math.sin(this.time * 4.2);
    var col = !g.afford ? [0.85, 0.30, 0.25]
      : (g.hostile ? [0.92, 0.32, 0.26] : [0.62, 0.86, 0.52]);
    var SEG = 24;
    for (var i = 0; i < SEG; i++) {
      var a = i / SEG * Math.PI * 2;
      var mx = g.pos[0] + Math.cos(a) * g.radius;
      var mz = g.pos[2] + Math.sin(a) * g.radius;
      B.ghost.push(mx, farm.localTop(mx, mz) + 0.05, mz, 0.11,
        0, 0, 0, 0, 0, 0, 0, 0,
        col[0], col[1], col[2], 0.95 * pulse * ((i % 2) ? 1.0 : 0.42),
        2, 0, 0.5, 0);
    }
    B.ghost.push(g.pos[0], g.pos[1] + 0.03, g.pos[2], g.radius * 0.9,
      0, 0, 0, 0, 0, 0, 0, 0,
      col[0], col[1], col[2], 0.16 * pulse,
      2, 0, 0.04, 0);
  };

  //  DEAD COLOURING.
  //
  //  The shader already darkens a body through aIData.x - albedo *= mix(0.42,
  //  1.0, health), so health 0.25 lands at 56% brightness (shaders.js:653).
  //  That is a pure dim, though: hue is untouched, so a fresh corpse came out
  //  as the SAME orange as the ant hauling it, just darker, and at the jaws
  //  the two bodies blended into one shape. Draining the colour is what makes
  //  a body read as dead at a glance; the rot term then keeps darkening it
  //  with age. Used for bodies on the floor and bodies in transit alike, so
  //  nothing changes colour at the moment it is picked up.
  var _dead = [0, 0, 0];
  function deadTint(col, rot, out) {
    var lum = col[0] * 0.30 + col[1] * 0.59 + col[2] * 0.11;
    var drain = 0.55 + rot * 0.20;
    var dim = 1 - rot * 0.45;
    out[0] = (col[0] * (1 - drain) + lum * drain) * dim;
    out[1] = (col[1] * (1 - drain) + lum * drain) * dim;
    out[2] = (col[2] * (1 - drain) + lum * drain) * dim;
    return out;
  }

  Game.pushAnts = function (cam) {
    var B = R.B;
    var cp = cam.pos;
    for (var i = 0; i < this.ants.length; i++) {
      var a = this.ants[i];
      if (a.isDead()) continue;
      var dx = a.pos[0] - cp[0], dy = a.pos[1] - cp[1], dz = a.pos[2] - cp[2];
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 150 * 150) continue;
      if (!sphereVisible(a.pos, 1.0)) continue;
      casteTint(a.colony, a.caste, _tint);
      var scale = a.def.scale * a.sizeVar;
      //  THE LAYING BEAT. layT is set to 1 by Colony.layEggs and decays over
      //  about a second; the queen dips and swells slightly while it runs, so
      //  the moment an egg appears behind her is something the eye catches
      //  rather than a silent counter going up.
      var _lay = a.layT || 0, _layY = 0;
      if (_lay > 0) {
        var _lp = Math.sin((1 - _lay) * Math.PI);
        _layY = -0.10 * _lp * scale;
        scale *= 1 + 0.06 * _lp;
      }
      var hp = a.hp / a.maxHp;
      var sel = a.selected ? 1 : 0;
      var glow = a.glow + (a.flash > 0 ? a.flash * 0.85 : 0);
      var flags = a.infected > 0 ? 1 : 0;
      var rough = 0.30 + (a.caste === A.C.SOLDIER || a.caste === A.C.MAJOR ? 0.10 : 0) + (a.infected ? 0.4 : 0);
      var batch;
      if (a.caste === A.C.QUEEN) batch = B.queen;
      else if (a.caste === A.C.ALATE) batch = B.alate;
      else if (a.caste === A.C.SOLDIER || a.caste === A.C.MAJOR) batch = d2 < 26 * 26 ? B.soldier : B.soldierMid;
      else batch = d2 < 15 * 15 ? B.ant : (d2 < 46 * 46 ? B.antMid : B.antLow);
      if (!batch.push(a.pos[0], a.pos[1] + _layY, a.pos[2], scale,
        a.yaw, a.pitch, a.roll, a.phase,
        a.walk, a.attack, a.wing, a.sizeVar,
        _tint[0] + (a.flash > 0 ? a.flash * 0.6 : 0), _tint[1], _tint[2], rough,
        hp, sel, glow, flags)) {
        // batch full - fall back to the cheap mesh
        B.antLow.push(a.pos[0], a.pos[1], a.pos[2], scale,
          a.yaw, a.pitch, a.roll, a.phase, a.walk, a.attack, 0, 0,
          _tint[0], _tint[1], _tint[2], rough, hp, sel, glow, flags);
      }
      //  CARRIED BODY.
      //
      //  A corpse used to ride in the jaws as the same generic cargo pebble
      //  that food uses, only browner - so the whole catch-kill-butcher-haul
      //  chain ended with an ant carrying an anonymous dark crumb, and a
      //  player could not tell prey from a seed. A body is the one cargo that
      //  already has a mesh of its own, so carry the real thing: the same
      //  antLow instance pushCorpses lays on the floor, tilted onto its side
      //  in the mandibles.
      //
      //  doClean keeps j.corpse after pickup, so the body it is actually
      //  hauling supplies its own size and its own colony colour - a soldier
      //  rides visibly bigger than a worker, and a raided rival stays its own
      //  colour instead of turning into brown gravel.
      if (a.carry === 'corpse') {
        var body = a.job && a.job.corpse ? a.job.corpse : null;
        //  0.55, not the body's full size. A real worker corpse is as big as
        //  the worker hauling it, but drawn at full size beside the carrier it
        //  read as a second ant walking alongside rather than as a load - so
        //  it is shrunk to the size a hoisted burden appears, which is what
        //  sells the carry.
        var bs = (body && body.scale ? body.scale : scale) * 0.55;
        var bage = body ? body.age : 0;
        var brot = M.clamp(bage / 60, 0, 1);
        var bcol = body && body.colony ? body.colony.color : _tint;
        //  Gripped AT the mandibles and hoisted over the head - the posture a
        //  real ant uses. Held further out and level it floated beside the
        //  carrier like a companion; pulled in and lifted, it overlaps the
        //  head and reads as held. Sways with the stride so it is not welded.
        var sway = Math.sin(a.phase * 2.0) * 0.030;
        var hx = a.pos[0] + Math.sin(a.yaw) * scale * 0.50;
        var hz = a.pos[2] + Math.cos(a.yaw) * scale * 0.50;
        var hy = a.pos[1] + scale * (0.46 + sway);
        //  across the jaws, not down the carrier's axis: end-on it would be a
        //  blob, side-on the head, waist and gaster all read at a glance.
        //  Same roll pushCorpses uses, so a body looks the same whether it is
        //  on the floor or in transit. phase/walk stay 0 - limp legs.
        deadTint(bcol, brot, _dead);
        B.antLow.push(hx, hy, hz, bs,
          a.yaw + 0.80, 0.38, Math.PI * 0.42, 0,
          0, 0, 0, 0,
          _dead[0], _dead[1], _dead[2], 0.85,
          0.25, 0, 0, bage > 22 ? 1 : 0);
      } else if (a.carry) {
        // cargo pellet
        var cx = a.pos[0] + Math.sin(a.yaw) * scale * 0.55;
        var cz = a.pos[2] + Math.cos(a.yaw) * scale * 0.55;
        var cy = a.pos[1] + scale * 0.32;
        var cc = Game.ITEMS[a.carry] ? Game.ITEMS[a.carry].color : [0.9, 0.8, 0.5];
        B.pebbleSm.push(cx, cy, cz, scale * 0.30,
          a.yaw, 0, 0, 0, 0, 0, 0, 0,
          cc[0], cc[1], cc[2], 0.5, 1, 0, a.carry === 'sugar' ? 0.12 : 0, 0);
      }
    }
  };

  Game.pushBrood = function (cam) {
    var B = R.B;
    for (var c = 0; c < this.colonies.length; c++) {
      var col = this.colonies[c];
      for (var i = 0; i < col.brood.length; i++) {
        var b = col.brood[i];
        if (!b.node) continue;
        var n = b.node;
        //  Brood lie ON the chamber floor. The old fixed 0.62-of-a-radius
        //  drop left every egg and larva hanging in mid-air, offset from the
        //  centre - the pale shapes floating inside the nest.
        var ox = b.off[0] * n.radius * 0.6, oz = b.off[1] * n.radius * 0.6;
        var px = n.pos[0] + ox;
        var pz = n.pos[2] + oz;
        var m2 = ox * ox + oz * oz;
        var rr = n.radius * n.radius;
        if (m2 > rr * 0.92) m2 = rr * 0.92;
        var py = n.pos[1] - Math.sqrt(rr - m2) + 0.06;
        //  just laid: still on its way from the queen to the pile
        if (b.bornT !== undefined && b.bornT < 1 && b.born) {
          var e = b.bornT * b.bornT * (3 - 2 * b.bornT);
          px = b.born[0] + (px - b.born[0]) * e;
          py = b.born[1] + (py - b.born[1]) * e;
          pz = b.born[2] + (pz - b.born[2]) * e;
        }
        if (!sphereVisible([px, py, pz], 0.6)) continue;
        var t = b.t / b.need;
        B.brood.push(px, py, pz, 0.6 + t * 0.35,
          b.rot, 0, 0, 0,
          0, 0, 0, b.stage,
          0.94, 0.88, 0.72, 0.42,
          1, 0, 0.03, 0);
      }
    }
  };

  Game.pushCorpses = function (cam) {
    var B = R.B;
    for (var i = 0; i < this.corpses.length; i++) {
      var c = this.corpses[i];
      if (c.removed) continue;
      if (!sphereVisible(c.pos, 1.0)) continue;
      var rot = M.clamp(c.age / 60, 0, 1);
      var col = c.colony.color;
      deadTint(col, rot, _dead);
      B.antLow.push(c.pos[0], c.pos[1] + 0.02, c.pos[2], c.scale,
        c.yaw, 0, Math.PI * 0.42, 0,
        0, 0, 0, 0,
        _dead[0], _dead[1], _dead[2], 0.85,
        0.25, 0, 0, c.age > 22 ? 1 : 0);
    }
  };

  Game.PHERO_COL = [
    [1.00, 0.72, 0.22],  // food
    [1.00, 0.22, 0.16],  // alarm
    [0.30, 1.00, 0.65],  // trail
    [0.35, 0.62, 1.00],  // dig
    [0.55, 1.00, 1.00]   // clean
  ];

  Game.pushPheromones = function (cam) {
    var B = R.B;
    if (!this.showPheromones) return;
    for (var f = 0; f < this.visibleFarms.length; f++) {
      var farm = this.visibleFarms[f];
      for (var i = 0; i < farm.edges.length; i++) {
        var e = farm.edges[i];
        var best = -1, bv = 0.06;
        for (var p = 0; p < 5; p++) if (e.pher[p] > bv) { bv = e.pher[p]; best = p; }
        if (best < 0) continue;
        var col = Game.PHERO_COL[best];
        var n = Math.max(2, Math.min(9, Math.floor(e.len / 1.1)));
        for (var s = 0; s < n; s++) {
          var t = (s + 0.5) / n;
          var x = e.a.pos[0] + (e.b.pos[0] - e.a.pos[0]) * t;
          var y = e.a.pos[1] + (e.b.pos[1] - e.a.pos[1]) * t - e.radius * 0.35;
          var z = e.a.pos[2] + (e.b.pos[2] - e.a.pos[2]) * t;
          B.phero.push(x, y, z, e.radius * 1.05,
            0, 0, 0, 0, 0, 0, 0, 0,
            col[0], col[1], col[2], M.clamp(bv * 0.10, 0.02, 0.16),
            t, best, 0, s * 0.13 + i * 0.07);
        }
      }
    }
  };

  Game.pushDecals = function (cam) {
    var B = R.B;
    var i;
    // selection rings
    for (i = 0; i < this.selection.length; i++) {
      var a = this.selection[i];
      if (a.isDead()) continue;
      B.decal.push(a.pos[0], a.pos[1] + 0.02, a.pos[2], a.def.scale * 1.35,
        0, 0, 0, 0, 0, 0, 0, 0,
        0.35, 1.0, 1.15, 0.85,
        0, this.time * 2.2, 0.16, 0);
    }
    // rally point
    if (this.player.rally) {
      var r = this.player.rally;
      B.decal.push(r.pos[0], r.pos[1] - r.radius * 0.6 + 0.03, r.pos[2], r.radius * 1.1,
        0, 0, 0, 0, 0, 0, 0, 0,
        1.0, 0.55, 0.15, 0.8,
        0, M.fract(this.time * 0.6), 0.10, 0);
    }
    // hovered chamber: an upright ring tracing the room's actual outline in
    // the cross-section, so it reads as "this room" rather than a plate.
    if (this.hoverNode) {
      var h = this.hoverNode;
      B.decal.push(h.pos[0], h.pos[1], h.pos[2], h.radius,
        0, 0, 0, 0, 0, 0, 0, 0,
        1.0, 0.86, 0.50, 0.26,
        0, this.time * 1.1, 0.075, 1);
    }
    //  Build ghost: an upright silhouette of exactly what will be carved -
    //  the chamber is a sphere cut into a vertical slab, so its outline in the
    //  cross-section is a circle of the chamber's own radius. Plus a preview
    //  of the tunnel that will connect it back to the nest, at tunnel width.
    if (this.buildType >= 0 && this.buildGhost) {
      var g = this.buildGhost;
      var ok = g.valid;
      var gr = ok ? 0.36 : 1.0, gg = ok ? 1.0 : 0.30, gb = ok ? 0.62 : 0.24;
      var rad = W.CHAMBERS[this.buildType].radius;
      var VERT = g.surface ? 0 : 1;   // a surface pit lies flat, a room stands upright
      // soft fill at true size: this is the hole you are about to make
      B.ghost.push(g.pos[0], g.pos[1], g.pos[2], rad,
        0, 0, 0, 0, 0, 0, 0, 0,
        gr, gg, gb, 0.34, 2, 0, 0.055, VERT);
      // crisp outline, breathing slightly so it reads as a preview
      B.ghost.push(g.pos[0], g.pos[1], g.pos[2], rad * (1.0 + 0.035 * Math.sin(this.time * 3.2)),
        0, 0, 0, 0, 0, 0, 0, 0,
        gr, gg, gb, 0.95, 0, this.time * 1.4, 0.07, VERT);
      if (g.from) {
        var tunR = Math.max(0.35, (W.CHAMBERS[W.CH.TUNNEL].radius) * 0.92);
        var steps = 6;
        for (i = 1; i < steps; i++) {
          var t = i / steps;
          var fade = 0.18 + 0.20 * (0.5 + 0.5 * Math.sin(this.time * 5 - i * 0.8));
          B.ghost.push(
            g.from.pos[0] + (g.pos[0] - g.from.pos[0]) * t,
            g.from.pos[1] + (g.pos[1] - g.from.pos[1]) * t,
            g.from.pos[2] + (g.pos[2] - g.from.pos[2]) * t,
            tunR,
            0, 0, 0, 0, 0, 0, 0, 0,
            gr, gg, gb, fade, 2, 0, 0.10, VERT);
        }
      }
    }
    // enemy under the cursor
    if (this.hoverAnt && this.hoverAnt.colony !== this.player) {
      var h2 = this.hoverAnt;
      B.decal.push(h2.pos[0], h2.pos[1] + 0.02, h2.pos[2], h2.def.scale * 1.5,
        0, 0, 0, 0, 0, 0, 0, 0,
        1.0, 0.26, 0.18, 0.9, 0, this.time * 4.0, 0.14, 0);
    }
    // loose food under the cursor
    if (this.hoverItem) {
      B.decal.push(this.hoverItem.pos[0], this.hoverItem.pos[1] + 0.02, this.hoverItem.pos[2], 0.75,
        0, 0, 0, 0, 0, 0, 0, 0,
        1.0, 0.82, 0.32, 0.75, 0, this.time * 2.4, 0.12, 0);
    }
    // chambers under construction
    for (var f = 0; f < this.visibleFarms.length; f++) {
      var farm = this.visibleFarms[f];
      for (i = 0; i < farm.nodes.length; i++) {
        var n = farm.nodes[i];
        if (n.build >= 1 || n.build <= 0) continue;
        B.decal.push(n.pos[0], n.pos[1] - n.radius * 0.5, n.pos[2], n.radius * 1.25,
          0, 0, 0, 0, 0, 0, 0, 0,
          1.0, 0.8, 0.25, 0.5 + 0.3 * Math.sin(this.time * 5),
          1, M.fract(n.build), 0.10, 0);
      }
    }
  };

  // ------------------------------------------------------------------
  //  post-processing parameters (auto focus, sun on screen)
  // ------------------------------------------------------------------
  var _sp = new Float32Array(3);
  var _fp = new Float32Array(3);
  Game.updateFxParams = function () {
    var fx = this.fxSettings;
    var cam = this.cam;
    // Focus on the pane the nest is dug against, not the orbit pivot -
    // otherwise the whole cross-section sits ~10 units in front of focus.
    var focusDist;
    if (this.selection.length) focusDist = v3.dist(cam.pos, this.selection[0].pos);
    else if (this.hoverAnt) focusDist = v3.dist(cam.pos, this.hoverAnt.pos);
    else if (this.hoverNode) focusDist = v3.dist(cam.pos, this.hoverNode.pos);
    else if (this.activeFarm) {
      _fp[0] = this.rig.focus[0]; _fp[1] = this.rig.focus[1]; _fp[2] = this.activeFarm.digZ;
      focusDist = v3.dist(cam.pos, _fp);
    } else focusDist = this.rig.dist;
    fx.focus = M.damp(fx.focus, focusDist, 4.0, 0.016);
    // gentle macro DOF: enough to separate depth, never enough to smear the nest
    fx.aperture = M.clamp(6 / Math.max(4, focusDist), 0.10, 0.34);
    fx.maxCoC = this.quality === 'low' ? 1.2 : 1.8;

    // sun screen position for god rays
    var sd = this.env.sunDir;
    _sp[0] = cam.pos[0] + sd[0] * 220;
    _sp[1] = cam.pos[1] + sd[1] * 220;
    _sp[2] = cam.pos[2] + sd[2] * 220;
    var w = cam.vp[3] * _sp[0] + cam.vp[7] * _sp[1] + cam.vp[11] * _sp[2] + cam.vp[15];
    if (w > 0) {
      var sx = (cam.vp[0] * _sp[0] + cam.vp[4] * _sp[1] + cam.vp[8] * _sp[2] + cam.vp[12]) / w;
      var sy = (cam.vp[1] * _sp[0] + cam.vp[5] * _sp[1] + cam.vp[9] * _sp[2] + cam.vp[13]) / w;
      fx.sunUV[0] = sx * 0.5 + 0.5;
      fx.sunUV[1] = sy * 0.5 + 0.5;
      fx.sunOnScreen = sx > -1.5 && sx < 1.5 && sy > -1.5 && sy < 1.5;
    } else fx.sunOnScreen = false;

    fx.flash = this.fx.flash;
    fx.flashCol = this.fx.flashCol;
    // combat reddens the grade
    var t = this.player ? this.player.threat : 0;
    fx.saturation = M.damp(fx.saturation, 1.18 - t * 0.18, 2, 0.016);
    fx.gain[0] = M.damp(fx.gain[0], 1.02 + t * 0.10, 2, 0.016);
    fx.gain[2] = M.damp(fx.gain[2], 0.985 - t * 0.06, 2, 0.016);
    fx.vignette = M.damp(fx.vignette, 0.55 + t * 0.18, 2, 0.016);
  };

})(window.AF = window.AF || {});

/* =============================================================
   Development harness. Loaded only when the page is opened with
   ?shot , so the release build never sees it.

   Lets an automated client boot the game, step frames deterministically
   (the tab may be hidden, so rAF is throttled), park the camera, capture
   the framebuffer to tools/shot_*.png, and probe world state.
   ============================================================= */
(function () {
  'use strict';
  var H = {};
  window.__H = H;
  H.errors = [];
  window.addEventListener('error', function (e) { H.errors.push(String(e.message)); });
  var _err = console.error;
  console.error = function () {
    H.errors.push(Array.prototype.map.call(arguments, String).join(' ').slice(0, 400));
    _err.apply(console, arguments);
  };

  H.ready = function () {
    return !!(window.AF && AF.Game && AF.Game.state);
  };

  H.begin = function (opts) {
    opts = opts || {};
    var AF = window.AF;
    if (AF.Game.state !== 'menu') return 'state=' + AF.Game.state;
    if (AF.UI.menuSel) {
      if (opts.species) AF.UI.menuSel.species = opts.species;
      if (opts.farmIndex !== undefined) AF.UI.menuSel.farmIndex = opts.farmIndex;
      if (opts.difficulty) AF.UI.menuSel.difficulty = opts.difficulty;
      if (opts.quality) AF.UI.menuSel.quality = opts.quality;
    }
    document.getElementById('btnStart').click();
    return 'started';
  };

  //  Drive the frame loop by hand: a hidden tab throttles rAF to ~1 Hz.
  H.step = function (n, dt) {
    var AF = window.AF, G = AF.Game;
    dt = dt || 1 / 60;
    for (var i = 0; i < n; i++) {
      try {
        G.handleInput(dt);
        G.update(dt);
        G.render();
        G.input.endFrame();
      } catch (e) {
        H.errors.push('step: ' + e.message);
        return 'ERR ' + e.message;
      }
    }
    return 'stepped ' + n;
  };

  //  Park the camera. Angles in radians; dist in world units.
  H.cam = function (o) {
    var r = window.AF.Game.rig;
    if (o.focus) { r.wantFocus[0] = o.focus[0]; r.wantFocus[1] = o.focus[1]; r.wantFocus[2] = o.focus[2]; }
    if (o.dist !== undefined) r.wantDist = o.dist;
    if (o.yaw !== undefined) r.wantYaw = o.yaw;
    if (o.pitch !== undefined) r.wantPitch = o.pitch;
    if (o.mode) r.mode = o.mode;
    r.follow = null;
    r.snap();
    return 'cam ok';
  };

  H.shot = function (tag) {
    var AF = window.AF;
    try { AF.Game.render(); } catch (e) { return Promise.resolve('ERR ' + e.message); }
    var url = document.getElementById('gl').toDataURL('image/png');
    return fetch('/__shot?tag=' + encodeURIComponent(tag || 'x'), { method: 'POST', body: url })
      .then(function (r) { return r.text(); });
  };

  // ------------------------------------------------------------------
  //  PROBES
  // ------------------------------------------------------------------
  //  Does each surface ant actually stand on the terrain the shader draws?
  H.probeGround = function (limit) {
    var AF = window.AF, G = AF.Game;
    var out = { surfaceAnts: 0, samples: [], worstAbove: 0, worstBelow: 0 };
    var n = 0;
    for (var i = 0; i < G.ants.length && n < (limit || 12); i++) {
      var a = G.ants[i];
      if (!a.farm) continue;
      var truth = a.farm.localTop(a.pos[0], a.pos[2]);
      var d = a.pos[1] - truth;
      if (a.mode === 'surface') {
        out.surfaceAnts++;
        out.samples.push({
          caste: a.def ? a.def.name : '?', mode: a.mode,
          y: +a.pos[1].toFixed(3), ground: +truth.toFixed(3), delta: +d.toFixed(3)
        });
        if (d > out.worstAbove) out.worstAbove = +d.toFixed(3);
        if (d < out.worstBelow) out.worstBelow = +d.toFixed(3);
        n++;
      }
    }
    return out;
  };

  //  Compare the CPU surface height against the baked SDF: if these
  //  disagree, everything placed by the CPU floats or sinks.
  H.probeSurface = function () {
    var AF = window.AF, G = AF.Game;
    var f = G.activeFarm;
    var res = { farm: f.name, topY: f.topY, samples: [] };
    for (var k = 0; k < 6; k++) {
      var x = f.center[0] + (k - 2.5) * (f.half[0] * 0.3);
      var z = f.center[2] + ((k % 3) - 1) * (f.half[2] * 0.4);
      res.samples.push({
        x: +x.toFixed(2), z: +z.toFixed(2),
        localTop: +f.localTop(x, z).toFixed(3),
        surfaceH: +AF.W.surfaceH(x, z).toFixed(3)
      });
    }
    return res;
  };

  //  Where do props sit relative to the ground they are meant to root in?
  H.probeProps = function (limit) {
    var G = window.AF.Game;
    var f = G.activeFarm;
    var out = { total: f.props.length, byKind: {}, samples: [] };
    for (var i = 0; i < f.props.length; i++) {
      var p = f.props[i];
      out.byKind[p.kind] = (out.byKind[p.kind] || 0) + 1;
    }
    for (i = 0; i < f.props.length && out.samples.length < (limit || 14); i += Math.max(1, (f.props.length / 14) | 0)) {
      p = f.props[i];
      out.samples.push({
        kind: p.kind, y: +p.y.toFixed(3),
        ground: +f.localTop(p.x, p.z).toFixed(3),
        delta: +(p.y - f.localTop(p.x, p.z)).toFixed(3),
        scale: +p.scale.toFixed(2)
      });
    }
    return out;
  };

  H.probeWorld = function () {
    var G = window.AF.Game, W = G.world;
    return {
      shelfWidth: W.shelfWidth, shelfHeight: W.shelfHeight,
      farms: W.farms.map(function (f) {
        return {
          name: f.name, gx: f.gridX, gy: f.gridY,
          center: [+f.center[0].toFixed(1), +f.center[1].toFixed(1), +f.center[2].toFixed(1)],
          half: [+f.half[0].toFixed(1), +f.half[1].toFixed(1), +f.half[2].toFixed(1)],
          topY: +f.topY.toFixed(2), nodes: f.nodes.length, props: f.props.length
        };
      })
    };
  };

  H.probeAnts = function () {
    var G = window.AF.Game;
    var byMode = {}, byState = {}, byCaste = {};
    for (var i = 0; i < G.ants.length; i++) {
      var a = G.ants[i];
      byMode[a.mode] = (byMode[a.mode] || 0) + 1;
      byState[a.state] = (byState[a.state] || 0) + 1;
      var nm = a.def ? a.def.name : '?';
      byCaste[nm] = (byCaste[nm] || 0) + 1;
    }
    return {
      total: G.ants.length, byMode: byMode, byState: byState, byCaste: byCaste,
      antScale: G.ants[0] ? G.ants[0].scale : null
    };
  };

  H.probeEconomy = function () {
    var G = window.AF.Game, p = G.player;
    return {
      day: G.sim.day, pop: p.population(), cap: p.popCap(),
      sugar: +p.sugar.toFixed(1), protein: +p.protein.toFixed(1),
      water: +p.water.toFixed(1), biomass: +p.biomass.toFixed(1),
      minerals: +p.minerals.toFixed(1), research: +p.research.toFixed(1),
      hygiene: +p.hygiene.toFixed(2), morale: +p.morale.toFixed(2),
      threat: +p.threat.toFixed(2), brood: p.brood.length, queue: p.queue.length,
      items: G.items.length, corpses: G.corpses.length
    };
  };

  H.stats = function () {
    var R = window.AF.R;
    return {
      fps: Math.round(window.AF.Game.fps || 0), draws: R.stats.draws,
      instances: R.stats.instances, tris: R.stats.tris,
      w: R.width, h: R.height, renderer: window.AF.GLX.renderer
    };
  };
})();

/* =============================================================
   FORMICARIUM :: DEEP COLONY
   grains.js - pouring sugar and water, and the aim preview.

   The physics used to live here. It does not any more: src/particles.js
   runs one position-based solver for both materials, and sugar and water
   stay resident as real particles instead of being deleted at rest and
   swapped for a static prop. What is left here is the layer above it -
   aiming, metering the stream, digging a pit, and predicting where the
   material is actually going to end up so the player can SEE it first.

   The aim pick is the important part. It used to march Farm.localTop,
   which is the terrain heightfield and knows nothing about a dug pit, so
   the crosshair and the physics disagreed over exactly the place the
   player most wanted to pour. Both now read the same signed distance
   field, through the same cache.
   ============================================================= */
(function (AF) {
  'use strict';

  var M = AF.M, v3 = M.v3;
  var Game = AF.Game;

  Game.POUR = {
    sugar: {
      key: 'sugar', name: 'Sugar', icon: '❃',
      desc: 'Pour a handful of sugar onto the soil. It piles into a real cone and foragers come running.',
      rate: 90, spread: 0.34, height: 1.5, v0: -1.2,
      item: { type: 'sugar', visual: 'sugar' },
      col: [1.0, 0.985, 0.95]
    },
    water: {
      key: 'water', name: 'Water', icon: '◍',
      desc: 'Trickle in water. It runs downhill and pools in the lowest spot — dig a hollow and you get a puddle.',
      rate: 130, spread: 0.15, height: 1.5, v0: -2.6,
      item: { type: 'water', visual: 'water' },
      col: [0.42, 0.68, 0.95]
    }
  };

  var POUR_MIN_SEP = 0.22;

  // ------------------------------------------------------------------
  //  Aim: sphere-trace the soil field.
  // ------------------------------------------------------------------
  //  A sphere trace on the real SDF lands on whatever surface is actually
  //  there - the top of a mound, the floor of a pit you dug, the inside of
  //  an open chamber - instead of on a heightfield that pretends the pit
  //  does not exist.
  Game.pourPick = function (ro, rd, farm) {
    if (!farm) return null;
    var C = AF.SDFCache;
    // start just above the tank so we never begin inside the soil
    var topY = farm.center[1] + farm.half[1] + 1.0;
    var t = 0;
    if (ro[1] > topY && rd[1] < -1e-5) t = (topY - ro[1]) / rd[1];
    var lim = farm.half[0] + farm.half[2] + farm.half[1] + 60;
    for (var i = 0; i < 96; i++) {
      var x = ro[0] + rd[0] * t, y = ro[1] + rd[1] * t, z = ro[2] + rd[2] * t;
      if (t > lim) break;
      // outside the glass footprint: skip ahead rather than sampling far field
      if (Math.abs(x - farm.center[0]) > farm.half[0] + 3 ||
        Math.abs(z - farm.center[2]) > farm.half[2] + 3) {
        if (y < farm.center[1] - farm.half[1] - 3) break;
        t += 0.6; continue;
      }
      var d = C.sample(farm, x, y, z, null);
      if (d < 0.045) {
        // step back to the crossing so we sit ON the surface, not in it
        var tb = Math.max(0, t - 0.09);
        return v3.create(ro[0] + rd[0] * tb, ro[1] + rd[1] * tb, ro[2] + rd[2] * tb);
      }
      t += Math.max(0.055, d * 0.85);
    }
    return null;
  };

  //  player.js places the pit with this; keep the old name working.
  Game.surfacePick = function (ro, rd, farm) {
    return Game.pourPick(ro, rd, farm);
  };

  // ------------------------------------------------------------------
  //  Scoop a bowl out of the surface
  // ------------------------------------------------------------------
  Game.digPit = function (farm, x, z) {
    var W = AF.W;
    var def = W.CHAMBERS[W.CH.PIT];
    var cost = Math.round((Game.COST.tunnel + def.cost) * 0.5);
    if (this.player.biomass < cost) { this.audio.play('deny'); return null; }
    for (var i = 0; i < farm.nodes.length; i++) {
      var o = farm.nodes[i];
      if (!o.detached) continue;
      var dx = o.pos[0] - x, dz = o.pos[2] - z;
      if (dx * dx + dz * dz < def.radius * def.radius * 1.6) { this.audio.play('deny'); return null; }
    }
    var top = farm.localTop(x, z);
    var n = farm.addNode(x, top + def.radius * 0.34, z, def.radius, W.CH.PIT);
    n.detached = true;
    n.build = 1;
    this.player.biomass -= cost;
    farm.dirty = true;
    this.markDirty(farm);
    //  the ground moved under anything already lying here
    if (AF.PS) AF.PS.wakeNear(x, top, z, def.radius * 2.2);
    this.fx.burst([x, top, z], 14, 'dirt', farm.soilTop || [0.5, 0.4, 0.3]);
    this.audio.play('build');
    this.ui.notify('Pit dug — pour water in');
    return n;
  };

  // ------------------------------------------------------------------
  //  Pour: a metered stream, not a one-shot handful
  // ------------------------------------------------------------------
  var _pourAcc = 0, _lastSfx = 0;

  Game.pourStream = function (kind, x, z, farm, dt) {
    var def = Game.POUR[kind];
    if (!def || !farm || !AF.PS) return 0;
    var PS = AF.PS;
    if (PS.count() >= PS.MAX_RESIDENT) return 0;

    _pourAcc += def.rate * Math.min(dt, 0.05);
    var want = Math.floor(_pourAcc);
    if (want <= 0) return 0;
    _pourAcc -= want;
    if (want > 12) want = 12;

    var rng = this.rng;
    var surf = farm.localTop(x, z);
    var startY = surf + def.height;

    //  Sugar is not particles any more. It is deposited straight into the
    //  height field, which then finds its own repose angle - a guaranteed
    //  clean cone instead of a contact solver's 21 degrees plus a spray of
    //  escaped grains.
    if (kind === 'sugar') {
      if (AF.Heap) {
        AF.Heap.deposit(x, z, want * 0.021, def.spread * 1.25);
        var nw = this.time || 0;
        if (this.audio && nw - _lastSfx > 0.08) { _lastSfx = nw; this.audio.play('click'); }
        return want;
      }
      return 0;
    }

    var material = PS.MAT_WATER;
    var made = 0;
    for (var i = 0; i < want; i++) {
      //  jittered ring, min separation, so the stream does not spawn a
      //  pile of coincident particles that the solver then has to explode
      var a = rng.range(0, M.TAU), r = Math.sqrt(rng.next()) * def.spread;
      var sx = x + Math.cos(a) * r, sz = z + Math.sin(a) * r;
      var sy = startY + rng.range(0, POUR_MIN_SEP * 2);
      if (PS.spawn(material, sx, sy, sz,
        rng.range(-0.25, 0.25), def.v0, rng.range(-0.25, 0.25), farm) < 0) break;
      made++;
    }
    //  anything already settled under the stream should get out of the way
    if (made) PS.wakeNear(x, surf, z, def.spread + 0.9);

    var now = this.time || 0;
    if (made && this.audio && now - _lastSfx > 0.08) {
      _lastSfx = now;
      this.audio.play(kind === 'water' ? 'water' : 'click');
    }
    return made;
  };

  //  Back-compat one-shot (save files / scripted events / the harness).
  Game.pour = function (kind, x, z, farm, n) {
    var def = Game.POUR[kind];
    if (!def || !farm || !AF.PS) return 0;
    var PS = AF.PS, rng = this.rng;
    var material = kind === 'water' ? PS.MAT_WATER : PS.MAT_SUGAR;
    var surf = farm.localTop(x, z), made = 0;
    n = n || 30;
    if (kind === 'sugar') {
      if (!AF.Heap) return 0;
      AF.Heap.deposit(x, z, n * 0.021, def.spread * Math.max(1.25, Math.sqrt(n / 12)));
      return n;
    }
    //  Spawn at roughly rest density. Dumping the whole handful into one
    //  0.34-radius disc packs it eight times over, and a position-based
    //  contact solver answers that by firing everything at the glass.
    var R = def.spread * Math.max(1, Math.sqrt(n / 12));
    var layers = Math.max(1, Math.ceil(n / 40));
    for (var i = 0; i < n; i++) {
      var a = rng.range(0, M.TAU), r = Math.sqrt(rng.next()) * R;
      var lay = (i % layers) * 0.34 + rng.range(0, 0.2);
      if (PS.spawn(material,
        x + Math.cos(a) * r, surf + def.height + lay, z + Math.sin(a) * r,
        rng.range(-0.25, 0.25), def.v0, rng.range(-0.25, 0.25), farm) < 0) break;
      made++;
    }
    if (made) PS.wakeNear(x, surf, z, def.spread + 0.9);
    return made;
  };

  // ------------------------------------------------------------------
  //  Heap <-> water coupling, and the heap's link to the ant economy
  // ------------------------------------------------------------------
  //  Water lying on sugar wets it, and wet sugar cannot hold a slope, so a
  //  pool poured onto a cone visibly slumps it. The wetting is driven from
  //  the water side because that is the side that knows where the water is.
  Game.wetHeapFromWater = function (dt) {
    var PS = AF.PS, HP = AF.Heap;
    if (!PS || !HP || HP.isEmpty() || !PS.count()) return;
    var px = PS.px, py = PS.py, pz = PS.pz, alive = PS.alive, mat = PS.mat;
    for (var i = 0; i < PS.MAX_RESIDENT; i++) {
      if (!alive[i] || mat[i] !== PS.MAT_WATER) continue;
      var h = HP.surfaceAt(px[i], pz[i]);
      //  only water actually touching the heap surface counts
      if (py[i] < h + 0.45 && py[i] > h - 1.2) HP.wet(px[i], pz[i], 0.45, dt);
    }
  };

  //  Ants forage Game.items and nothing else. The heap publishes itself as
  //  a handful of item entries so ants.js and colony.js stay untouched.
  var _heapT = 0;
  Game.publishHeapFood = function () {
    var HP = AF.Heap;
    if (!HP) return;
    _heapT += 1;
    if (_heapT < 20) return;          // ~3 times a second is plenty
    _heapT = 0;
    var farm = this.player.farms[0] || this.activeFarm;
    if (!farm) return;
    for (var m = this.items.length - 1; m >= 0; m--) {
      if (this.items[m].heap) this.items.splice(m, 1);
    }
    if (HP.isEmpty()) return;
    var blobs = HP.blobs();
    for (var i = 0; i < blobs.length; i++) {
      var b = blobs[i];
      if (b.amount < 0.02) continue;
      this.items.push({
        type: 'sugar', visual: 'sugar',
        pos: [b.x, HP.surfaceAt(b.x, b.z), b.z],
        amount: Math.min(60, b.amount * 900),
        farm: farm, surface: true, dead: false, claimed: 0,
        poured: true, heap: true, hidden: true,
        rot: 0, scale: 1, bob: 0
      });
    }
  };

  //  Sugar that has drained into the nest and come to rest stops being
  //  physics and becomes food.
  //
  //  Leaving it in the solver was costing 19ms a frame: eighteen hundred
  //  grains, all asleep, all still being hashed and neighbour-listed for
  //  nothing. A crumb lying on a chamber floor does not need contacts - it
  //  needs to be something an ant can pick up, which is exactly what a
  //  Game.items entry is.
  Game.settleUndergroundSugar = function () {
    var PS = AF.PS;
    if (!PS || !PS.count()) return 0;
    var farm = this.player.farms[0] || this.activeFarm;
    if (!farm) return 0;
    var n = 0;
    for (var i = 0; i < PS.MAX_RESIDENT; i++) {
      if (!PS.alive[i] || PS.mat[i] !== PS.MAT_SUGAR) continue;
      if (!PS.asleep[i] && !PS.isSlow(i)) continue;
      var y = PS.py[i];
      //  only underground; a heap on the surface is the height field's job
      if (y > farm.localTop(PS.px[i], PS.pz[i]) - 0.5) continue;
      //  merge into a crumb that is already lying here, so a big pour does
      //  not leave the chamber floor carpeted in hundreds of separate items
      var merged = false;
      for (var m = 0; m < this.items.length; m++) {
        var it = this.items[m];
        if (it.dead || it.heap || it.type !== 'sugar' || it.surface) continue;
        var ax = it.pos[0] - PS.px[i], ay = it.pos[1] - y, az = it.pos[2] - PS.pz[i];
        if (ax * ax + ay * ay + az * az < 0.55 * 0.55 && it.amount < 80) {
          it.amount += Math.max(6, PS.amt[i] || 12);
          it.scale = Math.min(1.05, (it.scale || 0.7) + 0.04);
          merged = true; break;
        }
      }
      if (merged) { PS.remove(i); if (++n >= 30) break; continue; }
      this.items.push({
        type: 'sugar', visual: 'sugar',
        pos: [PS.px[i], y, PS.pz[i]],
        amount: Math.max(6, PS.amt[i] || 12),
        farm: farm, surface: false, dead: false, claimed: 0,
        poured: true, rot: (i * 2.399) % 6.283, scale: 0.7, bob: 0
      });
      PS.remove(i);
      if (++n >= 30) break;      // spread the conversion over frames
    }
    return n;
  };

  //  An ant took a bite out of the heap.
  Game.takeFromHeap = function (x, z, amount) {
    return AF.Heap ? AF.Heap.take(x, z, amount / 900, 0.4) : 0;
  };

  // ------------------------------------------------------------------
  //  Aim preview - where is this actually going to end up?
  // ------------------------------------------------------------------
  //  Water is the hard case: the point under the crosshair is almost never
  //  where the water stays. So we walk downhill from the impact point and
  //  show the player the real destination, stopping when the slope runs out
  //  or when we drop into a carved hollow.
  var TRACE_MAX = 48, TRACE_STEP = 0.35;

  Game.predictFlow = function (farm, x, z, out) {
    out.length = 0;
    var C = AF.SDFCache;
    var cx = x, cz = z;
    var e = 0.22;
    for (var i = 0; i < TRACE_MAX; i++) {
      var h = farm.localTop(cx, cz);
      out.push(cx, h, cz);
      //  is there open space carved below us here? then this is the basin
      if (C.sample(farm, cx, h - 0.55, cz, null) > 0.12) break;
      var gx = farm.localTop(cx + e, cz) - farm.localTop(cx - e, cz);
      var gz = farm.localTop(cx, cz + e) - farm.localTop(cx, cz - e);
      var gl = Math.sqrt(gx * gx + gz * gz);
      if (gl < 0.02) break;                       // flat: it stays here
      cx -= (gx / gl) * TRACE_STEP;
      cz -= (gz / gl) * TRACE_STEP;
      if (Math.abs(cx - farm.center[0]) > farm.half[0] - 0.6 ||
        Math.abs(cz - farm.center[2]) > farm.half[2] - 0.6) break;
    }
    return out;
  };

  Game.updatePourGhost = function (ray) {
    var farm = this.player.farms[0] || this.activeFarm;
    if (!farm || !this.pourType) { this.pourGhost = null; return; }
    var hit = this.pourPick(ray.o, ray.d, farm);
    if (!hit) { this.pourGhost = null; return; }
    var def = Game.POUR[this.pourType];
    var g = this.pourGhost || (this.pourGhost = { trace: [] });
    g.kind = this.pourType;
    g.impact = hit;
    g.radius = def.spread * 1.65;
    g.valid = true;
    g.col = def.col;
    if (this.pourType === 'water') {
      this.predictFlow(farm, hit[0], hit[2], g.trace);
      //  did it run away from the cursor? then the ring at the cursor is a
      //  lie and the player needs to see the basin instead.
      var n = g.trace.length;
      g.dest = n >= 3 ? [g.trace[n - 3], g.trace[n - 2], g.trace[n - 1]] : null;
      g.runs = !!(g.dest && (Math.abs(g.dest[0] - hit[0]) > 0.5 ||
        Math.abs(g.dest[2] - hit[2]) > 0.5));
    } else {
      g.trace.length = 0;
      g.dest = null;
      g.runs = false;
    }
    return g;
  };

})(window.AF = window.AF || {});

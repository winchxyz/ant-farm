/* =============================================================
   FORMICARIUM :: DEEP COLONY
   excavate.js - the player's shovel, and the colony's answer to it.

   Digging reuses the mechanism the water pit already proved: a detached
   node is a sphere that packSegments hands to the SDF as something to
   subtract, so the soil genuinely opens up, the raymarched shader shows
   it, and the physics agrees because both read the same field. Nothing
   new had to be invented for the hole itself.

   What IS new is that the ants object. A scoop taken out of the roof of a
   tunnel, or straight through a chamber wall, is a breach: it lets light
   and dry air into the nest, and the colony walks over and fills it back
   in. Dig somewhere harmless and it simply stays dug.
   ============================================================= */
(function (AF) {
  'use strict';

  var M = AF.M;
  var Game = AF.Game;

  var DIG_R = 1.15;                 // radius of one scoop
  var DIG_COST = 2;                 // biomass per scoop
  var DIG_INTERVAL = 0.16;          // seconds between scoops while held
  var MAX_SCOOPS = 90;              // the SDF only has room for so many
  var BREACH_MARGIN = 0.55;         // how close to a tunnel counts as a breach
  var REFILL_RATE = 0.055;          // radius shrink per second while repaired

  Game.digMode = false;
  Game.scoops = [];

  Game.setDig = function (on) {
    this.digMode = !!on;
    if (on) {
      this.buildType = -1;
      if (this.pourType) { this.pourType = null; this.ui.setPour(null); }
      this.pheroMode = 0;
    }
    if (this.ui && this.ui.setDig) this.ui.setDig(this.digMode);
  };

  // ------------------------------------------------------------------
  //  Is this scoop cutting into the nest?
  // ------------------------------------------------------------------
  //  Distance to the nearest built tunnel or chamber. A scoop that overlaps
  //  one has opened the nest to the surface, and that is what the colony
  //  reacts to.
  function breachDepth(farm, x, y, z, r) {
    var worst = 0, i;
    for (i = 0; i < farm.edges.length; i++) {
      var e = farm.edges[i];
      if (e.build <= 0.05) continue;
      var d = segDist(x, y, z, e.a.pos, e.b.pos) - e.radius * Math.min(1, e.build);
      var o = (r + BREACH_MARGIN) - d;
      if (o > worst) worst = o;
    }
    for (i = 0; i < farm.nodes.length; i++) {
      var n = farm.nodes[i];
      if (n.build <= 0.05 || n.detached) continue;
      var dx = x - n.pos[0], dy = y - n.pos[1], dz = z - n.pos[2];
      var dd = Math.sqrt(dx * dx + dy * dy + dz * dz) - n.radius * Math.min(1, n.build);
      var oo = (r + BREACH_MARGIN) - dd;
      if (oo > worst) worst = oo;
    }
    return worst;
  }

  function segDist(x, y, z, a, b) {
    var ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2];
    var px = x - a[0], py = y - a[1], pz = z - a[2];
    var ee = ex * ex + ey * ey + ez * ez;
    var t = ee > 1e-6 ? (px * ex + py * ey + pz * ez) / ee : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var cx = px - ex * t, cy = py - ey * t, cz = pz - ez * t;
    return Math.sqrt(cx * cx + cy * cy + cz * cz);
  }

  // ------------------------------------------------------------------
  //  Take a scoop
  // ------------------------------------------------------------------
  Game.digScoop = function (farm, x, y, z) {
    if (!farm) return null;
    if (this.player.biomass < DIG_COST) { this.audio.play('deny'); return null; }
    if (this.scoops.length >= MAX_SCOOPS) {
      //  retire the oldest fully-open scoop rather than refusing to dig
      for (var q = 0; q < this.scoops.length; q++) {
        if (!this.scoops[q].breach) { this.removeScoop(this.scoops[q]); break; }
      }
      if (this.scoops.length >= MAX_SCOOPS) { this.audio.play('deny'); return null; }
    }
    //  merge into a neighbouring scoop instead of stacking spheres on the
    //  same spot - dragging the tool should carve a trench, not a bead chain
    for (var i = 0; i < this.scoops.length; i++) {
      var s = this.scoops[i];
      var dx = s.node.pos[0] - x, dy = s.node.pos[1] - y, dz = s.node.pos[2] - z;
      if (dx * dx + dy * dy + dz * dz < (DIG_R * 0.45) * (DIG_R * 0.45)) {
        if (s.node.radius < DIG_R * 1.5) {
          s.node.radius += 0.10;
          farm.dirty = true; this.markDirty(farm);
          this.player.biomass -= DIG_COST;
          return s;
        }
        return null;
      }
    }
    var n = farm.addNode(x, y, z, DIG_R, AF.W.CH.PIT);
    n.detached = true;
    n.build = 1;
    n.isScoop = true;
    this.player.biomass -= DIG_COST;
    farm.dirty = true;
    this.markDirty(farm);

    var br = breachDepth(farm, x, y, z, DIG_R);
    var sc = { node: n, farm: farm, breach: br > 0, repair: 0, workers: 0 };
    this.scoops.push(sc);

    if (AF.Heap) AF.Heap.rebakeGround();
    //  anything the scoop just undermined stops growing there
    if (this.pruneFloatingProps) this.pruneFloatingProps(farm);
    if (AF.PS) AF.PS.wakeNear(x, y, z, DIG_R * 2.4);
    this.fx.burst([x, y, z], 12, 'dirt', farm.soilTop || [0.5, 0.4, 0.3]);
    this.audio.play('dig');
    if (sc.breach && !this._breachTold) {
      this._breachTold = 1;
      this.ui.notify('You broke into the nest — the ants are filling it in');
    }
    return sc;
  };

  Game.removeScoop = function (sc) {
    var i = this.scoops.indexOf(sc);
    if (i >= 0) this.scoops.splice(i, 1);
    var f = sc.farm;
    var j = f.nodes.indexOf(sc.node);
    if (j >= 0) f.nodes.splice(j, 1);
    f.dirty = true;
    this.markDirty(f);
    if (AF.Heap) AF.Heap.rebakeGround();
  };

  // ------------------------------------------------------------------
  //  The colony fills breaches back in
  // ------------------------------------------------------------------
  //  Only breaches. A pit dug in open ground is the player's business and
  //  stays exactly where they put it; a hole punched into the nest is a
  //  problem the colony solves by carrying soil back, which is what real
  //  ants do the moment you open their tunnels.
  Game.updateScoops = function (dt) {
    if (!this.scoops.length) return;
    var need = 0;
    for (var i = this.scoops.length - 1; i >= 0; i--) {
      var sc = this.scoops[i];
      if (!sc.breach) continue;
      need++;
      //  Crew is counted from ants that are ACTUALLY standing there, not
      //  from a booking. That way the repair you see on screen is the repair
      //  the numbers are doing, and an ant that wanders off stops helping.
      var crew = 0;
      for (var a = 0; a < this.ants.length; a++) {
        var an = this.ants[a];
        if (an.colony !== this.player) continue;
        var ax = an.pos[0] - sc.node.pos[0];
        var ay = an.pos[1] - sc.node.pos[1];
        var az = an.pos[2] - sc.node.pos[2];
        if (ax * ax + ay * ay + az * az < 9.0) crew++;
        if (crew >= 3) break;
      }
      sc.workers = crew;
      if (crew <= 0) continue;
      sc.node.radius -= REFILL_RATE * crew * dt;
      sc.repair += dt;
      if (sc.node.radius <= 0.25) {
        this.fx.burst(sc.node.pos, 10, 'dirt', sc.farm.soilTop || [0.5, 0.4, 0.3]);
        this.removeScoop(sc);
      } else if ((this.frame & 31) === 0) {
        sc.farm.dirty = true;
        this.markDirty(sc.farm);
      }
    }
    this.breachCount = need;
    if (need && (this.frame & 63) === 0) this.callAntsToBreaches();
  };

  //  Idle surface workers drift toward the nearest breach. This is a nudge,
  //  not a new job system: they keep their own behaviour, they just have
  //  somewhere to be, which is enough to read as "the colony is repairing
  //  the hole you made".
  Game.callAntsToBreaches = function () {
    if (!this.scoops.length) return;
    var open = [];
    for (var i = 0; i < this.scoops.length; i++) {
      if (this.scoops[i].breach && this.scoops[i].workers < 3) open.push(this.scoops[i]);
    }
    if (!open.length) return;
    var sent = 0;
    for (var a = 0; a < this.ants.length && sent < open.length * 2; a++) {
      var an = this.ants[a];
      if (an.colony !== this.player) continue;
      if (an.mode !== 'surface' || an.surfGoal || an.carry) continue;
      var sc = open[sent % open.length];
      an.surfGoal = [sc.node.pos[0], sc.node.pos[2]];
      sent++;
    }
  };

  //  Nearest breach that still wants a worker. ants.js asks for this when a
  //  worker is picking its next job.
  Game.claimBreach = function (ant) {
    if (!this.scoops.length) return null;
    var best = null, bd = 1e9;
    for (var i = 0; i < this.scoops.length; i++) {
      var sc = this.scoops[i];
      if (!sc.breach || sc.workers >= 3) continue;
      var dx = sc.node.pos[0] - ant.pos[0];
      var dy = sc.node.pos[1] - ant.pos[1];
      var dz = sc.node.pos[2] - ant.pos[2];
      var d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = sc; }
    }
    return best;
  };

  // ------------------------------------------------------------------
  //  input
  // ------------------------------------------------------------------
  var _digT = 0;
  Game.updateDig = function (ray, inp, dt) {
    if (!this.digMode) { this.digGhost = null; return; }
    var farm = this.player.farms[0] || this.activeFarm;
    if (!farm) { this.digGhost = null; return; }
    var hit = this.pourPick(ray.o, ray.d, farm);
    if (!hit) { this.digGhost = null; return; }
    //  sit the scoop centre a little INTO the soil, so a click actually
    //  removes material instead of grazing the surface
    var g = this.digGhost || (this.digGhost = {});
    g.pos = hit;
    g.radius = DIG_R;
    g.breach = breachDepth(farm, hit[0], hit[1] - DIG_R * 0.35, hit[2], DIG_R) > 0;
    g.afford = this.player.biomass >= DIG_COST;

    _digT -= dt;
    if (inp.mouse.down && !inp.uiHover && _digT <= 0) {
      _digT = DIG_INTERVAL;
      this.digScoop(farm, hit[0], hit[1] - DIG_R * 0.35, hit[2]);
    }
  };

  Game.DIG = { radius: DIG_R, cost: DIG_COST };

})(window.AF = window.AF || {});

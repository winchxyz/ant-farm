/* =============================================================
   FORMICARIUM :: DEEP COLONY
   heap.js - poured sugar as a deforming height field.

   Ground model ported from REGOLITH (C:/Users/oxman/moon-rover-dev,
   src/world/terrain.js, Terrain.relax). That project's rule is that dry
   regolith cannot hold a wall: anything steeper than the angle of repose
   flows downhill, and the flow is mass conserving - what leaves one cell
   arrives in its neighbour, never anywhere else.

     const STEP = 0.62 * px;            // ~32 degrees
     if (d > thr) { m = (d - thr) * FLOW * 0.5; D[i] += m; D[j] -= m; }

   That is a far better model for a sugar heap than the particle contact
   solver it replaces. The contact solver could only manage 21-27 degrees,
   scattered stray grains across the tank, and drew three hundred
   separately ink-outlined crystals that read as gravel. A height field
   gives a guaranteed repose angle, cannot lose or invent material, costs
   almost nothing, and draws as ONE smooth mound with ONE outline - which
   is what the rest of this game looks like.

   Water is still particles: a fluid has to fill a carved pit and slosh,
   which a heightfield cannot do. Sugar only ever piles, so it does not
   need them.
   ============================================================= */
(function (AF) {
  'use strict';

  var HP = {};
  var CELL = 0.22;                 // world units per cell
  //  Biggest ground step one cell may span before the mesh treats it as a
  //  dug edge rather than a slope. Repose is 0.66*CELL, so this is about
  //  four times the steepest surface sugar can actually hold.
  var CLIFF = CELL * 4.0;
  var REPOSE = 0.66;               // tan(33.4 deg) - dry sugar
  //  Wet grains hold a STEEPER wall than dry ones, not a flatter one -
  //  capillary bridges between them add cohesion, which is the entire
  //  reason a sandcastle stands up. Having this the wrong way round made
  //  a wetted heap slump into a thin white film spread over the soil.
  //  What water actually does to sugar is DISSOLVE it, handled below.
  var REPOSE_WET = 1.05;           // tan(46 deg) - damp sugar clumps
  var DISSOLVE = 0.055;            // heap units per second per unit wetness
  var FLOW_RATE = 9.0;
  var MIN_H = 0.008;               // below this a cell is empty

  var gx = 0, gz = 0, minX = 0, minZ = 0;
  var H = null;                    // heap height above the ground, per cell
  var W = null;                    // wetness 0..1, per cell
  var gnd = null;                  // baked ground height, per cell
  var farm = null;
  var dirty = false;
  var total = 0;                   // total deposited material (for the economy)

  HP.CELL = CELL;

  HP.init = function (f) {
    farm = f;
    minX = f.center[0] - f.half[0];
    minZ = f.center[2] - f.half[2];
    gx = Math.ceil((f.half[0] * 2) / CELL) + 1;
    gz = Math.ceil((f.half[2] * 2) / CELL) + 1;
    H = new Float32Array(gx * gz);
    W = new Float32Array(gx * gz);
    gnd = new Float32Array(gx * gz);
    HP.rebakeGround();
    dirty = true; total = 0;
  };

  //  THE GROUND IS THE SOIL, NOT THE FORMULA.
  //
  //  This sampled farm.localTop, which is the ANALYTIC terrain height - a
  //  closed-form function of x and z. The shovel does not touch it: digging
  //  subtracts capsules from the soil distance field, and localTop keeps
  //  returning the height the terrain had before anything was dug. Measured
  //  on a live tank: seventy-seven scoops carved a bowl and localTop stayed
  //  at 6.39 throughout.
  //
  //  So sugar poured over an excavation rested at the height of ground that
  //  is no longer there, and hung in the air over the hole.
  //
  //  Start at the analytic top and walk down until the field says solid
  //  (soilSDF is positive in open air, so solid is <= 0). Undug ground is
  //  solid at the very first sample, which is the old behaviour and the same
  //  cost; only cells over a hole pay for the descent.
  var GND_STEP = 0.14;
  var GND_MAX = 5.0;
  //  This used to carry its own copy of the downward march. It lives on Farm
  //  as surfaceTop now, because ants needed the same answer and were using
  //  the analytic height instead - two implementations of "where is the
  //  ground" is exactly how they drift apart.
  function soilTopAt(x, z) {
    return farm.surfaceTop(x, z);
  }

  //  The ground under the heap moves whenever the player digs, so it is
  //  re-sampled rather than assumed.
  HP.rebakeGround = function () {
    if (!farm) return;
    for (var j = 0; j < gz; j++) {
      var wz = minZ + j * CELL;
      for (var i = 0; i < gx; i++) {
        gnd[j * gx + i] = soilTopAt(minX + i * CELL, wz);
      }
    }
    dirty = true;
  };

  HP.reset = function () {
    if (H) { H.fill(0); W.fill(0); }
    total = 0; dirty = true;
  };

  HP.total = function () { return total; };
  HP.isEmpty = function () { return total <= 1e-6; };

  // ---------------------------------------------------------------
  //  deposit
  // ---------------------------------------------------------------
  //  Material lands over a small disc rather than a single cell, so a
  //  stream builds a cone from the first frame instead of a spike that the
  //  relaxation then has to knock down.
  HP.deposit = function (x, z, amount, radius) {
    if (!H) return 0;
    radius = radius || 0.42;
    var ci = (x - minX) / CELL, cj = (z - minZ) / CELL;
    var r = radius / CELL;
    var i0 = Math.max(0, Math.floor(ci - r)), i1 = Math.min(gx - 1, Math.ceil(ci + r));
    var j0 = Math.max(0, Math.floor(cj - r)), j1 = Math.min(gz - 1, Math.ceil(cj + r));
    var wsum = 0, i, j, d, w;
    for (j = j0; j <= j1; j++) for (i = i0; i <= i1; i++) {
      d = Math.sqrt((i - ci) * (i - ci) + (j - cj) * (j - cj)) / r;
      if (d >= 1) continue;
      wsum += (1 - d * d);
    }
    if (wsum <= 0) { wsum = 1; }
    //  amount is a VOLUME; converting through the cell area keeps a pour
    //  the same size whatever the grid resolution happens to be
    var hPer = amount / (CELL * CELL) / wsum;
    var added = 0;
    for (j = j0; j <= j1; j++) for (i = i0; i <= i1; i++) {
      d = Math.sqrt((i - ci) * (i - ci) + (j - cj) * (j - cj)) / r;
      if (d >= 1) continue;
      w = (1 - d * d) * hPer;
      H[j * gx + i] += w;
      added += w * CELL * CELL;
    }
    total += added;
    dirty = true;
    return added;
  };

  //  Water landing on the heap wets it: damp sugar clumps steeper, and
  //  starts dissolving away.
  HP.wet = function (x, z, radius, dt) {
    if (!H) return;
    var ci = (x - minX) / CELL, cj = (z - minZ) / CELL, r = radius / CELL;
    var i0 = Math.max(0, Math.floor(ci - r)), i1 = Math.min(gx - 1, Math.ceil(ci + r));
    var j0 = Math.max(0, Math.floor(cj - r)), j1 = Math.min(gz - 1, Math.ceil(cj + r));
    for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++) {
      var k = j * gx + i;
      if (H[k] <= MIN_H) continue;
      var d = Math.sqrt((i - ci) * (i - ci) + (j - cj) * (j - cj)) / r;
      if (d >= 1) continue;
      W[k] = Math.min(1, W[k] + (1 - d) * dt * 3.0);
      dirty = true;
    }
  };

  // ---------------------------------------------------------------
  //  take material back out (an ant carrying a crumb away)
  // ---------------------------------------------------------------
  HP.take = function (x, z, amount, radius) {
    if (!H) return 0;
    radius = radius || 0.35;
    var ci = (x - minX) / CELL, cj = (z - minZ) / CELL, r = radius / CELL;
    var i0 = Math.max(0, Math.floor(ci - r)), i1 = Math.min(gx - 1, Math.ceil(ci + r));
    var j0 = Math.max(0, Math.floor(cj - r)), j1 = Math.min(gz - 1, Math.ceil(cj + r));
    var want = amount / (CELL * CELL), got = 0;
    for (var j = j0; j <= j1 && want > 0; j++) for (var i = i0; i <= i1 && want > 0; i++) {
      var k = j * gx + i;
      var t = Math.min(H[k], want);
      H[k] -= t; want -= t; got += t * CELL * CELL;
      if (H[k] < MIN_H) { H[k] = 0; W[k] = 0; }
    }
    total = Math.max(0, total - got);
    if (got > 0) dirty = true;
    return got;
  };

  // ---------------------------------------------------------------
  //  angle-of-repose relaxation  (REGOLITH Terrain.relax)
  // ---------------------------------------------------------------
  //  Mass conserving: every gram that leaves a cell lands in the neighbour
  //  it flowed into. The heap therefore cannot grow, shrink, or drift - it
  //  can only find its own shape, and that shape is the repose cone.
  //
  //  The surface that matters is ground + heap, not heap alone: sugar
  //  poured on a slope has to run downhill even where the heap itself is
  //  perfectly level.
  HP.relax = function (dt) {
    if (!H || total <= 1e-6) return;
    var FLOW = Math.min(0.42, dt * FLOW_RATE);
    var STEP = REPOSE * CELL;
    var STEPD = STEP * 1.41421356;
    var moved = 0;
    for (var j = 1; j < gz - 1; j++) {
      for (var i = 1; i < gx - 1; i++) {
        var k = j * gx + i;
        if (H[k] <= MIN_H) continue;
        //  damp sugar holds a steeper wall than dry
        var thr = STEP, thrD = STEPD;
        if (W[k] > 0.15) {
          var mu = REPOSE + (REPOSE_WET - REPOSE) * Math.min(1, (W[k] - 0.15) / 0.5);
          thr = mu * CELL; thrD = thr * 1.41421356;
        }
        var si = gnd[k] + H[k];
        //  four orthogonal neighbours, then four diagonals at the longer
        //  threshold so the cone does not come out square
        moved += flow(k, k - 1, thr, FLOW);
        moved += flow(k, k + 1, thr, FLOW);
        moved += flow(k, k - gx, thr, FLOW);
        moved += flow(k, k + gx, thr, FLOW);
        moved += flow(k, k - gx - 1, thrD, FLOW);
        moved += flow(k, k - gx + 1, thrD, FLOW);
        moved += flow(k, k + gx - 1, thrD, FLOW);
        moved += flow(k, k + gx + 1, thrD, FLOW);
      }
    }
    if (moved > 1e-7) dirty = true;
  };

  function flow(a, b, thr, FLOW) {
    if (H[a] <= MIN_H) return 0;
    var d = (gnd[a] + H[a]) - (gnd[b] + H[b]);
    if (d <= thr) return 0;
    var m = (d - thr) * FLOW * 0.5;
    if (m > H[a]) m = H[a];
    H[a] -= m; H[b] += m;
    //  wetness travels with the material it is carried in
    if (W[a] > 0) {
      var frac = m / Math.max(H[b], 1e-6);
      W[b] = W[b] + (W[a] - W[b]) * Math.min(1, frac);
    }
    return m;
  }

  // ---------------------------------------------------------------
  //  dissolving
  // ---------------------------------------------------------------
  //  Sugar in water goes away. Slowly, so a splash does not wipe out a
  //  heap, but visibly enough that pouring water over your food store is
  //  a mistake the player can see and learn from.
  HP.dissolve = function (dt) {
    if (!H || total <= 1e-6) return 0;
    var gone = 0;
    for (var k = 0; k < H.length; k++) {
      if (H[k] <= MIN_H || W[k] <= 0.05) continue;
      var d = DISSOLVE * W[k] * dt;
      if (d > H[k]) d = H[k];
      H[k] -= d; gone += d * CELL * CELL;
      if (H[k] < MIN_H) { H[k] = 0; W[k] = 0; }
      //  wetness fades as the water it came from soaks away
      W[k] = Math.max(0, W[k] - dt * 0.04);
    }
    if (gone > 0) { total = Math.max(0, total - gone); dirty = true; }
    return gone;
  };

  // ---------------------------------------------------------------
  //  draining into the nest
  // ---------------------------------------------------------------
  //  A height field lies on the terrain and knows nothing about what has
  //  been carved out underneath it, so sugar poured over a nest entrance
  //  just sat on the hole. Water fell straight in, because water is
  //  particles - and the player noticed immediately.
  //
  //  So: wherever the ground under a heap cell is actually OPEN, the heap
  //  hands that material back to the particle solver as falling grains.
  //  They drop down the shaft, land in the chamber, and the foraging code
  //  picks them up there exactly as it always has.
  HP.drain = function (game) {
    if (!H || total <= 1e-6 || !AF.PS || !AF.SDFCache || !farm) return 0;
    var PS = AF.PS, C = AF.SDFCache, made = 0;
    //  BACK PRESSURE. The shaft can only swallow so fast. Without this the
    //  drain produced 180 grains a second - faster than they could fall,
    //  settle and be handed to the foraging code - and two thousand live
    //  grains put the solver at 20ms a frame.
    var live = 0;
    for (var q = 0; q < PS.MAX_RESIDENT; q++) {
      if (PS.alive[q] && PS.mat[q] === PS.MAT_SUGAR) live++;
      if (live > 120) return 0;
    }
    for (var j = 1; j < gz - 1; j++) {
      for (var i = 1; i < gx - 1; i++) {
        var k = j * gx + i;
        if (H[k] <= MIN_H * 3) continue;
        var wx = minX + i * CELL, wz = minZ + j * CELL;
        //  is there a void immediately below the surface here?
        if (C.sample(farm, wx, gnd[k] - 0.45, wz, null) < 0.16) continue;
        //  One particle carries a real scoop of the heap, not a crumb.
        //  Draining 0.10 at a time turned a modest heap into 1800 particles
        //  and nearly exhausted the solver's whole budget on a single pour.
        var take = Math.min(H[k], 0.55);
        H[k] -= take;
        if (H[k] < MIN_H) { H[k] = 0; W[k] = 0; }
        total = Math.max(0, total - take * CELL * CELL);
        dirty = true;
        if (PS.count() < PS.MAX_RESIDENT - 40) {
          //  the grain carries the mass it was made from, so the economy
          //  sees the same amount of food however it got underground
          PS.spawn(PS.MAT_SUGAR, wx, gnd[k] - 0.15, wz,
            0, -0.6, 0, farm, take * CELL * CELL * 900);
          made++;
        }
        if (made >= 3) return made;      // budget per frame
      }
    }
    return made;
  };

  // ---------------------------------------------------------------
  //  queries
  // ---------------------------------------------------------------
  HP.heightAt = function (x, z) {
    if (!H) return 0;
    var fx = (x - minX) / CELL, fz = (z - minZ) / CELL;
    var i = fx | 0, j = fz | 0;
    if (i < 0 || j < 0 || i >= gx - 1 || j >= gz - 1) return 0;
    var tx = fx - i, tz = fz - j;
    var a = H[j * gx + i], b = H[j * gx + i + 1];
    var c = H[(j + 1) * gx + i], d = H[(j + 1) * gx + i + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  };

  HP.surfaceAt = function (x, z) {
    return (farm ? soilTopAt(x, z) : 0) + HP.heightAt(x, z);
  };

  //  Where are the heaps? Used to publish food to the foraging code and to
  //  aim the wet-sugar coupling.
  HP.blobs = function () {
    var out = [];
    if (!H || total <= 1e-6) return out;
    var STRIDE = Math.max(1, Math.round(1.6 / CELL));
    for (var j = 0; j < gz; j += STRIDE) {
      for (var i = 0; i < gx; i += STRIDE) {
        var sum = 0, sx = 0, sz = 0, peak = 0, n = 0;
        for (var b = j; b < Math.min(gz, j + STRIDE); b++) {
          for (var a = i; a < Math.min(gx, i + STRIDE); a++) {
            var h = H[b * gx + a];
            if (h <= MIN_H) continue;
            sum += h; sx += (minX + a * CELL) * h; sz += (minZ + b * CELL) * h;
            if (h > peak) peak = h;
            n++;
          }
        }
        if (sum <= 1e-4 || n === 0) continue;
        out.push({
          x: sx / sum, z: sz / sum,
          amount: sum * CELL * CELL,
          peak: peak
        });
      }
    }
    return out;
  };

  HP.consumeDirty = function () { var d = dirty; dirty = false; return d; };
  HP.markDirty = function () { dirty = true; };

  // ---------------------------------------------------------------
  //  mesh
  // ---------------------------------------------------------------
  //  Rebuilt only when the field actually changed. One triangle pair per
  //  occupied cell; the whole heap is a single draw with a single
  //  silhouette, so the ink pass outlines the mound and nothing inside it.
  var vtx = null, idx = null, vCount = 0, iCount = 0;

  HP.buildMesh = function () {
    if (!H) return 0;
    if (!vtx) { vtx = new Float32Array(60000); idx = new Uint32Array(90000); }
    vCount = 0; iCount = 0;
    if (total <= 1e-6) return 0;
    var vi = 0, ii = 0, base = 0;
    //  A cell is drawn when any corner carries material, so the rim of the
    //  heap tapers to nothing instead of ending in a cliff.
    for (var j = 0; j < gz - 1; j++) {
      for (var i = 0; i < gx - 1; i++) {
        var h00 = H[j * gx + i], h10 = H[j * gx + i + 1];
        var h01 = H[(j + 1) * gx + i], h11 = H[(j + 1) * gx + i + 1];
        if (h00 <= MIN_H && h10 <= MIN_H && h01 <= MIN_H && h11 <= MIN_H) continue;
        if (vi + 4 * 8 > vtx.length || ii + 6 > idx.length) break;
        var x0 = minX + i * CELL, z0 = minZ + j * CELL;
        var g00 = gnd[j * gx + i], g10 = gnd[j * gx + i + 1];
        var g01 = gnd[(j + 1) * gx + i], g11 = gnd[(j + 1) * gx + i + 1];
        //  DO NOT BRIDGE A CLIFF.
        //
        //  A quad is a patch of ground with sugar lying on it, and its four
        //  corners sit at gnd + H. Dig the soil out from under one edge of a
        //  heap and one corner drops several units while its neighbour does
        //  not - measured on a dug pit, ground 7.24 at one sample and 3.19 at
        //  the next, 0.22 apart. The quad spanning that is a three-metre
        //  vertical blade one cell wide, and a heap over a fresh pit came out
        //  as a crown of white spikes and slivers. That is the "shards fly
        //  off the sugar" report.
        //
        //  There is no such surface. The sugar on the rim and the sugar that
        //  slumped into the hole are two separate sheets, so the mesh stops
        //  at the lip of each. A real slope cannot exceed the angle of
        //  repose over one cell, so anything past a few times that is a hole
        //  someone dug, not terrain.
        var gLo = g00 < g10 ? g00 : g10; if (g01 < gLo) gLo = g01; if (g11 < gLo) gLo = g11;
        var gHi = g00 > g10 ? g00 : g10; if (g01 > gHi) gHi = g01; if (g11 > gHi) gHi = g11;
        if (gHi - gLo > CLIFF) continue;
        var w00 = W[j * gx + i], w10 = W[j * gx + i + 1];
        var w01 = W[(j + 1) * gx + i], w11 = W[(j + 1) * gx + i + 1];
        vi = corner(vi, x0, g00 + h00, z0, i, j, h00, w00);
        vi = corner(vi, x0 + CELL, g10 + h10, z0, i + 1, j, h10, w10);
        vi = corner(vi, x0 + CELL, g11 + h11, z0 + CELL, i + 1, j + 1, h11, w11);
        vi = corner(vi, x0, g01 + h01, z0 + CELL, i, j + 1, h01, w01);
        idx[ii++] = base; idx[ii++] = base + 1; idx[ii++] = base + 2;
        idx[ii++] = base; idx[ii++] = base + 2; idx[ii++] = base + 3;
        base += 4;
      }
    }
    vCount = base; iCount = ii;
    return iCount;
  };

  //  normal from the gradient of (ground + heap), so the shading follows
  //  the real surface the material is lying on
  function corner(vi, x, y, z, i, j, h, w) {
    var im = Math.max(0, i - 1), ip = Math.min(gx - 1, i + 1);
    var jm = Math.max(0, j - 1), jp = Math.min(gz - 1, j + 1);
    var hl = gnd[j * gx + im] + H[j * gx + im];
    var hr = gnd[j * gx + ip] + H[j * gx + ip];
    var hd = gnd[jm * gx + i] + H[jm * gx + i];
    var hu = gnd[jp * gx + i] + H[jp * gx + i];
    var nx = hl - hr, ny = 2 * CELL, nz = hd - hu;
    var l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    vtx[vi] = x; vtx[vi + 1] = y; vtx[vi + 2] = z;
    vtx[vi + 3] = nx / l; vtx[vi + 4] = ny / l; vtx[vi + 5] = nz / l;
    vtx[vi + 6] = Math.min(1, h / 0.5);      // thickness, for the rim fade
    vtx[vi + 7] = w;                          // wetness
    return vi + 8;
  }

  HP.mesh = function () { return { vtx: vtx, idx: idx, verts: vCount, indices: iCount }; };

  AF.Heap = HP;

})(window.AF = window.AF || {});

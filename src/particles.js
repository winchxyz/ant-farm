/* =============================================================
   FORMICARIUM :: DEEP COLONY
   particles.js - one position-based solver for water AND sugar.

   The old system had no particle-particle interaction at all: every grain
   fell alone, was pushed out of the soil once, and after 0.22s at rest was
   DELETED and swapped for a static prop. Sugar "piled" via a 2D heightmap;
   water became a flat disc decal. Nothing could rest on anything else, so
   nothing looked or behaved like a material.

   This replaces all of it with a single Position Based Dynamics loop:

     water  - PBF density constraint (Macklin & Muller 2013). Incompressible,
              finds its own level, fills a dug pit, spills over a rim.
     sugar  - non-penetration + Coulomb friction. The angle of repose is not
              scripted; it falls out of the friction coefficient, so a pile
              is a real cone that real contacts are holding up.

   One solver, one spatial hash, one substep clock. That is deliberate: two
   solvers cannot share a substep schedule, and coupling them is where this
   always dies. Sugar participates in the water density sum and receives a
   fraction of the correction, which is the single line that makes sugar
   sink and water get displaced.

   Settled particles SLEEP: they stay resident, stay in the hash as
   colliders, and are skipped by integrate/solve. A settled pool costs its
   hash insert and its draw call and nothing else. That is what makes the
   budget close.
   ============================================================= */
(function (AF) {
  'use strict';

  var PS = {};

  // ---------------------------------------------------------------
  //  Constants - single source of truth
  // ---------------------------------------------------------------
  var H = 0.60;                  // kernel radius AND hash cell size
  var SPACING = 0.30;            // rest spacing
  var PR = 0.17;                 // collision radius against the soil SDF
  var RAD_WATER = 0.37;          // radius the renderer DRAWS a drop at
  var RAD_SUGAR = 0.30;
  var SUB_DT = 1 / 120;
  var MAX_SUB = 2;
  var ITER = 2;
  var GRAV = 26.0;               // matches the feel the old grains had

  var MAX_RESIDENT = 2600;
  var AWAKE_BUDGET = 900;
  var NEIGH_MAX = 40;

  var MAT_WATER = 0, MAT_SUGAR = 1;

  // water
  var RHO0 = 1.0;                // computed by calibrateRestDensity()
  var EPS_CFM = 20.0;      // measured, not taken from the paper - see PS.tune
  var SCORR_K = 0.0005, SCORR_N = 4, SCORR_DQ = 0.2 * H;
  var XSPH_C = 0.10;
  var LEVEL_K = 0.22;
  var MU_SOIL_WATER = 0.38, REST_WATER = 0.02, MASS_WATER = 1.0;

  //  soaking - dry soil drinks the water it is touching
  //  SOIL DRINKS UNTIL IT IS FULL, AND THEN STOPS.
  //
  //  This used to be the whole model: touch soil for SOAK_TIME seconds and
  //  vanish, for ever, no matter how much water had already gone into that
  //  patch of ground. So a pool could never exist. Fill a dug basin to the
  //  brim, walk away, and forty seconds later the basin is dry - which is
  //  not what a basin does, and was reported as water constantly soaking
  //  away when it should not.
  //
  //  Real ground has a capacity. The wetness volume added for the damp-patch
  //  work is exactly that capacity, already indexed by position, already
  //  filled by this function and already drained by the drying tick - it
  //  just was not being READ. A drop now only drains where the soil under it
  //  still has room, so:
  //
  //    - the first water into dry ground soaks away, as it should
  //    - once that patch is saturated the rest of the pool sits on top of it
  //      and stays until something drinks it or it is bailed out
  //    - as the drying tick pulls the wetness back down, the pool starts
  //      seeping again, slowly, from the bottom
  //
  //  SOAK_TIME is also longer than it was. Fourteen seconds is a rate you
  //  notice within one glance at the tank.
  var SOAK_TIME = 34.0;          // mean seconds of contact before a drop is gone
  var SOAK_SAT = 0.80;           // soil wetness at which the ground stops drinking
  var SOAK_CONTACT = PR * 1.25;  // how close to the soil counts as touching

  // sugar
  var D0 = 0.28;                 // contact distance
  var MU_DRY = 0.55;             // repose angle atan(0.55) = 28.8 deg
  var MU_WET = 0.16;
  var MU_SOIL_SUGAR = 0.75, MU_SOIL_SUGAR_WET = 0.20, REST_SUGAR = 0.05, MASS_SUGAR = 1.6;
  var BUOY_FRAC = 0.45;          // sugar takes less of the density push -> sinks

  // wetting
  var WET_GAIN = 2.5, WET_DECAY = 0.03, WET_THRESH = 0.5;

  // sleep
  var SLEEP_V = 0.05, SLEEP_T = 0.45, WAKE_V = 0.25;

  //  The radius the RENDERER draws a particle at, which is not PR (the
  //  collision radius against the soil). water_render.js sizes its blur
  //  kernel from this so the filter always spans one sphere on screen; it
  //  used to carry its own copy in a comment and a fixed ten-texel reach.
  PS.RAD_WATER = RAD_WATER; PS.RAD_SUGAR = RAD_SUGAR;
  PS.H = H; PS.PR = PR; PS.SPACING = SPACING;
  PS.MAT_WATER = MAT_WATER; PS.MAT_SUGAR = MAT_SUGAR;
  PS.MU_DRY = MU_DRY; PS.MAX_RESIDENT = MAX_RESIDENT;

  // ---------------------------------------------------------------
  //  Storage (structure of arrays - the solver is a tight numeric loop
  //  and an array of objects would spend its whole budget chasing pointers)
  // ---------------------------------------------------------------
  var N = MAX_RESIDENT;
  var px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
  var vx = new Float32Array(N), vy = new Float32Array(N), vz = new Float32Array(N);
  var ox = new Float32Array(N), oy = new Float32Array(N), oz = new Float32Array(N); // predicted
  var dpx = new Float32Array(N), dpy = new Float32Array(N), dpz = new Float32Array(N);
  var lam = new Float32Array(N), rho = new Float32Array(N);
  var mat = new Uint8Array(N), mass = new Float32Array(N), amt = new Float32Array(N);
  var wet = new Float32Array(N), restT = new Float32Array(N), rad = new Float32Array(N);
  var soak = new Float32Array(N), soakCap = new Float32Array(N);
  var asleep = new Uint8Array(N), alive = new Uint8Array(N);
  var cid = new Int32Array(N);
  var nbr = new Int32Array(N * NEIGH_MAX), nbrN = new Int32Array(N);
  var nrmAcc = new Float32Array(N);   // normal correction accumulated this substep

  var freeList = new Int32Array(N), freeTop = 0;
  var count = 0;                 // resident (alive) count
  var maxIdx = 0;                // highest slot ever used + 1
  var awakeList = new Int32Array(N), awakeN = 0;

  PS.px = px; PS.py = py; PS.pz = pz; PS.mat = mat; PS.alive = alive;
  PS.asleep = asleep; PS.wet = wet; PS.rad = rad; PS.nbrN = nbrN; PS.cid = cid;
  PS.amt = amt;

  var _farm = null;

  PS.reset = function () {
    count = 0; maxIdx = 0; freeTop = 0; awakeN = 0;
    alive.fill(0); asleep.fill(0); soak.fill(0); soakCap.fill(0);
    PS.clusters = [];
    _clusterT = 0;
  };
  PS.reset();

  // ---------------------------------------------------------------
  //  Kernels
  // ---------------------------------------------------------------
  var H2 = H * H;
  var POLY6 = 315 / (64 * Math.PI * Math.pow(H, 9));
  var SPIKY = -45 / (Math.PI * Math.pow(H, 6));
  function poly6(r2) { var t = H2 - r2; return t <= 0 ? 0 : POLY6 * t * t * t; }
  var WDQ = poly6(SCORR_DQ * SCORR_DQ);

  //  Rest density is COMPUTED, never hand-tuned. Hand-tuning it is the
  //  classic way to end up with a fluid that slowly explodes or slowly
  //  collapses: the number has to match the kernel and the spacing exactly.
  PS.calibrateRestDensity = function () {
    var s = 0, k = Math.ceil(H / SPACING);
    for (var i = -k; i <= k; i++)
      for (var j = -k; j <= k; j++)
        for (var l = -k; l <= k; l++) {
          var r2 = (i * i + j * j + l * l) * SPACING * SPACING;
          if (r2 < H2) s += poly6(r2);
        }
    RHO0 = s * MASS_WATER;
    PS.RHO0 = RHO0;
    return RHO0;
  };
  PS.calibrateRestDensity();

  // ---------------------------------------------------------------
  //  Soil field - the ONLY place the solver touches it, and it always
  //  goes through the cache. The exact field walks up to 508 tunnel
  //  capsules per call (209ns); the cache is 38ns including the gradient.
  // ---------------------------------------------------------------
  var _g = new Float32Array(3);
  PS.sdf = function (farm, x, y, z, out) {
    return AF.SDFCache.sample(farm, x, y, z, out);
  };

  // ---------------------------------------------------------------
  //  Spawn / remove
  // ---------------------------------------------------------------
  PS.spawn = function (material, x, y, z, ivx, ivy, ivz, farm, amount) {
    var i;
    if (freeTop > 0) i = freeList[--freeTop];
    else if (maxIdx < N) i = maxIdx++;
    else return -1;
    alive[i] = 1; asleep[i] = 0; count++;
    _farm = farm || _farm;
    px[i] = x; py[i] = y; pz[i] = z;
    vx[i] = ivx || 0; vy[i] = ivy || 0; vz[i] = ivz || 0;
    mat[i] = material;
    mass[i] = material === MAT_WATER ? MASS_WATER : MASS_SUGAR;
    rad[i] = material === MAT_WATER ? RAD_WATER : RAD_SUGAR;
    amt[i] = amount === undefined ? (material === MAT_WATER ? 0.55 : 0.42) : amount;
    wet[i] = 0; restT[i] = 0; cid[i] = -1;
    //  Every drop gets its own patience. Without the spread a puddle
    //  poured in one go touches the soil in one go and then vanishes in
    //  one go - 700 particles gone inside four seconds, a cliff rather
    //  than a drain. Staggered, the pool sinks away steadily.
    soak[i] = 0; soakCap[i] = SOAK_TIME * (0.5 + Math.random());
    return i;
  };

  PS.remove = function (i) {
    if (!alive[i]) return;
    alive[i] = 0; asleep[i] = 0; count--;
    if (freeTop < N) freeList[freeTop++] = i;
  };

  //  A grain wedged inside a pile can jitter forever without ever formally
  //  sleeping. For "has this stopped being interesting?" that is the wrong
  //  test, so ask about speed directly.
  PS.isSlow = function (i) {
    return (vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]) < 0.36;
  };

  PS.count = function () { return count; };
  PS.awakeCount = function () { return awakeN; };

  // ---------------------------------------------------------------
  //  Spatial hash - counting sort, no Map, no string keys.
  // ---------------------------------------------------------------
  var gMinX = 0, gMinY = 0, gMinZ = 0, gx = 1, gy = 1, gz = 1, nCell = 1;
  var cellStart = null, cellItems = new Int32Array(N), cellOf = new Int32Array(N);
  var cellCursor = null;

  function ensureGrid(farm) {
    if (!farm) return false;
    var nx = Math.ceil((farm.half[0] * 2 + 4) / H) + 2;
    var ny = Math.ceil((farm.half[1] * 2 + 8) / H) + 2;
    var nz = Math.ceil((farm.half[2] * 2 + 4) / H) + 2;
    if (nx === gx && ny === gy && nz === gz && cellStart) {
      gMinX = farm.center[0] - farm.half[0] - 2;
      gMinY = farm.center[1] - farm.half[1] - 2;
      gMinZ = farm.center[2] - farm.half[2] - 2;
      return true;
    }
    gx = nx; gy = ny; gz = nz; nCell = gx * gy * gz;
    gMinX = farm.center[0] - farm.half[0] - 2;
    gMinY = farm.center[1] - farm.half[1] - 2;
    gMinZ = farm.center[2] - farm.half[2] - 2;
    cellStart = new Int32Array(nCell + 1);
    cellCursor = new Int32Array(nCell);
    return true;
  }

  function cellIndex(x, y, z) {
    var a = (x - gMinX) / H | 0, b = (y - gMinY) / H | 0, c = (z - gMinZ) / H | 0;
    if (a < 0) a = 0; else if (a >= gx) a = gx - 1;
    if (b < 0) b = 0; else if (b >= gy) b = gy - 1;
    if (c < 0) c = 0; else if (c >= gz) c = gz - 1;
    return a + gx * (b + gy * c);
  }

  //  Hash EVERY resident particle, awake or not: a sleeping pool still has
  //  to collide with the drop you are pouring into it.
  PS.buildHash = function () {
    cellStart.fill(0);
    var i;
    for (i = 0; i < maxIdx; i++) {
      if (!alive[i]) continue;
      var c = cellIndex(ox[i], oy[i], oz[i]);
      cellOf[i] = c; cellStart[c + 1]++;
    }
    for (i = 0; i < nCell; i++) cellStart[i + 1] += cellStart[i];
    cellCursor.set(cellStart.subarray(0, nCell));
    for (i = 0; i < maxIdx; i++) {
      if (!alive[i]) continue;
      cellItems[cellCursor[cellOf[i]]++] = i;
    }
  };

  //  Neighbour lists for AWAKE particles only.
  PS.buildNeighbours = function () {
    for (var a = 0; a < awakeN; a++) {
      var i = awakeList[a];
      var xi = ox[i], yi = oy[i], zi = oz[i];
      var ci = (xi - gMinX) / H | 0, cj = (yi - gMinY) / H | 0, ck = (zi - gMinZ) / H | 0;
      var base = i * NEIGH_MAX, n = 0;
      for (var dz = -1; dz <= 1; dz++) {
        var Z = ck + dz; if (Z < 0 || Z >= gz) continue;
        for (var dy = -1; dy <= 1; dy++) {
          var Y = cj + dy; if (Y < 0 || Y >= gy) continue;
          for (var dx = -1; dx <= 1; dx++) {
            var X = ci + dx; if (X < 0 || X >= gx) continue;
            var c = X + gx * (Y + gy * Z), s = cellStart[c], e = cellStart[c + 1];
            for (var k = s; k < e; k++) {
              var j = cellItems[k];
              if (j === i) continue;
              var ax = xi - ox[j], ay = yi - oy[j], az = zi - oz[j];
              if (ax * ax + ay * ay + az * az < H2) {
                if (n < NEIGH_MAX) nbr[base + n++] = j;
              }
            }
          }
        }
      }
      nbrN[i] = n;
    }
  };

  // ---------------------------------------------------------------
  //  PBF density constraint (water)
  // ---------------------------------------------------------------
  PS.solveWater = function () {
    var a, i, k, j, base, n;
    //  density + lambda
    for (a = 0; a < awakeN; a++) {
      i = awakeList[a];
      if (mat[i] !== MAT_WATER) continue;
      base = i * NEIGH_MAX; n = nbrN[i];
      var r = poly6(0) * mass[i];
      var gsx = 0, gsy = 0, gsz = 0, sumSq = 0;
      for (k = 0; k < n; k++) {
        j = nbr[base + k];
        var ax = ox[i] - ox[j], ay = oy[i] - oy[j], az = oz[i] - oz[j];
        var r2 = ax * ax + ay * ay + az * az;
        if (r2 >= H2) continue;
        r += poly6(r2) * mass[j];
        var d = Math.sqrt(r2);
        if (d < 1e-6) continue;
        var t = H - d, w = SPIKY * t * t / d;   // grad magnitude / d
        var qx = ax * w / RHO0, qy = ay * w / RHO0, qz = az * w / RHO0;
        gsx += qx; gsy += qy; gsz += qz;
        sumSq += qx * qx + qy * qy + qz * qz;
      }
      rho[i] = r;
      sumSq += gsx * gsx + gsy * gsy + gsz * gsz;
      lam[i] = -((r / RHO0) - 1) / (sumSq + EPS_CFM);
    }
    //  position delta
    for (a = 0; a < awakeN; a++) {
      i = awakeList[a];
      if (mat[i] !== MAT_WATER) continue;
      base = i * NEIGH_MAX; n = nbrN[i];
      var sx = 0, sy = 0, sz = 0;
      for (k = 0; k < n; k++) {
        j = nbr[base + k];
        var bx = ox[i] - ox[j], by = oy[i] - oy[j], bz = oz[i] - oz[j];
        var q2 = bx * bx + by * by + bz * bz;
        if (q2 >= H2 || q2 < 1e-12) continue;
        var dd = Math.sqrt(q2);
        var tt = H - dd, ww = SPIKY * tt * tt / dd;
        //  Artificial pressure: without it particles clump into strings and
        //  the surface goes lumpy. This is the tensile-instability fix.
        var ratio = poly6(q2) / WDQ;
        var scorr = -SCORR_K * ratio * ratio * ratio * ratio;   // n = 4
        var lj = mat[j] === MAT_WATER ? lam[j] : 0;
        var co = (lam[i] + lj + scorr) / RHO0;
        sx += bx * ww * co; sy += by * ww * co; sz += bz * ww * co;
      }
      dpx[i] = sx; dpy[i] = sy; dpz[i] = sz;
    }
    //  apply. Sugar caught inside the fluid takes only part of the push,
    //  so it settles through the water instead of floating on it.
    for (a = 0; a < awakeN; a++) {
      i = awakeList[a];
      if (mat[i] === MAT_WATER) {
        ox[i] += dpx[i]; oy[i] += dpy[i]; oz[i] += dpz[i];
      }
    }
    //  push sugar out of over-dense water regions (buoyancy coupling)
    for (a = 0; a < awakeN; a++) {
      i = awakeList[a];
      if (mat[i] !== MAT_SUGAR) continue;
      base = i * NEIGH_MAX; n = nbrN[i];
      var ux = 0, uy = 0, uz = 0, hit = 0;
      for (k = 0; k < n; k++) {
        j = nbr[base + k];
        if (mat[j] !== MAT_WATER) continue;
        var cx = ox[i] - ox[j], cy = oy[i] - oy[j], cz = oz[i] - oz[j];
        var e2 = cx * cx + cy * cy + cz * cz;
        if (e2 >= H2 || e2 < 1e-12) continue;
        var ed = Math.sqrt(e2);
        var et = H - ed, ew = SPIKY * et * et / ed;
        var eo = (lam[j]) / RHO0 * BUOY_FRAC;
        ux += cx * ew * eo; uy += cy * ew * eo; uz += cz * ew * eo;
        hit++;
      }
      if (hit) { ox[i] += ux; oy[i] += uy; oz[i] += uz; }
    }
  };

  // ---------------------------------------------------------------
  //  Granular contacts + Coulomb friction (sugar)
  //
  //  The angle of repose is NOT scripted anywhere. It emerges from mu:
  //  atan(MU_DRY) = 28.8 degrees dry, atan(MU_WET) = 9.1 degrees wet, so
  //  pouring water on a sugar cone visibly slumps it.
  // ---------------------------------------------------------------
  PS.solveSugar = function () {
    var a, i, k;
    //  Accumulate every contact correction first, then apply it once with a
    //  cap on the total.
    //
    //  Applying each contact immediately (Gauss-Seidel) is fine while grains
    //  trickle in, but the moment a whole packed cone wakes at once - which
    //  is exactly what happens when water wets it - a deeply buried grain
    //  receives twenty separate pushes in one iteration and is fired out of
    //  the pile. Capping the SUM is what keeps a wet pile slumping instead
    //  of erupting.
    for (a = 0; a < awakeN; a++) {
      i = awakeList[a];
      if (mat[i] !== MAT_SUGAR) continue;
      dpx[i] = 0; dpy[i] = 0; dpz[i] = 0;
    }
    for (a = 0; a < awakeN; a++) {
      i = awakeList[a];
      if (mat[i] !== MAT_SUGAR) continue;
      var base = i * NEIGH_MAX, n = nbrN[i];
      var mu = wet[i] > WET_THRESH ? MU_WET : MU_DRY;
      for (k = 0; k < n; k++) {
        var j = nbr[base + k];
        var ax = ox[i] - ox[j], ay = oy[i] - oy[j], az = oz[i] - oz[j];
        var r2 = ax * ax + ay * ay + az * az;
        var contact = mat[j] === MAT_SUGAR ? D0 : D0 * 0.9;
        if (r2 >= contact * contact) continue;
        var d = Math.sqrt(r2), nx, ny, nz;
        if (d < 1e-6) {
          //  perfectly coincident: pick a deterministic direction rather
          //  than dividing by zero
          nx = ((i * 13 + k) % 7) / 7 - 0.5; ny = 1; nz = ((i * 29 + k) % 5) / 5 - 0.5;
          var nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
          nx /= nl; ny /= nl; nz /= nl; d = 1e-6;
        } else { nx = ax / d; ny = ay / d; nz = az / d; }
        var pen = contact - d;
        if (pen > contact * 0.55) pen = contact * 0.55;

        var wi, wj;
        if (asleep[j]) { wi = 1; wj = 0; }
        else { var tot = mass[i] + mass[j]; wi = mass[j] / tot; wj = mass[i] / tot; }

        dpx[i] += nx * pen * wi; dpy[i] += ny * pen * wi; dpz[i] += nz * pen * wi;
        if (!asleep[j] && mat[j] === MAT_SUGAR) {
          dpx[j] -= nx * pen * wj; dpy[j] -= ny * pen * wj; dpz[j] -= nz * pen * wj;
        }

        //  Coulomb friction on the tangential relative motion of this
        //  substep, clamped to mu * (normal correction). That clamp is the
        //  whole reason a heap can hold a slope instead of flowing flat,
        //  and lowering mu when the grain is wet is what makes water
        //  visibly collapse a sugar cone.
        var rx = (ox[i] - px[i]) - (ox[j] - px[j]);
        var ry = (oy[i] - py[i]) - (oy[j] - py[j]);
        var rz = (oz[i] - pz[i]) - (oz[j] - pz[j]);
        var rn = rx * nx + ry * ny + rz * nz;
        var tx = rx - nx * rn, ty = ry - ny * rn, tz = rz - nz * rn;
        var tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (tl > 1e-7) {
          var maxF = mu * pen;
          var sc = tl <= maxF ? 1 : maxF / tl;
          dpx[i] -= tx * sc * wi; dpy[i] -= ty * sc * wi; dpz[i] -= tz * sc * wi;
          if (!asleep[j] && mat[j] === MAT_SUGAR) {
            dpx[j] += tx * sc * wj; dpy[j] += ty * sc * wj; dpz[j] += tz * sc * wj;
          }
        }
      }
    }
    var MAXC = D0 * 0.5;
    for (a = 0; a < awakeN; a++) {
      i = awakeList[a];
      if (mat[i] !== MAT_SUGAR) continue;
      var l2 = dpx[i] * dpx[i] + dpy[i] * dpy[i] + dpz[i] * dpz[i];
      if (l2 > MAXC * MAXC) {
        var fsc = MAXC / Math.sqrt(l2);
        dpx[i] *= fsc; dpy[i] *= fsc; dpz[i] *= fsc;
      }
      ox[i] += dpx[i]; oy[i] += dpy[i]; oz[i] += dpz[i];
    }
  };

  // ---------------------------------------------------------------
  //  Soil + glass
  // ---------------------------------------------------------------
  PS.collideSoil = function (farm) {
    var hx = farm.half[0] - 0.4, hz = farm.half[2] - 0.4;
    var cx0 = farm.center[0], cz0 = farm.center[2];
    var floorY = farm.center[1] - farm.half[1] + 0.25;
    for (var a = 0; a < awakeN; a++) {
      var i = awakeList[a];
      var d = PS.sdf(farm, ox[i], oy[i], oz[i], _g);
      if (d < PR) {
        var push = PR - d;
        ox[i] += _g[0] * push; oy[i] += _g[1] * push; oz[i] += _g[2] * push;
        //  Remember how hard the ground had to push. Friction is applied
        //  once, at the end of the substep, against this total - see
        //  frictionSoil for why it cannot be done here.
        nrmAcc[i] += push;
      }
      // glass
      if (ox[i] < cx0 - hx) ox[i] = cx0 - hx;
      else if (ox[i] > cx0 + hx) ox[i] = cx0 + hx;
      if (oz[i] < cz0 - hz) oz[i] = cz0 - hz;
      else if (oz[i] > cz0 + hz) oz[i] = cz0 + hz;
      if (oy[i] < floorY) oy[i] = floorY;
    }
  };

  //  Coulomb friction against the ground, applied ONCE per substep.
  //
  //  It cannot live inside collideSoil: that runs several times per substep,
  //  and after the first call the penetration has already been resolved, so
  //  `PR - d` is ~0 and the friction budget mu*(PR-d) collapses to nothing.
  //  Grains then landed and slid, frictionless, right across the tank.
  //
  //  Against the TOTAL normal correction the budget is mu*g*dt^2 per substep,
  //  which integrates to a deceleration of mu*g - an honest friction cone.
  PS.frictionSoil = function (farm) {
    for (var a = 0; a < awakeN; a++) {
      var i = awakeList[a];
      var acc = nrmAcc[i];
      if (acc <= 1e-9) continue;
      PS.sdf(farm, ox[i], oy[i], oz[i], _g);
      var gx0 = _g[0], gy0 = _g[1], gz0 = _g[2];
      var rx = ox[i] - px[i], ry = oy[i] - py[i], rz = oz[i] - pz[i];
      var rn = rx * gx0 + ry * gy0 + rz * gz0;
      var tx = rx - gx0 * rn, ty = ry - gy0 * rn, tz = rz - gz0 * rn;
      var tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tl < 1e-7) continue;
      var mu = mat[i] === MAT_SUGAR
        ? (wet[i] > WET_THRESH ? MU_SOIL_SUGAR_WET : MU_SOIL_SUGAR)
        : MU_SOIL_WATER;
      var maxF = mu * acc;
      var sc = tl <= maxF ? 1 : maxF / tl;
      ox[i] -= tx * sc; oy[i] -= ty * sc; oz[i] -= tz * sc;
    }
  };

  // ---------------------------------------------------------------
  //  Surface levelling - the single biggest "it looks like water" win.
  //  Without it a pool's top surface stays lumpy no matter how many
  //  solver iterations you spend.
  // ---------------------------------------------------------------
  PS.levelWater = function () {
    for (var a = 0; a < awakeN; a++) {
      var i = awakeList[a];
      if (mat[i] !== MAT_WATER) continue;
      var base = i * NEIGH_MAX, n = nbrN[i];
      if (n < 10) continue;
      var s = 0, c = 0;
      for (var k = 0; k < n; k++) {
        var j = nbr[base + k];
        if (mat[j] !== MAT_WATER) continue;
        s += oy[j]; c++;
      }
      if (c >= 6) oy[i] += LEVEL_K * (s / c - oy[i]);
    }
  };

  // ---------------------------------------------------------------
  //  Wetness - sugar touching water goes slick and slumps
  // ---------------------------------------------------------------
  //  Wetting is driven from the WATER side, not the sugar side.
  //
  //  Neighbour lists only exist for awake particles, and a settled sugar
  //  pile is asleep - so asking each sugar grain "is there water near me?"
  //  never fires for the grains that matter. Asking each awake water
  //  particle "what sugar am I touching?" does, and it can wake that grain
  //  so the pile actually slumps instead of staying frozen in a wet cone.
  PS.updateWetness = function (dt) {
    var a, i, k;
    for (a = 0; a < awakeN; a++) {
      i = awakeList[a];
      if (mat[i] !== MAT_WATER) continue;
      var base = i * NEIGH_MAX, n = nbrN[i];
      for (k = 0; k < n; k++) {
        var j = nbr[base + k];
        if (mat[j] !== MAT_SUGAR) continue;
        var was = wet[j];
        wet[j] = Math.min(1, wet[j] + WET_GAIN * dt);
        //  it just went slick - it has to be simulated again to slump
        if (was <= WET_THRESH && wet[j] > WET_THRESH && asleep[j]) {
          asleep[j] = 0; restT[j] = 0;
        }
      }
    }
    //  dry back out, awake grains only (a sleeping dry grain has nothing to do)
    for (a = 0; a < awakeN; a++) {
      i = awakeList[a];
      if (mat[i] !== MAT_SUGAR || wet[i] <= 0) continue;
      var base2 = i * NEIGH_MAX, n2 = nbrN[i], touch = 0;
      for (k = 0; k < n2; k++) if (mat[nbr[base2 + k]] === MAT_WATER) { touch = 1; break; }
      if (!touch) wet[i] = Math.max(0, wet[i] - WET_DECAY * dt);
    }
  };

  // ---------------------------------------------------------------
  //  Sleep / wake
  // ---------------------------------------------------------------
  PS.sleepPass = function (dt) {
    var a, i, k;
    for (a = 0; a < awakeN; a++) {
      i = awakeList[a];
      var s2 = vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i];
      if (s2 < SLEEP_V * SLEEP_V) {
        restT[i] += dt;
        if (restT[i] > SLEEP_T) { asleep[i] = 1; vx[i] = vy[i] = vz[i] = 0; }
      } else {
        restT[i] = 0;
        //  a fast mover wakes what it is about to hit
        if (s2 > WAKE_V * WAKE_V) {
          var base = i * NEIGH_MAX, n = nbrN[i];
          for (k = 0; k < n; k++) {
            var j = nbr[base + k];
            if (asleep[j]) { asleep[j] = 0; restT[j] = 0; }
          }
        }
      }
    }
  };

  PS.wakeAll = function () {
    for (var i = 0; i < maxIdx; i++) if (alive[i]) { asleep[i] = 0; restT[i] = 0; }
  };

  PS.wakeNear = function (x, y, z, r) {
    var r2 = r * r, n = 0;
    for (var i = 0; i < maxIdx; i++) {
      if (!alive[i] || !asleep[i]) continue;
      var ax = px[i] - x, ay = py[i] - y, az = pz[i] - z;
      if (ax * ax + ay * ay + az * az < r2) { asleep[i] = 0; restT[i] = 0; n++; }
    }
    return n;
  };

  // ---------------------------------------------------------------
  //  Budget. Never shift() the oldest particle - that deletes something
  //  still falling, in front of the player. Merge settled pairs instead.
  // ---------------------------------------------------------------
  PS.enforceBudget = function () {
    if (count < MAX_RESIDENT - 8) return 0;
    var merged = 0;
    for (var i = 0; i < maxIdx && merged < 8; i++) {
      if (!alive[i] || !asleep[i]) continue;
      var base = i * NEIGH_MAX, n = nbrN[i];
      for (var k = 0; k < n && merged < 8; k++) {
        var j = nbr[base + k];
        if (!alive[j] || !asleep[j] || mat[j] !== mat[i] || j === i) continue;
        if (mass[i] > mass[i] * 3) continue;
        amt[i] += amt[j]; mass[i] += mass[j];
        rad[i] = Math.min(rad[i] * 1.45, rad[i] * Math.cbrt(mass[i] / (mat[i] === MAT_WATER ? MASS_WATER : MASS_SUGAR)));
        PS.remove(j);
        merged++;
      }
    }
    return merged;
  };

  // ---------------------------------------------------------------
  //  Step - fixed accumulator on RAW time.
  //
  //  The sim clock runs up to 8x (Game.update: dt = min(rawDt,0.05)*speed,
  //  so dt reaches 0.4s). Feeding that to a position-based solver is an
  //  instant blow-up. Fast-forwarding water is not a feature anybody asked
  //  for, so the solver simply ignores game speed and runs on real time.
  // ---------------------------------------------------------------
  var acc = 0;
  var _clusterT = 0;
  PS.stats = { solveMs: 0, substeps: 0, awake: 0, resident: 0 };

  // ---------------------------------------------------------------
  //  WETNESS VOLUME - the ground remembers where the water went
  //
  //  soakIntoSoil below deletes water into the soil, and until now that was
  //  the end of it: the drop vanished and the ground it drained into looked
  //  exactly as dry as before it was poured on.
  //
  //  The live-pool decal in Game.pushWet cannot stand in for this. It is
  //  keyed off PS.clusters, which are rebuilt from ALIVE particles every
  //  half second, so the damp patch disappears in the same step as the last
  //  drop - the one moment the player is actually looking for it. It is
  //  also a flat quad dropped at farm.localTop(), the analytic heightfield,
  //  which knows nothing about excavation: inside a dug Water Pit the dark
  //  disc hangs in the air at the old ground level, and on a tunnel wall it
  //  cannot appear at all.
  //
  //  So wetness is stored where the soil is stored: a scalar volume over
  //  exactly the same world box as the baked SDF (farm.sdfMin..farm.sdfMax),
  //  sampled by SOIL_FS at whatever world point the raymarch stopped at. Pit
  //  floor, tunnel wall and flat top are the same fragment shader hitting
  //  the same field, so all three come out damp for free.
  //
  //  Resolution: 90 x 40 x 30 over a 54 x 23 x 17 box, i.e. cells of
  //  0.600 x 0.575 x 0.567 - as close to cubic as integer counts get on a
  //  box that shape. The cell size is the fluid kernel radius H (0.60) on
  //  purpose: a wetness field cannot carry detail finer than the water that
  //  wrote it, and anything smaller only costs memory. That is 108,000
  //  texels - 108,000 bytes on the GPU as R8, a third of the 96x60x56 SDF -
  //  and 648,000 bytes on the CPU: a Float32 accumulator, because a single
  //  frame deposits far less than one 1/255 quantum and a byte field would
  //  quantise the accumulation away entirely, plus a Uint8 mirror of what
  //  the texture currently holds and a Uint8 staging buffer for the sub-box
  //  upload.
  // ---------------------------------------------------------------
  var WGX = 90, WGY = 40, WGZ = 30;
  var WET_TICK = 0.15;        // seconds between dry-and-upload passes
  var WET_DRY_TAU = 75.0;     // e-folding time of a damp patch, seconds
  var WET_SIT = 0.06;         // saturation rate per second per touching drop
  var WET_DROP = 0.10;        // extra dumped by a drop that finishes draining
  //  How far INSIDE the soil a splat is centred. Not zero, because half of
  //  a splat centred exactly on the surface lands in cells that are air and
  //  the raymarch never visits - that half is simply thrown away. Not deep
  //  either: the raymarch stops essentially AT the surface (SOIL_FS breaks
  //  on d<0.008), so whatever the shader reads is a trilinear sample taken
  //  there, and burying the splat centre by half a cell costs half the mark.
  //  Cell height is 23/40 = 0.575, so 0.14 is a quarter of a cell: the
  //  deposit still lands in soil, and the surface reads about three quarters
  //  of the peak instead of the half that 0.30 gave. Measured: a drained
  //  puddle went from 7.6% to 18.6% peak darkening on the same pour.
  var WET_BURY = 0.14;

  var Wet = {};
  Wet.GX = WGX; Wet.GY = WGY; Wet.GZ = WGZ;

  //  No initial data is handed to texImage3D. WebGL guarantees a texture
  //  created with null contents reads back as zero, which is exactly "dry",
  //  and passing a packed 90-byte-wide R8 array here would hit the same
  //  UNPACK_ALIGNMENT trap that GLX.texture3DSub exists to sidestep.
  Wet.create = function (farm) {
    var GLX = AF.GLX, gl = GLX && GLX.gl;
    if (!gl || !farm || !farm.sdfMin) return null;
    var n = WGX * WGY * WGZ;
    return {
      gx: WGX, gy: WGY, gz: WGZ,
      min: [farm.sdfMin[0], farm.sdfMin[1], farm.sdfMin[2]],
      cell: [(farm.sdfMax[0] - farm.sdfMin[0]) / WGX,
             (farm.sdfMax[1] - farm.sdfMin[1]) / WGY,
             (farm.sdfMax[2] - farm.sdfMin[2]) / WGZ],
      f: new Float32Array(n),      // accumulator, 0..1
      u8: new Uint8Array(n),       // what the texture currently holds
      pack: new Uint8Array(n),     // staging for one sub-box upload
      lo: [WGX, WGY, WGZ], hi: [-1, -1, -1],   // cells holding anything
      dlo: [WGX, WGY, WGZ], dhi: [-1, -1, -1], // cells the texture lacks
      acc: 0, uploads: 0, texels: 0,
      tex: GLX.texture3D({
        width: WGX, height: WGY, depth: WGZ,
        internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE
      })
    };
  };

  //  Deposit wetness at a world point, spread across the eight texels a
  //  trilinear FETCH at that point would read. This is the exact adjoint of
  //  the shader's texture() call, and it is written out longhand because of
  //  the half texel: BAKE_FS puts texel i at uvw=(i+0.5)/g (see
  //  'vec3 cell=vec3(gl_FragCoord.xy,uLayer+0.5)' in shaders.js), so the CPU
  //  has to subtract that same 0.5 or every patch lands a third of a cell
  //  off in each axis - a damp mark that visibly does not line up with the
  //  puddle that made it.
  //
  //  The deposit SATURATES: each texel moves a fraction of the way to 1
  //  rather than adding a fixed amount. That is what makes the rates above
  //  robust. A linear accumulator has to be tuned against how many drops
  //  happen to be touching soil per cell per second, which changes with the
  //  size of the pour and the shape of what it lands in; a saturating one
  //  cannot overshoot however much water is tipped on it, and a single drop
  //  passing over still leaves only a faint mark.
  Wet.add = function (v, x, y, z, a) {
    if (!v || !(a > 0)) return;
    if (a > 1) a = 1;
    var fx = (x - v.min[0]) / v.cell[0] - 0.5;
    var fy = (y - v.min[1]) / v.cell[1] - 0.5;
    var fz = (z - v.min[2]) / v.cell[2] - 0.5;
    var i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz);
    var tx = fx - i0, ty = fy - j0, tz = fz - k0;
    var f = v.f, gx = v.gx, gy = v.gy, gz = v.gz, gxy = gx * gy;
    for (var dz = 0; dz < 2; dz++) {
      var kk = k0 + dz; if (kk < 0 || kk >= gz) continue;
      var wz = dz ? tz : 1 - tz;
      for (var dy = 0; dy < 2; dy++) {
        var jj = j0 + dy; if (jj < 0 || jj >= gy) continue;
        var wy = wz * (dy ? ty : 1 - ty);
        for (var dx = 0; dx < 2; dx++) {
          var ii = i0 + dx; if (ii < 0 || ii >= gx) continue;
          var w = wy * (dx ? tx : 1 - tx);
          if (w <= 0) continue;
          var idx = ii + jj * gx + kk * gxy;
          f[idx] += (1 - f[idx]) * w * a;
          if (ii < v.lo[0]) v.lo[0] = ii;
          if (ii > v.hi[0]) v.hi[0] = ii;
          if (jj < v.lo[1]) v.lo[1] = jj;
          if (jj > v.hi[1]) v.hi[1] = jj;
          if (kk < v.lo[2]) v.lo[2] = kk;
          if (kk > v.hi[2]) v.hi[2] = kk;
        }
      }
    }
  };

  //  Push the cells the texture has not been told about yet, and only those.
  //  Returns the number of texels sent, which is the number to watch when
  //  arguing about whether this is expensive: a normal pour dirties a box of
  //  perhaps 10x6x10 and sends 600 bytes; the worst case anyone can
  //  construct - the entire field wet and drying at once - is 108,000 bytes,
  //  and at the tick rate below that is 720 KB/s. Re-sending the whole
  //  volume every frame instead would be 6.5 MB/s for no visible gain.
  Wet.upload = function (v) {
    if (!v || v.dhi[0] < v.dlo[0]) return 0;
    var GLX = AF.GLX;
    if (!GLX || !GLX.gl) return 0;
    var x0 = v.dlo[0], y0 = v.dlo[1], z0 = v.dlo[2];
    var w = v.dhi[0] - x0 + 1, h = v.dhi[1] - y0 + 1, d = v.dhi[2] - z0 + 1;
    var u8 = v.u8, pk = v.pack, gx = v.gx, gxy = gx * v.gy, o = 0;
    for (var k = 0; k < d; k++) {
      for (var j = 0; j < h; j++) {
        var src = x0 + (y0 + j) * gx + (z0 + k) * gxy;
        for (var i = 0; i < w; i++) pk[o++] = u8[src + i];
      }
    }
    GLX.texture3DSub(v.tex, x0, y0, z0, w, h, d, pk.subarray(0, o));
    v.dlo[0] = v.gx; v.dlo[1] = v.gy; v.dlo[2] = v.gz;
    v.dhi[0] = -1; v.dhi[1] = -1; v.dhi[2] = -1;
    v.uploads++; v.texels = o;
    return o;
  };

  //  Dry out, quantise, and upload whatever actually changed.
  //
  //  Runs every WET_TICK (0.15s), not every frame. A damp patch is not a
  //  fast effect and nothing about it is worth a 3D upload sixty times a
  //  second. The scan covers only the LIVE box - the cells that hold
  //  anything at all - which for one pour is a few hundred of the 108,000,
  //  and the box is rebuilt from what is still wet on the way through, so a
  //  tank that was rained on once does not keep paying for it.
  //
  //  Decay is exponential with a per-biome time constant, so bog soil (0.95)
  //  holds a stain about 94 seconds and desert sand (0.10) about 40. It runs
  //  on RAW time for the same reason PS.soakIntoSoil does: fast-forwarding
  //  the game should not fast-forward the puddles.
  //
  //  This must NOT be folded into PS.step. PS.step returns immediately when
  //  no particles are resident, and that is exactly the moment the last drop
  //  has soaked away - the stain would freeze at full strength and never
  //  fade. It is called from Game.update instead.
  Wet.tick = function (farm, rawDt) {
    var v = farm && farm.wet;
    if (!v) return 0;
    v.acc += rawDt;
    if (v.acc < WET_TICK) return 0;
    var dt = v.acc; v.acc = 0;
    if (v.hi[0] >= v.lo[0]) {
      var bw = farm.wetness === undefined ? 0.5 : farm.wetness;
      var keep = Math.exp(-dt / (WET_DRY_TAU * (0.45 + 0.85 * bw)));
      var f = v.f, u8 = v.u8, gx = v.gx, gxy = gx * v.gy;
      var nlo0 = v.gx, nlo1 = v.gy, nlo2 = v.gz, nhi0 = -1, nhi1 = -1, nhi2 = -1;
      for (var k = v.lo[2]; k <= v.hi[2]; k++) {
        for (var j = v.lo[1]; j <= v.hi[1]; j++) {
          var row = j * gx + k * gxy;
          for (var i = v.lo[0]; i <= v.hi[0]; i++) {
            var idx = row + i;
            var w = f[idx] * keep;
            //  One R8 quantum is 1/255. Below that a cell is going to read
            //  as zero on the GPU no matter what the float says, so let it
            //  go and let the live box shrink past it rather than carrying
            //  a texel that can never be seen again.
            if (w < 0.004) w = 0;
            f[idx] = w;
            var q = w <= 0 ? 0 : (w >= 1 ? 255 : (w * 255) | 0);
            if (q !== u8[idx]) {
              u8[idx] = q;
              if (i < v.dlo[0]) v.dlo[0] = i;
              if (i > v.dhi[0]) v.dhi[0] = i;
              if (j < v.dlo[1]) v.dlo[1] = j;
              if (j > v.dhi[1]) v.dhi[1] = j;
              if (k < v.dlo[2]) v.dlo[2] = k;
              if (k > v.dhi[2]) v.dhi[2] = k;
            }
            if (w > 0) {
              if (i < nlo0) nlo0 = i;
              if (i > nhi0) nhi0 = i;
              if (j < nlo1) nlo1 = j;
              if (j > nhi1) nhi1 = j;
              if (k < nlo2) nlo2 = k;
              if (k > nhi2) nhi2 = k;
            }
          }
        }
      }
      v.lo[0] = nlo0; v.lo[1] = nlo1; v.lo[2] = nlo2;
      v.hi[0] = nhi0; v.hi[1] = nhi1; v.hi[2] = nhi2;
    }
    return Wet.upload(v);
  };

  //  Read one point back, for measurement. Nearest cell, no filtering - this
  //  is not what the shader does and is not meant to be; it is here so a
  //  test can ask "is the ground under this puddle actually wet" without
  //  reading pixels.
  Wet.at = function (v, x, y, z) {
    if (!v) return 0;
    var i = Math.round((x - v.min[0]) / v.cell[0] - 0.5);
    var j = Math.round((y - v.min[1]) / v.cell[1] - 0.5);
    var k = Math.round((z - v.min[2]) / v.cell[2] - 0.5);
    if (i < 0 || j < 0 || k < 0 || i >= v.gx || j >= v.gy || k >= v.gz) return 0;
    return v.f[i + j * v.gx + k * v.gx * v.gy];
  };

  //  ...and a summary, so a test has one number to quote.
  Wet.stats = function (v) {
    if (!v) return null;
    var n = 0, peak = 0, sum = 0;
    for (var i = 0; i < v.f.length; i++) {
      var w = v.f[i];
      if (w > 0.02) n++;
      if (w > peak) peak = w;
      sum += w;
    }
    return { cells: n, peak: peak, total: sum, uploads: v.uploads, lastTexels: v.texels };
  };

  // ---------------------------------------------------------------
  //  Soaking. Water lying against soil drains into it and is gone.
  //
  //  Only the layer actually touching the ground counts, so a deep pool
  //  loses its bottom and settles rather than evaporating all at once,
  //  while a thin film spilled on the surface simply sinks in. This runs
  //  over every LIVE water particle, not the awake set: a puddle falls
  //  asleep almost immediately, and a sleeping puddle is exactly the one
  //  that should be soaking away.
  // ---------------------------------------------------------------
  //  AMORTISED OVER SOAK_SLICES FRAMES.
  //
  //  This walks every live drop and does an SDF lookup with a gradient for
  //  each one, which was affordable only because water used to drain away
  //  within a minute and never piled up. Now that soil saturates and a pool
  //  stays, a tank can hold nine hundred drops indefinitely - measured at
  //  22.9 ms a frame with 906 of them against 1.9 ms with none, and this
  //  function is the bulk of it.
  //
  //  A drop's soak clock does not need updating sixty times a second. Each
  //  frame handles one slice of the array and charges it the full elapsed
  //  time for all the slices, so every drop is still advanced at exactly
  //  the same rate on average and the drain curve is unchanged - it just
  //  costs a fraction as much per frame.
  var SOAK_SLICES = 6;
  var _soakPhase = 0;
  PS.soakIntoSoil = function (farm, dt) {
    if (!farm || dt <= 0) return 0;
    var gone = 0;
    var phase = _soakPhase; _soakPhase = (_soakPhase + 1) % SOAK_SLICES;
    dt *= SOAK_SLICES;
    for (var i = phase; i < maxIdx; i += SOAK_SLICES) {
      if (!alive[i] || mat[i] !== MAT_WATER) continue;
      var d = PS.sdf(farm, px[i], py[i], pz[i], _g);
      if (d < SOAK_CONTACT) {
        //  How much room is left in the soil right here. At full saturation
        //  the drop stops draining entirely and simply rests on the ground.
        var _sd0 = d + WET_BURY;
        var _qx = px[i] - _g[0] * _sd0, _qy = py[i] - _g[1] * _sd0, _qz = pz[i] - _g[2] * _sd0;
        var room = 1.0 - Wet.at(farm.wet, _qx, _qy, _qz) / SOAK_SAT;
        if (room <= 0) { if (soak[i] > 0) soak[i] -= dt * 0.5; continue; }
        if (room > 1) room = 1;
        soak[i] += dt * room;
        //  Water lying ON soil dampens it, not only water that finishes
        //  draining. Without this a pool that sits in a pit for a minute and
        //  is then drunk or bailed out leaves the ground bone dry, which is
        //  the opposite of what a pool does to ground.
        //
        //  The splat goes on the SOIL SURFACE, not at the drop. PS.sdf has
        //  just handed back the distance d and the normalised outward
        //  gradient _g, so p - _g*d is the nearest point on the soil and
        //  p - _g*(d + WET_BURY) is half a cell inside it, where the shader
        //  actually samples. Splatting at the drop centre would put most of
        //  the deposit in air the raymarch never visits, and against a
        //  tunnel WALL - where the gradient is horizontal, not vertical -
        //  it would miss the wall completely.
        var _wx = _qx, _wy = _qy, _wz = _qz;
        Wet.add(farm.wet, _wx, _wy, _wz, WET_SIT * dt * room);
        if (soak[i] >= soakCap[i]) {
          var rx = px[i], ry = py[i], rz = pz[i];
          //  and the rest of the drop goes in where it finally vanished
          Wet.add(farm.wet, _wx, _wy, _wz, WET_DROP);
          PS.remove(i);
          gone++;
          //  The drop above it was resting on the drop that just left. Wake
          //  the neighbourhood or the pool hangs in place: the bottom layer
          //  soaks away, nothing settles onto the soil to take its turn, and
          //  a puddle stalls part-drained forever.
          if (PS.wakeNear) PS.wakeNear(rx, ry, rz, H * 1.3);
        }
      } else if (soak[i] > 0) {
        //  lifted clear of the ground again - it stops draining, but what
        //  it already lost stays lost, so a sloshing pool still drains
        soak[i] -= dt * 0.5;
        if (soak[i] < 0) soak[i] = 0;
      }
    }
    return gone;
  };

  PS.step = function (rawDt, game) {
    var farm = _farm || (game && game.player && game.player.farms[0]) ||
      (game && game.world && game.world.farms[0]);
    if (!farm || count === 0) { PS.stats.awake = 0; PS.stats.resident = count; return; }
    _farm = farm;
    if (!ensureGrid(farm)) return;

    var t0 = (typeof performance !== 'undefined') ? performance.now() : 0;

    acc += rawDt;
    if (acc > SUB_DT * MAX_SUB * 3) acc = SUB_DT * MAX_SUB * 3;   // never spiral
    var steps = Math.min(MAX_SUB, Math.floor(acc / SUB_DT));
    acc -= steps * SUB_DT;

    for (var s = 0; s < steps; s++) {
      // gather the awake set
      awakeN = 0;
      for (var i = 0; i < maxIdx; i++) {
        if (alive[i] && !asleep[i]) { if (awakeN < N) awakeList[awakeN++] = i; }
      }
      if (awakeN === 0) break;

      var a, k;
      //  predict
      for (a = 0; a < awakeN; a++) {
        k = awakeList[a];
        vy[k] -= GRAV * SUB_DT;
        ox[k] = px[k] + vx[k] * SUB_DT;
        oy[k] = py[k] + vy[k] * SUB_DT;
        oz[k] = pz[k] + vz[k] * SUB_DT;
      }
      //  sleeping particles keep their position as their prediction so they
      //  hash and collide correctly
      for (i = 0; i < maxIdx; i++) {
        if (alive[i] && asleep[i]) { ox[i] = px[i]; oy[i] = py[i]; oz[i] = pz[i]; }
      }

      PS.buildHash();
      PS.buildNeighbours();

      for (a = 0; a < awakeN; a++) nrmAcc[awakeList[a]] = 0;
      for (var it = 0; it < ITER; it++) {
        PS.solveWater();
        PS.solveSugar();
        PS.collideSoil(farm);
      }
      PS.levelWater();
      PS.collideSoil(farm);
      PS.frictionSoil(farm);

      //  update velocity from the corrected position
      var invDt = 1 / SUB_DT;
      for (a = 0; a < awakeN; a++) {
        k = awakeList[a];
        //  A substep may never move a particle further than this, whatever
        //  the constraints asked for. Bounds velocity at 30 units/s.
        var mdx = ox[k] - px[k], mdy = oy[k] - py[k], mdz = oz[k] - pz[k];
        var ml2 = mdx * mdx + mdy * mdy + mdz * mdz, cap = 0.25;
        if (ml2 > cap * cap) {
          var mf = cap / Math.sqrt(ml2);
          ox[k] = px[k] + mdx * mf; oy[k] = py[k] + mdy * mf; oz[k] = pz[k] + mdz * mf;
        }
        vx[k] = (ox[k] - px[k]) * invDt;
        vy[k] = (oy[k] - py[k]) * invDt;
        vz[k] = (oz[k] - pz[k]) * invDt;
        //  Coulomb friction at the VELOCITY level for anything touching the
        //  ground. Position-level friction alone is throttled by the total
        //  correction cap, which let a grain that landed hard skid metres
        //  across a slope before it was arrested. This removes exactly
        //  mu*g*dt of tangential speed per substep - the textbook amount -
        //  and is what stops a poured heap from smearing across the tank.
        if (nrmAcc[k] > 1e-9) {
          PS.sdf(farm, px[k], py[k], pz[k], _g);
          var vn = vx[k] * _g[0] + vy[k] * _g[1] + vz[k] * _g[2];
          var ux = vx[k] - _g[0] * vn, uy = vy[k] - _g[1] * vn, uz = vz[k] - _g[2] * vn;
          var ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
          if (ul > 1e-6) {
            var muk = mat[k] === MAT_SUGAR
              ? (wet[k] > WET_THRESH ? MU_SOIL_SUGAR_WET : MU_SOIL_SUGAR)
              : MU_SOIL_WATER;
            var drop = muk * GRAV * SUB_DT;
            var keep = ul > drop ? (ul - drop) / ul : 0;
            vx[k] = _g[0] * vn + ux * keep;
            vy[k] = _g[1] * vn + uy * keep;
            vz[k] = _g[2] * vn + uz * keep;
          }
        }
        //  hard clamp: a single bad frame must never launch a particle
        var sp2 = vx[k] * vx[k] + vy[k] * vy[k] + vz[k] * vz[k];
        if (sp2 > 1600) { var f = 40 / Math.sqrt(sp2); vx[k] *= f; vy[k] *= f; vz[k] *= f; }
        if (!(ox[k] === ox[k]) || !(oy[k] === oy[k]) || !(oz[k] === oz[k])) {
          ox[k] = px[k]; oy[k] = py[k]; oz[k] = pz[k];
          vx[k] = vy[k] = vz[k] = 0;
        }
        px[k] = ox[k]; py[k] = oy[k]; pz[k] = oz[k];
      }

      //  XSPH viscosity - water moves as a body, not as a bag of beads
      for (a = 0; a < awakeN; a++) {
        k = awakeList[a];
        if (mat[k] !== MAT_WATER) continue;
        var base = k * NEIGH_MAX, n = nbrN[k];
        var ax = 0, ay = 0, az = 0, c = 0;
        for (var q = 0; q < n; q++) {
          var j = nbr[base + q];
          if (mat[j] !== MAT_WATER) continue;
          ax += vx[j] - vx[k]; ay += vy[j] - vy[k]; az += vz[j] - vz[k]; c++;
        }
        if (c) { vx[k] += XSPH_C * ax / c; vy[k] += XSPH_C * ay / c; vz[k] += XSPH_C * az / c; }
      }

      PS.updateWetness(SUB_DT);
      PS.sleepPass(SUB_DT);
    }

    PS.soakIntoSoil(farm, rawDt);
    PS.enforceBudget();

    _clusterT += rawDt;
    if (_clusterT > 0.5) { _clusterT = 0; PS.rebuildClusters(game); }

    PS.stats.solveMs = ((typeof performance !== 'undefined') ? performance.now() : 0) - t0;
    PS.stats.substeps = steps;
    PS.stats.awake = awakeN;
    PS.stats.resident = count;
  };

  // ---------------------------------------------------------------
  //  Clusters -> Game.items, so the existing foraging code is untouched.
  //  Ants keep eating Game.items exactly as they always have; a cluster
  //  simply owns one entry and gives up particles as the entry is drained.
  // ---------------------------------------------------------------
  PS.clusters = [];
  var _lbl = new Int32Array(N);

  PS.rebuildClusters = function (game) {
    if (!game || !_farm) return;
    _lbl.fill(-1);
    for (var z0 = 0; z0 < maxIdx; z0++) cid[z0] = -1;
    var groups = [], stack = [];
    var LINK = H * 1.05, LINK2 = LINK * LINK;
    for (var i = 0; i < maxIdx; i++) {
      if (!alive[i] || _lbl[i] >= 0) continue;
      var gI = groups.length;
      var members = [];
      stack.length = 0; stack.push(i); _lbl[i] = gI;
      while (stack.length) {
        var cur = stack.pop();
        members.push(cur);
        var c0 = cellOf[cur];
        var cxi = c0 % gx, cyi = ((c0 / gx) | 0) % gy, czi = (c0 / (gx * gy)) | 0;
        for (var dz = -1; dz <= 1; dz++) for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var X = cxi + dx, Y = cyi + dy, Z = czi + dz;
          if (X < 0 || Y < 0 || Z < 0 || X >= gx || Y >= gy || Z >= gz) continue;
          var c = X + gx * (Y + gy * Z), s = cellStart[c], e = cellStart[c + 1];
          for (var k = s; k < e; k++) {
            var j = cellItems[k];
            if (_lbl[j] >= 0 || !alive[j] || mat[j] !== mat[cur]) continue;
            var ax = px[j] - px[cur], ay = py[j] - py[cur], az = pz[j] - pz[cur];
            if (ax * ax + ay * ay + az * az < LINK2) { _lbl[j] = gI; stack.push(j); }
          }
        }
      }
      groups.push(members);
    }

    //  retire the old item entries, publish one per group
    var items = game.items;
    for (var m = items.length - 1; m >= 0; m--) if (items[m].cluster) items.splice(m, 1);

    PS.clusters = [];
    for (var g2 = 0; g2 < groups.length; g2++) {
      var mem = groups[g2];
      if (mem.length < 2) continue;
      var sx = 0, sy = 0, sz = 0, sa = 0, top = -1e9, bottom = 1e9, material = mat[mem[0]];
      for (var q = 0; q < mem.length; q++) {
        var id = mem[q];
        sx += px[id]; sy += py[id]; sz += pz[id]; sa += amt[id];
        if (py[id] > top) top = py[id];
        if (py[id] < bottom) bottom = py[id];
      }
      var n = mem.length;
      //  the published index, NOT the raw group index: single-particle
      //  groups are skipped, so the two diverge and the renderer would
      //  read the wrong cluster for its depth tint
      var pubIdx = PS.clusters.length;
      for (q = 0; q < n; q++) cid[mem[q]] = pubIdx;
      var cl = {
        cid: pubIdx, mat: material, members: mem, n: n,
        cx: sx / n, cy: sy / n, cz: sz / n, top: top, bottom: bottom, amount: sa,
        radius: 0
      };
      var rr = 0;
      for (q = 0; q < n; q++) {
        var idq = mem[q];
        var bx = px[idq] - cl.cx, bz = pz[idq] - cl.cz;
        var dd = Math.sqrt(bx * bx + bz * bz);
        if (dd > rr) rr = dd;
      }
      cl.radius = Math.max(0.35, rr);
      PS.clusters.push(cl);

      items.push({
        type: material === MAT_WATER ? 'water' : 'sugar',
        visual: material === MAT_WATER ? 'water' : 'sugar',
        pos: [cl.cx, top, cl.cz],
        amount: sa,
        farm: _farm,
        surface: true, dead: false, claimed: 0,
        poured: true, cluster: true, clusterRef: cl,
        rot: 0, scale: 1, bob: 0, hidden: true
      });
    }
  };

  //  An ant took a bite: give back real particles from the top of the pile
  //  so the heap visibly shrinks where it was eaten.
  PS.consume = function (cl, amount) {
    if (!cl || !cl.members) return 0;
    var taken = 0;
    var mem = cl.members.slice().filter(function (i) { return alive[i]; });
    mem.sort(function (a, b) { return py[b] - py[a]; });
    for (var i = 0; i < mem.length && taken < amount; i++) {
      taken += amt[mem[i]];
      PS.remove(mem[i]);
    }
    return taken;
  };

  //  Tuning hook. The PBF constants in the literature assume a rest density
  //  around 1000; ours is computed from the actual kernel and spacing and
  //  comes out near 37, so the artificial-pressure term has to be re-scaled
  //  against it or it swamps lambda and the fluid detonates. These are set
  //  from measurement, not from the paper's numbers.
  PS.tune = function (o) {
    if (o.EPS_CFM !== undefined) EPS_CFM = o.EPS_CFM;
    if (o.SCORR_K !== undefined) SCORR_K = o.SCORR_K;
    if (o.XSPH_C !== undefined) XSPH_C = o.XSPH_C;
    if (o.LEVEL_K !== undefined) LEVEL_K = o.LEVEL_K;
    if (o.MU_WET !== undefined) MU_WET = o.MU_WET;
    if (o.MU_DRY !== undefined) MU_DRY = o.MU_DRY;
    if (o.MU_SOIL_SUGAR !== undefined) MU_SOIL_SUGAR = o.MU_SOIL_SUGAR;
    if (o.MU_SOIL_SUGAR_WET !== undefined) MU_SOIL_SUGAR_WET = o.MU_SOIL_SUGAR_WET;
  };
  PS.params = function () {
    return { RHO0: RHO0, EPS_CFM: EPS_CFM, SCORR_K: SCORR_K, XSPH_C: XSPH_C,
      LEVEL_K: LEVEL_K, MU_DRY: MU_DRY, MU_WET: MU_WET,
      MU_SOIL_SUGAR: MU_SOIL_SUGAR, MU_SOIL_SUGAR_WET: MU_SOIL_SUGAR_WET };
  };

  AF.PS = PS;
  AF.Wet = Wet;

})(window.AF = window.AF || {});

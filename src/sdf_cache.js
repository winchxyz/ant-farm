/* =============================================================
   FORMICARIUM :: DEEP COLONY
   sdf_cache.js - a fast, cached mirror of Farm.soilSDF.

   Farm.soilSDF walks every tunnel segment on every call - up to 508 of
   them - which measures at ~209ns per query. A particle solver needs a
   distance AND a gradient for every particle every substep, and a naive
   gradient is four more queries, so the raw field cannot pay for itself:
   1500 particles would spend over 2ms just asking where the ground is.

   So we sample the field into a dense grid once and read it back with
   trilinear interpolation, which costs ~15ns and hands us an analytic
   gradient out of the same eight corners we already fetched.

   The grid is filled LAZILY, one chunk at a time, and only where somebody
   actually asks. Water poured into one corner of the tank never pays for
   the other end. Digging invalidates the cache; it refills on demand.
   ============================================================= */
(function (AF) {
  'use strict';

  var CELL = 0.40;          // grid spacing in world units
  var CHUNK = 8;            // cells per chunk edge
  var MAX_BAKES_PER_FRAME = 4;

  //  Build (or rebuild) the empty grid for a farm.
  function alloc(farm) {
    var minx = farm.center[0] - farm.half[0] - CELL;
    var miny = farm.center[1] - farm.half[1] - CELL;
    var minz = farm.center[2] - farm.half[2] - CELL;
    var gx = Math.ceil((farm.half[0] * 2 + CELL * 3) / CELL) + 1;
    var gy = Math.ceil((farm.half[1] * 2 + CELL * 3) / CELL) + 1;
    var gz = Math.ceil((farm.half[2] * 2 + CELL * 3) / CELL) + 1;
    var cx = Math.ceil(gx / CHUNK), cy = Math.ceil(gy / CHUNK), cz = Math.ceil(gz / CHUNK);
    farm._sc = {
      min: [minx, miny, minz],
      gx: gx, gy: gy, gz: gz,
      cx: cx, cy: cy, cz: cz,
      data: new Float32Array(gx * gy * gz),
      baked: new Uint8Array(cx * cy * cz),
      pending: [],
      bakedChunks: 0,
      queries: 0, bakes: 0
    };
    return farm._sc;
  }

  //  Fill one chunk's cells (inclusive of the far face so neighbouring
  //  chunks agree on shared corners - the duplicate writes are identical).
  function bakeChunk(farm, sc, ci) {
    var cxi = ci % sc.cx;
    var cyi = ((ci / sc.cx) | 0) % sc.cy;
    var czi = (ci / (sc.cx * sc.cy)) | 0;
    var x0 = cxi * CHUNK, y0 = cyi * CHUNK, z0 = czi * CHUNK;
    var x1 = Math.min(sc.gx - 1, x0 + CHUNK);
    var y1 = Math.min(sc.gy - 1, y0 + CHUNK);
    var z1 = Math.min(sc.gz - 1, z0 + CHUNK);
    var d = sc.data, mn = sc.min, gx = sc.gx, gxy = sc.gx * sc.gy;
    for (var z = z0; z <= z1; z++) {
      var wz = mn[2] + z * CELL;
      for (var y = y0; y <= y1; y++) {
        var wy = mn[1] + y * CELL;
        var row = y * gx + z * gxy;
        for (var x = x0; x <= x1; x++) {
          d[row + x] = farm.soilSDF(mn[0] + x * CELL, wy, wz);
        }
      }
    }
    sc.baked[ci] = 1;
    sc.bakedChunks++;
    sc.bakes++;
  }

  //  Make sure the chunk containing a cell is present. Returns false if it
  //  had to be queued rather than baked (caller falls back to the exact field).
  function ensure(farm, sc, xi, yi, zi, immediate) {
    var ci = ((xi / CHUNK) | 0) + sc.cx * (((yi / CHUNK) | 0) + sc.cy * ((zi / CHUNK) | 0));
    if (sc.baked[ci]) return true;
    if (immediate) { bakeChunk(farm, sc, ci); return true; }
    if (sc.baked[ci] === 0) {
      sc.baked[ci] = 2;              // queued
      sc.pending.push(ci);
    }
    return false;
  }

  AF.SDFCache = {
    CELL: CELL,

    //  Drop everything. Called when the soil geometry actually changes.
    invalidate: function (farm) {
      if (!farm._sc) return;
      farm._sc.baked.fill(0);
      farm._sc.pending.length = 0;
      farm._sc.bakedChunks = 0;
    },

    //  Spend a slice of the frame filling in whatever got asked for.
    pump: function (farm, budget) {
      var sc = farm._sc;
      if (!sc || !sc.pending.length) return 0;
      var n = Math.min(budget || MAX_BAKES_PER_FRAME, sc.pending.length);
      for (var i = 0; i < n; i++) bakeChunk(farm, sc, sc.pending.shift());
      return n;
    },

    //  Distance + gradient in one shot. `out` receives the normalised
    //  gradient (the direction that climbs out of the soil).
    //
    //  Falls back to the exact field on a cold chunk so a particle is never
    //  fed a zero-filled cell; the chunk is queued and the next frame is fast.
    sample: function (farm, x, y, z, out) {
      var sc = farm._sc || alloc(farm);
      sc.queries++;
      var fx = (x - sc.min[0]) / CELL, fy = (y - sc.min[1]) / CELL, fz = (z - sc.min[2]) / CELL;
      var xi = fx | 0, yi = fy | 0, zi = fz | 0;
      if (xi < 0 || yi < 0 || zi < 0 || xi >= sc.gx - 1 || yi >= sc.gy - 1 || zi >= sc.gz - 1) {
        return exact(farm, x, y, z, out);
      }
      if (!ensure(farm, sc, xi, yi, zi, false) ||
        !ensure(farm, sc, xi + 1, yi + 1, zi + 1, false)) {
        return exact(farm, x, y, z, out);
      }
      var tx = fx - xi, ty = fy - yi, tz = fz - zi;
      var d = sc.data, gx = sc.gx, gxy = sc.gx * sc.gy;
      var b = xi + yi * gx + zi * gxy;
      var c000 = d[b], c100 = d[b + 1];
      var c010 = d[b + gx], c110 = d[b + gx + 1];
      var c001 = d[b + gxy], c101 = d[b + gxy + 1];
      var c011 = d[b + gx + gxy], c111 = d[b + gx + gxy + 1];

      var x00 = c000 + (c100 - c000) * tx, x10 = c010 + (c110 - c010) * tx;
      var x01 = c001 + (c101 - c001) * tx, x11 = c011 + (c111 - c011) * tx;
      var y0 = x00 + (x10 - x00) * ty, y1 = x01 + (x11 - x01) * ty;
      var val = y0 + (y1 - y0) * tz;

      if (out) {
        //  Analytic gradient of the trilinear patch - free, because every
        //  corner is already in a register. This is the whole reason the
        //  cache pays for itself twice over.
        var mx = 1 - tx, my = 1 - ty, mz = 1 - tz;
        var gxv =
          my * mz * (c100 - c000) + ty * mz * (c110 - c010) +
          my * tz * (c101 - c001) + ty * tz * (c111 - c011);
        var gyv =
          mx * mz * (c010 - c000) + tx * mz * (c110 - c100) +
          mx * tz * (c011 - c001) + tx * tz * (c111 - c101);
        var gzv =
          mx * my * (c001 - c000) + tx * my * (c101 - c100) +
          mx * ty * (c011 - c010) + tx * ty * (c111 - c110);
        var l = Math.sqrt(gxv * gxv + gyv * gyv + gzv * gzv);
        if (l < 1e-6) { out[0] = 0; out[1] = 1; out[2] = 0; }
        else { out[0] = gxv / l; out[1] = gyv / l; out[2] = gzv / l; }
      }
      return val;
    },

    stats: function (farm) {
      var sc = farm._sc;
      if (!sc) return null;
      return {
        cells: sc.data.length,
        chunks: sc.baked.length,
        bakedChunks: sc.bakedChunks,
        pending: sc.pending.length,
        queries: sc.queries,
        megabytes: +(sc.data.byteLength / 1048576).toFixed(2)
      };
    }
  };

  //  Exact field + finite-difference gradient, for cold cells and for the
  //  region just outside the grid.
  function exact(farm, x, y, z, out) {
    var d0 = farm.soilSDF(x, y, z);
    if (out) {
      var e = 0.06;
      var ax = farm.soilSDF(x + e, y, z) - d0;
      var ay = farm.soilSDF(x, y + e, z) - d0;
      var az = farm.soilSDF(x, y, z + e) - d0;
      var l = Math.sqrt(ax * ax + ay * ay + az * az);
      if (l < 1e-6) { out[0] = 0; out[1] = 1; out[2] = 0; }
      else { out[0] = ax / l; out[1] = ay / l; out[2] = az / l; }
    }
    return d0;
  }

})(window.AF = window.AF || {});

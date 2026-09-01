/* =============================================================
   FORMICARIUM :: DEEP COLONY
   fx.js - particles, pheromone ribbons, screen shake, decals
   ============================================================= */
(function (AF) {
  'use strict';

  var M = AF.M, v3 = M.v3;
  var FX = {};

  var KIND = { dust: 0, spark: 1, dirt: 2, smoke: 3, ring: 4 };

  function System(max) {
    this.max = max;
    this.n = 0;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.kind = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.spinV = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.seed = new Float32Array(max);
    this.rng = new M.RNG(9001);
    this.shake = 0;
  }

  System.prototype.spawn = function (x, y, z, vx, vy, vz, life, size, r, g, b, kind, grav, drag) {
    var i;
    if (this.n < this.max) i = this.n++;
    else i = this.rng.int(this.max);
    var i3 = i * 3;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.kind[i] = kind;
    this.spin[i] = this.rng.range(0, M.TAU);
    this.spinV[i] = this.rng.range(-3, 3);
    this.grav[i] = grav === undefined ? -3.2 : grav;
    this.drag[i] = drag === undefined ? 1.6 : drag;
    this.seed[i] = this.rng.next();
    return i;
  };

  System.prototype.update = function (dt) {
    var i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        var last = --this.n;
        if (i !== last) {
          var a = i * 3, b = last * 3;
          this.p[a] = this.p[b]; this.p[a + 1] = this.p[b + 1]; this.p[a + 2] = this.p[b + 2];
          this.v[a] = this.v[b]; this.v[a + 1] = this.v[b + 1]; this.v[a + 2] = this.v[b + 2];
          this.col[a] = this.col[b]; this.col[a + 1] = this.col[b + 1]; this.col[a + 2] = this.col[b + 2];
          this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last];
          this.size[i] = this.size[last]; this.kind[i] = this.kind[last];
          this.spin[i] = this.spin[last]; this.spinV[i] = this.spinV[last];
          this.grav[i] = this.grav[last]; this.drag[i] = this.drag[last];
          this.seed[i] = this.seed[last];
        }
        continue;
      }
      var i3 = i * 3;
      var d = Math.exp(-this.drag[i] * dt);
      this.v[i3] *= d;
      this.v[i3 + 1] = this.v[i3 + 1] * d + this.grav[i] * dt;
      this.v[i3 + 2] *= d;
      this.p[i3] += this.v[i3] * dt;
      this.p[i3 + 1] += this.v[i3 + 1] * dt;
      this.p[i3 + 2] += this.v[i3 + 2] * dt;
      this.spin[i] += this.spinV[i] * dt;
      i++;
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
  };

  System.prototype.push = function (batch) {
    for (var i = 0; i < this.n; i++) {
      var i3 = i * 3;
      var t = this.life[i] / this.maxLife[i];
      var k = this.kind[i];
      var alpha, size = this.size[i];
      if (k === KIND.smoke) { alpha = t * 0.55; size *= (2.0 - t * 1.1); }
      else if (k === KIND.spark) { alpha = t * t; size *= 0.5 + t * 0.9; }
      else if (k === KIND.ring) { alpha = t * 0.8; size *= (2.4 - t * 1.4); }
      else { alpha = Math.min(1, t * 2.2) * 0.9; }
      // particle shader reads aIPos(xyz,size) aIColA(rgb,a) aIData(life,kind,spin,seed)
      batch.push(
        this.p[i3], this.p[i3 + 1], this.p[i3 + 2], size,
        0, 0, 0, 0,
        0, 0, 0, 0,
        this.col[i3], this.col[i3 + 1], this.col[i3 + 2], alpha,
        t, k, this.spin[i], this.seed[i]);
    }
  };

  // ------------------------------------------------------------------
  //  Effects layer
  // ------------------------------------------------------------------
  function Effects() {
    this.sys = new System(5000);
    this.rng = new M.RNG(4242);
    this.decals = [];
    this.shakeAmt = 0;
    this.flash = 0;
    this.flashCol = [1, 1, 1];
  }

  Effects.prototype.update = function (dt) {
    this.sys.update(dt);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.4);
    this.flash = Math.max(0, this.flash - dt * 2.6);
    for (var i = this.decals.length - 1; i >= 0; i--) {
      var d = this.decals[i];
      d.t += dt;
      if (d.t > d.life) this.decals.splice(i, 1);
    }
  };

  Effects.prototype.burst = function (pos, count, type, col) {
    var r = this.rng;
    col = col || [1, 1, 1];
    for (var i = 0; i < count; i++) {
      switch (type) {
        case 'dirt':
          this.sys.spawn(pos[0] + r.range(-0.15, 0.15), pos[1] + r.range(-0.1, 0.2), pos[2] + r.range(-0.15, 0.15),
            r.range(-1.3, 1.3), r.range(0.4, 2.1), r.range(-1.3, 1.3),
            r.range(0.35, 0.85), r.range(0.035, 0.085),
            col[0] * r.range(0.7, 1.2), col[1] * r.range(0.7, 1.2), col[2] * r.range(0.7, 1.2),
            KIND.dirt, -6.5, 1.4);
          break;
        case 'gore':
          this.sys.spawn(pos[0], pos[1] + 0.1, pos[2],
            r.range(-1.8, 1.8), r.range(0.5, 2.6), r.range(-1.8, 1.8),
            r.range(0.28, 0.6), r.range(0.02, 0.05),
            col[0] * 1.4 + 0.15, col[1] * 0.9, col[2] * 0.8,
            KIND.dirt, -7.5, 1.2);
          break;
        case 'sparkle':
          this.sys.spawn(pos[0], pos[1] + 0.12, pos[2],
            r.range(-0.5, 0.5), r.range(0.5, 1.5), r.range(-0.5, 0.5),
            r.range(0.4, 0.9), r.range(0.02, 0.055),
            col[0] * 2.2, col[1] * 2.0, col[2] * 1.6,
            KIND.spark, -0.9, 2.2);
          break;
        case 'acid':
          this.sys.spawn(pos[0], pos[1] + 0.1, pos[2],
            r.range(-2.0, 2.0), r.range(0.6, 2.4), r.range(-2.0, 2.0),
            r.range(0.3, 0.7), r.range(0.025, 0.06),
            0.7, 1.6, 0.25, KIND.spark, -4.0, 1.6);
          break;
        case 'smoke':
          this.sys.spawn(pos[0], pos[1] + 0.15, pos[2],
            r.range(-0.3, 0.3), r.range(0.25, 0.8), r.range(-0.3, 0.3),
            r.range(1.1, 2.2), r.range(0.10, 0.22),
            col[0], col[1], col[2], KIND.smoke, 0.35, 0.9);
          break;
        case 'spore':
          this.sys.spawn(pos[0], pos[1] + 0.2, pos[2],
            r.range(-0.6, 0.6), r.range(0.1, 0.6), r.range(-0.6, 0.6),
            r.range(2.0, 4.0), r.range(0.05, 0.12),
            0.55, 0.85, 0.35, KIND.smoke, 0.10, 0.5);
          break;
        case 'dust':
          this.sys.spawn(pos[0] + r.range(-0.4, 0.4), pos[1] + r.range(-0.2, 0.5), pos[2] + r.range(-0.4, 0.4),
            r.range(-0.25, 0.25), r.range(-0.05, 0.25), r.range(-0.25, 0.25),
            r.range(2.5, 6.0), r.range(0.012, 0.032),
            col[0], col[1], col[2], KIND.dust, 0.02, 0.25);
          break;
        case 'ring':
          this.sys.spawn(pos[0], pos[1], pos[2], 0, 0, 0,
            r.range(0.5, 0.8), 0.55, col[0], col[1], col[2], KIND.ring, 0, 4);
          break;
      }
    }
  };

  Effects.prototype.ambientDust = function (center, radius, count, col) {
    for (var i = 0; i < count; i++) {
      var r = this.rng;
      this.sys.spawn(
        center[0] + r.range(-radius, radius),
        center[1] + r.range(-radius * 0.6, radius * 0.6),
        center[2] + r.range(-radius * 0.5, radius * 0.5),
        r.range(-0.12, 0.12), r.range(-0.03, 0.08), r.range(-0.12, 0.12),
        r.range(6, 14), r.range(0.010, 0.026),
        col[0], col[1], col[2], KIND.dust, 0.01, 0.15);
    }
  };

  Effects.prototype.shake = function (amt) { this.shakeAmt = Math.min(1.4, this.shakeAmt + amt); };
  Effects.prototype.flashScreen = function (amt, col) { this.flash = Math.min(1.5, this.flash + amt); this.flashCol = col || [1, 1, 1]; };

  FX.System = System;
  FX.Effects = Effects;
  FX.KIND = KIND;
  AF.FX = FX;
})(window.AF = window.AF || {});

/* =============================================================
   FORMICARIUM :: DEEP COLONY
   math.js - vectors, matrices, noise, rng, easing
   ============================================================= */
(function (AF) {
  'use strict';

  var M = {};

  // ---------- scalars ----------
  M.PI = Math.PI;
  M.TAU = Math.PI * 2;
  M.DEG = Math.PI / 180;
  M.clamp = function (x, a, b) { return x < a ? a : (x > b ? b : x); };
  M.saturate = function (x) { return x < 0 ? 0 : (x > 1 ? 1 : x); };
  M.lerp = function (a, b, t) { return a + (b - a) * t; };
  M.mix = M.lerp;
  M.smoothstep = function (a, b, x) { var t = M.saturate((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  M.sign = function (x) { return x < 0 ? -1 : (x > 0 ? 1 : 0); };
  M.fract = function (x) { return x - Math.floor(x); };
  M.wrapAngle = function (a) { return M.fract((a + Math.PI) / M.TAU) * M.TAU - Math.PI; };
  M.angleLerp = function (a, b, t) { return a + M.wrapAngle(b - a) * t; };
  M.damp = function (a, b, lambda, dt) { return M.lerp(a, b, 1 - Math.exp(-lambda * dt)); };
  M.remap = function (x, a, b, c, d) { return c + (d - c) * M.saturate((x - a) / (b - a)); };

  // ---------- rng ----------
  function RNG(seed) {
    this.s = (seed >>> 0) || 0x9e3779b9;
    if (this.s === 0) this.s = 0x6d2b79f5;
  }
  RNG.prototype.next = function () {
    var x = this.s;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.s = x;
    return x / 4294967296;
  };
  RNG.prototype.range = function (a, b) { return a + (b - a) * this.next(); };
  RNG.prototype.int = function (n) { return Math.floor(this.next() * n) % n; };
  RNG.prototype.pick = function (arr) { return arr[this.int(arr.length)]; };
  RNG.prototype.chance = function (p) { return this.next() < p; };
  RNG.prototype.sign = function () { return this.next() < 0.5 ? -1 : 1; };
  RNG.prototype.gauss = function () {
    var u = 1 - this.next(), v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(M.TAU * v);
  };
  M.RNG = RNG;
  M.rng = new RNG(1337);

  // ---------- vec3 ----------
  var v3 = {};
  v3.create = function (x, y, z) { return new Float32Array([x || 0, y || 0, z || 0]); };
  v3.set = function (o, x, y, z) { o[0] = x; o[1] = y; o[2] = z; return o; };
  v3.copy = function (o, a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; };
  v3.clone = function (a) { return new Float32Array([a[0], a[1], a[2]]); };
  v3.add = function (o, a, b) { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; };
  v3.sub = function (o, a, b) { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; };
  v3.mul = function (o, a, b) { o[0] = a[0] * b[0]; o[1] = a[1] * b[1]; o[2] = a[2] * b[2]; return o; };
  v3.scale = function (o, a, s) { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; };
  v3.addScaled = function (o, a, b, s) { o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o; };
  v3.dot = function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; };
  v3.cross = function (o, a, b) {
    var ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
    o[0] = ay * bz - az * by; o[1] = az * bx - ax * bz; o[2] = ax * by - ay * bx; return o;
  };
  v3.len = function (a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); };
  v3.len2 = function (a) { return a[0] * a[0] + a[1] * a[1] + a[2] * a[2]; };
  v3.dist = function (a, b) { var x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return Math.sqrt(x * x + y * y + z * z); };
  v3.dist2 = function (a, b) { var x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return x * x + y * y + z * z; };
  v3.normalize = function (o, a) {
    var l = v3.len(a);
    if (l > 1e-9) { var il = 1 / l; o[0] = a[0] * il; o[1] = a[1] * il; o[2] = a[2] * il; }
    else { o[0] = 0; o[1] = 0; o[2] = 0; }
    return o;
  };
  v3.lerp = function (o, a, b, t) { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; };
  v3.transformMat4 = function (o, a, m) {
    var x = a[0], y = a[1], z = a[2];
    var w = m[3] * x + m[7] * y + m[11] * z + m[15]; w = w || 1;
    var ox = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    var oy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    var oz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
    o[0] = ox; o[1] = oy; o[2] = oz;
    return o;
  };
  v3.transformDir = function (o, a, m) {
    var x = a[0], y = a[1], z = a[2];
    var ox = m[0] * x + m[4] * y + m[8] * z;
    var oy = m[1] * x + m[5] * y + m[9] * z;
    var oz = m[2] * x + m[6] * y + m[10] * z;
    o[0] = ox; o[1] = oy; o[2] = oz;
    return o;
  };
  M.v3 = v3;

  // ---------- mat4 (column major) ----------
  var m4 = {};
  m4.create = function () { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); };
  m4.identity = function (o) {
    o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
    o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1; return o;
  };
  m4.copy = function (o, a) { for (var i = 0; i < 16; i++) o[i] = a[i]; return o; };
  m4.multiply = function (o, a, b) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
      a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
      a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
      a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (var i = 0; i < 4; i++) {
      var b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return o;
  };
  m4.perspective = function (o, fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    o[0] = f / aspect; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = f; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = (far + near) * nf; o[11] = -1;
    o[12] = 0; o[13] = 0; o[14] = 2 * far * near * nf; o[15] = 0;
    return o;
  };
  m4.ortho = function (o, l, r, b, t, n, f) {
    var lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
    o[0] = -2 * lr; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = -2 * bt; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = 2 * nf; o[11] = 0;
    o[12] = (l + r) * lr; o[13] = (t + b) * bt; o[14] = (f + n) * nf; o[15] = 1;
    return o;
  };
  var _lx = new Float32Array(3), _ly = new Float32Array(3), _lz = new Float32Array(3);
  m4.lookAt = function (o, eye, center, up) {
    v3.sub(_lz, eye, center); v3.normalize(_lz, _lz);
    v3.cross(_lx, up, _lz);
    if (v3.len2(_lx) < 1e-10) { _lx[0] = 1; _lx[1] = 0; _lx[2] = 0; }
    v3.normalize(_lx, _lx);
    v3.cross(_ly, _lz, _lx);
    o[0] = _lx[0]; o[1] = _ly[0]; o[2] = _lz[0]; o[3] = 0;
    o[4] = _lx[1]; o[5] = _ly[1]; o[6] = _lz[1]; o[7] = 0;
    o[8] = _lx[2]; o[9] = _ly[2]; o[10] = _lz[2]; o[11] = 0;
    o[12] = -v3.dot(_lx, eye); o[13] = -v3.dot(_ly, eye); o[14] = -v3.dot(_lz, eye); o[15] = 1;
    return o;
  };
  m4.invert = function (o, a) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
      a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
      a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
      a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    var b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10,
      b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
      b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30,
      b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return m4.identity(o);
    det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  };
  m4.transpose = function (o, a) {
    if (o === a) {
      var t;
      t = a[1]; o[1] = a[4]; o[4] = t;
      t = a[2]; o[2] = a[8]; o[8] = t;
      t = a[3]; o[3] = a[12]; o[12] = t;
      t = a[6]; o[6] = a[9]; o[9] = t;
      t = a[7]; o[7] = a[13]; o[13] = t;
      t = a[11]; o[11] = a[14]; o[14] = t;
      return o;
    }
    for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) o[i * 4 + j] = a[j * 4 + i];
    return o;
  };
  m4.fromTranslation = function (o, v) { m4.identity(o); o[12] = v[0]; o[13] = v[1]; o[14] = v[2]; return o; };
  m4.translate = function (o, a, v) {
    var x = v[0], y = v[1], z = v[2];
    var t12 = a[0] * x + a[4] * y + a[8] * z + a[12];
    var t13 = a[1] * x + a[5] * y + a[9] * z + a[13];
    var t14 = a[2] * x + a[6] * y + a[10] * z + a[14];
    var t15 = a[3] * x + a[7] * y + a[11] * z + a[15];
    if (o !== a) m4.copy(o, a);
    o[12] = t12; o[13] = t13; o[14] = t14; o[15] = t15;
    return o;
  };
  m4.scale = function (o, a, v) {
    for (var i = 0; i < 4; i++) { o[i] = a[i] * v[0]; o[4 + i] = a[4 + i] * v[1]; o[8 + i] = a[8 + i] * v[2]; o[12 + i] = a[12 + i]; }
    return o;
  };
  m4.rotateY = function (o, a, r) {
    var s = Math.sin(r), c = Math.cos(r);
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    if (o !== a) m4.copy(o, a);
    o[0] = a00 * c - a20 * s; o[1] = a01 * c - a21 * s; o[2] = a02 * c - a22 * s; o[3] = a03 * c - a23 * s;
    o[8] = a00 * s + a20 * c; o[9] = a01 * s + a21 * c; o[10] = a02 * s + a22 * c; o[11] = a03 * s + a23 * c;
    return o;
  };
  m4.rotateX = function (o, a, r) {
    var s = Math.sin(r), c = Math.cos(r);
    var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7], a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    if (o !== a) m4.copy(o, a);
    o[4] = a10 * c + a20 * s; o[5] = a11 * c + a21 * s; o[6] = a12 * c + a22 * s; o[7] = a13 * c + a23 * s;
    o[8] = a20 * c - a10 * s; o[9] = a21 * c - a11 * s; o[10] = a22 * c - a12 * s; o[11] = a23 * c - a13 * s;
    return o;
  };
  m4.rotateZ = function (o, a, r) {
    var s = Math.sin(r), c = Math.cos(r);
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    if (o !== a) m4.copy(o, a);
    o[0] = a00 * c + a10 * s; o[1] = a01 * c + a11 * s; o[2] = a02 * c + a12 * s; o[3] = a03 * c + a13 * s;
    o[4] = a10 * c - a00 * s; o[5] = a11 * c - a01 * s; o[6] = a12 * c - a02 * s; o[7] = a13 * c - a03 * s;
    return o;
  };
  M.m4 = m4;

  // ---------- geometry helpers ----------
  M.rayBox = function (ro, rd, bmin, bmax) {
    var t0 = -1e30, t1 = 1e30;
    for (var i = 0; i < 3; i++) {
      var inv = 1 / (Math.abs(rd[i]) < 1e-9 ? 1e-9 : rd[i]);
      var ta = (bmin[i] - ro[i]) * inv, tb = (bmax[i] - ro[i]) * inv;
      if (ta > tb) { var t = ta; ta = tb; tb = t; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return null;
    }
    return [t0, t1];
  };
  M.rayPlaneY = function (ro, rd, y) {
    if (Math.abs(rd[1]) < 1e-9) return -1;
    return (y - ro[1]) / rd[1];
  };
  M.closestPointSeg = function (out, p, a, b) {
    var abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    var apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
    var d = abx * abx + aby * aby + abz * abz;
    var t = d > 1e-9 ? M.saturate((apx * abx + apy * aby + apz * abz) / d) : 0;
    out[0] = a[0] + abx * t; out[1] = a[1] + aby * t; out[2] = a[2] + abz * t;
    return t;
  };

  // ---------- noise ----------
  function hash3(x, y, z) {
    var n = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
    n = (n ^ (n >> 13)) | 0;
    n = Math.imul(n, 1274126177) | 0;
    return ((n ^ (n >> 16)) >>> 0) / 4294967296;
  }
  M.hash3 = hash3;
  M.noise3 = function (x, y, z) {
    var ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    var fx = x - ix, fy = y - iy, fz = z - iz;
    var ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
    var n000 = hash3(ix, iy, iz), n100 = hash3(ix + 1, iy, iz);
    var n010 = hash3(ix, iy + 1, iz), n110 = hash3(ix + 1, iy + 1, iz);
    var n001 = hash3(ix, iy, iz + 1), n101 = hash3(ix + 1, iy, iz + 1);
    var n011 = hash3(ix, iy + 1, iz + 1), n111 = hash3(ix + 1, iy + 1, iz + 1);
    var nx00 = M.lerp(n000, n100, ux), nx10 = M.lerp(n010, n110, ux);
    var nx01 = M.lerp(n001, n101, ux), nx11 = M.lerp(n011, n111, ux);
    return M.lerp(M.lerp(nx00, nx10, uy), M.lerp(nx01, nx11, uy), uz);
  };
  M.fbm3 = function (x, y, z, oct) {
    var a = 0.5, s = 0, f = 1;
    oct = oct || 4;
    for (var i = 0; i < oct; i++) { s += a * M.noise3(x * f, y * f, z * f); f *= 2.0; a *= 0.5; }
    return s;
  };

  // ---------- easing ----------
  M.easeOutCubic = function (t) { return 1 - Math.pow(1 - t, 3); };
  M.easeInOutCubic = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  M.easeOutBack = function (t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

  // ---------- color ----------
  M.hexToRgb = function (h) { return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]; };
  M.rgbToCss = function (c) {
    return 'rgb(' + Math.round(M.saturate(c[0]) * 255) + ',' + Math.round(M.saturate(c[1]) * 255) + ',' + Math.round(M.saturate(c[2]) * 255) + ')';
  };
  M.hsl = function (h, s, l) {
    h = M.fract(h);
    function f(n) {
      var k = (n + h * 12) % 12;
      var a = s * Math.min(l, 1 - l);
      return l - a * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
    }
    return [f(0), f(8), f(4)];
  };

  AF.M = M;
})(window.AF = window.AF || {});

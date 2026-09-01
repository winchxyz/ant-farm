/* =============================================================
   FORMICARIUM :: DEEP COLONY
   input.js - raw input + cinematic camera rig

   Camera contract (never inverted by default):
     PAN   - the world sticks to the cursor. Drag right, the scene
             goes right. Same for WASD and edge scroll.
     ORBIT - drag right and the camera flies right around the pivot,
             matching every 3D tool. Invert X / Y are settings.
     ZOOM  - wheel toward you zooms in, and zooms toward the cursor
             so whatever you point at stays put.
   ============================================================= */
(function (AF) {
  'use strict';

  var M = AF.M, v3 = M.v3;
  var IN = {};

  // ------------------------------------------------------------------
  //  RAW INPUT
  // ------------------------------------------------------------------
  function Input(canvas) {
    var self = this;
    this.canvas = canvas;
    this.keys = {};
    this.pressed = {};
    this.released = {};
    this.mouse = { x: 0, y: 0, ndcX: 0, ndcY: 0, down: false, rdown: false, mdown: false, inside: false };
    this.drag = { active: false, x0: 0, y0: 0, x1: 0, y1: 0, moved: 0, button: 0, t0: 0 };
    this.wheel = 0;
    this.clicks = [];
    this.dbl = false;
    this.uiHover = false;
    this.dx = 0; this.dy = 0;
    this.viewW = canvas.clientWidth || 1280;
    this.viewH = canvas.clientHeight || 720;

    //  Only genuine text entry should swallow the keyboard.
    //
    //  This used to return true for ANY <input>, and the settings panel is
    //  full of range sliders. Touching a volume or sensitivity slider left it
    //  as document.activeElement, so from then on every keydown was treated
    //  as typing and WASD, the arrow keys and Space were dead for the rest of
    //  the session. A slider is not a text field.
    function typing(t) {
      if (!t) return false;
      if (t.isContentEditable) return true;
      if (t.tagName === 'TEXTAREA') return true;
      if (t.tagName === 'INPUT') {
        var ty = (t.type || 'text').toLowerCase();
        return ty === 'text' || ty === 'search' || ty === 'email' ||
          ty === 'number' || ty === 'password' || ty === 'url' || ty === 'tel';
      }
      return false;
    }

    //  PHYSICAL key, not the character it produces.
    //
    //  e.key is layout-dependent: on a Russian keyboard the WASD keys report
    //  'ц' 'ф' 'ы' 'в', on a French AZERTY they report 'z' 'q' 's' 'd'. Binding
    //  to e.key means the movement keys simply do not exist for most of the
    //  world. e.code is the physical switch and never changes, so that is what
    //  the bindings use; e.key is still recorded so typed characters work.
    function codeKey(e) {
      var c = e.code || '';
      if (c.length === 4 && c.indexOf('Key') === 0) return c.charAt(3).toLowerCase();
      if (c.length === 6 && c.indexOf('Digit') === 0) return c.charAt(5);
      if (c.length === 7 && c.indexOf('Numpad') === 0) return c.charAt(6);
      switch (c) {
        case 'Space': return ' ';
        case 'ArrowUp': return 'arrowup';
        case 'ArrowDown': return 'arrowdown';
        case 'ArrowLeft': return 'arrowleft';
        case 'ArrowRight': return 'arrowright';
        case 'Escape': return 'escape';
        case 'Tab': return 'tab';
        case 'Enter': return 'enter';
        case 'Delete': return 'delete';
        case 'Backspace': return 'backspace';
        case 'BracketLeft': return '[';
        case 'BracketRight': return ']';
        case 'Minus': return '-';
        case 'Equal': return '=';
        case 'PageUp': return 'pageup';
        case 'PageDown': return 'pagedown';
        case 'ShiftLeft': case 'ShiftRight': return 'shift';
        case 'ControlLeft': case 'ControlRight': return 'control';
        case 'AltLeft': case 'AltRight': return 'alt';
      }
      if (/^F([1-9]|1[0-2])$/.test(c)) return c.toLowerCase();
      return null;
    }

    //  Capture phase on the document: nothing downstream can swallow a key
    //  before the camera sees it, whatever has focus.
    function onDown(e) {
      if (typing(e.target)) return;
      var ks = [], k = (e.key || '').toLowerCase(), ck = codeKey(e);
      if (k) ks.push(k);
      if (ck && ck !== k) ks.push(ck);
      for (var i = 0; i < ks.length; i++) {
        if (!self.keys[ks[i]]) self.pressed[ks[i]] = true;
        self.keys[ks[i]] = true;
      }
      if ([' ', 'tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].indexOf(ck) >= 0) e.preventDefault();
    }
    function onUp(e) {
      var k = (e.key || '').toLowerCase(), ck = codeKey(e);
      if (k) { self.keys[k] = false; self.released[k] = true; }
      if (ck) { self.keys[ck] = false; self.released[ck] = true; }
    }
    document.addEventListener('keydown', onDown, true);
    document.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', function () { self.keys = {}; self.drag.active = false; });

    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('mouseenter', function () { self.mouse.inside = true; });
    canvas.addEventListener('mouseleave', function () { self.mouse.inside = false; });

    canvas.addEventListener('mousedown', function (e) {
      self.updatePos(e);
      if (e.button === 0) self.mouse.down = true;
      else if (e.button === 2) self.mouse.rdown = true;
      else if (e.button === 1) self.mouse.mdown = true;
      self.drag.active = true;
      self.drag.button = e.button;
      self.drag.x0 = self.mouse.x; self.drag.y0 = self.mouse.y;
      self.drag.x1 = self.mouse.x; self.drag.y1 = self.mouse.y;
      self.drag.moved = 0;
      self.drag.t0 = performance.now();
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      var px = self.mouse.x, py = self.mouse.y;
      self.updatePos(e);
      self.dx = self.mouse.x - px;
      self.dy = self.mouse.y - py;
      if (self.drag.active) {
        self.drag.x1 = self.mouse.x; self.drag.y1 = self.mouse.y;
        self.drag.moved += Math.abs(self.dx) + Math.abs(self.dy);
      }
    });
    window.addEventListener('mouseup', function (e) {
      if (self.drag.active && self.drag.button === e.button) {
        self.clicks.push({
          button: e.button,
          x: self.mouse.x, y: self.mouse.y,
          x0: self.drag.x0, y0: self.drag.y0,
          moved: self.drag.moved,
          held: performance.now() - self.drag.t0,
          shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey
        });
        self.drag.active = false;
      }
      if (e.button === 0) self.mouse.down = false;
      else if (e.button === 2) self.mouse.rdown = false;
      else if (e.button === 1) self.mouse.mdown = false;
    });
    canvas.addEventListener('dblclick', function (e) { self.dbl = true; e.preventDefault(); });
    canvas.addEventListener('wheel', function (e) {
      var d = e.deltaY;
      if (e.deltaMode === 1) d *= 18; else if (e.deltaMode === 2) d *= 400;
      self.wheel += M.clamp(d / 100, -3, 3);
      e.preventDefault();
    }, { passive: false });
  }

  Input.prototype.updatePos = function (e) {
    var r = this.canvas.getBoundingClientRect();
    this.mouse.x = e.clientX - r.left;
    this.mouse.y = e.clientY - r.top;
    this.mouse.ndcX = (this.mouse.x / r.width) * 2 - 1;
    this.mouse.ndcY = 1 - (this.mouse.y / r.height) * 2;
    this.viewW = r.width; this.viewH = r.height;
  };
  Input.prototype.endFrame = function () {
    this.pressed = {};
    this.released = {};
    this.wheel = 0;
    this.clicks.length = 0;
    this.dbl = false;
    this.dx = 0; this.dy = 0;
  };
  Input.prototype.key = function (k) { return !!this.keys[k]; };
  Input.prototype.hit = function (k) { return !!this.pressed[k]; };
  Input.prototype.shift = function () { return !!this.keys['shift']; };
  Input.prototype.ctrl = function () { return !!this.keys['control'] || !!this.keys['meta']; };
  Input.prototype.alt = function () { return !!this.keys['alt']; };
  IN.Input = Input;

  // ------------------------------------------------------------------
  //  CAMERA RIG
  // ------------------------------------------------------------------
  function Rig(camera) {
    this.cam = camera;
    this.focus = v3.create(0, 6, 0);
    this.wantFocus = v3.create(0, 6, 0);
    this.dist = 38; this.wantDist = 38;
    this.yaw = 0; this.wantYaw = 0;
    this.pitch = 0.10; this.wantPitch = 0.10;
    this.mode = 'farm';
    this.follow = null;
    this.shakeT = 0;
    this.minDist = 1.2;
    this.maxDist = 150;
    this.fovBase = 42;
    this.bounds = null;
    this.orbited = false;
    this.opt = {
      invertX: false, invertY: false, edgeScroll: false,
      panSpeed: 1.0, orbitSpeed: 1.0, zoomSpeed: 1.0,
      smoothing: 1.0, zoomToCursor: true
    };
  }

  //  Generous. These exist only to stop the camera wandering into the void,
  //  not to keep it pointed at the tank - the player should be able to look
  //  wherever they like.
  Rig.prototype.setBounds = function (world) {
    var f0 = world.farms[0];
    this.bounds = {
      minX: -world.shelfWidth * 1.6, maxX: world.shelfWidth * 1.6,
      minY: -f0.half[1] * 2.2 - 20, maxY: f0.half[1] * 2.2 + 60,
      minZ: -70, maxZ: 70
    };
  };
  //  Frame the whole tank: derive the distance from its half-width and the
  //  actual horizontal field of view, so the glass never gets cropped.
  Rig.prototype.setFarm = function (farm, instant) {
    this.mode = 'farm';
    this.follow = null;
    v3.set(this.wantFocus, farm.center[0], farm.center[1] + 0.8, farm.center[2]);
    var aspect = (this.cam && this.cam._aspect) || 1.78;
    var halfV = Math.tan((this.fovBase * 0.5) * M.DEG);
    var halfH = Math.atan(halfV * aspect);
    this.wantDist = M.clamp(farm.half[0] / Math.tan(halfH) * 1.14 + farm.half[2] * 0.6,
      12, this.maxDist);
    this.wantYaw = 0;
    this.wantPitch = 0.09;
    if (instant) this.snap();
  };
  Rig.prototype.setShelf = function (world, instant) {
    this.mode = 'shelf';
    this.follow = null;
    v3.set(this.wantFocus, 0, world.shelfHeight * 0.42, 0);
    this.wantDist = world.shelfWidth * 1.22;
    this.wantYaw = 0;
    this.wantPitch = 0.05;
    if (instant) this.snap();
  };
  Rig.prototype.followAnt = function (ant) {
    this.mode = 'follow';
    this.follow = ant;
    this.wantDist = Math.min(this.wantDist, 3.6);
    this.wantPitch = 0.20;
  };
  Rig.prototype.frame = function (pos, dist) {
    this.mode = 'free';
    this.follow = null;
    v3.set(this.wantFocus, pos[0], pos[1], pos[2]);
    if (dist) this.wantDist = dist;
  };
  Rig.prototype.snap = function () {
    v3.copy(this.focus, this.wantFocus);
    this.dist = this.wantDist; this.yaw = this.wantYaw; this.pitch = this.wantPitch;
  };

  var _o = new Float32Array(3), _d = new Float32Array(3), _w = new Float32Array(3);
  Rig.prototype.cursorWorld = function (out, input, game) {
    var cam = this.cam;
    cam.ray(input.mouse.ndcX, input.mouse.ndcY, _o, _d);
    var planeZ = game && game.activeFarm ? game.activeFarm.digZ : this.focus[2];
    var t;
    if (Math.abs(_d[2]) > 0.12) t = (planeZ - _o[2]) / _d[2];
    else t = (this.focus[1] - _o[1]) / (Math.abs(_d[1]) > 1e-4 ? _d[1] : 1e-4);
    if (!(t > 0.1) || t > 1000) return false;
    out[0] = _o[0] + _d[0] * t;
    out[1] = _o[1] + _d[1] * t;
    out[2] = _o[2] + _d[2] * t;
    return true;
  };

  Rig.prototype.update = function (dt, input, game) {
    var o = this.opt;
    var cam = this.cam;

    if (this.mode === 'follow') {
      if (!this.follow || this.follow.isDead()) { this.mode = 'free'; this.follow = null; }
      else v3.set(this.wantFocus, this.follow.pos[0], this.follow.pos[1] + 0.45, this.follow.pos[2]);
    }

    //  ---------- keyboard movement ----------
    //  Standard game feel: A/D strafe, W/S go forward and back, and both are
    //  measured in the camera's own frame so the world always moves the way
    //  you pressed. Nothing here is gated on mode, hover, focus or bounds -
    //  the keys move the camera, full stop.
    var boost = input.shift() ? 3.0 : 1;
    var kspeed = boost * dt * Math.max(9, this.dist * 0.95) * (o.panSpeed || 1);
    var kx = 0, kz = 0, kyUp = 0;
    if (input.key('a') || input.key('arrowleft')) kx -= 1;
    if (input.key('d') || input.key('arrowright')) kx += 1;
    if (input.key('w') || input.key('arrowup')) kz += 1;
    if (input.key('s') || input.key('arrowdown')) kz -= 1;
    if (input.key('r') || input.key('pageup')) kyUp += 1;
    if (input.key('v') || input.key('pagedown')) kyUp -= 1;
    if (o.edgeScroll && input.mouse.inside && !input.uiHover) {
      var m = 20;
      if (input.mouse.x < m) kx -= 1;
      else if (input.mouse.x > input.viewW - m) kx += 1;
      if (input.mouse.y < m) kz += 1;
      else if (input.mouse.y > input.viewH - m) kz -= 1;
    }
    if (kx || kz || kyUp) {
      // camera basis flattened onto the ground plane
      var sy = Math.sin(this.yaw), cyw = Math.cos(this.yaw);
      var fwdX = -sy, fwdZ = -cyw;          // where the camera looks
      var rgtX = cyw, rgtZ = -sy;           // camera right
      var l = Math.sqrt(kx * kx + kz * kz) || 1;
      this.wantFocus[0] += (rgtX * kx + fwdX * kz) / l * kspeed;
      this.wantFocus[2] += (rgtZ * kx + fwdZ * kz) / l * kspeed;
      this.wantFocus[1] += kyUp * kspeed * 0.85;
      if (this.mode !== 'shelf') this.mode = 'free';
      this.follow = null;
    }
    if (input.key('q')) this.wantYaw -= dt * 1.5;
    if (input.key('e')) this.wantYaw += dt * 1.5;

    // ---------- mouse pan : grab the world ----------
    var panning = input.drag.active &&
      (input.drag.button === 1 || input.mouse.mdown ||
        (input.drag.button === 0 && (input.ctrl() || input.key(' '))) ||
        (input.drag.button === 2 && input.shift()));
    if (panning && (input.dx || input.dy)) {
      var s = this.dist * 0.0017 * o.panSpeed;
      this.wantFocus[0] -= rx * input.dx * s;
      this.wantFocus[2] -= rz * input.dx * s;
      this.wantFocus[1] += input.dy * s;
      this.mode = 'free'; this.follow = null;
    }

    // ---------- mouse orbit ----------
    var orbiting = !panning && input.drag.active &&
      ((input.drag.button === 2 && input.drag.moved > 5) || (input.drag.button === 0 && input.alt()));
    if (orbiting && (input.dx || input.dy)) {
      var os = 0.0055 * o.orbitSpeed;
      this.wantYaw += (o.invertX ? -1 : 1) * input.dx * os;
      this.wantPitch += (o.invertY ? -1 : 1) * (-input.dy) * os * 0.85;
      this.orbited = true;
    }

    // ---------- zoom toward the cursor ----------
    // No uiHover gate: the wheel listener lives on the canvas, so a panel
    // that wants the wheel has already swallowed the event before we see it.
    if (input.wheel) {
      var before = this.wantDist;
      this.wantDist = M.clamp(this.wantDist * Math.pow(1.19, input.wheel * o.zoomSpeed), this.minDist, this.maxDist);
      if (o.zoomToCursor && this.mode !== 'follow' && this.cursorWorld(_w, input, game)) {
        var k = 1 - this.wantDist / Math.max(before, 1e-3);
        this.wantFocus[0] += (_w[0] - this.wantFocus[0]) * k * 0.9;
        this.wantFocus[1] += (_w[1] - this.wantFocus[1]) * k * 0.9;
        if (this.mode === 'shelf') this.mode = 'free';
      }
      if (this.mode === 'follow' && this.wantDist > 10) { this.mode = 'free'; this.follow = null; }
    }

    this.wantDist = M.clamp(this.wantDist, this.minDist, this.maxDist);
    this.wantPitch = M.clamp(this.wantPitch, -0.40, 1.28);

    if (this.bounds && this.mode !== 'follow') {
      this.wantFocus[0] = M.clamp(this.wantFocus[0], this.bounds.minX, this.bounds.maxX);
      this.wantFocus[1] = M.clamp(this.wantFocus[1], this.bounds.minY, this.bounds.maxY);
      this.wantFocus[2] = M.clamp(this.wantFocus[2], this.bounds.minZ, this.bounds.maxZ);
    }

    var lam = (this.mode === 'follow' ? 11 : 9) / Math.max(0.25, o.smoothing);
    this.dist = M.damp(this.dist, this.wantDist, lam, dt);
    this.yaw = M.damp(this.yaw, this.wantYaw, lam, dt);
    this.pitch = M.damp(this.pitch, this.wantPitch, lam, dt);
    v3.lerp(this.focus, this.focus, this.wantFocus, 1 - Math.exp(-lam * dt));

    var cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    var cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    var shake = game && game.fx ? game.fx.shakeAmt : 0;
    var sx = 0, sy2 = 0;
    if (shake > 0.001) {
      this.shakeT += dt * 46;
      sx = Math.sin(this.shakeT * 1.7) * shake * 0.26;
      sy2 = Math.cos(this.shakeT * 2.3) * shake * 0.22;
    }
    v3.set(cam.target, this.focus[0] + sx, this.focus[1] + sy2, this.focus[2]);
    v3.set(cam.pos,
      this.focus[0] + sy * cp * this.dist + sx,
      this.focus[1] + sp * this.dist + sy2,
      this.focus[2] + cy * cp * this.dist);
    this.avoidSoil(game);
    cam.fov = (this.fovBase - M.clamp(16 - this.dist, 0, 11) * 0.9) * M.DEG;
  };

  //  Keep the eye out of packed soil. Without this the camera buries itself,
  //  the soil raymarch finds no surface to hit, and the whole tank reads as
  //  props floating in an empty room.
  Rig.prototype.avoidSoil = function (game) {
    if (!game || !game.world || !game.world.farms) return;
    var cam = this.cam;
    var margin = 0.14;   // just enough to stay out of solid soil, not out of tunnels
    var farms = game.world.farms;
    for (var pass = 0; pass < 6; pass++) {
      var hit = null, hitD = margin;
      for (var i = 0; i < farms.length; i++) {
        var f = farms[i];
        if (Math.abs(cam.pos[0] - f.center[0]) > f.half[0] + margin) continue;
        if (Math.abs(cam.pos[1] - f.center[1]) > f.half[1] + margin) continue;
        if (Math.abs(cam.pos[2] - f.center[2]) > f.half[2] + margin) continue;
        var d = f.soilSDF(cam.pos[0], cam.pos[1], cam.pos[2]);
        if (d < hitD) { hitD = d; hit = f; }
      }
      if (!hit) break;
      var e = 0.14;
      var d0 = hit.soilSDF(cam.pos[0], cam.pos[1], cam.pos[2]);
      var gx = hit.soilSDF(cam.pos[0] + e, cam.pos[1], cam.pos[2]) - d0;
      var gy = hit.soilSDF(cam.pos[0], cam.pos[1] + e, cam.pos[2]) - d0;
      var gz = hit.soilSDF(cam.pos[0], cam.pos[1], cam.pos[2] + e) - d0;
      var l = Math.sqrt(gx * gx + gy * gy + gz * gz);
      if (l < 1e-5) { cam.pos[1] += margin; continue; }
      var push = (margin - d0) + 0.03;
      cam.pos[0] += gx / l * push;
      cam.pos[1] += gy / l * push;
      cam.pos[2] += gz / l * push;
    }
    // and never leave the room
    cam.pos[0] = M.clamp(cam.pos[0], -140, 140);
    cam.pos[1] = M.clamp(cam.pos[1], -18, 62);
    cam.pos[2] = M.clamp(cam.pos[2], -95, 105);
  };
  IN.Rig = Rig;

  AF.IN = IN;
})(window.AF = window.AF || {});

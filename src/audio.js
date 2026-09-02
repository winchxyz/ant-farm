/* =============================================================
   FORMICARIUM :: DEEP COLONY
   audio.js - fully procedural WebAudio (no sample files)
   ============================================================= */
(function (AF) {
  'use strict';
  var M = AF.M;

  function Audio() {
    this.ctx = null;
    this.ready = false;
    this.masterVol = 0.8;
    this.musicVol = 0.45;
    this.sfxVol = 0.7;
    this.rng = new M.RNG(777);
    this.listener = [0, 0, 0];
    this.lastPlay = {};
    this.musicOn = true;
    this.tension = 0;
  }

  //  Audio must never be able to stop the game from starting: any failure
  //  here (no device, blocked context, exhausted contexts) degrades to silence.
  Audio.prototype.init = function () {
    try { this._init(); }
    catch (e) {
      console.warn('audio unavailable, continuing silently:', e && e.message);
      this.ready = false;
      this.ctx = null;
      this.failed = true;
    }
  };

  Audio.prototype._init = function () {
    if (this.ctx || this.failed) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.failed = true; return; }
    var ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.masterVol;
    this.master.connect(ctx.destination);

    // gentle bus compressor keeps the swarm from clipping
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;
    this.comp.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVol;
    this.sfxBus.connect(this.comp);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVol;
    this.musicBus.connect(this.comp);

    // space: a short feedback delay acting as a cheap reverb
    this.verbIn = ctx.createGain();
    this.verbIn.gain.value = 0.30;
    var d1 = ctx.createDelay(1.0); d1.delayTime.value = 0.083;
    var d2 = ctx.createDelay(1.0); d2.delayTime.value = 0.127;
    var fb = ctx.createGain(); fb.gain.value = 0.42;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    this.verbIn.connect(d1); d1.connect(lp); lp.connect(fb); fb.connect(d2); d2.connect(d1);
    var wet = ctx.createGain(); wet.gain.value = 0.5;
    lp.connect(wet); d2.connect(wet);
    wet.connect(this.comp);

    this.noiseBuf = this._makeNoise(2.0);
    this.ready = true;
    this._startMusic();
    this._startAmbience();
  };

  Audio.prototype.resume = function () {
    try { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); } catch (e) { }
  };

  Audio.prototype._makeNoise = function (secs) {
    var ctx = this.ctx;
    var len = Math.floor(ctx.sampleRate * secs);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  };

  Audio.prototype._env = function (node, t0, a, d, peak, sustain, rel) {
    //  WebAudio rejects a non-finite ramp target with a hard TypeError, and
    //  this is the last place a bad number can be stopped before it becomes
    //  one. Play() guards the gain it computes, but every caller passes its
    //  own peak, so the check belongs here too - a silent note is a fair
    //  price for never taking the frame down over a sound effect.
    if (!isFinite(t0) || !isFinite(a) || !isFinite(d) || !isFinite(peak) ||
      (sustain !== undefined && !isFinite(sustain)) || (rel && !isFinite(rel))) {
      if (!Audio._badEnv) { Audio._badEnv = 1; console.warn('audio: non-finite envelope', { t0: t0, a: a, d: d, peak: peak, sustain: sustain, rel: rel }); }
      return;
    }
    var g = node.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    if (sustain !== undefined && rel) {
      g.exponentialRampToValueAtTime(Math.max(0.0002, sustain), t0 + a + d);
      g.exponentialRampToValueAtTime(0.0001, t0 + a + d + rel);
    } else {
      g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    }
  };

  Audio.prototype._tone = function (type, freq, t0, dur, vol, dest, detune) {
    var ctx = this.ctx;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (detune) o.detune.value = detune;
    o.connect(g); g.connect(dest || this.sfxBus);
    this._env(g, t0, Math.min(0.012, dur * 0.2), dur, vol);
    o.start(t0); o.stop(t0 + dur + 0.06);
    return { o: o, g: g };
  };

  Audio.prototype._noise = function (t0, dur, vol, filterType, freq, q, dest) {
    var ctx = this.ctx;
    var s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = filterType || 'bandpass';
    f.frequency.setValueAtTime(freq || 1200, t0);
    f.Q.value = q || 1.2;
    var g = ctx.createGain();
    s.connect(f); f.connect(g); g.connect(dest || this.sfxBus);
    this._env(g, t0, 0.004, dur, vol);
    s.start(t0); s.stop(t0 + dur + 0.05);
    return { s: s, f: f, g: g };
  };

  // ------------------------------------------------------------------
  //  SFX
  // ------------------------------------------------------------------
  Audio.prototype.play = function (name, pos, vol) {
    if (!this.ready) return;
    var now = this.ctx.currentTime;
    // rate limit: the swarm generates thousands of events
    var lim = { bite: 0.045, dig: 0.07, step: 0.03, hatch: 0.09 }[name];
    if (lim) {
      var lp = this.lastPlay[name] || 0;
      if (now - lp < lim) return;
      this.lastPlay[name] = now;
    }
    var gainScale = 1;
    if (pos) {
      var dx = pos[0] - this.listener[0], dy = pos[1] - this.listener[1], dz = pos[2] - this.listener[2];
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      //  NaN SURVIVES M.clamp. It is `x < a ? a : (x > b ? b : x)`, and both
      //  comparisons are false for NaN, so a NaN distance comes straight back
      //  out - and `NaN < 0.02` is false too, so the quiet-enough early-out
      //  below waved it through into exponentialRampToValueAtTime, which
      //  rejects non-finite values with a TypeError. That threw out of
      //  Game.update and, with the identical stack twice in a row, took the
      //  whole frame loop down. Caught in the wild by the new error capture
      //  while digging: two throws, same stack, game over.
      //
      //  Test the distance itself rather than the clamped result: a bad
      //  emitter position or a bad listener is not a quiet sound, it is a
      //  sound with no position, and it should simply not play.
      if (!isFinite(d)) return;
      gainScale = M.clamp(1 - d / 90, 0, 1);
      gainScale *= gainScale;
      if (gainScale < 0.02) return;
    }
    gainScale *= (vol === undefined ? 1 : vol);
    if (!isFinite(gainScale)) return;          // a non-finite vol from a caller
    var t = now + 0.001;
    var r = this.rng;
    switch (name) {
      case 'bite': {
        var f = 220 + r.range(-40, 60);
        this._noise(t, 0.055, 0.22 * gainScale, 'bandpass', f * 4.5, 6);
        this._tone('square', f, t, 0.05, 0.10 * gainScale);
        break;
      }
      case 'dig': {
        this._noise(t, 0.14, 0.16 * gainScale, 'lowpass', 700 + r.range(-160, 260), 0.9);
        break;
      }
      case 'step': {
        this._noise(t, 0.03, 0.05 * gainScale, 'highpass', 3200, 0.8);
        break;
      }
      case 'hatch': {
        this._tone('sine', 520 + r.range(-40, 90), t, 0.20, 0.10 * gainScale, this.verbIn);
        this._tone('sine', 780 + r.range(-60, 120), t + 0.05, 0.18, 0.07 * gainScale, this.verbIn);
        break;
      }
      case 'build': {
        this._tone('triangle', 320, t, 0.10, 0.14 * gainScale);
        this._tone('triangle', 480, t + 0.09, 0.14, 0.13 * gainScale, this.verbIn);
        this._tone('triangle', 640, t + 0.18, 0.22, 0.11 * gainScale, this.verbIn);
        break;
      }
      case 'click': {
        this._tone('square', 900, t, 0.028, 0.09);
        this._noise(t, 0.02, 0.05, 'highpass', 4200, 1);
        break;
      }
      case 'hover': {
        this._tone('sine', 1500, t, 0.030, 0.028);
        break;
      }
      case 'deny': {
        this._tone('sawtooth', 150, t, 0.10, 0.10);
        this._tone('sawtooth', 112, t + 0.07, 0.14, 0.09);
        break;
      }
      case 'order': {
        this._tone('sine', 660, t, 0.06, 0.09);
        this._tone('sine', 990, t + 0.045, 0.10, 0.07, this.verbIn);
        break;
      }
      case 'alert': {
        this._tone('sawtooth', 330, t, 0.24, 0.13, this.verbIn);
        this._tone('sawtooth', 247, t + 0.20, 0.30, 0.13, this.verbIn);
        break;
      }
      case 'raid': {
        var o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(70, t);
        o.frequency.exponentialRampToValueAtTime(180, t + 0.9);
        var flt = this.ctx.createBiquadFilter();
        flt.type = 'lowpass'; flt.frequency.value = 900;
        o.connect(flt); flt.connect(g); g.connect(this.verbIn); g.connect(this.sfxBus);
        this._env(g, t, 0.09, 1.1, 0.22);
        o.start(t); o.stop(t + 1.4);
        break;
      }
      case 'death': {
        this._noise(t, 0.16, 0.11 * gainScale, 'bandpass', 420, 2.4);
        this._tone('triangle', 160, t, 0.16, 0.07 * gainScale);
        break;
      }
      case 'unlock': {
        var sc = [523.25, 659.25, 783.99, 1046.5];
        for (var i = 0; i < sc.length; i++) this._tone('sine', sc[i], t + i * 0.075, 0.34, 0.10, this.verbIn);
        break;
      }
      case 'collapse': {
        this._noise(t, 0.7, 0.28 * gainScale, 'lowpass', 320, 0.8, this.verbIn);
        this._tone('sine', 58, t, 0.6, 0.20 * gainScale);
        break;
      }
      case 'splash': {
        this._noise(t, 0.24, 0.14 * gainScale, 'bandpass', 1800, 1.6, this.verbIn);
        break;
      }
      case 'win': {
        var w = [261.6, 329.6, 392.0, 523.3, 659.3];
        for (var k = 0; k < w.length; k++) this._tone('triangle', w[k], t + k * 0.14, 0.9, 0.12, this.verbIn);
        break;
      }
      case 'lose': {
        var l = [220, 196, 174.6, 130.8];
        for (var q = 0; q < l.length; q++) this._tone('sawtooth', l[q], t + q * 0.28, 1.1, 0.11, this.verbIn);
        break;
      }
    }
  };

  // ------------------------------------------------------------------
  //  GENERATIVE SCORE
  //  slow modal pad + sparse plucked motif; tension raises the register
  // ------------------------------------------------------------------
  Audio.prototype._startMusic = function () {
    var self = this;
    var ctx = this.ctx;
    // drone pad
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.0;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 420;
    this.padFilter.Q.value = 2.4;
    this.padGain.connect(this.padFilter);
    this.padFilter.connect(this.musicBus);
    this.padFilter.connect(this.verbIn);

    var base = 55; // A1
    this.padOscs = [];
    var ratios = [1, 1.5, 2, 3, 4.02, 6.01];
    for (var i = 0; i < ratios.length; i++) {
      var o = ctx.createOscillator();
      o.type = i < 3 ? 'sawtooth' : 'sine';
      o.frequency.value = base * ratios[i];
      o.detune.value = (i - 2.5) * 6;
      var g = ctx.createGain();
      g.gain.value = 0.16 / (1 + i * 0.6);
      o.connect(g); g.connect(this.padGain);
      o.start();
      this.padOscs.push({ o: o, g: g, r: ratios[i] });
    }
    this.padGain.gain.setTargetAtTime(0.22, ctx.currentTime, 4.0);

    // filter LFO
    var lfo = ctx.createOscillator();
    lfo.frequency.value = 0.043;
    var lfoG = ctx.createGain();
    lfoG.gain.value = 200;
    lfo.connect(lfoG); lfoG.connect(this.padFilter.frequency);
    lfo.start();

    this.scale = [0, 2, 3, 5, 7, 8, 10];   // aeolian
    this.musicStep = 0;
    this.musicTimer = setInterval(function () { self._musicTick(); }, 2400);
  };

  Audio.prototype._musicTick = function () {
    if (!this.ready || !this.musicOn) return;
    var ctx = this.ctx;
    var t = ctx.currentTime + 0.05;
    var r = this.rng;
    this.musicStep++;
    var tension = M.saturate(this.tension);
    // pad brightness follows tension
    this.padFilter.frequency.setTargetAtTime(360 + tension * 900, t, 3.0);
    if (r.chance(0.55 + tension * 0.3)) {
      var oct = r.chance(0.5) ? 2 : 3;
      var deg = this.scale[r.int(this.scale.length)];
      var f = 55 * Math.pow(2, oct + deg / 12);
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      var flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.setValueAtTime(1800 + tension * 2400, t);
      flt.frequency.exponentialRampToValueAtTime(420, t + 1.6);
      o.type = r.chance(0.5) ? 'triangle' : 'sine';
      o.frequency.value = f;
      o.connect(flt); flt.connect(g); g.connect(this.musicBus); g.connect(this.verbIn);
      this._env(g, t, 0.012, 1.5, 0.085 + tension * 0.05);
      o.start(t); o.stop(t + 1.8);
    }
    // heartbeat under high tension
    if (tension > 0.45 && r.chance(tension)) {
      var b = ctx.createOscillator(), bg = ctx.createGain();
      b.type = 'sine';
      b.frequency.setValueAtTime(64, t);
      b.frequency.exponentialRampToValueAtTime(38, t + 0.28);
      b.connect(bg); bg.connect(this.musicBus);
      this._env(bg, t, 0.008, 0.30, 0.26 * tension);
      b.start(t); b.stop(t + 0.4);
    }
  };

  // faint room tone + skittering
  Audio.prototype._startAmbience = function () {
    var ctx = this.ctx;
    var s = ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 320;
    var g = ctx.createGain(); g.gain.value = 0.020;
    s.connect(f); f.connect(g); g.connect(this.musicBus);
    s.start();
    this.roomTone = g;
    var self = this;
    this.skitterTimer = setInterval(function () {
      if (!self.ready || !self.busy) return;
      var n = Math.min(6, Math.floor(self.busy / 45));
      for (var i = 0; i < n; i++) {
        var t = self.ctx.currentTime + Math.random() * 0.5;
        self._noise(t, 0.018, 0.012 + Math.random() * 0.012, 'bandpass', 2600 + Math.random() * 3800, 4);
      }
    }, 620);
  };

  Audio.prototype.setListener = function (p) { this.listener = p; };
  Audio.prototype.setTension = function (t) { this.tension = M.saturate(t); };
  Audio.prototype.setBusy = function (n) { this.busy = n; };
  Audio.prototype.setVolumes = function (master, music, sfx) {
    this.masterVol = master; this.musicVol = music; this.sfxVol = sfx;
    if (!this.ready) return;
    this.master.gain.value = master;
    this.musicBus.gain.value = music;
    this.sfxBus.gain.value = sfx;
  };

  AF.Audio = Audio;
})(window.AF = window.AF || {});

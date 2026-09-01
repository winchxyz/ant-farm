/* =============================================================
   FORMICARIUM :: DEEP COLONY
   main.js - boot + frame loop
   ============================================================= */
(function (AF) {
  'use strict';

  var Game = AF.Game, R = AF.R, UI = AF.UI;
  var canvas, last = 0, acc = 0, frames = 0;

  function fatal(msg) {
    document.getElementById('bootMsg').innerHTML =
      '<span style="color:#ff5b48">' + msg + '</span>';
  }

  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    canvas = document.getElementById('gl');
    UI.setBoot(6, 'opening WebGL2 context…');

    setTimeout(function () {
      if (!R.init(canvas)) {
        fatal('WebGL2 is unavailable in this browser.<br>Try Chrome, Edge or Firefox with hardware acceleration on.');
        return;
      }
      UI.setBoot(34, 'compiling ' + Object.keys(R.P).length + ' shader programs…');
      setTimeout(function () {
        Game.init(canvas, UI);
        UI.setBoot(62, 'growing procedural geometry…');
        setTimeout(function () {
          UI.setBoot(88, 'calibrating the vitrines…');
          setTimeout(function () {
            UI.initMenu(Game, startGame);
            UI.setBoot(100, 'ready');
            setTimeout(function () {
              UI.hideBoot();
              UI.showMenu();
            }, 260);
            requestAnimationFrame(loop);
          }, 60);
        }, 60);
      }, 40);
    }, 40);
  }

  function startGame(sel) {
    try {
      UI.applyQuality(sel.quality);
      Game.newGame(sel);
      Game.buildStatics();
      Game.showPheromones = false;   // scent view is an opt-in overlay (M), not the default look
      UI.hideMenu();
      UI.initHUD(Game);
      // one tank: open on it directly, with a short easing push-in
      Game.rig.setFarm(Game.world.farms[0], true);
      Game.rig.wantDist = Game.rig.dist * 1.35;
      Game.rig.dist = Game.rig.wantDist;
      Game.rig.opt.smoothing = 2.6;
      Game.rig.setFarm(Game.world.farms[0]);
      setTimeout(function () { Game.rig.opt.smoothing = 1.0; }, 2200);
    } catch (err) {
      console.error(err);
      alert('Failed to start: ' + err.message);
    }
  }

  function effectiveDpr() {
    return Math.min(window.devicePixelRatio || 1, Game.dprCap || 1.35) *
      (Game.perfScale === undefined ? 1 : Game.perfScale);
  }
  function targetWidth() {
    return Math.max(320, Math.floor(window.innerWidth * effectiveDpr()));
  }
  function resize() {
    R.resize(window.innerWidth, window.innerHeight, effectiveDpr());
  }
  window.addEventListener('resize', resize);

  function loop(now) {
    requestAnimationFrame(loop);
    var dt = last ? (now - last) / 1000 : 0.016;
    last = now;
    if (dt > 0.25) dt = 0.25;

    // fps + adaptive resolution: hold 60 by trading pixels, never features
    acc += dt; frames++;
    if (acc > 0.5) {
      Game.fps = frames / acc; acc = 0; frames = 0;
      if (Game.state === 'play' && Game.autoPerf !== false) {
        var target = Game.dprCap || 1.35;
        Game.perfScale = Game.perfScale === undefined ? 1 : Game.perfScale;
        if (Game.fps < 38 && Game.perfScale > 0.62) { Game.perfScale -= 0.09; Game.forceResize = true; }
        else if (Game.fps > 57 && Game.perfScale < 1) { Game.perfScale = Math.min(1, Game.perfScale + 0.04); Game.forceResize = true; }
      }
    }

    if (Game.forceResize) { Game.forceResize = false; R.width = 0; resize(); }
    if (R.width !== targetWidth()) resize();

    if (Game.state === 'menu' || !Game.world) {
      // idle: gentle drifting shot of an empty shelf is not built yet,
      // so simply clear to the room colour.
      var gl = R.gl;
      AF.GLX.bindScreen(R.width, R.height);
      gl.clearColor(0.024, 0.026, 0.032, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (Game.input) Game.input.endFrame();
      return;
    }

    try {
      Game.handleInput(dt);
      Game.update(dt);          // camera rig consumes wheel / mouse delta here
      Game.render();
      UI.update(Game, now);
      updateSelBox();
      Game.input.endFrame();    // retire the frame's input only once everyone read it
    } catch (err) {
      console.error('frame error', err);
      Game.state = 'error';
      fatal('Runtime error: ' + err.message);
      document.getElementById('boot').classList.remove('hidden');
    }
  }

  AF.__loop = loop;   // dev: lets the headless harness drive the real frame body
  function updateSelBox() {
    var b = document.getElementById('selbox');
    var inp = Game.input;
    if (inp.drag.active && inp.drag.button === 0 && inp.drag.moved > 9 &&
      Game.buildType < 0 && !Game.pheroMode && !Game.input.ctrl() && !Game.input.alt()) {
      var x = Math.min(inp.drag.x0, inp.drag.x1), y = Math.min(inp.drag.y0, inp.drag.y1);
      var w = Math.abs(inp.drag.x1 - inp.drag.x0), h = Math.abs(inp.drag.y1 - inp.drag.y0);
      b.style.left = x + 'px'; b.style.top = y + 'px';
      b.style.width = w + 'px'; b.style.height = h + 'px';
      b.classList.remove('hidden');
    } else b.classList.add('hidden');
  }

  window.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})(window.AF = window.AF || {});

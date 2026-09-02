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

  // ==================================================================
  //  FRAME ERRORS: keep the evidence, and survive one bad frame
  // ==================================================================
  //  What used to happen: anything thrown anywhere in the frame body was
  //  caught, handed to console.error, and then the game set state 'error'
  //  and put the boot overlay back up permanently. Three separate things
  //  were wrong with that.
  //
  //  NOTHING WAS KEPT. err.stack went to the console and nowhere else, so a
  //  report of "it broke once, about twenty seconds after the queen died"
  //  arrived with no stack, no frame number, no sim clock, and no idea which
  //  of the four stages threw. That is exactly the state the bug ledger has
  //  been stuck in, and replaying nine thousand frames does not fix it - the
  //  evidence has to be captured at the moment it happens, in the run that
  //  happens to hit it.
  //
  //  NOTHING ACTUALLY STOPPED. state 'error' ends nothing:
  //  requestAnimationFrame is queued at the top of the loop, the bail above
  //  only tests 'menu', and Game.handleInput returns early on any non-play
  //  state. So the simulation carried right on stepping behind an overlay
  //  that claimed the game was dead, throwing the same exception sixty times
  //  a second and burning the evidence of the first one.
  //
  //  AND ONE BAD FRAME IS USUALLY NOT FATAL - but not always, which is why
  //  the policy is per stage rather than blanket. A render or a UI throw is
  //  almost always a stale reference or a DOM node, and the simulation is
  //  untouched: skipping that stage for one frame costs a hitch and nothing
  //  else. An exception out of Game.update is a different animal. It leaves
  //  the tick half applied - some colonies stepped and some not, a reap loop
  //  abandoned mid-splice - and a corrupted simulation that keeps stepping
  //  is worse than a stopped one, because every later frame builds on the
  //  damage until the eventual report describes the wreckage instead of the
  //  cause. So an update throw is counted hard.
  //
  //  Policy: record every error with its stage and a snapshot of the world;
  //  tolerate input, render and UI errors; go terminal on the second
  //  occurrence of an IDENTICAL stack (that one is never going to heal), on
  //  the second Game.update error inside the window, or on eight errors of
  //  any kind in four seconds. Terminal stops the stages as well as raising
  //  the overlay, so the sim is not left running underneath it.
  var ERR_WINDOW_MS = 4000;
  var ERR_BUDGET = 8;        // tolerated errors of any stage inside one window
  var ERR_LOG_MAX = 24;      // retained entries; the oldest is dropped
  var _dt = 0.016, _now = 0;
  var errWindowT = -1e9, errCount = 0, errUpdate = 0;

  Game.lastError = null;
  Game.errorLog = [];
  //  Dev and harness switch. AF.__loop is the harness entry point, and a
  //  harness whose frame body quietly swallows a throw measures a clean run
  //  over a broken game - which is precisely how a permanent, reproducible
  //  crash survived two nine-thousand-frame measurements. With this set the
  //  error is recorded exactly as it would be in play, then rethrown into
  //  the caller. AF.__loopStrict sets it for a single step.
  AF.frameStrict = false;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  //  Everything a later reader needs and cannot reconstruct: which frame,
  //  where the sim clock was, and the population of every array the frame
  //  body walks. Counts and flags only - this object outlives the frame, so
  //  holding ants or farms in it would both pin them alive and show their
  //  state an hour later rather than at the moment of the throw.
  function errSnapshot() {
    var p = Game.player;
    return {
      frame: Game.frame,
      simTime: Game.sim ? Game.sim.time : 0,
      day: Game.sim ? Game.sim.day : 0,
      state: Game.state,
      fps: Math.round(Game.fps || 0),
      ants: Game.ants ? Game.ants.length : -1,
      colonies: Game.colonies ? Game.colonies.length : -1,
      corpses: Game.corpses ? Game.corpses.length : -1,
      items: Game.items ? Game.items.length : -1,
      creatures: Game.predators ? Game.predators.length : -1,
      particles: AF.PS ? AF.PS.count() : -1,
      scoops: Game.scoops ? Game.scoops.length : -1,
      playerFarms: p ? p.farms.length : -1,
      playerAnts: p ? p.ants.length : -1,
      playerBrood: p ? p.brood.length : -1,
      queenDead: p ? !!p.queenDead : false,
      defeated: p ? !!p.defeated : false,
      ended: !!Game.result
    };
  }

  function errRecord(stage, err) {
    var e = {
      stage: stage,
      name: (err && err.name) || 'Error',
      message: (err && err.message) || String(err),
      stack: (err && err.stack) || '(no stack)',
      at: _now,
      world: errSnapshot()
    };
    Game.lastError = e;
    Game.errorLog.push(e);
    while (Game.errorLog.length > ERR_LOG_MAX) Game.errorLog.shift();
    console.error('frame error in ' + stage, e.name + ': ' + e.message, e.world);
    console.error(e.stack);
    return e;
  }

  //  The overlay shows the STACK. The message alone has never once been
  //  enough to find anything in this codebase.
  function errFatal(e) {
    Game.state = 'error';
    var w = e.world;
    document.getElementById('bootMsg').innerHTML =
      '<div style="color:#ff5b48;font-weight:700">' + esc(e.name + ': ' + e.message) + '</div>' +
      '<div style="opacity:.72;margin:6px 0 8px;font-size:12px">stage <b>' + esc(e.stage) +
      '</b> · frame ' + w.frame + ' · sim ' + w.simTime.toFixed(1) +
      's · day ' + w.day +
      ' · ants ' + w.ants + ' · colonies ' + w.colonies +
      ' · corpses ' + w.corpses + ' · items ' + w.items +
      ' · creatures ' + w.creatures + ' · particles ' + w.particles +
      '<br>player: farms ' + w.playerFarms + ' · ants ' + w.playerAnts +
      ' · brood ' + w.playerBrood +
      (w.queenDead ? ' · QUEEN DEAD' : '') +
      (w.defeated ? ' · DEFEATED' : '') +
      (w.ended ? ' · ENDED' : '') + '</div>' +
      '<pre style="text-align:left;max-height:38vh;overflow:auto;white-space:pre-wrap;' +
      'font:11px/1.45 ui-monospace,Consolas,monospace;opacity:.85;margin:0">' +
      esc(e.stack) + '</pre>' +
      '<div style="opacity:.55;margin-top:8px;font-size:11px">AF.Game.lastError · ' +
      'AF.Game.errorLog (' + Game.errorLog.length + ' kept) · AF.Game.clearErrors()</div>';
    document.getElementById('boot').classList.remove('hidden');
  }

  //  Wipe the record and let the loop run again. For the console after a fix
  //  has been pasted in, and for a harness that provokes a throw on purpose
  //  and then carries on measuring.
  Game.clearErrors = function () {
    Game.lastError = null;
    Game.errorLog.length = 0;
    errCount = 0; errUpdate = 0; errWindowT = -1e9;
    if (Game.state === 'error') Game.state = Game.result ? 'over' : 'play';
    document.getElementById('boot').classList.add('hidden');
  };

  function runStage(name, fn) {
    if (Game.state === 'error') return false;
    try {
      fn();
      return true;
    } catch (err) {
      var e = errRecord(name, err);
      if (AF.frameStrict) throw err;
      if (_now - errWindowT > ERR_WINDOW_MS) { errWindowT = _now; errCount = 0; errUpdate = 0; }
      errCount++;
      if (name === 'update') errUpdate++;
      //  An identical stack twice means the state that produced it is still
      //  there and the next frame will produce it again; nothing is gained
      //  by grinding on. Counted over the retained log, not the window.
      var same = 0;
      for (var i = 0; i < Game.errorLog.length; i++) {
        if (Game.errorLog[i].stack === e.stack) same++;
      }
      if (same >= 2 || errUpdate >= 2 || errCount >= ERR_BUDGET) errFatal(e);
      return false;
    }
  }

  //  The four stages, hoisted out of the loop so a frame allocates nothing
  //  to run them; dt and now travel in module vars for the same reason.
  function sInput() { Game.handleInput(_dt); }
  function sUpdate() { Game.update(_dt); }
  function sRender() { Game.render(); }
  //  Two stages, not one. Sharing a try block meant a UI.update throw
  //  skipped updateSelBox, which leaves the selection rectangle frozen on
  //  screen for as long as the error is tolerated - a thing the old
  //  stop-the-world handler could never show.
  function sUI() { UI.update(Game, _now); }
  function sSelBox() { updateSelBox(); }

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

    _dt = dt; _now = now;
    runStage('handleInput', sInput);
    runStage('update', sUpdate);   // camera rig consumes wheel / mouse delta here
    runStage('render', sRender);
    runStage('ui', sUI);
    runStage('selbox', sSelBox);
    //  Retire the frame input whatever happened above. Inside the old single
    //  try block this was the last statement, so any earlier throw skipped
    //  it and left the click, the double-click flag and the drag delta live
    //  for the next frame - which then threw on the same input, forever.
    if (Game.input) Game.input.endFrame();
  }

  AF.__loop = loop;   // dev: lets the headless harness drive the real frame body
  //  Strict single step. The frame body swallows tolerable errors so a live
  //  game survives a hitch - but a harness that swallows throws reports a
  //  clean nine-thousand-frame run over a broken game, which is how the pan
  //  crash stayed open. Step with this and the error is recorded exactly as
  //  it would be in play, then let out into the caller.
  AF.__loopStrict = function (t) {
    var was = AF.frameStrict;
    AF.frameStrict = true;
    try { loop(t); } finally { AF.frameStrict = was; }
  };
  function updateSelBox() {
    var b = document.getElementById('selbox');
    var inp = Game.input;
    //  The box is for picking ants out of a crowd. It has no business
    //  appearing while a tool is in hand: dragging the shovel, pouring, or
    //  placing an animal all drag with the left button too, and every one of
    //  them drew a selection rectangle over the work.
    //  `camGesture` rather than the old ctrl/alt pair: Space+left-drag is
    //  also a pan (input.js), and testing only Ctrl and Alt drew a selection
    //  rectangle across the whole tank while the player was moving the
    //  camera with it. Nobody saw that before, because panning threw on its
    //  first frame and took the game down with it.
    if (inp.drag.active && inp.drag.button === 0 && inp.drag.moved > 9 &&
      Game.buildType < 0 && !Game.digMode && !Game.spawnType && !Game.pourType &&
      !Game.pheroMode && !inp.camGesture()) {
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

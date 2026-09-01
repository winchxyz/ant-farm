/* =============================================================
   FORMICARIUM :: DEEP COLONY
   ui.js - menu, boot, and a deliberately small in-game HUD.

   The whole interface is three numbers, a day counter, and two rows
   of buttons. Anything that needed a paragraph of explanation lives
   in the hover tooltip instead of on screen.
   ============================================================= */
(function (AF) {
  'use strict';

  var M = AF.M, W = AF.W, A = AF.A, C = AF.C;
  var UI = {};

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function rgbcss(c, m) {
    m = m || 1;
    return 'rgb(' + Math.round(M.saturate(c[0] * m) * 255) + ',' +
      Math.round(M.saturate(c[1] * m) * 255) + ',' + Math.round(M.saturate(c[2] * m) * 255) + ')';
  }
  UI.rgbcss = rgbcss;

  UI.panel = null;
  UI.consumeClick = false;
  UI.game = null;

  // ==================================================================
  //  TOOLTIP
  // ==================================================================
  UI.initTip = function () {
    UI.tipEl = $('tip');
    document.addEventListener('mousemove', function (e) {
      if (!UI.tipEl || UI.tipEl.classList.contains('hidden')) return;
      UI.placeTip(e.clientX, e.clientY);
    }, { passive: true });
  };
  UI.placeTip = function (x, y) {
    var t = UI.tipEl;
    if (!t) return;
    var w = t.offsetWidth, h = t.offsetHeight;
    var left = x + 18, top = y - h - 16;
    if (left + w > window.innerWidth - 10) left = x - w - 18;
    if (left < 10) left = 10;
    if (top < 10) top = y + 22;
    if (top + h > window.innerHeight - 10) top = window.innerHeight - h - 10;
    t.style.left = left + 'px';
    t.style.top = top + 'px';
  };
  UI.hideTip = function () { if (UI.tipEl) UI.tipEl.classList.add('hidden'); };
  UI.attachTip = function (host, spec) {
    host.addEventListener('mouseenter', function (e) {
      var d = typeof spec === 'function' ? spec() : spec;
      if (!d || !UI.tipEl) return;
      UI.tipEl.innerHTML =
        '<div class="tt"><span>' + d.title + '</span>' + (d.cost ? '<em>' + d.cost + '</em>' : '') + '</div>' +
        '<div class="td">' + d.desc + '</div>' +
        (d.keys ? '<div class="tk">' + d.keys + '</div>' : '');
      UI.tipEl.classList.remove('hidden');
      UI.placeTip(e.clientX, e.clientY);
    });
    host.addEventListener('mouseleave', UI.hideTip);
    host.addEventListener('mousedown', UI.hideTip);
  };

  // ==================================================================
  //  MENU
  // ==================================================================
  UI.initMenu = function (game, onStart) {
    UI.game = game;
    var sel = { species: 'rufa', farmIndex: 0, difficulty: 'calm', quality: 'high' };
    UI.menuSel = sel;

    function chooser(host, items, initial, onPick, render) {
      if (!host) return;
      host.innerHTML = '';
      items.forEach(function (it, i) {
        var d = el('div', 'choice' + (i === initial ? ' on' : ''));
        d.innerHTML = render(it, i);
        d.onmouseenter = function () { if (UI.game.audio.ready) UI.game.audio.play('hover'); };
        d.onclick = function () {
          onPick(it, i);
          Array.prototype.forEach.call(host.children, function (c) { c.classList.remove('on'); });
          d.classList.add('on');
          UI.game.audio.play('click');
        };
        host.appendChild(d);
      });
    }

    //  Name and one short line. The old card carried a latin name, a
    //  description AND a perk paragraph - six species of that is a wall of
    //  text on the first screen anybody sees.
    chooser($('speciesList'), C.SPECIES, 0, function (s) { sel.species = s.key; }, function (s) {
      return '<div class="cn"><span class="swatch" style="background:' + rgbcss(s.accent) + '"></span>' +
        s.common + '</div><div class="perk">' + s.perk + '</div>';
    });

    var diffs = [
      { k: 'calm', n: 'Calm', d: 'You have the tank to yourself. No rival, no raids, nothing that can end the run except losing your queen.' },
      { k: 'scout', n: 'Gentle', d: 'The far nest sends the occasional small raid. Easy to hold off with a few soldiers.' },
      { k: 'worker', n: 'Lively', d: 'The rival colony grows alongside you and pushes now and then.' }
    ];
    chooser($('diffList'), diffs, 0, function (d) { sel.difficulty = d.k; }, function (d) {
      return '<div class="cn">' + d.n + '</div><div class="cd">' + d.d + '</div>';
    });

    var quals = [{ k: 'low', n: 'LOW' }, { k: 'medium', n: 'MED' }, { k: 'high', n: 'HIGH' }, { k: 'ultra', n: 'ULTRA' }];
    chooser($('qualityList'), quals, 2, function (q) { sel.quality = q.k; UI.applyQuality(q.k); },
      function (q) { return '<div class="cn">' + q.n + '</div>'; });

    $('btnStart').onclick = function () {
      try { UI.game.audio.init(); UI.game.audio.resume(); } catch (e) { console.warn('audio init failed', e); }
      onStart(sel);
    };
    $('btnHelp').onclick = function () { $('help').classList.remove('hidden'); };
    $('btnLoad').onclick = function () {
      if (!AF.Save.has()) { UI.notify('No save found', true); return; }
      AF.Save.load(UI.game);
    };
    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.onclick = function () { $(b.dataset.close).classList.add('hidden'); };
    });
    UI.buildHelp();
    window.addEventListener('keydown', function (e) {
      if (e.key === 'F1' || e.key === '?') { e.preventDefault(); $('help').classList.toggle('hidden'); }
    });
  };

  UI.applyQuality = function (q) {
    var g = UI.game;
    if (!g) return;
    g.quality = q;
    var R = AF.R, fx = g.fxSettings;
    if (q === 'low') { R.quality = 0.0; fx.ao = 0.0; fx.dof = 0.0; fx.rays = 0.0; fx.bloom = 0.30; g.dprCap = 1.0; }
    else if (q === 'medium') { R.quality = 0.3; fx.ao = 0.7; fx.dof = 0.0; fx.rays = 0.20; fx.bloom = 0.32; g.dprCap = 1.0; }
    else if (q === 'high') { R.quality = 0.65; fx.ao = 0.85; fx.dof = 0.75; fx.rays = 0.28; fx.bloom = 0.34; g.dprCap = 1.4; }
    else { R.quality = 1.0; fx.ao = 1.0; fx.dof = 0.9; fx.rays = 0.36; fx.bloom = 0.38; g.dprCap = 2.0; }
    g.forceResize = true;
    if (UI.qualBtns) UI.qualBtns.forEach(function (b) { b.classList.toggle('on', b.dataset.q === q); });
  };

  UI.buildHelp = function () {
    function krow(k, t) { return '<div class="krow"><span class="kk"><kbd>' + k + '</kbd></span><span>' + t + '</span></div>'; }
    $('helpBody').innerHTML =
      '<div class="help-sec"><h4>The idea</h4><ul>' +
      '<li>You have one glass tank and one queen. Everything else grows from there.</li>' +
      '<li><b>Workers</b> dig and haul. <b>Foragers</b> fetch food from the surface. <b>Soldiers</b> fight.</li>' +
      '<li>Digging costs <b>Dirt ▤</b> — and digging also <b>gives dirt back</b>, so you rarely run dry.</li>' +
      '<li>New ants cost <b>Food ◆</b>. Foragers keep it topped up on their own.</li>' +
      '<li>There is no way to lose except letting the queen die. Take your time.</li>' +
      '</ul></div>' +

      '<div class="help-sec"><h4>Doing things</h4><ul>' +
      '<li>Pick a room from the bottom row, then click inside the soil to dig it.</li>' +
      '<li>Click an ant button to raise one. Hold <b>Shift</b> for five.</li>' +
      '<li>Drag a box over ants to select them, then right-click to send them somewhere.</li>' +
      '<li>Nothing is on a timer. The colony ticks along whether you act or not.</li>' +
      '</ul></div>' +

      '<div class="help-sec"><h4>Camera</h4>' +
      krow('Wheel', 'Zoom toward the cursor') +
      krow('Right-drag', 'Orbit') +
      krow('Middle-drag', 'Pan (or hold Space)') +
      krow('W A S D', 'Move around') +
      krow('F', 'Frame what you have selected') +
      '</div>' +

      '<div class="help-sec"><h4>Keys</h4>' +
      krow('Space', 'Pause / resume') +
      krow('1 – 5', 'Pick a room to dig') +
      krow('Esc', 'Cancel, then settings') +
      krow('F1', 'This manual') +
      '</div>';
  };

  // ==================================================================
  //  HUD
  // ==================================================================
  UI.initHUD = function (game) {
    UI.game = game;
    UI.hist = { food: { last: 0, rate: 0 }, dirt: { last: 0, rate: 0 }, pop: { last: 0, rate: 0 } };
    UI.initTip();

    UI.attachTip($('sFood'), { title: 'Food', desc: 'Everything your ants eat. Foragers bring it in from the surface; new ants and daily upkeep spend it.' });
    UI.attachTip($('sDirt'), { title: 'Dirt', desc: 'Loose soil. Digging spends it — but excavating a room hands most of it straight back, so you can always keep digging.' });
    UI.attachTip($('sPop'), { title: 'Ants', desc: 'How many ants are alive. More ants means more work done and more food eaten.' });

    // ---- speed ----
    var sb = $('speedBtns');
    sb.innerHTML = '';
    UI.speedBtns = [];
    [['❚❚', 0, 'Pause'], ['▶', 1, 'Normal'], ['▶▶', 2, 'Fast'], ['▶▶▶', 4, 'Very fast']].forEach(function (s) {
      var b = el('button', '', s[0]);
      b.onclick = function () { if (s[1] === 0) game.setPaused(!game.paused); else game.setSpeed(s[1]); };
      UI.attachTip(b, { title: s[2], desc: 'The colony keeps running at every speed.', keys: s[1] === 0 ? 'Space' : '' });
      sb.appendChild(b);
      UI.speedBtns.push({ e: b, v: s[1] });
    });

    UI.buildToolbar(game);
    UI.buildSettings(game);
    UI.initObjectives(game);

    ['#bar', '#tray', '#selcard'].forEach(function (s) {
      var e = document.querySelector(s);
      if (!e) return;
      e.addEventListener('mouseenter', function () { game.input.uiHover = true; });
      e.addEventListener('mouseleave', function () { game.input.uiHover = false; });
      e.addEventListener('mousedown', function (ev) { UI.consumeClick = true; ev.stopPropagation(); });
    });

    //  The three stat chips carried Unicode too - a diamond for food, a
    //  shaded block for dirt, a six-pointed star for ants. Same drawn marks
    //  the tray uses, so the whole screen speaks one language.
    var chips = { sFood: 'pantry', sDirt: 'shovel', sPop: 'worker' };
    Object.keys(chips).forEach(function (id) {
      var host = $(id);
      var slot = host && host.querySelector('.ic');
      if (slot && AF.icon) slot.innerHTML = AF.icon(chips[id]);
    });

    $('hud').classList.remove('hidden');
  };

  // ---- row 0: things you drop into the tank yourself ----
  // ==================================================================
  //  ONE TOOLBAR
  //  Three stacked rows of dark glass buttons was too much furniture for a
  //  game this simple. Everything the player can do now lives in a single
  //  paper strip: feed, dig, raise - grouped, icon-first, with the
  //  explanation in the tooltip rather than on screen.
  // ==================================================================
  UI.buildToolbar = function (game) {
    var bar = $('toolbar');
    bar.innerHTML = '';
    UI.buildCards = [];
    UI.castCards = [];
    UI.pourBtns = [];

    var tabs = el('div', 'tabs');
    bar.appendChild(tabs);
    var pages = el('div', 'tpages');
    bar.appendChild(pages);

    //  GROUPS ARE PAGES NOW.
    //
    //  The label passed here was thrown away, and all five groups were laid
    //  out end to end - eighteen identical buttons in one strip, where
    //  pouring sugar, carving soil, commissioning a room, releasing a
    //  predator and raising a caste all looked like the same kind of act.
    //  Each group is a page now, one shown at a time, picked from a
    //  segmented switch above the tray.
    UI.tgroups = [];
    function group(label) {
      var row = el('div', 'tgroup');
      row.dataset.group = label;
      pages.appendChild(row);
      UI.tgroups.push({ label: label, row: row });
      return row;
    }
    //  Icon + cost only. The name goes in the caption strip under the dock,
    //  which shows whatever you are pointing at - one line of text on screen
    //  instead of a label under all eleven buttons.
    function tool(row, cls, icon, name, cost, tip, onClick) {
      var b = el('button', 'tool ' + cls);
      //  Always label the button. Icon-only was compact and unreadable - you
      //  cannot tell a Pantry from a Waste Pit by silhouette.
      //  A drawn mark if one exists for this tool, otherwise the old
      //  character. icon may be a key into AF.icon (a drawn silhouette) or,
      //  for anything not yet drawn, a literal glyph.
      var mark = (AF.hasIcon && AF.hasIcon(icon)) ? AF.icon(icon)
        : '<i>' + icon + '</i>';
      b.innerHTML = mark + '<span>' + name + '</span>' +
        (cost ? '<em>' + cost + '</em>' : '') +
        '<b class="q hidden">0</b><u class="have"></u>';
      b.onclick = onClick;
      b.addEventListener('mouseenter', function () { UI.caption(name, cost); });
      b.addEventListener('mouseleave', function () { UI.caption(null); });
      UI.attachTip(b, tip);
      row.appendChild(b);
      return b;
    }

    // ---- feed ----
    var fr = group('Feed');
    Object.keys(AF.Game.POUR).forEach(function (k) {
      var d = AF.Game.POUR[k];
      var b = tool(fr, 'feed', k, d.name, '', {
        title: d.name, cost: 'free', desc: d.desc,
        keys: 'Click the soil to pour · Shift keeps pouring · Esc to stop'
      }, function () {
        game.pourType = (game.pourType === k) ? null : k;
        game.setBuild(-1);
        if (game.digMode) game.setDig(false);
        if (game.spawnType) game.setSpawn(null);
        UI.setPour(game.pourType);
        game.audio.play('click');
      });
      UI.pourBtns.push({ e: b, k: k });
    });

    // ---- dig ----
    var dr = group('Dig');
    //  The shovel. It carves the soil itself rather than commissioning a
    //  room, so it sits with the digging tools but is not a chamber.
    UI.digBtn = tool(dr, 'dig', 'shovel', 'Shovel', '▤' + AF.Game.DIG.cost, {
      title: 'Shovel', cost: '▤ ' + AF.Game.DIG.cost + ' dirt per scoop',
      desc: 'Dig the soil away yourself. Hold and drag to carve a trench.' +
        '<br><br>Break into a tunnel and the colony will stop what it is doing and fill it back in.',
      keys: 'Hold to dig · Esc to stop'
    }, function () {
      if (game.spawnType) game.setSpawn(null);
      game.setDig(!game.digMode);
      game.audio.play('click');
    });

    // ---- build ----
    var br = group('Build');
    W.BUILDABLE.forEach(function (type, i) {
      var ch = W.CHAMBERS[type];
      var cost = Math.round((AF.Game.COST.tunnel + ch.cost) * 0.5);
      var key = i + 1;
      var b = tool(br, 'dig', (AF.ICON_CHAMBER && AF.ICON_CHAMBER[type]) || 'tunnel',
        ch.name, '' + cost, {
        title: ch.name, cost: '▤ ' + cost + ' dirt', desc: ch.desc,
        keys: 'Press ' + key + ' · then click · Shift keeps digging'
      }, function () { game.setBuild(game.buildType === type ? -1 : type); });
      UI.buildCards.push({ e: b, type: type, cost: cost });
    });

    // ---- life ----
    //  Stocking the tank. These are not units the player commands - they are
    //  animals put in to watch the colony deal with, which is the whole point
    //  of an ant farm.
    var lr = group('Release');
    UI.spawnBtns = [];
    Object.keys(AF.Game.BESTIARY).forEach(function (k) {
      var cd = AF.Game.BESTIARY[k];
      var b = tool(lr, 'life', k, cd.name, '\u25a4' + cd.cost, {
        title: cd.name,
        cost: '\u25a4 ' + cd.cost + ' dirt',
        desc: cd.desc + '<br><br>Health ' + cd.hp + ' \u00b7 Bite ' + cd.dmg +
          ' \u00b7 Meat ' + cd.meat,
        keys: 'Click the soil to place \u00b7 Esc to stop'
      }, function () {
        game.setSpawn(k);
        game.audio.play('click');
      });
      UI.spawnBtns.push({ e: b, k: k });
    });

    // ---- raise ----
    var ar = group('Raise');
    A.PLAYABLE.forEach(function (caste) {
      var cs = A.CASTES[caste];
      var b = tool(ar, 'raise', cs.key.toLowerCase(), cs.name, '' + cs.food, function () {
        return {
          title: cs.name, cost: '◆ ' + cs.food + ' food',
          desc: cs.desc + '<br><br>Health ' + cs.hp + ' · Bite ' + cs.dmg,
          keys: 'Click for one · Shift for five · right-click cancels one'
        };
      }, function (e) { game.queueCaste(caste, e.shiftKey ? 5 : 1); });
      b.oncontextmenu = function (e) {
        e.preventDefault();
        var p = game.player;
        for (var k = p.queue.length - 1; k >= 0; k--) if (p.queue[k] === caste) { p.queue.splice(k, 1); break; }
        game.audio.play('deny');
      };
      UI.castCards.push({ e: b, caste: caste, q: b.querySelector('.q'), have: b.querySelector('.have') });
    });

    //  One tab per group. Build opens first: it is what a new colony needs
    //  and the group a player returns to most.
    UI.tgroups.forEach(function (g) {
      var t = el('button', 'tab');
      t.textContent = g.label;
      t.onclick = function () { UI.showGroup(g.label); game.audio.play('click'); };
      tabs.appendChild(t);
      g.tab = t;
    });
    UI.showGroup('Build');
  };

  //  Show one group, hide the rest. Nothing is destroyed, so a tool keeps
  //  its selected state and its queue badge while its group is off screen.
  UI.showGroup = function (label) {
    if (!UI.tgroups) return;
    UI.tgroups.forEach(function (g) {
      var on = g.label === label;
      g.row.classList.toggle('on', on);
      if (g.tab) g.tab.classList.toggle('on', on);
    });
  };

  UI.setPour = function (kind) {
    if (!UI.pourBtns) return;
    UI.pourBtns.forEach(function (p) { p.e.classList.toggle('on', p.k === kind); });
  };

  UI.setDig = function (on) {
    if (UI.digBtn) UI.digBtn.classList.toggle('on', !!on);
  };

  UI.setSpawn = function (k) {
    if (!UI.spawnBtns) return;
    UI.spawnBtns.forEach(function (p) { p.e.classList.toggle('on', p.k === k); });
  };

  //  One contextual line under the dock: the thing you are pointing at, or
  //  the current instruction. Never both, never a wall of hints.
  UI.caption = function (name, cost) {
    UI.capOverride = name ? (name + (cost ? '  <em>' + cost + '</em>' : '')) : null;
    UI.updateHint(UI.game);
  };


  UI.buildSettings = function (game) {
    var host = $('setBody');
    host.innerHTML = '';
    var r1 = el('div', 'sys-row', '<label>Graphics</label>');
    UI.qualBtns = [];
    ['low', 'medium', 'high', 'ultra'].forEach(function (q) {
      var b = el('button', 'mini-btn' + (q === game.quality ? ' on' : ''), q.toUpperCase());
      b.dataset.q = q;
      b.onclick = function () { UI.applyQuality(q); };
      r1.appendChild(b);
      UI.qualBtns.push(b);
    });
    host.appendChild(r1);

    var r2 = el('div', 'sys-row',
      '<label>Volume</label><input type="range" id="volM" min="0" max="100" value="80">');
    host.appendChild(r2);

    var r3 = el('div', 'sys-row', '<label>Camera</label>');
    var o = game.rig.opt;
    [['Invert X', 'invertX'], ['Invert Y', 'invertY'], ['Zoom to cursor', 'zoomToCursor']].forEach(function (t) {
      var b = el('button', 'mini-btn' + (o[t[1]] ? ' on' : ''), t[0]);
      b.onclick = function () { o[t[1]] = !o[t[1]]; b.classList.toggle('on', o[t[1]]); };
      r3.appendChild(b);
    });
    host.appendChild(r3);

    var r4 = el('div', 'sys-row', '<label>Game</label>');
    [['SAVE', function () { AF.Save.save(game); }],
    ['LOAD', function () { AF.Save.load(game); }],
    ['MANUAL', function () { $('help').classList.remove('hidden'); }],
    ['START OVER', function () { if (confirm('Start a new colony?')) location.reload(); }]]
      .forEach(function (t) {
        var b = el('button', 'mini-btn', t[0]);
        b.onclick = t[1];
        r4.appendChild(b);
      });
    host.appendChild(r4);

    var vm = $('volM');
    vm.oninput = function () { game.audio.setVolumes(vm.value / 100, 0.5, 0.8); };
    // hand the keyboard back to the game as soon as the slider is released
    vm.onchange = vm.onmouseup = function () { vm.blur(); };
  };

  //  kept for the key bindings in player.js: only settings has a panel now
  UI.togglePanel = function (name) {
    if (name === 'menu') {
      var s = $('settings');
      s.classList.toggle('hidden');
      UI.panel = s.classList.contains('hidden') ? null : 'menu';
    }
  };
  UI.setBuild = function (type) {
    if (!UI.buildCards) return;
    UI.buildCards.forEach(function (c) { c.e.classList.toggle('on', c.type === type); });
  };
  UI.setPhero = function () { };
  UI.layout = function () { };

  // ==================================================================
  //  GENTLE GOALS  (one at a time, in the top bar)
  // ==================================================================
  UI.initObjectives = function (game) {
    UI.objectives = [
      { t: 'Dig your first new room — pick one below, then click the soil', test: function (g) { return g.player.farms[0] && g.player.farms[0].nodes.length > (UI.startNodes || 0); } },
      { t: 'Raise your colony to 30 ants', test: function (g) { return g.player.population() >= 30; } },
      { t: 'Dig a Guard Post so soldiers hit harder', test: function (g) { return !!g.player.pickChamber(W.CH.BARRACKS); } },
      { t: 'Keep 8 soldiers on hand', test: function (g) { return g.player.castes(A.C.SOLDIER) >= 8; } },
      { t: 'Reach 60 ants', test: function (g) { return g.player.population() >= 60; } },
      { t: 'Reach 120 ants — a proper colony', test: function (g) { return g.player.population() >= 120; } }
    ];
    // remember how much nest they started with, so "dig a room" means a NEW one
    UI.startNodes = game.player.farms[0] ? game.player.farms[0].nodes.length : 0;
    UI.objIdx = 0;
  };
  UI.checkObjectives = function (game) {
    if (!UI.objectives) return;
    while (UI.objIdx < UI.objectives.length && UI.objectives[UI.objIdx].test(game)) {
      UI.notify('✓ ' + UI.objectives[UI.objIdx].t, false, 'good');
      game.audio.play('unlock');
      UI.objIdx++;
    }
    var g = $('goal');
    if (!g) return;
    var o = UI.objectives[UI.objIdx];
    g.firstChild.textContent = o ? o.t : 'Your colony is thriving. Enjoy it.';
  };
  UI.renderObjectives = function () { };

  // ==================================================================
  //  NOTIFICATIONS
  // ==================================================================
  UI.notify = function (msg, bad, cls) {
    var box = $('notifications');
    if (!box) return;
    var last = box.lastElementChild;
    if (last && last.dataset.msg === msg) return;
    var n = el('div', 'note' + (bad ? ' bad' : (cls ? ' ' + cls : '')), msg);
    n.dataset.msg = msg;
    box.appendChild(n);
    setTimeout(function () { n.classList.add('fade'); }, bad ? 4200 : 3000);
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, bad ? 5000 : 3800);
    while (box.children.length > 4) box.removeChild(box.firstChild);
  };
  UI.flashResource = function () {
    var e = $('sFood');
    if (!e) return;
    e.classList.add('flash');
    clearTimeout(e._t);
    e._t = setTimeout(function () { e.classList.remove('flash'); }, 200);
  };

  // ==================================================================
  //  PER-FRAME
  // ==================================================================
  var lastUI = 0, lastObj = 0;
  UI.update = function (game, now) {
    if (now - lastUI < 90) return;
    var dtS = (now - lastUI) / 1000;
    lastUI = now;
    var p = game.player;
    if (!p) return;

    // Food is every edible pooled into one number; Dirt is biomass.
    var food = p.sugar + p.protein + p.water;
    var pop = p.population();
    UI.setStat('sFood', food, dtS);
    UI.setStat('sDirt', p.biomass, dtS);
    UI.setStat('sPop', pop, dtS, true);

    $('dayNum').textContent = game.sim.day;
    if (UI.speedBtns) {
      UI.speedBtns.forEach(function (s) {
        s.e.classList.toggle('on', s.v === 0 ? game.paused : (!game.paused && game.sim.speed === s.v));
      });
    }
    $('pauseveil').classList.toggle('hidden', !game.paused);
    $('alert').classList.toggle('hidden', p.threat < 0.45);

    if (UI.buildCards) {
      UI.buildCards.forEach(function (c) { c.e.classList.toggle('poor', p.biomass < c.cost); });
    }
    if (UI.castCards) {
      UI.castCards.forEach(function (c) {
        var def = A.CASTES[c.caste];
        var q = 0;
        for (var i = 0; i < p.queue.length; i++) if (p.queue[i] === c.caste) q++;
        c.q.classList.toggle('hidden', q === 0);
        c.q.textContent = q;
        c.have.textContent = p.castes(c.caste);
        c.e.classList.toggle('poor', food < def.food);
      });
    }

    UI.updateSelection(game);
    UI.updateHint(game);
    if (now - lastObj > 1000) { lastObj = now; UI.checkObjectives(game); }

    var R = AF.R;
    $('stats').textContent =
      Math.round(game.fps || 0) + ' fps · ' + game.ants.length + ' ants';
  };

  UI.setStat = function (id, val, dtS, whole) {
    var e = $(id);
    if (!e) return;
    var key = id;
    if (!UI.hist[key]) UI.hist[key] = { last: val, rate: 0 };
    var h = UI.hist[key];
    e.querySelector('b').textContent = Math.floor(val);
    var d = (val - h.last) / Math.max(dtS, 0.001);
    h.rate = h.rate * 0.85 + d * 0.15;
    h.last = val;
    var re = e.querySelector('.rate');
    if (Math.abs(h.rate) > (whole ? 0.05 : 0.15)) {
      re.textContent = (h.rate > 0 ? '+' : '') + h.rate.toFixed(1);
      re.classList.toggle('neg', h.rate < 0);
    } else re.textContent = '';
  };

  UI.updateSelection = function (game) {
    var card = $('selcard');
    var sel = game.selection;
    if (!sel.length) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    var counts = {}, hp = 0, maxhp = 0;
    for (var i = 0; i < sel.length; i++) {
      var a = sel[i];
      counts[a.def.name] = (counts[a.def.name] || 0) + 1;
      hp += a.hp; maxhp += a.maxHp;
    }
    var frac = maxhp ? hp / maxhp : 0;
    var html = '<div class="selhead">' + (sel.length === 1 ? sel[0].def.name : sel.length + ' ants') + '</div>' +
      '<div class="hpbar' + (frac < 0.35 ? ' low' : '') + '"><i style="width:' + (frac * 100) + '%"></i></div>';
    for (var k in counts) html += '<div class="selrow"><span>' + k + '</span><b>' + counts[k] + '</b></div>';
    if (sel.length === 1) html += '<div class="selrow"><span>doing</span><b>' + A.STNAME[sel[0].state] + '</b></div>';
    card.innerHTML = html;
  };

  UI.updateHint = function (game) {
    var h = $('ctxhint');
    if (!h || !game) return;
    var s;
    if (UI.capOverride) {
      h.className = 'name';
      if (h.innerHTML !== UI.capOverride) h.innerHTML = UI.capOverride;
      return;
    }
    h.className = '';
    if (game.buildType >= 0) {
      var ok = game.buildGhost && game.buildGhost.valid;
      s = 'Click in the soil to dig a <b>' + W.CHAMBERS[game.buildType].name + '</b>' +
        (ok ? '' : ' <span class="bad">— ' + ((game.buildGhost && game.buildGhost.reason) || 'not there') + '</span>') +
        '  ·  <b>Esc</b> to stop';
    } else if (game.selection.length) {
      s = '<b>Right-click</b> to send them  ·  <b>F</b> to follow  ·  <b>Esc</b> to deselect';
    } else {
      s = '<b>Wheel</b> zoom  ·  <b>Right-drag</b> orbit  ·  <b>Middle-drag</b> pan  ·  <b>F1</b> help';
    }
    if (h.innerHTML !== s) h.innerHTML = s;
  };

  // ==================================================================
  //  END
  // ==================================================================
  UI.showEnd = function (result, game) {
    var t = $('endTitle');
    t.textContent = result.won ? 'A THRIVING COLONY' : 'THE QUEEN IS GONE';
    t.className = result.won ? 'win' : 'lose';
    $('endMsg').textContent = result.msg;
    var p = game.player;
    $('endStats').innerHTML =
      '<div>Days <b>' + result.day + '</b></div>' +
      '<div>Peak ants <b>' + (p.peakPop || p.population()) + '</b></div>' +
      '<div>Rooms dug <b>' + (p.farms[0] ? p.farms[0].nodes.length : 0) + '</b></div>' +
      '<div>Ants lost <b>' + p.losses + '</b></div>';
    $('endscreen').classList.remove('hidden');
  };

  UI.setBoot = function (pct, msg) {
    var f = $('bootFill');
    if (f) f.style.width = pct + '%';
    var m = $('bootMsg');
    if (m && msg) m.textContent = msg;
  };
  UI.hideBoot = function () { $('boot').classList.add('hidden'); };
  UI.showMenu = function () { $('menu').classList.remove('hidden'); };
  UI.hideMenu = function () { $('menu').classList.add('hidden'); };

  AF.UI = UI;
})(window.AF = window.AF || {});

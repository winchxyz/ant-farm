/* =============================================================
   FORMICARIUM :: DEEP COLONY
   player.js - picking, selection, orders, construction, hotkeys

   Mouse contract
     LEFT   click  select   |  drag  box-select   |  +Shift add
     RIGHT  click  order    |  drag  orbit camera
     MIDDLE drag   pan      |  Ctrl+Left / Space+Left also pans
     WHEEL  zoom toward the cursor
   ============================================================= */
(function (AF) {
  'use strict';

  var M = AF.M, v3 = M.v3;
  var W = AF.W, A = AF.A, R = AF.R;
  var Game = AF.Game;

  var _ro = new Float32Array(3), _rd = new Float32Array(3), _pp = new Float32Array(3);

  // ------------------------------------------------------------------
  //  PICKING
  // ------------------------------------------------------------------
  Game.pickRay = function (ndcX, ndcY) {
    this.cam.ray(ndcX, ndcY, _ro, _rd);
    return { o: _ro, d: _rd };
  };

  Game.pickAnt = function (ro, rd, onlyMine) {
    var best = null, bt = 1e9;
    // generous radius when zoomed out so tiny ants stay clickable
    var fudge = M.clamp(this.rig.dist / 26, 1.0, 3.0);
    for (var i = 0; i < this.ants.length; i++) {
      var a = this.ants[i];
      if (a.isDead()) continue;
      if (onlyMine && a.colony !== this.player) continue;
      var t = W.raySphere(ro, rd, a.pos, Math.max(0.34, a.def.scale * 0.7) * fudge);
      if (t > 0.1 && t < bt) { bt = t; best = a; }
    }
    return best ? { ant: best, t: bt } : null;
  };

  Game.pickItem = function (ro, rd) {
    var best = null, bt = 1e9;
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i];
      if (it.dead) continue;
      var t = W.raySphere(ro, rd, it.pos, 0.75);
      if (t > 0.1 && t < bt) { bt = t; best = it; }
    }
    return best ? { item: best, t: bt } : null;
  };

  Game.pickNode = function (ro, rd) {
    var best = null, bt = 1e9;
    for (var f = 0; f < this.world.farms.length; f++) {
      var hit = this.world.farms[f].pickNode(ro, rd, bt);
      if (hit && hit.t < bt) { bt = hit.t; best = hit.node; }
    }
    return best ? { node: best, t: bt } : null;
  };

  Game.pickFarm = function (ro, rd) {
    var best = null, bt = 1e9;
    for (var f = 0; f < this.world.farms.length; f++) {
      var farm = this.world.farms[f];
      var hit = M.rayBox(ro, rd, farm.sdfMin, farm.sdfMax);
      if (hit && hit[1] > 0) {
        var t = Math.max(hit[0], 0);
        if (t < bt) { bt = t; best = farm; }
      }
    }
    return best;
  };

  // the vertical plane the nest is excavated against
  Game.digPlanePoint = function (farm, ro, rd, out) {
    var pz = farm.digZ;
    if (Math.abs(rd[2]) < 1e-4) return false;
    var t = (pz - ro[2]) / rd[2];
    if (t < 0.05) return false;
    out[0] = ro[0] + rd[0] * t;
    out[1] = ro[1] + rd[1] * t;
    out[2] = pz;
    return true;
  };

  // ------------------------------------------------------------------
  //  INPUT DISPATCH
  // ------------------------------------------------------------------
  Game.controlGroups = [];

  Game.handleInput = function (dt) {
    var inp = this.input;
    var i;
    if (this.state !== 'play') return;
    if (!this.controlGroups.length) for (i = 0; i < 10; i++) this.controlGroups.push([]);

    var num = -1;
    for (i = 0; i <= 9; i++) if (inp.hit('' + i)) num = i;

    // ---------- global ----------
    if (inp.hit(' ') && !inp.ctrl()) this.setPaused(!this.paused);
    if (inp.hit(']') || inp.hit('+') || inp.hit('=')) this.setSpeed(this.sim.speed * 2);
    if (inp.hit('[') || inp.hit('-')) this.setSpeed(this.sim.speed / 2);
    if (inp.hit('tab')) this.cycleFarm(inp.shift() ? -1 : 1);
    if (inp.hit('g')) { this.rig.setFarm(this.activeFarm || this.world.farms[0]); this.audio.play('click'); this.ui.notify('Whole tank'); }
    if (inp.hit('h')) this.goHome();
    if (inp.hit('f')) this.frameSelection();
    if (inp.hit('m')) { this.showPheromones = !this.showPheromones; this.ui.notify('Scent view ' + (this.showPheromones ? 'ON' : 'OFF')); }
    if (inp.hit('c')) { this.hideGlass = !this.hideGlass; this.ui.notify('Glass ' + (this.hideGlass ? 'hidden' : 'shown')); }
    if (inp.hit('b')) this.ui.togglePanel('build');
    if (inp.hit('n')) this.ui.togglePanel('brood');
    if (inp.hit('t')) this.ui.togglePanel('tech');
    if (inp.hit('p')) this.ui.togglePanel('phero');
    if (inp.hit('x') && this.selection.length) { this.rig.followAnt(this.selection[0]); this.ui.notify('Riding along - wheel out to leave'); }
    if (inp.hit('escape')) {
      if (this.spawnType) this.setSpawn(null);
      else if (this.digMode) this.setDig(false);
      else if (this.pourType) { this.pourType = null; this.ui.setPour(null); }
      else if (this.buildType >= 0) this.setBuild(-1);
      else if (this.pheroMode) { this.pheroMode = 0; this.ui.setPhero(0); }
      else if (this.selection.length) { this.selection = []; this.syncSelection(); }
      else this.ui.togglePanel('menu');
    }
    if (inp.hit('a') && inp.ctrl()) { this.selectAll(); }
    if (inp.hit('delete') || inp.hit('backspace')) this.cancelHoveredBuild();

    // caste selection F1..F7
    var fkeys = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'];
    for (i = 0; i < fkeys.length; i++) if (inp.hit(fkeys[i])) this.selectCaste(i, inp.shift());

    // numbers: build slots while the build panel is open, else control groups
    if (num >= 0) {
      if (num >= 1 && num <= W.BUILDABLE.length && !inp.ctrl()) {
        this.setBuild(this.buildSlot(num));
      } else if (inp.ctrl()) {
        this.assignGroup(num);
      } else {
        this.selectGroup(num, inp.shift());
      }
    }

    // ---------- hover ----------
    var ray = this.pickRay(inp.mouse.ndcX, inp.mouse.ndcY);
    var hn = this.pickNode(ray.o, ray.d);
    var ha = this.pickAnt(ray.o, ray.d, false);
    var hi = this.pickItem(ray.o, ray.d);
    var closest = 1e9, kind = null;
    if (ha && ha.t < closest) { closest = ha.t; kind = 'ant'; }
    if (hi && hi.t < closest) { closest = hi.t; kind = 'item'; }
    if (hn && hn.t < closest) { closest = hn.t; kind = 'node'; }
    this.hoverAnt = kind === 'ant' ? ha.ant : null;
    this.hoverItem = kind === 'item' ? hi.item : null;
    this.hoverNode = kind === 'node' ? hn.node : null;
    this.updateCursor(inp);

    // build ghost
    this.updateBuildGhost(ray, inp);

    //  Aim preview for pouring. This is what tells the player where the
    //  sugar or water is going to land BEFORE they commit - previously the
    //  only feedback was a changed mouse cursor, which told them nothing.
    //  the shovel
    this.updateDig(ray, inp, dt);
    //  the bestiary
    if (this.spawnType) this.updateSpawnGhost(ray);
    else if (this.spawnGhost) this.spawnGhost = null;

    if (this.pourType) {
      this.updatePourGhost(ray);
      //  hold to keep pouring: a stream you can aim, not a one-shot handful
      if (inp.mouse.down && this.pourGhost && !inp.uiHover) {
        var pf = this.player.farms[0] || this.activeFarm;
        this.pourStream(this.pourType, this.pourGhost.impact[0],
          this.pourGhost.impact[2], pf, dt);
      }
    } else if (this.pourGhost) this.pourGhost = null;

    // ---------- clicks ----------
    for (i = 0; i < inp.clicks.length; i++) {
      var c = inp.clicks[i];
      if (this.ui.consumeClick) { this.ui.consumeClick = false; continue; }
      if (c.button === 0) {
        if (inp.ctrl() || inp.alt()) continue;      // that drag was a pan / orbit
        this.onLeftClick(c, ray);
      } else if (c.button === 2) {
        if (c.moved > 7) continue;                  // that was an orbit
        this.onRightClick(c, ray);
      }
    }
    if (inp.dbl && this.hoverAnt) {
      if (this.hoverAnt.colony === this.player) {
        this.selectCaste(this.hoverAnt.caste, inp.shift());
      } else {
        this.rig.followAnt(this.hoverAnt);
      }
    }

    // pheromone painting while dragging
    if (this.pheroMode && inp.mouse.down && !inp.ctrl() && this.hoverNode) {
      this.paintPheromone(this.hoverNode, this.pheroMode - 1, dt);
    }
    // NOTE: input is *not* consumed here. The camera rig reads wheel/dx/dy
    // later in Game.update(), so the frame's input is retired by main.js
    // once every consumer has had a look at it.
  };

  Game.setPaused = function (v) {
    this.paused = v;
    this.ui.notify(v ? 'Paused' : 'Resumed');
    this.audio.play('click');
    document.body.classList.toggle('is-paused', v);
  };
  Game.setSpeed = function (s) {
    this.sim.speed = M.clamp(s, 0.25, 8);
    this.paused = false;
    document.body.classList.remove('is-paused');
    this.ui.notify('Speed ' + this.sim.speed + '×');
    this.audio.play('click');
  };
  Game.goHome = function () {
    var q = this.player.queenAnt;
    if (q && !q.isDead()) { this.activeFarm = q.farm; this.rig.frame(q.pos, 14); }
    else if (this.player.farms[0]) { this.activeFarm = this.player.farms[0]; this.rig.setFarm(this.activeFarm); }
    this.audio.play('click');
  };
  Game.frameSelection = function () {
    if (!this.selection.length) { this.goHome(); return; }
    var c = [0, 0, 0];
    for (var i = 0; i < this.selection.length; i++) {
      c[0] += this.selection[i].pos[0]; c[1] += this.selection[i].pos[1]; c[2] += this.selection[i].pos[2];
    }
    c[0] /= this.selection.length; c[1] /= this.selection.length; c[2] /= this.selection.length;
    this.rig.frame(c, Math.max(9, this.rig.dist * 0.55));
    this.audio.play('click');
  };

  Game.buildSlot = function (n) {
    // 1..5 map onto the rooms actually offered in the dig row
    var idx = (n === 0 ? 9 : n - 1);
    return idx < W.BUILDABLE.length ? W.BUILDABLE[idx] : -1;
  };

  Game.updateCursor = function (inp) {
    if (this.digMode) { document.body.className = this.digGhost && this.digGhost.afford ? 'cur-build' : 'cur-bad'; return; }
    if (this.spawnType) { document.body.className = this.spawnGhost && this.spawnGhost.afford ? 'cur-build' : 'cur-bad'; return; }
    if (this.pourType) { document.body.className = 'cur-pour'; return; }
    var cls = '';
    if (this.buildType >= 0) cls = this.buildGhost && this.buildGhost.valid ? 'cur-build' : 'cur-bad';
    else if (this.pheroMode) cls = 'cur-paint';
    else if (this.hoverAnt) cls = this.hoverAnt.colony === this.player ? 'cur-select' : 'cur-attack';
    else if (this.hoverItem || this.hoverNode) cls = 'cur-select';
    if (this._cur !== cls) {
      var b = document.body;
      b.classList.remove('cur-build', 'cur-bad', 'cur-paint', 'cur-select', 'cur-attack');
      if (cls) b.classList.add(cls);
      this._cur = cls;
    }
  };

  Game.updateBuildGhost = function (ray, inp) {
    if (this.buildType < 0) { this.buildGhost = null; return; }
    var farm = this.activeFarm;
    this.buildGhost = null;
    if (!farm) return;
    if (farm.owner !== this.player.id) {
      var mine = this.pickFarm(ray.o, ray.d);
      if (mine && mine.owner === this.player.id) farm = mine;
      else return;
    }
    //  Pit preview sits on the terrain under the cursor, not on the dig plane
    if (this.buildType === W.CH.PIT) {
      var sp = this.surfacePick(ray.o, ray.d, farm);
      if (!sp) return;
      var pdef = W.CHAMBERS[W.CH.PIT];
      var pcost = Math.round((Game.COST.tunnel + pdef.cost) * 0.5);
      var pok = this.player.biomass >= pcost;
      this.buildGhost = {
        farm: farm, from: null, surface: true,
        pos: [sp[0], sp[1] + pdef.radius * 0.34, sp[2]],
        valid: pok, reason: pok ? '' : 'not enough dirt'
      };
      return;
    }
    if (!this.digPlanePoint(farm, ray.o, ray.d, _pp)) return;
    var pid = this.player.id;
    var from = farm.nearestNode(_pp, function (n) { return n.build >= 1 && n.farm.owner === pid; });
    var def = W.CHAMBERS[this.buildType];
    var valid = !!from, reason = '';
    if (!from) reason = 'no built chamber to dig from';
    if (valid) {
      var d = v3.dist(from.pos, _pp);
      if (d < def.radius + from.radius * 0.5) { valid = false; reason = 'too close to ' + W.CHAMBERS[from.type].name; }
      else if (d > 14) { valid = false; reason = 'too far from the nest'; }
      else if (_pp[1] > farm.localTop(_pp[0], _pp[2]) - def.radius * 0.35) { valid = false; reason = 'that breaks the surface'; }
      else if (Math.abs(_pp[0] - farm.center[0]) > farm.half[0] - def.radius - 0.5) { valid = false; reason = 'outside the tank'; }
      else if (_pp[1] < farm.center[1] - farm.half[1] + def.radius + 0.5) { valid = false; reason = 'hits the tank floor'; }
      if (valid) {
        for (var i = 0; i < farm.nodes.length; i++) {
          if (v3.dist(farm.nodes[i].pos, _pp) < (farm.nodes[i].radius + def.radius) * 0.62) {
            valid = false; reason = 'overlaps an existing chamber'; break;
          }
        }
      }
      if (valid && this.player.biomass < (Game.COST.tunnel + def.cost) * 0.5) {
        valid = false; reason = 'not enough biomass';
      }
    }
    this.buildGhost = { pos: v3.clone(_pp), from: from, valid: valid, farm: farm, reason: reason };
  };

  Game.onLeftClick = function (c, ray) {
    var inp = this.input;
    if (this.digMode) return;   // the shovel is driven by hold, in handleInput
    if (this.spawnType) { this.placeCreature(); return; }
    //  Pouring: drop sugar or water onto the spot under the cursor.
    if (this.pourType) {
      //  The stream itself is driven by holding the button (handleInput).
      //  A click is just the start of it, so all this has to do is confirm
      //  the aim was valid and give a bit of feedback.
      if (this.pourGhost) {
        var pg = this.pourGhost.impact;
        this.fx.burst([pg[0], pg[1] + 0.3, pg[2]], 6, 'sparkle',
          Game.POUR[this.pourType].col);
      } else this.audio.play('deny');
      return;
    }
    //  The pit is dug on the surface, not into the nest slab, so it has its
    //  own placement path: no anchor tunnel, no excavation job.
    if (this.buildType === W.CH.PIT) {
      var pf = this.player.farms[0] || this.activeFarm;
      var ph = this.surfacePick(ray.o, ray.d, pf);
      if (ph) {
        if (this.digPit(pf, ph[0], ph[2]) && !inp.shift()) this.setBuild(-1);
      } else this.audio.play('deny');
      return;
    }
    if (this.buildType >= 0 && this.buildGhost) {
      if (this.buildGhost.valid) {
        var node = this.planTunnel(this.player, this.buildGhost.farm, this.buildGhost.from, this.buildGhost.pos, this.buildType, false);
        if (node) {
          this.audio.play('order');
          this.fx.burst(node.pos, 10, 'sparkle', [0.4, 1.0, 0.6]);
          this.ui.notify(W.CHAMBERS[this.buildType].name + ' marked for excavation');
          if (!inp.shift()) this.setBuild(-1);
        } else this.audio.play('deny');
      } else {
        this.audio.play('deny');
        if (this.buildGhost.reason) this.ui.notify('Cannot dig here - ' + this.buildGhost.reason, true);
      }
      return;
    }
    if (this.pheroMode && this.hoverNode) {
      this.paintPheromone(this.hoverNode, this.pheroMode - 1, 0.45);
      this.audio.play('click');
      return;
    }
    if (c.moved > 9) { this.boxSelect(c, inp.shift()); return; }

    var hit = this.pickAnt(ray.o, ray.d, false);
    if (hit && hit.ant.colony === this.player) {
      if (inp.shift()) {
        var idx = this.selection.indexOf(hit.ant);
        if (idx >= 0) this.selection.splice(idx, 1); else this.selection.push(hit.ant);
      } else this.selection = [hit.ant];
      this.selectedNode = null;
      this.audio.play('click');
    } else {
      var hn = this.pickNode(ray.o, ray.d);
      if (hn && (!hit || hn.t < hit.t)) {
        this.selectedNode = hn.node;
        if (!inp.shift()) this.selection = [];
        if (hn.node.farm) this.activeFarm = hn.node.farm;
        this.audio.play('click');
      } else if (hit) {
        this.selection = [];
        this.selectedNode = null;
        this.inspectEnemy = hit.ant;
        this.audio.play('click');
      } else {
        if (!inp.shift()) { this.selection = []; this.selectedNode = null; }
        var f = this.pickFarm(ray.o, ray.d);
        if (f) { this.activeFarm = f; if (this.rig.mode === 'shelf') this.rig.setFarm(f); }
      }
    }
    this.syncSelection();
  };

  Game.onRightClick = function (c, ray) {
    if (this.buildType >= 0) { this.setBuild(-1); return; }
    if (this.pheroMode) { this.pheroMode = 0; this.ui.setPhero(0); return; }
    var sel = this.selection, i;

    var enemy = this.pickAnt(ray.o, ray.d, false);
    if (enemy && enemy.ant.colony !== this.player) {
      for (i = 0; i < sel.length; i++) {
        sel[i].target = enemy.ant;
        sel[i].state = A.ST.FIGHT;
        sel[i].job = { kind: 'attack' };
      }
      if (sel.length) {
        this.audio.play('order');
        this.fx.burst(enemy.ant.pos, 10, 'ring', [1.0, 0.28, 0.2]);
        this.ui.notify(sel.length + ' ordered to attack');
      }
      return;
    }
    var item = this.pickItem(ray.o, ray.d);
    if (item && sel.length) {
      for (i = 0; i < sel.length; i++) {
        var a = sel[i];
        if (item.item.surface) a.goForage(item.item);
        else { a.job = { kind: 'haul', item: item.item }; a.state = A.ST.HAUL; }
      }
      this.fx.burst(item.item.pos, 8, 'ring', [1.0, 0.82, 0.3]);
      this.audio.play('order');
      return;
    }
    var hn = this.pickNode(ray.o, ray.d);
    if (hn) {
      if (!sel.length) {
        this.player.rally = hn.node;
        this.ui.notify('Rally point set at ' + W.CHAMBERS[hn.node.type].name);
        this.fx.burst(hn.node.pos, 12, 'ring', [1.0, 0.6, 0.15]);
        this.audio.play('order');
        return;
      }
      for (i = 0; i < sel.length; i++) {
        var ant = sel[i];
        ant.job = { kind: 'guard', node: hn.node };
        ant.mode = 'tunnel';
        ant.surfGoal = null;
        if (!ant.setPath(hn.node)) ant.state = A.ST.IDLE;
      }
      this.audio.play('order');
      this.fx.burst(hn.node.pos, 10, 'ring', [0.4, 0.9, 1.0]);
      return;
    }
    var farm = this.pickFarm(ray.o, ray.d);
    if (farm) {
      var sp = farm.pickSurface(ray.o, ray.d);
      if (sp && sel.length) {
        for (i = 0; i < sel.length; i++) {
          var s = sel[i];
          s.mode = 'surface';
          s.surfGoal = [sp.pos[0], sp.pos[2]];
          s.job = { kind: 'goto' };
          s.state = A.ST.MOVE;
          s.path = null; s.edge = null;
        }
        this.audio.play('order');
        this.fx.burst(sp.pos, 12, 'ring', [0.5, 1.0, 0.7]);
      }
    }
  };

  Game.cancelHoveredBuild = function () {
    var n = this.hoverNode;
    if (!n || n.build >= 1 || !n.farm || n.farm.owner !== this.player.id) return;
    var farm = n.farm;
    var def = W.CHAMBERS[n.type];
    this.player.biomass += (Game.COST.tunnel + def.cost) * 0.45;
    for (var i = farm.edges.length - 1; i >= 0; i--) {
      if (farm.edges[i].a === n || farm.edges[i].b === n) farm.removeEdge(farm.edges[i]);
    }
    var idx = farm.nodes.indexOf(n);
    if (idx >= 0) farm.nodes.splice(idx, 1);
    for (i = 0; i < farm.nodes.length; i++) farm.nodes[i].id = i;
    for (i = this.player.jobs.dig.length - 1; i >= 0; i--) {
      var j = this.player.jobs.dig[i];
      if (j.node === n || (j.edge && (j.edge.a === n || j.edge.b === n))) this.player.jobs.dig.splice(i, 1);
    }
    for (i = 0; i < this.player.ants.length; i++) {
      var an = this.player.ants[i];
      if (an.job && (an.job.node === n || (an.job.edge && (an.job.edge.a === n || an.job.edge.b === n)))) {
        an.job = null; an.state = A.ST.IDLE; an.path = null;
      }
    }
    farm.dirty = true;
    this.hoverNode = null;
    this.ui.notify('Excavation cancelled - biomass refunded');
    this.audio.play('deny');
  };

  Game.paintPheromone = function (node, type, dt) {
    var amt = dt * 6 * this.player.mods.pher;
    for (var i = 0; i < node.links.length; i++) {
      var e = node.links[i].edge;
      e.pher[type] = Math.min(4, e.pher[type] + amt);
    }
    node.pheromone[type] = Math.min(4, (node.pheromone[type] || 0) + amt);
    if (type === 1) {
      this.player.rally = node;
      for (i = 0; i < this.player.ants.length; i++) {
        var a = this.player.ants[i];
        if ((a.caste === A.C.SOLDIER || a.caste === A.C.MAJOR) && a.state !== A.ST.FIGHT) {
          a.job = { kind: 'guard', node: node };
          a.setPath(node);
        }
      }
    } else if (type === 3) {
      for (i = 0; i < this.player.ants.length; i++) {
        var w = this.player.ants[i];
        if (w.caste === A.C.WORKER && w.state === A.ST.IDLE) this.player.assignJob(w, this);
      }
    } else if (type === 0) {
      for (i = 0; i < this.player.ants.length; i++) {
        var f = this.player.ants[i];
        if (f.caste === A.C.FORAGER && f.state === A.ST.IDLE) this.player.assignJob(f, this);
      }
    }
  };

  // ------------------------------------------------------------------
  //  SELECTION
  // ------------------------------------------------------------------
  var _proj = new Float32Array(3);
  Game.boxSelect = function (c, add) {
    var r = this.canvas.getBoundingClientRect();
    var x0 = Math.min(c.x0, c.x) / r.width * 2 - 1;
    var x1 = Math.max(c.x0, c.x) / r.width * 2 - 1;
    var y0 = 1 - Math.max(c.y0, c.y) / r.height * 2;
    var y1 = 1 - Math.min(c.y0, c.y) / r.height * 2;
    if (!add) this.selection = [];
    for (var i = 0; i < this.ants.length; i++) {
      var a = this.ants[i];
      if (a.colony !== this.player || a.isDead()) continue;
      R.project(_proj, a.pos, this.cam.vp);
      if (_proj[2] <= 0) continue;
      if (_proj[0] >= x0 && _proj[0] <= x1 && _proj[1] >= y0 && _proj[1] <= y1) {
        if (this.selection.indexOf(a) < 0) this.selection.push(a);
      }
    }
    if (this.selection.length > 260) this.selection.length = 260;
    this.selectedNode = null;
    this.syncSelection();
    if (this.selection.length) {
      this.audio.play('click');
      this.ui.notify(this.selection.length + ' selected');
    }
  };

  Game.selectCaste = function (caste, add) {
    if (!add) this.selection = [];
    for (var i = 0; i < this.player.ants.length; i++) {
      var a = this.player.ants[i];
      if (a.caste === caste && !a.isDead() && this.selection.indexOf(a) < 0) this.selection.push(a);
    }
    if (this.selection.length > 260) this.selection.length = 260;
    this.selectedNode = null;
    this.syncSelection();
    this.audio.play('click');
    this.ui.notify(this.selection.length + ' × ' + A.CASTES[caste].name);
  };

  Game.selectAll = function () {
    this.selection = this.player.ants.slice(0, 260);
    this.selectedNode = null;
    this.syncSelection();
    this.audio.play('click');
    this.ui.notify('Whole colony selected (' + this.selection.length + ')');
  };

  Game.assignGroup = function (n) {
    this.controlGroups[n] = this.selection.slice();
    this.audio.play('order');
    this.ui.notify('Group ' + n + ' set (' + this.selection.length + ')');
  };
  Game.selectGroup = function (n, add) {
    var g = this.controlGroups[n];
    if (!g || !g.length) return;
    if (!add) this.selection = [];
    for (var i = 0; i < g.length; i++) {
      if (!g[i].isDead() && this.selection.indexOf(g[i]) < 0) this.selection.push(g[i]);
    }
    this.selectedNode = null;
    this.syncSelection();
    if (this.lastGroup === n && performance.now() - (this.lastGroupT || 0) < 420) this.frameSelection();
    this.lastGroup = n; this.lastGroupT = performance.now();
    this.audio.play('click');
  };

  Game.syncSelection = function () {
    for (var i = 0; i < this.ants.length; i++) this.ants[i].selected = false;
    for (i = this.selection.length - 1; i >= 0; i--) {
      if (this.selection[i].isDead()) this.selection.splice(i, 1);
      else this.selection[i].selected = true;
    }
    for (i = 0; i < this.controlGroups.length; i++) {
      var g = this.controlGroups[i];
      if (!g) continue;
      for (var k = g.length - 1; k >= 0; k--) if (g[k].isDead()) g.splice(k, 1);
    }
  };

  Game.setBuild = function (type) {
    if (type >= 0 && this.digMode) this.setDig(false);
    if (type >= 0 && this.spawnType) this.setSpawn(null);
    if (type < 0) {
      this.buildType = -1;
      this.buildGhost = null;
      this.ui.setBuild(-1);
      return;
    }
    if (type >= W.CHAMBERS.length) return;
    // picking a room puts the sugar jar down
    if (this.pourType) { this.pourType = null; this.ui.setPour(null); }
    this.buildType = type;
    this.pheroMode = 0;
    this.ui.setPhero(0);
    this.ui.setBuild(type);
    this.ui.notify('Click inside your vitrine to dig a ' + W.CHAMBERS[type].name);
    this.audio.play('click');
  };

  Game.cycleFarm = function (dir) {
    var farms = this.world.farms;
    var idx = farms.indexOf(this.activeFarm);
    var n = farms.length;
    var next = farms[((idx + (dir || 1)) % n + n) % n];
    this.activeFarm = next;
    this.rig.setFarm(next);
    this.audio.play('click');
    this.ui.notify(next.name + ' · ' + next.biome.name);
  };

  // ------------------------------------------------------------------
  //  PRODUCTION SHORTCUTS (used by the UI)
  // ------------------------------------------------------------------
  Game.queueCaste = function (caste, n) {
    var def = A.CASTES[caste];
    if (caste === A.C.MAJOR && !this.player.mods.majors) { this.audio.play('deny'); this.ui.notify('Requires the Major Caste doctrine', true); return; }
    if (caste === A.C.ALATE && !this.player.mods.alates) { this.audio.play('deny'); this.ui.notify('Requires the Nuptial Flight doctrine', true); return; }
    if (this.player.food() < def.food) { this.audio.play('deny'); this.ui.notify('Not enough food for a ' + def.name, true); return; }
    this.player.enqueue(caste, n || 1);
    this.audio.play('click');
  };

  Game.launchAlate = function (targetFarm) {
    var col = this.player;
    var alate = null;
    for (var i = 0; i < col.ants.length; i++) if (col.ants[i].caste === A.C.ALATE) { alate = col.ants[i]; break; }
    if (!alate) { this.ui.notify('No alate available - raise one in the BROOD panel', true); this.audio.play('deny'); return false; }
    if (targetFarm.owner >= 0) { this.ui.notify('That vitrine is already claimed', true); this.audio.play('deny'); return false; }
    var x = targetFarm.center[0] + col.rng.range(-6, 6);
    var z = targetFarm.digZ - 0.45;
    alate.state = A.ST.FLY;
    alate.mode = 'surface';
    alate.node = null; alate.edge = null; alate.path = null;
    alate.flyGoal = [x, targetFarm.localTop(x, z) + 0.4, z];
    alate.onLand = function (game) {
      var nest = W.seedNest(targetFarm, x, z, col.id);
      targetFarm.owner = col.id;
      col.farms.push(targetFarm);
      col.recomputeMods();
      alate.caste = A.C.QUEEN;
      alate.def = A.CASTES[A.C.QUEEN];
      alate.maxHp = alate.def.hp * col.mods.hp;
      alate.hp = alate.maxHp;
      alate.farm = targetFarm;
      alate.node = nest.throne;
      alate.mode = 'tunnel';
      v3.copy(alate.pos, nest.throne.pos);
      alate.pos[1] -= nest.throne.radius * 0.6;
      alate.wing = 0;
      for (var k = 0; k < 6; k++) {
        var p = v3.create(nest.deep.pos[0] + col.rng.range(-1, 1), nest.deep.pos[1] - 0.6, nest.deep.pos[2] + col.rng.range(-1, 1));
        var w = new A.Ant(col, k < 3 ? A.C.WORKER : A.C.FORAGER, targetFarm, p);
        w.node = nest.deep; w.homeNode = nest.entrance;
        col.ants.push(w); game.ants.push(w);
      }
      targetFarm.dirty = true;
      game.ui.notify('New colony founded in ' + targetFarm.name + '!');
      game.audio.play('unlock');
      game.fx.flashScreen(0.2, [0.6, 1.0, 0.7]);
    };
    this.ui.notify('Alate in flight to ' + targetFarm.name);
    this.audio.play('order');
    return true;
  };

})(window.AF = window.AF || {});

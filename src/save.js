/* =============================================================
   FORMICARIUM :: DEEP COLONY
   save.js - localStorage persistence
   ============================================================= */
(function (AF) {
  'use strict';

  var M = AF.M, v3 = M.v3, W = AF.W, A = AF.A, C = AF.C;
  var Save = {};
  var KEY = 'formicarium.deepcolony.v1';

  Save.save = function (game) {
    try {
      var d = { v: 1, t: Date.now(), opts: game.opts, sim: game.sim, farms: [], cols: [], ants: [], items: [], links: [] };
      var fi, i;
      for (fi = 0; fi < game.world.farms.length; fi++) {
        var f = game.world.farms[fi];
        var fo = { owner: f.owner, hyg: f.hygiene, nodes: [], edges: [] };
        for (i = 0; i < f.nodes.length; i++) {
          var n = f.nodes[i];
          fo.nodes.push([n.pos[0], n.pos[1], n.pos[2], n.radius, n.type, n.build, n.isPort ? 1 : 0]);
        }
        for (i = 0; i < f.edges.length; i++) {
          var e = f.edges[i];
          fo.edges.push([f.nodes.indexOf(e.a), f.nodes.indexOf(e.b), e.radius, e.build]);
        }
        d.farms.push(fo);
      }
      for (i = 0; i < game.world.links.length; i++) {
        var L = game.world.links[i];
        d.links.push([
          game.world.farms.indexOf(L.a), game.world.farms.indexOf(L.b),
          L.a.nodes.indexOf(L.pa), L.b.nodes.indexOf(L.pb), L.edge.build
        ]);
      }
      for (i = 0; i < game.colonies.length; i++) {
        var c = game.colonies[i];
        var co = {
          name: c.name, sp: c.speciesKey, pl: c.isPlayer, def: c.defeated,
          r: [c.sugar, c.protein, c.water, c.biomass, c.minerals, c.research],
          hyg: c.hygiene, waste: c.waste, morale: c.morale,
          doc: Object.keys(c.doctrines), queue: c.queue.slice(),
          kills: c.kills, losses: c.losses,
          farms: c.farms.map(function (f) { return game.world.farms.indexOf(f); }),
          brood: c.brood.map(function (b) {
            return [b.caste, b.t, b.need, game.world.farms.indexOf(b.node.farm), b.node.farm.nodes.indexOf(b.node), b.off[0], b.off[1]];
          }),
          brain: c.brain ? c.brain.d.name : null
        };
        d.cols.push(co);
      }
      for (i = 0; i < game.ants.length; i++) {
        var a = game.ants[i];
        if (a.isDead()) continue;
        d.ants.push([
          game.colonies.indexOf(a.colony), a.caste,
          a.pos[0], a.pos[1], a.pos[2], a.yaw, a.hp, a.age, a.hunger, a.infected,
          game.world.farms.indexOf(a.farm),
          a.node ? a.farm.nodes.indexOf(a.node) : -1,
          a.mode === 'surface' ? 1 : 0
        ]);
      }
      for (i = 0; i < game.items.length; i++) {
        var it = game.items[i];
        if (it.dead) continue;
        d.items.push([it.type, it.visual, it.pos[0], it.pos[1], it.pos[2], it.amount,
        game.world.farms.indexOf(it.farm), it.surface ? 1 : 0, it.rot, it.scale]);
      }
      localStorage.setItem(KEY, JSON.stringify(d));
      game.ui.notify('Colony saved (day ' + game.sim.day + ')');
      return true;
    } catch (err) {
      console.error(err);
      if (game.ui) game.ui.notify('Save failed: ' + err.message, true);
      return false;
    }
  };

  Save.has = function () { return !!localStorage.getItem(KEY); };

  Save.load = function (game) {
    var raw = localStorage.getItem(KEY);
    if (!raw) return false;
    var d;
    try { d = JSON.parse(raw); } catch (e) { return false; }
    try {
      game.newGame(d.opts);
      var world = game.world, i, k;
      // rebuild farms
      for (i = 0; i < world.farms.length; i++) {
        var f = world.farms[i];
        var fo = d.farms[i];
        f.nodes.length = 0; f.edges.length = 0;
        f.owner = fo.owner;
        f.hygiene = fo.hyg;
        for (k = 0; k < fo.nodes.length; k++) {
          var nd = fo.nodes[k];
          var n = f.addNode(nd[0], nd[1], nd[2], nd[3], nd[4]);
          n.build = nd[5];
          if (nd[6]) n.isPort = true;
        }
        for (k = 0; k < fo.edges.length; k++) {
          var ed = fo.edges[k];
          f.addEdge(f.nodes[ed[0]], f.nodes[ed[1]], ed[2], ed[3]);
        }
        f.dirty = true;
      }
      // links
      world.links.length = 0;
      for (i = 0; i < d.links.length; i++) {
        var Ld = d.links[i];
        var fa = world.farms[Ld[0]], fb = world.farms[Ld[1]];
        var pa = fa.nodes[Ld[2]], pb = fb.nodes[Ld[3]];
        if (!pa || !pb) continue;
        var link = { a: fa, b: fb, pa: pa, pb: pb, build: Ld[4], hp: 100, id: world.links.length };
        var e = {
          id: -1, farm: null, a: pa, b: pb, radius: 0.62, build: Ld[4],
          len: v3.dist(pa.pos, pb.pos), traffic: 0, link: link, pher: new Float32Array(5)
        };
        link.edge = e;
        pa.links.push({ node: pb, edge: e });
        pb.links.push({ node: pa, edge: e });
        world.links.push(link);
      }
      // colonies
      game.colonies.length = 0;
      game.ants.length = 0;
      game.brains.length = 0;
      for (i = 0; i < d.cols.length; i++) {
        var co = d.cols[i];
        var col = new C.Colony({ name: co.name, species: co.sp, isPlayer: co.pl });
        col.sugar = co.r[0]; col.protein = co.r[1]; col.water = co.r[2];
        col.biomass = co.r[3]; col.minerals = co.r[4]; col.research = co.r[5];
        col.hygiene = co.hyg; col.waste = co.waste; col.morale = co.morale;
        col.kills = co.kills; col.losses = co.losses;
        col.defeated = co.def;
        col.queue = co.queue.slice();
        for (k = 0; k < co.doc.length; k++) col.doctrines[co.doc[k]] = true;
        for (k = 0; k < co.farms.length; k++) col.farms.push(world.farms[co.farms[k]]);
        col.recomputeMods();
        for (k = 0; k < co.brood.length; k++) {
          var b = co.brood[k];
          var bf = world.farms[b[3]];
          col.brood.push({ caste: b[0], t: b[1], need: b[2], stage: 0, node: bf.nodes[b[4]], off: [b[5], b[6]], rot: 0 });
        }
        game.colonies.push(col);
        if (co.pl) game.player = col;
      }
      // brains
      for (i = 0; i < game.colonies.length; i++) {
        var c2 = game.colonies[i];
        if (c2.isPlayer) continue;
        var brain = new AF.AI.Brain(c2, d.opts.difficulty || 'worker');
        c2.brain = brain;
        game.brains.push(brain);
      }
      // ants
      for (i = 0; i < d.ants.length; i++) {
        var ad = d.ants[i];
        var owner = game.colonies[ad[0]];
        var farm = world.farms[ad[10]];
        if (!owner || !farm) continue;
        var ant = new A.Ant(owner, ad[1], farm, [ad[2], ad[3], ad[4]]);
        ant.yaw = ad[5]; ant.hp = ad[6]; ant.age = ad[7]; ant.hunger = ad[8]; ant.infected = ad[9];
        ant.node = ad[11] >= 0 ? farm.nodes[ad[11]] : null;
        ant.mode = ad[12] ? 'surface' : 'tunnel';
        owner.ants.push(ant);
        game.ants.push(ant);
        if (ant.caste === A.C.QUEEN) owner.queenAnt = ant;
      }
      // items
      game.items.length = 0;
      for (i = 0; i < d.items.length; i++) {
        var id = d.items[i];
        game.items.push({
          type: id[0], visual: id[1], pos: v3.create(id[2], id[3], id[4]),
          amount: id[5], farm: world.farms[id[6]], surface: !!id[7],
          dead: false, claimed: 0, rot: id[8], scale: id[9], bob: 0
        });
      }
      game.sim = d.sim;
      game.rebakeAll();
      game.selection = [];
      game.state = 'play';
      AF.UI.hideMenu();
      AF.UI.hideBoot();
      game.ui.notify('Colony restored - day ' + game.sim.day);
      return true;
    } catch (err) {
      console.error('load failed', err);
      if (game.ui) game.ui.notify('Save is corrupt or from an older build', true);
      return false;
    }
  };

  AF.Save = Save;
})(window.AF = window.AF || {});

/* =============================================================
   FORMICARIUM :: DEEP COLONY
   ai.js - rival colony strategic brain
   ============================================================= */
(function (AF) {
  'use strict';

  var M = AF.M, v3 = M.v3, W = AF.W, A = AF.A, C = AF.C;
  var AI = {};

  AI.DIFF = {
    //  `calm` never attacks at all - the far nest just quietly grows.
    //  popRatio caps the far nest against YOUR colony, so it stays a
    //  neighbour you can see through the glass instead of a snowball that
    //  quietly triples you while you are busy digging.
    calm: { name: 'Calm', econ: 0.80, aggro: 0, react: 4.5, research: 0.3, cheat: 0.9, peaceful: true, popRatio: 0.55, popFloor: 12 },
    scout: { name: 'Gentle', econ: 0.70, aggro: 0.18, react: 4.0, research: 0.4, cheat: 0.85, firstRaidDay: 6, popRatio: 0.75, popFloor: 14, raidSize: 4 },
    //  Lively is the busy tier, not the unfair one. It used to open on day 3
    //  with a twelve-soldier party against a colony that owned four, and grow
    //  to 105% of the player - which wiped a passive nest every single run.
    worker: { name: 'Lively', econ: 0.75, aggro: 0.32, react: 2.8, research: 0.7, cheat: 0.95, firstRaidDay: 5, popRatio: 0.90, popFloor: 16, raidSize: 7 }
  };

  function Brain(colony, diff) {
    this.col = colony;
    this.d = AI.DIFF[diff] || AI.DIFF.worker;
    this.timer = M.rng.range(0, 2);
    this.buildTimer = 3;
    this.warTimer = 25;
    this.rng = new M.RNG(0xB00 + colony.id * 7717);
    this.phase = 'grow';
    this.raidWave = 0;
  }
  AI.Brain = Brain;

  Brain.prototype.update = function (dt, game) {
    var col = this.col;
    if (col.defeated) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.d.react;

    this.economy(game);
    this.buildTimer -= this.d.react;
    if (this.buildTimer <= 0) {
      this.buildTimer = 9 / this.d.econ;
      this.construct(game);
    }
    this.researchStep(game);
    //  A cozy rival: never raids on `calm`, and holds off entirely for the
    //  first few days so a new player is never jumped while still learning
    //  which button digs a tunnel.
    if (!this.d.peaceful && this.d.aggro > 0 &&
      game.sim.day >= (this.d.firstRaidDay || 1)) {
      this.warTimer -= this.d.react;
      if (this.warTimer <= 0) {
        this.warTimer = 22 / this.d.aggro;
        this.warfare(game);
      }
    }
    this.defend(game);
  };

  // ---- production ---------------------------------------------------
  Brain.prototype.economy = function (game) {
    var col = this.col;
    var pop = col.population();
    var cap = col.popCap();
    if (pop >= cap - 2) return;
    if (col.queue.length > 6) return;
    // Stay in proportion to the player rather than snowballing past them.
    // This has to reach layEggs: the queen lays Workers by default whether or
    // not anything is queued, so capping the queue alone changes nothing.
    if (this.d.popRatio && game.player && !game.player.defeated) {
      col.popCeiling = Math.max(this.d.popFloor || 12,
        game.player.population() * this.d.popRatio);
      if (pop >= col.popCeiling) return;
    }

    var w = col.castes(A.C.WORKER), f = col.castes(A.C.FORAGER),
      s = col.castes(A.C.SOLDIER), n = col.castes(A.C.NURSE),
      u = col.castes(A.C.CLEANER), sc = col.castes(A.C.SCOUT);
    var foodRatio = col.food() / Math.max(1, col.storage());
    var wantSoldierRatio = 0.12 + this.d.aggro * 0.22 + col.threat * 0.35;
    if (this.phase === 'war') wantSoldierRatio += 0.25;

    var choice = A.C.WORKER;
    if (foodRatio < 0.25 && f < pop * 0.30) choice = A.C.FORAGER;
    else if (col.hygiene < 0.62 && u < pop * 0.10) choice = A.C.CLEANER;
    else if (n < pop * 0.12) choice = A.C.NURSE;
    else if (s < pop * wantSoldierRatio) choice = (col.mods.majors && this.rng.chance(0.18)) ? A.C.MAJOR : A.C.SOLDIER;
    else if (sc < 2 && this.rng.chance(0.3)) choice = A.C.SCOUT;
    else if (w < pop * 0.34) choice = A.C.WORKER;
    else choice = this.rng.chance(0.45) ? A.C.FORAGER : A.C.WORKER;

    if (col.food() > A.CASTES[choice].food * 1.4) col.enqueue(choice, 1);

    // AI resource handicap keeps rivals viable without micromanaging foraging
    var boost = (this.d.cheat - 1) * 0.4 + 0.10;
    if (boost > 0) {
      col.sugar = Math.min(col.storage(), col.sugar + boost * this.d.react * 2.2);
      col.protein = Math.min(col.storage(), col.protein + boost * this.d.react * 1.1);
      col.water = Math.min(col.storage(), col.water + boost * this.d.react * 1.4);
      col.minerals += boost * this.d.react * 0.20;
    }
  };

  // ---- expansion ----------------------------------------------------
  Brain.prototype.construct = function (game) {
    var col = this.col;
    if (!col.farms.length) return;
    var farm = col.farms[this.rng.int(col.farms.length)];
    if (col.jobs.dig.length > 4) return;

    var wants = [];
    if (!farm.findChamber(W.CH.NURSERY)) wants.push(W.CH.NURSERY);
    if (!farm.findChamber(W.CH.GRANARY)) wants.push(W.CH.GRANARY);
    if (col.hygiene < 0.8 && !farm.findChamber(W.CH.MIDDEN)) wants.push(W.CH.MIDDEN);
    if (col.population() > 26 && !farm.findChamber(W.CH.BARRACKS)) wants.push(W.CH.BARRACKS);
    if (col.population() > 30 && !farm.findChamber(W.CH.LAB)) wants.push(W.CH.LAB);
    if (farm.biome.humid > 0.6 && !farm.findChamber(W.CH.FUNGUS)) wants.push(W.CH.FUNGUS);
    if (!farm.findChamber(W.CH.CISTERN) && farm.biome.humid < 0.4) wants.push(W.CH.CISTERN);
    var type = wants.length ? wants[this.rng.int(wants.length)] : W.CH.TUNNEL;

    var anchor = farm.nodes[this.rng.int(farm.nodes.length)];
    var guard = 0;
    while (anchor && anchor.build < 1 && guard++ < 8) anchor = farm.nodes[this.rng.int(farm.nodes.length)];
    if (!anchor || anchor.build < 1) return;

    var ang = this.rng.range(0, M.TAU);
    var down = this.rng.range(-0.75, 0.25);
    var dist = this.rng.range(3.4, 6.2);
    var p = [
      anchor.pos[0] + Math.cos(ang) * dist,
      anchor.pos[1] + down * dist * 0.75,
      farm.slabZ(this.rng)
    ];
    game.planTunnel(col, farm, anchor, p, type, true);

    // build a bridge to a neighbour vitrine when strong
    if (col.population() > 40 && this.rng.chance(0.35 * this.d.aggro)) {
      for (var i = 0; i < game.world.farms.length; i++) {
        var other = game.world.farms[i];
        if (other === farm) continue;
        if (!W.canLink(farm, other)) continue;
        if (game.linkBetween(farm, other)) continue;
        game.startLink(col, farm, other);
        break;
      }
    }
  };

  Brain.prototype.researchStep = function (game) {
    var col = this.col;
    var order = ['tunnels', 'mandibles', 'chitin', 'crop', 'brood', 'sanitation',
      'trails', 'metabolism', 'majors', 'regen', 'engineers', 'legion', 'supercolony', 'chemwar'];
    for (var i = 0; i < order.length; i++) {
      if (!col.doctrines[order[i]] && col.canResearch(order[i])) {
        col.doResearch(order[i]);
        return;
      }
    }
    col.researchWork += this.d.research * this.d.react * 0.55;
  };

  // ---- war ----------------------------------------------------------
  Brain.prototype.warfare = function (game) {
    var col = this.col;
    var army = col.castes(A.C.SOLDIER) + col.castes(A.C.MAJOR) * 2.4;
    var needed = 8 + this.raidWave * 5;
    if (army < needed / this.d.aggro) { this.phase = 'grow'; col.stance = 'defend'; col.raidTarget = null; return; }

    // choose the juiciest reachable enemy chamber
    var best = null, bestScore = -1;
    for (var i = 0; i < game.colonies.length; i++) {
      var en = game.colonies[i];
      if (en === col || en.defeated) continue;
      for (var f = 0; f < en.farms.length; f++) {
        var farm = en.farms[f];
        var reach = game.reachable(col, farm);
        if (!reach) continue;
        var throne = farm.findChamber(W.CH.THRONE);
        var tgt = throne || farm.nodes[0];
        if (!tgt) continue;
        var defence = en.castes(A.C.SOLDIER) + en.castes(A.C.MAJOR) * 2.5 + 1;
        var score = (200 / defence) * (throne ? 2.2 : 1) * (en.isPlayer ? 1.0 + this.d.aggro * 0.5 : 0.8);
        score *= 1 / (1 + Math.abs(farm.gridX - col.farms[0].gridX) + Math.abs(farm.gridY - col.farms[0].gridY));
        if (score > bestScore) { bestScore = score; best = tgt; }
      }
    }
    if (best) {
      col.raidTarget = best;
      col.stance = 'raid';
      this.phase = 'war';
      this.raidWave++;
      this.raidClock = 0;
      this.raidStrength = col.castes(A.C.SOLDIER) + col.castes(A.C.MAJOR) * 2.0;
      game.onRaidLaunched(col, best);
      // wake up the army - but send a raiding party, not the entire nest,
      // so a raid is something you repel rather than something that ends you
      //  Size the party against what the defender can actually field. A fixed
      //  twelve-soldier raid is a massacre against a colony with four, and
      //  trivial against one with forty - scaling keeps a raid a fight you can
      //  win on every tier, which is the whole point of "pushes now and then".
      var pd = 4;
      if (game.player && !game.player.defeated) {
        pd = game.player.castes(A.C.SOLDIER) + game.player.castes(A.C.MAJOR) * 2;
      }
      var sent = 0;
      var limit = Math.max(3, Math.min(this.d.raidSize || 99, Math.round(pd * 1.0 + 2)));
      for (var k = 0; k < col.ants.length && sent < limit; k++) {
        var a = col.ants[k];
        if (a.caste === A.C.SOLDIER || a.caste === A.C.MAJOR) {
          a.job = { kind: 'attack', node: best };
          a.setPath(best);
          a.state = A.ST.MOVE;
          sent++;
        }
      }
    }
  };

  Brain.prototype.defend = function (game) {
    var col = this.col;
    var home = col.farms[0] && (col.farms[0].findChamber(W.CH.THRONE) || col.farms[0].nodes[0]);
    if (col.threat > 0.5 && col.stance === 'raid' && this.rng.chance(0.5)) {
      col.stance = 'defend';
      col.raidTarget = null;
      col.rally = home;
    }
    //  A raid is an event, not a siege. Once the party has been bled down, or
    //  it has been out long enough, the survivors go home. Without this the
    //  raiders simply camp in your nest and grind the colony to nothing.
    if (col.stance === 'raid') {
      this.raidClock = (this.raidClock || 0) + this.d.react;
      var army = col.castes(A.C.SOLDIER) + col.castes(A.C.MAJOR) * 2.0;
      if (army < (this.raidStrength || 1) * 0.45 || this.raidClock > 45) {
        col.stance = 'defend';
        col.raidTarget = null;
        col.rally = home;
        this.raidClock = 0;
        this.phase = 'grow';
        for (var i = 0; i < col.ants.length; i++) {
          var a = col.ants[i];
          if (a.job && a.job.kind === 'attack') { a.job = null; a.target = null; a.setPath(home); }
        }
      }
    } else this.raidClock = 0;
  };

  AF.AI = AI;
})(window.AF = window.AF || {});

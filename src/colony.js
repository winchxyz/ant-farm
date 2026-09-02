/* =============================================================
   FORMICARIUM :: DEEP COLONY
   colony.js - resources, brood, doctrines, job market
   ============================================================= */
(function (AF) {
  'use strict';

  var M = AF.M, v3 = M.v3, W = AF.W, A = AF.A;
  var C = {};

  // ------------------------------------------------------------------
  //  SPECIES
  // ------------------------------------------------------------------
  C.SPECIES = [
    {
      key: 'rufa', name: 'Formica rufa', common: 'Wood Ant',
      color: [0.42, 0.145, 0.055], accent: [0.95, 0.55, 0.20],
      desc: 'Sprays formic acid in melee. No weaknesses, no gimmicks.',
      perk: 'Acid Glands: every attack has a chance to burn for bonus damage.',
      mods: { acid: 1.0 }
    },
    {
      key: 'atta', name: 'Atta cephalotes', common: 'Leafcutter',
      color: [0.36, 0.24, 0.10], accent: [0.55, 0.95, 0.35],
      desc: 'Farms fungus instead of hunting. Enormous food ceiling.',
      perk: 'Fungiculture: fungus gardens yield +80% and leaves count double.',
      mods: { fungus: 1.8, foragerYield: 1.25, dmg: 0.9 }
    },
    {
      key: 'eciton', name: 'Eciton burchellii', common: 'Army Ant',
      color: [0.30, 0.12, 0.06], accent: [1.0, 0.30, 0.15],
      desc: 'Lives to raid. Terrible at holding ground, superb at taking it.',
      perk: 'Swarm Raid: +35% damage while in an enemy vitrine, -20% storage.',
      mods: { dmg: 1.2, raid: 1.35, storage: 0.8, speed: 1.1 }
    },
    {
      key: 'camponotus', name: 'Camponotus herculeanus', common: 'Carpenter',
      color: [0.16, 0.13, 0.12], accent: [0.85, 0.72, 0.45],
      desc: 'Huge, armoured, slow. Chews through wood and enemies alike.',
      perk: 'Heartwood Chitin: +45% health and +30% armour, -15% speed.',
      mods: { hp: 1.45, armour: 1.3, speed: 0.85, dig: 1.15 }
    },
    {
      key: 'solenopsis', name: 'Solenopsis invicta', common: 'Fire Ant',
      color: [0.55, 0.20, 0.06], accent: [1.0, 0.62, 0.10],
      desc: 'Breeds like a wildfire and stings like one.',
      perk: 'Venom & Fecundity: +50% egg rate, attacks poison over time.',
      mods: { eggRate: 1.5, venom: 1.0, hp: 0.85 }
    },
    {
      key: 'messor', name: 'Messor barbarus', common: 'Harvester',
      color: [0.22, 0.16, 0.13], accent: [0.95, 0.85, 0.45],
      desc: 'Hoards seeds against the lean season. Nothing starves a Messor nest.',
      perk: 'Granivore: +70% storage, food never spoils, +25% forage yield.',
      mods: { storage: 1.7, spoil: 0.0, foragerYield: 1.25, dmg: 0.95 }
    }
  ];

  // ------------------------------------------------------------------
  //  DOCTRINES (research tree)
  // ------------------------------------------------------------------
  C.DOCTRINES = [
    { key: 'mandibles', name: 'Sharpened Mandibles', cost: 30, tier: 1, apply: function (m) { m.dmg *= 1.30; }, desc: '+30% damage for every ant.' },
    { key: 'chitin', name: 'Dense Chitin', cost: 30, tier: 1, apply: function (m) { m.armour *= 1.35; }, desc: '+35% armour.' },
    { key: 'tunnels', name: 'Efficient Excavation', cost: 25, tier: 1, apply: function (m) { m.dig *= 1.55; }, desc: 'Dig 55% faster.' },
    { key: 'trails', name: 'Potent Pheromones', cost: 25, tier: 1, apply: function (m) { m.speed *= 1.18; m.pher *= 1.5; }, desc: '+18% move speed, stronger trails.' },
    { key: 'crop', name: 'Social Crop', cost: 40, tier: 2, apply: function (m) { m.carry *= 1.8; }, desc: 'Carry 80% more per trip.' },
    { key: 'brood', name: 'Brood Priority', cost: 40, tier: 2, apply: function (m) { m.nurse *= 1.6; m.eggRate *= 1.25; }, desc: 'Brood matures 60% faster.' },
    { key: 'sanitation', name: 'Metapleural Glands', cost: 35, tier: 2, apply: function (m) { m.clean *= 1.8; m.disease *= 0.55; }, desc: 'Disease resistance and faster cleaning.' },
    { key: 'metabolism', name: 'Lean Metabolism', cost: 45, tier: 2, apply: function (m) { m.upkeep *= 0.68; }, desc: 'Colony eats 32% less.' },
    { key: 'majors', name: 'Major Caste', cost: 70, tier: 3, apply: function (m) { m.majors = 1; }, desc: 'Unlocks the Major: a walking siege engine.' },
    { key: 'alates', name: 'Nuptial Flight', cost: 60, tier: 3, apply: function (m) { m.alates = 1; }, desc: 'Unlocks Alates: fly to an empty vitrine and found a colony there.' },
    { key: 'venomsac', name: 'Venom Sacs', cost: 65, tier: 3, apply: function (m) { m.venom += 1.0; }, desc: 'Attacks apply a lingering poison.' },
    { key: 'engineers', name: 'Structural Engineering', cost: 55, tier: 3, apply: function (m) { m.collapse = 0; m.gate *= 1.5; }, desc: 'Tunnels never collapse; gates are far stronger.' },
    { key: 'regen', name: 'Trophallaxis', cost: 60, tier: 3, apply: function (m) { m.regen *= 3.0; }, desc: 'Ants heal each other rapidly between fights.' },
    { key: 'supercolony', name: 'Supercolony', cost: 120, tier: 4, apply: function (m) { m.popCap += 260; m.storage *= 1.4; }, desc: '+260 population cap, +40% storage.' },
    { key: 'chemwar', name: 'Chemical Warfare', cost: 110, tier: 4, apply: function (m) { m.acid += 2.0; m.dmg *= 1.2; }, desc: 'Acid barrage. Everything burns.' },
    { key: 'legion', name: 'Legion Doctrine', cost: 130, tier: 4, apply: function (m) { m.attackRate *= 1.5; m.raid *= 1.25; }, desc: 'Soldiers attack 50% faster.' }
  ];

  // ------------------------------------------------------------------
  //  COLONY
  // ------------------------------------------------------------------
  var nextCol = 0;
  function Colony(opts) {
    this.id = nextCol++;
    this.name = opts.name;
    this.speciesKey = opts.species;
    this.species = null;
    for (var i = 0; i < C.SPECIES.length; i++) if (C.SPECIES[i].key === opts.species) this.species = C.SPECIES[i];
    this.isPlayer = !!opts.isPlayer;
    this.color = this.species.color.slice();
    this.accent = this.species.accent.slice();
    this.rng = new M.RNG(0xA17 + this.id * 104729);
    this.ants = [];
    this.farms = [];
    this.dead = false;
    this.defeated = false;

    this.sugar = 260; this.protein = 150; this.water = 200;
    this.biomass = 190; this.minerals = 10; this.research = 0;
    this.hygiene = 1.0; this.waste = 0; this.morale = 1.0;
    this.broodProgress = 0; this.fungusWork = 0; this.researchWork = 0;
    this.eggTimer = 0;
    this.brood = [];
    this.queue = [];       // caste production queue
    this.doctrines = {};
    this.jobs = { dig: [], haul: [], clean: [], guard: [], attack: [] };
    this.rally = null;
    this.stance = 'defend';   // defend | patrol | raid
    this.threat = 0;
    this.kills = 0; this.losses = 0;
    this.diseaseTimer = 0;
    this.notify = [];
    this.recomputeMods();
  }
  C.Colony = Colony;

  Colony.prototype.recomputeMods = function () {
    var m = {
      hp: 1, dmg: 1, speed: 1, dig: 1, carry: 1, armour: 1, regen: 1,
      nurse: 1, clean: 1, research: 1, attackRate: 1, acid: 0, venom: 0,
      upkeep: 1, eggRate: 1, storage: 1, fungus: 1, foragerYield: 1,
      raid: 1, disease: 1, pher: 1, collapse: 1, gate: 1,
      popCap: 90, majors: 0, alates: 0, spoil: 1
    };
    var sm = this.species.mods;
    for (var k in sm) {
      if (k === 'acid' || k === 'venom' || k === 'popCap') m[k] += sm[k];
      else m[k] = (m[k] === undefined ? sm[k] : m[k] * sm[k]);
    }
    for (var d in this.doctrines) {
      if (!this.doctrines[d]) continue;
      for (var i = 0; i < C.DOCTRINES.length; i++) {
        if (C.DOCTRINES[i].key === d) C.DOCTRINES[i].apply(m);
      }
    }
    m.popCap += this.farms.length * 55;
    this.mods = m;
  };

  Colony.prototype.food = function () { return this.sugar + this.protein; };
  Colony.prototype.storage = function () {
    var base = 240 * this.mods.storage;
    for (var i = 0; i < this.farms.length; i++) {
      var g = this.farms[i].allChambers(W.CH.GRANARY);
      base += g.length * 120 * this.mods.storage;
    }
    return base;
  };
  Colony.prototype.population = function () { return this.ants.length; };
  Colony.prototype.popCap = function () {
    var cap = this.mods.popCap;
    for (var i = 0; i < this.farms.length; i++) cap += this.farms[i].nodes.length * 3.5;
    return Math.floor(cap);
  };

  Colony.prototype.castes = function (c) {
    var n = 0;
    for (var i = 0; i < this.ants.length; i++) if (this.ants[i].caste === c && !this.ants[i].isDead()) n++;
    return n;
  };

  Colony.prototype.storeFor = function (type, farm) {
    var f = farm && farm.owner === this.id ? farm : (this.farms[0] || farm);
    if (!f) return null;
    if (type === 'water') return f.findChamber(W.CH.CISTERN) || f.findChamber(W.CH.GRANARY) || f.findChamber(W.CH.THRONE);
    if (type === 'corpse') return f.findChamber(W.CH.MIDDEN) || f.findChamber(W.CH.THRONE);
    if (type === 'leaf') return f.findChamber(W.CH.FUNGUS) || f.findChamber(W.CH.GRANARY);
    return f.findChamber(W.CH.GRANARY) || f.findChamber(W.CH.THRONE) || f.nodes[0];
  };

  Colony.prototype.deposit = function (type, amt, game) {
    var cap = this.storage();
    if (type === 'sugar') this.sugar = Math.min(cap, this.sugar + amt * this.mods.foragerYield);
    else if (type === 'protein') this.protein = Math.min(cap, this.protein + amt * this.mods.foragerYield);
    else if (type === 'water') this.water = Math.min(cap, this.water + amt);
    else if (type === 'mineral') this.minerals += amt * 0.6;
    else if (type === 'leaf') this.biomass += amt * 0.5, this.fungusStock = (this.fungusStock || 0) + amt * this.mods.fungus;
    else if (type === 'seed') this.sugar = Math.min(cap, this.sugar + amt * 1.2);
    else this.sugar = Math.min(cap, this.sugar + amt);
    if (game && this.isPlayer) game.ui.flashResource(type);
  };

  //  The end screen has always read peakPop, and nothing ever wrote it -
  //  so every run finished reporting "Peak ants 0", because the fallback
  //  is the population at the moment of death, which is nought by then.
  Colony.prototype.notePeak = function () {
    if (!this.peakPop || this.ants.length > this.peakPop) this.peakPop = this.ants.length;
    var rooms = 0;
    for (var i = 0; i < this.farms.length; i++) {
      if (this.farms[i] && this.farms[i].nodes) rooms += this.farms[i].nodes.length;
    }
    if (!this.peakRooms || rooms > this.peakRooms) this.peakRooms = rooms;
  };

  Colony.prototype.onDeath = function (ant, cause) {
    this.losses++;
    this.waste += 1;
    this.hygiene = Math.max(0, this.hygiene - 0.006);
    var i = this.ants.indexOf(ant);
    if (i >= 0) this.ants.splice(i, 1);
    if (ant.caste === A.C.QUEEN) {
      this.queenDead = true;
      this.notify.push({ t: 0, msg: 'THE QUEEN IS DEAD', bad: true });
    }
  };

  Colony.prototype.onBuilt = function (target, job, game) {
    if (target.type !== undefined && target.type !== W.CH.TUNNEL) {
      this.notify.push({ t: 0, msg: W.CHAMBERS[target.type].name + ' complete' });
      if (game) game.audio.play('build');
    }
    if (game) game.markDirty(job && job.farm ? job.farm : (target.farm || null));
  };

  // ------------------------------------------------------------------
  //  JOB MARKET
  // ------------------------------------------------------------------
  Colony.prototype.assignJob = function (ant, game) {
    var c = ant.caste;
    if (c === A.C.QUEEN) { ant.state = A.ST.IDLE; return; }
    if (c === A.C.ALATE) { ant.state = A.ST.IDLE; return; }

    // 1. emergency defence
    if (this.threat > 0.4 && (c === A.C.SOLDIER || c === A.C.MAJOR)) {
      var t = game.nearestThreat(this, ant);
      if (t) { ant.target = t; ant.state = A.ST.FIGHT; ant.job = { kind: 'attack' }; return; }
    }
    // 2. raid orders
    if (this.stance === 'raid' && this.raidTarget && (c === A.C.SOLDIER || c === A.C.MAJOR || (c === A.C.WORKER && this.rng.chance(0.15)))) {
      ant.job = { kind: 'attack', node: this.raidTarget };
      if (ant.setPath(this.raidTarget)) return;
    }
    // 3. rally
    if (this.rally && (c === A.C.SOLDIER || c === A.C.MAJOR) && this.rng.chance(0.8)) {
      ant.job = { kind: 'guard', node: this.rally };
      if (ant.setPath(this.rally)) return;
    }
    //  3.5 UNDERTAKING.
    //
    //  This used to live at step 9, below digging, hauling, foraging, nursing
    //  and fungus - all of which accept the CLEANER caste. So a cleaner took a
    //  dig job at step 4 and never reached the bodies, and sanitation only
    //  happened in a colony that had run out of everything else to do.
    //  Measured on nine corpses seeded on the nest floor: zero ants held a
    //  clean job at any point in twenty seconds, and the bodies aged out where
    //  they lay. Every wedge I chased inside doClean was downstream of this -
    //  the handler was fine, nobody was ever sent to it.
    //
    //  Necrophoresis is one of the promptest behaviours a real colony has: a
    //  body is a disease vector, and this game models that exactly - corpses
    //  push hygiene down and hygiene drives the disease roll. So a body
    //  outranks routine work for the caste whose job it is, and outranks it
    //  for a spare worker once the bodies are actually costing the colony
    //  something. Foragers and soldiers are never diverted.
    if (c === A.C.CLEANER || (c === A.C.WORKER &&
      (this.hygiene < 0.92 || (game.corpses && game.corpses.length >= 3)))) {
      var body = game.findCorpse(this, ant);
      if (body) {
        ant.job = { kind: 'clean', corpse: body };
        body.claimed = ant.id;
        ant.state = A.ST.CLEAN;
        return;
      }
    }
    // 4. digging
    if (this.jobs.dig.length && (c === A.C.WORKER || c === A.C.CLEANER || (c === A.C.NURSE && this.rng.chance(0.3)))) {
      var dj = this.pickDig(ant);
      if (dj) {
        ant.job = dj;
        var anchor = dj.edge ? dj.edge.a : nearestBuilt(dj.node);
        if (ant.setPath(anchor)) return;
        ant.state = A.ST.DIG; return;
      }
    }
    // 5. hauling loose items already inside the nest
    if (c === A.C.WORKER || c === A.C.FORAGER || c === A.C.CLEANER) {
      var item = game.findHaulItem(this, ant);
      if (item) {
        ant.job = { kind: 'haul', item: item };
        item.claimed = ant.id;
        ant.state = A.ST.HAUL;
        return;
      }
    }
    // 6. foraging on the surface
    var hungry = this.food() < this.storage() * 0.55;
    if (c === A.C.FORAGER || c === A.C.SCOUT ||
      (c === A.C.WORKER && hungry && this.rng.chance(0.55)) ||
      (c === A.C.CLEANER && hungry && this.rng.chance(0.2))) {
      var f = game.findForageTarget(this, ant);
      if (f) {
        f.claimed = ant.id;
        ant.goForage(f);
        return;
      }
    }
    // 7. nursing
    if (c === A.C.NURSE || (c === A.C.WORKER && this.rng.chance(0.35))) {
      var nur = this.pickChamber(W.CH.NURSERY) || this.pickChamber(W.CH.THRONE);
      if (nur) { ant.job = { kind: 'tend', node: nur }; if (ant.setPath(nur)) return; }
    }
    // 8. fungus tending
    if (this.mods.fungus > 1.0 || c === A.C.WORKER) {
      var fg = this.pickChamber(W.CH.FUNGUS);
      if (fg && this.rng.chance(0.4)) { ant.job = { kind: 'tend', node: fg }; if (ant.setPath(fg)) return; }
    }
    // 9. sanitation
    if (c === A.C.CLEANER || c === A.C.WORKER || (this.hygiene < 0.7 && this.rng.chance(0.4))) {
      //  bodies are handled at 3.5 now; this is the midden patrol that works
      //  off loose waste rather than corpses
      var corpse = game.findCorpse(this, ant);
      if (corpse) { ant.job = { kind: 'clean', corpse: corpse }; corpse.claimed = ant.id; ant.state = A.ST.CLEAN; return; }
      var mid = this.pickChamber(W.CH.MIDDEN);
      if (mid) { ant.job = { kind: 'clean' }; if (ant.setPath(mid)) return; }
    }
    // 10. research
    var lab = this.pickChamber(W.CH.LAB);
    if (lab && (c === A.C.NURSE || c === A.C.WORKER) && this.rng.chance(0.3)) {
      ant.job = { kind: 'research', node: lab };
      if (ant.setPath(lab)) return;
    }
    // 11. wander somewhere in the nest
    var farms = this.farms.length ? this.farms : [ant.farm];
    var farm = farms[this.rng.int(farms.length)];
    if (farm && farm.nodes.length) {
      var n = farm.nodes[this.rng.int(farm.nodes.length)];
      if (n.build >= 1) { ant.job = null; if (ant.setPath(n)) return; }
    }
    ant.state = A.ST.IDLE;
  };

  function nearestBuilt(node) {
    for (var i = 0; i < node.links.length; i++) if (node.links[i].node.build >= 1) return node.links[i].node;
    return node;
  }

  Colony.prototype.pickChamber = function (type) {
    var out = [];
    for (var i = 0; i < this.farms.length; i++) {
      var cs = this.farms[i].allChambers(type);
      for (var k = 0; k < cs.length; k++) out.push(cs[k]);
    }
    if (!out.length) return null;
    return out[this.rng.int(out.length)];
  };

  //  Tunnels before chambers: a chamber with no shaft to it is a sealed
  //  pocket, so an unfinished edge always outranks any node.
  Colony.prototype.pickDig = function (ant) {
    var list = this.jobs.dig;
    var best = null, bd = 1e9, bestIsEdge = false;
    for (var i = 0; i < list.length; i++) {
      var j = list[i];
      var tgt = j.edge || j.node;
      if (!tgt || tgt.build >= 1) { list.splice(i, 1); i--; continue; }
      var p = j.edge ? j.edge.a.pos : j.node.pos;
      var d = v3.dist2(ant.pos, p);
      var isEdge = !!j.edge;
      if (isEdge && !bestIsEdge) { bd = d; best = j; bestIsEdge = true; continue; }
      if (!isEdge && bestIsEdge) continue;
      if (d < bd) { bd = d; best = j; bestIsEdge = isEdge; }
    }
    return best;
  };

  Colony.prototype.queueDig = function (target, farm) {
    var j = { kind: target.links ? 'build' : 'dig', node: target.links ? target : null, edge: target.links ? null : target, farm: farm };
    this.jobs.dig.push(j);
    return j;
  };

  // ------------------------------------------------------------------
  //  PRODUCTION
  // ------------------------------------------------------------------
  Colony.prototype.canAfford = function (caste) {
    var d = A.CASTES[caste];
    return this.food() >= d.food;
  };
  Colony.prototype.enqueue = function (caste, n) {
    n = n || 1;
    for (var i = 0; i < n; i++) {
      if (this.queue.length > 40) break;
      this.queue.push(caste);
    }
  };

  //  What the queen lays when the player has queued nothing. A colony that
  //  is being raided raises its own defenders instead of politely producing
  //  workers until it is wiped out - you should never lose for not
  //  micromanaging a queue in a game this relaxed.
  Colony.prototype.defaultCaste = function () {
    var pop = this.population();
    var sol = this.castes(A.C.SOLDIER) + this.castes(A.C.MAJOR);
    var forg = this.castes(A.C.FORAGER);

    //  Food first, always. Putting the guard rule ahead of this starved the
    //  colony: soldiers kept dying at the border, so "soldiers < 3" never
    //  cleared, every single egg hatched as a soldier, no forager was ever
    //  born, and the nest starved to death beside a full larder.
    if (forg < pop * 0.20) return A.C.FORAGER;
    // a small standing guard, so a raid never lands on a colony with
    // nothing that can bite back
    if (pop > 13 && sol < 3) return A.C.SOLDIER;
    if (this.threat > 0.12 && sol < Math.max(5, pop * 0.22)) return A.C.SOLDIER;
    if (forg < pop * 0.28) return A.C.FORAGER;
    return A.C.WORKER;
  };

  //  How much longer brood takes to develop, and how much more often it is
  //  laid. One number, applied to both, so throughput is untouched.
  var BROOD_SPREAD = 3.0;

  Colony.prototype.layEggs = function (dt, game) {
    var queen = null;
    for (var i = 0; i < this.ants.length; i++) if (this.ants[i].caste === A.C.QUEEN) { queen = this.ants[i]; break; }
    if (!queen) return;
    var nurseryBoost = this.pickChamber(W.CH.NURSERY) ? 1.35 : 1.0;
    this.eggTimer += dt * this.mods.eggRate * nurseryBoost * (this.food() > 10 ? 1 : 0.15) * this.morale;
    //  A NURSERY HAS TO HAVE BROOD IN IT.
    //
    //  An egg used to hatch in about ten seconds and one was laid every six,
    //  so the standing brood population was 1.5 - measured over 3000 frames,
    //  never more than 2 at once. All three stages worked perfectly and
    //  nobody could ever see them, which is the "ants have no larvae"
    //  report: the chamber is empty almost all of the time.
    //
    //  Development and laying are slowed and quickened by the SAME factor,
    //  so ants per minute, food per egg and every balance number built on
    //  them are unchanged - what changes is how many are in the pile at any
    //  moment, which goes up by the same factor. A nursery now holds a
    //  handful of eggs, larvae and pupae at different stages, which is what
    //  it is for.
    var interval = (5.5 + Math.min(7, this.population() * 0.055)) / BROOD_SPREAD;
    while (this.eggTimer > interval) {
      this.eggTimer -= interval;
      if (this.population() + this.brood.length >= this.popCap()) break;
      // rival colonies carry a ceiling tied to the player's size
      if (this.popCeiling && this.population() + this.brood.length >= this.popCeiling) break;
      var caste = this.queue.length ? this.queue.shift() : this.defaultCaste();
      var def = A.CASTES[caste];
      if (this.food() < def.food) { this.queue.unshift(caste); break; }
      var cost = def.food;
      var sug = Math.min(this.sugar, cost * 0.6);
      this.sugar -= sug;
      this.protein -= Math.min(this.protein, cost - sug);
      if (this.protein < 0) this.protein = 0;
      var nur = this.pickChamber(W.CH.NURSERY) || this.pickChamber(W.CH.THRONE) || queen.node;
      this.brood.push({
        caste: caste, stage: 0, t: 0,
        need: def.larvaTime * BROOD_SPREAD, node: nur,
        off: [this.rng.range(-1, 1), this.rng.range(-1, 1)],
        rot: this.rng.range(0, M.TAU),
        //  YOU SHOULD SEE HER LAY IT. The egg used to wink into existence
        //  in the middle of the nursery pile with three sparkles fired at
        //  the queen, who might be in another chamber entirely - so the one
        //  moment the colony is actually reproducing was invisible. It is
        //  born AT her and carried to its place over the next second and a
        //  half, which is a thing you can watch happen.
        born: [queen.pos[0], queen.pos[1], queen.pos[2]], bornT: 0
      });
      //  and she takes a beat over it: the renderer reads layT for a crouch
      queen.layT = 1.0;
      if (game && this.isPlayer) {
        //  at the abdomen, not the head
        game.fx.burst([queen.pos[0] - Math.sin(queen.yaw) * 0.5, queen.pos[1] + 0.1,
          queen.pos[2] - Math.cos(queen.yaw) * 0.5], 10, 'sparkle', [1, 0.93, 0.72]);
      }
    }
  };

  Colony.prototype.updateBrood = function (dt, game) {
    // workers double as nurses now that the caste is not offered
    var nurses = this.castes(A.C.NURSE) + this.castes(A.C.WORKER) * 0.6;
    var care = 0.55 + Math.min(1.2, nurses / Math.max(4, this.brood.length) * 1.3);
    care *= this.mods.nurse;
    if (this.hygiene < 0.4) care *= 0.55;
    for (var i = this.brood.length - 1; i >= 0; i--) {
      var b = this.brood[i];
      b.t += dt * care;
      if (b.bornT < 1) b.bornT = Math.min(1, b.bornT + dt / 1.5);
      b.stage = b.t < b.need * 0.32 ? 0 : (b.t < b.need * 0.75 ? 1 : 2);
      if (this.hygiene < 0.25 && this.rng.chance(dt * 0.05)) {
        this.brood.splice(i, 1);
        this.notify.push({ t: 0, msg: 'Brood lost to mould', bad: true });
        continue;
      }
      if (b.t >= b.need) {
        this.brood.splice(i, 1);
        this.hatch(b, game);
      }
    }
  };

  Colony.prototype.hatch = function (b, game) {
    var node = b.node && b.node.build >= 1 ? b.node : (this.farms[0] ? this.farms[0].nodes[0] : null);
    if (!node) return;
    var farm = node.farm;
    var p = v3.create(node.pos[0] + this.rng.range(-0.6, 0.6), node.pos[1] - node.radius * 0.90, node.pos[2] + this.rng.range(-0.6, 0.6));
    var ant = new A.Ant(this, b.caste, farm, p);
    ant.node = node;
    ant.homeNode = node;
    this.ants.push(ant);
    if (game) {
      game.ants.push(ant);
      game.fx.burst(p, 6, 'sparkle', this.accent);
      if (this.isPlayer) game.audio.play('hatch');
    }
  };

  // ------------------------------------------------------------------
  //  TICK
  // ------------------------------------------------------------------
  Colony.prototype.update = function (dt, game) {
    this.notePeak();
    var i;
    // upkeep
    var upkeep = 0;
    for (i = 0; i < this.ants.length; i++) upkeep += this.ants[i].def.upkeep;
    upkeep *= this.mods.upkeep * dt;
    var sugarPart = Math.min(this.sugar, upkeep * 0.65);
    this.sugar -= sugarPart;
    var rest = upkeep - sugarPart;
    var protPart = Math.min(this.protein, rest);
    this.protein -= protPart;
    var deficit = rest - protPart;

    // water
    this.water -= dt * this.ants.length * 0.0020 * (this.farms[0] ? (1.6 - this.farms[0].biome.humid) : 1);
    // water is folded into the single Food readout, so a shortfall must
    // never quietly kill ants the player cannot see going thirsty
    if (this.water < 0) this.water = 0;

    // fungus gardens produce food
    var fungus = 0;
    for (i = 0; i < this.farms.length; i++) fungus += this.farms[i].allChambers(W.CH.FUNGUS).length;
    if (fungus > 0) {
      var yieldRate = fungus * 1.35 * this.mods.fungus * Math.min(1, this.fungusWork * 0.5 + 0.25) * (this.farms[0] ? this.farms[0].biome.humid + 0.4 : 1);
      this.sugar = Math.min(this.storage(), this.sugar + yieldRate * dt);
    }
    this.fungusWork = Math.max(0, this.fungusWork - dt);

    // Claustral founding: a lone queen metabolises her flight muscles, so a
    // wiped-out colony can crawl back instead of sitting in a dead end.
    if (this.ants.length <= 3 && !this.queenDead) {
      this.sugar += dt * 1.6;
      this.water = Math.min(this.storage(), this.water + dt * 0.5);
      deficit = 0;
    }

    // starvation
    if (deficit > 0.0001) {
      this.morale = Math.max(0.25, this.morale - dt * 0.12);
      if (this.rng.chance(dt * deficit * 1.1) && this.ants.length > 1) {
        var victim = this.ants[this.rng.int(this.ants.length)];
        if (victim.caste !== A.C.QUEEN) victim.hit(9, null, game);
      }
      if (this.isPlayer && game.frame % 180 === 0) this.notify.push({ t: 0, msg: 'The colony is starving', bad: true });
    } else {
      this.morale = Math.min(1, this.morale + dt * 0.10);
    }

    // hygiene
    var middens = 0;
    for (i = 0; i < this.farms.length; i++) middens += this.farms[i].allChambers(W.CH.MIDDEN).length;
    var decay = (0.0009 + this.ants.length * 0.000018 + Math.min(this.waste, 60) * 0.00006) / (1 + middens * 1.6);
    decay *= (this.farms[0] ? this.farms[0].biome.mods.disease : 1) / this.mods.clean;
    var cleaners = this.castes(A.C.CLEANER) + this.castes(A.C.WORKER) * 0.55;
    this.hygiene = M.clamp(this.hygiene - decay * dt + dt * 0.0060 * cleaners * this.mods.clean, 0, 1);
    for (i = 0; i < this.farms.length; i++) {
      this.farms[i].hygiene = this.hygiene;
      this.farms[i].mold = M.clamp((0.55 - this.hygiene) * 2.0, 0, 1);
    }

    // disease outbreak
    this.diseaseTimer -= dt;
    if (this.hygiene < 0.55 && this.diseaseTimer <= 0) {
      this.diseaseTimer = 6 + this.rng.range(0, 6);
      var chance = (0.55 - this.hygiene) * 1.4 * this.mods.disease;
      if (this.rng.chance(chance) && this.ants.length) {
        var vict = this.ants[this.rng.int(this.ants.length)];
        if (!vict.infected && vict.caste !== A.C.QUEEN) {
          vict.infected = 0.01;
          if (this.isPlayer) this.notify.push({ t: 0, msg: 'Ophiocordyceps outbreak detected', bad: true });
        }
      }
    }
    // contagion
    if (game.frame % 30 === 0) {
      for (i = 0; i < this.ants.length; i++) {
        var a = this.ants[i];
        if (!a.infected) continue;
        for (var k = 0; k < this.ants.length; k += 7) {
          var b = this.ants[k];
          if (b.infected || b.caste === A.C.QUEEN) continue;
          if (v3.dist2(a.pos, b.pos) < 2.2 && this.rng.chance(0.022 * this.mods.disease)) b.infected = 0.01;
        }
      }
    }

    // spoilage
    if (this.mods.spoil > 0) {
      var spoilRate = 0.0016 * this.mods.spoil * (this.farms[0] ? (this.farms[0].biome.mods.spoil === undefined ? 1 : this.farms[0].biome.mods.spoil) : 1);
      this.sugar = Math.max(0, this.sugar - this.sugar * spoilRate * dt);
      this.protein = Math.max(0, this.protein - this.protein * spoilRate * 1.6 * dt);
    }

    // research
    if (this.researchWork > 0) {
      var labs = 0;
      for (i = 0; i < this.farms.length; i++) labs += this.farms[i].allChambers(W.CH.LAB).length;
      var gain = Math.min(this.researchWork, dt * 4) * (0.35 + labs * 0.55);
      var use = Math.min(this.minerals, gain * 0.25);
      this.minerals -= use;
      this.research += gain * (0.5 + use * 2.0);
      this.researchWork = Math.max(0, this.researchWork - dt * 4);
    }
    // passive mineral trickle from ash biome
    for (i = 0; i < this.farms.length; i++) {
      var mm = this.farms[i].biome.mods.mineral;
      if (mm) this.minerals += dt * 0.09 * mm;
    }

    this.layEggs(dt, game);
    this.updateBrood(dt, game);

    // threat decay
    this.threat = Math.max(0, this.threat - dt * 0.25);
    this.waste = Math.max(0, this.waste - dt * 0.09);

    // notifications age
    for (i = this.notify.length - 1; i >= 0; i--) {
      this.notify[i].t += dt;
      if (this.notify[i].t > 7) this.notify.splice(i, 1);
    }

    // defeat check
    if (!this.defeated && this.queenDead && this.ants.length === 0) {
      this.defeated = true;
      game.onColonyDefeated(this);
    }
  };

  Colony.prototype.canResearch = function (key) {
    for (var i = 0; i < C.DOCTRINES.length; i++) {
      if (C.DOCTRINES[i].key === key) return !this.doctrines[key] && this.research >= C.DOCTRINES[i].cost;
    }
    return false;
  };
  Colony.prototype.doResearch = function (key) {
    for (var i = 0; i < C.DOCTRINES.length; i++) {
      var d = C.DOCTRINES[i];
      if (d.key === key && !this.doctrines[key] && this.research >= d.cost) {
        this.research -= d.cost;
        this.doctrines[key] = true;
        this.recomputeMods();
        for (var k = 0; k < this.ants.length; k++) {
          var a = this.ants[k];
          a.maxHp = a.def.hp * this.mods.hp;
          a.hp = Math.min(a.maxHp, a.hp * 1.1);
          a.speed = a.def.speed * this.mods.speed;
          a.dmg = a.def.dmg * this.mods.dmg;
        }
        this.notify.push({ t: 0, msg: 'Doctrine adopted: ' + d.name });
        return true;
      }
    }
    return false;
  };

  AF.C = C;
})(window.AF = window.AF || {});

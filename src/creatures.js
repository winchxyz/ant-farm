/* =============================================================
   FORMICARIUM :: DEEP COLONY
   creatures.js - the bestiary, and what the colony does with it.

   The tank used to hold exactly one animal: a wolf spider that wandered
   in on a timer, bit ants, and vanished when it died. Nothing was left
   behind and the player had no say in any of it.

   This generalises that into a bestiary the player can stock themselves,
   and closes the loop the animal was missing. A creature that dies leaves
   a CARCASS, and a carcass is just a very large piece of protein lying on
   the sand. That matters because the foraging code already knows what to
   do with protein: workers walk to it, take a piece, and carry it home.
   So "the ants butcher it and haul it into the nest" needs no new job
   system at all - it falls out of the economy that was already there, and
   the carcass visibly shrinks as they strip it.

   Behaviour is one number, `temper`:
     -1  prey     - runs from ants
      0  neutral  - ignores ants, but eats your sugar
     +1  predator - hunts ants
   ============================================================= */
(function (AF) {
  'use strict';

  var M = AF.M, v3 = M.v3;
  var Game = AF.Game;

  //  hp / dmg / speed are tuned against the ant castes in ants.js:
  //  a worker has 26hp and 3dmg, a soldier 78hp and 15dmg.
  //  DEATH POSES.
  //
  //  A carcass used to be laid down upright on its legs with walk = 1, so a
  //  dead spider stood in a normal alert stance and a dead woodlouse lay flat
  //  with its feet planted and antennae forward - both indistinguishable from
  //  a live animal holding still. How an insect ends up is species-specific
  //  and very recognisable, so each one records its own:
  //
  //    roll  - how far it goes over. A beetle on its back is the single most
  //            readable dead-insect silhouette there is; a spider's legs curl
  //            under it as hydraulic pressure drops and it ends up inverted;
  //            crickets and centipedes topple onto one side.
  //    hy    - how high the body sits above the mesh origin, measured off the
  //            builders (spider segments 0.40-0.48, cricket 0.23, woodlouse
  //            0.17, beetle 0.14, centipede 0.11). Rolling happens about the
  //            origin, which is on the ground, so an animal tipped onto its
  //            back swings its body straight down through the terrain - the
  //            first attempt left a spider buried with only its legs standing
  //            out of the sand like posts. Lifting by hy*(1-cos roll) puts the
  //            body back where it was and lands it ON the ground.
  //    curl  - woodlice conglobate, and a dead one stays balled up. The curl
  //            the living animal uses is only a scale squash (there is no
  //            shader-side bend), so this reuses that same knob.
  //
  var BESTIARY = {
    woodlouse: {
      key: 'woodlouse',
      name: 'Woodlouse', icon: '◐', mesh: 'woodlouse',
      death: { roll: Math.PI * 0.55, pitch: 0.10, curl: 1.0, hy: 0.17 },
      hp: 40, dmg: 0, speed: 0.85, armour: 2.2, temper: -1,
      scale: 0.95, meat: 120, cost: 4, life: 300,
      col: [0.40, 0.37, 0.42],
      desc: 'Harmless and slow, and armoured enough to take a while to open. ' +
        'The safest way to feed a young colony a lot of protein at once.'
    },
    cricket: {
      key: 'cricket',
      name: 'Cricket', icon: '⤴', mesh: 'cricket',
      death: { roll: Math.PI * 0.46, pitch: 0.14, curl: 0, hy: 0.23 },
      hp: 34, dmg: 1, speed: 4.6, armour: 1.0, temper: -1, skittish: 1,
      scale: 0.95, meat: 150, cost: 6, life: 260,
      col: [0.30, 0.26, 0.16],
      desc: 'Bolts the moment it is touched and can outrun a worker. ' +
        'It takes a crowd to corner one, and it is worth the trouble.'
    },
    beetle: {
      key: 'beetle',
      name: 'Ground Beetle', icon: '⬬', mesh: 'beetle',
      death: { roll: Math.PI * 0.94, pitch: 0.08, curl: 0, hy: 0.14 },
      hp: 140, dmg: 6, speed: 1.6, armour: 3.0, temper: 0, eatsSugar: 1,
      scale: 0.90, meat: 260, cost: 10, life: 340,
      col: [0.185, 0.170, 0.205],
      desc: 'Ignores your ants and goes straight for the sugar. Hard to kill, ' +
        'and it will strip a heap while the colony works out what to do.'
    },
    spider: {
      key: 'spider',
      name: 'Wolf Spider', icon: '✹', mesh: 'spider',
      death: { roll: Math.PI * 0.86, pitch: 0.12, curl: 0, hy: 0.42 },
      hp: 260, dmg: 13, speed: 3.4, armour: 1.4, temper: 1,
      scale: 0.62, meat: 300, cost: 16, life: 200,
      //  Lifted from [0.11,0.085,0.075]: luminance 0.089 -> 0.122. The ink pass
      //  is a MULTIPLY, so on a near-black body every interior crease lands in
      //  the bottom few sRGB levels and AO and the vignette finish it off - the
      //  new abdomen segments and the waist were being drawn and not seen.
      //  Still the darkest animal in the tank (beetle 0.176, centipede 0.249).
      col: [0.150, 0.118, 0.100],
      desc: 'Hunts workers on the surface and kills them one at a time. ' +
        'Soldiers can bring one down, but not for free.'
    },
    centipede: {
      key: 'centipede',
      name: 'Centipede', icon: '〰', mesh: 'centipede',
      death: { roll: Math.PI * 0.50, pitch: 0.06, curl: 0, hy: 0.11 },
      hp: 420, dmg: 22, speed: 4.2, armour: 1.8, temper: 1,
      scale: 1.00, meat: 420, cost: 26, life: 220,
      col: [0.46, 0.20, 0.10],
      desc: 'Fast, venomous, and it does not stop. Do not put one in a tank ' +
        'you have not garrisoned.'
    }
  };
  Game.BESTIARY = BESTIARY;

  Game.spawnType = null;

  Game.setSpawn = function (k) {
    this.spawnType = (this.spawnType === k) ? null : k;
    if (this.spawnType) {
      this.buildType = -1;
      if (this.digMode) this.setDig(false);
      if (this.pourType) { this.pourType = null; this.ui.setPour(null); }
      this.pheroMode = 0;
    }
    if (this.ui && this.ui.setSpawn) this.ui.setSpawn(this.spawnType);
  };

  // ------------------------------------------------------------------
  //  spawn
  // ------------------------------------------------------------------
  Game.spawnCreature = function (key, x, z, farm, free) {
    var d = BESTIARY[key];
    if (!d) return null;
    farm = farm || this.player.farms[0] || this.activeFarm;
    if (!farm) return null;
    if (!free) {
      if (this.player.biomass < d.cost) { this.audio.play('deny'); return null; }
      this.player.biomass -= d.cost;
    }
    var y = farm.surfaceTop(x, z);
    var c = {
      def: d, key: key, farm: farm,
      pos: v3.create(x, y, z), yaw: this.rng.range(0, M.TAU), phase: 0,
      hp: d.hp, maxHp: d.hp, dead: false,
      life: d.life, cd: 0, wander: this.rng.range(0, 6),
      flee: 0, target: null, feeding: 0, curl: 0
    };
    //  The combat code in ants.js talks to ants. Rather than teach it about
    //  a second kind of thing, a creature carries a proxy that answers the
    //  same handful of questions an Ant would.
    c.proxy = {
      pos: c.pos,
      //  `predator` matters: Ant.hit has a border-skirmish rule that caps
      //  damage at 30% and refuses to take an ant below 22% health. It
      //  exists so two ANT COLONIES do not grind each other down at the
      //  fence - and because this proxy has a colony with no stance, every
      //  bite an animal landed was being treated as a border scuffle. A
      //  wolf spider could not kill a worker no matter how long it chewed.
      colony: { id: -9, color: [0.22, 0.10, 0.10], isPlayer: false, predator: true },
      def: { scale: d.scale * 1.7, dmg: d.dmg },
      isDead: function () { return c.dead; },
      hit: function (dmg) {
        //  Curling is not just a pose. A woodlouse that has pulled its
        //  plates in presents armour instead of legs and joints, so the
        //  same bite does a fraction of the damage. Without this the
        //  animation played while the number ignored it, and "armoured
        //  enough to take a while to open" was not true of anything.
        var ar = d.armour * (1 + (c.curl || 0) * 1.9);
        c.hp -= dmg / ar;
        c.flee = d.skittish ? 3.5 : c.flee;
        if (c.hp <= 0 && !c.dead) c.dead = true;
      },
      node: null, edge: null, mode: 'surface', farm: farm
    };
    this.predators.push(c);
    return c;
  };

  // ------------------------------------------------------------------
  //  update
  // ------------------------------------------------------------------
  Game.updateCreatures = function (dt) {
    var list = this.predators, i;
    for (i = list.length - 1; i >= 0; i--) {
      var c = list[i];
      var d = c.def || BESTIARY.spider;
      if (c.dead) { this.dropCarcass(c); list.splice(i, 1); continue; }
      c.life -= dt;
      if (c.life <= 0) { c.dead = true; continue; }
      c.cd -= dt;
      c.flee = Math.max(0, c.flee - dt);
      c.phase += dt * (2.5 + d.speed * 1.4);

      //  who is near?
      var best = null, bd = 1e9;
      for (var k = 0; k < this.ants.length; k++) {
        var a = this.ants[k];
        if (a.farm !== c.farm || a.isDead()) continue;
        if (a.pos[1] < c.farm.topY - 2.0) continue;   // surface only
        var dd = v3.dist2(c.pos, a.pos);
        if (dd < bd) { bd = dd; best = a; }
      }

      //  TARGET PERSISTENCE.
      //
      //  A hunter that re-picks the nearest ant every frame never finishes
      //  one. Measured: a spider dropped into a working colony landed six
      //  bites in sixteen seconds, spread across six different workers, and
      //  killed nothing before the swarm brought it down - it was a pinata,
      //  not the predator its own description promises.
      //
      //  Real wolf spiders single out one animal and stay on it. Keeping the
      //  target until it dies or escapes is the whole fix; the damage numbers
      //  were already right.
      if (d.temper > 0) {
        var tgt = c.target;
        if (tgt && (tgt.isDead() || tgt.farm !== c.farm ||
          tgt.pos[1] < c.farm.topY - 2.0 || v3.dist2(c.pos, tgt.pos) > 144)) {
          tgt = null;
        }
        if (!tgt && best && bd < 400) { tgt = best; }
        c.target = tgt;
        if (tgt) { best = tgt; bd = v3.dist2(c.pos, tgt.pos); }
      }

      var tx, tz, sp = d.speed;
      var temper = d.temper;

      if (temper > 0 && best && bd < 400) {
        //  predator: run the nearest worker down
        tx = best.pos[0]; tz = best.pos[2];
      } else if (temper < 0 && best && bd < (c.flee > 0 ? 260 : 30)) {
        //  prey: put distance between itself and the nearest ant
        tx = c.pos[0] + (c.pos[0] - best.pos[0]);
        tz = c.pos[2] + (c.pos[2] - best.pos[2]);
        sp *= (c.flee > 0 ? 1.35 : 0.9);
        //  a woodlouse curls up instead of outrunning anything
        if (!d.skittish) { c.curl = Math.min(1, c.curl + dt * 2.2); sp *= 0.25; }
      } else {
        c.curl = Math.max(0, c.curl - dt * 1.1);
        //  neutral beetles head for the nearest sugar and eat it
        var fed = null;
        var bb = 1e9;
        if (d.eatsSugar && AF.Heap && !AF.Heap.isEmpty()) {
          var blobs = AF.Heap.blobs();
          //  Go for the BIGGEST heap, not the nearest. A pour leaves a spray
          //  of crumbs around the cone, and picking the closest one every
          //  frame made the beetle dither between them and never settle to
          //  eat anything.
          var bestA = 0;
          for (var q = 0; q < blobs.length; q++) {
            if (blobs[q].amount > bestA) { bestA = blobs[q].amount; fed = blobs[q]; }
          }
          if (fed) {
            bb = (fed.x - c.pos[0]) * (fed.x - c.pos[0]) +
              (fed.z - c.pos[2]) * (fed.z - c.pos[2]);
          }
        }
        if (fed) {
          tx = fed.x; tz = fed.z;
          if (bb < 4.0) {
            c.feeding = 1;
            AF.Heap.take(c.pos[0], c.pos[2], dt * 0.9, 0.5);
          } else c.feeding = 0;
        } else {
          c.feeding = 0;
          c.wander += dt * 0.4;
          tx = c.farm.center[0] + Math.cos(c.wander) * c.farm.half[0] * 0.6;
          tz = c.farm.center[2] + Math.sin(c.wander * 1.3) * c.farm.half[2] * 0.5;
        }
      }

      //  move, staying inside the glass
      var wasX = c.pos[0], wasZ = c.pos[2];
      var vx = tx - c.pos[0], vz = tz - c.pos[2];
      var vl = Math.sqrt(vx * vx + vz * vz) || 1;
      if (!c.feeding) {
        c.pos[0] += vx / vl * sp * dt;
        c.pos[2] += vz / vl * sp * dt;
      }

      //  STONES ARE SOLID - and this is the fourth attempt at saying so.
      //
      //  The previous three all pushed out of a circle of radius
      //  0.62*prop.scale. The stone the player is looking at is a bigrock,
      //  rng.range(1.1, 2.1), drawn at instance scale p.scale against a mesh
      //  0.898 units wide: 1.886 across, defended at 1.302. Every animal in
      //  the bestiary could stand with its CENTRE inside the outline of the
      //  biggest rock in the tank - centipede by 0.164, woodlouse 0.185,
      //  beetle 0.206, spider 0.324. The collision was never missing; it was
      //  defending a circle that is not the one on screen. Game.resolveProps
      //  takes its radius from Game.PROP_DRAW, the same table pushProps draws
      //  from, so the two cannot disagree again.
      //
      //  Three more things it fixes here. The glass clamp used to run BEFORE
      //  the push-out, so a push-out could leave an animal outside the tank
      //  with nothing left to catch it; the resolver clamps every iteration.
      //  The old loop took the last prop in array order rather than the
      //  deepest overlap, so one push could shove a body into a prop it had
      //  already cleared - normal, not exotic, with pebbles scattered in
      //  overlapping drifts. And it tested only where the step ENDED: a
      //  centipede at 4.2 covers 1.68 units in a single frame at 8x speed,
      //  further than most props are wide, so it passed through the middle
      //  of them with both endpoints on clean sand. Handing it wasX/wasZ
      //  tests the whole step.
      //
      //  Grass, leaves and twigs stay passable - see the table.
      //
      //  Note this now runs for a FEEDING animal too. c.feeding skips the
      //  move, not the resolve, so a beetle that settles onto a sugar heap
      //  lying against a stone is still pushed off the stone.
      Game.resolveProps(c.farm, c.pos, d.scale * 0.42,
        c.farm.half[0] - 0.8, c.farm.half[2] - 0.8, wasX, wasZ);
      //  ride the terrain, and the sugar heap on top of it
      var ground = c.farm.surfaceTop(c.pos[0], c.pos[2]);
      if (AF.Heap) ground = Math.max(ground, AF.Heap.surfaceAt(c.pos[0], c.pos[2]));
      c.pos[1] = M.damp(c.pos[1], ground, 12, dt);
      if (vl > 0.05 && !c.feeding) c.yaw = M.angleLerp(c.yaw, Math.atan2(vx, vz), dt * 5);

      //  bite
      if (d.dmg > 0 && best && bd < 2.4 * (d.scale + 0.6) && c.cd <= 0) {
        c.cd = 0.62;
        best.hit(d.dmg, c.proxy, this);
        this.fx.burst(best.pos, 8, 'gore', best.colony.color);
        this.audio.play('bite', c.pos, 1.6);
        //  No screen shake on a bite. A spider chews a worker every 0.62s
        //  and a centipede faster, so a raid used to shake the camera almost
        //  continuously - which reads as a broken camera, not as danger. The
        //  bite still has its sound and its spray of gore. Shake is kept for
        //  the one-off events that genuinely jolt the tank (the shelf being
        //  moved, in game.js).
      }
      c.proxy.pos = c.pos;
    }
  };

  // ------------------------------------------------------------------
  //  the carcass
  // ------------------------------------------------------------------
  //  A dead animal is a big lump of protein. The existing foraging code
  //  does the rest: workers walk over, take a piece each, and carry it
  //  down into the nest. `carcass` only changes how it is DRAWN - the
  //  economy sees an ordinary food item.
  Game.dropCarcass = function (c) {
    var d = c.def || BESTIARY.spider;
    var farm = c.farm;
    var y = farm.surfaceTop(c.pos[0], c.pos[2]);
    this.items.push({
      type: 'protein', visual: 'carcass',
      pos: v3.create(c.pos[0], y, c.pos[2]),
      amount: d.meat, maxAmount: d.meat,
      carcass: d, yaw: c.yaw,
      farm: farm, surface: true, dead: false, claimed: 0,
      rot: c.yaw, scale: 1, bob: 0
    });
    this.fx.burst(c.pos, 18, 'gore', [0.45, 0.16, 0.13]);
    this.audio.play('bite', c.pos, 1.2);
    if (this.ui) this.ui.notify(d.name + ' killed — the colony is butchering it');
  };

  // ------------------------------------------------------------------
  //  placement preview
  // ------------------------------------------------------------------
  Game.updateSpawnGhost = function (ray) {
    if (!this.spawnType) { this.spawnGhost = null; return; }
    var farm = this.player.farms[0] || this.activeFarm;
    if (!farm) { this.spawnGhost = null; return; }
    var hit = this.pourPick(ray.o, ray.d, farm);
    if (!hit) { this.spawnGhost = null; return; }
    var d = BESTIARY[this.spawnType];
    var g = this.spawnGhost || (this.spawnGhost = {});
    g.pos = hit; g.def = d;
    g.radius = 0.55 + d.scale * 0.5;
    g.afford = this.player.biomass >= d.cost;
    g.hostile = d.temper > 0;
    return g;
  };

  Game.placeCreature = function () {
    var g = this.spawnGhost;
    if (!g || !this.spawnType) return null;
    var farm = this.player.farms[0] || this.activeFarm;
    var c = this.spawnCreature(this.spawnType, g.pos[0], g.pos[2], farm);
    if (c) {
      this.fx.burst(c.pos, 10, 'dirt', farm.soilTop || [0.5, 0.4, 0.3]);
      this.audio.play('build');
      if (g.hostile && !this._hostileTold) {
        this._hostileTold = 1;
        this.ui.notify('That one hunts your ants. Keep soldiers nearby.', true);
      }
    }
    return c;
  };

})(window.AF = window.AF || {});

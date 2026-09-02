/* =============================================================
   FORMICARIUM :: DEEP COLONY
   game.js - world generation, simulation, player actions
   ============================================================= */
(function (AF) {
  'use strict';

  var M = AF.M, v3 = M.v3, m4 = M.m4;
  var W = AF.W, A = AF.A, C = AF.C, R = AF.R, G = AF.G, FX = AF.FX, AI = AF.AI;

  var Game = {};
  Game.COST = { tunnel: 7, link: 90 };

  // ==================================================================
  //  BOOT
  // ==================================================================
  Game.init = function (canvas, ui) {
    this.canvas = canvas;
    this.ui = ui;
    this.rng = new M.RNG(20260827);
    this.cam = new R.Camera();
    this.input = new AF.IN.Input(canvas);
    this.rig = new AF.IN.Rig(this.cam);
    this.fx = new FX.Effects();
    this.audio = new AF.Audio();
    this.frame = 0;
    this.time = 0;
    this.sim = { time: 0, speed: 1, speedMod: 1, day: 1, dayT: 0 };
    this.paused = false;
    this.state = 'menu';
    this.selection = [];
    this.buildType = -1;
    this.pheroMode = 0;
    this.hoverInfo = null;
    this.grid = new Map();
    this.env = {
      sunDir: v3.normalize(v3.create(), v3.create(-0.42, 0.72, 0.55)),
      sunCol: [2.05, 1.74, 1.37],
      skyCol: [0.50, 0.56, 0.66],
      gndCol: [0.36, 0.31, 0.26],
      roomA: [0.016, 0.018, 0.024],
      roomB: [0.055, 0.062, 0.080],
      time: 0
    };
    this.fxSettings = {
      //  Storybook grade: bright, flat-ish and saturated. The filmic tricks
      //  (grain, chromatic aberration, heavy vignette, deep bokeh) all pull
      //  toward photoreal, which is the opposite of what this game wants.
      exposure: 1.34, bloom: 0.30, bloomThreshold: 1.45, bloomScatter: 1.0,
      ao: 0.70, aoRadius: 0.55, aoStrength: 1.05,
      dof: 0.55, focus: 30, aperture: 0.3, maxCoC: 1.8,
      rays: 0.14, sunUV: [0.5, 0.5], sunOnScreen: false,
      vignette: 0.16, grain: 0.0, ca: 0.0, outline: 0.85, paper: 0.018,
      saturation: 1.44, contrast: 1.08, lift: [0.006, 0.004, 0.010], gain: [1.04, 1.01, 0.97],
      sharpen: 0.18, flash: 0, flashCol: [1, 1, 1]
    };
    this.quality = 'high';
  };

  // ==================================================================
  //  NEW GAME
  // ==================================================================
  Game.newGame = function (opts) {
    this.opts = opts;
    var i;
    this.world = { farms: [], links: [], shelfWidth: 0, shelfHeight: 0 };
    W.buildShelf(this.world, { biome: opts.biome || 'loam' });
    this.colonies = [];
    this.ants = [];
    this.corpses = [];
    this.items = [];
    this.predators = [];
    this.events = [];
    this.brains = [];
    this.frame = 0;
    this.time = 0;
    this.sim = { time: 0, speed: 1, speedMod: 1, day: 1, dayT: 0 };
    this.selection = [];
    this.buildType = -1;
    this.result = null;
    //  A new colony starts with a clean record. main.js seeds these once at
    //  module load, so without this the overlay's "(N kept)" count and the
    //  identical-stack rule both span every run since the page opened - and
    //  a stack from the previous colony would be counted as a repeat.
    this.lastError = null;
    if (this.errorLog) this.errorLog.length = 0;
    if (this.clearErrors && this.state === 'error') this.clearErrors();
    this.grains = [];
    this.eventTimer = 30;
    this.predTimer = 90;

    for (i = 0; i < this.world.farms.length; i++) {
      var f = this.world.farms[i];
      var gx = 96, gy = 60, gz = 56;
      if (opts.quality === 'low') { gx = 64; gy = 40; gz = 36; }
      f.sdf = R.createSDF(gx, gy, gz);
      //  Where water has soaked in. Shares the SDF world box exactly, which
      //  is what lets the soil shader sample both with one pair of
      //  uSdfMin/uSdfMax uniforms. It is NOT scaled down on low quality: at
      //  108 KB it is already a rounding error next to the SDF, and the
      //  field is low frequency by construction - a damp patch is metres
      //  wide - so there is nothing to gain by coarsening it further.
      f.wet = AF.Wet ? AF.Wet.create(f) : null;
      this.generateProps(f);
    }

    // ---- colonies: you on the left of the tank, one rival on the right ----
    var tank = this.world.farms[0];
    var player = new C.Colony({ name: 'Your Colony', species: opts.species, isPlayer: true });
    this.player = player;
    this.colonies.push(player);
    this.foundColony(player, tank, 16, -0.62);

    var aiSpecies = [];
    for (i = 0; i < C.SPECIES.length; i++) if (C.SPECIES[i].key !== opts.species) aiSpecies.push(C.SPECIES[i].key);
    var rivalNames = ['The Far Nest', 'Rust Colony', 'Hollow Log Clan'];
    //  Calm means calm: no rival in the tank at all, so nothing can ever take
    //  the colony away from you. Trouble is opt-in via the difficulty choice.
    var nRivals = opts.rivals !== undefined ? opts.rivals
      : (opts.difficulty === 'calm' ? 0 : 1);
    for (i = 0; i < nRivals; i++) {
      var col = new C.Colony({ name: rivalNames[i % rivalNames.length], species: aiSpecies[i % aiSpecies.length] });
      this.colonies.push(col);
      this.foundColony(col, tank, 8, 0.62);
      var brain = new AI.Brain(col, opts.difficulty || 'scout');
      col.brain = brain;
      this.brains.push(brain);
    }
    tank.owner = player.id;

    this.spawnItems(tank, 30);
    this.rebakeAll();
    this.rig.setBounds(this.world);
    this.rig.setFarm(tank, true);
    this.activeFarm = tank;
    this.state = 'play';
    this.audio.init();
    this.audio.resume();
    this.ui.notify('Your colony is dug in. Watch them work.', false);
  };

  Game.foundColony = function (col, farm, startAnts, xFrac) {
    var x = farm.center[0] + (xFrac === undefined
      ? col.rng.range(-farm.half[0] * 0.35, farm.half[0] * 0.35)
      : farm.half[0] * xFrac + col.rng.range(-1.2, 1.2));
    var z = farm.center[2] + col.rng.range(-1.5, 1.5);
    var nest = W.seedNest(farm, x, z, col.id);
    // both colonies share the one tank, so the player keeps nominal ownership
    if (farm.owner === undefined || farm.owner === null || col.isPlayer) farm.owner = col.id;
    col.farms.push(farm);
    col.home = nest;
    col.recomputeMods();
    // queen
    var q = new A.Ant(col, A.C.QUEEN, farm, [nest.throne.pos[0], nest.throne.pos[1] - nest.throne.radius * 0.90, nest.throne.pos[2]]);
    q.node = nest.throne;
    q.homeNode = nest.throne;
    col.ants.push(q); this.ants.push(q);
    col.queenAnt = q;
    var mix = [A.C.WORKER, A.C.WORKER, A.C.FORAGER, A.C.WORKER, A.C.FORAGER, A.C.SOLDIER];
    for (var i = 0; i < startAnts; i++) {
      var caste = mix[i % mix.length];
      var node = i % 3 === 0 ? nest.nursery : (i % 3 === 1 ? nest.deep : nest.granary);
      var p = v3.create(node.pos[0] + col.rng.range(-1, 1), node.pos[1] - node.radius * 0.90, node.pos[2] + col.rng.range(-1, 1));
      var a = new A.Ant(col, caste, farm, p);
      // stagger the founding cohort so they do not all die of old age at once
      a.age = col.rng.range(0, a.lifespan * 0.55);
      a.node = node;
      a.homeNode = nest.entrance;
      col.ants.push(a); this.ants.push(a);
    }
  };

  // ==================================================================
  //  PROPS & ITEMS
  // ==================================================================
  //  Scatter reads as "nature" only when it clumps. Uniform random placement
  //  looks like confetti, so grass goes down in tufts, pebbles in drifts, and
  //  only the big silhouette pieces are placed individually.
  Game.generateProps = function (farm) {
    var rng = farm.rng;
    var fl = farm.biome.flora;
    farm.props = [];

    function add(kind, x, z, sizeA, sizeB, extra) {
      // keep everything a little inside the glass
      x = M.clamp(x, farm.center[0] - farm.half[0] + 0.9, farm.center[0] + farm.half[0] - 0.9);
      z = M.clamp(z, farm.center[2] - farm.half[2] + 0.9, farm.center[2] + farm.half[2] - 0.9);
      var p = {
        kind: kind, x: x, z: z, y: farm.localTop(x, z),
        rot: rng.range(0, M.TAU), scale: rng.range(sizeA, sizeB),
        tilt: rng.range(-0.2, 0.2), hue: rng.next()
      };
      if (extra) for (var k in extra) p[k] = extra[k];
      farm.props.push(p);
      return p;
    }
    function spot(margin) {
      return [farm.center[0] + rng.range(-farm.half[0] + margin, farm.half[0] - margin),
      farm.center[2] + rng.range(-farm.half[2] + margin, farm.half[2] - margin)];
    }

    // ---- grass in tufts of 4..11 blades ----
    var placed = 0;
    var guard = 0;
    while (placed < fl.grass && guard++ < 4000) {
      var c = spot(1.4);
      var n = 4 + rng.int(8);
      var spread = rng.range(0.30, 0.85);
      // one dominant blade height per tuft so clumps read as individuals
      var tuftH = rng.range(0.62, 1.25);
      for (var j = 0; j < n && placed < fl.grass; j++, placed++) {
        var ang = rng.range(0, M.TAU), rad = Math.sqrt(rng.next()) * spread;
        add('grass', c[0] + Math.cos(ang) * rad, c[1] + Math.sin(ang) * rad,
          tuftH * 0.62, tuftH * 1.18);
      }
    }

    // ---- leaf litter, drifting into hollows ----
    for (var i = 0; i < fl.leaf; i++) {
      var s = spot(1.6);
      add('leaf', s[0], s[1], 0.65, 1.45);
    }

    // ---- mushrooms in small rings ----
    var rings = Math.ceil(fl.mushroom / 3);
    for (i = 0; i < rings; i++) {
      var mc = spot(2.0);
      var cnt = 1 + rng.int(3);
      for (j = 0; j < cnt; j++) {
        var a2 = rng.range(0, M.TAU), r2 = rng.range(0.15, 0.55);
        add('mushroom', mc[0] + Math.cos(a2) * r2, mc[1] + Math.sin(a2) * r2, 0.45, 1.15);
      }
    }

    // ---- pebble drifts ----
    placed = 0; guard = 0;
    while (placed < fl.pebble && guard++ < 3000) {
      var pc = spot(1.2);
      var pn = 2 + rng.int(6);
      for (j = 0; j < pn && placed < fl.pebble; j++, placed++) {
        var pa = rng.range(0, M.TAU), pr = Math.sqrt(rng.next()) * rng.range(0.4, 1.3);
        add('pebble', pc[0] + Math.cos(pa) * pr, pc[1] + Math.sin(pa) * pr, 0.16, 0.62);
      }
    }

    // ---- silhouette pieces, spaced apart so they never overlap ----
    var big = [];
    for (i = 0; i < 4; i++) {
      for (var tries = 0; tries < 24; tries++) {
        var bs = spot(3.2);
        var okDist = true;
        for (var b = 0; b < big.length; b++) {
          var dx = bs[0] - big[b][0], dz = bs[1] - big[b][1];
          if (dx * dx + dz * dz < 49) { okDist = false; break; }
        }
        if (okDist) { big.push(bs); add('bigrock', bs[0], bs[1], 1.1, 2.1); break; }
      }
    }
    for (i = 0; i < Math.max(2, Math.floor(fl.pebble / 14)); i++) {
      var ts = spot(2.4);
      add('twig', ts[0], ts[1], 0.55, 1.25);
    }
  };

  // ==================================================================
  //  HOW A PROP IS DRAWN, AND THEREFORE HOW SOLID IT IS
  // ==================================================================
  //  Stone collision has been written three times and reported broken three
  //  times, and the reason is always the same: the collider invented its own
  //  idea of how big a prop is. Both movers used a single multiple of
  //  prop.scale for every kind, while pushProps draws each kind at a
  //  DIFFERENT instance scale against a DIFFERENT mesh. Measured off the
  //  vertex buffers (Batch.meshR, renderer.js) times the instance scale
  //  pushProps uses:
  //
  //    kind      instance scale   mesh XZ radius   drawn radius
  //    bigrock   p.scale          0.898  B.pebble    0.898*p.scale
  //    pebble    p.scale * 0.55   0.895  B.pebbleSm  0.492*p.scale
  //    leaf      p.scale          1.258  B.leaf      1.258*p.scale
  //    mushroom  p.scale          0.238  B.mushroom  0.238*p.scale
  //    twig      p.scale * 0.70   2.423  B.twig      1.696*p.scale
  //
  //  A bigrock is rng.range(1.1, 2.1), so the biggest stone in the tank is
  //  1.886 units across the middle while the old collider defended 1.302.
  //  With its body term a worker ant was parked 1.520 from the centre of an
  //  outline 1.886 wide - the whole animal inside the silhouette of the most
  //  conspicuous object on screen. Every species did it: centipede 0.164
  //  inside, woodlouse 0.185, beetle 0.206, spider 0.324, worker 0.366.
  //
  //  The same table fixes the error pointing the other way. A leaf is a flat
  //  thing 0.344*p.scale tall lying on the sand and was fenced off by a disc
  //  up to 0.90 wide; the jungle biome scatters seventy of them. A twig is a
  //  stick 0.05 thick whose ORIGIN IS AT ONE END - its mesh runs 0..2.376 in
  //  z - so a disc at p.x,p.z describes nothing about it: wide enough to
  //  cover the stick it fences four times its footprint, narrow enough to
  //  match the stick it blocks only the butt. Both are things you walk over.
  //  A mushroom is a 0.070-radius stem holding a cap an ant walks under, so
  //  it blocks at the stem and nowhere else.
  //
  //    s     - instance scale multiplier, exactly what pushProps passes
  //    yMul  - lift proportional to p.scale, likewise
  //    yAdd  - flat lift, likewise
  //    solid - does a walking body collide with it
  //    rFix  - mesh-space blocking radius that OVERRIDES the silhouette,
  //            for the one kind whose outline is not what stops you.
  //
  //  If you change how a prop is drawn, you change this table, and the
  //  collision follows. That is the entire point.
  Game.PROP_DRAW = {
    grass: { batch: 'grass', s: 1.00, yMul: 0, yAdd: 0, solid: 0 },
    leaf: { batch: 'leaf', s: 1.00, yMul: 0, yAdd: 0.04, solid: 0 },
    //  THE ONE KIND WHOSE OUTLINE IS NOT WHAT STOPS YOU.
    //
    //  buildMushroom is fixed (geometry.js): the cap is a dome on the stem
    //  now, bbox y -0.029..0.584 with z a symmetric -0.226..0.218, where the
    //  broken mesh laid the cap flat on the sand behind the stem and put its
    //  whole extent in z. The silhouette radius came down 0.584 -> 0.238 with
    //  it, and the entry that blocked at the silhouette went with the disc it
    //  was defending.
    //
    //  0.238 is the cap, and the cap is overhead. Measured on the fixed mesh:
    //  the stem is the limb, 0.048 at the sand to 0.070 under the cap, and
    //  the lowest point of the cap is y 0.332 (0.329..0.332 over seeds 0..5).
    //  pushProps spawns mushrooms at p.scale 0.45..1.15, so the cap underside
    //  sits 0.149..0.382 above the sand while a worker ant is 0.317 mesh at
    //  instance scale 0.52 - 0.165 tall. A worker clears the cap on every
    //  mushroom but the very smallest, and what it walks INTO is the stem.
    //
    //  Blocking the 0.238 cap would fence off open air: a wall 0.107..0.274
    //  out from a stem 0.032..0.081 wide, round every mushroom in the tank -
    //  60 of them in the rot biome, 44 in the jungle. So rFix overrides the
    //  silhouette with the stem, mesh-space like every other radius here and
    //  scaled by S.s the same way.
    //
    //  This does mean a spider (0.98 tall) walks through a cap it cannot fit
    //  under. The collider carries no height term - there is one disc per
    //  prop - so the choice is which circle to defend, and the stem is the
    //  only one a body ever actually meets. Leaf and grass are already fully
    //  passable on the same reasoning.
    mushroom: { batch: 'mushroom', s: 1.00, yMul: 0, yAdd: 0, solid: 1, rFix: 0.070 },
    pebble: { batch: 'pebbleSm', s: 0.55, yMul: 0.20, yAdd: 0, solid: 1 },
    bigrock: { batch: 'pebble', s: 1.00, yMul: 0.35, yAdd: 0, solid: 1 },
    //  A CAPSULE, not a disc - the one prop whose origin is not its centre.
    //
    //  buildTwig runs a limb from z 0 to z 2.376 with three branches off the
    //  far end; measured radius grows 0.075 at the butt to 0.70 in the
    //  branches. At instance scale 0.70 that is a stick 1.7 long and half a
    //  unit tall - taller than a worker ant, and a real obstacle. A disc at
    //  p.x,p.z can describe none of it: sized to cover the stick it fences
    //  four times its footprint, sized to the stick it blocks only the butt.
    //  So `seg` is the mesh-space length along the local +z axis and `rad`
    //  the mesh-space thickness, and the resolver treats it as a segment.
    //  0.30 is the MEAN distance of the mesh from that axis, measured after
    //  the fact by transforming buildTwig(4) through the same instance
    //  transform the shader uses and projecting onto the axis: mean 0.215
    //  world units at instance scale 0.714, max 0.413 out at the branch
    //  tips. Blocking at the mean leaves the tips passable, which is right -
    //  they are twigs, and an ant pushes past them rather than walking round.
    twig: { batch: 'twig', s: 0.70, yMul: 0, yAdd: 0.08, solid: 1, seg: 2.376, rad: 0.30 }
  };

  //  Blocking radius of one prop in world units, body NOT included.
  //
  //  This is the silhouette radius, not the radius where the stone meets the
  //  sand. A bigrock is drawn at p.y + 0.35*s against a mesh spanning
  //  -0.685..0.678, so it is buried 0.335*s and stands 1.03*s proud; its
  //  widest ring sits 0.35*s above the sand and the ring at the sand line is
  //  about 0.73*s. Blocking at the silhouette therefore over-blocks the base
  //  by 0.17*s, and that is deliberate: nothing in the game raises a body
  //  onto a prop (localTop is the bare heightfield), so going round is the
  //  only correct answer, and the player judges "inside the stone" against
  //  the outline they can see, not against a contact ring they cannot.
  Game.propBlockR = function (p) {
    var S = Game.PROP_DRAW[p.kind];
    if (!S || !S.solid) return 0;
    if (S._r === undefined) {
      //  A capsule carries its own thickness; the mesh silhouette radius
      //  would be half the stick's LENGTH and means nothing here.
      if (S.rad !== undefined) S._r = S.rad * S.s;
      //  A kind blocked somewhere other than its outline says so, and is
      //  answered without the renderer - the number is the mesh's, not a
      //  measurement of it. Mushroom is the only one: the stem stops you,
      //  the cap is overhead.
      else if (S.rFix !== undefined) S._r = S.rFix * S.s;
      else if (R.B && R.B[S.batch]) S._r = R.B[S.batch].meshR * S.s;
      //  No renderer yet (headless harness). Answer, but do not cache a
      //  guess where the measured value belongs.
      else return 0.9 * S.s * p.scale;
    }
    return S._r * p.scale;
  };

  //  Where a capsule prop's axis ends, relative to its origin. Zero for the
  //  round props, which are their own axis.
  //
  //  eulerM in shaders.js is column-major, so Ry*(0,0,1) is
  //  (sin yaw, 0, cos yaw) - and pushProps hands p.rot in as yaw with pitch
  //  and roll zero. That is the whole convention, and getting it wrong would
  //  put an invisible fence beside the twig instead of on it.
  Game.propAxis = function (p, out) {
    var S = Game.PROP_DRAW[p.kind];
    if (!S || !S.seg) { out[0] = 0; out[1] = 0; return false; }
    var L = S.seg * S.s * p.scale;
    out[0] = Math.sin(p.rot) * L;
    out[1] = Math.cos(p.rot) * L;
    return true;
  };

  //  Largest blocking radius on this farm, for the broad-phase cull. Derived,
  //  never written down: the old culls were the literals 9 (ants, a squared
  //  3.0) and 2.2 + d.scale (creatures). Both happened to still cover the old
  //  radii, with 1.11 and 0.90 units to spare - but a literal that has to
  //  stay ahead of a radius maintained in another file is the same trap as
  //  the radius itself, one release away from silently skipping a prop the
  //  body is standing in.
  Game.propReach = function (farm) {
    var props = farm.props;
    if (farm._reachN === props.length && farm._reachR !== undefined) return farm._reachR;
    var mx = 0, _ax = [0, 0];
    for (var i = 0; i < props.length; i++) {
      var r = Game.propBlockR(props[i]);
      //  A capsule reaches its own length past its origin, and the broad
      //  phase measures from the origin, so the reach has to carry it.
      if (r > 0 && Game.propAxis(props[i], _ax)) {
        r += Math.sqrt(_ax[0] * _ax[0] + _ax[1] * _ax[1]);
      }
      if (r > mx) mx = r;
    }
    farm._reachN = props.length;
    farm._reachR = mx;
    return mx;
  };

  //  THE ONE PUSH-OUT. Everything that walks on the surface calls this.
  //
  //  pos is moved in place out of any solid prop and clamped inside the
  //  glass. fromX/fromZ are where the body started this frame; pass them and
  //  the first pass tests the whole STEP rather than only its endpoint.
  //
  //  Four things the two hand-rolled loops it replaces got wrong:
  //
  //  1. SWEEP, not a point test. dt is min(rawDt, 0.05) * sim.speed and
  //     sim.speed clamps at 8, so a frame is up to 0.40s: a scout covers
  //     1.95 units in one of them and a centipede 1.68. Against the true
  //     radii that is wider than every prop in the tank except a large
  //     bigrock - a small pebble's blocking circle is 0.68 across - so the
  //     body starts outside, ends outside, and the endpoint test sees clean
  //     sand while the animal passed straight through the stone. Testing the
  //     closest approach of the segment catches it, and because the closest
  //     point on the line is already the tangential one, the body still
  //     slides round the obstacle instead of stopping dead on it.
  //
  //  2. DEEPEST FIRST, then look again. The old loops resolved props in
  //     array order and let the last one win, so a push out of one prop
  //     could shove a body into another that had already been checked -
  //     pebbles are scattered in overlapping drifts, so that is the normal
  //     case rather than a corner one. Three passes handle a body wedged
  //     between three props, which is as deep as a tank this sparse goes.
  //
  //  3. CLAMP INSIDE THE LOOP. The old creature code clamped to the glass
  //     and THEN pushed out of stones, so a push-out could leave an animal
  //     outside the tank with nothing left to catch it. Clamping first is no
  //     better on its own: a pebble centre sits as close as 0.9 to the pane
  //     while the creature clamp line is 0.8, so the clamp can put a body
  //     0.1 past the pebble's centre. Doing both every iteration is what
  //     makes a prop that close to the glass resolvable at all - the next
  //     pass simply pushes it out the other side.
  //
  //  4. A BODY ON THE AXIS. `if (od < 1e-6) continue` abandoned anything
  //     that ended up exactly on a prop's centre line, leaving it inside for
  //     good. Back it out the way it came instead.
  //
  //  Cost: it only ever looks at solid props, so the jungle tank's 654-prop
  //  list shrinks to 68 candidates and this is cheaper per body than the
  //  loop it replaces even at three passes.
  //  Nearest point on a capsule's axis to (x,z), clamped to the segment.
  var _axis = [0, 0], _near = [0, 0];
  function capNear(pr, ax, x, z, out) {
    var L2 = ax[0] * ax[0] + ax[1] * ax[1];
    var t = L2 > 1e-9 ? ((x - pr.x) * ax[0] + (z - pr.z) * ax[1]) / L2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    out[0] = pr.x + ax[0] * t;
    out[1] = pr.z + ax[1] * t;
  }

  Game.resolveProps = function (farm, pos, bodyR, hx, hz, fromX, fromZ) {
    var props = farm && farm.props;
    var cx0 = farm.center[0] - hx, cx1 = farm.center[0] + hx;
    var cz0 = farm.center[2] - hz, cz1 = farm.center[2] + hz;
    if (!props || !props.length) {
      pos[0] = M.clamp(pos[0], cx0, cx1);
      pos[2] = M.clamp(pos[2], cz0, cz1);
      return 0;
    }
    if (fromX === undefined) { fromX = pos[0]; fromZ = pos[2]; }
    var reach = Game.propReach(farm) + bodyR;
    //  Broad phase: the step's bounding box grown by three times the largest
    //  blocking circle. Two of those cover the later passes - after a push
    //  the body sits at most `reach` from a prop whose centre was already in
    //  the box, so anything that can still contain it has its centre within
    //  2*reach of the box - and the third is slack for the glass clamp.
    var box = reach * 3;
    var lox = Math.min(fromX, pos[0]) - box, hix = Math.max(fromX, pos[0]) + box;
    var loz = Math.min(fromZ, pos[2]) - box, hiz = Math.max(fromZ, pos[2]) + box;
    var moved = 0, pass, i;
    for (pass = 0; pass < 3; pass++) {
      var hit = null, deepest = 0, qbx = 0, qbz = 0, hneed = 0;
      var hcx = 0, hcz = 0;
      for (i = 0; i < props.length; i++) {
        var pr = props[i];
        if (pr.x < lox || pr.x > hix || pr.z < loz || pr.z > hiz) continue;
        var br = Game.propBlockR(pr);
        if (br <= 0) continue;
        var need = br + bodyR;
        //  A round prop is its own centre; a capsule's is whichever point on
        //  its axis is nearest the body, recomputed per query because the
        //  body moves along it.
        var ccx = pr.x, ccz = pr.z;
        var isCap = Game.propAxis(pr, _axis);
        //  THE ENDPOINT FIRST, the swept segment only as a tunnelling guard.
        //
        //  Resolving every contact at the segment's closest approach to the
        //  prop looks tidier but is wrong for the common case: a body that
        //  merely GRAZES a stone gets relocated back to the point of closest
        //  approach and loses the rest of its travel - up to a full `need`
        //  sideways in one frame at high game speed, for a body that was
        //  never going to end up inside anything. So: if the step ENDS
        //  inside the prop, resolve the endpoint, exactly as a point test
        //  would. Only when the endpoint is clear and the segment still
        //  passed through do we fall back to the closest-approach point -
        //  which is the case the endpoint test cannot see at all, and the
        //  reason the sweep is here.
        if (isCap) capNear(pr, _axis, pos[0], pos[2], _near);
        else { _near[0] = pr.x; _near[1] = pr.z; }
        var ox = pos[0] - _near[0], oz = pos[2] - _near[1];
        var od = ox * ox + oz * oz;
        var qx = pos[0], qz = pos[2];
        ccx = _near[0]; ccz = _near[1];
        if (od >= need * need) {
          if (pass !== 0) continue;
          var sx = pos[0] - fromX, sz = pos[2] - fromZ;
          var ss = sx * sx + sz * sz;
          if (ss <= 1e-8) continue;
          var t = ((ccx - fromX) * sx + (ccz - fromZ) * sz) / ss;
          if (t <= 0 || t >= 1) continue;          // nearest point is an endpoint; already tested
          qx = fromX + sx * t; qz = fromZ + sz * t;
          if (isCap) { capNear(pr, _axis, qx, qz, _near); ccx = _near[0]; ccz = _near[1]; }
          ox = qx - ccx; oz = qz - ccz;
          od = ox * ox + oz * oz;
          if (od >= need * need) continue;         // the step really did miss
        }
        var pen = need - Math.sqrt(od);
        if (pen > deepest) {
          deepest = pen; hit = pr; qbx = qx; qbz = qz; hneed = need;
          hcx = ccx; hcz = ccz;
        }
      }
      if (!hit) break;
      //  Which way out. Normally straight out along the line from the
      //  stone's centre, so the body slides round rather than stopping dead.
      //
      //  Near the centre that line is noise: at 1% of `need` the direction
      //  is decided by float rounding, and the body is then flung a full
      //  radius along it, differently every frame. The old guard only caught
      //  an EXACT centre hit (1e-4), which never happens, so the noisy band
      //  was live and the exact case it did catch fell through to an
      //  arbitrary away-from-the-tank-centre shove of up to `need`.
      //
      //  So the threshold is a fraction of the radius, not an epsilon, and
      //  the first fallback is the way the body CAME - back it out along its
      //  own path, which is the only direction that means anything to a body
      //  that has driven into the middle of a stone.
      var ax = qbx - hcx, az = qbz - hcz;
      var al = Math.sqrt(ax * ax + az * az);
      if (al < hneed * 0.02) {
        ax = fromX - hcx; az = fromZ - hcz;
        al = Math.sqrt(ax * ax + az * az);
        if (al < hneed * 0.02) {
          ax = hcx - farm.center[0]; az = hcz - farm.center[2];
          al = Math.sqrt(ax * ax + az * az) || 1;
        }
      }
      pos[0] = M.clamp(hcx + ax / al * hneed, cx0, cx1);
      pos[2] = M.clamp(hcz + az / al * hneed, cz0, cz1);
      moved = 1;
    }
    if (!moved) {
      pos[0] = M.clamp(pos[0], cx0, cx1);
      pos[2] = M.clamp(pos[2], cz0, cz1);
    }
    return moved;
  };

  Game.ITEMS = {
    sugar: { color: [1.0, 0.98, 0.94], mesh: 'crystal', amount: 26, glow: 0.22 },
    seed: { color: [0.55, 0.42, 0.22], mesh: 'seed', amount: 32, glow: 0 },
    protein: { color: [0.42, 0.52, 0.28], mesh: 'aphid', amount: 40, glow: 0 },
    water: { color: [0.40, 0.66, 0.95], mesh: 'droplet', amount: 34, glow: 0.05 },
    leaf: { color: [0.35, 0.62, 0.22], mesh: 'leaf', amount: 22, glow: 0 },
    mineral: { color: [0.72, 0.62, 1.0], mesh: 'crystal', amount: 18, glow: 0.55 }
  };

  Game.spawnItems = function (farm, n) {
    var rng = farm.rng;
    var pool = ['sugar', 'seed', 'protein', 'water', 'leaf'];
    if (farm.biome.mods.mineral) pool.push('mineral', 'mineral');
    if (farm.biome.mods.protein) pool.push('protein', 'protein');
    if (farm.biome.humid > 0.7) pool.push('leaf', 'leaf');
    for (var i = 0; i < n; i++) {
      var type = pool[rng.int(pool.length)];
      var x = farm.center[0] + rng.range(-farm.half[0] + 1.6, farm.half[0] - 1.6);
      var z = farm.center[2] + rng.range(-farm.half[2] + 1.6, farm.half[2] - 1.6);
      var def = Game.ITEMS[type];
      this.items.push({
        type: type === 'seed' ? 'sugar' : type, visual: type,
        pos: v3.create(x, farm.localTop(x, z), z),
        amount: def.amount * farm.biome.mods.foodYield * rng.range(0.7, 1.35),
        farm: farm, surface: true, dead: false, claimed: 0,
        rot: rng.range(0, M.TAU), scale: rng.range(0.7, 1.3), bob: rng.range(0, M.TAU)
      });
    }
  };

  // ==================================================================
  //  ACTIONS
  // ==================================================================
  Game.planTunnel = function (col, farm, fromNode, pos, chamberType, free) {
    if (!fromNode) return null;
    var def = W.CHAMBERS[chamberType] || W.CHAMBERS[0];
    var radius = def.radius;
    // every excavation lives in the slab pressed against the front pane
    pos = [pos[0], pos[1], M.clamp(pos[2], farm.slabBack, farm.digZ)];
    // validity
    if (Math.abs(pos[0] - farm.center[0]) > farm.half[0] - radius - 0.5) return null;
    if (pos[1] < farm.center[1] - farm.half[1] + radius + 0.5) return null;
    if (pos[1] > farm.localTop(pos[0], pos[2]) - radius * 0.35) return null;
    var d = v3.dist(fromNode.pos, pos);
    if (d < radius + fromNode.radius * 0.5 || d > 14) return null;
    for (var i = 0; i < farm.nodes.length; i++) {
      var n = farm.nodes[i];
      if (v3.dist(n.pos, pos) < (n.radius + radius) * 0.62) return null;
    }
    var cost = Game.COST.tunnel + def.cost;
    if (!free) {
      if (col.biomass < cost * 0.5) return null;
      col.biomass -= cost * 0.5;
    }
    var node = farm.addNode(pos[0], pos[1], pos[2], radius, chamberType);
    node.build = 0;
    var edge = farm.addEdge(fromNode, node, chamberType === W.CH.TUNNEL ? 0.74 : 0.82, 0);
    col.queueDig(edge, farm);
    col.queueDig(node, farm);
    // wake nearby idle diggers
    var woke = 0;
    for (i = 0; i < col.ants.length && woke < 8; i++) {
      var a = col.ants[i];
      if (a.state === A.ST.IDLE && (a.caste === A.C.WORKER || a.caste === A.C.CLEANER)) {
        col.assignJob(a, this); woke++;
      }
    }
    farm.dirty = true;
    return node;
  };

  Game.linkBetween = function (a, b) {
    for (var i = 0; i < this.world.links.length; i++) {
      var L = this.world.links[i];
      if ((L.a === a && L.b === b) || (L.a === b && L.b === a)) return L;
    }
    return null;
  };

  Game.startLink = function (col, a, b) {
    if (this.linkBetween(a, b)) return null;
    if (!W.canLink(a, b)) return null;
    if (col.biomass < Game.COST.link * 0.4) return null;
    col.biomass -= Game.COST.link * 0.4;
    var link = W.makeLink(this.world, a, b);
    link.owner = col.id;
    col.jobs.dig.push({ kind: 'build', edge: link.edge, farm: a });
    a.dirty = true; b.dirty = true;
    if (col.isPlayer) this.ui.notify('Bridge under construction: ' + a.name + ' <-> ' + b.name, false);
    return link;
  };

  Game.reachable = function (col, farm) {
    if (!col.farms.length) return false;
    for (var i = 0; i < col.farms.length; i++) {
      if (col.farms[i] === farm) return true;
      var L = this.linkBetween(col.farms[i], farm);
      if (L && L.edge.build >= 1) return true;
      // two hops
      for (var k = 0; k < this.world.links.length; k++) {
        var L2 = this.world.links[k];
        if (L2.edge.build < 1) continue;
        var mid = null;
        if (L2.a === farm) mid = L2.b; else if (L2.b === farm) mid = L2.a;
        if (!mid) continue;
        var L3 = this.linkBetween(col.farms[i], mid);
        if (L3 && L3.edge.build >= 1) return true;
      }
    }
    return false;
  };

  Game.onRaidLaunched = function (col, target) {
    var victimFarm = target.farm;
    var victim = null;
    for (var i = 0; i < this.colonies.length; i++) if (this.colonies[i].id === victimFarm.owner) victim = this.colonies[i];
    if (victim) {
      victim.threat = 1.0;
      if (victim.isPlayer) {
        this.ui.notify('RAID INBOUND: ' + col.name + ' is marching on ' + victimFarm.name, true);
        this.audio.play('raid');
        this.fx.flashScreen(0.35, [1.0, 0.35, 0.2]);
      }
    }
  };

  Game.onColonyDefeated = function (col) {
    this.ui.notify(col.name + ' is gone', !col.isPlayer);
    // one shared tank: only release ownership if this colony actually held it,
    // and hand it straight back to the player if they are still alive
    for (var i = 0; i < col.farms.length; i++) {
      if (col.farms[i].owner === col.id) {
        col.farms[i].owner = (this.player && !this.player.defeated) ? this.player.id : -1;
      }
    }
    col.farms.length = 0;
    if (col.isPlayer) this.endGame(false, 'Your queen is gone, and with her the colony.');
    else {
      var alive = 0;
      for (var k = 0; k < this.colonies.length; k++) if (!this.colonies[k].defeated && !this.colonies[k].isPlayer) alive++;
      // On Calm the tank is a sandbox: the far nest dying is a note, not an
      // ending. Nothing should ever take the game away from you there.
      if (alive === 0) {
        if (this.opts && this.opts.difficulty === 'calm') {
          this.ui.notify('The far nest has died out. The tank is all yours.', false, 'good');
        } else {
          this.endGame(true, 'The tank is yours alone. Your colony has the run of it.');
        }
      }
    }
  };

  Game.endGame = function (won, msg) {
    if (this.result) return;
    this.result = { won: won, msg: msg, day: this.sim.day };
    this.state = 'over';
    this.audio.play(won ? 'win' : 'lose');
    this.ui.showEnd(this.result, this);
  };

  // ==================================================================
  //  QUERIES
  // ==================================================================
  Game.buildGrid = function () {
    this.grid.clear();
    var CS = 3.0;
    for (var i = 0; i < this.ants.length; i++) {
      var a = this.ants[i];
      if (a.isDead()) continue;
      var kx = Math.floor(a.pos[0] / CS), ky = Math.floor(a.pos[1] / CS), kz = Math.floor(a.pos[2] / CS);
      var key = kx + ',' + ky + ',' + kz;
      var arr = this.grid.get(key);
      if (!arr) { arr = []; this.grid.set(key, arr); }
      arr.push(a);
    }
  };

  Game.forEachNear = function (pos, radius, cb) {
    var CS = 3.0;
    var r = Math.ceil(radius / CS);
    var cx = Math.floor(pos[0] / CS), cy = Math.floor(pos[1] / CS), cz = Math.floor(pos[2] / CS);
    for (var x = -r; x <= r; x++) for (var y = -r; y <= r; y++) for (var z = -r; z <= r; z++) {
      var arr = this.grid.get((cx + x) + ',' + (cy + y) + ',' + (cz + z));
      if (!arr) continue;
      for (var i = 0; i < arr.length; i++) cb(arr[i]);
    }
  };

  Game.findEnemyNear = function (ant, radius) {
    var best = null, bd = radius * radius;
    this.forEachNear(ant.pos, radius, function (o) {
      if (o.colony === ant.colony || o.isDead()) return;
      var d = v3.dist2(ant.pos, o.pos);
      if (d < bd) { bd = d; best = o; }
    });
    if (!best) {
      for (var i = 0; i < this.predators.length; i++) {
        var p = this.predators[i];
        if (p.dead) continue;
        if (v3.dist2(ant.pos, p.pos) < radius * radius * 2.2) return p.proxy;
      }
    }
    return best;
  };

  Game.nearestThreat = function (col, ant) {
    var best = null, bd = 1e9;
    for (var i = 0; i < this.ants.length; i += 1) {
      var o = this.ants[i];
      if (o.colony === col || o.isDead()) continue;
      var owned = false;
      for (var k = 0; k < col.farms.length; k++) if (col.farms[k] === o.farm) owned = true;
      if (!owned) continue;
      var d = v3.dist2(ant.pos, o.pos);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  };

  //  Both colonies live in one tank, so a forager that simply walks to the
  //  nearest crumb will happily stroll into the rival's guarded doorstep and
  //  be killed there. Food sitting inside somebody else's territory is not
  //  worth fetching.
  Game.inEnemyTerritory = function (col, pos, radius) {
    for (var c = 0; c < this.colonies.length; c++) {
      var other = this.colonies[c];
      if (other === col || other.defeated) continue;
      var h = other.queenAnt && !other.queenAnt.isDead() ? other.queenAnt.pos
        : (other.home && other.home.throne ? other.home.throne.pos : null);
      if (!h) continue;
      var dx = pos[0] - h[0], dy = pos[1] - h[1], dz = pos[2] - h[2];
      if (dx * dx + dy * dy + dz * dz < radius * radius) return true;
    }
    return false;
  };

  //  Shove a position out of any rival's dooryard, in XZ. Non-combat ants use
  //  this every surface step: filtering food targets alone was not enough,
  //  because wandering and hauling walked them into the guards anyway.
  Game.pushOutOfEnemy = function (col, pos, radius) {
    var moved = false;
    for (var c = 0; c < this.colonies.length; c++) {
      var other = this.colonies[c];
      if (other === col || other.defeated) continue;
      var h = other.queenAnt && !other.queenAnt.isDead() ? other.queenAnt.pos
        : (other.home && other.home.throne ? other.home.throne.pos : null);
      if (!h) continue;
      var dx = pos[0] - h[0], dz = pos[2] - h[2];
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d >= radius) continue;
      if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
      pos[0] = h[0] + dx / d * radius;
      pos[2] = h[2] + dz / d * radius;
      moved = true;
    }
    return moved;
  };

  Game.findForageTarget = function (col, ant) {
    var best = null, bd = 1e9;
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i];
      if (it.dead || !it.surface) continue;
      if (it.claimed && it.claimed !== ant.id && this.antById(it.claimed)) continue;
      var owned = false;
      for (var k = 0; k < col.farms.length; k++) if (col.farms[k] === it.farm) owned = true;
      if (!owned) continue;
      if (col.water > col.storage() * 0.7 && it.type === 'water') continue;
      if (this.inEnemyTerritory(col, it.pos, 9)) continue;
      var d = v3.dist2(ant.pos, it.pos);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  };

  Game.findHaulItem = function (col, ant) {
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i];
      if (it.dead || it.surface) continue;
      if (it.claimed && it.claimed !== ant.id) continue;
      if (it.farm !== ant.farm) continue;
      return it;
    }
    return null;
  };

  Game.findCorpse = function (col, ant) {
    for (var i = 0; i < this.corpses.length; i++) {
      var c = this.corpses[i];
      if (c.removed || c.taken) continue;
      //  Skip bodies lying out on the terrain, the way findHaulItem already
      //  skips surface items. A surface corpse records the ENTRANCE as its
      //  node, so an undertaker paths there, stands on the entrance chamber
      //  floor, and can never close the last stretch up onto the open ground -
      //  it just re-claims the same unreachable body on every idle tick.
      //
      //  Tested on the flag set at death, not on height. A plane at
      //  topY - 1.2 also swallowed every corpse in the entrance chamber,
      //  because the seeded nest mouths sit on high ground.
      if (c.surface) continue;
      if (c.claimed && c.claimed !== ant.id) continue;
      var owned = false;
      for (var k = 0; k < col.farms.length; k++) if (col.farms[k] === c.farm) owned = true;
      if (!owned) continue;
      return c;
    }
    return null;
  };

  Game.antById = function (id) {
    for (var i = 0; i < this.ants.length; i++) if (this.ants[i].id === id) return this.ants[i];
    return null;
  };

  Game.markDirty = function (farm) { if (farm) farm.dirty = true; };

  Game.rebakeAll = function () {
    for (var i = 0; i < this.world.farms.length; i++) this.rebake(this.world.farms[i]);
  };
  Game.rebake = function (farm) {
    var n = farm.packSegments();
    R.bakeSDF(farm.sdf, farm.sdfMin, farm.sdfMax, farm.topY, farm.segBuf, n,
      [farm.center[0], farm.center[2]]);
    //  The CPU mirror of this field is now stale. Drop it; it refills lazily,
    //  a few chunks per frame, only where somebody actually asks.
    if (AF.SDFCache) AF.SDFCache.invalidate(farm);
    //  the ground these were resting on just moved
    if (AF.PS) AF.PS.wakeAll();
    if (AF.Heap) AF.Heap.rebakeGround();
    this.pruneFloatingProps(farm);
    farm.dirty = false;
  };

  //  Grass cannot grow over a hole.
  //
  //  Props are scattered once at world generation and sit at localTop for
  //  ever after. But localTop is the terrain HEIGHTFIELD - it knows nothing
  //  about the tunnels the colony carves, which are subtracted from the soil
  //  SDF instead. So the moment the ants dug their own way out to daylight,
  //  the tuft that had been growing on that spot was left hanging in the air
  //  over the entrance shaft, ten units above anything solid.
  //
  //  Only runs on a rebake - that is, when the soil actually changed - and
  //  a farm holds a few hundred props, so the cost is nothing.
  Game.pruneFloatingProps = function (farm) {
    if (!farm || !farm.props) return 0;
    var cut = 0;
    for (var i = farm.props.length - 1; i >= 0; i--) {
      var p = farm.props[i];
      //  Probe just under the base. Anything with open space there is
      //  standing on nothing. The margin is deliberately loose so a prop on
      //  the lip of a shaft is kept rather than popped in and out as the
      //  tunnel creeps outward.
      //  Two probes, not one. The first is under the prop itself. The
      //  second is under it AT THE DIG PLANE, because the shovel only cuts
      //  the thin slab against the front glass: a stone a little way behind
      //  that slab keeps solid ground directly beneath it and passed the
      //  first test, while the hole opened in front of it and left it
      //  standing over the cut for anyone looking at the tank.
      //
      //  Also probe deeper than 6cm. A scoop that takes the surface but
      //  leaves a crumb right under the base reads as solid at that depth
      //  and floats anyway.
      var open = farm.soilSDF(p.x, p.y - 0.06, p.z) > 0.18 ||
        farm.soilSDF(p.x, p.y - 0.30, p.z) > 0.34 ||
        farm.soilSDF(p.x, p.y - 0.06, farm.digZ) > 0.18;
      if (open) {
        farm.props.splice(i, 1);
        cut++;
      }
    }
    return cut;
  };

  // ==================================================================
  //  UPDATE
  // ==================================================================
  Game.update = function (rawDt) {
    var i, k;
    this.frame++;
    var speed = this.paused ? 0 : this.sim.speed;
    var dt = Math.min(rawDt, 0.05) * speed;
    this.time += rawDt;
    this.env.time = this.time;
    this.sim.time += dt;
    this.sim.dayT += dt;
    if (this.sim.dayT > 90) { this.sim.dayT -= 90; this.sim.day++; this.onNewDay(); }

    this.rig.update(rawDt, this.input, this);
    this.cam.update(R.width / R.height);
    this.audio.setListener(this.cam.pos);

    if (dt <= 0) { this.fx.update(rawDt * 0.25); return; }

    //  Fill in any soil-field chunks the physics asked for last frame. Capped
    //  so a big pour can never stall a frame; a cold chunk just falls back to
    //  the exact field for one frame and is fast from then on.
    if (AF.SDFCache) {
      for (var _fi = 0; _fi < this.world.farms.length; _fi++) {
        AF.SDFCache.pump(this.world.farms[_fi], 4);
      }
    }
    //  The solver runs on REAL time, not the sim clock. Game speed reaches
    //  8x, which makes dt up to 0.4s here - feeding that to a position-based
    //  solver is an instant blow-up, and fast-forwarding water is not a
    //  feature anyone asked for.
    if (AF.PS) AF.PS.step(rawDt, this);
    //  Dry out the damp patches and push whatever changed to the GPU.
    //
    //  This deliberately does NOT live inside PS.step. That function returns
    //  before it does anything when there are no particles left
    //  (`if (!farm || count === 0) ... return`), and that is precisely the
    //  moment the last drop has soaked away: put the tick in there and the
    //  stain freezes at full strength and never fades. Being inside the
    //  `dt <= 0` pause gate above is correct, though - a paused tank should
    //  not dry out.
    if (AF.Wet) {
      for (var _wf = 0; _wf < this.world.farms.length; _wf++) {
        AF.Wet.tick(this.world.farms[_wf], rawDt);
      }
    }
    //  The sugar heap settles on real time too, for the same reason the
    //  solver does: at 8x the relaxation would overshoot and ring.
    if (AF.Heap) {
      if (!AF.Heap.ready) {
        var _hf = this.player.farms[0] || this.world.farms[0];
        if (_hf) { AF.Heap.init(_hf); AF.Heap.ready = true; }
      }
      AF.Heap.relax(rawDt);
      AF.Heap.dissolve(rawDt);
      //  sugar sitting over an open shaft falls into the nest
      AF.Heap.drain(this);
      this.settleUndergroundSugar();
      this.wetHeapFromWater(rawDt);
      this.publishHeapFood();
    }
    if (this.updateScoops) this.updateScoops(dt);
    this.buildGrid();

    // colonies
    for (i = 0; i < this.colonies.length; i++) {
      if (!this.colonies[i].defeated) this.colonies[i].update(dt, this);
    }
    for (i = 0; i < this.brains.length; i++) this.brains[i].update(dt, this);

    // ants
    for (i = 0; i < this.ants.length; i++) {
      var a = this.ants[i];
      if (a.isDead()) continue;
      a.update(dt, this);
    }
    // reap
    for (i = this.ants.length - 1; i >= 0; i--) {
      if (this.ants[i].isDead()) this.ants.splice(i, 1);
    }

    // items
    for (i = this.items.length - 1; i >= 0; i--) {
      var it = this.items[i];
      if (it.dead) { this.items.splice(i, 1); continue; }
      it.bob += dt * 0.6;
    }

    // corpses rot and hurt hygiene
    for (i = this.corpses.length - 1; i >= 0; i--) {
      var c = this.corpses[i];
      c.age += dt;
      //  Mark it removed BEFORE splicing, even when it is age that killed it.
      //
      //  Expiry used to splice the entry while leaving `removed` false, so the
      //  body vanished from the world with nothing to tell its holders. Every
      //  staleness guard keys off that flag - doClean's is
      //  `if (c.removed && this.carry !== 'corpse')` - so an undertaker still
      //  walking to a body that timed out never learned it was gone. It kept
      //  the job, doClean called setPath (which sets state MOVE), doMove found
      //  no path and called onArrive, onArrive put it back in CLEAN, and the
      //  two states alternated every frame, in place, for good. Measured on a
      //  running colony: one ant oscillating for 3000 frames straight.
      //
      //  A corpse the ant is CARRYING already sets this flag at pickup and is
      //  spliced on the next tick, so it never reaches the age branch.
      if (c.removed || c.age > 70) { c.removed = true; this.corpses.splice(i, 1); continue; }
      if (this.frame % 90 === 0) {
        for (k = 0; k < this.colonies.length; k++) {
          if (this.colonies[k].farms.indexOf(c.farm) >= 0) {
            this.colonies[k].hygiene = Math.max(0, this.colonies[k].hygiene - 0.0009);
          }
        }
      }
      if (c.age > 24 && this.rng.chance(dt * 0.08)) this.fx.burst(c.pos, 1, 'spore');
    }

    // predators
    this.updatePredators(dt);

    // pheromone decay + traffic decay
    if (this.frame % 4 === 0) {
      var d4 = dt * 4;
      for (i = 0; i < this.world.farms.length; i++) {
        var farm = this.world.farms[i];
        for (k = 0; k < farm.edges.length; k++) {
          var e = farm.edges[k];
          e.traffic *= Math.exp(-0.45 * d4);
          for (var p = 0; p < 5; p++) e.pher[p] *= Math.exp(-0.20 * d4);
        }
      }
    }

    // events + item respawn
    this.eventTimer -= dt;
    if (this.eventTimer <= 0) {
      this.eventTimer = this.rng.range(24, 52);
      this.randomEvent();
    }
    if (this.frame % 120 === 0) {
      for (i = 0; i < this.world.farms.length; i++) {
        var f2 = this.world.farms[i];
        var count = 0;
        for (k = 0; k < this.items.length; k++) if (this.items[k].farm === f2 && this.items[k].surface) count++;
        if (count < 16) this.spawnItems(f2, 2);
      }
    }

    // one SDF rebake per frame keeps digging responsive without stalls
    for (i = 0; i < this.world.farms.length; i++) {
      if (this.world.farms[i].dirty) { this.rebake(this.world.farms[i]); break; }
    }

    // threat sensing for player
    var pl = this.player;
    if (pl && !pl.defeated) {
      //  Both colonies share the one tank now, so "in my farm" is no longer
      //  a threat signal - it is just Tuesday. Only enemies that have come
      //  close to the nest count.
      var intruders = 0;
      var home = pl.queenAnt ? pl.queenAnt.pos : (pl.home && pl.home.throne ? pl.home.throne.pos : null);
      if (home) {
        for (i = 0; i < this.ants.length; i++) {
          var q = this.ants[i];
          if (q.colony === pl) continue;
          var ddx = q.pos[0] - home[0], ddy = q.pos[1] - home[1], ddz = q.pos[2] - home[2];
          if (ddx * ddx + ddy * ddy + ddz * ddz < 13 * 13) intruders++;
        }
      }
      pl.threat = Math.max(pl.threat, Math.min(1, intruders / 8));
      this.audio.setTension(pl.threat * 0.7 + (1 - pl.hygiene) * 0.2 + (pl.food() < 20 ? 0.3 : 0));
      this.audio.setBusy(pl.ants.length);
    }

    // ---- atmosphere: motes drifting in the lit air of the open vitrine ----
    if (this.frame % 8 === 0 && this.activeFarm && this.rig.dist < 70) {
      var af = this.activeFarm;
      this.fx.ambientDust(
        [af.center[0], af.topY + 2.6, af.digZ - 1.2],
        Math.min(af.half[0], 13),
        1, [0.95, 0.88, 0.74]);
      if (af.biome.humid > 0.7 && this.rng.chance(0.25)) {
        var sx2 = af.center[0] + this.rng.range(-af.half[0] * 0.8, af.half[0] * 0.8);
        var sz2 = af.digZ - this.rng.range(0, 2);
        this.fx.burst([sx2, af.localTop(sx2, sz2) + 0.2, sz2], 1, 'spore');
      }
    }

    this.fx.update(rawDt);
    this.checkVictory();
  };

  //  Food has to scale with how many mouths are in the tank. A flat three
  //  crumbs a day is generous for twenty ants and a famine for a hundred -
  //  both colonies grew to ~50 and then starved together in the same hour.
  Game.onNewDay = function () {
    this.ui.notify('Day ' + this.sim.day);
    var mouths = this.ants.length;
    var live = 0;
    for (var k = 0; k < this.items.length; k++) if (!this.items[k].dead && this.items[k].surface) live++;
    var want = 4 + Math.ceil(mouths / 9);
    var n = Math.max(0, Math.min(want, 60 - live));
    for (var i = 0; i < this.world.farms.length; i++) this.spawnItems(this.world.farms[i], n);
  };

  //  There is one tank and you already live in it, so "own every farm" is not
  //  a victory condition any more - it is the starting state. Winning is
  //  handled in onColonyDefeated when the last rival is gone; the only thing
  //  to watch for here is losing the queen.
  Game.checkVictory = function () {
    if (this.result) return;
    if (this.player.defeated) this.endGame(false, 'Your colony is extinct.');
  };

  // ------------------------------------------------------------------
  //  PREDATORS
  // ------------------------------------------------------------------
  Game.updatePredators = function (dt) {
    var i;
    this.predTimer -= dt;
    if (this.predTimer <= 0 && this.predators.length < 2) {
      this.predTimer = this.rng.range(120, 260);
      this.spawnPredator();
    }
    //  Everything in the tank is a creature now, spider included. The old
    //  hard-coded chase below is kept only as a fallback for a save that
    //  predates the bestiary.
    if (this.updateCreatures) { this.updateCreatures(dt); return; }
    for (i = this.predators.length - 1; i >= 0; i--) {
      var p = this.predators[i];
      if (p.dead) { this.predators.splice(i, 1); continue; }
      p.life -= dt;
      if (p.life <= 0) { p.dead = true; continue; }
      p.cd -= dt;
      // hunt the nearest ant on the surface
      var best = null, bd = 1e9;
      for (var k = 0; k < this.ants.length; k++) {
        var a = this.ants[k];
        if (a.farm !== p.farm || a.isDead()) continue;
        if (a.pos[1] < p.farm.topY - 2.0) continue;
        var d = v3.dist2(p.pos, a.pos);
        if (d < bd) { bd = d; best = a; }
      }
      var tx, tz;
      if (best && bd < 400) { tx = best.pos[0]; tz = best.pos[2]; }
      else {
        p.wander += dt * 0.4;
        tx = p.farm.center[0] + Math.cos(p.wander) * p.farm.half[0] * 0.6;
        tz = p.farm.center[2] + Math.sin(p.wander * 1.3) * p.farm.half[2] * 0.5;
      }
      var dx = tx - p.pos[0], dz = tz - p.pos[2];
      var dl = Math.sqrt(dx * dx + dz * dz) || 1;
      var sp = 3.4 * dt;
      p.pos[0] += dx / dl * sp; p.pos[2] += dz / dl * sp;
      p.pos[1] = M.damp(p.pos[1], p.farm.localTop(p.pos[0], p.pos[2]), 12, dt);
      p.yaw = M.angleLerp(p.yaw, Math.atan2(dx, dz), dt * 5);
      p.phase += dt * 6;
      if (best && bd < 2.2 && p.cd <= 0) {
        p.cd = 0.85;
        best.hit(13, p.proxy, this);
        this.fx.burst(best.pos, 8, 'gore', best.colony.color);
        this.audio.play('bite', p.pos, 1.6);
        //  and the same for the legacy predator path - see creatures.js
      }
      p.proxy.pos = p.pos;
    }
  };

  Game.spawnPredator = function () {
    //  The wandering spider is now just one entry in the bestiary.
    if (this.spawnCreature) {
      var wf = this.world.farms[this.rng.int(this.world.farms.length)];
      if (wf.owner < 0) return;
      var wx = wf.center[0] + this.rng.range(-wf.half[0] * 0.7, wf.half[0] * 0.7);
      var wz = wf.center[2] + this.rng.range(-wf.half[2] * 0.6, wf.half[2] * 0.6);
      var wc = this.spawnCreature('spider', wx, wz, wf, true);
      var wo = null;
      for (var wi = 0; wi < this.colonies.length; wi++) {
        if (this.colonies[wi].id === wf.owner) wo = this.colonies[wi];
      }
      if (wc && wo && wo.isPlayer) {
        this.ui.notify('A wolf spider has entered ' + wf.name, true);
        this.audio.play('alert');
      }
      return wc;
    }
    var farm = this.world.farms[this.rng.int(this.world.farms.length)];
    if (farm.owner < 0) return;
    var x = farm.center[0] + this.rng.range(-farm.half[0] * 0.7, farm.half[0] * 0.7);
    var z = farm.center[2] + this.rng.range(-farm.half[2] * 0.6, farm.half[2] * 0.6);
    var p = {
      farm: farm, pos: v3.create(x, farm.localTop(x, z), z), yaw: 0, phase: 0,
      life: this.rng.range(70, 130), cd: 0, wander: this.rng.range(0, 6), hp: 260, dead: false
    };
    p.proxy = {
      pos: p.pos, colony: { id: -9, color: [0.2, 0.1, 0.1], isPlayer: false },
      def: { scale: 1.6, dmg: 26 }, isDead: function () { return p.dead; },
      hit: function (d) { p.hp -= d; if (p.hp <= 0) p.dead = true; },
      node: null, edge: null, mode: 'surface', farm: farm
    };
    this.predators.push(p);
    var owner = null;
    for (var i = 0; i < this.colonies.length; i++) if (this.colonies[i].id === farm.owner) owner = this.colonies[i];
    if (owner && owner.isPlayer) {
      this.ui.notify('A wolf spider has entered ' + farm.name, true);
      this.audio.play('alert');
    }
  };

  // ------------------------------------------------------------------
  //  RANDOM EVENTS
  // ------------------------------------------------------------------
  Game.randomEvent = function () {
    var roll = this.rng.next();
    var pf = this.player.farms[0];
    if (!pf) return;
    if (roll < 0.26) {
      // the Hand drops food
      var n = 3 + this.rng.int(4);
      for (var i = 0; i < n; i++) {
        var x = pf.center[0] + this.rng.range(-8, 8);
        var z = pf.center[2] + this.rng.range(-5, 5);
        this.items.push({
          type: this.rng.chance(0.5) ? 'sugar' : 'protein', visual: this.rng.chance(0.5) ? 'sugar' : 'protein',
          pos: v3.create(x, pf.localTop(x, z) + 6, z),
          amount: 44, farm: pf, surface: true, dead: false, claimed: 0,
          rot: this.rng.range(0, 6), scale: 1.25, bob: 0, falling: true
        });
      }
      this.ui.notify('The Keeper drops food into ' + pf.name);
      this.audio.play('splash');
    } else if (roll < 0.44) {
      this.ui.notify('Humidity spike - mould risk rising', true);
      this.player.hygiene = Math.max(0, this.player.hygiene - 0.12);
      for (var f = 0; f < this.player.farms.length; f++) this.player.farms[f].wetness = Math.min(1, this.player.farms[f].wetness + 0.2);
    } else if (roll < 0.58) {
      this.ui.notify('Mineral seam exposed by digging');
      this.player.minerals += 22;
      this.fx.flashScreen(0.12, [0.7, 0.5, 1.0]);
    } else if (roll < 0.72) {
      var drought = 12 + this.rng.range(0, 18);
      this.player.water = Math.max(0, this.player.water - drought);
      this.ui.notify('The substrate dries out - water reserves fall', true);
    } else if (roll < 0.86) {
      this.ui.notify('A swarm of aphids settles on the surface');
      for (var k = 0; k < 5; k++) {
        var ax = pf.center[0] + this.rng.range(-10, 10), az = pf.center[2] + this.rng.range(-6, 6);
        this.items.push({
          type: 'protein', visual: 'protein', pos: v3.create(ax, pf.localTop(ax, az), az),
          amount: 40, farm: pf, surface: true, dead: false, claimed: 0,
          rot: this.rng.range(0, 6), scale: 1.0, bob: 0
        });
      }
    } else {
      this.ui.notify('Tremor! The keeper moved the shelf', true);
      this.fx.shake(0.9);
      this.audio.play('collapse');
      // collapse a random unbuilt tunnel
      for (var q = 0; q < this.world.farms.length; q++) {
        var farm = this.world.farms[q];
        if (farm.biome.mods.collapse > 0 && farm.edges.length > 4 && this.rng.chance(farm.biome.mods.collapse)) {
          var e = farm.edges[this.rng.int(farm.edges.length)];
          if (e.a.type === W.CH.TUNNEL && e.b.type === W.CH.TUNNEL) {
            e.build = 0.25;
            farm.dirty = true;
          }
        }
      }
    }
  };

  AF.Game = Game;
})(window.AF = window.AF || {});

/* =============================================================
   FORMICARIUM :: DEEP COLONY
   world.js - the shelf, the vitrines, the tunnel graph
   ============================================================= */
(function (AF) {
  'use strict';

  var M = AF.M, v3 = M.v3;
  var W = {};

  // MUST match S.SURFACE in shaders.js
  W.surfaceH = function (x, z) {
    var h = 0;
    h += Math.sin(x * 0.35 + 1.3) * 0.55;
    h += Math.sin(z * 0.41 - 0.7) * 0.48;
    h += Math.sin((x * 0.23 + z * 0.19) + 2.1) * 0.75;
    h += Math.sin(x * 0.87 - z * 0.61) * 0.22;
    h += Math.sin(x * 1.7 + z * 1.3 + 0.5) * 0.09;
    return h;
  };

  // ------------------------------------------------------------------
  //  BIOMES
  // ------------------------------------------------------------------
  W.BIOMES = {
    loam: {
      name: 'Garden Loam', short: 'LOAM',
      soilA: [0.156, 0.098, 0.062], soilB: [0.085, 0.055, 0.038], soilTop: [0.24, 0.175, 0.108],
      wetness: 0.45, grain: 1.0, digCost: 1.0, foodRate: 1.0, temp: 22, humid: 0.55,
      glass: [0.72, 0.88, 0.82],
      desc: 'Rich balanced earth. Nothing special, nothing lethal.',
      mods: { digSpeed: 1.0, foodYield: 1.0, disease: 1.0, collapse: 0.0 },
      flora: { grass: 340, leaf: 26, mushroom: 8, pebble: 34 },
      ambient: [0.10, 0.13, 0.11]
    },
    sand: {
      name: 'Sand Vitrine', short: 'SAND',
      soilA: [0.40, 0.315, 0.198], soilB: [0.29, 0.225, 0.140], soilTop: [0.55, 0.455, 0.305],
      wetness: 0.10, grain: 1.45, digCost: 0.65, foodRate: 0.7, temp: 34, humid: 0.15,
      glass: [0.86, 0.86, 0.74],
      desc: 'Digs fast, collapses faster. Water is life here.',
      mods: { digSpeed: 1.5, foodYield: 0.72, disease: 0.55, collapse: 0.55 },
      flora: { grass: 70, leaf: 4, mushroom: 0, pebble: 78 },
      ambient: [0.16, 0.14, 0.10]
    },
    jungle: {
      name: 'Rainforest Tank', short: 'JUNG',
      soilA: [0.148, 0.128, 0.072], soilB: [0.086, 0.080, 0.050], soilTop: [0.185, 0.205, 0.100],
      wetness: 0.95, grain: 0.85, digCost: 1.15, foodRate: 1.55, temp: 27, humid: 0.92,
      glass: [0.62, 0.86, 0.72],
      desc: 'Abundance and rot. Food everywhere, spores everywhere.',
      mods: { digSpeed: 0.85, foodYield: 1.55, disease: 1.9, collapse: 0.1 },
      flora: { grass: 520, leaf: 70, mushroom: 44, pebble: 20 },
      ambient: [0.08, 0.15, 0.09]
    },
    ash: {
      name: 'Volcanic Ash', short: 'ASH',
      soilA: [0.098, 0.086, 0.086], soilB: [0.052, 0.046, 0.048], soilTop: [0.145, 0.128, 0.122],
      wetness: 0.22, grain: 1.25, digCost: 1.3, foodRate: 0.55, temp: 44, humid: 0.20,
      glass: [0.80, 0.72, 0.70],
      desc: 'Mineral-rich and hostile. Research thrives, ants cook.',
      mods: { digSpeed: 0.75, foodYield: 0.55, disease: 0.35, collapse: 0.2, mineral: 2.4, heat: 1.0 },
      flora: { grass: 40, leaf: 2, mushroom: 3, pebble: 96 },
      ambient: [0.20, 0.10, 0.06]
    },
    frost: {
      name: 'Frost Box', short: 'FRST',
      soilA: [0.135, 0.152, 0.178], soilB: [0.078, 0.092, 0.115], soilTop: [0.30, 0.34, 0.40],
      wetness: 0.35, grain: 1.1, digCost: 1.45, foodRate: 0.75, temp: 4, humid: 0.45,
      glass: [0.74, 0.86, 0.96],
      desc: 'Everything is slow. Nothing spoils. Nothing hurries.',
      mods: { digSpeed: 0.62, foodYield: 0.75, disease: 0.3, collapse: 0.0, spoil: 0.25, speed: 0.78 },
      flora: { grass: 130, leaf: 8, mushroom: 2, pebble: 52 },
      ambient: [0.09, 0.12, 0.18]
    },
    rot: {
      name: 'Rotten Log', short: 'ROT',
      soilA: [0.135, 0.088, 0.052], soilB: [0.085, 0.052, 0.030], soilTop: [0.20, 0.135, 0.070],
      wetness: 0.70, grain: 0.75, digCost: 0.9, foodRate: 1.25, temp: 19, humid: 0.75,
      glass: [0.70, 0.82, 0.70],
      desc: 'Soft wood pulp, packed with grubs. And with things that eat grubs.',
      mods: { digSpeed: 1.2, foodYield: 1.25, disease: 1.35, collapse: 0.05, protein: 1.8 },
      flora: { grass: 190, leaf: 40, mushroom: 60, pebble: 16 },
      ambient: [0.12, 0.11, 0.07]
    }
  };

  // ------------------------------------------------------------------
  //  CHAMBER TYPES
  // ------------------------------------------------------------------
  W.CH = {
    TUNNEL: 0, ENTRANCE: 1, THRONE: 2, NURSERY: 3, GRANARY: 4,
    PIT: 11,
    MIDDEN: 5, FUNGUS: 6, BARRACKS: 7, CISTERN: 8, LAB: 9, GATE: 10
  };
  //  `build:true` marks the handful the player is actually offered. The rest
  //  stay in the table so saves, the AI and existing lookups keep working,
  //  they just never appear in the dig menu.
  W.CHAMBERS = [
    { key: 'TUNNEL', name: 'Tunnel', radius: 1.05, cost: 0, build: true, icon: '/', desc: 'A plain passage. Cheap, and every chamber needs one to reach it.' },
    { key: 'ENTRANCE', name: 'Entrance', radius: 1.30, cost: 0, desc: 'Where the colony meets the world.' },
    { key: 'THRONE', name: 'Queen’s Chamber', radius: 2.60, cost: 40, desc: 'The queen lays here. Keep her safe.', glow: [1.0, 0.72, 0.32], light: 1.15 },
    { key: 'NURSERY', name: 'Nursery', radius: 2.15, cost: 22, build: true, icon: '●', desc: 'Eggs grow into ants faster here. Dig one early.', glow: [1.0, 0.86, 0.55], light: 0.85 },
    { key: 'GRANARY', name: 'Pantry', radius: 2.05, cost: 20, build: true, icon: '▲', desc: 'Room for more food, and it keeps longer.', glow: [0.95, 0.78, 0.35], light: 0.60 },
    { key: 'MIDDEN', name: 'Waste Pit', radius: 1.85, cost: 14, build: true, icon: '▼', desc: 'Somewhere to put the rubbish. Keeps the nest clean.', glow: [0.45, 0.70, 0.30], light: 0.40 },
    { key: 'FUNGUS', name: 'Fungus Garden', radius: 2.30, cost: 34, desc: 'Converts leaves into steady food.', glow: [0.55, 0.95, 0.75], light: 0.85 },
    { key: 'BARRACKS', name: 'Guard Post', radius: 2.10, cost: 26, build: true, icon: '⚔', desc: 'Soldiers stationed here hit harder and muster faster.', glow: [1.0, 0.35, 0.25], light: 0.60 },
    { key: 'CISTERN', name: 'Cistern', radius: 1.95, cost: 20, desc: 'Stores water.', glow: [0.45, 0.75, 1.0], light: 0.55 },
    { key: 'LAB', name: 'Alchemy Vault', radius: 2.20, cost: 45, desc: 'Generates research from minerals.', glow: [0.65, 0.45, 1.0], light: 0.95 },
    { key: 'GATE', name: 'Gate House', radius: 1.75, cost: 18, desc: 'Chokepoint for defenders.', glow: [0.9, 0.55, 0.2], light: 0.3 },
    //  A bowl scooped out of the surface. It is carved by the same SDF as the
    //  tunnels, so poured water genuinely runs into it and stays there. It has
    //  no tunnel links, so ants never path through it.
    {
      key: 'PIT', name: 'Water Pit', radius: 2.0, cost: 10, build: true, surface: true, icon: '◡',
      desc: 'Scoop a bowl out of the surface. Pour water in and it gathers here instead of soaking away.'
    }
  ];
  W.BUILDABLE = [];
  for (var _ci = 0; _ci < W.CHAMBERS.length; _ci++) if (W.CHAMBERS[_ci].build) W.BUILDABLE.push(_ci);

  // ------------------------------------------------------------------
  //  FARM
  // ------------------------------------------------------------------
  var nextFarmId = 0;
  function Farm(opts) {
    this.id = nextFarmId++;
    this.name = opts.name;
    this.biomeKey = opts.biome;
    this.biome = W.BIOMES[opts.biome];
    this.center = v3.create(opts.x, opts.y, opts.z);
    this.half = v3.create(opts.w * 0.5, opts.h * 0.5, opts.d * 0.5);
    this.topY = opts.y + opts.h * 0.5 - opts.airGap;
    this.airGap = opts.airGap;
    // The nest is excavated in a thin slab pressed against the front pane,
    // exactly like a real formicarium: every tunnel is cut open by the glass
    // so you look straight into the colony.
    this.digZ = opts.z + opts.d * 0.5 - 0.30;
    this.slabBack = opts.z + opts.d * 0.5 - 1.35;
    this.owner = -1;
    this.contested = 0;

    this.soilA = this.biome.soilA;
    this.soilB = this.biome.soilB;
    this.soilTop = this.biome.soilTop;
    this.wetness = this.biome.wetness;
    this.grainScale = this.biome.grain;
    this.hygiene = 1.0;
    this.mold = 0.0;

    this.sdfMin = v3.create(opts.x - this.half[0], opts.y - this.half[1], opts.z - this.half[2]);
    this.sdfMax = v3.create(opts.x + this.half[0], opts.y + this.half[1], opts.z + this.half[2]);
    this.sdf = null;
    this.dirty = true;

    this.nodes = [];
    this.edges = [];
    this.props = [];
    this.items = [];     // food / resource items on the surface & in chambers
    this.segBuf = new Float32Array(512 * 8);
    this.segCount = 0;
    this.rng = new M.RNG(0x51ed + this.id * 7919);
    this.temp = this.biome.temp;
    this.humid = this.biome.humid;
  }

  Farm.prototype.localTop = function (x, z) {
    return this.topY + W.surfaceH(x - this.center[0], z - this.center[2]);
  };
  // keep excavation inside the visible slab behind the front pane
  Farm.prototype.slabZ = function (rng) {
    var jitter = rng ? rng.next() : 0.35;
    return this.slabBack + (this.digZ - this.slabBack) * (0.35 + jitter * 0.65);
  };
  Farm.prototype.clampSlab = function (p) {
    p[2] = M.clamp(p[2], this.slabBack, this.digZ);
    return p;
  };
  Farm.prototype.inside = function (p, margin) {
    margin = margin || 0;
    return Math.abs(p[0] - this.center[0]) < this.half[0] - margin &&
      Math.abs(p[1] - this.center[1]) < this.half[1] - margin &&
      Math.abs(p[2] - this.center[2]) < this.half[2] - margin;
  };

  Farm.prototype.addNode = function (x, y, z, radius, type) {
    var n = {
      id: this.nodes.length, farm: this, pos: v3.create(x, y, z),
      radius: radius, type: type === undefined ? W.CH.TUNNEL : type,
      links: [], build: 1.0, hp: 100, occupancy: 0, stock: 0,
      pheromone: [0, 0, 0, 0, 0], lastVisit: 0
    };
    this.nodes.push(n);
    this.dirty = true;
    return n;
  };
  Farm.prototype.addEdge = function (a, b, radius, build) {
    for (var i = 0; i < this.edges.length; i++) {
      var e = this.edges[i];
      if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return e;
    }
    var edge = {
      id: this.edges.length, farm: this, a: a, b: b,
      radius: radius || 0.72, build: build === undefined ? 1 : build,
      len: v3.dist(a.pos, b.pos), traffic: 0, pher: new Float32Array(5)
    };
    this.edges.push(edge);
    a.links.push({ node: b, edge: edge });
    b.links.push({ node: a, edge: edge });
    this.dirty = true;
    return edge;
  };
  Farm.prototype.removeEdge = function (edge) {
    var i = this.edges.indexOf(edge);
    if (i < 0) return;
    this.edges.splice(i, 1);
    function strip(n) {
      for (var k = n.links.length - 1; k >= 0; k--) if (n.links[k].edge === edge) n.links.splice(k, 1);
    }
    strip(edge.a); strip(edge.b);
    this.dirty = true;
  };

  Farm.prototype.nearestNode = function (p, filter) {
    var best = null, bd = 1e9;
    for (var i = 0; i < this.nodes.length; i++) {
      var n = this.nodes[i];
      if (n.detached) continue;      // surface pits are not part of the nest
      if (filter && !filter(n)) continue;
      var d = v3.dist2(p, n.pos);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };
  Farm.prototype.findChamber = function (type) {
    for (var i = 0; i < this.nodes.length; i++) if (this.nodes[i].type === type && this.nodes[i].build >= 1) return this.nodes[i];
    return null;
  };
  Farm.prototype.allChambers = function (type) {
    var out = [];
    for (var i = 0; i < this.nodes.length; i++) if (this.nodes[i].type === type && this.nodes[i].build >= 1) out.push(this.nodes[i]);
    return out;
  };

  // pack capsules for the GPU distance-field bake
  //  CPU twin of the bake shader's field: positive in air, negative inside
  //  packed soil. Used for camera collision so the view can never end up
  //  buried in dirt (which makes the raymarch discard and the world look
  //  like it is floating in a void).
  Farm.prototype.soilSDF = function (x, y, z) {
    var dx = Math.abs(x - this.center[0]) - this.half[0];
    var dy = Math.abs(y - this.center[1]) - this.half[1];
    var dz = Math.abs(z - this.center[2]) - this.half[2];
    var ox = Math.max(dx, 0), oy = Math.max(dy, 0), oz = Math.max(dz, 0);
    var dBox = Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(dx, Math.max(dy, dz)), 0);
    var d = Math.max(dBox, y - this.localTop(x, z));
    // carve the tunnels back out
    var buf = this.segBuf, n = this.segCount || 0, dig = 1e9;
    for (var i = 0; i < n; i++) {
      var o = i * 8;
      var ax = buf[o], ay = buf[o + 1], az = buf[o + 2], ra = buf[o + 3];
      var bx = buf[o + 4], by = buf[o + 5], bz = buf[o + 6], rb = buf[o + 7];
      var ex = bx - ax, ey = by - ay, ez = bz - az;
      var px = x - ax, py = y - ay, pz = z - az;
      var ee = ex * ex + ey * ey + ez * ez;
      var t = ee > 1e-6 ? (px * ex + py * ey + pz * ez) / ee : 0;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      var cx = px - ex * t, cy = py - ey * t, cz = pz - ez * t;
      var dd = Math.sqrt(cx * cx + cy * cy + cz * cz) - (ra + (rb - ra) * t);
      if (dd < dig) dig = dd;
    }
    return Math.max(d, -dig);
  };

  Farm.prototype.packSegments = function () {
    var buf = this.segBuf, k = 0, i;
    var maxSeg = 508;
    for (i = 0; i < this.edges.length && k < maxSeg; i++) {
      var e = this.edges[i];
      if (e.build <= 0.001) continue;
      var r = e.radius * Math.min(1, e.build);
      var o = k * 8;
      buf[o] = e.a.pos[0]; buf[o + 1] = e.a.pos[1]; buf[o + 2] = e.a.pos[2]; buf[o + 3] = r;
      buf[o + 4] = e.b.pos[0]; buf[o + 5] = e.b.pos[1]; buf[o + 6] = e.b.pos[2]; buf[o + 7] = r;
      k++;
    }
    for (i = 0; i < this.nodes.length && k < maxSeg; i++) {
      var n = this.nodes[i];
      if (n.build <= 0.001) continue;
      var nr = n.radius * Math.min(1, n.build);
      var q = k * 8;
      buf[q] = n.pos[0]; buf[q + 1] = n.pos[1]; buf[q + 2] = n.pos[2]; buf[q + 3] = nr;
      buf[q + 4] = n.pos[0]; buf[q + 5] = n.pos[1] + 0.001; buf[q + 6] = n.pos[2]; buf[q + 7] = nr;
      k++;
    }
    this.segCount = k;
    return k;
  };

  // A* over the tunnel graph
  Farm.prototype.path = function (from, to) {
    if (!from || !to) return null;
    if (from === to) return [from];
    var open = [from], came = new Map(), gs = new Map(), fs = new Map();
    gs.set(from, 0);
    fs.set(from, v3.dist(from.pos, to.pos));
    var guard = 0;
    while (open.length && guard++ < 4000) {
      var bi = 0, bf = fs.get(open[0]);
      for (var i = 1; i < open.length; i++) {
        var f = fs.get(open[i]);
        if (f < bf) { bf = f; bi = i; }
      }
      var cur = open.splice(bi, 1)[0];
      if (cur === to) {
        var path = [cur];
        while (came.has(cur)) { cur = came.get(cur); path.unshift(cur); }
        return path;
      }
      for (var l = 0; l < cur.links.length; l++) {
        var lk = cur.links[l];
        if (lk.edge.build < 0.35) continue;
        var nb = lk.node;
        var tent = gs.get(cur) + lk.edge.len;
        if (!gs.has(nb) || tent < gs.get(nb)) {
          came.set(nb, cur);
          gs.set(nb, tent);
          fs.set(nb, tent + v3.dist(nb.pos, to.pos));
          if (open.indexOf(nb) < 0) open.push(nb);
        }
      }
    }
    return null;
  };

  // ray vs the tunnel network (for picking) -------------------------
  var _cp = new Float32Array(3);
  Farm.prototype.pickNode = function (ro, rd, maxT) {
    var best = null, bt = maxT || 1e9;
    for (var i = 0; i < this.nodes.length; i++) {
      var n = this.nodes[i];
      var t = raySphere(ro, rd, n.pos, Math.max(n.radius, 0.9));
      if (t > 0 && t < bt) { bt = t; best = n; }
    }
    return best ? { node: best, t: bt } : null;
  };
  function raySphere(ro, rd, c, r) {
    var ox = ro[0] - c[0], oy = ro[1] - c[1], oz = ro[2] - c[2];
    var b = ox * rd[0] + oy * rd[1] + oz * rd[2];
    var cc = ox * ox + oy * oy + oz * oz - r * r;
    var h = b * b - cc;
    if (h < 0) return -1;
    h = Math.sqrt(h);
    var t = -b - h;
    if (t < 0) t = -b + h;
    return t;
  }
  W.raySphere = raySphere;

  // ray vs sculpted soil surface (sphere-trace the analytic height)
  Farm.prototype.pickSurface = function (ro, rd) {
    var t = 0, p = new Float32Array(3);
    var hit = M.rayBox(ro, rd, this.sdfMin, this.sdfMax);
    if (!hit) return null;
    t = Math.max(hit[0], 0.01);
    var tmax = Math.min(hit[1], 500);
    var prev = 1e9;
    for (var i = 0; i < 160 && t < tmax; i++) {
      p[0] = ro[0] + rd[0] * t; p[1] = ro[1] + rd[1] * t; p[2] = ro[2] + rd[2] * t;
      var h = p[1] - this.localTop(p[0], p[2]);
      if (h < 0.02) {
        return { pos: v3.create(p[0], this.localTop(p[0], p[2]), p[2]), t: t };
      }
      var step = Math.max(h * 0.55, 0.09);
      t += step;
      prev = h;
    }
    return null;
  };

  // random point inside a chamber, near the floor
  Farm.prototype.chamberPoint = function (node, rng, out) {
    var r = node.radius * 0.72 * Math.sqrt(rng.next());
    var a = rng.next() * M.TAU;
    out[0] = node.pos[0] + Math.cos(a) * r;
    out[2] = node.pos[2] + Math.sin(a) * r;
    out[1] = node.pos[1] - node.radius * 0.62 + rng.range(0, 0.12);
    return out;
  };

  W.Farm = Farm;

  // ------------------------------------------------------------------
  //  STARTING NEST GENERATOR
  // ------------------------------------------------------------------
  W.seedNest = function (farm, x, z, colonyId) {
    var rng = farm.rng;
    var surfY = farm.localTop(x, farm.digZ);
    var sz = function () { return farm.slabZ(rng); };
    var ent = farm.addNode(x, surfY - 0.30, farm.digZ - 0.45, 1.35, W.CH.ENTRANCE);
    var shaftY = surfY - 3.2;
    var mid = farm.addNode(x + rng.range(-0.6, 0.6), shaftY, sz(), 1.0, W.CH.TUNNEL);
    farm.addEdge(ent, mid, 0.80);
    var deep = farm.addNode(x + rng.range(-1.4, 1.4), shaftY - 3.0, sz(), 1.05, W.CH.TUNNEL);
    farm.addEdge(mid, deep, 0.82);

    var throne = farm.addNode(x + rng.range(-2.0, 2.0), shaftY - 5.6, sz(),
      W.CHAMBERS[W.CH.THRONE].radius, W.CH.THRONE);
    farm.addEdge(deep, throne, 0.88);

    var nurse = farm.addNode(x + rng.range(2.6, 4.6) * (rng.chance(0.5) ? 1 : -1), shaftY - 3.4,
      sz(), W.CHAMBERS[W.CH.NURSERY].radius, W.CH.NURSERY);
    farm.addEdge(deep, nurse, 0.80);

    var gran = farm.addNode(x + rng.range(2.4, 4.4) * (rng.chance(0.5) ? 1 : -1), shaftY - 1.1,
      sz(), W.CHAMBERS[W.CH.GRANARY].radius, W.CH.GRANARY);
    farm.addEdge(mid, gran, 0.78);

    // a starting midden: without one the nest fouls itself within a day
    var midden = farm.addNode(x + rng.range(3.0, 5.0) * (gran.pos[0] > x ? -1 : 1), shaftY - 6.4,
      sz(), W.CHAMBERS[W.CH.MIDDEN].radius, W.CH.MIDDEN);
    farm.addEdge(deep, midden, 0.76);

    farm.owner = colonyId;
    return { entrance: ent, throne: throne, nursery: nurse, granary: gran, deep: deep, mid: mid };
  };

  // ------------------------------------------------------------------
  //  SHELF LAYOUT
  // ------------------------------------------------------------------
  //  ONE tank. The game is a single formicarium on a desk, not a shelf of
  //  six: everything the player needs is in one frame, and the camera never
  //  has to travel. Wide enough that your nest and the rival's are both
  //  visible without scrolling.
  W.buildShelf = function (world, opts) {
    var FW = 54, FH = 23, FD = 17, AIR = 5.4;
    var biome = (opts && opts.biome) || 'loam';
    var f = new Farm({
      name: 'THE FORMICARIUM', biome: biome,
      x: 0, y: 0, z: 0, w: FW, h: FH, d: FD, airGap: AIR
    });
    f.gridX = 0; f.gridY = 0;
    world.farms = [f];
    world.shelfWidth = FW;
    world.shelfHeight = FH;
    return world.farms;
  };

  // ------------------------------------------------------------------
  //  INTER-FARM LINKS (glass tubes)
  // ------------------------------------------------------------------
  W.canLink = function (a, b) {
    if (a === b) return false;
    var dx = Math.abs(a.gridX - b.gridX), dy = Math.abs(a.gridY - b.gridY);
    return (dx + dy) === 1;
  };
  W.makeLink = function (world, a, b) {
    for (var i = 0; i < world.links.length; i++) {
      var L = world.links[i];
      if ((L.a === a && L.b === b) || (L.a === b && L.b === a)) return L;
    }
    // pick the nearest surface entrances (or create ports)
    var pa = W.portNode(a, b);
    var pb = W.portNode(b, a);
    var link = { a: a, b: b, pa: pa, pb: pb, build: 0, hp: 100, id: world.links.length };
    var e = {
      id: -1, farm: null, a: pa, b: pb, radius: 0.62, build: 0,
      len: v3.dist(pa.pos, pb.pos), traffic: 0, link: link, pher: new Float32Array(5)
    };
    link.edge = e;
    pa.links.push({ node: pb, edge: e });
    pb.links.push({ node: pa, edge: e });
    world.links.push(link);
    return link;
  };
  W.portNode = function (farm, other) {
    // a port sits on the wall of the vitrine facing the other farm
    var dir = [other.center[0] - farm.center[0], other.center[1] - farm.center[1], 0];
    var px, py, pz = farm.digZ;
    if (Math.abs(dir[0]) > Math.abs(dir[1])) {
      px = farm.center[0] + Math.sign(dir[0]) * (farm.half[0] - 0.6);
      py = farm.topY - 2.4;
    } else {
      px = farm.center[0] + (farm.rng.next() - 0.5) * farm.half[0] * 0.5;
      py = farm.center[1] + Math.sign(dir[1]) * (farm.half[1] - 0.7);
    }
    var n = farm.addNode(px, py, pz, 1.05, W.CH.GATE);
    n.isPort = true;
    // wire it into the nest
    var near = farm.nearestNode(n.pos, function (q) { return q !== n && q.build >= 1; });
    if (near) farm.addEdge(n, near, 0.72);
    return n;
  };

  AF.W = W;
})(window.AF = window.AF || {});

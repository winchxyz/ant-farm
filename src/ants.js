/* =============================================================
   FORMICARIUM :: DEEP COLONY
   ants.js - castes, agents, steering, jobs, combat
   ============================================================= */
(function (AF) {
  'use strict';

  var M = AF.M, v3 = M.v3, W = AF.W;
  var A = {};

  // ------------------------------------------------------------------
  //  CASTES
  // ------------------------------------------------------------------
  //  Food units per ant at which the colony is comfortably fed. Above this
  //  share everybody eats their fill; below it the nest goes on short rations
  //  and hunger starts to climb, in proportion to how short it is.
  //
  //  Sized against the observed economy: a healthy colony of thirty runs a
  //  larder in the low hundreds, so 4.0 per ant means rationing begins at
  //  about 120 in store - a long, visible warning slope rather than a wall.
  A.FULL_RATION = 4.0;

  A.C = {
    WORKER: 0, FORAGER: 1, SOLDIER: 2, NURSE: 3, CLEANER: 4,
    SCOUT: 5, MAJOR: 6, QUEEN: 7, ALATE: 8
  };
  A.CASTES = [
    {
      key: 'WORKER', name: 'Worker', glyph: 'W', playable: true,
      hp: 26, dmg: 3, speed: 2.30, dig: 1.0, carry: 9, food: 15, larvaTime: 9,
      scale: 0.52, upkeep: 0.026, mesh: 'ant',
      desc: 'Digs tunnels, hauls dirt, builds chambers. The spine of the colony.'
    },
    {
      key: 'FORAGER', name: 'Forager', glyph: 'F', playable: true,
      hp: 22, dmg: 4, speed: 3.15, dig: 0.35, carry: 15, food: 17, larvaTime: 10,
      scale: 0.50, upkeep: 0.030, mesh: 'ant',
      desc: 'Ranges the surface for food and lays scent trails home.'
    },
    {
      key: 'SOLDIER', name: 'Soldier', glyph: 'S', playable: true,
      hp: 78, dmg: 15, speed: 2.05, dig: 0.25, carry: 4, food: 32, larvaTime: 16,
      scale: 0.66, upkeep: 0.062, mesh: 'soldier',
      desc: 'Oversized mandibles, thick chitin. Exists only to bite.'
    },
    {
      key: 'NURSE', name: 'Nurse', glyph: 'N',
      hp: 24, dmg: 2, speed: 2.10, dig: 0.4, carry: 7, food: 17, larvaTime: 11,
      scale: 0.50, upkeep: 0.028, mesh: 'ant',
      desc: 'Tends brood and heals the wounded. Brood without nurses rots.'
    },
    {
      key: 'CLEANER', name: 'Undertaker', glyph: 'U',
      hp: 28, dmg: 3, speed: 2.35, dig: 0.5, carry: 10, food: 16, larvaTime: 10,
      scale: 0.51, upkeep: 0.026, mesh: 'ant',
      desc: 'Carries corpses and refuse to the midden. Hygiene is survival.'
    },
    {
      key: 'SCOUT', name: 'Scout', glyph: 'C',
      hp: 20, dmg: 5, speed: 3.85, dig: 0.2, carry: 6, food: 18, larvaTime: 10,
      scale: 0.47, upkeep: 0.030, mesh: 'ant',
      desc: 'Fast, fragile, far-seeing. Reveals rival vitrines and incoming raids.'
    },
    {
      key: 'MAJOR', name: 'Major', glyph: 'M',
      hp: 190, dmg: 34, speed: 1.75, dig: 0.2, carry: 2, food: 76, larvaTime: 26,
      scale: 0.92, upkeep: 0.14, mesh: 'soldier',
      desc: 'A siege engine with legs. Requires the Majors doctrine.'
    },
    {
      key: 'QUEEN', name: 'Queen', glyph: 'Q',
      hp: 320, dmg: 8, speed: 0.85, dig: 0, carry: 0, food: 0, larvaTime: 0,
      scale: 1.15, upkeep: 0.10, mesh: 'queen',
      desc: 'Lays every egg the colony will ever have. Irreplaceable.'
    },
    {
      key: 'ALATE', name: 'Alate', glyph: 'A',
      hp: 60, dmg: 6, speed: 3.4, dig: 0, carry: 0, food: 115, larvaTime: 34,
      scale: 0.78, upkeep: 0.085, mesh: 'alate',
      desc: 'Winged princess. Fly her to an empty vitrine to found a second colony.'
    }
  ];

  // ------------------------------------------------------------------
  //  STATES
  // ------------------------------------------------------------------
  //  Only these three are offered to the player; the rest stay defined so
  //  saves and existing lookups keep working.
  A.PLAYABLE = [];
  for (var _pi = 0; _pi < A.CASTES.length; _pi++) if (A.CASTES[_pi].playable) A.PLAYABLE.push(_pi);

  A.ST = {
    IDLE: 0, MOVE: 1, DIG: 2, HAUL: 3, FORAGE: 4, FIGHT: 5,
    TEND: 6, CLEAN: 7, EAT: 8, DEAD: 9, PANIC: 10, BUILD: 11,
    GUARD: 12, RESEARCH: 13, FLY: 14
  };
  A.STNAME = ['idle', 'moving', 'digging', 'hauling', 'foraging', 'fighting',
    'tending brood', 'cleaning', 'feeding', 'dead', 'panicking', 'building',
    'guarding', 'researching', 'flying'];

  // ------------------------------------------------------------------
  //  ANT
  // ------------------------------------------------------------------
  var nextId = 1;
  function Ant(colony, caste, farm, pos) {
    this.id = nextId++;
    this.colony = colony;
    this.caste = caste;
    this.def = A.CASTES[caste];
    this.farm = farm;
    this.pos = v3.create(pos[0], pos[1], pos[2]);
    this.vel = v3.create(0, 0, 0);
    this.yaw = colony.rng.range(0, M.TAU);
    this.pitch = 0; this.roll = 0;
    this.phase = colony.rng.range(0, M.TAU);
    this.walk = 0;
    this.attack = 0;
    this.wing = 0;
    this.maxHp = this.def.hp * colony.mods.hp;
    this.hp = this.maxHp;
    this.speed = this.def.speed * colony.mods.speed;
    this.dmg = this.def.dmg * colony.mods.dmg;
    this.state = A.ST.IDLE;
    this.node = null;
    this.edge = null;
    this.t = 0;
    this.dirSign = 1;
    this.path = null;
    this.pathIdx = 0;
    this.job = null;
    this.carry = null;
    this.carryAmt = 0;
    this.target = null;
    this.attackCd = 0;
    this.age = 0;
    this.lifespan = colony.rng.range(1150, 1900) * (caste === A.C.QUEEN ? 9 : 1);
    this.infected = 0;
    this.hunger = 0;
    this.selected = false;
    this.mode = 'tunnel';
    this.surfGoal = null;
    this.idleTimer = colony.rng.range(0, 2);
    this.lateral = colony.rng.range(-0.55, 0.55);
    this.footClear = 0.03;   // keep the feet a hair inside the tunnel wall
    this.wallAngle = 0;      // where around the tube this ant is standing
    this.upX = 0; this.upY = 1; this.upZ = 0;   // surface normal we stand on
    this.bob = colony.rng.range(0, M.TAU);
    this.sizeVar = colony.rng.range(0.92, 1.09);
    this.glow = 0;
    this.flash = 0;
    this.stuck = 0;
    this.stuckX = 0; this.stuckZ = 0; this.gaveUp = false;
    this.homeNode = null;
    this.linkTravel = null;
  }
  A.Ant = Ant;

  Ant.prototype.isDead = function () { return this.state === A.ST.DEAD; };

  //  Within r of our own queen / throne? Used to decide whether a soldier is
  //  defending home or merely wandering past a stranger.
  Ant.prototype.nearHome = function (r) {
    var c = this.colony;
    var h = c.queenAnt && !c.queenAnt.isDead() ? c.queenAnt.pos
      : (c.home && c.home.throne ? c.home.throne.pos : null);
    if (!h) return true;
    var dx = this.pos[0] - h[0], dy = this.pos[1] - h[1], dz = this.pos[2] - h[2];
    return dx * dx + dy * dy + dz * dz < r * r;
  };

  //  Press the ant onto the real soil surface, whatever direction that
  //  surface happens to lie in.
  //
  //  Solving only for HEIGHT was the mistake: an ant could be at the right y
  //  and still hang in the middle of a tunnel's depth, because nothing ever
  //  constrained z. Projecting along the field gradient fixes contact on every
  //  axis at once - floor, side wall, back wall, the inside of a pit - and it
  //  is continuous, so ants stop snapping between chamber and tunnel rules.
  //
  //  soilSDF is positive in open air, so its gradient points away from the
  //  nearest wall: that vector is exactly the ant's "up".
  var _sg = [0, 0, 0];
  Ant.prototype.stickToSurface = function (dt) {
    var f = this.farm;
    if (!f || this.mode === 'surface') return;
    var p = this.pos;
    //  Hands off near the mouth of the nest. The entrance node sits slightly
    //  BELOW the terrain, so an ant on its way out is climbing - and pressing
    //  it back onto the nearest wall here traps the whole colony underground
    //  and starves it with food lying on the surface.
    if (p[1] > f.localTop(p[0], p[2]) - 0.9) return;

    var d = f.soilSDF(p[0], p[1], p[2]);
    var e = 0.09;
    var gx = f.soilSDF(p[0] + e, p[1], p[2]) - d;
    var gy = f.soilSDF(p[0], p[1] + e, p[2]) - d;
    var gz = f.soilSDF(p[0], p[1], p[2] + e) - d;
    var l = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (l < 1e-6) return;
    gx /= l; gy /= l; gz /= l;

    //  Only ever a small correction. Large ones mean the ant is legitimately
    //  crossing an open shaft, and yanking it to the nearest wall there is
    //  what previously trapped foragers and starved the colony.
    var move = d - this.footClear;
    if (move > 1.6 || move < -0.6) return;
    p[0] -= gx * move;
    p[1] -= gy * move;
    p[2] -= gz * move;
    this.upX = gx; this.upY = gy; this.upZ = gz;
    this.grounded = true;
  };

  //  Hug the surface WITHOUT fighting the path.
  //
  //  The previous attempt pushed each ant straight down the field gradient to
  //  the nearest wall. That gave perfect contact and starved the colony: for
  //  an ant crossing a chamber toward an exit, the nearest wall is behind or
  //  below it, so the correction dragged it backwards off its route and
  //  foragers never reached the surface.
  //
  //  The fix is to strip the component of the correction that lies along the
  //  direction of travel. What is left only ever moves the ant sideways or
  //  down onto the floor it is already walking over - contact on every axis,
  //  and the path is untouched.
  Ant.prototype.hugSurface = function (dt) {
    var f = this.farm;
    if (!f || this.mode === 'surface') return;
    var p = this.pos;
    // the nest mouth is a climb; leave that transition alone
    if (p[1] > f.localTop(p[0], p[2]) - 0.8) return;

    var d = f.soilSDF(p[0], p[1], p[2]);
    var move = d - this.footClear;
    if (move <= 0.02) return;          // already touching
    if (move > 2.2) return;            // genuinely crossing an open shaft

    var e = 0.09;
    var gx = f.soilSDF(p[0] + e, p[1], p[2]) - d;
    var gy = f.soilSDF(p[0], p[1] + e, p[2]) - d;
    var gz = f.soilSDF(p[0], p[1], p[2] + e) - d;
    var l = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (l < 1e-6) return;
    gx /= l; gy /= l; gz /= l;

    // remove the along-heading component
    var tx = Math.sin(this.yaw), tz = Math.cos(this.yaw);
    var dotT = gx * tx + gz * tz;
    gx -= tx * dotT; gz -= tz * dotT;
    var l2 = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (l2 < 1e-4) return;             // the wall is dead ahead: walking into it
    gx /= l2; gy /= l2; gz /= l2;

    // ease in rather than snap, so it never reads as a jump
    var k = Math.min(1, dt * 9) * move;
    p[0] -= gx * k; p[1] -= gy * k; p[2] -= gz * k;
    this.upX = gx; this.upY = gy; this.upZ = gz;
  };

  //  Tilt the body so its up-axis matches the surface it is standing on.
  //  Position alone is not enough: an ant parked correctly on the curved side
  //  of a chamber but held bolt upright has its feet in the air, which is
  //  exactly what "floating" looks like. Derived from the shader's own
  //  Ry(yaw)*Rx(pitch)*Rz(roll) order so the model lands where we intend.
  Ant.prototype.alignTo = function (ux, uy, uz, dt, rate) {
    var l = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (l < 1e-5) return;
    ux /= l; uy /= l; uz /= l;
    var cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    // bring the up-vector into the yaw-local frame
    var lx = cy * ux - sy * uz;
    var ly = uy;
    var lz = sy * ux + cy * uz;
    var roll = Math.asin(M.clamp(-lx, -1, 1));
    var pitch = Math.atan2(lz, Math.max(ly, 1e-4));
    var k = rate || 9;
    this.pitch = M.damp(this.pitch, pitch, k, dt);
    this.roll = M.damp(this.roll, roll, k, dt);
  };

  //  Drop the ant onto whatever floor it is standing over. Any code that
  //  nudges an ant toward a target position must finish with this, or the ant
  //  ends up hovering at the target's height instead of walking on the ground.
  Ant.prototype.settle = function (dt, lambda) {
    var y = null;
    if (this.mode === 'surface') {
      y = this.farm.localTop(this.pos[0], this.pos[2]);
    } else if (!this.edge && this.node) {
      y = this.chamberFloor(this.node, this.pos[0], this.pos[2]);
    }
    if (y !== null) this.pos[1] = M.damp(this.pos[1], y, lambda || 10, dt);
    // and lie against that surface rather than standing upright on a curve
    if (this.mode !== 'surface' && !this.edge && this.node) {
      var n = this.node;
      this.alignTo(n.pos[0] - this.pos[0], n.pos[1] - this.pos[1], n.pos[2] - this.pos[2], dt, 7);
    }
  };

  Ant.prototype.setPath = function (toNode) {
    if (!toNode) return false;
    var from = this.node || (this.edge ? (this.t < 0.5 ? this.edge.a : this.edge.b) : null);
    if (!from) {
      from = this.farm.nearestNode(this.pos);
      if (!from) return false;
      this.node = from;
    }
    //  Already standing on the target. Without this the pathfinder returns
    //  nothing, setPath reports failure, and the ant is left in MOVE with no
    //  path to follow - frozen on the spot forever. This was the "ants get
    //  stuck" bug: nurses assigned to the nursery they were already inside.
    if (from === toNode) {
      this.path = null;
      this.pathIdx = 0;
      this.state = A.ST.MOVE;   // doMove -> followPath -> arrives immediately
      return true;
    }
    if (from.farm !== toNode.farm) {
      var p = A.crossPath(from, toNode);
      if (!p) return false;
      this.path = p;
    } else {
      var path = from.farm.path(from, toNode);
      if (!path) return false;
      this.path = path;
    }
    this.pathIdx = 0;
    this.state = A.ST.MOVE;
    return true;
  };

  // path across linked farms (BFS on the union graph)
  A.crossPath = function (from, to) {
    var open = [from], came = new Map(), seen = new Set([from]);
    var guard = 0;
    while (open.length && guard++ < 6000) {
      var cur = open.shift();
      if (cur === to) {
        var p = [cur];
        while (came.has(cur)) { cur = came.get(cur); p.unshift(cur); }
        return p;
      }
      for (var i = 0; i < cur.links.length; i++) {
        var lk = cur.links[i];
        if (lk.edge.build < 0.35) continue;
        if (seen.has(lk.node)) continue;
        seen.add(lk.node);
        came.set(lk.node, cur);
        open.push(lk.node);
      }
    }
    return null;
  };

  //  Put the ant ON the tunnel wall rather than near its centreline.
  //  A tunnel is a capsule; at parameter t the cross-section is a circle in
  //  the plane perpendicular to the axis. `lateral` picks an angle around
  //  that circle, so 0 walks the floor and +-1 climbs the sides - which is
  //  what makes them read as ants in a burrow instead of floating beads.
  Ant.prototype.edgePos = function (out) {
    var e = this.edge;
    var t = this.t;
    var ax = e.a.pos[0], ay = e.a.pos[1], az = e.a.pos[2];
    var bx = e.b.pos[0], by = e.b.pos[1], bz = e.b.pos[2];
    var dx = bx - ax, dy = by - ay, dz = bz - az;
    var L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= L; dy /= L; dz /= L;

    // "down" projected into the cross-section plane
    var dot = -dy;                       // dot(down, axis) with down = (0,-1,0)
    var px = -dx * dot, py = -1 - dy * dot, pz = -dz * dot;
    var pl = Math.sqrt(px * px + py * py + pz * pz);
    if (pl < 1e-4) {                     // vertical shaft: any perpendicular will do
      px = 1; py = 0; pz = 0;
      var k = dx;
      px -= dx * k; py -= dy * k; pz -= dz * k;
      pl = Math.sqrt(px * px + py * py + pz * pz) || 1;
    }
    px /= pl; py /= pl; pz /= pl;        // unit "down the wall"

    // side vector = axis x down-wall
    var sx = dy * pz - dz * py;
    var sy = dz * px - dx * pz;
    var sz = dx * py - dy * px;

    var r = Math.max(e.radius - this.footClear, 0.04);
    var th = this.lateral * 1.15;        // how far around the tube, radians
    var ct = Math.cos(th), st = Math.sin(th);
    this.wallAngle = th;

    var wx = px * ct + sx * st, wy = py * ct + sy * st, wz = pz * ct + sz * st;
    out[0] = ax + (bx - ax) * t + wx * r;
    out[1] = ay + (by - ay) * t + wy * r;
    out[2] = az + (bz - az) * t + wz * r;
    // the wall pushes back toward the axis: that is the ant's "up"
    this.upX = -wx; this.upY = -wy; this.upZ = -wz;
    return out;
  };

  //  Floor of a spherical chamber at the ant's horizontal offset. Dropping a
  //  fixed fraction of the radius leaves ants hanging in mid-air whenever
  //  they are not dead centre.
  Ant.prototype.chamberFloor = function (n, x, z) {
    var ox = x - n.pos[0], oz = z - n.pos[2];
    var m2 = ox * ox + oz * oz;
    var r = Math.max(n.radius - this.footClear, 0.05);
    var r2 = r * r;
    if (m2 > r2 * 0.92) m2 = r2 * 0.92;
    var y = n.pos[1] - Math.sqrt(r2 - m2);

    //  A nest is overlapping spheres, and this one sphere's floor may have
    //  been hollowed away by its neighbour - so the analytic answer can be a
    //  surface that does not exist, leaving the ant standing on nothing.
    //  Fall from there to the real union surface. Vertical only: touching x/z
    //  here would fight the movement code and strand foragers underground.
    var f = this.farm;
    if (!f) return y;
    var yy = y + 0.30;
    for (var i = 0; i < 14; i++) {
      var d = f.soilSDF(x, yy, z);
      if (d <= this.footClear + 0.015) return yy;
      yy -= Math.min(Math.max(d * 0.85, 0.05), 0.55);
      if (y - yy > 3.5) break;      // open shaft below: keep the analytic guess
    }
    return y;
  };

  var _tmp = new Float32Array(3);
  var _tmp2 = new Float32Array(3);

  Ant.prototype.followPath = function (dt, gs) {
    var speed = this.speed * gs.speedMod * (this.carry ? 0.82 : 1.0);
    if (this.infected) speed *= 0.6;
    var moved = 0;
    var budget = speed * dt;
    var guard = 0;
    while (budget > 0.0001 && guard++ < 6) {
      if (!this.edge) {
        // sitting at a node, pick the next edge from the path
        if (!this.path || this.pathIdx >= this.path.length - 1) {
          this.path = null;
          return true; // arrived
        }
        var cur = this.path[this.pathIdx];
        var nxt = this.path[this.pathIdx + 1];
        var found = null;
        for (var i = 0; i < cur.links.length; i++) {
          if (cur.links[i].node === nxt) { found = cur.links[i].edge; break; }
        }
        if (!found) { this.path = null; this.node = cur; return true; }
        this.edge = found;
        this.dirSign = (found.a === cur) ? 1 : -1;
        this.t = this.dirSign > 0 ? 0 : 1;
        this.node = null;
        this.pathIdx++;
        found.traffic = Math.min(6, found.traffic + 0.35);
      }
      var e = this.edge;
      var len = e.len || 0.001;
      var dtT = budget / len;
      var nt = this.t + dtT * this.dirSign;
      if (this.dirSign > 0 && nt >= 1) {
        budget -= (1 - this.t) * len;
        this.t = 1; this.node = e.b; this.edge = null;
      } else if (this.dirSign < 0 && nt <= 0) {
        budget -= this.t * len;
        this.t = 0; this.node = e.a; this.edge = null;
      } else {
        this.t = nt;
        budget = 0;
      }
      moved = 1;
    }
    // resolve position
    var old0 = this.pos[0], old1 = this.pos[1], old2 = this.pos[2];
    if (this.edge) this.edgePos(this.pos);
    else if (this.node) {
      var n = this.node;
      this.pos[0] = n.pos[0] + Math.cos(this.bob) * n.radius * 0.28;
      this.pos[2] = n.pos[2] + Math.sin(this.bob) * n.radius * 0.28;
      this.pos[1] = this.chamberFloor(n, this.pos[0], this.pos[2]);
    }
    var dx = this.pos[0] - old0, dy = this.pos[1] - old1, dz = this.pos[2] - old2;
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 1e-5) {
      var tgtYaw = Math.atan2(dx, dz);
      this.yaw = M.angleLerp(this.yaw, tgtYaw, Math.min(1, dt * 12));
      var horiz = Math.sqrt(dx * dx + dz * dz);
      this.pitch = M.damp(this.pitch, Math.atan2(dy, horiz + 1e-5), 8, dt);
      this.walk = M.damp(this.walk, 1, 10, dt);
      this.phase += (d / dt) * 3.4 * dt;
    } else {
      this.walk = M.damp(this.walk, 0.12, 6, dt);
      this.phase += dt * 1.4;
    }
    //  Sit against the surface we are actually on: the tunnel wall while
    //  travelling, the sphere of the chamber while inside one.
    if (this.edge) {
      this.alignTo(this.upX, this.upY, this.upZ, dt, 8);
    } else if (this.node) {
      var n = this.node;
      this.alignTo(n.pos[0] - this.pos[0], n.pos[1] - this.pos[1], n.pos[2] - this.pos[2], dt, 8);
    }
    return !this.path;
  };

  // free roaming on the terrarium surface -------------------------
  Ant.prototype.surfaceMove = function (dt, gs, tx, tz, speedMul) {
    var f = this.farm;
    var dx = tx - this.pos[0], dz = tz - this.pos[2];
    var d = Math.sqrt(dx * dx + dz * dz);
    var speed = this.speed * gs.speedMod * (speedMul || 1) * (this.carry ? 0.8 : 1);
    if (d > 0.02) {
      dx /= d; dz /= d;
      // wander noise so trails look organic
      var wob = Math.sin(this.bob + gs.time * 2.4) * 0.30;
      var px = -dz, pz = dx;
      dx += px * wob; dz += pz * wob;
      var l = Math.sqrt(dx * dx + dz * dz) || 1;
      dx /= l; dz /= l;
      var step = Math.min(speed * dt, d);
      this.pos[0] += dx * step;
      this.pos[2] += dz * step;
      // stay inside the tank, but not so far in that nest entrances
      // (which sit right against the front pane) become unreachable
      var hx = f.half[0] - 0.45, hz = f.half[2] - 0.25;
      this.pos[0] = M.clamp(this.pos[0], f.center[0] - hx, f.center[0] + hx);
      this.pos[2] = M.clamp(this.pos[2], f.center[2] - hz, f.center[2] + hz);

      //  Stones are solid for ants too. Surface movement clamped to the
      //  glass and nothing else, so a forager walked straight through a
      //  pebble on its way to a crumb. Pushed out along the line from the
      //  stone's centre, which lets it round the obstacle instead of
      //  sticking to it. Grass stays passable - an ant walks through a tuft.
      var props = f.props;
      if (props) {
        var mySz = this.def.scale * this.sizeVar;
        for (var pi = 0; pi < props.length; pi++) {
          var pr = props[pi];
          if (pr.kind === 'grass') continue;
          var ox = this.pos[0] - pr.x, oz = this.pos[2] - pr.z;
          var od = ox * ox + oz * oz;
          if (od > 9) continue;
          var need = pr.scale * 0.60 + mySz * 0.5;
          if (od >= need * need || od < 1e-6) continue;
          var ol = Math.sqrt(od);
          this.pos[0] = pr.x + ox / ol * need;
          this.pos[2] = pr.z + oz / ol * need;
        }
      }
      this.yaw = M.angleLerp(this.yaw, Math.atan2(dx, dz), Math.min(1, dt * 9));
      this.walk = M.damp(this.walk, 1, 10, dt);
      this.phase += speed * 3.2 * dt;
    } else {
      this.walk = M.damp(this.walk, 0.15, 6, dt);
      this.phase += dt * 1.6;
    }
    //  Workers and foragers keep out of the neighbours' dooryard. Soldiers may
    //  go where they like. Without this, foraging quietly walks the whole
    //  colony past an enemy guard post one ant at a time.
    //  Soldiers stay home too unless the colony is actually raiding. Letting
    //  them drift to the fence fed them one at a time to the enemy guards,
    //  which kept the standing-guard counter permanently unsatisfied.
    var onDuty = this.colony.stance === 'raid' || (this.job && this.job.kind === 'attack');
    if (!onDuty && AF.Game.pushOutOfEnemy) {
      if (AF.Game.pushOutOfEnemy(this.colony, this.pos, 9)) {
        this.surfGoal = null;   // that destination is off limits, pick another
      }
    }
    var y0 = f.localTop(this.pos[0], this.pos[2]);
    this.pos[1] = M.damp(this.pos[1], y0, 22, dt);
    var e = 0.4;
    var hpx = f.localTop(this.pos[0] + Math.sin(this.yaw) * e, this.pos[2] + Math.cos(this.yaw) * e);
    this.pitch = M.damp(this.pitch, Math.atan2(hpx - y0, e), 8, dt);
    var hrx = f.localTop(this.pos[0] + Math.cos(this.yaw) * e, this.pos[2] - Math.sin(this.yaw) * e);
    this.roll = M.damp(this.roll, -Math.atan2(hrx - y0, e), 8, dt);
    // arrival is tested AFTER the step, and generously, so wander noise
    // can never leave an ant orbiting its destination forever
    //
    //  PER JOURNEY, NOT PER LIFETIME. The stuck counter used to accumulate
    //  across every surface trip an ant ever made and was cleared only when
    //  it fired, so after roughly 26 seconds of total walking it declared a
    //  false arrival wherever the ant happened to be standing. Measured over
    //  four sim-minutes: 17 of 154 foraging pickups happened at range, the
    //  worst from 35.7 units away - two thirds of the tank - with the food
    //  simply teleporting into the ant.
    if (this.stuckX !== tx || this.stuckZ !== tz) {
      this.stuckX = tx; this.stuckZ = tz; this.stuck = 0;
    }
    var ax = tx - this.pos[0], az = tz - this.pos[2];
    if (ax * ax + az * az <= 0.42) { this.stuck = 0; this.gaveUp = false; return true; }
    this.stuck += dt;
    if (this.stuck > 26) {
      //  Genuinely cannot get there. Still report arrival so the caller
      //  unwinds instead of freezing - that safety net is the reason an
      //  unreachable SURFACE goal never wedges an ant, unlike the tunnel
      //  handlers - but flag it, so a caller that acts on the ant's POSITION
      //  rather than merely on its arrival can decline.
      this.stuck = 0; this.gaveUp = true; return true;
    }
    this.gaveUp = false;
    return false;
  };

  // ------------------------------------------------------------------
  //  COMBAT
  // ------------------------------------------------------------------
  //  Break off and run for home. Used when a scuffle goes badly rather than
  //  letting the loser stand there and be killed.
  Ant.prototype.flee = function (src) {
    this.target = null;
    this.flash = 1;
    //  Keep the job. Clearing it made every driven-off forager abandon its
    //  errand, foraging stalled colony-wide, and the colony starved instead
    //  of simply losing a bit of time to the detour.
    var home = this.colony.queenAnt && !this.colony.queenAnt.isDead()
      ? this.colony.queenAnt.pos
      : (this.homeNode ? this.homeNode.pos : null);
    if (this.mode === 'surface' && home) {
      this.surfGoal = [home[0], home[2]];
      this.state = A.ST.MOVE;
    } else if (this.homeNode) {
      if (!this.setPath(this.homeNode)) this.state = A.ST.IDLE;
    } else this.state = A.ST.IDLE;
  };

  Ant.prototype.hit = function (dmg, src, game) {
    if (this.state === A.ST.DEAD) return;
    var armour = this.colony.mods.armour;
    if (this.node && this.node.type === W.CH.GATE) armour *= 1.6;

    //  Border scuffles are not fights to the death. A guard defending its own
    //  doorstep drives a stray worker off; it does not execute it. Only an
    //  actual raid is lethal. Without this the two colonies quietly grind
    //  each other down at the fence and a passive colony bleeds out by day 6.
    //  Predators are exempt: this rule is about colony border friction, and a
    //  hunting animal is not a scuffle you can be driven off from.
    var skirmish = src && src.colony && src.colony !== this.colony &&
      !src.colony.predator &&
      src.colony.stance !== 'raid' &&
      this.caste !== A.C.SOLDIER && this.caste !== A.C.MAJOR;
    if (skirmish) {
      dmg *= 0.30;
      var floor = this.maxHp * 0.22;
      if (this.hp - dmg / armour < floor) {
        this.hp = floor;
        this.flee(src);
        return;
      }
    }

    this.hp -= dmg / armour;
    this.flash = 1;
    if (src) {
      this.target = src;
      if (this.state !== A.ST.FIGHT) this.state = A.ST.FIGHT;
    }
    if (this.hp <= 0) {
      if (src && src.colony && src.colony !== this.colony) src.colony.kills++;
      this.die(game, 'combat');
    }
  };

  Ant.prototype.die = function (game, cause) {
    if (this.state === A.ST.DEAD) return;
    this.state = A.ST.DEAD;
    this.deadTimer = 0;
    this.colony.onDeath(this, cause);
    //  DROP THE LOAD.
    //
    //  die() used to walk away from this.carry entirely, and whatever was in
    //  the jaws ceased to exist. Both halves were already committed by then:
    //  a corpse is spliced out of game.corpses the tick after `removed` is
    //  set (game.js), and a forager's share is subtracted from the carcass at
    //  pickup - so a hauler killed in transit destroyed a whole body, or one
    //  full carry-load of meat, with nothing left on the ground to show for
    //  it. That is the common case, not a corner: the spider that made the
    //  carcass is usually still alive and hunting the very ants walking to it.
    //
    //  Whatever it held goes back into the world where it fell.
    if (game && this.carry) {
      if (this.carry === 'corpse') {
        var body = this.job && this.job.corpse ? this.job.corpse : null;
        //  Revive the record rather than minting a new one, so the body keeps
        //  its own size, colony and age. Guard against the ant dying on the
        //  same frame it lifted, before the world tick has spliced it.
        if (body && game.corpses.indexOf(body) < 0) {
          body.removed = false; body.taken = false; body.claimed = 0;
          body.pos[0] = this.pos[0]; body.pos[1] = this.pos[1]; body.pos[2] = this.pos[2];
          body.farm = this.farm; body.node = this.node;
          body.surface = this.mode === 'surface';
          game.corpses.push(body);
        }
      } else if (this.carryAmt > 0) {
        game.items.push({
          type: this.carry, visual: this.carry,
          pos: v3.clone(this.pos), amount: this.carryAmt,
          farm: this.farm, surface: this.mode === 'surface',
          dead: false, claimed: 0,
          rot: this.yaw, scale: 1, bob: 0
        });
      }
      this.carry = null; this.carryAmt = 0;
    }
    if (game) {
      game.fx.burst(this.pos, 10, 'gore', this.colony.color);
      game.corpses.push({
        pos: v3.clone(this.pos), yaw: this.yaw, farm: this.farm,
        node: this.node, caste: this.caste, colony: this.colony,
        //  Record where it died, the way an item records it. A height test
        //  against topY cannot work: topY is a scalar but the ground is
        //  topY + surfaceH, which swings +/-2.09, and the nest mouths sit on
        //  HIGH ground - so a plane at topY-1.2 threw away every body in the
        //  entrance chamber, the busiest node in the game.
        surface: this.mode === 'surface',
        age: 0, taken: false, scale: this.def.scale * this.sizeVar
      });
    }
  };

  // ------------------------------------------------------------------
  //  MAIN UPDATE
  // ------------------------------------------------------------------
  Ant.prototype.update = function (dt, game) {
    if (this.state === A.ST.DEAD) return;
    var gs = game.sim;
    this.age += dt;
    this.flash = Math.max(0, this.flash - dt * 3.5);
    this.attack = M.damp(this.attack, this.state === A.ST.FIGHT ? 1 : 0, 8, dt);
    this.attackCd -= dt;

    // ---- ageing & hunger ----
    if (this.age > this.lifespan) { this.die(game, 'age'); return; }
    //  Trophallaxis, but RATIONED.
    //
    //  The old test was binary on the colony's whole larder: with more than
    //  half a unit in store every ant was perfectly fed, and the moment it
    //  fell below, every ant in the nest began starving in the same frame at
    //  the same rate. There was no gradient to thin along, so a colony that
    //  outgrew its stores did not decline - it fell off a cliff. Measured:
    //  thirty-one ants dead in a single day, out of thirty-three.
    //
    //  Ration by the share available per ant instead. A comfortable larder
    //  still feeds everyone exactly as before. A thin one feeds them only
    //  partly, so hunger creeps up, the hungriest die first, and each death
    //  lifts the share for the rest. The colony settles at the size its food
    //  can actually carry rather than overshooting and collapsing.
    var share = this.colony.food() / Math.max(1, this.colony.population());
    var fed = M.clamp(share / A.FULL_RATION, 0, 1);
    if (fed >= 0.999) {
      this.hunger = Math.max(0, this.hunger - dt * 0.22);
    } else {
      //  partial feeding pulls hunger down, the shortfall pushes it up
      this.hunger -= dt * 0.22 * fed;
      this.hunger += dt * 0.055 * (this.def.upkeep / 0.03) * (1 - fed);
      if (this.hunger < 0) this.hunger = 0;
      if (this.hunger > 1) {
        this.hp -= dt * 2.4 * (this.hunger - 1);
        if (this.hp <= 0) { this.die(game, 'starvation'); return; }
      }
    }
    if (this.infected > 0) {
      this.infected += dt * 0.028;
      this.hp -= dt * 0.42;
      if (this.infected > 3.2) { this.die(game, 'fungus'); return; }
      if (this.hp <= 0) { this.die(game, 'fungus'); return; }
    }
    if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + dt * 0.35 * this.colony.mods.regen);

    // ---- environment damage ----
    var bio = this.farm.biome.mods;
    if (bio.heat && this.mode === 'surface') this.hp -= dt * 0.9;

    // ---- threat acquisition, before anything else ----
    //  Both colonies share one tank, so if every ant with mandibles picked a
    //  fight on sight the two nests would grind each other to nothing on the
    //  surface. Only soldiers start fights, and only while defending home or
    //  actually on a raid; workers and foragers walk on by.
    //  Soldiers range further and will march out on a raid. Everyone else
    //  only swings at an intruder that has come into the nest - so the two
    //  colonies do not grind each other down out on the surface, but a raid
    //  still meets the whole colony rather than walking in unopposed.
    var big = this.caste === A.C.SOLDIER || this.caste === A.C.MAJOR;
    var defending = this.nearHome(big ? 8 : 6);
    var mayEngage = this.def.dmg > 2 && (defending || (big && this.colony.stance === 'raid'));
    if (mayEngage && this.state !== A.ST.FLY && (game.frame + this.id) % 6 === 0) {
      if (!this.target || this.target.isDead()) {
        var foe = game.findEnemyNear(this, big ? 6.5 : 3.0);
        if (foe) {
          this.target = foe;
          this.state = A.ST.FIGHT;
          if (big && this.colony.isPlayer && !this.colony._alerted) {
            this.colony._alerted = 1;
            this.colony.notify.push({ t: 0, msg: 'Enemies in the nest!', bad: true });
          }
        }
      }
    }

    // ---- behaviour ----
    switch (this.state) {
      case A.ST.IDLE: this.doIdle(dt, game); break;
      case A.ST.MOVE: this.doMove(dt, game); break;
      case A.ST.DIG: this.doDig(dt, game); break;
      case A.ST.HAUL: this.doHaul(dt, game); break;
      case A.ST.FORAGE: this.doForage(dt, game); break;
      case A.ST.FIGHT: this.doFight(dt, game); break;
      case A.ST.TEND: this.doTend(dt, game); break;
      case A.ST.CLEAN: this.doClean(dt, game); break;
      case A.ST.GUARD: this.doGuard(dt, game); break;
      case A.ST.RESEARCH: this.doResearch(dt, game); break;
      case A.ST.FLY: this.doFly(dt, game); break;
      case A.ST.PANIC: this.doPanic(dt, game); break;
      default: this.state = A.ST.IDLE;
    }

    //  Contact first, then orientation - both from the same field, so the two
    //  can never disagree. Done here rather than per-behaviour because idle,
    //  digging, tending and fighting ants all need it too.
    //  Orientation only. An earlier version also re-projected the body onto
    //  the soil field every frame; it fixed contact but pinned foragers
    //  underground at the nest mouth and starved the colony with food lying
    //  on the surface. Placement stays with edgePos / chamberFloor, which
    //  measure correct to 0.03 units.
    //  NOTE: pressing every ant onto the nearest wall each frame (see
    //  stickToSurface) gives flawless contact - median gap 0.03, zero
    //  floaters - and reliably starves the colony: it interferes with
    //  traversal, foragers never reach the surface, and population goes
    //  34 -> 3 by day 2. Measured twice. Doing it properly needs pathing
    //  that walks along surfaces instead of between node centres, so for now
    //  placement stays analytic and only orientation comes from the field.
    if (this.mode !== 'surface') {
      if (!this.edge && this.node) {
        var an = this.node;
        this.upX = an.pos[0] - this.pos[0];
        this.upY = an.pos[1] - this.pos[1];
        this.upZ = an.pos[2] - this.pos[2];
      }
      this.hugSurface(dt);
      this.alignTo(this.upX, this.upY, this.upZ, dt, 9);
    }

    //  No teleporting. Handing off between two tunnels, or between a tunnel
    //  and a chamber, recomputes the body position from scratch and could
    //  fling an ant a couple of centimetres across the nest in a single frame.
    //  Anything faster than an ant can actually walk gets eased instead.
    if (this._px !== undefined && !this.warp) {
      var jx = this.pos[0] - this._px, jy = this.pos[1] - this._py, jz = this.pos[2] - this._pz;
      var jd = Math.sqrt(jx * jx + jy * jy + jz * jz);
      var lim = Math.max(this.speed * 2.2 * dt, 0.05);
      if (jd > lim) {
        var k = lim / jd;
        this.pos[0] = this._px + jx * k;
        this.pos[1] = this._py + jy * k;
        this.pos[2] = this._pz + jz * k;
      }
    }
    this.warp = false;
    this._px = this.pos[0]; this._py = this.pos[1]; this._pz = this.pos[2];

    //  Never let an ant end a frame outside the glass. The nest slab is
    //  pressed right against the front pane, so chamber and tunnel maths can
    //  legitimately put a body a few millimetres past it - which on screen is
    //  an ant standing in thin air outside the tank.
    var f = this.farm;
    if (f) {
      //  Margin covers the BODY, not just the origin: clamping the origin to
      //  the pane still let half an ant hang outside the glass.
      //  X and Y get a body-width margin. Z does NOT: the nest slab is dug
      //  deliberately hard against the front pane, so a fat Z margin fights
      //  every node in the colony.
      var body = this.def.scale * this.sizeVar * 0.55;
      var mz = f.half[2] - 0.10, mx = f.half[0] - body, my = f.half[1] - body;
      this.pos[0] = M.clamp(this.pos[0], f.center[0] - mx, f.center[0] + mx);
      this.pos[1] = M.clamp(this.pos[1], f.center[1] - my, f.center[1] + my);
      this.pos[2] = M.clamp(this.pos[2], f.center[2] - mz, f.center[2] + mz);
    }

    // pheromone deposition
    if ((game.frame + this.id) % 5 === 0 && this.edge) {
      var pt = this.carry ? 0 : (this.state === A.ST.FIGHT ? 1 : 2);
      this.edge.pher[pt] = Math.min(4, this.edge.pher[pt] + 0.10);
    }
  };

  // ---- states -------------------------------------------------------
  Ant.prototype.doIdle = function (dt, game) {
    this.walk = M.damp(this.walk, 0.18, 5, dt);
    this.phase += dt * 1.5;
    this.idleTimer -= dt;
    if (this.mode === 'surface') {
      this.surfaceMove(dt, game.sim,
        this.pos[0] + Math.sin(this.bob + game.sim.time * 0.7) * 2.0,
        this.pos[2] + Math.cos(this.bob * 1.7 + game.sim.time * 0.6) * 2.0, 0.4);
    } else if (this.node) {
      // milling about inside the chamber
      this.bob += dt * 0.7;
      var n = this.node;
      var r = n.radius * 0.55;
      var tx = n.pos[0] + Math.cos(this.bob) * r;
      var tz = n.pos[2] + Math.sin(this.bob * 1.3) * r;
      this.pos[0] = M.damp(this.pos[0], tx, 2.5, dt);
      this.pos[2] = M.damp(this.pos[2], tz, 2.5, dt);
      this.pos[1] = M.damp(this.pos[1], this.chamberFloor(n, this.pos[0], this.pos[2]), 6, dt);
      this.yaw = M.angleLerp(this.yaw, this.bob + Math.PI * 0.5, dt * 2);
      this.walk = M.damp(this.walk, 0.45, 4, dt);
    }
    if (this.idleTimer <= 0) {
      this.idleTimer = game.rng.range(0.6, 2.2);
      this.colony.assignJob(this, game);
    }
  };

  Ant.prototype.doMove = function (dt, game) {
    if (this.mode === 'surface' && this.surfGoal) {
      var done = this.surfaceMove(dt, game.sim, this.surfGoal[0], this.surfGoal[1]);
      if (done) { this.surfGoal = null; this.onArrive(game); }
      return;
    }
    //  Catch-all: MOVE with nothing to move along is a dead end. Resolve the
    //  job now rather than standing still until the heat death of the colony.
    if (!this.path && !this.edge) { this.onArrive(game); return; }
    var arrived = this.followPath(dt, game.sim);
    if (arrived) this.onArrive(game);
  };

  Ant.prototype.onArrive = function (game) {
    var j = this.job;
    if (!j) { this.state = A.ST.IDLE; return; }
    switch (j.kind) {
      // reached the entrance on the way OUT: step onto the surface
      case 'exitNest': {
        //  Climb out, do not teleport out. Snapping straight to the terrain
        //  top was a ~2 unit jump - the visible pop at the nest mouth. The
        //  ant keeps its own x/z, and surfaceMove walks its height up to the
        //  surface over the next few frames; leaving `warp` unset lets the
        //  movement clamp hold it to walking pace.
        this.mode = 'surface';
        this.edge = null; this.path = null;
        var e = j.node;
        this.pos[0] += (e.pos[0] - this.pos[0]) * 0.35;
        this.pos[2] += (e.pos[2] - this.pos[2]) * 0.35;
        this.node = e;
        if (j.item && !j.item.dead) { this.job = { kind: 'forage', item: j.item }; this.state = A.ST.FORAGE; }
        else { this.job = null; this.state = A.ST.IDLE; }
        return;
      }
      // reached the entrance on the way IN: dive back into the tunnels
      case 'enterNest': {
        //  Walk in, do not blink in. Snapping to the entrance chamber's floor
        //  was a jump of up to ~22 units for an ant arriving from across the
        //  tank - by far the most visible teleport in the game. Ease toward
        //  the mouth and let the movement clamp carry the rest at walking
        //  pace; `warp` deliberately stays unset.
        this.mode = 'tunnel';
        this.surfGoal = null;
        var n = j.node;
        this.node = n; this.edge = null; this.path = null;
        this.pos[0] += (n.pos[0] - this.pos[0]) * 0.4;
        this.pos[2] += (n.pos[2] - this.pos[2]) * 0.4;
        this.pos[1] = M.damp(this.pos[1], this.chamberFloor(n, this.pos[0], this.pos[2]), 6, 0.2);
        if (this.carry) {
          var st = this.colony.storeFor(this.carry, this.farm);
          this.job = { kind: 'haul', store: st, item: null };
          if (st && this.setPath(st)) return;
          this.deliverHere(game);
        } else { this.job = null; this.state = A.ST.IDLE; }
        return;
      }
      case 'dig': this.state = A.ST.DIG; break;
      case 'build': this.state = A.ST.DIG; break;
      case 'haul': this.state = A.ST.HAUL; break;
      case 'forage': this.state = A.ST.FORAGE; break;
      case 'tend': this.state = A.ST.TEND; break;
      case 'clean': this.state = A.ST.CLEAN; break;
      case 'guard': this.state = A.ST.GUARD; break;
      case 'research': this.state = A.ST.RESEARCH; break;
      case 'attack': this.state = A.ST.FIGHT; break;
      default: this.state = A.ST.IDLE; this.job = null;
    }
  };

  Ant.prototype.doDig = function (dt, game) {
    var j = this.job;
    if (!j || (!j.edge && !j.node)) { this.state = A.ST.IDLE; this.job = null; return; }
    var tgt = j.edge ? j.edge : j.node;
    var face = j.edge ? midOf(j.edge) : j.node.pos;
    // The excavation face is by definition unreachable - there is no tunnel
    // there yet. Ants work from the nearest EXCAVATED node and burrow in.
    var stand = j.edge ? j.edge.a : nearestBuiltNeighbour(j.node);
    if (j.edge && j.edge.b.build >= 1 && j.edge.a.build < 1) stand = j.edge.b;
    //  The working range has to cover the whole creep: as the dig progresses
    //  the ant advances toward the face, and with a plain `radius + 1.8` it
    //  eventually steps 2cm outside its own range, stops digging, and cannot
    //  path back (it is already standing on `stand`). The room then sticks
    //  forever at ~0.97 while diggers pile up on it.
    var dStand = v3.dist(this.pos, stand.pos);
    var reach = stand.radius + 1.8 + v3.dist(stand.pos, face) * 0.9;
    if (dStand > reach) {
      if (!this.path) {
        //  setPath returns TRUE for "you are already on that node" without
        //  producing a path, and a digger's body can be well away from the
        //  node it nominally occupies. followPath then does nothing for ever.
        //  followPath only does nothing when path AND edge are both null -
        //  with an edge set it walks the tunnel normally. Testing path alone
        //  cancelled the job of an ant that was moving perfectly well. Same
        //  predicate doMove's own catch-all uses.
        if (!this.setPath(stand) || (!this.path && !this.edge)) { this.state = A.ST.IDLE; this.job = null; return; }
      }
      this.followPath(dt, game.sim);
      return;
    }
    // creep from the standing node toward the face as the dig progresses
    var prog = M.saturate(tgt.build);
    var wx = stand.pos[0] + (face[0] - stand.pos[0]) * prog * 0.85;
    var wz = stand.pos[2] + (face[2] - stand.pos[2]) * prog * 0.85;
    this.pos[0] = M.damp(this.pos[0], wx + Math.cos(this.bob) * 0.35, 3.5, dt);
    this.pos[2] = M.damp(this.pos[2], wz + Math.sin(this.bob) * 0.25, 3.5, dt);
    // stand on the chamber floor beneath us, never between two centres
    this.pos[1] = M.damp(this.pos[1],
      this.chamberFloor(stand, this.pos[0], this.pos[2]), 4.0, dt);
    this.yaw = M.angleLerp(this.yaw, Math.atan2(face[0] - this.pos[0], face[2] - this.pos[2]), dt * 4);
    this.bob += dt * 1.3;
    var anchor = face;
    this.walk = M.damp(this.walk, 0.55, 5, dt);
    this.phase += dt * 7.0;
    this.attack = M.damp(this.attack, 0.75, 5, dt);
    var rate = dt * 0.09 * this.def.dig * this.colony.mods.dig * this.farm.biome.mods.digSpeed;
    tgt.build = Math.min(1, tgt.build + rate);
    this.farm.dirty = true;
    if (game.rng.chance(dt * 7)) game.fx.burst(anchor, 1, 'dirt', this.farm.soilTop);
    this.colony.biomass += rate * (j.edge ? 3 : 6);
    if (tgt.build >= 1) {
      this.colony.onBuilt(tgt, j, game);
      this.job = null;
      this.state = A.ST.IDLE;
    }
  };

  function midOf(e) {
    return [(e.a.pos[0] + e.b.pos[0]) * 0.5, (e.a.pos[1] + e.b.pos[1]) * 0.5, (e.a.pos[2] + e.b.pos[2]) * 0.5];
  }
  function nearestBuiltNeighbour(node) {
    for (var i = 0; i < node.links.length; i++) if (node.links[i].node.build >= 1) return node.links[i].node;
    return node;
  }

  Ant.prototype.doHaul = function (dt, game) {
    var j = this.job;
    if (!j) { this.state = A.ST.IDLE; return; }
    if (!this.carry) {
      // go pick it up
      var item = j.item;
      if (!item || item.taken || item.amount <= 0) { this.job = null; this.state = A.ST.IDLE; return; }
      //  Horizontal, for the same reason the undertaker's test is: the mover
      //  only steers in X/Z and settle() owns Y, so a crumb resting on the
      //  chamber floor keeps a vertical gap the hauler can never close.
      var _hx = this.pos[0] - item.pos[0], _hz = this.pos[2] - item.pos[2];
      var d = Math.sqrt(_hx * _hx + _hz * _hz);
      if (d < 0.9 && Math.abs(this.pos[1] - item.pos[1]) < 1.6) {
        this.carry = item.type;
        this.carryAmt = Math.min(this.def.carry * this.colony.mods.carry, item.amount);
        item.amount -= this.carryAmt;
        //  A heap entry is only a handle on the height field. Without taking
        //  the same amount back OUT of the field, publishHeapFood simply
        //  republishes it a third of a second later and the pile becomes an
        //  infinite sugar dispenser that never visibly shrinks.
        if (item.heap && AF.Game.takeFromHeap) {
          AF.Game.takeFromHeap(item.pos[0], item.pos[2], this.carryAmt);
        }
        if (item.amount <= 0.01) { item.dead = true; }
        item.taken = false;
        var store = this.colony.storeFor(item.type, this.farm);
        if (!store) { this.deliverHere(game); return; }
        j.store = store;
        this.setPath(store);
        this.state = A.ST.MOVE;
      } else {
        if (!this.path && !this.setPath(item.node || this.farm.nearestNode(item.pos))) { this.job = null; this.state = A.ST.IDLE; return; }
        var done = this.followPath(dt, game.sim);
        if (done) {
          // shuffle the last stretch
          this.pos[0] = M.damp(this.pos[0], item.pos[0], 6, dt);
          this.pos[2] = M.damp(this.pos[2], item.pos[2], 6, dt);
          this.settle(dt, 8);
        }
      }
      return;
    }
    // carrying: walk to store
    var st = j.store;
    if (!st) { this.deliverHere(game); return; }
    var dd = v3.dist(this.pos, st.pos);
    //  A FLOOR'S WORTH OF SLACK - the same fix doTend already carries.
    //
    //  An ant stands on the chamber floor, a full radius below the centre, so
    //  `dd < radius * 0.9` is not merely tight, it is unreachable: the test
    //  can never pass for an ant that is standing inside its own granary.
    //  Measured on a stuck hauler: node IS the store, distance 2.01, threshold
    //  1.84. It had been holding its load for eighteen seconds.
    if (dd < st.radius + 1.0) { this.deliverHere(game); return; }
    if (!this.path) {
      //  setPath returns TRUE for "you are already there" without producing a
      //  path. followPath then does nothing, !this.path is true again next
      //  frame, and the ant loops on the spot for ever holding the colony's
      //  food. Treat a pathless success as arrival.
      if (!this.setPath(st) || (!this.path && !this.edge)) { this.deliverHere(game); return; }
    }
    this.followPath(dt, game.sim);
  };

  Ant.prototype.deliverHere = function (game) {
    if (this.carry) {
      this.colony.deposit(this.carry, this.carryAmt, game);
      game.fx.burst(this.pos, 4, 'sparkle', [1.0, 0.85, 0.4]);
      this.carry = null; this.carryAmt = 0;
    }
    this.job = null;
    this.state = A.ST.IDLE;
  };

  Ant.prototype.doForage = function (dt, game) {
    var j = this.job;
    if (!j || !j.item || j.item.dead) {
      if (this.carry) { this.returnHome(game); return; }
      var next = game.findForageTarget(this.colony, this);
      if (next) { this.job = { kind: 'forage', item: next }; next.claimed = this.id; return; }
      this.returnHome(game); return;
    }
    var item = j.item;
    this.mode = 'surface';   // already outside: not a relocation
    var reached = this.surfaceMove(dt, game.sim, item.pos[0], item.pos[2]);
    if (reached && this.gaveUp) {
      //  The walk timed out, the ant is not actually at the food. Drop the
      //  claim so somebody else can try, rather than harvesting at range.
      //  Home via returnHome, not a bare IDLE. Every other exit from doForage
      //  routes through it, and it is what eventually restores mode='tunnel'
      //  at onArrive. Bailing straight to IDLE left the ant flagged 'surface'
      //  underground, where settle() lifts it to the terrain top above a
      //  buried crumb and the haul distance can never close.
      item.claimed = 0;
      this.returnHome(game);
      return;
    }
    if (reached) {
      //  Never write over a load already in the jaws. doHaul has always
      //  guarded its pickup with `if (!this.carry)`; this one did not, and an
      //  ant CAN reach here still carrying - a won fight, a panic timing out,
      //  a player right-click and returnHome with no entrance all drop a
      //  carrying ant to IDLE, and assignJob never looks at ant.carry before
      //  handing out a fresh forage target. The old line then overwrote the
      //  load, and the food already subtracted from the source was gone.
      //  Take what is held home instead; the crumb keeps for the next ant.
      if (this.carry) { item.claimed = 0; this.returnHome(game); return; }
      this.carry = item.type;
      this.carryAmt = Math.min(this.def.carry * this.colony.mods.carry, item.amount);
      item.amount -= this.carryAmt;
      if (item.heap && AF.Game.takeFromHeap) {
        AF.Game.takeFromHeap(item.pos[0], item.pos[2], this.carryAmt);
      }
      if (item.amount <= 0.01) item.dead = true;
      item.claimed = 0;
      game.fx.burst(this.pos, 5, 'sparkle', [1, 0.9, 0.5]);
      game.audio.play('step', this.pos);
      this.returnHome(game);
    }
  };

  Ant.prototype.returnHome = function (game) {
    var ent = this.nearestEntrance();
    if (!ent) { this.state = A.ST.IDLE; this.job = null; return; }
    this.surfGoal = [ent.pos[0], ent.pos[2]];
    this.job = { kind: 'enterNest', node: ent };
    this.mode = 'surface';
    this.state = A.ST.MOVE;
  };

  Ant.prototype.nearestEntrance = function () {
    var best = null, bd = 1e9;
    var farms = this.colony.farms.length ? this.colony.farms : [this.farm];
    for (var f = 0; f < farms.length; f++) {
      var list = farms[f].allChambers(W.CH.ENTRANCE);
      for (var i = 0; i < list.length; i++) {
        var d = v3.dist2(this.pos, list[i].pos);
        if (d < bd) { bd = d; best = list[i]; }
      }
    }
    return best || this.homeNode;
  };

  // send an ant from inside the nest out onto the surface
  Ant.prototype.goForage = function (item) {
    var ent = this.nearestEntrance();
    if (this.mode === 'surface' || !ent) {
      this.mode = 'surface';   // clamped: climbing out is not a teleport
      this.job = { kind: 'forage', item: item };
      this.state = A.ST.FORAGE;
      return true;
    }
    this.job = { kind: 'exitNest', node: ent, item: item };
    if (this.setPath(ent)) return true;
    this.mode = 'surface';
    this.job = { kind: 'forage', item: item };
    this.state = A.ST.FORAGE;
    return true;
  };

  Ant.prototype.doFight = function (dt, game) {
    var foe = this.target;
    if (!foe || (typeof foe.isDead === 'function' && foe.isDead())) {
      this.target = null;
      //  An 'attack' job carries no node when it comes from emergency defence
      //  (colony.js) or from a right-click order (player.js). Winning the
      //  fight then left the ant in MOVE with nothing to walk: doMove's
      //  catch-all calls onArrive, onArrive maps 'attack' straight back to
      //  FIGHT, and the two states alternate for ever without ever reaching
      //  IDLE, so assignJob never re-tasks it. Measured: MOVE 300 / FIGHT 300
      //  over ten seconds, position identical to the bit, never idle.
      //
      //  A node the ant is already standing on is the same trap by a
      //  different route, because setPath reports success without producing a
      //  path. So only stay in MOVE if a path genuinely came out of it.
      if (this.job && this.job.kind === 'attack' && this.job.node &&
        this.setPath(this.job.node) && this.path) { this.state = A.ST.MOVE; return; }
      this.job = null;
      this.state = A.ST.IDLE;
      return;
    }
    var d = v3.dist(this.pos, foe.pos);
    var reach = 0.85 * (this.def.scale + foe.def.scale);
    if (d > reach) {
      if (this.mode === 'surface' || foe.mode === 'surface') {
        this.surfaceMove(dt, game.sim, foe.pos[0], foe.pos[2], 1.15);
      } else {
        var toward = foe.node || (foe.edge ? foe.edge.a : null);
        if (d < 9.0) {
          // close-quarters shuffle inside the same chamber
          var k = Math.min(1, dt * 3.2);
          this.pos[0] += (foe.pos[0] - this.pos[0]) * k;
          this.pos[1] += (foe.pos[1] - this.pos[1]) * k;
          this.pos[2] += (foe.pos[2] - this.pos[2]) * k;
          this.yaw = M.angleLerp(this.yaw, Math.atan2(foe.pos[0] - this.pos[0], foe.pos[2] - this.pos[2]), dt * 10);
          this.walk = M.damp(this.walk, 1, 8, dt);
          this.phase += dt * 9;
        } else if (toward) {
          //  The foe may be unreachable - the rival nest is a separate node
          //  component of the same farm, so Farm.path returns null and setPath
          //  returns false while leaving the state at FIGHT - or it may sit on
          //  the node this ant already occupies, where setPath returns TRUE
          //  with no path. followPath then does nothing at all, and FIGHT has
          //  no stuck timer to break out of. Give the target up instead.
          if (!this.path) {
            if (!this.setPath(toward) || !this.path) {
              this.target = null; this.job = null; this.state = A.ST.IDLE; return;
            }
          }
          this.followPath(dt, game.sim);
        } else { this.target = null; this.job = null; this.state = A.ST.IDLE; }
      }
      return;
    }
    this.walk = M.damp(this.walk, 0.7, 6, dt);
    this.phase += dt * 11;
    this.yaw = M.angleLerp(this.yaw, Math.atan2(foe.pos[0] - this.pos[0], foe.pos[2] - this.pos[2]), dt * 12);
    if (this.attackCd <= 0) {
      this.attackCd = 0.65 / this.colony.mods.attackRate;
      var dmg = this.dmg * game.rng.range(0.82, 1.24);
      if (this.node && this.node.type === W.CH.BARRACKS) dmg *= 1.25;
      foe.hit(dmg, this, game);
      game.fx.burst(foe.pos, 3, 'gore', foe.colony.color);
      game.audio.play('bite', this.pos);
      if (this.colony.mods.acid > 0 && game.rng.chance(0.35)) {
        foe.hit(this.colony.mods.acid * 4, this, game);
        game.fx.burst(foe.pos, 6, 'acid', [0.85, 1.0, 0.35]);
      }
    }
  };

  Ant.prototype.doTend = function (dt, game) {
    var j = this.job;
    var n = j && j.node ? j.node : this.node;
    if (!n) { this.state = A.ST.IDLE; this.job = null; return; }
    //  Ants stand on the chamber FLOOR, which is a full radius from the
    //  centre - so "closer than radius" is never true and the ant ping-pongs
    //  between MOVE and this state forever. Allow a floor's worth of slack.
    //  Node identity first, distance second. Measured over a running colony:
    //  6.4% of ants settled underground AT a node still sit outside their own
    //  node's radius + 1.0, worst case 1.55x, because chamberFloor's
    //  hollowed-floor fallback drops them wherever the floor actually is. The
    //  distance bar is right for an ant that is somewhere else; for one the
    //  pathfinder already considers resident, arrival is not a measurement.
    if (this.node !== n && v3.dist(this.pos, n.pos) > n.radius + 1.0) {
      if (!this.path) {
        //  followPath only does nothing when path AND edge are both null -
        //  with an edge set it walks the tunnel normally. Testing path alone
        //  cancelled the job of an ant that was moving perfectly well. Same
        //  predicate doMove's own catch-all uses.
        if (!this.setPath(n) || (!this.path && !this.edge)) { this.state = A.ST.IDLE; this.job = null; return; }
      }
      this.followPath(dt, game.sim);
      return;
    }
    this.bob += dt * 1.6;
    var r = n.radius * 0.6;
    this.pos[0] = M.damp(this.pos[0], n.pos[0] + Math.cos(this.bob) * r, 3, dt);
    this.pos[2] = M.damp(this.pos[2], n.pos[2] + Math.sin(this.bob * 1.4) * r, 3, dt);
    this.pos[1] = M.damp(this.pos[1], this.chamberFloor(n, this.pos[0], this.pos[2]), 6, dt);
    this.walk = M.damp(this.walk, 0.5, 5, dt);
    this.phase += dt * 4.5;
    this.colony.broodProgress += dt * 0.9 * this.colony.mods.nurse;
    if (n.type === W.CH.FUNGUS) this.colony.fungusWork += dt;
    this.tendTimer = (this.tendTimer || 0) + dt;
    if (this.tendTimer > 6) { this.tendTimer = 0; this.job = null; this.state = A.ST.IDLE; }
  };

    //  RELEASING THE BODY.
  //
  //  Every abandon path below clears this.job but used to leave c.claimed
  //  pointing at an ant that has walked away. findCorpse skips any body
  //  claimed by somebody else, so one bail retired that corpse permanently -
  //  it lay there un-collectable until it aged out at 70s, and nothing in the
  //  game ever cleared the flag. doForage has always released item.claimed on
  //  its own bail; this is the same courtesy.
  Ant.prototype.doClean = function (dt, game) {
    var j = this.job;
    if (!j) { this.state = A.ST.IDLE; return; }
    if (j.corpse) {
      var c = j.corpse;
      //  `removed` means "somebody has this corpse" - and the ant that has it
      //  is usually THIS one, because it sets the flag itself the moment it
      //  picks the body up. Bailing out on the flag unconditionally therefore
      //  fired on the very next frame against the carrier: job cleared, state
      //  IDLE, corpse still in its jaws. assignJob then handed it nursing
      //  (step 7 runs before sanitation, step 9), and the body was carried
      //  around the nest for ever. Measured: nine ants permanently hauling
      //  corpses under a 'tend' job, colony waste stuck at 39.
      if (c.removed && this.carry !== 'corpse') { c.claimed = 0; this.job = null; this.state = A.ST.IDLE; return; }
      //  HORIZONTAL distance, with a separate vertical sanity gate.
      //
      //  The approach below damps pos[0] and pos[2] only - height belongs to
      //  settle(), which pins the ant to the floor it is standing on. A body
      //  lying on that floor still sits some way off in Y (its own resting
      //  height, plus whatever the hollowed floor does under it), and the ant
      //  has no way to reduce that. Testing full 3D distance against a tight
      //  bar therefore asked for something the mover cannot deliver: traced an
      //  undertaker parked at d = 0.91 against a 0.85 bar with dy = -0.61, so
      //  it was 0.68 away horizontally - right on top of the body - and stood
      //  there until the corpse aged out at 70s. doForage has always measured
      //  this the right way; it steers with surfaceMove(x, z).
      var _dx = this.pos[0] - c.pos[0], _dz = this.pos[2] - c.pos[2];
      var d = Math.sqrt(_dx * _dx + _dz * _dz);
      var dv = Math.abs(this.pos[1] - c.pos[1]);
      if (!this.carry && (d > 0.85 || dv > 1.6)) {
        //  A corpse on the SURFACE records the entrance as its node, so a
        //  cleaner "arrives" there and then takes a pathless TRUE from setPath
        //  every frame while settle() pins its height to the entrance chamber
        //  floor. The corpse is up on the terrain, d never falls under 0.85,
        //  and the ant is retired for the rest of the run.
        //  NO "|| !this.path" here, unlike the tunnel handlers. followPath
        //  nulls this.path on the very frame it arrives, so that guard fired
        //  on the arrival frame, took the pathless-true from setPath, and
        //  abandoned the job - making the damp block just below unreachable
        //  rather than merely rare. Measured: 25 job bails per single pickup
        //  with nine eligible corpses on the floor. doHaul's twin approach
        //  deliberately omits it for the same reason.
        if (!this.path && !this.setPath(c.node || this.farm.nearestNode(c.pos))) {
          c.claimed = 0; this.job = null; this.state = A.ST.IDLE; return;
        }
        var arrived = this.followPath(dt, game.sim);
        if (arrived) {
          this.pos[0] = M.damp(this.pos[0], c.pos[0], 5, dt);
          this.pos[2] = M.damp(this.pos[2], c.pos[2], 5, dt);
          this.settle(dt, 8);
        }
        return;
      }
      if (!this.carry) {
        //  Find the destination BEFORE committing to the lift, and use the
        //  colony's own store lookup rather than a bare midden search.
        //
        //  Two bugs lived in the old two lines. First, `this.farm.findChamber(
        //  W.CH.MIDDEN)` had no fallback, while storeFor has always answered
        //  MIDDEN || THRONE for a corpse (colony.js) - so a colony whose
        //  midden was still being dug could not bury anything even with a
        //  perfectly good throne room standing. Second, the body was marked
        //  removed and the ant took the weight BEFORE anyone checked there was
        //  somewhere to put it; the `!st` branch then dropped the carry, and
        //  since game.js splices a corpse the moment `removed` is set, the
        //  body was destroyed outright. It paid 0.004 hygiene against the
        //  0.022 a real burial pays, and never decremented waste at all, so
        //  onDeath's `waste += 1` was never repaid and waste ratcheted up for
        //  good. Measured on a half-dug midden: waste 9 -> 17 -> 20 while the
        //  corpse count climbed to 17 and nothing was ever buried.
        //
        //  Now: no store, no lift. The body stays on the floor, claimable, for
        //  whenever the midden is finished.
        var mid = this.colony.storeFor('corpse', this.farm);
        if (!mid) { c.claimed = 0; this.job = null; this.state = A.ST.IDLE; return; }
        this.carry = 'corpse';
        this.carryAmt = 1;
        c.removed = true;
        j.store = mid;
        this.setPath(mid);
      }
      var st = j.store;
      //  Only reachable if the store vanished mid-haul (a chamber collapsed or
      //  was re-dug). Credit it in full - the body is already gone from the
      //  world, so paying the partial rate just loses the waste permanently.
      if (!st) {
        this.colony.hygiene = Math.min(1, this.colony.hygiene + 0.022);
        this.colony.waste = Math.max(0, this.colony.waste - 1);
        this.carry = null; c.claimed = 0; this.job = null; this.state = A.ST.IDLE; return;
      }
      //  A floor's worth of slack, as doTend and doHaul both carry: an ant
      //  standing in the midden is a full radius from its centre, so a bare
      //  `< radius` can never be true.
      //  same rule as the node guards: resident at the midden counts as
      //  arrived even when the floor puts the body off-centre
      if (this.node === st || v3.dist(this.pos, st.pos) < st.radius + 1.0) {
        this.colony.hygiene = Math.min(1, this.colony.hygiene + 0.022);
        this.colony.waste = Math.max(0, this.colony.waste - 1);
        this.carry = null; this.job = null; this.state = A.ST.IDLE;
        game.fx.burst(this.pos, 5, 'smoke', [0.4, 0.5, 0.3]);
        return;
      }
      //  setPath returns true for "already there" without building a path, and
      //  this call did not even look at the result. followPath then does
      //  nothing, for ever.
      if (!this.path) {
        if (!this.setPath(st) || !this.path) {
          this.colony.hygiene = Math.min(1, this.colony.hygiene + 0.022);
          this.colony.waste = Math.max(0, this.colony.waste - 1);
          this.carry = null; this.job = null; this.state = A.ST.IDLE;
          return;
        }
      }
      this.followPath(dt, game.sim);
      return;
    }
    // generic sanitation duty
    this.colony.hygiene = Math.min(1, this.colony.hygiene + dt * 0.010 * this.colony.mods.clean);
    this.walk = M.damp(this.walk, 0.6, 5, dt);
    this.phase += dt * 5;
    this.cleanTimer = (this.cleanTimer || 0) + dt;
    if (this.cleanTimer > 5) { this.cleanTimer = 0; this.job = null; this.state = A.ST.IDLE; }
  };

  Ant.prototype.doGuard = function (dt, game) {
    var j = this.job;
    var n = j && j.node ? j.node : this.node;
    if (!n) { this.state = A.ST.IDLE; return; }
    //  radius + 1.0, not radius * 1.2. doGuard's own 0.7-radius orbit peaks
    //  at 1.187 * radius against a 1.2 * radius bar - a 1% margin - and
    //  chamberFloor's hollowed-floor fallback can drop an ant further still.
    //  Node identity first, distance second. Measured over a running colony:
    //  6.4% of ants settled underground AT a node still sit outside their own
    //  node's radius + 1.0, worst case 1.55x, because chamberFloor's
    //  hollowed-floor fallback drops them wherever the floor actually is. The
    //  distance bar is right for an ant that is somewhere else; for one the
    //  pathfinder already considers resident, arrival is not a measurement.
    if (this.node !== n && v3.dist(this.pos, n.pos) > n.radius + 1.0) {
      if (!this.path) {
        //  a pathless "already there" leaves followPath nothing to walk, and
        //  doGuard has no timer to break the MOVE/GUARD ping-pong
        //  followPath only does nothing when path AND edge are both null -
        //  with an edge set it walks the tunnel normally. Testing path alone
        //  cancelled the job of an ant that was moving perfectly well. Same
        //  predicate doMove's own catch-all uses.
        if (!this.setPath(n) || (!this.path && !this.edge)) { this.job = null; this.state = A.ST.IDLE; return; }
      }
      this.followPath(dt, game.sim);
      return;
    }
    //  Accepted while still on an edge: nothing here calls followPath, so the
    //  edge would never clear and this.node would stay stale - and doFight's
    //  barracks bonus and hit()'s gate armour both key off this.node.
    if (this.edge) { this.edge = null; this.node = n; }
    this.bob += dt * 0.8;
    var r = n.radius * 0.7;
    this.pos[0] = M.damp(this.pos[0], n.pos[0] + Math.cos(this.bob) * r, 2, dt);
    this.pos[2] = M.damp(this.pos[2], n.pos[2] + Math.sin(this.bob) * r, 2, dt);
    this.pos[1] = M.damp(this.pos[1], this.chamberFloor(n, this.pos[0], this.pos[2]), 6, dt);
    this.walk = M.damp(this.walk, 0.4, 4, dt);
    this.phase += dt * 3;
  };

  Ant.prototype.doResearch = function (dt, game) {
    var n = (this.job && this.job.node) || this.node;
    if (!n) { this.state = A.ST.IDLE; return; }
    //  Ants stand on the chamber FLOOR, which is a full radius from the
    //  centre - so "closer than radius" is never true and the ant ping-pongs
    //  between MOVE and this state forever. Allow a floor's worth of slack.
    //  Node identity first, distance second. Measured over a running colony:
    //  6.4% of ants settled underground AT a node still sit outside their own
    //  node's radius + 1.0, worst case 1.55x, because chamberFloor's
    //  hollowed-floor fallback drops them wherever the floor actually is. The
    //  distance bar is right for an ant that is somewhere else; for one the
    //  pathfinder already considers resident, arrival is not a measurement.
    if (this.node !== n && v3.dist(this.pos, n.pos) > n.radius + 1.0) {
      if (!this.path) {
        //  followPath only does nothing when path AND edge are both null -
        //  with an edge set it walks the tunnel normally. Testing path alone
        //  cancelled the job of an ant that was moving perfectly well. Same
        //  predicate doMove's own catch-all uses.
        if (!this.setPath(n) || (!this.path && !this.edge)) { this.job = null; this.state = A.ST.IDLE; return; }
      }
      this.followPath(dt, game.sim);
      return;
    }
    this.colony.researchWork += dt * this.colony.mods.research;
    this.bob += dt * 1.2;
    this.pos[0] = M.damp(this.pos[0], n.pos[0] + Math.cos(this.bob) * n.radius * 0.5, 3, dt);
    this.pos[2] = M.damp(this.pos[2], n.pos[2] + Math.sin(this.bob * 1.6) * n.radius * 0.5, 3, dt);
    this.walk = M.damp(this.walk, 0.45, 5, dt);
    this.phase += dt * 4;
  };

  Ant.prototype.doFly = function (dt, game) {
    this.wing = 1;
    var g = this.flyGoal;
    if (!g) { this.state = A.ST.IDLE; this.wing = 0; return; }
    var dx = g[0] - this.pos[0], dy = g[1] - this.pos[1], dz = g[2] - this.pos[2];
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.8) {
      this.wing = 0;
      this.state = A.ST.IDLE;
      if (this.onLand) { this.onLand(game); this.onLand = null; }
      return;
    }
    var sp = this.speed * 2.4 * game.sim.speedMod;
    var k = Math.min(1, sp * dt / d);
    this.pos[0] += dx * k; this.pos[1] += dy * k; this.pos[2] += dz * k;
    this.pos[1] += Math.sin(game.sim.time * 6 + this.bob) * dt * 1.2;
    this.yaw = M.angleLerp(this.yaw, Math.atan2(dx, dz), dt * 5);
    this.phase += dt * 5;
    this.walk = 0.2;
    if (game.rng.chance(dt * 20)) game.fx.burst(this.pos, 1, 'dust', [0.9, 0.9, 1.0]);
  };

  Ant.prototype.doPanic = function (dt, game) {
    this.panicTimer = (this.panicTimer || 2.5) - dt;
    this.walk = 1;
    this.phase += dt * 14;
    if (this.mode === 'surface') {
      this.surfaceMove(dt, game.sim,
        this.pos[0] + Math.sin(this.bob * 3 + game.sim.time * 5) * 6,
        this.pos[2] + Math.cos(this.bob * 2 + game.sim.time * 4) * 6, 1.3);
    } else if (this.edge || this.node) {
      this.followPath(dt, game.sim);
      if (!this.path) {
        var n = this.node || this.farm.nearestNode(this.pos);
        if (n && n.links.length) this.setPath(n.links[game.rng.int(n.links.length)].node);
      }
    }
    if (this.panicTimer <= 0) { this.panicTimer = null; this.state = A.ST.IDLE; }
  };

  AF.A = A;
})(window.AF = window.AF || {});

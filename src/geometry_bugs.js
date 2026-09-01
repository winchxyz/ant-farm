/* =============================================================
   FORMICARIUM :: DEEP COLONY
   geometry_bugs.js - the bestiary's bodies.

   Four more invertebrates, built the same way as everything else in this
   project: from code, at load, with no asset files.

   The silhouettes are deliberately unlike each other. In a tank seen from
   across the room the player has to tell "harmless food" from "that will
   eat my colony" at a glance, and colour alone will not do it: a woodlouse
   is a flat armoured oval, a cricket is all hind legs, a beetle is a
   domed shell with a seam down it, a centipede is a long ripple.
   NOTE ON ANIMATION. The ant vertex shader cycles LEG0..LEG5 by rotating
   them about attach points hard-coded for an ant's body. These animals are
   two to three times that size, so those pivots sit nowhere near the limb
   and the legs get flung off the body. Every limb here is therefore parked
   on part 2.75 - see the note beside the LIMB constant below - which keeps
   the dark matte limb material while matching no animation branch. The
   animals slide rather than stride, and that reads far better than a
   mangled one.

   ============================================================= */
(function (AF) {
  'use strict';

  var G = AF.G;
  var P = G.PART;

  //  RIGID LIMB PART ID.
  //
  //  A limb needs two things that used to be in conflict. The fragment
  //  shader gives limbs their dark matte material - and sets limb=1.0 to
  //  kill the fresnel rim - on the test pid > 2.5 && pid < 10.5. The vertex
  //  shader's animPart rotates 3..8 (legs), 9 (antenna) and 10 (mandible)
  //  about attach points hard-coded for an ANT, which mangles anything
  //  bigger. Parking limbs on part 0 avoided the mangling but lost the
  //  material, and the legs came out pale against a dark body - exactly the
  //  "read as white paper" failure the shader's own comment warns about.
  //
  //  2.75 sits in the gap between the two: it passes the material test and
  //  matches NO animation branch. Dark matte limbs, no fresnel rim, no
  //  rotation about somebody else's hip.
  var LIMB = 2.75;


  // ------------------------------------------------------------------
  //  WOODLOUSE - armoured, slow, harmless. The starter prey.
  // ------------------------------------------------------------------
  G.buildWoodlouse = function () {
    var b = new G.Builder();
    //  Tergites are wide FLAT plates, not beads. Built as spheres the animal
    //  came out looking like a segmented grub; squashing each plate and
    //  overlapping it with the next is what makes it armour.
    var SEG = 9;
    for (var i = 0; i < SEG; i++) {
      var t = i / (SEG - 1);
      //  widest just behind the head, tapering to a rounded tail
      var w = 0.215 * (0.62 + 0.38 * Math.sin(0.55 + t * 2.45));
      var z = 0.24 - t * 0.50;
      b.reset().setPart(P.GASTER, 0, 0, 0).at(0, 0.075, z).scl(w, w * 0.50, 0.062);
      b.ellipsoid(14, 8);
    }
    //  Head shield: a flat plate tucked under the front rim, not a ball on
    //  a neck - an isopod has no visible neck at all.
    b.reset().setPart(P.HEAD, 0, 0, 0).at(0, 0.070, 0.315).scl(0.135, 0.065, 0.070);
    b.ellipsoid(12, 8);
    for (var s = -1; s <= 1; s += 2) {
      // small dark eye at the shield's edge
      b.reset().setPart(P.HEAD, 0, s, 1).at(s * 0.105, 0.082, 0.325).scl(0.024, 0.020, 0.022);
      b.ellipsoid(6, 5);
      //  short thick antennae, angled down and forward along the ground
      b.reset().setPart(LIMB, 0, s, 0).at(s * 0.062, 0.062, 0.355).rotFromAxis([s * 0.55, -0.15, 1.0]);
      b.limb(0.155, 0.017, 0.006, 6, 1, 0, 1);
    }
    //  Seven pairs of legs poking out from UNDER the rim of the shell, with
    //  a bend in them, so the animal sits on the sand instead of floating on
    //  a row of pegs.
    for (var L = 0; L < 14; L++) {
      var side = L < 7 ? 1 : -1;
      var idx = L % 7;
      var az = 0.20 - idx * 0.072;
      var bw = 0.215 * (0.62 + 0.38 * Math.sin(0.55 + (idx / 6) * 2.0));
      var kx = side * (bw + 0.045), ky = 0.032, kz = az - 0.018;
      b.reset().setPart(LIMB, 0, side, 0)
        .at(side * bw * 0.72, 0.058, az).rotFromAxis([kx - side * bw * 0.72, ky - 0.058, -0.018]);
      var fl = Math.sqrt(Math.pow(kx - side * bw * 0.72, 2) + Math.pow(ky - 0.058, 2) + 0.018 * 0.018);
      b.limb(fl, 0.017, 0.012, 5, 1, 0, 0.5);
      var tx = side * (bw + 0.075), ty = 0.005, tz = az - 0.048;
      b.reset().setPart(LIMB, 0, side, 0)
        .at(kx, ky, kz).rotFromAxis([tx - kx, ty - ky, tz - kz]);
      var tl = Math.sqrt(Math.pow(tx - kx, 2) + Math.pow(ty - ky, 2) + 0.03 * 0.03);
      b.limb(tl, 0.011, 0.005, 4, 1, 0.5, 0.5);
    }
    return b;
  };

  // ------------------------------------------------------------------
  //  CRICKET - fast, skittish, jumps. Worth a lot of protein if caught.
  // ------------------------------------------------------------------
  G.buildCricket = function () {
    var b = new G.Builder();
    //  A cricket is read from ONE feature: the folded hind leg. A thick
    //  femur swept up and back, then a long thin tibia dropping back down
    //  to the ground, making a hard Z against the body. The first version
    //  put both parts above the abdomen, where they came out looking like a
    //  pair of fins, and the animal read as a fish.
    //
    //  Everything else is built to keep that shape legible: a segmented
    //  abdomen so the body is not one potato, a saddle-shaped pronotum, and
    //  a head small enough that the legs stay the biggest thing on it.

    // abdomen: four tapering segments, ink lines between them
    for (var i = 0; i < 4; i++) {
      var t = i / 3;
      var aw = 0.145 * (1.0 - t * 0.42);
      b.reset().setPart(P.GASTER, 0, 0, 0).at(0, 0.215 - t * 0.020, -0.16 - t * 0.135).scl(aw, aw * 0.95, 0.105);
      b.ellipsoid(12, 9);
    }
    // thorax
    b.reset().setPart(P.THORAX, 0, 0, 0).at(0, 0.225, 0.02).scl(0.135, 0.125, 0.14);
    b.ellipsoid(12, 9);
    //  pronotum: the saddle plate over the thorax, a cricket's other
    //  signature. Slightly wider than the thorax so it casts its own line.
    b.reset().setPart(P.THORAX, 0, 0, 0).at(0, 0.265, 0.03).scl(0.150, 0.070, 0.115);
    b.ellipsoid(12, 8);
    // head, tipped down
    b.reset().setPart(P.HEAD, 0, 0, 0).at(0, 0.205, 0.185).scl(0.105, 0.115, 0.100);
    b.ellipsoid(12, 9);
    for (var s = -1; s <= 1; s += 2) {
      // eyes: two of them, and small enough not to dominate the head
      b.reset().setPart(P.HEAD, 0, s, 1).at(s * 0.072, 0.245, 0.225).scl(0.033, 0.036, 0.030);
      b.ellipsoid(8, 6);
      //  long whip antennae, swept forward and out
      b.reset().setPart(LIMB, 0, s, 0).at(s * 0.042, 0.255, 0.255).rotFromAxis([s * 0.42, 0.34, 1.0]);
      b.limb(0.66, 0.012, 0.003, 8, 1, 0, 1);
      //  wing cases: flat, lying ALONG the top of the abdomen. Kept low so
      //  they read as a folded surface, never as something standing up.
      b.reset().setPart(LIMB, 0, s, 0).at(s * 0.058, 0.300, -0.20).scl(0.070, 0.016, 0.245);
      b.ellipsoid(10, 6);
      //  cerci, the two short spikes at the tail
      b.reset().setPart(LIMB, 0, s, 0).at(s * 0.040, 0.190, -0.55).rotFromAxis([s * 0.55, 0.12, -1.0]);
      b.limb(0.115, 0.011, 0.004, 4, 1, 0, 1);
    }
    // four walking legs, thin, reaching down to the sand
    for (var L = 0; L < 4; L++) {
      var side = L < 2 ? 1 : -1;
      var idx = L % 2;
      var az = 0.115 - idx * 0.145;
      var kx = side * 0.215, ky = 0.010, kz = az + (idx ? -0.10 : 0.13);
      b.reset().setPart(LIMB, 0, side, 0)
        .at(side * 0.085, 0.190, az).rotFromAxis([kx - side * 0.085, ky - 0.190, kz - az]);
      var fl = Math.sqrt(Math.pow(kx - side * 0.085, 2) + Math.pow(ky - 0.190, 2) + Math.pow(kz - az, 2));
      b.limb(fl, 0.020, 0.007, 5, 2, 0, 1);
    }
    //  THE HIND LEGS.
    for (s = -1; s <= 1; s += 2) {
      //  femur: thick, swept UP and BACK from the thorax to a knee that
      //  sits above and behind the abdomen
      var hx = s * 0.105, hy = 0.195, hz = -0.06;
      var kx2 = s * 0.150, ky2 = 0.430, kz2 = -0.315;
      b.reset().setPart(LIMB, 0, s, 0)
        .at(hx, hy, hz).rotFromAxis([kx2 - hx, ky2 - hy, kz2 - hz]);
      var fl2 = Math.sqrt(Math.pow(kx2 - hx, 2) + Math.pow(ky2 - hy, 2) + Math.pow(kz2 - hz, 2));
      b.limb(fl2, 0.072, 0.026, 8, 3, 0, 0.55);
      //  tibia: long and thin, dropping from the knee back DOWN to the sand
      var tx2 = s * 0.185, ty2 = 0.008, tz2 = -0.60;
      b.reset().setPart(LIMB, 0, s, 0)
        .at(kx2, ky2, kz2).rotFromAxis([tx2 - kx2, ty2 - ky2, tz2 - kz2]);
      var tl2 = Math.sqrt(Math.pow(tx2 - kx2, 2) + Math.pow(ty2 - ky2, 2) + Math.pow(tz2 - kz2, 2));
      b.limb(tl2, 0.021, 0.007, 6, 2, 0.55, 0.45);
    }
    return b;
  };

  // ------------------------------------------------------------------
  //  GROUND BEETLE - armoured, tough, eats your sugar. A nuisance.
  // ------------------------------------------------------------------
  G.buildBeetle = function () {
    var b = new G.Builder();
    //  A ground beetle is LONG and FLAT, not a dome. The first version came
    //  out bulbous enough to read as another woodlouse, which defeats the
    //  point of having two different animals.
    //
    //  The seam down the elytra is the whole silhouette. It is drawn by the
    //  ink pass, not by geometry: two separate half-shells meeting along the
    //  midline make a crease the Sobel finds, so they are kept just apart
    //  and just low enough for that crease to be sharp.
    for (var s = -1; s <= 1; s += 2) {
      b.reset().setPart(P.GASTER, 0, s, 0).at(s * 0.115, 0.175, -0.20).scl(0.155, 0.135, 0.44);
      b.ellipsoid(16, 11);
    }
    //  pronotum: a distinctly narrower plate, which is what separates a
    //  beetle's head from its shell at a glance
    b.reset().setPart(P.THORAX, 0, 0, 0).at(0, 0.155, 0.26).scl(0.175, 0.095, 0.145);
    b.ellipsoid(14, 9);
    // narrow neck
    b.reset().setPart(P.THORAX, 0, 0, 0).at(0, 0.145, 0.375).scl(0.085, 0.070, 0.045);
    b.ellipsoid(10, 7);
    // head
    b.reset().setPart(P.HEAD, 0, 0, 0).at(0, 0.145, 0.455).scl(0.115, 0.085, 0.105);
    b.ellipsoid(12, 9);
    for (s = -1; s <= 1; s += 2) {
      //  Jaws: thick, curved inward, and clearly forward of everything else.
      b.reset().setPart(LIMB, 0, s, 0).at(s * 0.062, 0.135, 0.53).rotFromAxis([-s * 0.42, 0.02, 1.0]);
      b.limb(0.155, 0.038, 0.008, 6, 2, 0, 1);
      //  Antennae: thin, and swept UP and OUT so they never read as a third
      //  pair of jaws.
      b.reset().setPart(LIMB, 0, s, 0).at(s * 0.095, 0.185, 0.47).rotFromAxis([s * 1.0, 0.62, 0.55]);
      b.limb(0.22, 0.013, 0.009, 6, 1, 0, 1);
      // eyes
      b.reset().setPart(P.HEAD, 0, s, 1).at(s * 0.095, 0.175, 0.475).scl(0.030, 0.030, 0.028);
      b.ellipsoid(7, 5);
    }
    //  Six legs, and they matter: the front pair rakes forward, the rear
    //  pair trails back, and all of them reach well clear of the shell so
    //  the animal has a stance instead of three stubs under one side.
    var LEGS = [
      { z: 0.20, out: 0.30, fz: 0.26, len: 0.30 },
      { z: 0.02, out: 0.34, fz: -0.02, len: 0.31 },
      { z: -0.18, out: 0.31, fz: -0.30, len: 0.33 }
    ];
    for (var L = 0; L < 6; L++) {
      var side = L < 3 ? 1 : -1;
      var g = LEGS[L % 3];
      // femur, angled out and down
      var kx = side * g.out, ky = 0.055, kz = g.z + g.fz * 0.55;
      b.reset().setPart(LIMB, 0, side, 0)
        .at(side * 0.115, 0.145, g.z).rotFromAxis([kx - side * 0.115, ky - 0.145, kz - g.z]);
      var fl = Math.sqrt(Math.pow(kx - side * 0.115, 2) + Math.pow(ky - 0.145, 2) + Math.pow(kz - g.z, 2));
      b.limb(fl, 0.030, 0.020, 6, 2, 0, 0.5);
      // tarsus, reaching to the ground
      var tx = side * (g.out + 0.10), ty = 0.008, tz = kz + g.fz * 0.45;
      b.reset().setPart(LIMB, 0, side, 0)
        .at(kx, ky, kz).rotFromAxis([tx - kx, ty - ky, tz - kz]);
      var tl = Math.sqrt(Math.pow(tx - kx, 2) + Math.pow(ty - ky, 2) + Math.pow(tz - kz, 2));
      b.limb(tl, 0.019, 0.007, 5, 2, 0.5, 0.5);
    }
    return b;
  };

  // ------------------------------------------------------------------
  //  CENTIPEDE - fast, venomous, the worst thing in the tank.
  // ------------------------------------------------------------------
  G.buildCentipede = function () {
    var b = new G.Builder();
    var SEG = 15;
    for (var i = 0; i < SEG; i++) {
      var t = i / (SEG - 1);
      var z = 0.62 - t * 1.54;
      //  Tergites are WIDE and FLAT plates, not beads. Building them as
      //  spheres made the animal read as a caterpillar; squashing them and
      //  overlapping them along the body is what makes it a centipede.
      var w = 0.135 * (0.55 + 0.45 * Math.sin(0.25 + t * 2.7));
      b.reset().setPart(P.GASTER, 0, 0, 0).at(0, 0.105, z).scl(w, w * 0.44, 0.082);
      b.ellipsoid(12, 7);
      //  One leg pair per segment, splayed well OUT to the side rather than
      //  tucked under, so both rows show from any angle and the outline
      //  gets the fringe a centipede is recognised by.
      if (i > 0 && i < SEG - 1) {
        for (var s = -1; s <= 1; s += 2) {
          var kx = s * (w + 0.115), ky = 0.055, kz = z - 0.045;
          b.reset().setPart(LIMB, 0, s, 0)
            .at(s * w * 0.8, 0.10, z).rotFromAxis([kx - s * w * 0.8, ky - 0.10, kz - z]);
          var fl = Math.sqrt(Math.pow(kx - s * w * 0.8, 2) + Math.pow(ky - 0.10, 2) + 0.045 * 0.045);
          b.limb(fl, 0.017, 0.011, 5, 1, 0, 0.5);
          var tx = s * (w + 0.215), ty = 0.006, tz = z - 0.105;
          b.reset().setPart(LIMB, 0, s, 0)
            .at(kx, ky, kz).rotFromAxis([tx - kx, ty - ky, tz - kz]);
          var tl = Math.sqrt(Math.pow(tx - kx, 2) + Math.pow(ty - ky, 2) + 0.06 * 0.06);
          b.limb(tl, 0.010, 0.004, 4, 1, 0.5, 0.5);
        }
      }
    }
    // head capsule, a little wider than the first tergite
    b.reset().setPart(P.HEAD, 0, 0, 0).at(0, 0.11, 0.70).scl(0.105, 0.072, 0.10);
    b.ellipsoid(12, 8);
    for (s = -1; s <= 1; s += 2) {
      // eyes
      b.reset().setPart(P.HEAD, 0, s, 1).at(s * 0.070, 0.135, 0.735).scl(0.024, 0.024, 0.022);
      b.ellipsoid(6, 5);
      //  Venom claws: heavy, curved inward, held low and forward.
      b.reset().setPart(LIMB, 0, s, 0).at(s * 0.062, 0.085, 0.76).rotFromAxis([-s * 0.55, -0.10, 1.0]);
      b.limb(0.17, 0.030, 0.005, 6, 2, 0, 1);
      //  Antennae: long, thin, swept out and up - nothing else on the body
      //  points that way, so they read as the head end instantly.
      b.reset().setPart(LIMB, 0, s, 0).at(s * 0.055, 0.135, 0.75).rotFromAxis([s * 0.80, 0.45, 1.0]);
      b.limb(0.34, 0.011, 0.004, 7, 1, 0, 1);
    }
    return b;
  };

})(window.AF = window.AF || {});

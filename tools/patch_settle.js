/* Ants were still hovering in three places that move them toward a target
   position without ever putting them back on a floor:
     - digging      (lerped between two node CENTRES, minus a fudge)
     - fetching an item
     - fetching a corpse
   Each now finishes with settle(). */
const fs = require('fs');
let n = 0;
function edit(from, to, label) {
  let s = fs.readFileSync('src/ants.js', 'utf8');
  if (!s.includes(from)) { console.log('MISS  ' + label); return; }
  fs.writeFileSync('src/ants.js', s.split(from).join(to));
  n++; console.log('ok    ' + label);
}

// --- digging: stand on the floor of the node we are digging from ---
edit(
  "    var wy = stand.pos[1] + (face[1] - stand.pos[1]) * prog * 0.85 - 0.15;\n" +
  "    var wz = stand.pos[2] + (face[2] - stand.pos[2]) * prog * 0.85;\n" +
  "    this.pos[0] = M.damp(this.pos[0], wx + Math.cos(this.bob) * 0.35, 3.5, dt);\n" +
  "    this.pos[1] = M.damp(this.pos[1], wy, 3.5, dt);\n" +
  "    this.pos[2] = M.damp(this.pos[2], wz + Math.sin(this.bob) * 0.25, 3.5, dt);",

  "    var wz = stand.pos[2] + (face[2] - stand.pos[2]) * prog * 0.85;\n" +
  "    this.pos[0] = M.damp(this.pos[0], wx + Math.cos(this.bob) * 0.35, 3.5, dt);\n" +
  "    this.pos[2] = M.damp(this.pos[2], wz + Math.sin(this.bob) * 0.25, 3.5, dt);\n" +
  "    // stand on the chamber floor beneath us, never between two centres\n" +
  "    this.pos[1] = M.damp(this.pos[1],\n" +
  "      this.chamberFloor(stand, this.pos[0], this.pos[2]), 4.0, dt);",
  'digging stands on the floor');

// --- fetching an item ---
edit(
  "          this.pos[0] = M.damp(this.pos[0], item.pos[0], 6, dt);\n" +
  "          this.pos[1] = M.damp(this.pos[1], item.pos[1], 6, dt);\n" +
  "          this.pos[2] = M.damp(this.pos[2], item.pos[2], 6, dt);",
  "          this.pos[0] = M.damp(this.pos[0], item.pos[0], 6, dt);\n" +
  "          this.pos[2] = M.damp(this.pos[2], item.pos[2], 6, dt);\n" +
  "          this.settle(dt, 8);",
  'item fetch settles');

// --- fetching a corpse ---
edit(
  "          this.pos[0] = M.damp(this.pos[0], c.pos[0], 5, dt);\n" +
  "          this.pos[1] = M.damp(this.pos[1], c.pos[1], 5, dt);\n" +
  "          this.pos[2] = M.damp(this.pos[2], c.pos[2], 5, dt);",
  "          this.pos[0] = M.damp(this.pos[0], c.pos[0], 5, dt);\n" +
  "          this.pos[2] = M.damp(this.pos[2], c.pos[2], 5, dt);\n" +
  "          this.settle(dt, 8);",
  'corpse fetch settles');

console.log('\npatched ' + n);

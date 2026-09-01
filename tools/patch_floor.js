/* One-shot rewrite: replace every fixed-fraction chamber drop with a real
   spherical-floor solve, so ants stand on the chamber floor at whatever
   horizontal offset they happen to occupy. */
const fs = require('fs');

const edits = [
  ['src/ants.js',
    'this.pos[1] = n.pos[1] - n.radius * 0.62;',
    'this.pos[1] = this.chamberFloor(n, this.pos[0], this.pos[2]);'],
  ['src/ants.js',
    'this.pos[1] = M.damp(this.pos[1], n.pos[1] - n.radius * 0.62, 6, dt);',
    'this.pos[1] = M.damp(this.pos[1], this.chamberFloor(n, this.pos[0], this.pos[2]), 6, dt);'],
  ['src/ants.js',
    'this.pos[0] = n.pos[0]; this.pos[1] = n.pos[1] - n.radius * 0.4; this.pos[2] = n.pos[2];',
    'this.pos[0] = n.pos[0]; this.pos[2] = n.pos[2];\n        this.pos[1] = this.chamberFloor(n, this.pos[0], this.pos[2]);'],
  ['src/ants.js',
    'this.pos[1] = M.damp(this.pos[1], n.pos[1] - n.radius * 0.6, 6, dt);',
    'this.pos[1] = M.damp(this.pos[1], this.chamberFloor(n, this.pos[0], this.pos[2]), 6, dt);']
];

for (const [file, from, to] of edits) {
  let src = fs.readFileSync(file, 'utf8');
  const n = src.split(from).length - 1;
  if (n === 0) { console.log('MISS  ' + from.slice(0, 52)); continue; }
  src = src.split(from).join(to);
  fs.writeFileSync(file, src);
  console.log('ok x' + n + '  ' + from.slice(0, 52));
}

// spawn positions: drop them to the chamber floor too
for (const file of ['src/game.js', 'src/colony.js']) {
  let src = fs.readFileSync(file, 'utf8');
  const before = src;
  src = src.replace(/node\.pos\[1\] - node\.radius \* 0\.6/g,
    'node.pos[1] - node.radius * 0.90');
  src = src.replace(/nest\.throne\.pos\[1\] - nest\.throne\.radius \* 0\.6/g,
    'nest.throne.pos[1] - nest.throne.radius * 0.90');
  if (src !== before) { fs.writeFileSync(file, src); console.log('ok    spawn drops in ' + file); }
}
console.log('done');

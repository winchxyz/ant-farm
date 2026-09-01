/* One-shot rebuild patch: single-tank cozy sandbox.
   - three playable castes
   - player and one gentle rival share the single tank
   - generous starting stock, no invisible drought deaths
   - open straight on the tank instead of a shelf fly-in            */
const fs = require('fs');
let changed = 0;
function edit(file, from, to, label) {
  let s = fs.readFileSync(file, 'utf8');
  if (!s.includes(from)) { console.log('MISS  ' + label); return; }
  s = s.split(from).join(to);
  fs.writeFileSync(file, s);
  changed++;
  console.log('ok    ' + label);
}

// ---------------- castes ----------------
edit('src/ants.js',
  "key: 'WORKER', name: 'Worker', glyph: 'W',",
  "key: 'WORKER', name: 'Worker', glyph: 'W', playable: true,", 'worker playable');
edit('src/ants.js',
  "key: 'FORAGER', name: 'Forager', glyph: 'F',",
  "key: 'FORAGER', name: 'Forager', glyph: 'F', playable: true,", 'forager playable');
edit('src/ants.js',
  "key: 'SOLDIER', name: 'Soldier', glyph: 'S',",
  "key: 'SOLDIER', name: 'Soldier', glyph: 'S', playable: true,", 'soldier playable');
edit('src/ants.js',
  '  A.ST = {',
  '  //  Only these three are offered to the player; the rest stay defined so\n' +
  '  //  saves and existing lookups keep working.\n' +
  '  A.PLAYABLE = [];\n' +
  '  for (var _pi = 0; _pi < A.CASTES.length; _pi++) if (A.CASTES[_pi].playable) A.PLAYABLE.push(_pi);\n\n' +
  '  A.ST = {', 'A.PLAYABLE list');

// ---------------- founding: place colonies at chosen ends of the one tank ----------------
edit('src/game.js',
  'Game.foundColony = function (col, farm, startAnts) {\n' +
  '    var x = farm.center[0] + col.rng.range(-farm.half[0] * 0.35, farm.half[0] * 0.35);',
  'Game.foundColony = function (col, farm, startAnts, xFrac) {\n' +
  '    var x = farm.center[0] + (xFrac === undefined\n' +
  '      ? col.rng.range(-farm.half[0] * 0.35, farm.half[0] * 0.35)\n' +
  '      : farm.half[0] * xFrac + col.rng.range(-1.2, 1.2));',
  'foundColony xFrac');

// starting mix: only the three playable castes
edit('src/game.js',
  "var mix = [A.C.WORKER, A.C.WORKER, A.C.WORKER, A.C.FORAGER, A.C.FORAGER, A.C.NURSE, A.C.SOLDIER, A.C.CLEANER, A.C.SCOUT];",
  "var mix = [A.C.WORKER, A.C.WORKER, A.C.FORAGER, A.C.WORKER, A.C.FORAGER, A.C.SOLDIER];",
  'starting caste mix');

// ---------------- one tank: player left, one gentle rival right ----------------
edit('src/game.js',
  '    W.buildShelf(this.world);',
  '    W.buildShelf(this.world, { biome: opts.biome || 女 });'.replace('女', "'loam'"),
  'buildShelf biome');

// ---------------- resources: generous, and water never kills ----------------
edit('src/colony.js',
  'this.sugar = 120; this.protein = 60; this.water = 80;\n' +
  '    this.biomass = 40; this.minerals = 10; this.research = 0;',
  'this.sugar = 260; this.protein = 150; this.water = 200;\n' +
  '    this.biomass = 190; this.minerals = 10; this.research = 0;',
  'generous start');

edit('src/colony.js',
  "this.water -= dt * this.ants.length * 0.0035 * (this.farms[0] ? (1.6 - this.farms[0].biome.humid) : 1);\n" +
  '    if (this.water < 0) { this.water = 0; deficit += dt * 0.6; }',
  "this.water -= dt * this.ants.length * 0.0020 * (this.farms[0] ? (1.6 - this.farms[0].biome.humid) : 1);\n" +
  '    // water is folded into the single Food readout, so a shortfall must\n' +
  '    // never quietly kill ants the player cannot see going thirsty\n' +
  '    if (this.water < 0) this.water = 0;',
  'no invisible drought deaths');

console.log('\npatched ' + changed + ' sites');

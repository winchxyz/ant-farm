/* The founding colony was created all at once with 430-720s lifespans, so the
   entire cohort expired inside the same two minutes and the colony collapsed
   from 35 ants to 4 while the pantry was still full.

   Three changes: ants live long enough for a colony to feel stable, the
   founders are born at staggered ages so they never die in one wave, and the
   queen lays fast enough to outpace attrition. */
const fs = require('fs');
let n = 0;
function edit(file, from, to, label) {
  let s = fs.readFileSync(file, 'utf8');
  if (!s.includes(from)) { console.log('MISS  ' + label); return; }
  fs.writeFileSync(file, s.split(from).join(to));
  n++; console.log('ok    ' + label);
}

edit('src/ants.js',
  "this.lifespan = colony.rng.range(430, 720) * (caste === A.C.QUEEN ? 9 : 1);",
  "this.lifespan = colony.rng.range(1150, 1900) * (caste === A.C.QUEEN ? 9 : 1);",
  'longer lifespans');

// founders start at spread-out ages so attrition is a trickle, not a wave
edit('src/game.js',
  "      var a = new A.Ant(col, caste, farm, p);\n" +
  "      a.node = node;\n" +
  "      a.homeNode = nest.entrance;",
  "      var a = new A.Ant(col, caste, farm, p);\n" +
  "      // stagger the founding cohort so they do not all die of old age at once\n" +
  "      a.age = col.rng.range(0, a.lifespan * 0.55);\n" +
  "      a.node = node;\n" +
  "      a.homeNode = nest.entrance;",
  'stagger founder ages');

edit('src/colony.js',
  "var interval = 7.5 + Math.min(9, this.population() * 0.085);",
  "var interval = 5.5 + Math.min(7, this.population() * 0.055);",
  'faster laying');

console.log('\npatched ' + n);

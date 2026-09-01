/* The caste trim removed Nurses and Undertakers from play, but the sim still
   asked them to do the work: nothing cleared corpses, so hygiene fell to zero
   and the colony died of plague by day 6 with a full pantry.

   Workers now cover both jobs. */
const fs = require('fs');
let n = 0;
function edit(file, from, to, label) {
  let s = fs.readFileSync(file, 'utf8');
  if (!s.includes(from)) { console.log('MISS  ' + label); return; }
  fs.writeFileSync(file, s.split(from).join(to));
  n++; console.log('ok    ' + label);
}

// --- workers take on sanitation, not just when things are already bad ---
edit('src/colony.js',
  "if (c === A.C.CLEANER || (this.hygiene < 0.7 && this.rng.chance(0.4))) {",
  "if (c === A.C.CLEANER || c === A.C.WORKER || (this.hygiene < 0.7 && this.rng.chance(0.4))) {",
  'workers clear corpses');

// --- workers tend brood more readily ---
edit('src/colony.js',
  "if (c === A.C.NURSE || (c === A.C.WORKER && this.rng.chance(0.2))) {",
  "if (c === A.C.NURSE || (c === A.C.WORKER && this.rng.chance(0.35))) {",
  'workers tend brood');

// --- brood development counts workers as carers ---
edit('src/colony.js',
  "var nurses = this.castes(A.C.NURSE);",
  "// workers double as nurses now that the caste is not offered\n" +
  "    var nurses = this.castes(A.C.NURSE) + this.castes(A.C.WORKER) * 0.6;",
  'brood care counts workers');

// --- hygiene recovers from whoever is actually doing the cleaning ---
edit('src/colony.js',
  "this.hygiene = M.clamp(this.hygiene - decay * dt + dt * 0.0060 * this.castes(A.C.CLEANER) * this.mods.clean, 0, 1);",
  "var cleaners = this.castes(A.C.CLEANER) + this.castes(A.C.WORKER) * 0.55;\n" +
  "    this.hygiene = M.clamp(this.hygiene - decay * dt + dt * 0.0060 * cleaners * this.mods.clean, 0, 1);",
  'hygiene recovery counts workers');

// --- gentler decay overall: this is a cozy game, not a plague sim ---
edit('src/colony.js',
  "var decay = (0.0016 + this.ants.length * 0.000030 + Math.min(this.waste, 60) * 0.00010) / (1 + middens * 1.6);",
  "var decay = (0.0009 + this.ants.length * 0.000018 + Math.min(this.waste, 60) * 0.00006) / (1 + middens * 1.6);",
  'gentler hygiene decay');

console.log('\npatched ' + n);

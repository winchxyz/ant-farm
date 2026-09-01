/* Headless geometry check: build every procedural mesh on the CPU and
   assert it is well formed (no NaN, indices in range, whole triangles).
   Shaders are checked separately by tools/glsl_lint.js. */
const fs = require('fs');
global.window = {};
global.performance = { now: () => 0 };
for (const f of ['math.js', 'geometry.js', 'geometry_bugs.js']) {
  eval(fs.readFileSync('src/' + f, 'utf8'));
}
const AF = global.window.AF;

const builders = {
  ant0: () => AF.G.buildAnt(0), ant1: () => AF.G.buildAnt(1), ant2: () => AF.G.buildAnt(2),
  soldier: () => AF.G.buildSoldier(0), queen: () => AF.G.buildQueen(0), alate: () => AF.G.buildAlate(0),
  grass: () => AF.G.buildGrassBlade(11), grass2: () => AF.G.buildGrassBlade(29),
  leaf: () => AF.G.buildLeaf(0), mushroom: () => AF.G.buildMushroom(0),
  spider: () => AF.G.buildSpider(), pebble: () => AF.G.buildPebble(3, 10),
  crystal: () => AF.G.buildCrystal(5), seed: () => AF.G.buildSeed(),
  brood: () => AF.G.buildBrood(), droplet: () => AF.G.buildDroplet(),
  aphid: () => AF.G.buildAphid(), twig: () => AF.G.buildTwig(4),
  quad: () => AF.G.buildQuad(), box: () => AF.G.buildBox(1, 1, 1, false),
  blob: () => AF.G.buildBlob(1), ring: () => AF.G.buildRing(64, 0.82, 1.0),
  woodlouse: () => AF.G.buildWoodlouse(), cricket: () => AF.G.buildCricket(),
  beetle: () => AF.G.buildBeetle(), centipede: () => AF.G.buildCentipede(),
  tube: () => AF.G.buildTube(8, 10)
};

let bad = 0, tris = 0;
for (const name of Object.keys(builders)) {
  const b = builders[name]();
  const nv = b.pos.length / 3;
  let maxIdx = -1;
  for (const i of b.idx) if (i > maxIdx) maxIdx = i;
  const nan = b.pos.some(Number.isNaN) || b.nrm.some(Number.isNaN) || b.part.some(Number.isNaN);
  const attrsMatch = b.nrm.length / 3 === nv && b.uv.length / 2 === nv && b.part.length / 4 === nv;
  const ok = !nan && maxIdx < nv && b.idx.length % 3 === 0 && attrsMatch && nv > 0;
  if (!ok) bad++;
  tris += b.idx.length / 3;
  console.log((ok ? 'ok  ' : 'FAIL') + '  ' + name.padEnd(9) +
    String(nv).padStart(5) + ' verts ' + String(b.idx.length / 3).padStart(5) + ' tris' +
    (nan ? '  <NaN>' : '') + (maxIdx >= nv ? '  <index OOB>' : '') +
    (attrsMatch ? '' : '  <attr length mismatch>'));
}
console.log('\n' + tris + ' triangles across ' + Object.keys(builders).length +
  ' meshes · failures: ' + bad);
process.exit(bad ? 1 : 0);

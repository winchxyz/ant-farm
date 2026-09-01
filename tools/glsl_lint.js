/* GLSL ES 3.00 sanity linter.
   Strips the preprocessor, comments and swizzles, collects every declarator
   (comma lists, arrays, function parameters, for-inits), then reports any
   identifier that is used but never bound. Catches typos and renamed
   varyings without needing a GPU. */
const fs = require('fs');
global.window = {};
for (const f of ['math.js', 'geometry.js', 'shaders.js', 'shaders_post.js']) {
  eval(fs.readFileSync('src/' + f, 'utf8'));
}
const AF = global.window.AF;

const TYPES = 'void|float|int|bool|vec2|vec3|vec4|ivec2|ivec3|ivec4|bvec2|bvec3|bvec4|' +
  'mat2|mat3|mat4|sampler2D|sampler3D|samplerCube|sampler2DShadow';

const BUILTIN = new Set((`
main sin cos tan asin acos atan sinh cosh tanh pow exp log exp2 log2 sqrt inversesqrt
abs sign floor ceil fract mod modf min max clamp mix step smoothstep length distance dot
cross normalize reflect refract faceforward transpose inverse determinant matrixCompMult
outerProduct texture textureLod textureProj texelFetch textureSize textureOffset
dFdx dFdy fwidth lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual
any all not round roundEven trunc isnan isinf floatBitsToInt intBitsToFloat
gl_Position gl_FragCoord gl_FragDepth gl_VertexID gl_InstanceID gl_FrontFacing
gl_PointSize gl_PointCoord
true false discard return break continue if else for while do struct
const uniform in out inout attribute varying flat smooth centroid layout location
precision highp mediump lowp invariant
`).trim().split(/\s+/));

//  GLSL ES 3.00 keeps a long list of words reserved for future use. Using one
//  as a variable compiles nowhere and the error only shows up on a GPU, so
//  check for them here.
const RESERVED = new Set((`
patch sample subroutine common partition active asm class union enum typedef
template this packed goto inline noinline volatile public static extern external
interface long short half fixed unsigned superp input output hvec2 hvec3 hvec4
fvec2 fvec3 fvec4 sampler3DRect filter image1D image2D image3D imageCube
iimage1D iimage2D iimage3D iimageCube uimage1D uimage2D uimage3D uimageCube
image1DArray image2DArray sizeof cast namespace using row_major
`).trim().split(/\s+/));

function lint(name, src) {
  const s = src
    .replace(/^[ \t]*#.*$/gm, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const problems = [];
  const bal = (a, b) => s.split(a).length - s.split(b).length;
  if (bal('{', '}') !== 0) problems.push('brace imbalance ' + bal('{', '}'));
  if (bal('(', ')') !== 0) problems.push('paren imbalance ' + bal('(', ')'));
  if (bal('[', ']') !== 0) problems.push('bracket imbalance ' + bal('[', ']'));
  if (!/void\s+main\s*\(/.test(src)) problems.push('no main()');

  const declared = new Set();
  let m;

  // Every name introduced by a type keyword: locals (even when initialised
  // from a call), comma lists, arrays, function names and their parameters.
  // Scan forward from each type token, tracking paren depth, and take the
  // identifiers sitting in declarator position.
  const typeRe = new RegExp('\\b(?:' + TYPES + ')\\b', 'g');
  const tokRe = /[A-Za-z_]\w*|[(){}\[\],;=]/g;
  while ((m = typeRe.exec(s))) {
    tokRe.lastIndex = m.index + m[0].length;
    let depth = 0, expectName = true, t;
    while ((t = tokRe.exec(s))) {
      const tk = t[0];
      if (tk === '(') {
        // a name immediately followed by '(' is a function: its parameters
        // are declared by their own type tokens, so just keep going
        depth++; expectName = false;
      } else if (tk === ')') {
        if (depth === 0) break;
        depth--;
      } else if (tk === '[') { depth++; }
      else if (tk === ']') { depth--; }
      else if (tk === ';' && depth === 0) break;
      else if (tk === '{' && depth === 0) break;
      else if (tk === ',' && depth === 0) expectName = true;
      else if (tk === '=') expectName = false;
      else if (/^[A-Za-z_]/.test(tk)) {
        if (expectName) { declared.add(tk); expectName = false; }
      }
    }
  }
  // for-loop inits and #define names
  const forRe = new RegExp('for\\s*\\(\\s*(?:' + TYPES + ')\\s+([A-Za-z_]\\w*)', 'g');
  while ((m = forRe.exec(s))) declared.add(m[1]);
  const defRe = /^[ \t]*#define\s+([A-Za-z_]\w*)/gm;
  while ((m = defRe.exec(src))) declared.add(m[1]);

  // strip member access and type keywords, then see what identifiers remain
  const body = s.replace(/\.\s*[A-Za-z_]\w*/g, ' ')
    .replace(new RegExp('\\b(?:' + TYPES + ')\\b', 'g'), ' ');
  const unknown = new Map();
  body.split('\n').forEach((ln, i) => {
    const idRe = /[A-Za-z_]\w*/g;
    let t;
    while ((t = idRe.exec(ln))) {
      const id = t[0];
      // skip the exponent of a numeric literal: 1e-5, 3.0e8
      const prev = t.index > 0 ? ln[t.index - 1] : '';
      if (/[0-9.]/.test(prev)) continue;
      if (BUILTIN.has(id) || declared.has(id)) continue;
      if (!unknown.has(id)) unknown.set(id, i + 1);
    }
  });
  if (unknown.size) {
    problems.push('undeclared: ' + [...unknown.entries()].map(e => e[0] + '(L' + e[1] + ')').join(', '));
  }
  // reserved words used as identifiers
  const bad = [...declared].filter(d => RESERVED.has(d));
  if (bad.length) problems.push('reserved word used as a name: ' + bad.join(', '));

  const ok = problems.length === 0;
  console.log((ok ? 'ok  ' : 'FAIL') + '  ' + name.padEnd(14) +
    (ok ? src.split('\n').length + ' lines' : '\n        ' + problems.join('\n        ')));
  return ok ? 0 : 1;
}

let bad = 0;
for (const k of Object.keys(AF.S)) {
  if (typeof AF.S[k] === 'string' && /_(VS|FS)$/.test(k)) bad += lint(k, AF.S[k]);
}
for (const k of Object.keys(AF.SP)) {
  if (typeof AF.SP[k] === 'string' && /_FS$/.test(k)) bad += lint(k, AF.SP[k]);
}
console.log('\nshaders with problems: ' + bad);
process.exit(bad ? 1 : 0);

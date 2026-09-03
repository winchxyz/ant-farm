/* =============================================================
   FORMICARIUM :: DEEP COLONY
   water_render.js - screen-space fluid rendering.

   Ported from the Aetherflow fluid laboratory (C:/Users/oxman/SPS,
   src/p6_fluid.js). Drawing water as a crowd of shaded blobs can never
   look like water no matter how the blobs are shaded, because the eye
   reads the individual silhouettes. The fix is to stop drawing bodies at
   all and draw a SURFACE instead:

     1. every particle is a sphere impostor written into an eye-space
        DEPTH buffer (nothing is shaded yet)
     2. that depth is smoothed with a separable BILATERAL blur which
        refuses to cross a silhouette, so the bumps melt together but the
        outline of the pool stays razor sharp
     3. normals are rebuilt from the smoothed depth, using whichever
        neighbour is closer in depth, so edges do not smear
     4. a second additive pass accumulates THICKNESS
     5. the composite refracts the scene behind the surface, absorbs
        colour by thickness, and adds Fresnel reflection and a sun glint

   The single most important line is the absorption weighting. Aetherflow
   leaves a note there, and it describes exactly the failure this engine
   had: absorption has to carry the colour and the sense of depth, and
   scattering may only fill the shallows. Weighted the other way round
   every pool comes out looking like warm milk.
   ============================================================= */
(function (AF) {
  'use strict';

  var WR = {};
  WR.tint = 0.30;                 // shallow-water tint strength; see uTint
  //  THICKNESS PER SPLAT - the number that decides whether water looks like
  //  water. It was 0.055, and with the thickness field now smoothed (see the
  //  thickness blur below) that left a poured puddle at th.r far under the
  //  coverage ramp: colourless, a faint sheen on the sand rather than a pool.
  //  Swept against a real puddle, measuring the blue-minus-red shift the
  //  water introduces and how much it darkens what is behind it:
  //
  //      uScale   blue shift   darkening
  //      0.055      0.023        0.051     <- invisible, the reported bug
  //      0.10       0.230        0.132
  //      0.13       ~0.30        ~0.17     <- reads as water
  //      0.16       0.367        0.217     <- poster paint
  //
  //  Safe to raise because the thickness blur is masked by the depth buffer,
  //  so a bigger number cannot push the film outward past its own silhouette.
  WR.thickScale = 0.13;           // thickness written per splat; see uScale
  WR.thickK = 2.2;                // thickness multiplier for colour only
  WR.useThree = true;             // Stage 7 path; see the A/B note in draw()
  var gl = null, GLX = null;
  var P = {}, FB = {};
  var vbo = null, vao = null, data = null, nPart = 0;
  var STRIDE = 6;                 // x,y,z,radius,speed,packing

  var HEAD = '#version 300 es\nprecision highp float;\nprecision highp int;\n';

  // ---------------------------------------------------------------
  //  1. sphere impostors -> eye-space depth
  // ---------------------------------------------------------------
  var VS_PART = HEAD + [
    'layout(location=0) in vec3 aP;',
    'layout(location=1) in vec3 aI;   // radius, speed, packing',
    'uniform mat4 uView, uProj;',
    'uniform float uPointScale;',
    'out vec3 vEye; out float vRad, vSpd, vPack;',
    'void main(){',
    '  vec4 e = uView*vec4(aP,1.0);',
    '  vEye = e.xyz;',
    '  //  A drop in flight has almost no neighbours. Drawing it at the full',
    '  //  smoothing radius turns a single droplet into a boulder, so lone',
    '  //  particles shrink and stay tight beads.',
    '  vRad = aI.x*mix(0.26,1.0,smoothstep(0.06,0.62,aI.z));',
    '  vSpd = aI.y; vPack = aI.z;',
    '  gl_Position = uProj*e;',
    '  gl_PointSize = clamp(uPointScale*vRad/max(0.02,-e.z),1.0,220.0);',
    '}'
  ].join('\n');

  var FS_DEPTH = HEAD + [
    'in vec3 vEye; in float vRad, vSpd, vPack;',
    'uniform mat4 uProj;',
    'out vec4 oDepth;',
    'void main(){',
    '  vec2 c = vec2(gl_PointCoord.x, 1.0-gl_PointCoord.y)*2.0-1.0;',
    '  float m = dot(c,c);',
    '  if(m > 1.0) discard;',
    '  //  reconstruct the point on the sphere this fragment is looking at',
    '  vec3 e = vEye + vec3(c*vRad, sqrt(1.0-m)*vRad);',
    '  float dep = -e.z;',
    '  if(dep <= 0.0) discard;',
    '  vec4 cl = uProj*vec4(e,1.0);',
    '  gl_FragDepth = clamp((cl.z/cl.w)*0.5+0.5, 0.0, 1.0);',
    '  oDepth = vec4(dep, vSpd, vPack, 1.0);',
    '}'
  ].join('\n');

  //  Thickness: additive. How much water is along this ray.
  //
  //  It used to accumulate from EVERY particle with no depth test at all.
  //  Water that had run into a pit and settled behind the near wall still
  //  wrote its thickness at its screen position - over sand that is in
  //  FRONT of it - and the composite then shaded that sand as if it were
  //  under water. That is the wash that survived the premultiply fix.
  //
  //  The depth pass runs first, so the front-most fluid surface for this
  //  pixel is already known. Water sitting well behind that surface is
  //  hidden, and contributes nothing the eye can see through.
  var FS_THICK = HEAD + [
    'in vec3 vEye; in float vRad, vSpd, vPack;',
    'uniform float uScale;',
    'uniform sampler2D uSurf;',
    'uniform mat4 uProj;',
    'uniform vec2 uInvRes;',
    'out vec4 oThick;',
    'void main(){',
    '  vec2 c = vec2(gl_PointCoord.x, 1.0-gl_PointCoord.y)*2.0-1.0;',
    '  float m = dot(c,c);',
    '  if(m > 1.0) discard;',
    '  vec3 e = vEye + vec3(c*vRad, sqrt(1.0-m)*vRad);',
    '  float dep = -e.z;',
    '  if(dep <= 0.0) discard;',
    '  vec2 uv = gl_FragCoord.xy*uInvRes;',
    '  float surf = texture(uSurf, uv).r;',
    '  //  a real pool is allowed a few particle diameters of body; anything',
    '  //  further back than that is behind other water and does not count',
    '  if(surf > 0.0 && dep > surf + 2.2) discard;',
    '  float w = (1.0-m)*uScale;',
    '  oThick = vec4(w, w*clamp(vSpd*0.10,0.0,1.0), 0.0, 0.0);',
    '}'
  ].join('\n');

  var VS_FULL = HEAD + [
    'out vec2 vUV;',
    'void main(){',
    '  vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2);',
    '  vUV = p; gl_Position = vec4(p*2.0-1.0,0.0,1.0);',
    '}'
  ].join('\n');

  // ---------------------------------------------------------------
  //  2. separable bilateral blur
  // ---------------------------------------------------------------
  //  The range term is what makes this work: a sample whose depth differs a
  //  lot from the centre is a DIFFERENT surface, so it is thrown away. That
  //  melts the bumps of neighbouring blobs into one sheet while leaving the
  //  silhouette of the pool perfectly sharp.
  var FS_BLUR = HEAD + [
    '#define R 10',
    'uniform sampler2D uSrc;',
    'uniform ivec2 uDir, uSize;',
    'uniform float uSigR, uSigD, uKernel, uKernelMax;',
    'out vec4 oCol;',
    'void main(){',
    '  ivec2 tc = ivec2(gl_FragCoord.xy);',
    '  vec4 c = texelFetch(uSrc,tc,0);',
    '  if(c.r <= 0.0){ oCol = c; return; }',
    '  //  THE KERNEL HAS TO BE THE SIZE OF A PARTICLE ON SCREEN.',
    '  //',
    '  //  This filter existed to melt neighbouring spheres into one sheet, and',
    '  //  it could not, because its reach was ten TEXELS no matter how large a',
    '  //  sphere was. A particle is 0.37 world units and gl_PointSize gives it',
    '  //  uPointScale*0.37/depth pixels: about 9 across the tank at depth 55,',
    '  //  but 50 across at depth 10. Zoomed out the kernel covered whole',
    '  //  particles and the pool read as liquid; zoomed in it smoothed a fifth',
    '  //  of one, every sphere kept its own bump, and a shallow film came out',
    '  //  as a bag of beads. That is the "lots of small blobs" report, and it',
    '  //  was never visible before only because thin water was not drawn at',
    '  //  all - the coverage ramp discarded it.',
    '  //',
    '  //  So the taps stride. `uKernel` is the projected radius of a particle',
    '  //  at THIS pixel depth, so the ten taps per side always span one',
    '  //  particle whatever the zoom, and the gaussian weight is unchanged',
    '  //  because i is now measured in strides rather than in texels.',
    '  float step = clamp(uKernel / (c.r * float(R)), 1.0, uKernelMax);',
    '  int st = int(step + 0.5);',
    '  float sum = c.r, wsum = 1.0;',
    '  //  INTERIORNESS, carried in alpha, for free.',
    '  //',
    '  //  This filter has a range sigma of six texels and reaches ten, so for',
    '  //  about ten pixels inside the outline the smoothed depth is not a',
    '  //  surface at all - it is a one-sided ramp falling off the edge of the',
    '  //  data. The normal rebuilt from that ramp is tilted by roughly sixty',
    '  //  degrees (the sphere limb drops one particle radius, 0.37 units, over',
    '  //  ten pixels, which at depth 32 is 0.228 units), which drives nv to',
    '  //  zero and Fresnel to one. That is the mirror ring, and no amount of',
    '  //  thresholding the THICKNESS can find it, because the thickness there',
    '  //  is perfectly real water.',
    '  //',
    '  //  What separates a fabricated normal from a genuinely steep one is',
    '  //  proximity to the silhouette, and this loop already walks exactly the',
    '  //  neighbourhood that decides it. The depth pass writes alpha 1 and the',
    '  //  clear writes alpha 0, so alpha is already a binary water mask; box-',
    '  //  averaging it over the same reach gives the fraction of the kernel',
    '  //  that saw water. Separable, so the vertical pass averages the',
    '  //  horizontal fractions and the result is a 2D estimate: 1.0 well',
    '  //  inside a pool, 0.5 on a straight outline, 0.25 on a convex corner.',
    '  //  Cost: two adds per tap and no extra fetch - the texel below was',
    '  //  already being read, only the swizzle moved.',
    '  float open = c.a, seen = 1.0;',
    '  for(int i=1;i<=R;i++){',
    '    for(int s=-1;s<=1;s+=2){',
    '      ivec2 t = tc + uDir*(i*s*st);',
    '      if(t.x<0||t.y<0||t.x>=uSize.x||t.y>=uSize.y) continue;',
    '      vec4 sm = texelFetch(uSrc,t,0);',
    '      open += sm.a; seen += 1.0;',
    '      float d = sm.r;',
    '      if(d <= 0.0) continue;',
    '      float dd = d - c.r;',
    '      float w = exp(-float(i*i)*uSigR - dd*dd*uSigD);',
    '      sum += d*w; wsum += w;',
    '    }',
    '  }',
    '  oCol = vec4(sum/wsum, c.g, c.b, open/seen);',
    '}'
  ].join('\n');

  // ---------------------------------------------------------------
  //  2b. thickness blur
  // ---------------------------------------------------------------
  //  THE BLOBS CAME FROM HERE, not from the surface.
  //
  //  The depth buffer is smoothed and the coverage ramp is smooth, but the
  //  THICKNESS was never filtered at all - and thickness is what carries the
  //  colour, through exp(-uAbsorb*thick). Over a pool many particles deep
  //  that integral is already smooth and nobody noticed. Over a film one
  //  particle deep it has exactly one bump per particle, so the water came
  //  out as a pale sheet stamped with a blue dot at every sphere centre.
  //  That is the "lots of small blobs" report: not the geometry, the tint.
  //
  //  Widening the depth kernel does not touch it - measured, the dots
  //  survive unchanged - so the thickness needs its own pass.
  //
  //  It must not spread OUTWARD, or it re-opens the halo that the coverage
  //  ramp was tightened to close. So the filter is masked by the depth
  //  buffer: a tap only counts where there is actually a surface, and a
  //  pixel with no surface is passed through untouched. The silhouette is
  //  therefore bit-identical before and after, and only the interior moves.
  var FS_TBLUR = HEAD + [
    '#define R 10',
    'uniform sampler2D uSrc, uSurf;',
    'uniform ivec2 uDir, uSize;',
    'uniform float uSigR, uKernel, uKernelMax;',
    'out vec4 oCol;',
    'void main(){',
    '  ivec2 tc = ivec2(gl_FragCoord.xy);',
    '  vec4 c = texelFetch(uSrc,tc,0);',
    '  float dc = texelFetch(uSurf,tc,0).r;',
    '  if(dc <= 0.0){ oCol = c; return; }',
    '  //  same particle-sized stride as the depth blur, for the same reason',
    '  float stf = clamp(uKernel / (dc * float(R)), 1.0, uKernelMax);',
    '  int st = int(stf + 0.5);',
    '  vec2 sum = c.rg; float wsum = 1.0;',
    '  for(int i=1;i<=R;i++){',
    '    for(int s=-1;s<=1;s+=2){',
    '      ivec2 t = tc + uDir*(i*s*st);',
    '      if(t.x<0||t.y<0||t.x>=uSize.x||t.y>=uSize.y) continue;',
    '      if(texelFetch(uSurf,t,0).r <= 0.0) continue;   // outside the water',
    '      float w = exp(-float(i*i)*uSigR);',
    '      sum += texelFetch(uSrc,t,0).rg*w; wsum += w;',
    '    }',
    '  }',
    '  oCol = vec4(sum/wsum, c.b, c.a);',
    '}'
  ].join('\n');

  // ---------------------------------------------------------------
  //  3. normals from the smoothed depth
  // ---------------------------------------------------------------
  //  Central differences smear the normal across a silhouette and put a
  //  bright rim round every pool. Taking whichever neighbour is CLOSER in
  //  depth keeps the edge honest.
  var FS_NORMAL = HEAD + [
    'uniform sampler2D uDepth;',
    'uniform vec2 uInvRes, uTan;',
    'uniform ivec2 uSize;',
    'out vec4 oNrm;',
    'float dAt(ivec2 t){ return texelFetch(uDepth,clamp(t,ivec2(0),uSize-1),0).r; }',
    'vec3 eyeAt(vec2 uv,float d){ return vec3((uv*2.0-1.0)*uTan*d, -d); }',
    'void main(){',
    '  ivec2 tc = ivec2(gl_FragCoord.xy);',
    '  float c = dAt(tc);',
    '  if(c <= 0.0){ oNrm = vec4(0.0,0.0,1.0,0.0); return; }',
    '  vec2 uv = (vec2(tc)+0.5)*uInvRes;',
    '  vec3 Pp = eyeAt(uv,c);',
    '  float xr=dAt(tc+ivec2(1,0)), xl=dAt(tc+ivec2(-1,0));',
    '  float yu=dAt(tc+ivec2(0,1)), yd=dAt(tc+ivec2(0,-1));',
    '  vec3 dx, dy;',
    '  bool okR = xr>0.0, okL = xl>0.0;',
    '  if(okR && (!okL || abs(xr-c) <= abs(c-xl))) dx = eyeAt(uv+vec2(uInvRes.x,0.0),xr)-Pp;',
    '  else if(okL) dx = Pp-eyeAt(uv-vec2(uInvRes.x,0.0),xl);',
    '  else dx = vec3(uTan.x*c*uInvRes.x*2.0,0.0,0.0);',
    '  bool okU = yu>0.0, okD = yd>0.0;',
    '  if(okU && (!okD || abs(yu-c) <= abs(c-yd))) dy = eyeAt(uv+vec2(0.0,uInvRes.y),yu)-Pp;',
    '  else if(okD) dy = Pp-eyeAt(uv-vec2(0.0,uInvRes.y),yd);',
    '  else dy = vec3(0.0,uTan.y*c*uInvRes.y*2.0,0.0);',
    '  oNrm = vec4(normalize(cross(dx,dy)), c);',
    '}'
  ].join('\n');

  // ---------------------------------------------------------------
  //  4. composite
  // ---------------------------------------------------------------
  var FS_COMP = HEAD + [
    'uniform sampler2D uScene, uNrmDepth, uThick, uSurf;',
    'uniform mat4 uInvView, uProj;',
    'uniform vec3 uCamPos, uSunDir, uSunCol, uSkyCol, uGndCol, uAbsorb, uScatter;',
    'uniform vec2 uInvRes, uTan;',
    'uniform float uTime, uThickK, uRefr, uToon, uTint;',
    'layout(location=0) out vec4 oColor;',
    'layout(location=1) out vec4 oNormal;',
    'float hash13(vec3 p){ p=fract(p*0.1031); p+=dot(p,p.zyx+31.32); return fract((p.x+p.y)*p.z); }',
    'float n3(vec3 x){ vec3 i=floor(x),f=fract(x); f=f*f*(3.0-2.0*f);',
    '  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x),mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),',
    '             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z); }',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy*uInvRes;',
    '  vec4 nd = texture(uNrmDepth,uv);',
    '  vec4 th = texture(uThick,uv);',
    '  //  A strict zero is not a cutoff. uScale is 0.055 per sprite and',
    '  //  the coverage ramp used to finish at 0.075, so ONE lone impostor',
    '  //  already painted at 0.78 coverage and two saturated it. The loose',
    '  //  skirt of the pool - stray droplets, the sprite fringe around every',
    '  //  particle - was therefore composited at full strength over sand with',
    '  //  no water on it. Reject anything thinner than a real film, before',
    '  //  the depth write.',
    '  if(nd.w <= 0.0 || th.r <= 0.14) discard;',
    '  //  SILHOUETTE CONFIDENCE. uSurf.a is the fraction of the blur kernel',
    '  //  that actually contained water - see FS_BLUR, which measures it for',
    '  //  free while it is already walking those texels. It is 1.0 well inside',
    '  //  a pool and about 0.5 on the outline, and the band over which it',
    '  //  falls off is by construction the band over which the blurred depth',
    '  //  is a ramp into empty space rather than a surface. Anything derived',
    '  //  from the normal there - Fresnel, and above all a 190-exponent mirror',
    '  //  lobe - is an artefact of the filter, and must not be trusted.',
    '  //  This is the test the ledger asked for and never got: a real',
    '  //  silhouette test, not another constant on the thickness.',
    '  float solid = texture(uSurf,uv).a;',
    '  float edge = smoothstep(0.35,0.85,solid);',
    '  //  Coverage decides whether the eye sees anything here, so it also',
    '  //  decides whether this fragment may write DEPTH. It used to write',
    '  //  unconditionally the moment th.r cleared 0.14, which stamps a water',
    '  //  surface into the scene depth buffer at pixels drawn with a coverage',
    '  //  of one percent - and SSAO, the DOF circle of confusion and the ink',
    '  //  Sobel all read that buffer and act on a surface nobody can see.',
    '  float cov = smoothstep(0.14,0.46,th.r);',
    '  if(cov <= 0.004) discard;',
    '  float depth = nd.w;',
    '  vec3 nEye = normalize(nd.xyz);',
    '  vec3 Pe = vec3((uv*2.0-1.0)*uTan*depth, -depth);',
    '  vec4 cl = uProj*vec4(Pe,1.0);',
    '  //  Write the surface depth and let the hardware depth test decide',
    '  //  what is in front. Sampling the scene depth texture here instead',
    '  //  is a feedback loop - it is the depth attachment of the very',
    '  //  framebuffer being drawn into - and GL answers that with',
    '  //  INVALID_OPERATION and no water at all.',
    '  gl_FragDepth = clamp((cl.z/cl.w)*0.5+0.5,0.0,1.0);',
    '  float thick = th.r*uThickK;',
    '  mat3 R3 = mat3(uInvView);',
    '  vec3 N = normalize(R3*nEye);',
    '  //  A NORMAL WE DO NOT BELIEVE IS REPLACED, NOT PUNISHED.',
    '  //',
    '  //  Near the outline the smoothed depth is a one-sided ramp falling off',
    '  //  the edge of the data, so the rebuilt normal is edge-on: nv goes to',
    '  //  zero, Fresnel goes to one, and the shader paints a mirror ring. The',
    '  //  first attempt at this gated the reflection off wherever the normal',
    '  //  was suspect - which removes the ring, and also removes the sheen',
    '  //  from every pool too small to have a trusted middle. Measured on a',
    '  //  shallow spread: the water stopped being drawn at all.',
    '  //',
    '  //  A pool lies on the ground, so the honest fallback is not "no',
    '  //  reflection" but "flat". Blending toward world up as confidence',
    '  //  falls gives the rim a normal it could plausibly have, Fresnel is',
    '  //  computed from something real everywhere, and the ring never forms',
    '  //  because nv never collapses.',
    '  N = normalize(mix(vec3(0.0,1.0,0.0), N, edge));',
    '  vec3 Pw = (uInvView*vec4(Pe,1.0)).xyz;',
    '  vec3 V = normalize(uCamPos-Pw);',
    '  //  live ripples, only where there is a real body of water',
    '  vec3 dn = vec3(n3(Pw*5.5+vec3(0.0,uTime*0.55,0.0)),',
    '                 n3(Pw*7.1+vec3(23.1,-uTime*0.42,7.3)),',
    '                 n3(Pw*6.3+vec3(51.7,4.2,uTime*0.37)))-0.5;',
    '  //  Keep the geometric normal before the ripple goes on. Attachment 1',
    '  //  is read by exactly two passes - SSAO and the ink outline - and',
    '  //  neither wants shading detail. The ink pass runs a Sobel over it and',
    '  //  draws a black mark wherever it finds a crease, so handing it the',
    '  //  rippled normal stippled every pool with soot. Measured by turning',
    '  //  the ink pass off: the speckle is entirely it.',
    '  vec3 Ng = N;',
    '  N = normalize(N + dn*0.13*smoothstep(0.05,0.55,thick));',
    '  float nv = max(dot(N,V),1.0e-4);',
    '  float F = 0.02 + 0.98*pow(1.0-nv,5.0);',
    '  //  THE HALO. At the feathered edge of the thickness splats the',
    '  //  reconstructed normal is edge-on, so nv goes to zero and Fresnel',
    '  //  goes to ONE - the shader then draws pure sky reflection, brighter',
    '  //  than the sky itself, across a soft ring far wider than the pool.',
    '  //  Premultiplying the colour did not touch this: the halo is not a',
    '  //  blending error, it is a mirror where there are two particles of',
    '  //  water. Reflection needs a body of water to reflect in.',
    '  float body = smoothstep(0.10,0.60,th.r);',
    '  //  Two independent reasons not to draw a mirror: there is no body of',
    '  //  water to reflect in (body), or there is water but the normal here',
    '  //  was invented by the depth blur (edge). Thickness alone was never',
    '  //  enough - at the rim th.r is 0.3 to 0.6, so body is 0.5 to 1.0 and',
    '  //  Fresnel still reached 0.5 to 1.0 on a normal that is an artefact.',
    '  F = mix(0.02,F,body);',
    '  //  refraction, with a touch of dispersion so the rim splits colour',
    '  float bend = uRefr*min(thick,1.4)*0.225/max(depth*0.45,0.25);',
    '  vec2 off = nEye.xy*bend;',
    '  vec3 refr;',
    '  refr.r = texture(uScene,clamp(uv+off*0.988,vec2(0.001),vec2(0.999))).r;',
    '  refr.g = texture(uScene,clamp(uv+off,vec2(0.001),vec2(0.999))).g;',
    '  refr.b = texture(uScene,clamp(uv+off*1.017,vec2(0.001),vec2(0.999))).b;',
    '  //  ABSORPTION carries the colour and the sense of depth. Scattering',
    '  //  only fills the shallows - weight it the other way and every pool',
    '  //  turns into warm milk.',
    '  vec3 atten = exp(-uAbsorb*thick);',
    '  float nl = max(dot(N,uSunDir),0.0);',
    '  //  WHY THIN WATER WAS COLOURLESS.',
    '  //',
    '  //  Both colour terms are driven by THICKNESS. Absorption is',
    '  //  exp(-uAbsorb*thick) and scattering is 1-exp(-thick*0.55), so a film',
    '  //  one particle deep gets atten ~ 1 and sct ~ 0: the sand behind is',
    '  //  handed through untouched and the water is invisible. That is',
    '  //  honest optics - a few millimetres of water over pale sand really is',
    '  //  clear - and it is wrong for this game, where a poured puddle has to',
    '  //  read as water at a glance against a storybook tank.',
    '  //',
    '  //  The doctrine at the top of this file still holds: absorption',
    '  //  carries the colour and the sense of DEPTH, scattering only fills',
    '  //  the shallows. This gives the shallows something to fill with. The',
    '  //  floor rides on COVERAGE, not on thickness, so it appears exactly',
    '  //  where the surface is and nowhere else - cov is the silhouette-tight',
    '  //  ramp, so a tint keyed to it cannot bleed onto the sand the way a',
    '  //  thickness-keyed one would.',
    '  float sct = max(1.0-exp(-thick*0.55), cov*uTint*1.8);',
    '  vec3 trans = refr*atten;',
    '  trans += uScatter*sct*0.20*(0.34+0.66*nl)*mix(1.0,0.45,clamp(thick*0.5,0.0,1.0));',
    '  //  and a shallow film still TINTS what it lets through, or a puddle on',
    '  //  bright sand comes out as a grey sheen rather than as water. Scaled',
    '  //  by uScatter, so it is the same blue the deep water absorbs toward,',
    '  //  and multiplied rather than added so it darkens as it colours - wet',
    '  //  sand under water is not brighter than dry sand beside it.',
    '  trans = mix(trans, trans*uScatter*2.2, cov*uTint);',
    '  vec3 Rv = reflect(-V,N);',
    '  vec3 refl = mix(uGndCol,uSkyCol,Rv.y*0.5+0.5);',
    '  vec3 hv = normalize(uSunDir+V);',
    '  float spec = pow(max(dot(N,hv),0.0),190.0);',
    '  //  banded highlight when the scene is toon-shaded, so the water sits',
    '  //  in the same drawn language as everything else',
    '  spec = mix(spec, step(0.35,spec)*0.9, uToon);',
    '  //  THE PALE WASH PAST THE TANK. sunCol is [2.05,1.74,1.37] and the toon',
    '  //  step pins spec at 0.9, so this term writes 6.27 into a float target',
    '  //  whose bloom threshold is 1.45 - and bloom is six mip levels at',
    '  //  scatter 1.0, the only pass in the frame that can carry water',
    '  //  brightness hundreds of pixels over sand. Inside a pool Fresnel is',
    '  //  about 0.08 and the glint stays under threshold; it is the rim, where',
    '  //  the fabricated edge-on normal drives Fresnel to 0.8, that lights up.',
    '  //  An exponent of 190 is the most normal-sensitive quantity here, so it',
    '  //  is the last thing that may be computed from a normal we have just',
    '  //  measured as untrustworthy.',
    '  spec *= body;',
    '  refl += uSunCol*spec*3.4;',
    '  vec3 col = mix(trans,refl,F);',
    '  //  aeration only reads as white water where there is a body to aerate',
    '  float foam = clamp(th.g/max(th.r,1.0e-4),0.0,1.0);',
    '  col = mix(col, col*0.45+vec3(0.80,0.91,1.0)*0.55,',
    '            clamp(foam*1.1,0.0,0.62)*smoothstep(0.18,0.70,thick));',
    '  //  PREMULTIPLIED. The composite blends with premul (src + dst*(1-a)),',
    '  //  so the colour has to be scaled by its own coverage. It was not:',
    '  //  at the feathered edge, where cov is around 0.1, the full water',
    '  //  colour was ADDED on top of 90% of the sand. That is the dark oily',
    '  //  halo that spread far past the pool - it appeared wherever the soft',
    '  //  thickness splats left a trace, which is a long way outside the',
    '  //  water itself.',
    '  //  The ramp now ends where absorption starts to bite rather than two',
    '  //  particles in, so the sheet stops being opaque while still invisible.',
    '  //  The ramp used to open at 0.045, which is the outermost feather',
    '  //  of the thickness splats - a place with no water in it, only the',
    '  //  tail of a gaussian, and the place where the reconstructed normal',
    '  //  is pure noise. Starting the sheet there is what drew a soft ring',
    '  //  metres wide around every pool. It now opens where there is',
    '  //  actually a film to see. The ramp itself now runs at the top of the',
    '  //  shader, because the depth write has to obey it too.',
    '  oColor = vec4(col*cov,cov);',
    '  //  Attachment 1 rides the SAME premultiplied blend, so an',
    '  //  unpremultiplied normal accumulates into the buffer and saturates',
    '  //  it. SSAO reads exactly this buffer, got a badly wrong normal over',
    '  //  the pool and returned heavy occlusion, which its blur then spread',
    '  //  outward - a second dark fringe on top of the first, and one the',
    '  //  colour fix alone would not have removed.',
    '  //  ALPHA MUST BE THE COVERAGE. Under premul (ONE, ONE_MINUS_SRC_ALPHA)',
    '  //  it is the alpha, not the colour, that removes what is already in the',
    '  //  buffer. This wrote 0.03, so the scene normal was never removed and',
    '  //  the water normal was simply ADDED on top of it - and attachment 1 is',
    '  //  fixed-point RGBA8, so the sum clamps and every pool reads back as',
    '  //  white. SSAO decodes that as N=(1,1,1), orients its hemisphere forty-',
    '  //  five degrees into the surface, and returns near-total occlusion,',
    '  //  which its half-res blur then smears about thirty-five pixels past',
    '  //  the pool. With alpha = cov the write is the lerp it was meant to be.',
    '  //  FLATTENED HARD, on purpose. Attachment 1 is read by exactly two',
    '  //  passes - SSAO and the ink outline - and neither is shading the',
    '  //  water, they are asking what shape is here. A pool is a horizontal',
    '  //  sheet; the ripple in the reconstruction is a filter artefact, not',
    '  //  geometry. The ink pass runs a Sobel over this buffer and draws a',
    '  //  black mark wherever two neighbours disagree, so handing it the raw',
    '  //  reconstructed normal stippled every pool with soot. Confirmed by',
    '  //  zeroing that term: the speckle is entirely it, and the depth term',
    '  //  alone still draws the outline round the pool, which is wanted.',
    '  //',
    '  //  Flattening here and not in the ink pass keeps creases on ants,',
    '  //  props and dug soil, which is the whole point of that pass.',
    '  vec3 Ngb = normalize(mix(vec3(0.0,1.0,0.0), Ng, 0.25));',
    '  oNormal = vec4((Ngb*0.5+0.5)*cov, cov);',
    '}'
  ].join('\n');

  // ---------------------------------------------------------------
  //  MIGRATION STAGE 7 - the fullscreen half of this module on three
  // ---------------------------------------------------------------
  //  The GLSL in this file is NOT covered by tools/glsl_lint.js, so every
  //  one of these is carried across verbatim and reviewed by hand. A typo
  //  here does not fail loudly - it fails into a black frame.
  //
  //  ivec2 uniforms are passed as plain arrays. three's setValueV2i calls
  //  gl.uniform2iv with whatever it is given, and a Vector2 is not an
  //  array-like it accepts.
  var WP = {};
  function mkPasses() {
    if (WP.blur) return;
    var T3 = AF.T3;
    WP.blur = T3.pass('wblur', FS_BLUR, {
      uSrc: null, uDir: [1, 0], uSize: [1, 1],
      uSigR: 0, uSigD: 0, uKernel: 1, uKernelMax: 6
    });
    WP.tblur = T3.pass('wtblur', FS_TBLUR, {
      uSrc: null, uSurf: null, uDir: [1, 0], uSize: [1, 1],
      uSigR: 0, uKernel: 1, uKernelMax: 3
    });
    WP.nrm = T3.pass('wnrm', FS_NORMAL, {
      uDepth: null, uInvRes: [1, 1], uTan: [1, 1], uSize: [1, 1]
    });
    WP.comp = T3.pass('wcomp', FS_COMP, {
      uScene: null, uNrmDepth: null, uThick: null, uSurf: null,
      uInvView: new THREE.Matrix4(), uProj: new THREE.Matrix4(),
      uCamPos: new THREE.Vector3(), uSunDir: new THREE.Vector3(),
      uSunCol: new THREE.Vector3(), uSkyCol: new THREE.Vector3(),
      uGndCol: new THREE.Vector3(), uAbsorb: new THREE.Vector3(),
      uScatter: new THREE.Vector3(),
      uInvRes: [1, 1], uTan: [1, 1],
      uTime: 0, uThickK: 1, uRefr: 1, uToon: 1, uTint: 0.3
    });
    //  The composite is NOT an ordinary post pass. It writes gl_FragDepth
    //  from the reconstructed surface, blends premultiplied into the scene
    //  target, and writes both MRT outputs. T3.Pass defaults to no depth and
    //  no blend, which is right for everything else in the post chain and
    //  wrong for every part of this one.
    //
    //  Depth WRITE matters more than it looks: the ink outline is a Sobel
    //  over depth and normals, so with the write off water can never receive
    //  an outline at all - in a game drawn in ink that is most of "the water
    //  looks wrong".
    var m = WP.comp.material;
    m.depthTest = true;
    m.depthWrite = true;
    m.depthFunc = THREE.LessDepth;
    AF.T3.applyBlend(m, 'premul');
    m.side = THREE.DoubleSide;
  }

  //  THE IMPOSTOR PASSES.
  //
  //  Both are GL_POINTS with a shader-computed gl_PointSize and a Y-FLIPPED
  //  gl_PointCoord. Nothing about that is three-shaped, but nothing about it
  //  needs to change either: THREE.Points issues drawArrays(POINTS) and a
  //  RawShaderMaterial's gl_PointSize is honoured as-is. What matters is
  //  that the geometry wraps the SAME interleaved buffer the raw path fills
  //  - stride 6 floats, aP at 0 and aI at 3 - so WR.gather stays untouched
  //  and there is one copy of the particle data, not two.
  //
  //  Losing the Y flip tips every reconstructed sphere normal upside down
  //  and the pool lights from below; losing the point-size scale gives
  //  either one-pixel sprites (invisible water) or 200-pixel ones (the tank
  //  floods blue). Both shaders are carried across verbatim.
  var _ptsGeo = null, _ptsDepth = null, _ptsThick = null, _ptsObj = null;
  function mkPoints() {
    if (_ptsGeo) return;
    var T = THREE;
    _ptsGeo = new T.BufferGeometry();
    //  A strided view over the existing array, not a copy.
    var buf = new T.InterleavedBuffer(data, STRIDE);
    buf.setUsage(T.DynamicDrawUsage);
    _ptsGeo.setAttribute('aP', new T.InterleavedBufferAttribute(buf, 3, 0));
    _ptsGeo.setAttribute('aI', new T.InterleavedBufferAttribute(buf, 3, 3));
    _ptsGeo._buf = buf;
    //  Every particle carries its own absolute world position, so a bounding
    //  sphere off the base data means nothing and three would cull the lot.
    _ptsGeo.boundingSphere = new T.Sphere(new T.Vector3(), Infinity);

    _ptsDepth = new T.RawShaderMaterial({
      glslVersion: T.GLSL3,
      vertexShader: AF.T3.strip(VS_PART), fragmentShader: AF.T3.strip(FS_DEPTH),
      uniforms: {
        uView: { value: new T.Matrix4() }, uProj: { value: new T.Matrix4() },
        uPointScale: { value: 1 }
      },
      depthTest: true, depthWrite: true, depthFunc: T.LessDepth,
      blending: T.NoBlending, transparent: false, side: T.DoubleSide
    });
    _ptsThick = new T.RawShaderMaterial({
      glslVersion: T.GLSL3,
      vertexShader: AF.T3.strip(VS_PART), fragmentShader: AF.T3.strip(FS_THICK),
      uniforms: {
        uView: { value: new T.Matrix4() }, uProj: { value: new T.Matrix4() },
        uSurf: { value: null }, uInvRes: { value: new T.Vector2() },
        uPointScale: { value: 1 }, uScale: { value: 0.13 }
      },
      depthTest: false, depthWrite: false, depthFunc: T.LessDepth,
      side: T.DoubleSide
    });
    //  addpre is blendFunc(ONE, ONE). Thickness is an ACCUMULATION buffer
    //  whose splats write alpha 0 in one channel, so any SRC_ALPHA source
    //  factor multiplies the whole field by zero and every pool loses its
    //  colour. three's AdditiveBlending is SRC_ALPHA,ONE - not this.
    AF.T3.applyBlend(_ptsThick, 'addpre');

    _ptsObj = new T.Points(_ptsGeo, _ptsDepth);
    _ptsObj.frustumCulled = false;
    _ptsObj.matrixAutoUpdate = false;
    _ptsObj.matrixWorld.identity();
  }

  function drawImpostors(R, cam, w, h, pointScale) {
    mkPoints();
    var T3 = AF.T3;
    //  n particles, never the capacity - the tail of `data` still holds
    //  last frame's positions and always will.
    _ptsGeo.setDrawRange(0, nPart);
    _ptsGeo._buf.needsUpdate = true;

    var du = _ptsDepth.uniforms;
    du.uView.value.fromArray(cam.view);
    du.uProj.value.fromArray(cam.proj);
    du.uPointScale.value = pointScale;
    _ptsObj.material = _ptsDepth;
    FB.depth.bind(true, 0, 0, 0, 0);
    gl.clearDepth(1.0); gl.clear(gl.DEPTH_BUFFER_BIT);
    AF.T3B.drawObjectInto(_ptsObj, FB.depth);

    var tu = _ptsThick.uniforms;
    tu.uView.value.fromArray(cam.view);
    tu.uProj.value.fromArray(cam.proj);
    tu.uSurf.value = T3.tex(FB.depth);
    tu.uInvRes.value.set(1 / w, 1 / h);
    tu.uPointScale.value = pointScale;
    //  read at draw time, not cached at init
    tu.uScale.value = WR.thickScale;
    _ptsObj.material = _ptsThick;
    FB.thick.bind(true, 0, 0, 0, 0);
    AF.T3B.drawObjectInto(_ptsObj, FB.thick);
  }

  var _iv3 = null;
  function drawComposite(R, env, cam, tanX, tanY) {
    var T3 = AF.T3, u = WP.comp.uniforms;
    u.uScene.value = T3.tex(R.copyFB, 0);
    u.uNrmDepth.value = T3.tex(FB.nrm);
    u.uThick.value = T3.tex(FB.thick);
    u.uSurf.value = T3.tex(FB.depth);
    u.uInvView.value.fromArray(cam.invView || _invView(cam));
    u.uProj.value.fromArray(cam.proj);
    u.uCamPos.value.fromArray(cam.pos);
    u.uSunDir.value.fromArray(env.sunDir);
    u.uSunCol.value.fromArray(env.sunCol);
    u.uSkyCol.value.fromArray(env.skyCol);
    u.uGndCol.value.fromArray(env.gndCol);
    //  Beer-Lambert: red goes first, blue survives longest.
    u.uAbsorb.value.set(2.60, 0.95, 0.42);
    u.uScatter.value.set(0.22, 0.52, 0.78);
    u.uInvRes.value = [1 / R.width, 1 / R.height];
    u.uTan.value = [tanX, tanY];
    u.uTime.value = env.time;
    //  Read at DRAW time, never cached into the material at init - BUGS.md
    //  documents the only trusted water measurement as poking these from
    //  the console between two reads of the same frame (B35).
    u.uThickK.value = WR.thickK;
    u.uTint.value = WR.tint;
    u.uRefr.value = 1.0;
    u.uToon.value = env.toon === undefined ? 1 : env.toon;
    WP.comp.render(R.sceneFB);
    //  Hand the raw path its binding back: resetState unbinds the target,
    //  and everything after this assumes sceneFB is still current.
    R.sceneFB.bind(false);
    R.stats.draws++;
  }

  // ---------------------------------------------------------------
  //  setup
  // ---------------------------------------------------------------
  WR.init = function (R) {
    gl = R.gl; GLX = AF.GLX;

    data = new Float32Array((AF.PS ? AF.PS.MAX_RESIDENT : 2600) * STRIDE);
    vbo = gl.createBuffer();
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE * 4, 12);
    gl.bindVertexArray(null);
    WR.ready = true;
  };

  WR.resize = function (w, h) {
    var F16 = { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
    if (FB.depth) { FB.depth.destroy(); FB.blur.destroy(); FB.nrm.destroy(); FB.thick.destroy(); FB.thick2.destroy(); }
    //  Half resolution. Four bilateral passes with a 29-tap kernel at full
    //  res is ~170M texture fetches a frame and simply will not hold 60fps;
    //  at half res it is a quarter of that, and because the filter's job is
    //  to REMOVE detail the loss is invisible. The composite samples it
    //  bilinearly at full res.
    //  Full resolution after all. At half res the silhouette comes back as
    //  visible stair steps, and because the ink pass outlines whatever edge
    //  it finds, those steps get drawn in black. The cost is paid back by
    //  running ONE blur iteration with a wider range sigma instead of two.
    var fw = w, fh = h;
    //  MIGRATION STAGE 7. Same adapter as the rest of the renderer, so these
    //  can be both bound raw by the impostor passes and rendered into by
    //  three's fullscreen passes. HalfFloat throughout is not optional: the
    //  thickness target is an ACCUMULATION buffer and an UnsignedByte one
    //  would clamp the sum at 1.0, which is most of the water's colour (L17).
    var mk = function (spec) {
      return (AF.T3 && AF.T3.ready && AF.R && AF.R.useThreeTargets)
        ? AF.T3.fbo(spec) : new GLX.FBO(spec);
    };
    FB.depth = mk({ width: fw, height: fh, depth: true, color: [F16] });
    FB.blur = mk({ width: fw, height: fh, color: [F16] });
    FB.nrm = mk({ width: fw, height: fh, color: [F16] });
    FB.thick = mk({ width: fw, height: fh, color: [F16] });
    FB.thick2 = mk({ width: fw, height: fh, color: [F16] });
    FB.w = fw; FB.h = fh; FB.srcW = w; FB.srcH = h;
  };

  // ---------------------------------------------------------------
  //  gather live water particles
  // ---------------------------------------------------------------
  WR.gather = function () {
    var PS = AF.PS;
    nPart = 0;
    if (!PS) return 0;
    var px = PS.px, py = PS.py, pz = PS.pz, alive = PS.alive, mat = PS.mat;
    var nbrN = PS.nbrN, rad = PS.rad, k = 0;
    //  BURIED WATER IS NOT DRAWN.
    //
    //  Pour a lot of water and much of it soaks INTO the soil. Those
    //  particles are inside solid ground, invisible by any honest account -
    //  but the thickness pass had no depth test of any kind, so they kept
    //  writing thickness at their screen position and the composite shaded
    //  all the earth in front of them as though you were looking through
    //  water. That is the wash around a flooded pit.
    //
    //  Testing it in the shader against the scene depth buffer does not
    //  work: measured on a live tank with 2600 particles sealed inside
    //  solid soil, that buffer reports something FARTHER away than the
    //  water at those pixels, so the comparison never fires. The soil's
    //  own distance field is the honest source, it is already on the CPU,
    //  and it costs one lookup per particle.
    //
    //  Water in a tunnel or a chamber sits in open air (sdf > 0) and still
    //  renders - only what is sealed inside earth is skipped.
    var farm = AF.Game && AF.Game.activeFarm;
    if (!farm && AF.Game && AF.Game.player) farm = AF.Game.player.farms[0];
    var sdf = farm && farm.soilSDF ? farm : null;
    for (var i = 0; i < PS.MAX_RESIDENT; i++) {
      if (!alive[i] || mat[i] !== PS.MAT_WATER) continue;
      if (sdf && sdf.soilSDF(px[i], py[i], pz[i]) < -0.12) continue;
      data[k] = px[i]; data[k + 1] = py[i]; data[k + 2] = pz[i];
      data[k + 3] = rad[i];
      data[k + 4] = 0;
      data[k + 5] = Math.min(1, nbrN[i] / 22);
      k += STRIDE; nPart++;
    }
    return nPart;
  };

  // ---------------------------------------------------------------
  //  the frame
  // ---------------------------------------------------------------
  WR.draw = function (R, env, cam) {
    if (!WR.ready) return;
    //  R.resize can run before this module is initialised, in which case the
    //  targets were never made. Build them on first use rather than waiting
    //  for a window resize that may never come.
    if (!FB.depth || FB.srcW !== R.width || FB.srcH !== R.height) WR.resize(R.width, R.height);
    if (!WR.gather()) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, nPart * STRIDE));

    var w = FB.w, h = FB.h;
    var tanX = 1 / cam.proj[0], tanY = 1 / cam.proj[5];
    var pointScale = h * cam.proj[5];   // h is the half-res height

    gl.bindVertexArray(vao);

    var impostorsOnThree = !!(AF.T3 && AF.T3.ready && AF.T3B && AF.T3B.ready &&
      FB.depth.rt && WR.useThree);
    drawImpostors(R, cam, w, h, pointScale);
    gl.bindVertexArray(null);
    // ---- bilateral blur ----
    //  The RANGE sigma has to be wider than a particle, or the filter treats
    //  the bump between two neighbouring spheres as a different surface and
    //  refuses to cross it - which leaves the pool looking cobbled. It must
    //  still be far smaller than the depth jump at the pool's edge, so the
    //  silhouette survives. Particle radius here is 0.37, pools are units
    //  deep, so 0.6 sits comfortably between the two.
    GLX.depth(false, false); GLX.blend(false);
    var sigR = 1.0 / (2.0 * 6.0 * 6.0);
    var sigD = 1.0 / (2.0 * 0.85 * 0.85);
    //  uKernel is pointScale * particle radius: divided by a pixel's depth in
    //  the shader it gives that particle's projected radius in texels, which
    //  is how far the ten taps have to reach to span one sphere. Without it
    //  the reach is ten texels at every zoom - fine across the tank, a fifth
    //  of a particle up close, which is what left every sphere its own bump.
    //  Capped, because a particle right against the glass projects to
    //  hundreds of texels and striding that far turns the filter into noise.
    var kernel = pointScale * ((AF.PS && AF.PS.RAD_WATER) || 0.37);
    //  A/B switch. The only trusted water measurement in this repo works by
    //  reading the same frame twice with one thing changed, so the two paths
    //  have to stay switchable from the console for as long as both exist.
    var T3 = AF.T3;
    mkPasses();
    for (var pass = 0; pass < 1; pass++) {
      {
        //  The ping-pong ENDS IN FB.depth. Swapping the last write leaves
        //  the normals rebuilt from the unsmoothed field and the pool comes
        //  back cobbled.
        WP.blur.render(FB.blur, { uSrc: T3.tex(FB.depth), uDir: [1, 0], uSize: [w, h],
          uSigR: sigR, uSigD: sigD, uKernel: kernel, uKernelMax: 6.0 });
        WP.blur.render(FB.depth, { uSrc: T3.tex(FB.blur), uDir: [0, 1], uSize: [w, h],
          uSigR: sigR, uSigD: sigD, uKernel: kernel, uKernelMax: 6.0 });
      }
    }

    // ---- thickness blur ----
    //  Runs AFTER the depth blur, because it masks itself against the depth
    //  buffer and wants the smoothed silhouette rather than the raw splats.
    //  Two passes, ping-ponging thick -> thick2 -> thick.
    {
      //  and this ping-pong ends in FB.thick, for the same reason
      WP.tblur.render(FB.thick2, { uSrc: T3.tex(FB.thick), uSurf: T3.tex(FB.depth),
        uDir: [1, 0], uSize: [w, h], uSigR: sigR,
        uKernel: kernel * 0.5, uKernelMax: 3.0 });
      WP.tblur.render(FB.thick, { uSrc: T3.tex(FB.thick2), uSurf: T3.tex(FB.depth),
        uDir: [0, 1], uSize: [w, h], uSigR: sigR,
        uKernel: kernel * 0.5, uKernelMax: 3.0 });
      WP.nrm.render(FB.nrm, { uDepth: T3.tex(FB.depth),
        uInvRes: [1 / w, 1 / h], uTan: [tanX, tanY], uSize: [w, h] });
      drawComposite(R, env, cam, tanX, tanY);
    }

  };

  var _iv = null;
  function _invView(cam) {
    if (!_iv) _iv = AF.M.m4.create();
    AF.M.m4.invert(_iv, cam.view);
    return _iv;
  }

  AF.WR = WR;

})(window.AF = window.AF || {});

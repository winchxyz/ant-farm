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

  //  Thickness: additive, no depth test. How much water is along this ray.
  var FS_THICK = HEAD + [
    'in vec3 vEye; in float vRad, vSpd, vPack;',
    'uniform float uScale;',
    'out vec4 oThick;',
    'void main(){',
    '  vec2 c = vec2(gl_PointCoord.x, 1.0-gl_PointCoord.y)*2.0-1.0;',
    '  float m = dot(c,c);',
    '  if(m > 1.0) discard;',
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
    'uniform float uSigR, uSigD;',
    'out vec4 oCol;',
    'void main(){',
    '  ivec2 tc = ivec2(gl_FragCoord.xy);',
    '  vec4 c = texelFetch(uSrc,tc,0);',
    '  if(c.r <= 0.0){ oCol = c; return; }',
    '  float sum = c.r, wsum = 1.0;',
    '  for(int i=1;i<=R;i++){',
    '    for(int s=-1;s<=1;s+=2){',
    '      ivec2 t = tc + uDir*(i*s);',
    '      if(t.x<0||t.y<0||t.x>=uSize.x||t.y>=uSize.y) continue;',
    '      float d = texelFetch(uSrc,t,0).r;',
    '      if(d <= 0.0) continue;',
    '      float dd = d - c.r;',
    '      float w = exp(-float(i*i)*uSigR - dd*dd*uSigD);',
    '      sum += d*w; wsum += w;',
    '    }',
    '  }',
    '  oCol = vec4(sum/wsum, c.g, c.b, c.a);',
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
    'uniform sampler2D uScene, uNrmDepth, uThick;',
    'uniform mat4 uInvView, uProj;',
    'uniform vec3 uCamPos, uSunDir, uSunCol, uSkyCol, uGndCol, uAbsorb, uScatter;',
    'uniform vec2 uInvRes, uTan;',
    'uniform float uTime, uThickK, uRefr, uToon;',
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
    '  if(nd.w <= 0.0 || th.r <= 0.045) discard;',
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
    '  vec3 Pw = (uInvView*vec4(Pe,1.0)).xyz;',
    '  vec3 V = normalize(uCamPos-Pw);',
    '  //  live ripples, only where there is a real body of water',
    '  vec3 dn = vec3(n3(Pw*5.5+vec3(0.0,uTime*0.55,0.0)),',
    '                 n3(Pw*7.1+vec3(23.1,-uTime*0.42,7.3)),',
    '                 n3(Pw*6.3+vec3(51.7,4.2,uTime*0.37)))-0.5;',
    '  N = normalize(N + dn*0.13*smoothstep(0.05,0.55,thick));',
    '  float nv = max(dot(N,V),1.0e-4);',
    '  float F = 0.02 + 0.98*pow(1.0-nv,5.0);',
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
    '  float sct = 1.0-exp(-thick*0.55);',
    '  vec3 trans = refr*atten;',
    '  trans += uScatter*sct*0.20*(0.34+0.66*nl)*mix(1.0,0.45,clamp(thick*0.5,0.0,1.0));',
    '  vec3 Rv = reflect(-V,N);',
    '  vec3 refl = mix(uGndCol,uSkyCol,Rv.y*0.5+0.5)*1.15;',
    '  vec3 hv = normalize(uSunDir+V);',
    '  float spec = pow(max(dot(N,hv),0.0),190.0);',
    '  //  banded highlight when the scene is toon-shaded, so the water sits',
    '  //  in the same drawn language as everything else',
    '  spec = mix(spec, step(0.35,spec)*0.9, uToon);',
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
    '  float cov = smoothstep(0.045,0.34,th.r);',
    '  oColor = vec4(col*cov,cov);',
    '  //  Attachment 1 rides the SAME premultiplied blend, so an',
    '  //  unpremultiplied normal accumulates into the buffer and saturates',
    '  //  it. SSAO reads exactly this buffer, got a badly wrong normal over',
    '  //  the pool and returned heavy occlusion, which its blur then spread',
    '  //  outward - a second dark fringe on top of the first, and one the',
    '  //  colour fix alone would not have removed.',
    '  oNormal = vec4((N*0.5+0.5)*cov, cov*0.03);',
    '}'
  ].join('\n');

  // ---------------------------------------------------------------
  //  setup
  // ---------------------------------------------------------------
  WR.init = function (R) {
    gl = R.gl; GLX = AF.GLX;
    P.part = GLX.program(VS_PART, FS_DEPTH, 'wdepth');
    P.thick = GLX.program(VS_PART, FS_THICK, 'wthick');
    P.blur = GLX.program(VS_FULL, FS_BLUR, 'wblur');
    P.nrm = GLX.program(VS_FULL, FS_NORMAL, 'wnrm');
    P.comp = GLX.program(VS_FULL, FS_COMP, 'wcomp');

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
    if (FB.depth) { FB.depth.destroy(); FB.blur.destroy(); FB.nrm.destroy(); FB.thick.destroy(); }
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
    FB.depth = new GLX.FBO({ width: fw, height: fh, depth: true, color: [F16] });
    FB.blur = new GLX.FBO({ width: fw, height: fh, color: [F16] });
    FB.nrm = new GLX.FBO({ width: fw, height: fh, color: [F16] });
    FB.thick = new GLX.FBO({ width: fw, height: fh, color: [F16] });
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
    for (var i = 0; i < PS.MAX_RESIDENT; i++) {
      if (!alive[i] || mat[i] !== PS.MAT_WATER) continue;
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

    // ---- depth ----
    FB.depth.bind(true, 0, 0, 0, 0);
    GLX.depth(true, true); GLX.blend(false); GLX.cull(false);
    gl.clearDepth(1.0); gl.clear(gl.DEPTH_BUFFER_BIT);
    P.part.use()
      .m4('uView', cam.view).m4('uProj', cam.proj)
      .f('uPointScale', pointScale);
    gl.drawArrays(gl.POINTS, 0, nPart);

    // ---- thickness (additive, no depth) ----
    FB.thick.bind(true, 0, 0, 0, 0);
    GLX.depth(false, false); GLX.blend('addpre');
    P.thick.use()
      .m4('uView', cam.view).m4('uProj', cam.proj)
      .f('uPointScale', pointScale).f('uScale', 0.055);
    gl.drawArrays(gl.POINTS, 0, nPart);
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
    for (var pass = 0; pass < 1; pass++) {
      FB.blur.bind(false);
      P.blur.use().tex('uSrc', FB.depth.color[0]);
      gl.uniform2i(P.blur.u['uDir'], 1, 0);
      gl.uniform2i(P.blur.u['uSize'], w, h);
      P.blur.f('uSigR', sigR).f('uSigD', sigD);
      GLX.fullscreen();

      FB.depth.bind(false);
      P.blur.use().tex('uSrc', FB.blur.color[0]);
      gl.uniform2i(P.blur.u['uDir'], 0, 1);
      gl.uniform2i(P.blur.u['uSize'], w, h);
      P.blur.f('uSigR', sigR).f('uSigD', sigD);
      GLX.fullscreen();
    }

    // ---- normals ----
    FB.nrm.bind(false);
    P.nrm.use().tex('uDepth', FB.depth.color[0])
      .v2('uInvRes', 1 / w, 1 / h).v2('uTan', tanX, tanY);
    gl.uniform2i(P.nrm.u['uSize'], w, h);
    GLX.fullscreen();

    // ---- composite back into the scene ----
    R.sceneFB.bind(false);
    gl.viewport(0, 0, R.width, R.height);
    GLX.depth(true, true);
    GLX.blend('premul');
    GLX.cull(false);
    var Pc = P.comp.use();
    Pc.tex('uScene', R.copyFB.color[0]);
    Pc.tex('uNrmDepth', FB.nrm.color[0]);
    Pc.tex('uThick', FB.thick.color[0]);
    Pc.m4('uInvView', cam.invView || _invView(cam));
    Pc.m4('uProj', cam.proj);
    Pc.v3('uCamPos', cam.pos);
    Pc.v3('uSunDir', env.sunDir);
    Pc.v3('uSunCol', env.sunCol);
    Pc.v3('uSkyCol', env.skyCol);
    Pc.v3('uGndCol', env.gndCol);
    //  Beer-Lambert coefficients: red goes first, blue survives longest.
    Pc.v3('uAbsorb', 2.60, 0.95, 0.42);
    Pc.v3('uScatter', 0.22, 0.52, 0.78);
    Pc.v2('uInvRes', 1 / R.width, 1 / R.height);
    Pc.v2('uTan', tanX, tanY);
    Pc.f('uTime', env.time);
    Pc.f('uThickK', 1.0);
    Pc.f('uRefr', 1.0);
    Pc.f('uToon', env.toon === undefined ? 1 : env.toon);
    GLX.fullscreen();
    GLX.blend(false);
    GLX.depth(true, false);
  };

  var _iv = null;
  function _invView(cam) {
    if (!_iv) _iv = AF.M.m4.create();
    AF.M.m4.invert(_iv, cam.view);
    return _iv;
  }

  AF.WR = WR;

})(window.AF = window.AF || {});

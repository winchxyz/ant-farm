/* =============================================================
   FORMICARIUM :: DEEP COLONY
   heap_render.js - drawing the sugar height field.

   One dynamic mesh, rebuilt only when the field changed, drawn in a
   single call. That is the whole point of moving sugar to a height field:
   the heap has ONE silhouette, so the ink pass draws one line around the
   mound. The previous version drew three hundred separate crystals, each
   with its own outline, and a poured heap read as a pile of gravel.

   Sugar is shaded bright and slightly translucent at the rim, with a
   sparkle that follows the surface so it reads as crystalline rather than
   as a snowdrift.
   ============================================================= */
(function (AF) {
  'use strict';

  var HR = {};
  var gl = null, GLX = null;
  var prog = null, vbo = null, ibo = null, vao = null;
  var vCap = 0, iCap = 0, iCount = 0;

  var HEAD = '#version 300 es\nprecision highp float;\n';

  var VS = HEAD + [
    'layout(location=0) in vec3 aP;',
    'layout(location=1) in vec3 aN;',
    'layout(location=2) in vec2 aI;   // thickness, wetness',
    'uniform mat4 uVP;',
    'out vec3 vW; out vec3 vN; out vec2 vI;',
    'void main(){ vW=aP; vN=aN; vI=aI; gl_Position=uVP*vec4(aP,1.0); }'
  ].join('\n');

  var FS = HEAD + [
    'in vec3 vW; in vec3 vN; in vec2 vI;',
    'uniform vec3 uCamPos, uSunDir, uSunCol, uSkyCol, uGndCol;',
    'uniform float uTime, uToon;',
    'layout(location=0) out vec4 oColor;',
    'layout(location=1) out vec4 oNormal;',
    'float h31(vec3 p){ p=fract(p*0.1031); p+=dot(p,p.zyx+31.32); return fract((p.x+p.y)*p.z); }',
    'void main(){',
    '  //  The rim of a heap tapers to nothing. Anything under about a grain',
    '  //  thick is dropped: not just to stop it z-fighting with the soil, but',
    '  //  because a sub-millimetre film still shades as solid white and a',
    '  //  spread-out heap then reads as sheets of paper lying on the sand.',
    '  if(vI.x < 0.11) discard;',
    '  vec3 N=normalize(vN);',
    '  vec3 V=normalize(uCamPos-vW);',
    '  float nl=max(dot(N,uSunDir),0.0);',
    '  //  banded diffuse, matching the toon soil around it',
    '  float band=nl;',
    '  if(uToon>0.5){ band = nl<0.30 ? 0.34 : (nl<0.68 ? 0.70 : 1.0); }',
    '  vec3 base=mix(vec3(0.93,0.925,0.905), vec3(0.72,0.695,0.660), vI.y);',
    '  vec3 col=base*(uSkyCol*0.26 + uSunCol*band*0.52);',
    '  //  crystalline sparkle: a hashed glint that only fires on grains',
    '  //  facing the light, so the heap twinkles as the camera moves',
    '  float g=h31(floor(vW*26.0));',
    '  float spec=pow(max(dot(reflect(-uSunDir,N),V),0.0),46.0);',
    '  //  Kept deliberately small. Sugar is bright to begin with, and the',
'  //  bloom in the post chain multiplies anything above white until the',
'  //  whole heap blows out into a featureless blob.',
'  col += uSunCol*spec*(0.10+0.30*step(0.72,g))*(1.0-vI.y*0.7);',
    '  //  a little bounce from the sand underneath',
    '  col += uGndCol*0.13*(1.0-nl);',
    '  oColor=vec4(col,1.0);',
    '  oNormal=vec4(N*0.5+0.5, 0.30);',
    '}'
  ].join('\n');

  HR.init = function (R) {
    gl = R.gl; GLX = AF.GLX;
    vao = gl.createVertexArray();
    vbo = gl.createBuffer();
    ibo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bindVertexArray(null);
    HR.ready = true;
  };

  //  Only touches the GPU when the field actually moved.
  HR.sync = function () {
    var HP = AF.Heap;
    if (!HR.ready || !HP || !HP.consumeDirty()) return;
    HP.buildMesh();
    var m = HP.mesh();
    iCount = m.indices;
    if (!iCount) return;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    var vBytes = m.verts * 32;
    if (vBytes > vCap) {
      vCap = Math.max(vBytes * 2, 65536);
      gl.bufferData(gl.ARRAY_BUFFER, vCap, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, m.vtx.subarray(0, m.verts * 8));
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    var iBytes = iCount * 4;
    if (iBytes > iCap) {
      iCap = Math.max(iBytes * 2, 65536);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, iCap, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, m.idx.subarray(0, iCount));
    gl.bindVertexArray(null);
    if (AF.T3B && AF.T3B.ready) threeSync(m);
  };

  //  MIGRATION STAGE 6: the heap on three.
  //
  //  The raw body is an interleaved 32-byte VBO - position, normal, then
  //  (thickness, wetness) - with a Uint32 index buffer, both grown by
  //  doubling and rewritten only when the sugar field actually moves.
  //  InterleavedBuffer maps that layout exactly, so the same m.vtx array is
  //  handed straight to three rather than being deinterleaved into three
  //  parallel attributes.
  //
  //  frustumCulled is off for the same reason as every batch: these are
  //  absolute world coordinates with an identity object matrix, and a
  //  bounding volume computed from them would be recomputed on every sync.
  var t3 = { geo: null, mesh: null, mat: null, ib: null, uni: null, vCap: 0, iCap: 0 };
  function threeSync(m) {
    var T = window.THREE;
    if (!t3.geo) {
      t3.geo = new T.BufferGeometry();
      t3.geo.boundingSphere = new T.Sphere(new T.Vector3(), Infinity);
    }
    var needV = m.verts * 8;
    if (!t3.ib || needV > t3.vCap) {
      t3.vCap = Math.max(needV * 2, 16384);
      t3.ib = new T.InterleavedBuffer(new Float32Array(t3.vCap), 8);
      t3.ib.setUsage(T.DynamicDrawUsage);
      t3.geo.setAttribute('aP', new T.InterleavedBufferAttribute(t3.ib, 3, 0));
      t3.geo.setAttribute('aN', new T.InterleavedBufferAttribute(t3.ib, 3, 3));
      t3.geo.setAttribute('aI', new T.InterleavedBufferAttribute(t3.ib, 2, 6));
    }
    t3.ib.array.set(m.vtx.subarray(0, needV));
    t3.ib.needsUpdate = true;
    if (!t3.geo.index || iCount > t3.iCap) {
      t3.iCap = Math.max(iCount * 2, 16384);
      t3.geo.setIndex(new T.BufferAttribute(new Uint32Array(t3.iCap), 1));
    }
    t3.geo.index.array.set(m.idx.subarray(0, iCount));
    t3.geo.index.needsUpdate = true;
    t3.geo.setDrawRange(0, iCount);
  }

  HR.drawThree = function (R, env, cam) {
    var T = window.THREE;
    if (!t3.geo) return false;
    if (!t3.mat) {
      t3.uni = {
        uVP: { value: new T.Matrix4() }, uCamPos: { value: new T.Vector3() },
        uSunDir: { value: new T.Vector3() }, uSunCol: { value: new T.Vector3() },
        uSkyCol: { value: new T.Vector3() }, uGndCol: { value: new T.Vector3() },
        uTime: { value: 0 }, uToon: { value: 1 }
      };
      t3.mat = AF.T3B.material('heap', VS, FS, t3.uni, { side: T.DoubleSide });
      t3.mesh = new T.Mesh(t3.geo, t3.mat);
      t3.mesh.frustumCulled = false;
      t3.mesh.matrixAutoUpdate = false;
      t3.mesh.matrixWorld.identity();
    }
    var u = t3.uni;
    u.uVP.value.fromArray(cam.vp);
    u.uCamPos.value.fromArray(cam.pos);
    u.uSunDir.value.fromArray(env.sunDir);
    u.uSunCol.value.fromArray(env.sunCol);
    u.uSkyCol.value.fromArray(env.skyCol);
    u.uGndCol.value.fromArray(env.gndCol);
    u.uTime.value = env.time;
    u.uToon.value = env.toon === undefined ? 1 : env.toon;
    AF.T3B.setCamera(cam);
    AF.T3B.drawObject(t3.mesh);
    return true;
  };

  //  MIGRATION STAGE 8. The raw body is gone; this is the three path and
  //  the only path. Kept as HR.draw so render_scene's call site is unchanged.
  HR.draw = function (R, env, cam) {
    if (!HR.ready || !iCount) return;
    HR.drawThree(R, env, cam);
  };

  AF.HeapR = HR;

})(window.AF = window.AF || {});

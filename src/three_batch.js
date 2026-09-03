/* =============================================================
   FORMICARIUM :: DEEP COLONY
   three_batch.js - MIGRATION STAGE 5. Instanced batches on three.

   A Batch is a fixed-capacity instance buffer rebuilt from live simulation
   state every frame: begin() rewinds a cursor, push() writes twenty floats
   into five parallel streams, upload() sends n instances, draw() issues one
   instanced call. Thirty-two of them carry everything visible in the tank.

   This file gives a Batch a second, three-backed body without changing any
   of that. The four surviving invariants, all of them load-bearing:

     * the draw count is `n`, never the capacity. The backing arrays are
       capacity-sized and are NEVER cleared - begin() only rewinds - so
       drawing at capacity resurrects thousands of ants frozen at last
       frame's positions (brief B13).
     * the instance streams carry divisor 1. Divisor 0 collapses a whole
       batch into one smear at the first instance's position (B13).
     * instance positions are absolute world coordinates and the object
       matrix is identity, so no bounding volume derived from the base mesh
       means anything. frustumCulled has to be off or entire batches pop out
       together the moment the world origin leaves the frustum (B14, L9).
     * meshR is measured off the very position array that becomes aPos, and
       gameplay reads it as the collision radius. It is not recomputed here;
       the same number is carried across (B26).

   Attribute NAMES do the work three used to do with fixed locations. The
   old design bound locations 0-8 by name before link so one VAO could feed
   the beauty pass and the shadow pass without re-specifying the layout
   (B12); three matches by name instead, which preserves the intent - one
   geometry, two materials - without the table.
   ============================================================= */
(function (AF) {
  'use strict';

  var TB = {};
  var R = null, THREE = null;

  //  One scratch scene and one camera, reused. three wants a graph; this
  //  renderer does not have one and must not grow one - all placement is in
  //  the instance streams already (B14). So the graph is a single node that
  //  is swapped per draw, and the camera is a bare Camera whose matrices are
  //  overwritten from the game's own Camera. Nothing is ever parented.
  var scene = null, camera = null;

  TB.init = function (renderer) {
    R = renderer; THREE = window.THREE;
    if (!THREE || !R.three) return false;
    scene = new THREE.Scene();
    scene.matrixAutoUpdate = false;
    scene.autoUpdate = false;
    camera = new THREE.Camera();
    camera.matrixAutoUpdate = false;
    TB.ready = true;
    return true;
  };

  //  The game's Camera hands out a view-projection it built itself. three
  //  wants projectionMatrix and matrixWorldInverse separately and multiplies
  //  them into projectionMatrix * matrixWorldInverse internally - so feed it
  //  the composed matrix as the projection and an identity view, which
  //  reproduces exactly the uVP the raw path binds.
  TB.setCamera = function (cam) {
    camera.projectionMatrix.fromArray(cam.vp);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.matrixWorld.identity();
    camera.matrixWorldInverse.identity();
  };

  // ------------------------------------------------------------------
  //  geometry
  // ------------------------------------------------------------------
  //  Built once per batch from the same builder arrays the raw Mesh uses,
  //  so the two bodies are the same triangles in the same order.
  TB.geometry = function (batch, builder) {
    var g = new THREE.InstancedBufferGeometry();
    g.setAttribute('aPos', new THREE.Float32BufferAttribute(new Float32Array(builder.pos), 3));
    g.setAttribute('aNrm', new THREE.Float32BufferAttribute(new Float32Array(builder.nrm), 3));
    g.setAttribute('aUV', new THREE.Float32BufferAttribute(new Float32Array(builder.uv), 2));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(builder.part), 4));
    var idx = builder.pos.length / 3 > 65535
      ? new Uint32Array(builder.idx) : new Uint16Array(builder.idx);
    g.setIndex(new THREE.BufferAttribute(idx, 1));

    //  The five instance streams, wrapping the SAME Float32Arrays the batch
    //  writes into. push() therefore needs no change at all - it keeps
    //  writing the typed arrays, and upload() just raises a dirty flag.
    function inst(name, arr) {
      var a = new THREE.InstancedBufferAttribute(arr, 4);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      return a;
    }
    batch._ia = {
      aIPos: inst('aIPos', batch.iPos),
      aIRot: inst('aIRot', batch.iRot),
      aIAnim: inst('aIAnim', batch.iAnim),
      aIColA: inst('aIColA', batch.iCol),
      aIData: inst('aIData', batch.iData)
    };
    //  A base-mesh bounding volume is meaningless when every instance
    //  carries its own absolute world position, and three would happily
    //  cull the whole batch on it.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    g.boundingBox = null;
    g.instanceCount = 0;
    return g;
  };

  // ------------------------------------------------------------------
  //  materials
  // ------------------------------------------------------------------
  //  One material per (program, uniform-group). The creature program is
  //  drawn three times a frame with a different uIsAnt - 2 for real ants,
  //  1 for the bestiary, 0 for brood and every prop - because the tagma
  //  tint is an ant colour pattern that must not reach a beetle, and
  //  because the brood stage selector keys off it (B16). Those are three
  //  materials sharing one shader, not three uniform writes.
  var mats = {};
  TB.material = function (key, vs, fs, uniforms, opts) {
    var m = mats[key];
    if (m) return m;
    opts = opts || {};
    m = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: AF.T3.strip(vs),
      fragmentShader: AF.T3.strip(fs),
      uniforms: uniforms,
      transparent: !!opts.transparent,
      depthTest: opts.depthTest === undefined ? true : opts.depthTest,
      depthWrite: opts.depthWrite === undefined ? true : opts.depthWrite,
      //  This codebase runs on GL's default LESS, never LEQUAL. Coplanar
      //  geometry here is separated by hand (the glass panes sit +0.10
      //  outside the soil box precisely because flush panes z-fight), and
      //  LEQUAL would turn those pairs into last-drawn-wins (B24, L4).
      depthFunc: THREE.LessDepth,
      side: opts.side === undefined ? THREE.FrontSide : opts.side,
      blending: opts.blending === undefined ? THREE.NoBlending : opts.blending
    });
    if (opts.blend) AF.T3.applyBlend(m, opts.blend);
    mats[key] = m;
    return m;
  };
  TB.materials = mats;

  // ------------------------------------------------------------------
  //  the draw
  // ------------------------------------------------------------------
  TB.draw = function (batch, material) {
    var n = batch.n;
    if (n === 0) return;
    var g = batch._geo;
    //  n, never cap. See B13 - the arrays behind these attributes still hold
    //  last frame's tail and always will.
    g.instanceCount = n;
    var ia = batch._ia;
    ia.aIPos.needsUpdate = true; ia.aIRot.needsUpdate = true;
    ia.aIAnim.needsUpdate = true; ia.aIColA.needsUpdate = true;
    ia.aIData.needsUpdate = true;
    var mesh = batch._mesh;
    if (!mesh) {
      mesh = batch._mesh = new THREE.Mesh(g, material);
      mesh.frustumCulled = false;         // L9 - mandatory, see B14
      mesh.matrixAutoUpdate = false;
      mesh.matrixWorld.identity();        // the object matrix IS identity
    }
    mesh.material = material;
    scene.children.length = 0;
    scene.add(mesh);
    R.three.render(scene, camera);
    R.stats.draws++;
    R.stats.instances += n;
    R.stats.tris += batch.triCount * n;
  };

  //  A plain (non-instanced) geometry from the same builder arrays. Used by
  //  the static meshes - the room, the tank frames, the glass box, the
  //  connecting tubes - which carry a real uModel rather than per-instance
  //  world positions, and so are the only geometry in this renderer that
  //  could legitimately be frustum culled. It still is not: the object
  //  matrix lives in a uniform the shader applies itself, so three's bounds
  //  would be computed in the wrong space.
  TB.geoFromBuilder = function (builder) {
    var g = new THREE.BufferGeometry();
    g.setAttribute('aPos', new THREE.Float32BufferAttribute(new Float32Array(builder.pos), 3));
    g.setAttribute('aNrm', new THREE.Float32BufferAttribute(new Float32Array(builder.nrm), 3));
    g.setAttribute('aUV', new THREE.Float32BufferAttribute(new Float32Array(builder.uv), 2));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(builder.part), 4));
    var idx = builder.pos.length / 3 > 65535
      ? new Uint32Array(builder.idx) : new Uint16Array(builder.idx);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    g.triCount = builder.idx.length / 3;
    return g;
  };

  //  Draw a bare geometry with a material, reusing one scratch Mesh. The
  //  caller has already written whatever per-draw uniforms it needs.
  var _scratch = null;
  TB.drawGeo = function (geo, material) {
    if (!_scratch) {
      _scratch = new THREE.Mesh(geo, material);
      _scratch.frustumCulled = false;
      _scratch.matrixAutoUpdate = false;
      _scratch.matrixWorld.identity();
    }
    _scratch.geometry = geo;
    _scratch.material = material;
    TB.drawObject(_scratch);
  };

  //  Draw an object into a NAMED target. drawObject aims at sceneFB, which
  //  is what every scene pass wants; the water module needs its own targets
  //  and passes them in. Same discipline either way: resync, name the
  //  target, render, then hand the raw path its binding back.
  TB.drawObjectInto = function (obj, fbo) {
    if (R.threeResync) R.threeResync();
    var three = R.three, target = fbo && fbo.rt;
    if (target) three.setRenderTarget(target);
    scene.children.length = 0;
    scene.add(obj);
    three.render(scene, camera);
    if (target) { three.setRenderTarget(null); fbo.bind(false); }
    R.stats.draws++;
  };

  //  Draw one prepared THREE.Mesh into whatever target is currently bound.
  //  Deliberately does NOT call setRenderTarget: the scene passes run inside
  //  a framebuffer the raw code bound, and taking ownership of the target
  //  here would restore the default framebuffer on the way out and send
  //  every later raw pass to the screen - which is exactly what the sky
  //  pass did before it was made to rebind.
  TB.drawObject = function (mesh) {
    //  RESYNC FIRST. Same lesson as T3.Pass, and it bites harder here.
    //
    //  three skips any state call it believes is redundant, so a raw GL
    //  write between two three draws leaves the cache lying. copyScene()
    //  runs GLX.depth(false,false) immediately before the glass pass; three
    //  still had depth test recorded as ENABLED, so when the glass material
    //  asked for depthTest true three judged the enable redundant and never
    //  issued it. The glass then drew with no depth test at all and painted
    //  a milky pane over the whole tank - 477,866 differing pixels.
    //
    //  Read at the draw call itself, not after it: a post-hoc snapshot shows
    //  three's end-of-render epilogue, not the state the draw actually used.
    //  Hooking gl.drawElements is what made it visible.
    //
    //  The batches got away without this only by luck - the raw pass before
    //  them happened to leave depth test on, which is what they wanted.
    if (R.threeResync) R.threeResync();
    //  AND NAME THE TARGET. resetState() unbinds the render target - three
    //  goes back to the default framebuffer - so after a resync the ambient
    //  binding the raw code left is gone. Relying on it drew the glass into
    //  the BACK buffer, where the post chain then overwrote it: the frame
    //  looked almost right because glass is subtle, while attachment 1 was
    //  never written at all and SSAO went with it. DRAW_BUFFER0 read BACK
    //  instead of COLOR_ATTACHMENT0 at the draw call, which is the tell.
    //
    //  Bind it explicitly, then hand the raw path its own binding back -
    //  every pass after this one assumes sceneFB is current and binds
    //  nothing itself.
    var three = R.three, target = R.sceneFB && R.sceneFB.rt;
    if (target) three.setRenderTarget(target);
    scene.children.length = 0;
    scene.add(mesh);
    three.render(scene, camera);
    if (target) { three.setRenderTarget(null); R.sceneFB.bind(false); }
    R.stats.draws++;
  };

  AF.T3B = TB;

})(window.AF = window.AF || {});

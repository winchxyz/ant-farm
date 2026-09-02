/* =============================================================
   FORMICARIUM :: DEEP COLONY
   three_post.js - the bridge between the hand-written GL renderer and
   three.js, for the staged migration in THREEJS-MIGRATION.md.

   Nothing in here draws any of the game. It provides the four things a
   ported pass needs and nothing else:

     T3.target(w, h, opts)  a WebGLRenderTarget with this engine's defaults
                            rather than three's (half float, LINEAR, no
                            depth buffer - a post pass has no use for one)
     T3.extern(rawTex)      wraps a texture this renderer owns so a three
                            material can sample it
     T3.raw(rt)             the WebGLTexture inside a three target, so a
                            pass still on raw GL can sample it
     T3.pass(name, fs)      a fullscreen-triangle pass: GLSL3
                            RawShaderMaterial + the 3-vertex geometry

   Why each of those is not the default
   ------------------------------------
   * RawShaderMaterial, never ShaderMaterial (brief L1). ShaderMaterial
     injects a preamble ahead of the version line and rewrites two fragment
     outputs into one. Every shader here already carries its own
     `#version 300 es`, which has to be stripped because three emits the
     directive itself and a duplicate will not compile.
   * A three-vertex triangle, never PlaneGeometry (L13). three derives the
     draw count from geometry.attributes.position, so the attribute-less
     gl_VertexID trick cannot be expressed; a quad would put a diagonal
     seam through every derivative-based effect, and the ink pass and FXAA
     were tuned on one triangle.
   * depthTest, depthWrite and blending are set explicitly on every
     material (L2, L4). three treats `transparent` as the arm for blending
     and defaults depthWrite true even for transparent materials.
   * Every entry point ends by handing state back through R.threeResync,
     because three's state cache and this renderer's raw calls each lie to
     the other (L14, and the clear-colour finding recorded in
     tools/baseline/stage0.json).
   ============================================================= */
(function (AF) {
  'use strict';

  var T3 = {};
  var THREE = null, R = null, gl = null;
  var scene = null, camera = null, triangle = null;
  var externals = null;

  T3.ready = false;

  T3.init = function (renderer) {
    R = renderer;
    gl = R.gl;
    THREE = window.THREE;
    if (!THREE || !R.three) return false;

    //  The same triangle gl.js:360-368 draws, expressed as real vertices
    //  because three counts them. (-1,-1) (3,-1) (-1,3) in clip space, so
    //  vUV = position*0.5+0.5 reproduces FS_VS's vUV exactly.
    triangle = new THREE.BufferGeometry();
    triangle.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    //  it is never culled and never tested against a frustum
    triangle.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

    scene = new THREE.Scene();
    scene.matrixAutoUpdate = false;
    camera = new THREE.Camera();          // identity: the VS writes clip space
    camera.matrixAutoUpdate = false;

    externals = new WeakMap();
    T3.ready = true;
    return true;
  };

  var VS = [
    'in vec3 position;',
    'out vec2 vUV;',
    'void main(){',
    '  vUV = position.xy * 0.5 + 0.5;',
    '  gl_Position = vec4(position.xy, 0.0, 1.0);',
    '}'
  ].join('\n');

  //  three emits `#version 300 es` itself for GLSL3, and a second one is a
  //  compile error. The shaders in this repo all carry their own.
  function stripVersion(src) {
    return src.replace(/^\s*#version\s+300\s+es\s*\n/, '');
  }

  // ------------------------------------------------------------------
  //  targets
  // ------------------------------------------------------------------
  //  Defaults chosen to match GLX.FBO, not three: half float so values
  //  above 1.0 survive (brief B1 - the water glint measures 6.27 against a
  //  bloom threshold of 1.45), LINEAR because the post chain samples every
  //  one of these bilinearly at a different resolution (2.5), and no depth
  //  attachment at all.
  T3.target = function (w, h, opts) {
    opts = opts || {};
    var rt = new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
      type: opts.type || THREE.HalfFloatType,
      format: opts.format || THREE.RGBAFormat,
      minFilter: opts.filter || THREE.LinearFilter,
      magFilter: opts.filter || THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false
    });
    rt.texture.generateMipmaps = false;
    return rt;
  };

  //  Wrap a texture this renderer owns so a three material can sample it.
  //  Cached per raw texture: a new ExternalTexture every frame would leak a
  //  three-side properties entry every frame.
  T3.extern = function (rawTex) {
    if (!rawTex) return null;
    var t = externals.get(rawTex);
    if (!t) {
      t = new THREE.ExternalTexture(rawTex);
      t.generateMipmaps = false;
      externals.set(rawTex, t);
    }
    return t;
  };

  //  The WebGLTexture inside a three target, for passes still on raw GL.
  //  setRenderTarget forces the allocation first, or properties has no
  //  __webglTexture yet and the caller silently binds null.
  T3.raw = function (rt) {
    var props = R.three.properties.get(rt.texture);
    if (!props || !props.__webglTexture) {
      R.three.setRenderTarget(rt);
      R.three.setRenderTarget(null);
      props = R.three.properties.get(rt.texture);
    }
    return props ? props.__webglTexture : null;
  };

  // ------------------------------------------------------------------
  //  a pass
  // ------------------------------------------------------------------
  function Pass(name, fs, uniforms) {
    this.name = name;
    var u = {};
    for (var k in uniforms) u[k] = { value: uniforms[k] };
    this.uniforms = u;
    this.material = new THREE.RawShaderMaterial({
      name: name,
      glslVersion: THREE.GLSL3,
      vertexShader: VS,
      fragmentShader: stripVersion(fs),
      uniforms: u,
      //  a post pass owns the whole target: no test, no write, no blend
      depthTest: false,
      depthWrite: false,
      depthFunc: THREE.LessDepth,
      blending: THREE.NoBlending,
      transparent: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false
    });
    this.mesh = new THREE.Mesh(triangle, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  //  Render into a three target, or into `null` for the default framebuffer.
  Pass.prototype.render = function (rt, values) {
    if (values) for (var k in values) {
      if (this.uniforms[k]) this.uniforms[k].value = values[k];
    }
    var three = R.three;
    scene.clear();
    scene.add(this.mesh);
    three.setRenderTarget(rt || null);
    three.render(scene, camera);
    three.setRenderTarget(null);
    //  hand the state back to the raw passes that run either side of this
    if (R.threeResync) R.threeResync();
    R.stats.draws++;
    return this;
  };

  T3.pass = function (name, fs, uniforms) { return new Pass(name, fs, uniforms); };
  T3.Pass = Pass;

  // ------------------------------------------------------------------
  //  a three render target wearing GLX.FBO's clothes
  // ------------------------------------------------------------------
  //  MIGRATION STAGE 3. The scene target and its neighbours become three
  //  targets, but ~30 raw GL passes still bind them, and water_render.js,
  //  heap_render.js and particles.js reach for `.color[0]`, `.depthTex`,
  //  `.width` and `.bind()` by name. Rewriting all of that at the same
  //  moment as changing the storage would make any regression impossible
  //  to attribute.
  //
  //  So the storage moves and the surface does not. This presents exactly
  //  the GLX.FBO API, backed by a WebGLRenderTarget: `.bind()` binds
  //  three's framebuffer with raw GL, `.color[]` and `.depthTex` are the
  //  WebGLTextures inside it, and a three pass can still render into the
  //  same target with setRenderTarget(fbo.rt).
  //
  //  Keeping the raw binds is also what preserves B3. R.colorOnly() and
  //  R.restoreMRT() are plain gl.drawBuffers calls against whatever is
  //  bound, so the four single-output passes keep their attachment-1 mask
  //  and L5's escape hatch is never needed.
  function glTypeToThree(internalFormat, format) {
    var g = gl, T = THREE;
    var type = T.UnsignedByteType, fmt = T.RGBAFormat;
    if (internalFormat === g.RGBA16F || internalFormat === g.R16F) type = T.HalfFloatType;
    else if (internalFormat === g.RGBA32F || internalFormat === g.R32F) type = T.FloatType;
    if (format === g.RED || internalFormat === g.R8 || internalFormat === g.R16F) fmt = T.RedFormat;
    return { type: type, format: fmt };
  }

  function T3FBO(spec) {
    this.spec = spec;
    this.width = spec.width;
    this.height = spec.height;
    this.color = [];
    this.depthTex = null;
    this.rb = null;

    var cs = spec.color || [];
    //  three needs at least one colour texture; a depth-only target (the
    //  shadow map) gets a 1-channel one it never writes, and bind() masks
    //  it off with drawBuffers([NONE]) exactly as GLX.FBO does.
    var first = cs[0] || { internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE };
    var m = glTypeToThree(first.internalFormat, first.format);
    var filt = first.filter === gl.NEAREST ? THREE.NearestFilter : THREE.LinearFilter;

    var opts = {
      type: m.type, format: m.format,
      minFilter: filt, magFilter: filt,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: !!spec.depth, stencilBuffer: false, generateMipmaps: false
    };
    if (cs.length > 1) opts.count = cs.length;

    if (spec.depth === 'texture') {
      var dt = new THREE.DepthTexture(this.width, this.height, THREE.FloatType);
      dt.format = THREE.DepthFormat;
      //  never a comparison sampler: the soil reads this as a plain
      //  sampler2D and does its own compare (B19)
      dt.compareFunction = null;
      var df = spec.depthFilter === undefined ? gl.NEAREST : spec.depthFilter;
      var dfilt = df === gl.LINEAR ? THREE.LinearFilter : THREE.NearestFilter;
      //  LINEAR on a float depth texture needs the extension; without it
      //  the sampler returns garbage rather than falling back
      if (dfilt === THREE.LinearFilter &&
        !R.three.extensions.get('OES_texture_float_linear')) dfilt = THREE.NearestFilter;
      dt.minFilter = dt.magFilter = dfilt;
      dt.generateMipmaps = false;
      opts.depthTexture = dt;
      this._depth = dt;
    }

    this.rt = new THREE.WebGLRenderTarget(this.width, this.height, opts);
    this.rt.texture.generateMipmaps = false;

    //  count:N clones attachment 0's settings onto the rest, and this
    //  engine's attachment 1 is a fixed-point RGBA8 normal buffer whose
    //  clamping the premultiplied-alpha reasoning depends on (brief L6).
    for (var i = 1; i < cs.length; i++) {
      var mi = glTypeToThree(cs[i].internalFormat, cs[i].format);
      var ti = this.rt.textures[i];
      ti.type = mi.type; ti.format = mi.format;
      var fi = cs[i].filter === gl.NEAREST ? THREE.NearestFilter : THREE.LinearFilter;
      ti.minFilter = ti.magFilter = fi;
      ti.generateMipmaps = false;
    }

    //  force allocation now, so .color[] and .fb are real before any
    //  caller asks for them mid-frame
    R.three.setRenderTarget(this.rt);
    R.three.setRenderTarget(null);
    if (R.threeResync) R.threeResync();

    var texes = this.rt.textures || [this.rt.texture];
    for (i = 0; i < Math.max(1, cs.length); i++) {
      var pr = R.three.properties.get(texes[i] || texes[0]);
      this.color.push(pr ? pr.__webglTexture : null);
    }
    if (cs.length === 0) this.color.length = 0;   // depth-only: no colour API
    if (this._depth) {
      var dp = R.three.properties.get(this._depth);
      this.depthTex = dp ? dp.__webglTexture : null;
    }
    this._draws = [];
    for (i = 0; i < cs.length; i++) this._draws.push(gl.COLOR_ATTACHMENT0 + i);
  }

  T3FBO.prototype.fb = function () {
    var pr = R.three.properties.get(this.rt);
    var f = pr ? pr.__webglFramebuffer : null;
    return Array.isArray(f) ? f[0] : f;
  };

  T3FBO.prototype.bind = function (clear, r, g, b, a) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb());
    gl.viewport(0, 0, this.width, this.height);
    //  GLX.FBO sets drawBuffers once at construction and it sticks with the
    //  framebuffer. three rewrites it on its own setRenderTarget, so it has
    //  to be re-asserted here or a pass after a three pass writes to one
    //  attachment when it meant two.
    if (this._draws.length > 1) gl.drawBuffers(this._draws);
    else if (this._draws.length === 0) { gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); }
    if (clear) {
      gl.clearColor(r || 0, g || 0, b || 0, a === undefined ? 1 : a);
      gl.clear(gl.COLOR_BUFFER_BIT | (this.spec.depth ? gl.DEPTH_BUFFER_BIT : 0));
    }
    return this;
  };

  T3FBO.prototype.destroy = function () {
    if (this.rt) this.rt.dispose();
    this.rt = null; this.color.length = 0; this.depthTex = null;
  };

  T3.fbo = function (spec) { return new T3FBO(spec); };
  T3.FBO = T3FBO;

  AF.T3 = T3;
})(window.AF = window.AF || {});

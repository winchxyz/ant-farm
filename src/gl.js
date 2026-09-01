/* =============================================================
   FORMICARIUM :: DEEP COLONY
   gl.js - thin WebGL2 layer: programs, meshes, textures, FBOs
   ============================================================= */
(function (AF) {
  'use strict';

  var GLX = {};
  var gl = null;

  GLX.init = function (canvas, opts) {
    opts = opts || {};
    gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: !!(opts && opts.preserve),
      desynchronized: false
    });
    if (!gl) return null;
    GLX.gl = gl;
    //  A lost context turns every later GL call into a silent no-op and the
    //  canvas goes blank with no error. Say so instead of showing a white
    //  rectangle and pretending everything is fine.
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      GLX.contextLost = true;
      var m = document.getElementById('bootMsg');
      var b = document.getElementById('boot');
      if (m && b) {
        b.classList.remove('hidden');
        m.innerHTML = '<span style="color:#ff5b48">The graphics context was lost.</span>' +
          '<br>Reload the page to carry on.';
      }
    }, false);
    canvas.addEventListener('webglcontextrestored', function () { GLX.contextLost = false; }, false);
    GLX.ext = {
      colorFloat: gl.getExtension('EXT_color_buffer_float'),
      floatLinear: gl.getExtension('OES_texture_float_linear'),
      aniso: gl.getExtension('EXT_texture_filter_anisotropic'),
      halfLinear: gl.getExtension('OES_texture_half_float_linear')
    };
    GLX.maxAniso = GLX.ext.aniso ? gl.getParameter(GLX.ext.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
    GLX.renderer = '';
    var dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) { try { GLX.renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL); } catch (e) { } }
    return gl;
  };

  // ------------------------------------------------------------------
  //  Shader program
  // ------------------------------------------------------------------
  function compile(type, src, name) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(s);
      var lines = src.split('\n');
      var numbered = [];
      var m = /ERROR:\s*\d+:(\d+)/.exec(log);
      var at = m ? parseInt(m[1], 10) : 0;
      for (var i = Math.max(0, at - 6); i < Math.min(lines.length, at + 5); i++) {
        numbered.push((i + 1) + ': ' + lines[i]);
      }
      console.error('[shader ' + name + '] ' + log + '\n' + numbered.join('\n'));
      throw new Error('Shader compile failed: ' + name + '\n' + log);
    }
    return s;
  }

  // Fixed attribute slots so one VAO can feed every program (main pass,
  // shadow pass, pick pass) without re-specifying vertex layout.
  GLX.ATTRIB_LOC = {
    aPos: 0, aNrm: 1, aUV: 2, aPart: 3,
    aIPos: 4, aIRot: 5, aIAnim: 6, aIColA: 7, aIData: 8
  };

  function Program(vsSrc, fsSrc, name) {
    this.name = name || 'prog';
    var vs = compile(gl.VERTEX_SHADER, vsSrc, this.name + '.vs');
    var fs = compile(gl.FRAGMENT_SHADER, fsSrc, this.name + '.fs');
    var p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    for (var an in GLX.ATTRIB_LOC) gl.bindAttribLocation(p, GLX.ATTRIB_LOC[an], an);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('Link failed ' + this.name + ': ' + gl.getProgramInfoLog(p));
    }
    gl.deleteShader(vs); gl.deleteShader(fs);
    this.p = p;
    this.u = {};
    this.a = {};
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS), i, info;
    for (i = 0; i < n; i++) {
      info = gl.getActiveUniform(p, i);
      var nm = info.name.replace(/\[0\]$/, '');
      this.u[nm] = gl.getUniformLocation(p, info.name);
    }
    n = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (i = 0; i < n; i++) {
      info = gl.getActiveAttrib(p, i);
      this.a[info.name] = gl.getAttribLocation(p, info.name);
    }
    this._tex = 0;
  }
  Program.prototype.use = function () { gl.useProgram(this.p); this._tex = 0; return this; };
  Program.prototype.f = function (n, v) { var l = this.u[n]; if (l) gl.uniform1f(l, v); return this; };
  Program.prototype.i = function (n, v) { var l = this.u[n]; if (l !== undefined && l !== null) gl.uniform1i(l, v); return this; };
  Program.prototype.v2 = function (n, x, y) { var l = this.u[n]; if (l) gl.uniform2f(l, x, y); return this; };
  Program.prototype.v3 = function (n, x, y, z) {
    var l = this.u[n]; if (!l) return this;
    if (y === undefined) gl.uniform3f(l, x[0], x[1], x[2]); else gl.uniform3f(l, x, y, z);
    return this;
  };
  Program.prototype.v4 = function (n, x, y, z, w) {
    var l = this.u[n]; if (!l) return this;
    if (y === undefined) gl.uniform4f(l, x[0], x[1], x[2], x[3]); else gl.uniform4f(l, x, y, z, w);
    return this;
  };
  Program.prototype.m4 = function (n, m) { var l = this.u[n]; if (l) gl.uniformMatrix4fv(l, false, m); return this; };
  Program.prototype.fv = function (n, arr) { var l = this.u[n]; if (l) gl.uniform1fv(l, arr); return this; };
  Program.prototype.v3v = function (n, arr) { var l = this.u[n]; if (l) gl.uniform3fv(l, arr); return this; };
  Program.prototype.v4v = function (n, arr) { var l = this.u[n]; if (l) gl.uniform4fv(l, arr); return this; };
  //  A texture unit may only have ONE target bound while sampling, so
  //  clear the other targets before binding (soil samples a 3D texture
  //  on a unit a previous pass used for a 2D one).
  Program.prototype.tex = function (n, texture, target) {
    var l = this.u[n]; if (!l) return this;
    var unit = this._tex++;
    target = target || gl.TEXTURE_2D;
    gl.activeTexture(gl.TEXTURE0 + unit);
    if (target !== gl.TEXTURE_2D) gl.bindTexture(gl.TEXTURE_2D, null);
    if (target !== gl.TEXTURE_3D) gl.bindTexture(gl.TEXTURE_3D, null);
    gl.bindTexture(target, texture);
    gl.uniform1i(l, unit);
    return this;
  };
  GLX.Program = Program;
  GLX.program = function (vs, fs, name) { return new Program(vs, fs, name); };

  // ------------------------------------------------------------------
  //  Mesh (VAO + buffers)
  // ------------------------------------------------------------------
  //  attribs: [{name, size, data(Float32Array), divisor, dynamic}]
  function Mesh(attribs, indices, program) {
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.buffers = {};
    this.count = 0;
    this.instanceCount = 0;
    for (var i = 0; i < attribs.length; i++) {
      var a = attribs[i];
      var loc = GLX.ATTRIB_LOC[a.name];
      if (loc === undefined) loc = program ? program.a[a.name] : -1;
      var buf = gl.createBuffer();
      this.buffers[a.name] = { buf: buf, size: a.size, loc: loc, divisor: a.divisor || 0 };
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, a.data, a.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      if (loc !== undefined && loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, a.size, gl.FLOAT, false, 0, 0);
        if (a.divisor) gl.vertexAttribDivisor(loc, a.divisor);
      }
      if (!a.divisor && a.name === 'aPos') this.count = a.data.length / a.size;
    }
    if (indices) {
      this.ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      this.indexCount = indices.length;
      this.indexType = indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    }
    gl.bindVertexArray(null);
  }
  Mesh.prototype.update = function (name, data, count) {
    var b = this.buffers[name];
    if (!b) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
    if (count !== undefined) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count);
    else gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
  };
  Mesh.prototype.realloc = function (name, data) {
    var b = this.buffers[name];
    if (!b) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  };
  Mesh.prototype.draw = function (instances, mode) {
    gl.bindVertexArray(this.vao);
    mode = mode === undefined ? gl.TRIANGLES : mode;
    if (this.ibo) {
      if (instances !== undefined) gl.drawElementsInstanced(mode, this.indexCount, this.indexType, 0, instances);
      else gl.drawElements(mode, this.indexCount, this.indexType, 0);
    } else {
      if (instances !== undefined) gl.drawArraysInstanced(mode, 0, this.count, instances);
      else gl.drawArrays(mode, 0, this.count);
    }
  };
  Mesh.prototype.drawRange = function (indexCount, instances, mode) {
    gl.bindVertexArray(this.vao);
    mode = mode === undefined ? gl.TRIANGLES : mode;
    if (instances !== undefined) gl.drawElementsInstanced(mode, indexCount, this.indexType, 0, instances);
    else gl.drawElements(mode, indexCount, this.indexType, 0);
  };
  GLX.Mesh = Mesh;

  // ------------------------------------------------------------------
  //  Textures
  // ------------------------------------------------------------------
  GLX.texture2D = function (o) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    var iformat = o.internalFormat || gl.RGBA8;
    var format = o.format || gl.RGBA;
    var type = o.type || gl.UNSIGNED_BYTE;
    if (o.image) {
      gl.texImage2D(gl.TEXTURE_2D, 0, iformat, format, type, o.image);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, iformat, o.width, o.height, 0, format, type, o.data || null);
    }
    var filt = o.filter === undefined ? gl.LINEAR : o.filter;
    var wrap = o.wrap === undefined ? gl.CLAMP_TO_EDGE : o.wrap;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, o.mipmap ? gl.LINEAR_MIPMAP_LINEAR : filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (o.compare) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    }
    if (o.mipmap) gl.generateMipmap(gl.TEXTURE_2D);
    if (o.aniso && GLX.ext.aniso) gl.texParameterf(gl.TEXTURE_2D, GLX.ext.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(o.aniso, GLX.maxAniso));
    gl.bindTexture(gl.TEXTURE_2D, null);
    t._w = o.width; t._h = o.height;
    return t;
  };

  GLX.texture3D = function (o) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.texImage3D(gl.TEXTURE_3D, 0, o.internalFormat || gl.R16F, o.width, o.height, o.depth, 0,
      o.format || gl.RED, o.type || gl.HALF_FLOAT, o.data || null);
    var filt = o.filter === undefined ? gl.LINEAR : o.filter;
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_3D, null);
    t._w = o.width; t._h = o.height; t._d = o.depth;
    return t;
  };

  // ------------------------------------------------------------------
  //  Framebuffer
  // ------------------------------------------------------------------
  //  spec: {width, height, color:[{internalFormat, format, type, filter}], depth:true|'texture'}
  function FBO(spec) {
    this.spec = spec;
    this.width = spec.width; this.height = spec.height;
    this.fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    this.color = [];
    var draws = [];
    var cs = spec.color || [];
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      var t = GLX.texture2D({
        width: this.width, height: this.height,
        internalFormat: c.internalFormat || gl.RGBA8,
        format: c.format || gl.RGBA,
        type: c.type || gl.UNSIGNED_BYTE,
        filter: c.filter === undefined ? gl.LINEAR : c.filter,
        wrap: c.wrap
      });
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
      this.color.push(t);
      draws.push(gl.COLOR_ATTACHMENT0 + i);
    }
    if (draws.length > 1) gl.drawBuffers(draws);
    if (spec.depth === 'texture') {
      this.depthTex = GLX.texture2D({
        width: this.width, height: this.height,
        internalFormat: gl.DEPTH_COMPONENT32F, format: gl.DEPTH_COMPONENT, type: gl.FLOAT,
        filter: spec.depthFilter === undefined ? gl.NEAREST : spec.depthFilter,
        compare: spec.depthCompare
      });
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTex, 0);
      if (draws.length === 0) { gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); }
    } else if (spec.depth) {
      this.rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.width, this.height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.rb);
    }
    var st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) console.warn('FBO incomplete 0x' + st.toString(16), spec);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  FBO.prototype.bind = function (clear, r, g, b, a) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.viewport(0, 0, this.width, this.height);
    if (clear) {
      gl.clearColor(r || 0, g || 0, b || 0, a === undefined ? 1 : a);
      gl.clear(gl.COLOR_BUFFER_BIT | (this.rb || this.depthTex ? gl.DEPTH_BUFFER_BIT : 0));
    }
    return this;
  };
  FBO.prototype.resize = function (w, h) {
    if (w === this.width && h === this.height) return;
    this.destroy();
    FBO.call(this, Object.assign({}, this.spec, { width: w, height: h }));
  };
  FBO.prototype.destroy = function () {
    for (var i = 0; i < this.color.length; i++) gl.deleteTexture(this.color[i]);
    if (this.depthTex) gl.deleteTexture(this.depthTex);
    if (this.rb) gl.deleteRenderbuffer(this.rb);
    gl.deleteFramebuffer(this.fb);
    this.color = []; this.depthTex = null; this.rb = null;
  };
  GLX.FBO = FBO;

  GLX.bindScreen = function (w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
  };

  // ------------------------------------------------------------------
  //  Fullscreen triangle
  // ------------------------------------------------------------------
  GLX.FS_VS = [
    '#version 300 es',
    'precision highp float;',
    'out vec2 vUV;',
    'void main(){',
    '  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);',
    '  vUV = p;',
    '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  GLX.blitVAO = null;
  GLX.fullscreen = function () {
    if (!GLX.blitVAO) GLX.blitVAO = gl.createVertexArray();
    gl.bindVertexArray(GLX.blitVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // ------------------------------------------------------------------
  //  State helpers
  // ------------------------------------------------------------------
  GLX.depth = function (test, write) {
    if (test) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
    gl.depthMask(!!write);
  };
  GLX.blend = function (mode) {
    if (!mode) { gl.disable(gl.BLEND); return; }
    gl.enable(gl.BLEND);
    if (mode === 'add') { gl.blendFunc(gl.SRC_ALPHA, gl.ONE); }
    else if (mode === 'addpre') { gl.blendFunc(gl.ONE, gl.ONE); }
    else if (mode === 'premul') { gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }
    //  Multiply: the only way to DARKEN what is already in the buffer. An
    //  additive pass cannot draw a shadow - a "dark" ring came out as bright
    //  arcs - so anything that tints the ground down needs this mode.
    else if (mode === 'multiply') { gl.blendFunc(gl.DST_COLOR, gl.ZERO); }
    //  Multiply with per-pixel strength: lerp(1, src, srcAlpha) applied to dst.
    else if (mode === 'multalpha') { gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); }
    else { gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }
  };
  GLX.cull = function (mode) {
    if (!mode) { gl.disable(gl.CULL_FACE); return; }
    gl.enable(gl.CULL_FACE);
    gl.cullFace(mode === 'front' ? gl.FRONT : gl.BACK);
  };

  AF.GLX = GLX;
})(window.AF = window.AF || {});

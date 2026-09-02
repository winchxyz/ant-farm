"""Vendor three.js as a CLASSIC script for this repo.

Why this exists
---------------
three ships ES modules only from r150 onward, and since r17x the browser build
is split in two: `three.core.min.js` (self-contained) and `three.module.min.js`
(imports from core and re-exports it).

This repo has no bundler and index.html loads plain <script> tags in a fixed
order (THREEJS-MIGRATION.md section 6: "the script load order must not
change"). A <script type="module"> defers until after parsing, so THREE would
be undefined when src/gl.js and src/renderer.js run.

The transform is mechanical and asserted at every step:

  * core runs in its own IIFE and hands back a map of its exports
  * module runs in a second IIFE whose preamble binds the names core exports
    to the local aliases module's `import {A as e, ...}` gave them
  * both of module's export blocks become one `window.THREE = {...}`

Two IIFEs rather than one concatenation because both files are minified into
the same short identifier space (`e`, `t`, `n`, ...) and merging scopes would
collide silently.

Usage
-----
    npm pack three@<version>
    tar -xzf three-<version>.tgz package/build package/package.json
    python tools/vendor-three.py <path-to-package-dir> <version>
"""

import io
import os
import re
import sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'vendor',
                   'three.classic.js')

# symbols the migration brief actually depends on; a build missing any of
# these is the wrong build
REQUIRED = (
    'WebGLRenderer RawShaderMaterial GLSL3 DepthTexture WebGLRenderTarget '
    'ExternalTexture CustomBlending OneFactor OneMinusSrcAlphaFactor '
    'DstColorFactor ZeroFactor AddEquation LessDepth InstancedBufferGeometry '
    'InstancedBufferAttribute BufferGeometry BufferAttribute DynamicDrawUsage '
    'FrontSide BackSide DoubleSide HalfFloatType UnsignedByteType FloatType '
    'DepthFormat RGBAFormat RedFormat LinearFilter NearestFilter '
    'Vector2 Vector3 Vector4 Matrix4 Scene Mesh OrthographicCamera '
    'PerspectiveCamera Data3DTexture Texture'
).split()


def brace_span(s, open_at):
    """Index of the '}' matching the '{' at open_at."""
    depth = 0
    for i in range(open_at, len(s)):
        if s[i] == '{':
            depth += 1
        elif s[i] == '}':
            depth -= 1
            if depth == 0:
                return i
    raise AssertionError('unbalanced braces')


def parse_specifiers(text):
    """`A as e, B, C as f` -> [(outer, local), ...]"""
    out = []
    for item in text.split(','):
        item = item.strip()
        if not item:
            continue
        if ' as ' in item:
            a, b = item.split(' as ')
            out.append((a.strip(), b.strip()))
        else:
            out.append((item, item))
    return out


def take_exports(src, expect):
    """Strip every top-level `export{...}` (with or without a `from "..."`
    tail) and return (source, [(name, local, from_module)]).

    three's split build uses all three forms: a plain `export{X as Y}` of its
    own symbols, and an `export{A,B}from"./three.core.min.js"` that re-exports
    core without ever binding those names locally. Treating the second as the
    first leaves the `from"..."` clause dangling and the file will not parse.
    """
    triples, spans = [], []
    for m in re.finditer(r'export\{', src):
        close = brace_span(src, m.end() - 1)
        end = close + 1
        tail = re.match(r'\s*from\s*"[^"]+"\s*', src[end:])
        reexport = bool(tail)
        if tail:
            end += tail.end()
        if end < len(src) and src[end] == ';':
            end += 1
        # export{X as Y} -> Y is the exported name, X the local
        for local, name in parse_specifiers(src[m.end():close]):
            triples.append((name, local, reexport))
        spans.append((m.start(), end))
    assert len(spans) == expect, 'expected %d export blocks, found %d' % (expect, len(spans))
    for a, b in reversed(spans):
        src = src[:a] + src[b:]
    return src, triples


def main():
    pkg = sys.argv[1] if len(sys.argv) > 1 else 'package'
    version = sys.argv[2] if len(sys.argv) > 2 else 'unknown'
    build = os.path.join(pkg, 'build')

    core_path = os.path.join(build, 'three.core.min.js')
    mod_path = os.path.join(build, 'three.module.min.js')
    split = os.path.exists(core_path)

    mod = io.open(mod_path, encoding='utf-8', newline='').read()

    if split:
        core = io.open(core_path, encoding='utf-8', newline='').read()
        assert 'import{' not in core, 'core is expected to be self-contained'
        core, core_exports = take_exports(core, 1)
        core_exports = [(n, l) for n, l, _ in core_exports]

        imports = list(re.finditer(r'import\{', mod))
        assert len(imports) == 1, 'expected one import in module, found %d' % len(imports)
        im = imports[0]
        close = brace_span(mod, im.end() - 1)
        wanted = parse_specifiers(mod[im.end():close])
        tail = mod[close + 1:]
        m2 = re.match(r'\s*from\s*"[^"]+"\s*;?', tail)
        assert m2, 'unexpected import tail: %r' % tail[:60]
        mod = mod[:im.start()] + tail[m2.end():]

        core_names = dict(core_exports)
        missing = [n for n, _ in wanted if n not in core_names]
        assert not missing, 'module imports names core does not export: %s' % missing[:5]

        mod, mod_exports = take_exports(mod, 2)
        preamble = ''.join('var %s=__C.%s;' % (local, name) for name, local in wanted)
    else:
        assert 'import{' not in mod, 'single-file build should have no imports'
        core, core_exports, preamble = '', [], ''
        mod, mod_exports = take_exports(mod, 1)
        mod_exports = [(n, l, False) for n, l, _ in mod_exports]

    names = set(n for n, _, _ in mod_exports)
    missing = [r for r in REQUIRED if r not in names]
    assert not missing, 'build is missing required exports: %s' % missing

    parts = [
        '/* three.js r%s, wrapped as a classic script.\n'
        '   Generated by tools/vendor-three.py - do not hand-edit.\n'
        '   See that file for why this repo cannot use the ESM build directly. */\n'
        '(function () {\n\'use strict\';\n' % version
    ]
    if split:
        parts.append('var __C = (function () {\n')
        parts.append(core)
        parts.append('\nreturn {' + ','.join('%s:%s' % (n, l) for n, l in core_exports) + '};\n})();\n')
    parts.append('var __M = (function (__C) {\n')
    parts.append(preamble + '\n')
    parts.append(mod)
    #  A re-exported name was never bound as a local in module scope - it goes
    #  straight from core to the outside - so it has to be read off the core
    #  namespace object rather than from a variable that does not exist.
    parts.append('\nreturn {' + ','.join(
        '%s:%s' % (n, ('__C.' + n) if fromcore else l)
        for n, l, fromcore in mod_exports) + '};\n})(__C);\n')
    parts.append('window.THREE = __M;\n})();\n')

    io.open(OUT, 'w', encoding='utf-8', newline='').write(''.join(parts))
    print('wrote %s' % os.path.normpath(OUT))
    print('three r%s, split=%s, core exports %d, THREE exports %d'
          % (version, split, len(core_exports), len(mod_exports)))


if __name__ == '__main__':
    main()

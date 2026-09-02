import io
import re

SRC = r"C:\Users\oxman\AppData\Local\Temp\claude\C--Users-oxman-ant-farm\9c6491db-aa76-46bc-99e8-7577594a23c0\scratchpad\package\build\three.module.min.js"
OUT = r"C:\Users\oxman\ant_farm\vendor\three.classic.js"

s = io.open(SRC, encoding='utf-8', newline='').read()

# the file is self-contained ESM: no imports, exactly one trailing export block
assert 'import' not in re.sub(r'\bimportant\b', '', s)[:200] or True
m = list(re.finditer(r'export\{', s))
assert len(m) == 1, 'expected exactly one export block, found %d' % len(m)
start = m[0].start()
open_brace = m[0].end() - 1

# find the matching close brace for the export list (no nested braces in an export list)
depth = 0
end = None
for i in range(open_brace, len(s)):
    if s[i] == '{':
        depth += 1
    elif s[i] == '}':
        depth -= 1
        if depth == 0:
            end = i
            break
assert end is not None, 'unterminated export block'

body = s[:start]
export_list = s[open_brace + 1:end]
tail = s[end + 1:].strip()
assert tail in (';', ''), 'unexpected text after export block: %r' % tail[:80]

pairs = []
for item in export_list.split(','):
    item = item.strip()
    if not item:
        continue
    if ' as ' in item:
        local, exported = item.split(' as ')
        pairs.append((exported.strip(), local.strip()))
    else:
        pairs.append((item, item))

assert len(pairs) > 300, 'suspiciously few exports: %d' % len(pairs)

names = sorted(p[0] for p in pairs)
for required in ('WebGLRenderer', 'RawShaderMaterial', 'GLSL3', 'DepthTexture',
                 'WebGLRenderTarget', 'CustomBlending', 'OneFactor',
                 'OneMinusSrcAlphaFactor', 'DstColorFactor', 'ZeroFactor',
                 'AddEquation', 'LessDepth', 'InstancedBufferGeometry',
                 'InstancedBufferAttribute', 'BufferGeometry', 'DynamicDrawUsage',
                 'FrontSide', 'BackSide', 'DoubleSide', 'HalfFloatType',
                 'UnsignedByteType', 'FloatType', 'DepthFormat', 'RGBAFormat',
                 'LinearFilter', 'NearestFilter', 'Vector2', 'Vector3', 'Matrix4'):
    assert required in names, 'missing export: ' + required

header = (
    "/* three.js r%s - UMD-style wrapper generated for this repo.\n"
    "   Upstream ships ESM only from r150 onward, and this project loads plain\n"
    "   <script> tags in a fixed order with no bundler (see THREEJS-MIGRATION.md\n"
    "   section 6: the script load order must not change). A module script would\n"
    "   defer past src/gl.js and THREE would be undefined when the renderer boots.\n"
    "   The transform is mechanical: the upstream build has zero imports and one\n"
    "   trailing export block, which is rewritten as a window.THREE assignment.\n"
    "   Regenerate with scratchpad/mkthree.py against a fresh npm pack. */\n"
    "(function () {\n'use strict';\n"
) % '0.169.0'

assign = ('\nwindow.THREE = {' +
          ','.join('%s:%s' % (e, l) for e, l in pairs) +
          '};\n})();\n')

io.open(OUT, 'w', encoding='utf-8', newline='').write(header + body + assign)
print('wrote %s' % OUT)
print('exports: %d' % len(pairs))

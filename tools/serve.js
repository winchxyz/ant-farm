/* FORMICARIUM :: DEEP COLONY — zero-dependency static server.
   Usage:  node tools/serve.js [port] [--dev]
   --dev enables a /__shot endpoint used for capturing frames during
   development. It is off by default so the release server only reads. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const dev = args.includes('--dev');
const port = Number(args.find(a => /^\d+$/.test(a)) || 8137);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);

  if (dev && req.method === 'POST' && p === '/__shot') {
    const tag = (/[?&]tag=([^&]*)/.exec(req.url) || [, 'x'])[1].replace(/[^\w.-]/g, '');
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const m = /^data:image\/png;base64,(.*)$/.exec(body);
        const dir = path.join(root, 'tools', 'shots');
        fs.mkdirSync(dir, { recursive: true });
        const name = tag + '.png';
        fs.writeFileSync(path.join(dir, name), Buffer.from(m[1], 'base64'));
        res.writeHead(200); res.end('tools/shots/' + name);
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    return;
  }

  if (p === '/') p = '/index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found: ' + p); return; }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}).listen(port, () => {
  console.log('');
  console.log('  FORMICARIUM :: DEEP COLONY');
  console.log('  running at  http://localhost:' + port);
  console.log('  press Ctrl+C to stop');
  console.log('');
});

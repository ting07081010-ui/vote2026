const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/atlas.css', ['atlas.css', 'text/css; charset=utf-8']],
  ['/compass.svg', ['compass.svg', 'image/svg+xml']],
  ['/roster-illustration.webp', ['roster-illustration.webp', 'image/webp']],
]);
http.createServer((req, res) => {
  const asset = assets.get(new URL(req.url, 'http://localhost').pathname);
  if (!asset) { res.writeHead(404).end(); return; }
  fs.readFile(path.join(root, asset[0]), (error, data) => {
    if (error) { res.writeHead(500).end(); return; }
    res.writeHead(200, { 'Content-Type': asset[1] }).end(data);
  });
}).listen(4173, '127.0.0.1');

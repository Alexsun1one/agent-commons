import http from 'node:http';
import https from 'node:https';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const gate = path.join(root, 'preview/x-gate');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--api')) {
  throw new Error('Usage: node tools/xgate-dev.mjs [--api http://127.0.0.1:8000]');
}
const api = new URL(args[1] || 'http://127.0.0.1:8000');
if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password || api.pathname !== '/' || api.search || api.hash) {
  throw new Error('--api must be an HTTP(S) origin without credentials');
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.gif': 'image/gif', '.avif': 'image/avif' };
const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade']);
function end(res, code, message) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(message);
}
function proxy(req, res, requestURL) {
  const ignored = new Set([...hopHeaders, ...(req.headers.connection || '').split(',').map(value => value.trim().toLowerCase())]);
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([key]) => !ignored.has(key)));
  headers.host = api.host;
  if (headers.origin === 'http://127.0.0.1:8732') headers.origin = api.origin;
  const client = api.protocol === 'https:' ? https : http;
  const target = new URL(api);
  target.pathname = requestURL.pathname; target.search = requestURL.search;
  const upstream = client.request(target, { method: req.method, headers }, response => {
    const skipped = new Set([...hopHeaders, ...(response.headers.connection || '').split(',').map(value => value.trim().toLowerCase())]);
    res.writeHead(response.statusCode, Object.fromEntries(Object.entries(response.headers).filter(([key]) => !skipped.has(key))));
    response.on('error', () => res.destroy());
    response.pipe(res);
  });
  upstream.setTimeout(15000, () => upstream.destroy(new Error('API timeout')));
  upstream.on('error', () => { if (!res.headersSent) end(res, 502, 'API unavailable'); else res.destroy(); });
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
  req.pipe(upstream);
}
async function asset(base, relative) {
  const file = await realpath(path.resolve(base, relative));
  if (!file.startsWith(await realpath(base) + path.sep)) throw Object.assign(new Error('Outside asset root'), { code: 'EACCES' });
  if (!types[path.extname(file)]) throw Object.assign(new Error('Unsupported file'), { code: 'ENOENT' });
  return { file, bytes: await readFile(file) };
}
const server = http.createServer(async (req, res) => {
  try {
    const requestURL = new URL(req.url, 'http://127.0.0.1:8732');
    const pathname = decodeURIComponent(requestURL.pathname);
    if (pathname.split('/').some(part => part === '..' || part.startsWith('.')) || pathname.includes('\\')) return end(res, 403, 'Forbidden');
    if (pathname === '/api' || pathname.startsWith('/api/')) return proxy(req, res, requestURL);
    if (!['GET', 'HEAD'].includes(req.method)) return end(res, 405, 'Method not allowed');
    const route = pathname.replace(/^\/x-gate(?=\/)/, '') === '/' ? '/index.html' : pathname.replace(/^\/x-gate(?=\/)/, '');
    let resource;
    if (route.startsWith('/vendor/three/')) {
      resource = await asset(path.join(root, 'tools/vendor/node_modules/three'), route.slice('/vendor/three/'.length));
    } else if (/^\/(?:preview\/)?assets\//.test(route)) {
      const relative = route.replace(/^\/(?:preview\/)?assets\//, '');
      try { resource = await asset(path.join(root, 'preview/assets'), relative); }
      catch (error) { if (error.code !== 'ENOENT') throw error; resource = await asset(path.join(gate, 'assets'), relative); }
    } else if (route === '/index.html' || route === '/style.css' || /^\/src\/.+\.(?:js|css)$/.test(route)) {
      resource = await asset(gate, route.slice(1));
    } else return end(res, 404, 'Not found');
    if (route === '/index.html') {
      const imports = { three: '/vendor/three/build/three.module.js', 'three/addons/': '/vendor/three/examples/jsm/' };
      resource.bytes = Buffer.from(resource.bytes.toString('utf8').replace('</head>', `<script type="importmap">${JSON.stringify({ imports })}</script>\n</head>`));
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(resource.file)], 'Content-Length': resource.bytes.length,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : resource.bytes);
  } catch (error) {
    end(res, error instanceof URIError ? 400 : error.code === 'EACCES' ? 403 : 404, 'Not found');
  }
});
server.listen(8732, '127.0.0.1', () => console.log('X-GATE dev: http://127.0.0.1:8732/'));

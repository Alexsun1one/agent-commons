"""X-GATE build, CSP, resource closure and fail-closed live publication gates."""
import ast
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
BUILDER = ROOT / 'tools/build-delivery.py'


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.scripts, self.styles, self.events = [], [], []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'script':
            self.scripts.append(values)
        if tag == 'link' and values.get('rel') == 'stylesheet':
            self.styles.append(values['href'])
        self.events.extend(key for key in values if key.startswith('on') or key == 'srcdoc')


class XGateBuildTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.output = self.root / 'site'
        self.write('preview/index.html', '<html><head><link rel="stylesheet" href="style.css"></head>'
                   '<body><script src="app.js"></script></body></html>')
        self.write('preview/style.css', 'body{color:black}')
        self.write('preview/app.js', 'window.ready=true;')
        for name in ('privacy', 'terms', 'community-rules', 'age-18', 'retention'):
            self.write(f'docs/legal/{name}.md', '# Policy\n\nDraft.\n')
        self.gate('index.html', '<html><head><link rel="stylesheet" href="style.css"></head><body>'
                  '<script type="module" src="src/app/shell/loading.js"></script>'
                  '<script type="module" src="src/main.js"></script></body></html>')
        self.gate('style.css', 'body { background: url("/assets/icon.svg"); }')
        self.gate('assets/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>')
        self.gate('assets/unused.svg', '<svg/>')
        self.gate('src/app/shell/loading.js', 'globalThis.loadOrder=["loading"];')
        self.gate('src/main.js', 'async function load(path){return await import(path)}\n'
                  'globalThis.loadOrder.push("main");\n'
                  'globalThis.loaded = Promise.all([load("./buildings/base.js"),load("./env/index.js"),load("./app/index.js")]);')
        for name in ('base', 'network', 'hub', 'cocreation', 'value'):
            self.gate(f'src/buildings/{name}.js', f'export const id={json.dumps(name)};')
        self.gate('src/env/index.js', 'import { Vector3, REVISION } from "three"; '
                  'export const id="env"; export const revision=REVISION; export const vector=new Vector3(1,2,3);')
        self.gate('src/app/index.js', 'export const id="app";\n'
                  'globalThis.moduleURL=new URL("./panel.css",import.meta.url).href;\n'
                  'globalThis.assetURL=new URL("../../assets/icon.svg",import.meta.url).href;\n'
                  'globalThis.space = id => import(`./spaces/${id}.js`);')
        self.gate('src/app/panel.css', '.panel{color:blue}')
        self.gate('src/app/spaces/network.js', 'export const id="space-network";')

    def write(self, name, text):
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding='utf-8')

    def gate(self, name, text):
        self.write('preview/x-gate/' + name, text)

    def build(self):
        return subprocess.run([sys.executable, str(BUILDER), '--live', '--root', str(self.root),
                               '--output', str(self.output)], text=True, capture_output=True)

    def test_external_hashed_resources_and_executable_dynamic_modules(self):
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stderr)
        gate = self.output / 'x-gate'
        page = Page((gate / 'index.html').read_text())
        self.assertEqual(page.events, [])
        self.assertEqual(len(page.scripts), 1)
        self.assertEqual(page.scripts[0]['type'], 'module')
        for name in [page.scripts[0]['src'], *page.styles]:
            data = (gate / name).read_bytes()
            self.assertIn(hashlib.sha256(data).hexdigest()[:12], name)
        self.assertTrue((gate / 'assets/icon.svg').is_file())
        self.assertFalse((gate / 'assets/unused.svg').exists())
        self.assertIn('.panel', (gate / page.styles[0]).read_text())
        app = gate / page.scripts[0]['src']
        self.assertNotRegex(app.read_text(), r'\bimport\s*\(')
        code = ('await import(process.argv[1]);'
                'const ids=(await globalThis.loaded).map(m=>m.id);'
                'const space=await globalThis.space("network");'
                'console.log(JSON.stringify({ids,revision:(await globalThis.loaded)[1].revision,space:space.id,order:globalThis.loadOrder,'
                'css:globalThis.moduleURL,asset:globalThis.assetURL}));')
        executed = subprocess.run(['node', '--input-type=module', '-e', code, app.as_uri()],
                                  text=True, capture_output=True)
        self.assertEqual(executed.returncode, 0, executed.stderr)
        data = json.loads(executed.stdout)
        self.assertEqual(data['ids'], ['base', 'env', 'app'])
        self.assertEqual(data['space'], 'space-network')
        self.assertEqual(data['revision'], '187')
        self.assertEqual(data['order'], ['loading', 'main'])
        self.assertTrue(data['css'].endswith(page.styles[0]))
        self.assertTrue(data['asset'].endswith('/x-gate/assets/icon.svg'))
        self.assertEqual(json.loads(result.stdout)['x_gate']['js_bytes'], app.stat().st_size)

    def test_xgate_fixture_fingerprint_rejected(self):
        self.gate('src/app/index.js', r'globalThis.person="\u6797\u6749";')
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('x-gate/app.', result.stderr)
        self.assertIn('合成记录指纹', result.stderr)

    def test_xgate_demo_asset_rejected(self):
        self.gate('assets/samples/example.svg', '<svg/>')
        self.gate('style.css', 'body{background:url("/assets/samples/example.svg")}')
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('演示专用资源', result.stderr)

    def test_missing_asset_rejected(self):
        self.gate('style.css', 'body{background:url("/assets/missing.svg")}')
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Missing X-GATE asset', result.stderr)

    def test_inline_importmap_and_event_rejected(self):
        for markup in ('<script type="importmap">{}</script>', '<button onclick="go()">Go</button>'):
            with self.subTest(markup=markup):
                self.output = self.root / ('site-script' if '<script' in markup else 'site-event')
                self.gate('index.html', '<html><head></head><body>' + markup + '</body></html>')
                result = self.build()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('线上入口不得包含内联', result.stderr)

    def test_refuses_nonempty_output(self):
        self.output.mkdir()
        sentinel = self.output / 'keep.txt'
        sentinel.write_text('keep')
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('拒绝混入旧包文件', result.stderr)
        self.assertEqual(sentinel.read_text(), 'keep')


class XGateRepositoryBuildTests(unittest.TestCase):
    def test_live_repository_has_safe_xgate(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'site'
            result = subprocess.run([sys.executable, str(BUILDER), '--live', '--output', str(output)],
                                    text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            gate = output / 'x-gate'
            page = Page((gate / 'index.html').read_text())
            self.assertEqual(page.events, [])
            self.assertTrue(page.scripts)
            for script in page.scripts:
                self.assertEqual(script.get('type'), 'module')
                self.assertTrue((gate / script['src']).is_file())
            for name in page.styles:
                self.assertTrue((gate / name).is_file())
            self.assertLess(sum(file.stat().st_size for file in gate.rglob('*.js')), 1_500_000)
            tree = ast.parse(BUILDER.read_text())
            fixtures = next(ast.literal_eval(node.value) for node in tree.body
                            if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name)
                            and target.id == 'LIVE_FIXTURES' for target in node.targets))
            for file in gate.rglob('*'):
                if file.suffix not in {'.html', '.css', '.js', '.svg', '.json'}:
                    continue
                text = re.sub(r'\\u([0-9a-fA-F]{4})', lambda match: chr(int(match[1], 16)), file.read_text())
                for fixture in fixtures:
                    self.assertNotIn(fixture, text, str(file.relative_to(gate)))
            self.assertTrue(json.loads(result.stdout)['x_gate'])

    def test_dev_proxy_preserves_request_and_response(self):
        # Exercise the real handler with in-memory HTTP streams; no extra listener.
        code = r'''
import vm from 'node:vm';
import { readFile, realpath } from 'node:fs/promises';
import { PassThrough, Readable, Writable } from 'node:stream';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const filename = path.resolve('tools/xgate-dev.mjs');
let handler, forwarded, sent, fail = false;
const fakeHTTP = {
  createServer(fn) { handler = fn; return { listen(port, host) {
    assert.equal(port, 8732); assert.equal(host, '127.0.0.1');
  } }; },
  request(target, options, callback) {
    forwarded = { target, options };
    const upstream = new PassThrough(); upstream.setTimeout = () => {};
    let body = ''; upstream.on('data', chunk => { body += chunk; });
    upstream.on('finish', () => {
      sent = body;
      if (fail) return upstream.emit('error', new Error('unavailable'));
      const reply = Readable.from(['{"ok":true}']);
      reply.statusCode = 201;
      reply.headers = { 'content-type': 'application/json', 'set-cookie': ['session=fixture; HttpOnly'], connection: 'close' };
      callback(reply);
    });
    return upstream;
  },
};
const source = (await readFile(filename, 'utf8')).replace(/^import .*;\n/gm, '')
  .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href));
vm.runInNewContext(source, { http: fakeHTTP, https: fakeHTTP, readFile, realpath, path, fileURLToPath,
  URL, Buffer, console, process: { argv: ['node', filename, '--api', 'http://127.0.0.1:8000'] } });
async function call(url) {
  const req = new PassThrough();
  Object.assign(req, { url, method: 'POST', headers: {
    host: '127.0.0.1:8732', origin: 'http://127.0.0.1:8732', cookie: 'session=fixture',
    'content-type': 'application/json', connection: 'x-hop', 'x-hop': 'remove',
  } });
  let body = '';
  const res = new Writable({ write(chunk, encoding, next) { body += chunk; next(); } });
  res.writeHead = (status, headers) => { res.statusCode = status; res.headers = headers; res.headersSent = true; };
  const done = once(res, 'finish');
  await handler(req, res); req.end('{"title":"fixture"}'); await done;
  return { status: res.statusCode, headers: res.headers, body };
}
const result = await call('/api/items?cursor=2');
assert.equal(forwarded.target.href, 'http://127.0.0.1:8000/api/items?cursor=2');
assert.equal(forwarded.options.method, 'POST');
assert.equal(forwarded.options.headers.host, '127.0.0.1:8000');
assert.equal(forwarded.options.headers.origin, 'http://127.0.0.1:8000');
assert.equal(forwarded.options.headers.cookie, 'session=fixture');
assert.equal(forwarded.options.headers['x-hop'], undefined);
assert.equal(sent, '{"title":"fixture"}');
assert.equal(result.status, 201); assert.equal(result.body, '{"ok":true}');
assert.equal(result.headers['set-cookie'][0], 'session=fixture; HttpOnly');
assert.equal(result.headers.connection, undefined);
await call('//example.invalid/api/items');
assert.equal(forwarded.target.origin, 'http://127.0.0.1:8000');
fail = true;
assert.equal((await call('/api/items')).status, 502);
console.log('dev proxy: request body, query, origin, cookies, response, target isolation and 502 passed');
'''
        result = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT,
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('passed', result.stdout)

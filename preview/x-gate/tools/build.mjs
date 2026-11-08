import { build } from '../../../tools/vendor/node_modules/esbuild/lib/main.js';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const config = JSON.parse(await new Promise(resolve => {
  let input = ''; process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => resolve(input));
}));
const root = path.resolve(config.root), gate = path.join(root, 'preview/x-gate');
const sources = new Map(), assets = new Map(), styles = new Set(config.styles);
async function read(file) {
  const bytes = await readFile(file);
  sources.set(file, createHash('sha256').update(bytes).digest('hex'));
  return bytes.toString('utf8');
}
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []; throw error;
  });
  return (await Promise.all(entries.map(async entry => entry.isDirectory()
    ? walk(path.join(dir, entry.name)) : entry.isFile() ? [path.join(dir, entry.name)] : []))).flat();
}
const candidates = new Map();
for (const base of [path.join(root, 'preview/assets'), path.join(gate, 'assets')]) {
  for (const file of await walk(base)) candidates.set(path.relative(base, file).split(path.sep).join('/'), file);
}
function collect(pattern) {
  const glob = pattern.replace(/\$\{[^}]*\}/g, '*');
  const escaped = glob.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
  const matcher = new RegExp('^' + escaped + (path.extname(glob) ? '$' : '[^/]*$'));
  const matches = [...candidates].filter(([name]) => matcher.test(name));
  if (!matches.length) throw new Error('Missing X-GATE asset: ' + pattern);
  for (const [relative, source] of matches) assets.set(relative, source);
}
function assetURLs(text) {
  // Runtime-selected image names retain their bounded directory/prefix pattern.
  return text.replace(/(['"`])((?:(?!\1)[\s\S])*?)\1/g, (literal, quote, value) => {
    if (!/^\/(?:preview\/)?assets\//.test(value)) return literal;
    const relative = value.replace(/^\/(?:preview\/)?assets\//, '');
    collect(relative);
    return quote + '/x-gate/assets/' + relative + quote;
  });
}
const plugin = {
  name: 'xgate-resources',
  setup(builder) {
    builder.onLoad({ filter: /\.(?:js|css)$/ }, async args => {
      if (!args.path.startsWith(gate + path.sep)) return;
      let text = assetURLs(await read(args.path));
      if (args.path === path.join(gate, 'src/main.js')) {
        const modules = ['env/index', 'app/index', ...['base', 'network', 'hub', 'cocreation', 'value'].map(id => 'buildings/' + id)];
        const entries = modules.map(name => `${JSON.stringify('./' + name + '.js')}:()=>import(${JSON.stringify('./' + name + '.js')})`);
        text = text.replace(/import\(path\)/g, '__xgateLoad(path)');
        text = `const __xgateModules={${entries.join(',')}};\nconst __xgateLoad=path=>__xgateModules[path]?.()??Promise.reject(new Error('Unknown module: '+path));\n` + text;
      }
      text = text.replace(/new URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g, (match, quote, url) => {
        const file = path.resolve(path.dirname(args.path), url);
        if (url.endsWith('.css')) {
          styles.add(path.relative(gate, file));
          return 'new URL("./__XGATE_STYLESHEET__", import.meta.url)';
        }
        const relative = path.relative(path.join(gate, 'assets'), file).split(path.sep).join('/');
        if (relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('Asset outside X-GATE assets: ' + url);
        collect(relative);
        return `new URL(${JSON.stringify('./assets/' + relative)}, import.meta.url)`;
      });
      return { contents: text, loader: args.path.endsWith('.css') ? 'css' : 'js', resolveDir: path.dirname(args.path) };
    });
    builder.onResolve({ filter: /^\/x-gate\/assets\// }, args => {
      collect(args.path.slice('/x-gate/assets/'.length));
      return { path: args.path, external: true };
    });
  },
};
const options = {
  absWorkingDir: gate, bundle: true, minify: true, write: false,
  charset: 'utf8', legalComments: 'eof', target: 'es2020', platform: 'browser',
  nodePaths: [fileURLToPath(new URL('../../../tools/vendor/node_modules/', import.meta.url))],
  metafile: true, plugins: [plugin], logLevel: 'silent',
};
const js = await build({ ...options, format: 'esm', outfile: 'app.js', stdin: {
  contents: config.scripts.map(file => `import ${JSON.stringify('./' + file)};`).join('\n'),
  resolveDir: gate, sourcefile: 'xgate-entry.js', loader: 'js',
} });
for (const output of Object.values(js.metafile.outputs)) {
  if (output.imports.length) throw new Error('Unbundled X-GATE import: ' + JSON.stringify(output.imports));
}
const css = await build({ ...options, outfile: 'style.css', stdin: {
  contents: [...styles].map(file => `@import ${JSON.stringify('./' + file)};`).join('\n'),
  resolveDir: gate, sourcefile: 'xgate-style.css', loader: 'css',
} });
process.stdout.write(JSON.stringify({
  js: js.outputFiles[0].text, css: css.outputFiles[0].text,
  sources: [...sources].map(([file, sha256]) => ({ file, sha256 })),
  assets: [...assets].map(([relative, source]) => ({ relative, source })),
}));

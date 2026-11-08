// 体检全部模块：node tools/check-all.mjs
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const ids = ['env', 'base', 'network', 'hub', 'cocreation', 'value'];
let bad = 0;
for (const id of ids) {
  const f = id === 'env' ? 'src/env/index.js' : `src/buildings/${id}.js`;
  if (!existsSync(new URL(`../${f}`, import.meta.url))) { console.log(`${id}: 未交付`); continue; }
  for (const q of ['high', 'low']) {
    const r = spawnSync(process.execPath, ['--import', './tools/register.mjs', 'tools/check-module.mjs', id, q], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    const out = r.stdout.trim();
    try { const j = JSON.parse(out); console.log(`${id}/${q}: ${j.tris} tris · ${j.calls} calls · size ${j.size.join('×')} · ${j.ms}ms ${j.fail.length ? '✗ ' + j.fail.join('；') : '✓'}`); }
    catch { console.log(`${id}/${q}: ✗ ${r.stderr.split('\n').slice(0, 4).join(' | ')}`); }
    if (r.status) bad++;
  }
}
process.exit(bad ? 1 : 0);

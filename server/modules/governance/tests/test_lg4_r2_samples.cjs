// Offline split-contract checks. HTML equality is not screenshot acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../../..');
const names = ['avatar', 'image', 'media', 'board-templates', 'board'];
const views = [['Avatar', 'avatar-lab'], ['Image', 'image-lab'], ['Media', 'media-lab'], ['Board', 'board']];
const sampleKey = name => 'COMMONS_' + name.toUpperCase().replaceAll('-', '_') + '_SAMPLE';
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));

function load({baseline = false, protocol = 'file:', build, api, live = false, samples = true, poison = false} = {}) {
  const effects = [];
  const no = () => {};
  const document = {
    currentScript: null, documentElement: {}, body: {}, readyState: 'complete',
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: no, removeEventListener: no,
    createElement: tag => { throw new Error('Unexpected DOM allocation: ' + tag); }
  };
  const Commons = {read: (_, fallback) => fallback, write: (...args) => effects.push(args),
    safeUrl: escape, toast: no, modal: no, closeModal: no};
  const window = {location: {protocol, hash: ''}, Commons, addEventListener: no, removeEventListener: no};
  if (build) window.COMMONS_BUILD = {mode: build};
  if (api) window.CommonsAPI = {mode: api};
  if (live) window.COMMONS_BUILD_LIVE = true;
  const math = Object.create(Math);
  math.random = () => 0.42;
  const context = vm.createContext({window, document, Commons, Math: math, console,
    location: window.location, navigator: {}, performance: {now: () => 0},
    getComputedStyle: () => ({getPropertyValue: () => '', fontFamily: 'sans-serif'}),
    setTimeout: () => { effects.push('timeout'); return 1; }, clearTimeout: no,
    setInterval: () => { effects.push('interval'); return 1; }, clearInterval: no,
    requestAnimationFrame: () => { effects.push('frame'); return 1; }, cancelAnimationFrame: no,
    URL, Blob, TextEncoder, TextDecoder});
  function run(file) { vm.runInContext(fs.readFileSync(file, 'utf8'), context, {filename: file}); }
  for (const name of names) {
    if (!baseline && poison) Object.defineProperty(window, sampleKey(name), {get() { throw new Error('Live read of sample ' + name); }});
    else if (!baseline && samples) run(path.join(root, 'preview', name + '-sample.js'));
    run(baseline ? path.join(root, 'docs/evidence/LG-4/r2/before', 'preview__' + name + '.js.txt')
      : path.join(root, 'preview', name + '.js'));
  }
  return {window, effects};
}

function compareDemo(options, label) {
  const before = load({...options, baseline: true}).window;
  const after = load(options).window;
  for (const [name, route] of views) {
    assert.equal(after['Commons' + name].routes[route](), before['Commons' + name].routes[route](), label + ' ' + route);
  }
  assert.equal(JSON.stringify(after.CommonsBoardTemplates), JSON.stringify(before.CommonsBoardTemplates), label + ' templates');
  assert.equal(JSON.stringify(after.CommonsBoard.lessonDoc()), JSON.stringify(before.CommonsBoard.lessonDoc()), label + ' lesson document');
  const malicious = '<img src=x onerror=alert(1)>';
  const optionsAvatar = {id: 'm1', name: malicious, size: 32};
  assert.equal(after.CommonsAvatar.html(optionsAvatar), before.CommonsAvatar.html(optionsAvatar));
  const optionsImage = {src: '/asset.jpg', alt: malicious, caption: malicious};
  assert.equal(after.CommonsImage.html(optionsImage), before.CommonsImage.html(optionsImage));
  console.log('PASS demo parity:', label, '(4 routes, template registry, lesson document, reusable builders)');
}
compareDemo({}, 'file');
compareDemo({protocol: 'https:', build: 'demo'}, 'explicit demo');

for (const options of [
  {protocol: 'https:', build: 'live', samples: false},
  {protocol: 'https:', build: 'live', samples: true},
  {protocol: 'file:', build: 'demo', api: 'live', poison: true},
  {protocol: 'file:', build: 'demo', live: true, poison: true},
  {protocol: 'https:', poison: true}
]) {
  const {window, effects} = load(options);
  for (const [name, route] of views) {
    const view = window['Commons' + name];
    assert.match(view.routes[route](), /暂无/);
    view.mount();
    view.destroy();
  }
  assert.equal(window.CommonsBoard.lessonDoc().objects.length, 0);
  assert(!window.CommonsBoardTemplates.list.some(t => t.id === 'knowledge' || t.id === 'code'));
  assert.equal(typeof window.CommonsMedia.player, 'function');
  assert.equal(typeof window.CommonsImage.set, 'function');
  const reactions = window.CommonsReact.bar({targetId: 'real-object', counts: {useful: 3}});
  assert.match(reactions, /disabled/);
  assert.match(reactions, />3<\/span>/);
  assert.doesNotMatch(reactions, /data-ava-act="react-open"/);
  const avatar = window.CommonsAvatar.html({id: 'm1', name: 'Real member'});
  assert.doesNotMatch(avatar, /ava-panda/);
  window.CommonsAvatar.openEditor();
  assert.equal(window.location.hash, '#/account');
  assert.deepEqual(effects, [], 'live must not write demo storage or schedule demo timers');
}
console.log('PASS live: omitted/loaded/throwing sample globals, explicit live precedence, empty routes, no synthetic board/avatar, no demo side effects');

const missing = load({samples: false}).window;
for (const [name, route] of views) assert.match(missing['Commons' + name].routes[route](), /暂无/);
console.log('PASS missing sample scripts: safe empty routes');

(async () => {
  const {window} = load();
  const calls = [], cleanups = [];
  window.CommonsMediaSamples = {formReplay: {events: [{type: 2}], duration: 5, chapters: []}};
  const env = {
    gen: 0, silencers: [], begin: () => 1,
    alive: (card, n, generation) => card.isConnected && generation === env.gen,
    player: (host, data) => { calls.push(data); return {destroy() {}}; },
    fail: () => { throw new Error('Unexpected media fallback'); },
    makeBag: () => ({add: fn => cleanups.push(fn)}), on() {}
  };
  const media = window.COMMONS_MEDIA_SAMPLE.create(env);
  const slot = {};
  const card = {isConnected: true, querySelector: key => key === '[data-slot]' ? slot : null, setAttribute() {}};
  media.replay(card);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'rrweb');
  media.replay(card);
  env.gen++;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1, 'late sample load must be ignored after generation changes');
  media.voice(card);
  assert.equal(env.silencers.length, 1);
  cleanups.forEach(fn => fn());
  assert.equal(env.silencers.length, 0, 'factory cleanup must update the shared silencer list');
  console.log('PASS media factory: replay data, stale-load isolation, shared silencer cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });

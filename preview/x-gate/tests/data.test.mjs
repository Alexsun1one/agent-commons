import test from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from './dom-fixture.mjs';
import { mockFetch, me, people, agents, payloads } from './mock-api.mjs';
import { api, loadSession } from '../src/app/api.js';
import { store } from '../src/app/store.js';
import { loadAgents, loadCatalog, loadDirectory, loadAgentDetail } from '../src/app/data/agents.js';
import { loadPeople, loadPerson, followPerson } from '../src/app/data/people.js';
import { loadProjects, joinProject } from '../src/app/data/projects.js';
import { loadWorks, likeWork, saveWork } from '../src/app/data/works.js';
import { loadEvents, signupEvent } from '../src/app/data/events.js';
import { loadBounties, loadOpportunities } from '../src/app/data/bounties.js';
import { loadNotifications, loadUnread, loadDMUnread } from '../src/app/data/dm.js';
import { loadAnnouncements, loadFeed } from '../src/app/data/news.js';
import { loadGrowth, loadContributions, loadAchievements, loadEconomy } from '../src/app/data/value.js';
import { loadNetwork, buildGraph } from '../src/app/data/network.js';
import base from '../src/app/spaces/base.js';
import network from '../src/app/spaces/network.js';
import hub from '../src/app/spaces/hub.js';
import cocreation from '../src/app/spaces/cocreation.js';
import value from '../src/app/spaces/value.js';
import { mountRemote, action } from '../src/app/spaces/remote.js';
const settle = () => new Promise(resolve => setTimeout(resolve, 15));
const loaders = [loadSession, loadCatalog, loadDirectory, loadAgents, loadPeople, loadProjects, loadWorks, loadEvents,
  loadBounties, loadOpportunities, loadNotifications, loadUnread, loadDMUnread, loadAnnouncements,
  loadFeed, loadGrowth, loadContributions, loadAchievements, loadEconomy];
const modules = [base, network, hub, cocreation, value];

test('all 401 responses normalize to guest without errors or fabricated rows', async () => {
  globalThis.fetch = mockFetch('guest');
  for (const load of [...loaders, loadNetwork]) {
    const state = await load(); assert.equal(state.status, 'guest'); assert.deepEqual(state.items, []); assert.equal(state.error, null);
  }
});

test('empty instance preserves empty arrays, real zero and only the authenticated self node', async () => {
  globalThis.fetch = mockFetch('empty');
  for (const load of [loadDirectory, loadAgents, loadPeople, loadProjects, loadWorks, loadEvents, loadBounties, loadOpportunities,
    loadNotifications, loadAnnouncements, loadFeed, loadContributions, loadAchievements]) {
    assert.deepEqual((await load()).items, []); assert.equal((await load()).status, 'empty');
  }
  assert.equal((await loadEconomy()).items[0].balance, 0);
  const graph = await loadNetwork(); assert.deepEqual(graph.nodes.map(n => n.id), ['me']); assert.deepEqual(graph.relations, []);
});

test('populated response shapes match backend wrappers and preserve graph provenance', async () => {
  globalThis.fetch = mockFetch();
  for (const load of loaders) { const state = await load(); assert.equal(state.status, 'ok'); assert.ok(state.items.length); }
  assert.equal((await loadPerson('lu-yao')).items[0].relation.following, true);
  const graph = await loadNetwork(); assert.equal(graph.nodes.length, 4);
  assert.deepEqual(graph.relations, [{ from: 'me', to: 'a-zheng' }, { from: 'lu-yao', to: 'a-zhuiguang' }, { from: 'me', to: 'lu-yao' }]);
  assert.deepEqual(buildGraph(people, agents.map(a => ({ ...a, owner: undefined })), me).relations, []);
  assert.deepEqual(buildGraph(people, agents, null).relations, [{ from: 'lu-yao', to: 'a-zhuiguang' }]);
});

test('anonymous boards never request public works, tools or Agent directories even when endpoints could reply', async () => {
  const calls = [], normal = mockFetch('data', calls);
  globalThis.fetch = (url, init) => url === '/api/me' ? mockFetch('guest', calls)(url, init) : normal(url, init);
  for (const load of [loadDirectory, loadCatalog, loadWorks, loadNetwork]) assert.equal((await load()).status, 'guest');
  assert.ok(calls.length);assert.ok(calls.every(call => call.path === '/me'));
  const graph = await loadNetwork();assert.deepEqual(graph.nodes, []);assert.deepEqual(graph.relations, []);
});

test('directory reads agentchat items; MCP catalog is only used for tools', async () => {
  const calls = [];globalThis.fetch = mockFetch('data', calls);
  const directory = await loadDirectory();assert.equal(directory.items[0].name, '测试 Agent A');
  assert.ok(calls.some(c => c.path === '/agentchat/agents'));assert.equal(calls.some(c => c.path === '/agents/catalog'), false);
  assert.equal((await loadAgentDetail('a-zheng')).items[0].skills[0], '测试技能');
});

for (const mode of ['guest', 'empty', 'data', 'error']) test(`all board mounts handle ${mode} and clean up`, async () => {
  const doc = installDOM(); globalThis.fetch = mockFetch(mode); store.reset();
  for (const mod of modules) for (const section of mod.sections) {
    const root = doc.createElement('main');doc.body.append(root);
    const cleanup = mod.mount(root, { store, section: section.id, open() {}, fly() {}, focus() {} });
    await settle();
    const label = `${mod.id}/${section.id}`;
    assert.ok(root.textContent, label);
    assert.equal(root.textContent.includes('正在加载'), false, label);
    const remote = true;
    if (remote && mode === 'guest') { assert.ok(root.textContent.includes('登录后可见'), label); assert.equal(root.querySelectorAll('.x-empty').length, 1, label); assert.ok(root.querySelectorAll('a').some(a => a.href === '/#/login'), label); }
    if (remote && mode === 'error') { assert.ok(root.textContent.includes('暂时无法加载'), label); assert.ok(root.querySelectorAll('button').some(b => b.textContent === '重试'), label); }
    if (mode === 'data') assert.equal(root.textContent.includes('暂时无法加载'), false, label);
    assert.equal(root.querySelector('script'), null, label);
    cleanup(); assert.equal(root.children.length, 0, label);
  }
});

test('same-origin mutation contract: CSRF header, methods and encoded paths; no local write simulation', async () => {
  const calls = [];globalThis.fetch = mockFetch('data', calls);
  await followPerson('name/with space', true);await followPerson('name/with space', false);
  await joinProject('test-team');await signupEvent('event-1');await likeWork('work-1');await saveWork('work-1');
  assert.deepEqual(calls.map(c => [c.method, c.path]), [
    ['PUT','/social/follows/name%2Fwith%20space'], ['DELETE','/social/follows/name%2Fwith%20space'],
    ['POST','/orgs/test-team/join'], ['POST','/events/event-1/signup'],
    ['PUT','/content/objects/work-1/reactions/up'], ['PUT','/content/objects/work-1/save'],
  ]);
  for (const call of calls) {
    assert.equal(call.credentials, 'same-origin');assert.equal(call.headers['X-Commons-CSRF'], '1');
    assert.equal(call.headers['Content-Type'], 'application/json');assert.equal(call.headers.Origin, undefined, 'browser supplies Origin');
    assert.deepEqual(JSON.parse(call.body), {});
  }
  assert.throws(() => store.set('myAgents', []), /Business state/);
  assert.equal(store.log, undefined);assert.equal(store.push, undefined);assert.equal(store.get('runs'), undefined);
});

test('network, invalid JSON, malformed envelope and forbidden responses stay errors; 401 body is optional', async () => {
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  assert.equal((await loadWorks()).error.code, 'network_error');
  for (const body of ['not json', '{}', '{"data":{}}']) {
    globalThis.fetch = async () => new Response(body); assert.equal((await loadWorks()).status, 'error');
  }
  globalThis.fetch = mockFetch('error'); assert.equal((await loadWorks()).error.code, 'capability_unavailable');
  globalThis.fetch = async () => new Response('', { status: 401 }); assert.equal((await api.put('/a')).status, 'guest');
});

test('retry recovers, unmount discards late response, and failed mutations never show success', async () => {
  const doc = installDOM(), root = doc.createElement('div'); let release;
  let mode = 'error';globalThis.fetch = (...args) => mockFetch(mode)(...args);
  const cleanup = mountRemote(root, { load: loadWorks, render(host, state) { host.textContent = state.items[0].title; } });
  await settle();assert.ok(root.textContent.includes('暂时无法加载'));
  mode = 'data';root.querySelector('button').click();await settle();assert.equal(root.textContent, '测试作品');cleanup();
  const stop = mountRemote(root, { load: () => new Promise(resolve => { release = resolve; }), render(host) { host.textContent = 'late'; } });
  stop();release({ status: 'ok', items: [{}] });await settle();assert.equal(root.textContent, '');
  const control = action('加入', async () => ({ status: 'error' }), { alive: () => true }, { success: '已加入' });
  control.querySelector('button').click();await settle();assert.ok(control.textContent.includes('操作未完成'));assert.equal(control.textContent.includes('已加入'), false);
});

test('preferences are the only localStorage writes and old business records are not read', async () => {
  const writes = [];
  globalThis.localStorage = { getItem: () => JSON.stringify({ panda: 'mint', onboarded: ['panda'], myAgents: agents, points: 999 }),
    setItem: (key, data) => writes.push([key, JSON.parse(data)]), removeItem() {} };
  try {
    store.reset();assert.deepEqual(store.get('profile'), { panda: 'mint', onboarded: ['panda'] });
    store.set('profile', { panda: 'classic', onboarded: ['network'], points: 99 });
    globalThis.fetch = mockFetch();await store.load('myAgents', loadAgents);
    assert.equal(writes.length, 1);assert.deepEqual(writes[0], ['xgate:preferences:v2', { panda: 'classic', onboarded: ['network'] }]);
  } finally { delete globalThis.localStorage;store.reset(); }
});

test('latest resource load wins over delayed previous account data', async () => {
  let release;const old = store.load('myAgents', () => new Promise(resolve => { release = resolve; }));
  await store.load('myAgents', async () => ({ status: 'guest', items: [], error: null }));
  release({ status: 'ok', items: agents, error: null });await old;
  assert.equal(store.get('myAgents').status, 'guest');
});

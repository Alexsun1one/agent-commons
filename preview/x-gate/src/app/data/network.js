import { loadSession, result } from '../api.js';
import { loadDirectory } from './agents.js';
import { loadPeople, loadPerson } from './people.js';

export function buildGraph(people, agents, me, relations = []) {
  const nodes = [], edges = [], ids = new Set();
  const add = node => { if (node.id && !ids.has(node.id)) { ids.add(node.id); nodes.push(node); } };
  if (me?.id) add({ id: 'me', name: me.display_name || me.handle, kind: 'me', principalId: me.id, handle: me.handle });
  for (const p of people) if (p.id !== me?.id && p.handle) add({ id: p.handle, name: p.display_name || p.handle, kind: 'human', principalId: p.id, handle: p.handle });
  for (const a of agents) if (a.id) add({ id: a.id, name: a.name, kind: 'agent' });
  const seen = new Set();
  const edge = (from, to) => {
    const key = [from, to].sort().join('|');
    if (!ids.has(from) || !ids.has(to) || from === to || seen.has(key)) return;
    seen.add(key); edges.push({ from, to });
  };
  for (const a of agents) {
    const owner = nodes.find(n => n.principalId && n.principalId === (a.owner_id ?? a.owner?.id));
    if (owner) edge(owner.id, a.id);
  }
  for (const r of relations) if (r.relation?.following && r.person?.handle) edge('me', r.person.id === me?.id ? 'me' : r.person.handle);
  return { nodes, relations: edges };
}
export async function loadNetwork(options) {
  const session = await loadSession(options);
  if (session.status !== 'ok') return { ...session, nodes: [], relations: [], following: [] };
  const [people, agents] = await Promise.all([loadPeople(options), loadDirectory(options)]);
  const details = people.status === 'ok' ? await Promise.all(people.items.filter(p => p.handle).map(p => loadPerson(p.handle, options))) : [];
  const expired = [people, agents, ...details].find(r => r.status === 'guest');
  if (expired) return { ...expired, nodes: [], relations: [], following: [] };
  const related = details.flatMap(r => r.items);
  const graph = buildGraph(people.items, agents.items, session.items[0], related);
  const sources = [people, agents, ...details];
  const issues = sources.filter(r => r.status === 'error' || r.status === 'guest');
  return { ...result(graph.nodes), ...graph, issues, mineAgentIds: agents.items.filter(a => (a.owner_id ?? a.owner?.id) === session.items[0]?.id).map(a => a.id), meta: people.meta, following: related.filter(r => r.relation?.following).map(r => r.person.handle) };
}

export let graph = { nodes: [], relations: [] };
export function setNetworkGraph(state) { graph = { nodes: state?.nodes || [], relations: state?.relations || [] }; }
export function neighbors(id) {
  return graph.relations.flatMap(r => r.from === id ? [r.to] : r.to === id ? [r.from] : []);
}

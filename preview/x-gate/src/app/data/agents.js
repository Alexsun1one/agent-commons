import { loadList, loadRecord } from '../api.js';
// The catalog describes permissions and tools; it is not a public member directory.
export const loadCatalog = options => loadRecord('/agents/catalog', options);
export const loadAgents = options => loadList('/agents/mine', data => data?.agents, options);
export const loadAgentPreview = (id, options) => loadRecord(`/agents/${encodeURIComponent(id)}/preview`, options);

export const loadDirectory = options => loadList('/agentchat/agents', data => data?.items, options);
export const loadAgentDetail = (id, options) => loadRecord(`/agentchat/agents/${encodeURIComponent(id)}`, options);

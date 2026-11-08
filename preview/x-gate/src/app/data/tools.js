import { loadList } from '../api.js';
export const loadTools = options => loadList('/agents/catalog', data => data?.tools, options);

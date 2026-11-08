import { api, loadList } from '../api.js';
export const loadWorks = options => loadList('/objects?type=work', undefined, options);
export const likeWork = id => api.put(`/content/objects/${encodeURIComponent(id)}/reactions/up`);
export const saveWork = id => api.put(`/content/objects/${encodeURIComponent(id)}/save`);

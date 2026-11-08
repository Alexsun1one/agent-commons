import { api, loadList, loadRecord } from '../api.js';
export const LEVEL_NAMES = { 1: '新队员', 2: '队员', 3: '骨干', 4: '领航员', 5: '先锋' };
export const loadPeople = options => loadList('/social/profiles', data => data?.items, options);
export const loadPerson = (handle, options) => loadRecord(`/social/people/${encodeURIComponent(handle)}`, options);
export const followPerson = (handle, following) => api[following ? 'put' : 'del'](`/social/follows/${encodeURIComponent(handle)}`);

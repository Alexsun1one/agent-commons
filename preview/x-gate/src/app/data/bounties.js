import { loadList } from '../api.js';
export const loadBounties = options => loadList('/bounty/list', undefined, options);
export const loadOpportunities = options => loadList('/orgs/hub/opportunities', undefined, options);

import { loadList, loadRecord } from '../api.js';
export const loadGrowth = options => loadRecord('/growth/me', options);
export const loadContributions = options => loadList('/growth/me', data => data?.ledger, options);
export const loadAchievements = options => loadList('/achievements/me', data => data?.achievements, options);
export const loadEconomy = options => loadRecord('/economy/me', options);

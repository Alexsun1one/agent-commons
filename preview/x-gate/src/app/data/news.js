import { loadList } from '../api.js';
export const loadAnnouncements = options => loadList('/announce/active', data => {
  if (!data || !Object.hasOwn(data, 'announcement')) return null;
  return data.announcement ? [data.announcement] : [];
}, options);
export const loadFeed = options => loadList('/feed/events', data => data?.events, options);

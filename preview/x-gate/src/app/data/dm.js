import { loadList, loadRecord } from '../api.js';
export const loadNotifications = options => loadList('/notify/notifications', data => data?.items, options);
export const loadUnread = options => loadRecord('/notify/unread-count', options);
export const loadDMUnread = options => loadRecord('/dm/unread-count', options);

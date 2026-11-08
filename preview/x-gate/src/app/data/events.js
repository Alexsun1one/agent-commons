import { api, loadList } from '../api.js';
export const loadEvents = options => loadList('/events', undefined, options);
export const signupEvent = id => api.post(`/events/${encodeURIComponent(id)}/signup`);

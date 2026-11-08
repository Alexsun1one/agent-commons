const KEY = 'xgate:preferences:v2';
const DEFAULT_PROFILE = { panda: 'brand-blue', onboarded: [] };
const COLORS = new Set(['brand-blue', 'mint', 'mist-purple', 'classic', 'graphite', 'night-sky']);
const STEPS = new Set(['panda', 'network', 'cocreation']);
function preference(value = {}) {
  return { panda: COLORS.has(value.panda) ? value.panda : 'brand-blue',
    onboarded: [...new Set(Array.isArray(value.onboarded) ? value.onboarded.filter(id => STEPS.has(id)) : [])] };
}
function loadPreferences() {
  try { localStorage.removeItem('xgate:v1'); return preference(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return { ...DEFAULT_PROFILE, onboarded: [] }; }
}
export const COLLECTIONS = Object.freeze({ profile: DEFAULT_PROFILE, session: null, myAgents: null,
  projects: null, rsvps: null, following: null, events: null, notifications: null, unread: null, dmUnread: null,
  graph: null, growth: null });
let state = { ...structuredClone(COLLECTIONS), profile: loadPreferences() };
const listeners = new Map();
const tickets = new Map();
function emit(key) { for (const k of [key, '*']) for (const cb of listeners.get(k) || []) cb(state[key], key); }
export const store = {
  get: key => state[key],
  set(key, value) {
    if (key !== 'profile') throw new TypeError('Business state must be loaded from the API');
    state.profile = preference(value);
    try { localStorage.setItem(KEY, JSON.stringify(state.profile)); } catch { /* Preferences remain in memory. */ }
    emit(key); return state.profile;
  },
  async load(key, loader) {
    const ticket = (tickets.get(key) || 0) + 1; tickets.set(key, ticket);
    const value = await loader();
    if (tickets.get(key) === ticket) { state[key] = value; emit(key); }
    return value;
  },
  on(key, cb) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(cb); return () => listeners.get(key).delete(cb);
  },
  reset() {
    for (const [key, ticket] of tickets) tickets.set(key, ticket + 1);
    state = { ...structuredClone(COLLECTIONS), profile: loadPreferences() };
    for (const key of Object.keys(state)) emit(key);
  },
  snapshot: () => structuredClone(state),
};

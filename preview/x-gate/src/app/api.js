const BASE = '/api';
const fail = (code, httpStatus = 0) => ({ status: 'error', data: null, meta: {}, error: { code, httpStatus } });

export async function request(method, path, body, options = {}) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return fail('bad_path');
  const headers = { Accept: 'application/json' };
  const init = { method, credentials: 'same-origin', cache: 'no-store', headers, signal: options.signal };
  if (!['GET', 'HEAD'].includes(method)) {
    // Origin is set by the browser for same-origin writes; CSRF is the shared presence header.
    headers['X-Commons-CSRF'] = '1';
    headers['Content-Type'] = 'application/json';
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    init.body = JSON.stringify(body ?? {});
  }
  try {
    const response = await fetch(path.startsWith('/api/') ? path : BASE + path, init);
    if (response.status === 401) return { status: 'guest', data: null, meta: {}, error: null };
    let parsed;
    try { parsed = JSON.parse(await response.text()); } catch { return fail('bad_response', response.status); }
    if (!response.ok) return fail(parsed?.error?.code || `http_${response.status}`, response.status);
    if (!parsed || !Object.hasOwn(parsed, 'data')) return fail('bad_response', response.status);
    return { status: 'ok', data: parsed.data, meta: parsed.meta || {}, error: null };
  } catch (error) {
    return fail(error?.name === 'AbortError' ? 'aborted' : 'network_error');
  }
}
export const api = {
  get: (path, options) => request('GET', path, undefined, options),
  post: (path, body, options) => request('POST', path, body, options),
  put: (path, body, options) => request('PUT', path, body, options),
  del: (path, body, options) => request('DELETE', path, body, options),
};
export const result = items => ({ status: items.length ? 'ok' : 'empty', items, error: null });
export const unavailable = response => ({ status: response.status, items: [], error: response.error });
export function asList(response, select = data => data) {
  if (response.status !== 'ok') return unavailable(response);
  const items = select(response.data);
  if (!Array.isArray(items)) return { status: 'error', items: [], error: { code: 'bad_response' } };
  return { ...result(items), meta: response.meta };
}
let sessionFlight = null;
async function sessionResponse(options) {
  // Deduplicate concurrent checks without retaining an identity across navigation.
  if (!sessionFlight) sessionFlight = api.get('/me').finally(() => { sessionFlight = null; });
  const response = await sessionFlight;
  if (options?.signal?.aborted) return fail('aborted');
  if (response.status === 'ok' && (!response.data?.id || !response.data?.handle)) return fail('bad_response');
  return response;
}
export async function loadList(path, select, options) {
  const session = await sessionResponse(options);
  if (path === '/me' || session.status !== 'ok') return asList(session, select);
  return asList(await api.get(path, options), select);
}
export async function loadRecord(path, options) {
  return loadList(path, data => data === null ? [] : data && typeof data === 'object' && !Array.isArray(data) ? [data] : data, options);
}
export const loadSession = options => loadRecord('/me', options);

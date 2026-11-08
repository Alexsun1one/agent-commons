import { loadSession } from '../api.js';
import { el, button, empty } from '../shell/dom.js';

export const communityURL = route => `/#/${route}`;
export function link(label, route, className = 'x-btn') {
  const node = el('a', className, label); node.href = communityURL(route); return node;
}
export function card(title, text) {
  const node = el('article', 'x-card');
  node.append(el('h3', '', title || '未命名'));
  if (text) node.append(el('p', '', text));
  return node;
}
// 访客、出错、空：同一个组件——熊猫插画 + 一句话 + 一个按钮。
export function stateCard(state, retry, { emptyText = '暂无内容', route = 'contribute', actionLabel = '去社区创建', illus = 'empty-no-content' } = {}) {
  const guest = state?.status === 'guest', failed = state?.status === 'error';
  const node = empty(guest ? '登录后可见' : failed ? '暂时无法加载' : emptyText, guest ? 'empty-no-permission' : failed ? 'empty-offline' : illus);
  if (guest) node.append(link('登录', 'login', 'x-btn primary'));
  else if (failed) node.append(button('重试', retry, 'x-btn primary'));
  else node.append(link(actionLabel, route, 'x-btn primary'));
  return node;
}
// Each mount owns its request and ignores late reads/writes after navigation.
export function mountRemote(root, { load, render, ...options }) {
  let live = true, ticket = 0, controller;
  const cleanups = [];
  async function refresh() {
    cleanups.splice(0).forEach(fn => fn());
    const current = ++ticket;
    controller?.abort(); controller = new AbortController();
    root.replaceChildren(el('p', 'sp-loading', '正在加载…'));
    let state;
    try { state = await load({ signal: controller.signal }); }
    catch { state = { status: 'error', items: [], error: { code: 'load_failed' } }; }
    if (!live || current !== ticket) return;
    root.replaceChildren();
    if (state.status !== 'ok') root.append(stateCard(state, refresh, options));
    else {
      try { render(root, state, { refresh, alive: () => live && current === ticket, onCleanup: fn => cleanups.push(fn) }); }
      catch { root.replaceChildren(stateCard({ status: 'error' }, refresh, options)); }
    }
    for (const issue of state.issues || []) root.append(stateCard(issue, refresh, options));
    if (state.meta?.next_cursor || state.meta?.cursor) root.append(link('在社区查看全部', options.route || 'home', 'x-btn ghost'));
  }
  void refresh();
  return () => { live = false; cleanups.splice(0).forEach(fn => fn()); ++ticket; controller?.abort(); root.replaceChildren(); };
}
export function action(label, run, lifecycle, { success = '已提交', onSuccess, className = 'x-btn', content } = {}) {
  const host = el('span', 'x-action'), feedback = el('span', 'x-action-status');
  feedback.setAttribute('role', 'status');
  const btn = button(label, async () => {
    if (btn.disabled) return;
    btn.disabled = true; feedback.replaceChildren();
    let response;
    try { response = await run(); } catch { response = { status: 'error' }; }
    if (!lifecycle.alive()) return;
    btn.disabled = false;
    if (response.status === 'guest') feedback.append(link('登录后继续', 'login', 'x-btn ghost'));
    else if (response.status === 'error') { feedback.textContent = '操作未完成，请重试'; }
    else { feedback.textContent = success; onSuccess?.(response); }
  }, className);
  if (content) { btn.textContent = ''; btn.append(content); btn.setAttribute('aria-label', label); btn.title = label; }
  host.append(btn, feedback); return host;
}
export function mountLink(root, sessionLoader, route, label) {
  return mountRemote(root, { load: sessionLoader, route, render(host) { host.append(link(label, route)); } });
}

export function authenticatedSpace(space) {
  return { ...space, mount(root, context) {
    return mountRemote(root, { load: loadSession, render(host, state, lifecycle) {
      lifecycle.onCleanup(space.mount(host, context));
    } });
  } };
}

import { store } from './store.js';
import { createCameraDirector, STATE_BY_PLACE } from './camera.js';
import { installPicking } from './shell/picking.js';
import { CATALOG, SPACE_IDS, validSpaceModule } from './shell/catalog.js';
import { el, button, empty, icon } from './shell/dom.js';

import { loadSession } from './api.js';
import { loadNetwork, setNetworkGraph } from './data/network.js';
import { loadNotifications, loadUnread, loadDMUnread } from './data/dm.js';
import { mountRemote, card as messageCard, link } from './spaces/remote.js';

export function mineIds(source) {
  return [...new Set([...(source.get('session')?.status === 'ok' ? ['me'] : []),
    ...(source.get('myAgents')?.items || []).map(a => a.id), ...(source.get('graph')?.mineAgentIds || []), ...(source.get('graph')?.following || [])])];
}
export function fallbackModule(id) {
  return { ...CATALOG[id], highlights: () => [], mount(root, { open, section } = {}) {
    const content = empty('此空间施工中'); const list = el('ul', 'x-list');
    if (open) content.append(button('重新加载', () => open(section)));
    CATALOG[id].sections.forEach(s => list.append(el('li', 'x-row', s.label)));
    root.replaceChildren(content, list); return () => root.replaceChildren();
  } };
}
export const isNetworkSplit = (place, section) => place === 'network' && ['relations','graph'].includes(section);
export function cardStartsCollapsed(place, mobile, cameraState) { return mobile || (place === 'base' && cameraState === 'BaseEntrance'); }
export function mount(world) {
  world.app?.dispose?.();
  store.reset(); setNetworkGraph(null);
  const $ = id => document.getElementById(id);
  const app = $('x-app'), nav = $('x-navigation'), card = $('x-space-card'), workbench = $('x-workbench'), messages = $('x-messages');
  const actions = $('x-scene-actions'), tabs = $('x-sections'), content = $('x-content');
  const cache = new Map(), cardMedia = matchMedia('(max-width: 760px)');
  let cardExpanded = false, selectedNode = null, unmounting = false;
  let current = 'base', space = fallbackModule('base'), activeSection = null, cleanup = null;
  let disposed = false, flightTicket = 0, viewTicket = 0, returnFocus = null, messageFocus = null;
  const unsubs = [], listeners = [];
  function listen(node, event, callback) { node.addEventListener(event, callback); listeners.push(() => node.removeEventListener(event, callback)); }
  // 板块里除了一个空状态再没有可见内容时给内容区打标，style.css 据此把它垂直居中；板块自己的重绘也会触发。
  const EMPTY = '.x-empty,.sp-cocreation-empty,.sp-value-empty';
  const emptyWatch = new MutationObserver(() => {
    const found = content.querySelector(EMPTY);
    content.toggleAttribute('data-solo-empty', !!found && [...content.querySelectorAll('*')].every(n => found.contains(n) || n.contains(found) || !n.getClientRects().length));
  });
  emptyWatch.observe(content, { childList: true, subtree: true });
  function teardown() {
    if (!cleanup) return;
    const fn = cleanup; cleanup = null; unmounting = true;
    try { fn(); } catch (error) { console.warn('[x-gate] 空间清理失败', error); }
    finally { unmounting = false; }
  }
  const director = createCameraDirector(world, {
    onState(state, id) {
      if (current === 'network' && id !== 'network') { selectedNode = null; world.places.network?.highlight?.(null); }
      current = id; card.hidden = true;
      cardExpanded = !cardStartsCollapsed(id, cardMedia.matches, state);
      document.body.classList.toggle('x-card-expanded', cardExpanded);
      // 空间卡与面板头已写着楼名，顶栏只在没有它们的全景和大厅里补一句位置；读屏的到达播报改走 x-announcer。
      const where = state === 'CityOverview' ? '价值之城' : state === 'BaseInterior' ? '迎宾大厅' : '';
      $('x-location').textContent = where; $('x-location').hidden = !where;
      if (!where) $('x-announcer').textContent = CATALOG[id].title;
      for (const b of nav.querySelectorAll('[data-place]')) { b.setAttribute('aria-current', String(b.dataset.place === id ? 'location' : 'false')); }
      renderActions();
    },
  });
  function focus(nodeId) {
    if (disposed || unmounting || current !== 'network') return;
    if (nodeId == null) {
      if (activeSection === 'relations') nodeId = 'me';
      else {
        // APPS 图中再次点击同一点会取消选择；R3要求离开建筑前保留选中。
        // 用同一ref重开当前图，使右侧选择与3D继续一致；旧板块的清理不走这里。
        if (activeSection === 'graph' && selectedNode) {
          const ticket = viewTicket, keep = selectedNode;
          queueMicrotask(() => { if (ticket === viewTicket && !disposed && !workbench.hidden) void open('graph',keep); });
        }
        return;
      }
    }
    selectedNode = String(nodeId); world.places.network?.highlight?.(selectedNode);
    if (isNetworkSplit(current,activeSection)) void director.focusNode(selectedNode);
  }
  // 世界永远在场：工作台是停在右侧的面板，相机把建筑摆进左边的留白，不模糊、不压暗、不降帧。
  // 总部镜头是导轨/大厅，打开面板时锁住滚轮；消息面板打开时同样锁住。
  function overlayState() {
    const docked = !workbench.hidden, busy = docked || !messages.hidden;
    director.setSplitView(docked);
    director.setBlocked(!messages.hidden || (docked && current === 'base'));
    actions.hidden = busy; card.inert = busy;
    workbench.inert = !messages.hidden; workbench.setAttribute('aria-hidden', String(workbench.hidden || !messages.hidden));
  }
  async function loadSpace(id) {
    if (cache.has(id)) return cache.get(id);
    try {
      const mod = (await import(`./spaces/${id}.js`)).default;
      if (!validSpaceModule(mod, id)) throw new Error('空间接口不完整');
      cache.set(id, mod); return mod;
    } catch { return fallbackModule(id); }
  }
  function renderActions() {
    actions.replaceChildren();
    if (director.state === 'BaseInterior') actions.append(button('离开大厅', () => navigate('base'), 'x-btn ghost'));
    else if (current === 'base') {
      actions.append(button('进入大厅', enterInterior, 'x-btn primary'));
      actions.append(button(director.state === 'CityOverview' ? '返回入口' : '城市全景', () => director.state === 'CityOverview' ? navigate('base') : overview(), 'x-btn ghost'));
    }
  }
  function renderCard() {
    card.replaceChildren(); card.dataset.place = current;
    const header = el('header', 'x-card-header'), title = el('h1', '', space.title);
    const primary = button(space.primary.label, () => open(space.primary.section), 'x-btn primary');
    primary.hidden = cardExpanded;
    const toggle = button(cardExpanded ? '−' : '⌄', () => {
      cardExpanded = !cardExpanded; renderCard(); card.querySelector('#x-card-toggle')?.focus();
    }, 'x-btn ghost x-close');
    toggle.id = 'x-card-toggle'; toggle.setAttribute('aria-expanded', String(cardExpanded));
    toggle.setAttribute('aria-controls', 'x-card-details'); toggle.setAttribute('aria-label', cardExpanded ? '收起空间卡' : '展开空间卡');
    title.title = space.title; header.append(title, primary, toggle);
    card.classList.toggle('is-collapsed', !cardExpanded);
    document.body.classList.toggle('x-card-expanded', cardExpanded);
    const details = el('div', 'x-card-details'); details.id = 'x-card-details'; details.hidden = !cardExpanded;
    const entries = el('div', 'x-card-entries');
    for (const entry of CATALOG[current].entries.filter(e => space.sections.some(s => s.id === e.section))) {
      const cell = button('', () => open(entry.section), 'x-entry'); cell.append(icon(entry.glyph), el('span', '', entry.label)); entries.append(cell);
    }
    details.append(entries, button(space.primary.label, () => open(space.primary.section), 'x-btn primary'));
    card.append(header, details);
  }
  function closeWorkbench({ restore = true } = {}) {
    ++viewTicket; teardown(); workbench.hidden = true; activeSection = null; content.replaceChildren();
    if (director.state !== 'CityOverview' && !director.moving) card.hidden = false;
    overlayState();
    if (restore && current === 'network' && selectedNode) void director.focusNode(selectedNode);
    if (restore) { if (returnFocus?.isConnected && !returnFocus.closest('[hidden]')) returnFocus.focus(); else nav.querySelector(`[data-place="${current}"]`)?.focus(); }
  }
  async function open(section = space.primary.section, ref) {
    if (disposed) return;
    const ticket = ++viewTicket, id = current;
    if (!cache.has(id)) {
      const loaded = await loadSpace(id);
      if (ticket !== viewTicket || id !== current || disposed) return;
      space = loaded;
    }
    if (!space.sections.some(s => s.id === section)) section = space.primary.section;
    if (isNetworkSplit(current,section) && ref == null) {
      ref = selectedNode;
      // relations 无选择保持空 ref；显式 me 专指“我”的详情。
      if (section === 'graph' && (!ref || ref === 'me')) {
        const node = world.hotspots.find(h => /^network:(agent|human):/.test(h.userData.hotspot));
        ref = node?.userData.nodeId || node?.userData.hotspot.split(':').slice(2).join(':');
      }
    }
    if (workbench.hidden) returnFocus = document.activeElement;
    teardown(); activeSection = section; workbench.hidden = false; card.hidden = true;
    overlayState();
    $('x-workbench-title').textContent = space.title;
    workbench.dataset.place = current;
    if (isNetworkSplit(current,section)) workbench.dataset.sync = 'node'; else delete workbench.dataset.sync;
    tabs.replaceChildren();
    for (const s of space.sections) {
      const b = button(s.label, () => open(s.id), 'x-btn ghost'); b.id = `x-tab-${s.id}`;
      b.setAttribute('role','tab'); b.setAttribute('aria-selected',String(section === s.id)); b.setAttribute('aria-controls','x-content'); b.tabIndex = section === s.id ? 0 : -1;
      tabs.append(b);
    }
    content.setAttribute('aria-labelledby', `x-tab-${section}`); content.replaceChildren(); content.scrollTop = 0;
    try {
      cleanup = space.mount(content, { store, section, ref, open, fly, focus: nodeId => { if (ticket === viewTicket) focus(nodeId); } });
      if (typeof cleanup !== 'function') cleanup = null;
    } catch (error) {
      console.warn('[x-gate] 工作台暂不可用', error);
      const message = empty('此板块暂时无法打开'); message.append(button('重试', () => open(section, ref))); content.replaceChildren(message);
    }
    tabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (isNetworkSplit(current,section) && ref != null) focus(ref);
    overlayState(); content.focus(); $('x-announcer').textContent = `${space.title}，${space.sections.find(s => s.id === section).label}`;
  }
  async function navigate(id, section, ref, interior = false) {
    if (!SPACE_IDS.includes(id) || disposed) return false;
    const ticket = ++flightTicket;
    closeMessages(false);
    if (section && !interior && id === current && director.state === STATE_BY_PLACE[id] && !director.moving) { await open(section, ref); return true; }
    closeWorkbench({ restore: false }); card.hidden = true;
    const modulePromise = loadSpace(id);
    const arrived = await director.go(interior ? 'BaseInterior' : STATE_BY_PLACE[id], { split: !!section && !interior });
    if (!arrived || ticket !== flightTicket || disposed) return false;
    const mod = await modulePromise;
    if (ticket !== flightTicket || disposed) return false;
    space = mod; renderCard(); card.hidden = false; renderActions();
    if (section) await open(section, ref);
    return true;
  }
  async function fly(id, section) { return navigate(id, section || CATALOG[id]?.primary.section); }
  async function enterInterior() { return navigate('base', undefined, undefined, true); }
  async function overview() { ++flightTicket; closeMessages(false); closeWorkbench({ restore: false }); card.hidden = true; return director.go('CityOverview'); }
  let messageCleanup = null;
  function updateUnread() {
    const session = store.get('session');
    $('x-message-nav').hidden = session?.status !== 'ok';
    const counts = [store.get('unread'), store.get('dmUnread')];
    const known = counts.every(r => r?.status === 'ok' && Number.isInteger(r.items[0]?.count));
    const count = known ? counts.reduce((n, r) => n + r.items[0].count, 0) : null;
    const badge = $('x-unread'); badge.textContent = count === null ? '' : String(count); badge.hidden = !count;
    $('x-message-nav').setAttribute('aria-label', count === null ? '消息，未读数暂不可用' : `消息，${count} 条未读`);
  }
  function renderMessages() {
    messageCleanup?.();
    messageCleanup = mountRemote($('x-messages-content'), {
      load: options => store.load('notifications', () => loadNotifications(options)), route: 'messages',
      emptyText: '暂无通知', actionLabel: '打开社区消息',
      render(host, state) {
        for (const n of state.items) host.append(messageCard(n.title, n.body));
        host.append(link('通知与已读管理', 'notifications'), link('打开私信', 'messages'));
      },
    });
  }
  function openMessages() {
    if (store.get('session')?.status !== 'ok') return;
    if (!messages.hidden) { closeMessages(); return; }
    messageFocus = document.activeElement; messages.hidden = false; renderMessages(); overlayState();
    $('x-message-nav').setAttribute('aria-expanded','true'); $('x-messages-close').focus();
  }
  function closeMessages(restore = true) {
    messageCleanup?.(); messageCleanup = null;
    const wasOpen = !messages.hidden; messages.hidden = true;
    $('x-message-nav')?.setAttribute('aria-expanded','false'); overlayState();
    if (restore && wasOpen && messageFocus?.isConnected) messageFocus.focus();
  }
  const navLabels = ['基地','连接','管理','共创','价值'];
  const navIcons = ['gate','network','hub','cocreation','value'];
  nav.replaceChildren();
  SPACE_IDS.forEach((id, i) => {
    const b = button('', () => navigate(id), 'x-nav-item'); b.dataset.place = id;
    const glyph = el('span','x-nav-icon'); glyph.append(icon(navIcons[i])); b.append(glyph,el('span','',navLabels[i])); nav.append(b);
  });
  const messageButton = button('', openMessages, 'x-nav-item'); messageButton.id = 'x-message-nav'; messageButton.setAttribute('aria-expanded','false'); messageButton.setAttribute('aria-controls','x-messages');
  const messageIcon = el('span','x-nav-icon'); messageIcon.append(icon('messages'));
  const badge = el('span','x-unread'); badge.id = 'x-unread'; messageButton.append(messageIcon,el('span','','消息'),badge); nav.append(messageButton);
  listen($('x-workbench-close'),'click',() => closeWorkbench()); listen($('x-messages-close'),'click',() => closeMessages());
  tabs.setAttribute('aria-orientation','horizontal');
  listen(tabs,'keydown',event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    const buttons = [...tabs.children], index = buttons.indexOf(document.activeElement); if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1 : (index+(event.key === 'ArrowRight'?1:-1)+buttons.length)%buttons.length;
    buttons.forEach((b,i) => { b.tabIndex = i === next ? 0 : -1; }); buttons[next].focus(); buttons[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  listen(document,'keydown', event => {
    if (event.key === 'Escape') {
      if (!messages.hidden) closeMessages(); else if (!workbench.hidden) closeWorkbench(); else if (director.state === 'BaseInterior') void navigate('base');
      else return;
      event.preventDefault();
    }
    if (event.key === 'Tab' && (!workbench.hidden || !messages.hidden)) {
      const panel = messages.hidden ? workbench : messages;
      const nodes = [...nav.querySelectorAll('button'), ...panel.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),summary,[tabindex="0"]')].filter(n => n.tabIndex >= 0 && !n.closest('[hidden]') && n.getClientRects().length);
      const i = nodes.indexOf(document.activeElement);
      if (nodes.length && (i < 0 || (!event.shiftKey && i === nodes.length-1) || (event.shiftKey && i === 0))) { event.preventDefault(); nodes[event.shiftKey ? nodes.length-1 : 0].focus(); }
    }
  });
  listen(cardMedia, 'change', () => {
    tabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    cardExpanded = !cardStartsCollapsed(current, cardMedia.matches, director.state); renderCard();
  });
  const stopPicking = installPicking(world,director,$('x-hotspot-label'), route => {
    if (route.type === 'interior') void enterInterior();
    else if (route.place === 'network' && route.ref === 'me' && current === 'network') void open('relations','me');
    else if (route.place === 'network' && route.ref && current === 'network') void open(activeSection === 'graph' ? 'graph' : 'relations', route.ref);
    else void navigate(route.place,route.section,route.ref);
  }, () => !messages.hidden || (!workbench.hidden && current === 'base'));
  const syncMine = () => world.places.network?.markMine?.(mineIds(store));
  unsubs.push(store.on('myAgents',syncMine),store.on('following',syncMine));
  unsubs.push(store.on('session', updateUnread), store.on('unread', updateUnread), store.on('dmUnread', updateUnread));
  unsubs.push(store.on('graph', state => {
    if (disposed) return;
    setNetworkGraph(state);
    if (world.places.network?.setGraph) world.setHotspots('network:nodes', world.places.network.setGraph({ nodes: state?.nodes || [], relations: state?.relations || [] }));
    syncMine();
  }));
  unsubs.push(store.on('*',() => { if (!card.hidden) renderCard(); }));
  // onFrame 仅收敛空间卡可见性，不重复渲染 DOM。
  const offFrame = world.onFrame(() => { if (director.state === 'CityOverview') card.hidden = true; });
  syncMine(); updateUnread(); app.hidden = false;
  void store.load('session', loadSession).then(async session => {
    if (disposed) return;
    const tasks = [store.load('graph', loadNetwork)];
    if (session.status === 'ok') tasks.push(store.load('unread', loadUnread), store.load('dmUnread', loadDMUnread));
    await Promise.all(tasks);
  });
  void navigate('base');
  const api = { fly, open, focus, director, get section() { return activeSection; }, get selectedNode() { return selectedNode; }, dispose() {
    if (disposed) return;
    disposed = true; messageCleanup?.(); ++flightTicket; ++viewTicket; teardown(); world.places.network?.highlight?.(null); stopPicking(); offFrame(); director.dispose(); emptyWatch.disconnect();
    listeners.forEach(off => off()); unsubs.forEach(off => off()); world.setIdle(false); app.hidden = true;
    document.body.classList.remove('x-card-expanded');
  } };
  world.app = api; return api;
}

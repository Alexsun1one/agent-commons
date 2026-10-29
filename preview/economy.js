/* R13 ECON-1 · 竹子商店、竹子钱包、余额 badge 与可嵌签到卡。 */
(function () {
  'use strict';

  var NAV_ICON = 'M7 3h10v5l-2 2v4l2 2v5H7v-5l2-2v-4L7 8V3m2 2v2h6V5H9m2 5v4h2v-4h-2m-2 8v1h6v-1H9';
  var DEMO_STORE = 'economy.demo.v1';
  var balanceListeners = [];
  var state = {
    root: null,
    view: 'shop',
    category: 'all',
    pendingKey: null,
    tryOnKey: null,
    busy: null,
    focusReturn: null,
    notice: '',
    closed: false,
    bound: false,
    controller: null,
    data: null,
    account: ''
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function sessionAccount() {
    var me = window.CommonsSession && window.CommonsSession.me;
    return me ? String(me.id || me.handle || '') : '';
  }

  function resetLiveAccount() {
    if (state.controller) state.controller.abort();
    state.controller = window.AbortController ? new AbortController() : null;
    state.data = null;
  }

  function onSessionChange() {
    var next = sessionAccount();
    if (next === state.account) return;
    state.account = next;
    resetLiveAccount();
    if (window.CommonsAPI && window.CommonsAPI.mode === 'live' && (state.root || document.querySelector('[data-eco-checkin-embed]'))) {
      loadLive();
    }
  }

  window.addEventListener('commons:session', onSessionChange);

  function cloneSample() {
    var fresh = JSON.parse(JSON.stringify(window.COMMONS_ECONOMY_SAMPLE || {
      me: { balance: 0, today: { earned: 0, cap: 300, remaining: 300 }, inventory: [], checkin: { rewards: [] } },
      categories: [{ key: 'all', name: '全部' }], shop: [], entries: []
    }));
    if (!window.CommonsAPI || window.CommonsAPI.mode !== 'live') {
      var saved = window.Commons && window.Commons.read ? window.Commons.read(DEMO_STORE, null) : null;
      if (saved && saved.me && Array.isArray(saved.shop)) return saved;
    }
    return fresh;
  }

  function data() {
    if (!state.data) state.data = cloneSample();
    return state.data;
  }

  function fmt(value) {
    return new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
  }

  function balance() {
    return Number(data().me.balance) || 0;
  }

  function persistDemo() {
    if ((!window.CommonsAPI || window.CommonsAPI.mode !== 'live') && window.Commons && window.Commons.write) {
      window.Commons.write(DEMO_STORE, data());
    }
  }

  function syncBalanceNodes() {
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    document.querySelectorAll('[data-eco-shared-balance]').forEach(function (node) {
      node.textContent = fmt(balance());
    });
    document.querySelectorAll('[data-eco-badge]').forEach(function (node) {
      node.setAttribute('aria-label', '我的竹子 ' + fmt(balance()));
    });
  }

  function emitBalance(source) {
    syncBalanceNodes();
    balanceListeners.slice().forEach(function (listener) {
      listener(balance(), { source: source || 'economy' });
    });
  }

  function setBalance(value, source) {
    data().me.balance = Math.max(0, Number(value) || 0);
    persistDemo();
    emitBalance(source);
    return balance();
  }

  function changeBalance(delta, source) {
    return setBalance(balance() + (Number(delta) || 0), source);
  }

  function onChange(listener) {
    if (typeof listener !== 'function') return function () {};
    balanceListeners.push(listener);
    listener(balance(), { source: 'subscribe' });
    return function () {
      balanceListeners = balanceListeners.filter(function (item) { return item !== listener; });
    };
  }

  /* safe-fn: fixed SVG bamboo mark without data interpolation */
  function bambooIcon() {
    return '<svg class="eco-bamboo-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6v5H9V3Zm-.7 6h7.4v5H8.3V9ZM7 15h10v6H7v-6Z" fill="currentColor" opacity=".9"/><path d="m15 5 4-2-2 4m-8 5-4-2 2 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function assetBar() {
    var me = data().me;
    var today = me.today || { earned: 0, cap: 300, remaining: 300 };
    var progress = Math.max(0, Math.min(100, Math.round((Number(today.earned) || 0) / Math.max(1, Number(today.cap) || 1) * 100)));
    var progressScale = progress / 100;
    return '<section class="eco-assets" aria-label="竹子余额和今日额度"><div class="eco-balance-mark" role="status" aria-live="polite">' + bambooIcon() +
      '<span><small>我的竹子</small><strong data-eco-shared-balance>' + esc(fmt(me.balance)) + '</strong></span></div>' +
      '<div class="eco-day-meter"><div><span>今日还能赚</span><strong>' + esc(fmt(today.remaining)) + '</strong></div>' +
      '<span class="eco-stalk" role="progressbar" aria-label="今日竹子额度" aria-valuemin="0" aria-valuemax="' + esc(fmt(today.cap)) + '" aria-valuenow="' + esc(fmt(today.earned)) + '">' +
      '<i style="--eco-progress:' + /* safe: progressScale is a clamped numeric ratio */ progressScale + '"></i>' +
      '<b></b><b></b><b></b><b></b></span><small>' + esc(fmt(today.earned)) + ' / ' + esc(fmt(today.cap)) + '</small></div>' +
      '<a class="eco-ledger-link" href="#/wallet">查看流水</a></section>';
  }

  function toolbar() {
    return '<div class="eco-toolbar"><span>签到、逛商店、查流水</span>' +
      ((!window.CommonsAPI || window.CommonsAPI.mode !== 'live') ? '<span class="eco-demo">示例</span>' : '') + '</div>';
  }

  function notice() {
    return state.notice ? '<div class="eco-notice" role="status">' + esc(state.notice) + '</div>' : '';
  }

  function frameInfo(item) {
    var known = {
      'frame-bamboo-mist': ['common', '普通'],
      'frame-blue-ink': ['refined', '精致'],
      'frame-cloud-trace': ['rare', '稀有'],
      'frame-night-radio': ['legendary', '典藏']
    };
    if (item.rarity && item.rarity_label) return [item.rarity, item.rarity_label];
    if (known[item.key]) return known[item.key];
    if (Number(item.price) >= 220) return ['legendary', '典藏'];
    if (Number(item.price) >= 160) return ['rare', '稀有'];
    if (Number(item.price) >= 120) return ['refined', '精致'];
    return ['common', '普通'];
  }

  /* safe-fn: avatar source is fixed; all data attributes and labels are escaped */
  function itemArt(item) {
    if (item.category === 'avatar_frame') {
      var rarity = frameInfo(item);
      return '<div class="eco-item-art eco-avatar-art" data-rarity="' + esc(rarity[0]) + '" aria-hidden="true"><div class="eco-avatar-frame"><img src="assets/mascot/panda-avatar-brand-blue-512.webp" alt=""></div><small>' + esc(rarity[1]) + '</small></div>';
    }
    return '<div class="eco-item-art" data-category="' + esc(item.category) + '" aria-hidden="true"><span></span><i>' +
      esc(String(item.name || '').slice(0, 1)) + '</i><b></b></div>';
  }

  function itemAction(item) {
    if (item.category === 'avatar_frame') {
      var trying = state.tryOnKey === item.key;
      var tryButton = '<button class="button ghost small" type="button" data-eco-action="try-on" data-key="' + esc(item.key) + '" aria-pressed="' + trying + '"' +
        (state.busy ? ' disabled' : '') + '>' + (trying ? '取消试戴' : '试戴') + '</button>';
      if (item.equipped) return '<div class="eco-frame-actions"><span class="eco-equipped">佩戴中</span>' + tryButton + '</div>';
      if (item.owned) return '<div class="eco-frame-actions"><span class="eco-owned-tag">已拥有</span>' + tryButton +
        '<button class="button tonal small" type="button" data-eco-action="equip" data-key="' + esc(item.key) + '"' + (state.busy ? ' disabled' : '') + '>佩戴</button></div>';
      var soldOut = item.remaining === 0;
      return '<div class="eco-frame-actions">' + tryButton + '<button class="button small" type="button" data-eco-action="ask-buy" data-key="' + esc(item.key) + '"' +
        (soldOut || state.busy ? ' disabled' : '') + '>' + (soldOut ? '已售罄' : '购买') + '</button></div>';
    }
    if (item.equipped) return '<span class="eco-equipped">装备中</span>';
    if (item.owned) {
      return '<button class="button tonal small" type="button" data-eco-action="equip" data-key="' + esc(item.key) + '"' +
        (state.busy ? ' disabled' : '') + '>装备</button>';
    }
    var soldOut = item.remaining === 0;
    return '<button class="button small" type="button" data-eco-action="ask-buy" data-key="' + esc(item.key) + '"' +
      (soldOut || state.busy ? ' disabled' : '') + '>' + (soldOut ? '已售罄' : '看看') + '</button>';
  }

  function confirmation(item) {
    if (state.pendingKey !== item.key) return '';
    var short = Number(data().me.balance) < Number(item.price);
    return '<div class="eco-confirm" role="status"><span>' + (short ? '还差 ' + esc(fmt(item.price - data().me.balance)) + ' 竹子' : '确认用 ' + esc(fmt(item.price)) + ' 竹子购买') +
      '</span><div><button class="button ghost small" type="button" data-eco-action="cancel-buy">取消</button>' +
      '<button class="button primary small" type="button" data-eco-action="buy" data-key="' + esc(item.key) + '"' +
      (short || state.busy ? ' disabled' : '') + '>' + (state.busy === item.key ? '<span class="button-spinner" aria-hidden="true"></span>' : '') +
      '购买</button></div></div>';
  }

  function itemCard(item) {
    var limit = item.limited == null ? '常驻' : '还剩 ' + fmt(item.remaining);
    return '<article class="eco-item' + (item.owned ? ' is-owned' : '') + (state.tryOnKey === item.key ? ' is-trying' : '') + '">' + itemArt(item) +
      '<div class="eco-item-copy"><span>' + esc(item.category_label) + '</span><h3>' + esc(item.name) + '</h3><small>' + esc(limit) + '</small></div>' +
      '<div class="eco-item-price">' + bambooIcon() + '<strong>' + esc(fmt(item.price)) + '</strong></div>' + itemAction(item) + confirmation(item) + '</article>';
  }

  function categories() {
    return '<div class="eco-category-rail"><div class="segmented eco-categories" role="group" aria-label="商品分类">' + data().categories.map(function (category) {
      var selected = state.category === category.key;
      return '<button type="button" data-eco-action="category" data-category="' + esc(category.key) + '" aria-pressed="' + selected + '"' +
        (selected ? ' class="selected"' : '') + '>' + esc(category.name) + '</button>';
    }).join('') + '</div></div>';
  }

  function shelf(category, items) {
    return '<section class="eco-shelf" aria-labelledby="eco-shelf-' + esc(category) + '"><header><h2 id="eco-shelf-' + esc(category) + '">' +
      esc(items[0].category_label) + '</h2><span>' + esc(items.length) + ' 件</span></header><div class="eco-shelf-items">' +
      items.map(itemCard).join('') + '</div></section>';
  }

  function shopSection() {
    var list = data().shop.filter(function (item) { return state.category === 'all' || item.category === state.category; });
    var groups = [];
    list.forEach(function (item) {
      var group = groups.find(function (entry) { return entry.key === item.category; });
      if (!group) {
        group = { key: item.category, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    });
    return '<section class="eco-store" id="eco-store" aria-labelledby="eco-store-title"><h2 id="eco-store-title">商店</h2>' + categories() +
      (groups.length ? '<div class="eco-shelves">' + groups.map(function (group) { return shelf(group.key, group.items); }).join('') + '</div>' :
        '<div class="eco-empty"><p>这一栏还没有商品</p><button class="button" type="button" data-eco-action="category" data-category="all">看全部</button></div>') + '</section>';
  }

  function dayLabel(value) {
    var day = String(value || '').slice(0, 10);
    var current = (data().me.today || {}).day;
    if (day === current) return '今天';
    return day.replace(/-/g, '.');
  }

  function entryRow(entry) {
    var positive = Number(entry.amount) > 0;
    return '<li><span class="eco-entry-sign" data-positive="' + positive + '">' + (positive ? '+' : '−') + '</span>' +
      '<span class="eco-entry-copy"><strong>' + esc(entry.reason_label || entry.reason) + '</strong><small>' +
      esc(String(entry.created_at || '').slice(11, 16)) + '</small></span><b class="eco-entry-amount" data-positive="' + positive + '">' +
      (positive ? '+' : '−') + esc(fmt(Math.abs(Number(entry.amount) || 0))) + '</b></li>';
  }

  function entryGroups() {
    var groups = [];
    data().entries.forEach(function (entry) {
      var key = String(entry.created_at || '').slice(0, 10);
      var group = groups.find(function (item) { return item.key === key; });
      if (!group) {
        group = { key: key, items: [] };
        groups.push(group);
      }
      group.items.push(entry);
    });
    if (!groups.length) return '<section class="eco-empty"><h2>还没有竹子流水</h2><a class="button primary" href="#/shop">去看看商店</a></section>';
    return '<div class="eco-ledger">' + groups.map(function (group) {
      return '<section><header><h2>' + esc(dayLabel(group.key)) + '</h2><span>' + esc(group.items.length) + ' 笔</span></header><ul>' +
        group.items.map(entryRow).join('') + '</ul></section>';
    }).join('') + '</div>';
  }

  function inventoryStrip() {
    var items = data().me.inventory || [];
    return '<section class="eco-owned"><header><h2>我的物品</h2><span>' + esc(items.length) + ' 件</span></header><div>' +
      (items.length ? items.map(function (item) {
        return '<span' + (item.equipped ? ' class="is-equipped"' : '') + '><b>' + esc(String(item.name).slice(0, 1)) + '</b><small>' + esc(item.name) + '</small></span>';
      }).join('') : '<p>买到的物品会放在这里。</p>') + '</div></section>';
  }

  function walletSection() {
    return '<section class="eco-wallet" id="eco-wallet" aria-labelledby="eco-wallet-title"><h2 id="eco-wallet-title">流水</h2>' +
      inventoryStrip() + entryGroups() + '</section>';
  }

  function shell(view) {
    state.view = view;
    return '<main class="eco-page" data-eco-root data-view="' + esc(view) + '">' + pageContent() + '</main>';
  }

  function pageContent() {
    if (state.closed) {
      return '<div class="eco-empty" role="status"><p>这个功能还没开放</p><p>管理员还没打开。</p></div>';
    }
    return toolbar() + assetBar() + checkinMarkup() + notice() + shopSection() + walletSection();
  }

  function shopPage() { return shell('shop'); }
  function walletPage() { return shell('wallet'); }

  function rewardNodes(checkin) {
    return (checkin.rewards || []).map(function (reward, index) {
      var day = index + 1;
      var done = day < Number(checkin.next_cycle_day) || checkin.claimed_today && day === Number(checkin.next_cycle_day);
      return '<span data-done="' + done + '" data-gift="' + (day === 7) + '"><b>' + esc(day) + '</b><small>' + esc(fmt(reward)) + '</small>' + (done ? '<span class="sr-only">已领</span>' : '') + '</span>';
    }).join('');
  }

  function checkinMarkup() {
    var item = data().me.checkin || { rewards: [] };
    return '<section class="eco-checkin" data-eco-checkin-card><header><div>' + bambooIcon() + '<span><strong>连续签到 ' + esc(item.streak || 0) + ' 天</strong><small>' +
      (item.claimed_today ? '今天已领取' : '今天领 ' + esc(fmt(item.next_reward)) + ' 竹子') + '</small></span></div>' +
      '<div class="eco-checkin-actions"><span>竹子 <b data-eco-shared-balance>' + esc(fmt(balance())) + '</b></span><button class="button ' + (item.claimed_today ? 'tonal' : 'primary') + '" type="button" data-eco-action="checkin"' +
      (item.claimed_today || state.busy ? ' disabled' : '') + '>' + (item.claimed_today ? '已签到' : '签到') + '</button></div></header>' +
      '<div class="eco-checkin-track" role="group" aria-label="七日签到奖励">' + rewardNodes(item) + '</div></section>';
  }

  function badge() {
    var me = data().me;
    return '<a class="eco-badge" data-eco-badge href="#/wallet" aria-label="我的竹子 ' + esc(fmt(me.balance)) + '">' + bambooIcon() + '<strong data-eco-shared-balance>' + esc(fmt(me.balance)) + '</strong></a>';
  }

  function checkin(container) {
    var html = checkinMarkup();
    if (container && container.nodeType === 1) {
      container.setAttribute('data-eco-checkin-embed', '');
      container.innerHTML = html;
    }
    return html;
  }

  function render() {
    var active = document.activeElement;
    var keep = state.focusReturn || (active && active.getAttribute ? {
      action: active.getAttribute('data-eco-action') || '',
      key: active.getAttribute('data-key') || '',
      category: active.getAttribute('data-category') || ''
    } : null);
    if (state.root) state.root.innerHTML = pageContent();
    document.querySelectorAll('[data-eco-checkin-embed]').forEach(function (host) { host.innerHTML = checkinMarkup(); });
    syncBalanceNodes();
    if (state.root) {
      var next = null;
      if (state.pendingKey) next = state.root.querySelector('[data-eco-action="buy"][data-key="' + state.pendingKey + '"]:not([disabled])');
      if (!next && keep && keep.action) {
        next = Array.prototype.find.call(state.root.querySelectorAll('[data-eco-action="' + keep.action + '"]'), function (node) {
          return (!keep.key || node.getAttribute('data-key') === keep.key) && (!keep.category || node.getAttribute('data-category') === keep.category);
        });
      }
      if (!next && keep && keep.key) next = state.root.querySelector('[data-key="' + keep.key + '"]:not([disabled])');
      if (next && next.focus) next.focus({ preventScroll: true });
      if (!state.busy) state.focusReturn = null;
    }
  }

  function addEntry(amount, label, reason, ref) {
    data().entries.unshift({
      id: 'demo-' + Date.now(), amount: amount, reason: reason, reason_label: label, ref: ref,
      created_at: new Date().toISOString()
    });
  }

  function demoBuy(item) {
    setBalance(balance() - item.price, 'shop.purchase');
    item.owned = true;
    data().me.inventory.push({ item_key: item.key, name: item.name, category: item.category,
      category_label: item.category_label, equipped: false, acquired_at: new Date().toISOString() });
    addEntry(-item.price, '购买「' + item.name + '」', 'shop.purchase', item.key);
    state.notice = '已买下「' + item.name + '」';
  }

  function purchase(item) {
    if (!item || Number(data().me.balance) < Number(item.price) || state.busy) return;
    state.busy = item.key;
    state.notice = '';
    render();
    if (!window.CommonsAPI || window.CommonsAPI.mode !== 'live') {
      demoBuy(item);
      persistDemo();
      state.busy = null;
      state.pendingKey = null;
      render();
      return;
    }
    window.CommonsAPI.post('/economy/shop/' + encodeURIComponent(item.key) + '/buy', {}, {
      idempotencyKey: window.CommonsAPI.newIdempotencyKey(), signal: state.controller && state.controller.signal
    }).then(function (response) {
      setBalance(response.data.balance, 'shop.purchase');
      data().me.inventory = response.data.inventory;
      state.notice = '已买下「' + item.name + '」';
      state.pendingKey = null;
      return loadLive();
    }).catch(showError).finally(function () { state.busy = null; render(); });
  }

  function equip(item) {
    if (!item || state.busy) return;
    state.busy = item.key;
    render();
    if (!window.CommonsAPI || window.CommonsAPI.mode !== 'live') {
      data().shop.forEach(function (candidate) {
        if (candidate.category === item.category) candidate.equipped = false;
      });
      data().me.inventory.forEach(function (candidate) {
        if (candidate.category === item.category) candidate.equipped = candidate.item_key === item.key;
      });
      item.equipped = true;
      state.tryOnKey = null;
      state.notice = '已装备「' + item.name + '」';
      persistDemo();
      state.busy = null;
      render();
      return;
    }
    window.CommonsAPI.post('/economy/inventory/' + encodeURIComponent(item.key) + '/equip', {}, {
      idempotencyKey: window.CommonsAPI.newIdempotencyKey(), signal: state.controller && state.controller.signal
    }).then(function (response) {
      data().me.inventory = response.data.inventory;
      state.tryOnKey = null;
      state.notice = '已装备「' + item.name + '」';
      return loadLive();
    }).catch(showError).finally(function () { state.busy = null; render(); });
  }

  function claimCheckin() {
    var item = data().me.checkin;
    if (!item || item.claimed_today || state.busy) return;
    state.busy = 'checkin';
    if (!window.CommonsAPI || window.CommonsAPI.mode !== 'live') {
      item.claimed_today = true;
      item.streak += 1;
      item.last_reward = item.next_reward;
      setBalance(balance() + item.next_reward, 'economy.checkin');
      data().me.today.earned += item.next_reward;
      data().me.today.remaining = Math.max(0, data().me.today.cap - data().me.today.earned);
      addEntry(item.next_reward, '每日签到', 'economy.checkin', item.day);
      persistDemo();
      state.notice = '签到成功，竹子已到账';
      state.busy = null;
      render();
      return;
    }
    window.CommonsAPI.post('/economy/checkin', {}, { signal: state.controller && state.controller.signal })
      .then(function (response) {
        data().me.checkin = response.data;
        setBalance(response.meta.balance, 'economy.checkin');
        state.notice = '签到成功，竹子已到账';
        return loadLive();
      }).catch(showError).finally(function () { state.busy = null; render(); });
  }

  function showError(error) {
    if (error && error.name === 'AbortError') return;
    if (error && (error.status === 501 || error.code === 'capability_unavailable')) {
      state.closed = true;
      state.notice = '';
      return;
    }
    state.closed = false;
    state.notice = error && error.message ? error.message : '操作没有完成，请重试';
  }

  function onClick(event) {
    var button = event.target.closest('[data-eco-action]');
    if (!button) return;
    var action = button.dataset.ecoAction;
    state.focusReturn = { action: action, key: button.dataset.key || '', category: button.dataset.category || '' };
    if (action === 'category') {
      state.category = button.dataset.category || 'all';
      state.pendingKey = null;
      state.tryOnKey = null;
      render();
      return;
    }
    if (action === 'cancel-buy') {
      state.pendingKey = null;
      render();
      return;
    }
    if (action === 'checkin') {
      claimCheckin();
      return;
    }
    var item = data().shop.find(function (candidate) { return candidate.key === button.dataset.key; });
    if (action === 'try-on' && item) {
      state.tryOnKey = state.tryOnKey === item.key ? null : item.key;
      state.notice = state.tryOnKey ? '正在试戴「' + item.name + '」' : '已结束试戴';
      render();
    } else if (action === 'ask-buy' && item) {
      state.pendingKey = item.key;
      state.notice = '';
      render();
    } else if (action === 'buy') purchase(item);
    else if (action === 'equip') equip(item);
  }

  function loadLive() {
    if (!window.CommonsAPI || window.CommonsAPI.mode !== 'live') return Promise.resolve();
    if (!state.controller && window.AbortController) state.controller = new AbortController();
    return Promise.all([
      window.CommonsAPI.get('/economy/me', null, { signal: state.controller && state.controller.signal }),
      window.CommonsAPI.get('/economy/shop', null, { signal: state.controller.signal }),
      window.CommonsAPI.get('/economy/entries', { limit: 50 }, { signal: state.controller && state.controller.signal })
    ]).then(function (responses) {
      data().me = responses[0].data;
      data().shop = responses[1].data;
      data().categories = [{ key: 'all', name: '全部' }].concat((responses[1].meta.categories || []).map(function (item) {
        return { key: item.key, name: item.name };
      }));
      data().entries = responses[2].data;
      emitBalance('economy.load');
      render();
    }).catch(showError);
  }

  function mount() {
    destroy();
    state.root = document.querySelector('[data-eco-root]');
    var hasEmbed = document.querySelector('[data-eco-checkin-embed]');
    if (!state.root && !hasEmbed) return;
    state.view = state.root ? state.root.dataset.view || 'shop' : state.view;
    state.controller = new AbortController();
    document.addEventListener('click', onClick);
    state.bound = true;
    Promise.resolve(loadLive()).then(function () {
      if (state.view !== 'wallet' || !state.root) return;
      var root = state.root;
      requestAnimationFrame(function () {
        if (state.root === root && root.isConnected) root.querySelector('#eco-wallet').scrollIntoView({ block: 'start' });
      });
    });
  }

  function destroy() {
    if (state.bound) document.removeEventListener('click', onClick);
    if (state.controller) state.controller.abort();
    state.root = null;
    state.controller = null;
    state.bound = false;
    state.pendingKey = null;
    state.tryOnKey = null;
    state.busy = null;
    state.notice = '';
  }

  window.CommonsEconomy = {
    routes: { shop: shopPage, wallet: walletPage },
    hub: ['shop', 'wallet'],
    nav: [['shop', '竹子商店', 'bamboo', 'growth']],
    icons: { bamboo: NAV_ICON },
    badge: badge,
    checkin: checkin,
    balance: balance,
    setBalance: setBalance,
    change: changeBalance,
    onChange: onChange,
    mount: mount,
    destroy: destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsEconomy);
})();

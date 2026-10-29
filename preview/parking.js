/* R13 PARK-1 · 俯视停车场。demo 只改内存；live 只走 CommonsAPI。 */
(function () {
  'use strict';

  var STORE = 'parking.demo.v1';
  var CAR_ASSETS = {
    hatch: 'assets/game/park-car-hatch.webp', sedan: 'assets/game/park-car-sedan.webp',
    suv: 'assets/game/park-car-suv.webp', van: 'assets/game/park-car-van.webp',
    scooter: 'assets/game/park-car-scooter.webp', robotaxi: 'assets/game/park-car-robotaxi.webp',
    pickup: 'assets/game/park-car-pickup.webp', 'panda-bus': 'assets/game/park-car-panda-bus.webp'
  };
  var state = { model: null, loading: false, error: '', selectedCar: '', ticket: null, bound: false, offBalance: null };
  var root = null;
  var ticketTimer = 0;

  function C() { return window.Commons || {}; }
  function live() { return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live'); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function esc(value) {
    if (C().esc) return C().esc(String(value == null ? '' : value));
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  /* safe-fn: CommonsLinks.person 按接口约定转义；本地退路对名字 esc、handle encodeURIComponent。 */
  function personLink(handle, name, level) {
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') return window.CommonsLinks.person(handle, name, { level: level });
    return handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + esc(name) + '</a>' : esc(name);
  }
  /* safe-fn: CommonsLinks.a 按接口约定转义；本地退路只拼 parking 路由。 */
  function parkingLink(handle, label) {
    if (window.CommonsLinks && typeof window.CommonsLinks.a === 'function') return window.CommonsLinks.a('parking', handle, label);
    return handle ? '<a class="park-lot-link" href="#/parking/' + encodeURIComponent(handle) + '">' + esc(label) + '</a>' : esc(label);
  }
  function safeUrl(value) {
    if (C().safeUrl) return C().safeUrl(String(value || ''));
    var path = String(value || '');
    return /^assets\/game\/[A-Za-z0-9._-]+\.webp$/.test(path) ? path : '';
  }
  function toast(message) { if (C().toast) C().toast(message); }
  function sample() { return window.COMMONS_PARKING_SAMPLE || { me: { owner: {}, spaces: [], vehicles: [], bamboo: 0 }, lots: {}, friends: [] }; }
  function balance() {
    if (window.CommonsEconomy && typeof window.CommonsEconomy.balance === 'function') return window.CommonsEconomy.balance();
    return state.model ? amount(state.model.me.bamboo) : amount(sample().me.bamboo);
  }
  function changeBalance(delta, source) {
    var next = window.CommonsEconomy && typeof window.CommonsEconomy.change === 'function'
      ? window.CommonsEconomy.change(delta, source)
      : Math.max(0, balance() + Number(delta || 0));
    if (state.model) state.model.me.bamboo = next;
    return next;
  }
  function emptyModel() {
    return { me: { owner: {}, spaces: [], vehicles: [], bamboo: 0 }, lots: {}, friends: [] };
  }
  function restore() {
    if (state.model) return;
    if (live()) {
      state.model = emptyModel();
      return;
    }
    var saved = C().read ? C().read(STORE, null) : null;
    state.model = saved && saved.me ? saved : clone(sample());
    state.model.me.bamboo = balance();
    state.selectedCar = (state.model.me.vehicles.find(function (car) { return !car.parked; }) || {}).vehicle_id || '';
  }
  function persist() { if (!live() && C().write) C().write(STORE, state.model); }
  function handle() {
    var raw = String(location.hash || '').replace(/^#\/?/, '').split('/');
    if (raw[0] !== 'parking' || !raw[1]) return '';
    try { return decodeURIComponent(raw[1]); } catch (error) { return ''; }
  }
  function ownLot() { return !handle() || handle() === state.model.me.owner.handle; }
  function currentLot() { return ownLot() ? state.model.me : state.model.lots[handle()]; }
  function modelClass(key) { return Object.prototype.hasOwnProperty.call(CAR_ASSETS, key) ? key : 'hatch'; }
  function carShape(car, compact) {
    var key = modelClass(car.model_key);
    return '<span class="park-car park-car-' + esc(key) + (compact ? ' is-compact' : '') + '" aria-hidden="true">' +
      '<img data-park-car-image src="' + safeUrl(CAR_ASSETS[key]) + '" alt=""><span class="park-car-fallback"><i></i><b></b><em></em></span></span>';
  }
  function amount(value) { return Math.max(0, Number(value) || 0); }
  function statusTag(space) {
    if (space.welcome) return '<span class="chip park-tag">欢迎停车</span>';
    if (!space.vehicle) return '<span class="chip park-tag">可停车</span>';
    if (space.vehicle.can_ticket) return '<span class="chip park-tag is-ready">可贴条</span>';
    return '<span class="chip park-tag">保护中</span>';
  }
  function spaceCard(space, mine) {
    var car = space.vehicle;
    var action = '';
    if (mine && !car) action = '<button class="button ghost park-mini" data-park-action="welcome" data-slot="' + esc(space.slot_no) + '">' + (space.welcome ? '取消欢迎' : '设为欢迎') + '</button>';
    if (mine && car && car.can_ticket && !space.welcome) action = '<button class="button tonal park-mini" data-park-action="ticket" data-slot="' + esc(space.slot_no) + '">贴条</button>';
    if (!mine && !car) action = '<button class="button primary park-mini" data-park-action="park" data-slot="' + esc(space.slot_no) + '">停这里</button>';
    return '<article class="park-space' + (space.welcome ? ' is-welcome' : '') + (car ? ' is-occupied' : '') + '">' +
      '<div class="park-space-top"><b>' + esc(String(space.slot_no).padStart(2, '0')) + '</b>' + statusTag(space) + '</div>' +
      (car ? '<div class="park-car-wrap">' + carShape(car, false) + '<strong>' + esc(car.nickname || car.model_name || '小车') + '</strong>' +
        '<span>' + personLink(car.vehicle_owner_handle, car.vehicle_owner_name || '', car.vehicle_owner_level) + ' · 已赚 ' + esc(amount(car.earnings && car.earnings.projected)) + '</span></div>' :
        '<div class="park-empty-mark" role="img" aria-label="空车位"><i></i><span>' + (space.welcome ? '欢迎停靠' : '空位') + '</span></div>') +
      (car && car.message ? '<p class="park-message">“' + esc(car.message) + '”</p>' : '') +
      '<div class="park-space-action">' + action + '</div></article>';
  }
  function lotView(lot) {
    if (!lot) return '<section class="park-missing"><h2>这块停车场不可见</h2><a class="button" href="#/parking">回我的车场</a></section>';
    var mine = ownLot();
    return '<section class="park-stage" aria-label="' + esc(lot.owner.display_name) + '的停车场">' +
      '<div class="park-stage-head"><div><span>' + (mine ? '我的停车场' : personLink(lot.owner.handle, lot.owner.display_name, lot.owner.level)) + '</span><strong>' + esc(lot.spaces.filter(function (s) { return !s.vehicle; }).length) + ' 个空位</strong></div>' +
      (!mine ? '<a class="button ghost" href="#/parking">回到我的</a>' : '') + '</div>' +
      '<div class="park-lane"><span>入口</span><i></i><b>慢行</b></div>' +
      '<div class="park-grid">' + lot.spaces.map(function (space) { return spaceCard(space, mine); }).join('') + '</div>' +
      '<div class="park-exit"><i></i><span>出口</span></div></section>';
  }
  function vehicleCard(car) {
    return '<article class="park-my-car' + (car.parked ? ' is-away' : '') + '">' + carShape(car, true) +
      '<div><strong>' + esc(car.nickname) + '</strong><span>' + (car.parked ? '停在 ' + parkingLink(car.lot_handle, car.lot_name || car.lot_handle || '好友车场') : '在家 · ' + esc(car.hourly_rate) + ' 竹/时') + '</span></div>' +
      (car.parked ? '<b>+' + esc(amount(car.earnings && car.earnings.projected)) + '</b><button class="button ghost" data-park-action="move" data-car="' + esc(car.vehicle_id) + '">挪车</button>' :
        '<label class="park-car-choice"><input type="radio" name="park-car" value="' + esc(car.vehicle_id) + '" aria-label="选车：' + esc(car.nickname) + '"' + (state.selectedCar === car.vehicle_id ? ' checked' : '') + '><span>选车</span></label>') + '</article>';
  }
  function friendCard(friend) {
    var avatar = window.CommonsAvatar && typeof window.CommonsAvatar.html === 'function'
      ? window.CommonsAvatar.html({ id: friend.id || friend.handle, name: friend.display_name, size: 40, src: friend.avatar, level: friend.level })
      : '<span class="park-avatar">' + esc(String(friend.display_name || friend.handle || '?').slice(0, 1)) + '</span>';
    var status = friend.my_car_here ? '我的车在这里' : friend.free_spaces ? friend.free_spaces + ' 个空位' : '已经停满';
    return '<a class="park-friend" href="#/parking/' + encodeURIComponent(friend.handle) + '">' + /* safe: CommonsAvatar.html 逐值转义并处理头像回退 */ avatar + '<div><strong>' + esc(friend.display_name) + '</strong><span>' +
      esc(status) + '</span></div><i aria-hidden="true">›</i></a>';
  }
  function rail() {
    var me = state.model.me;
    return '<aside class="park-rail"><section><div class="park-section-title"><h2>我的车</h2><span>' + esc(me.vehicles.length) + ' 辆</span></div><div class="park-car-list">' +
      me.vehicles.map(vehicleCard).join('') + '</div></section><section><div class="park-section-title"><h2>好友车场</h2><span>按状态排序</span></div><div class="park-friends">' +
      state.model.friends.map(friendCard).join('') + '</div></section></aside>';
  }
  function ticketLayer() {
    if (!state.ticket) return '';
    return '<div class="park-ticket-layer" role="status"><div class="park-ticket"><img src="assets/game/park-ticket.webp" alt=""><span>已贴条</span><strong>−' + esc(state.ticket.fine) + ' 竹</strong></div></div>';
  }
  function shell() {
    restore();
    var balanceHTML = '<div class="park-balance" role="status" aria-live="polite" aria-label="竹子余额"><span>竹子</span><strong data-eco-shared-balance>' + esc(balance()) + '</strong></div>';
    var heading = handle()
      ? '<header class="park-head"><div><div class="park-title-line"><h1>' + (ownLot() ? '抢车位' : 'Ta 的车场') + '</h1>' + (!live() ? '<span class="chip">示例</span>' : '') + '</div><p>把车停进好友的空位，按小时赚竹子。</p></div>' + balanceHTML + '</header>'
      : '<div class="park-head park-head-tab"><p>停到好友空位，按小时赚竹子。</p><div class="park-head-actions">' + (!live() ? '<span class="chip">示例</span>' : '') + balanceHTML + '</div></div>';
    if (live() && state.error) {
      if (state.error === 'closed') {
        return '<div class="park-page" data-parking-root>' + heading +
          '<div class="park-error" role="status"><span>这个功能还没开放</span><p>管理员还没打开。</p></div></div>';
      }
      return '<div class="park-page" data-parking-root>' + heading +
        '<div class="park-error" role="alert"><span>' + esc(state.error) + '</span><button class="button" data-park-action="retry">重试</button></div></div>';
    }
    if (live() && (!state.model.me || !state.model.me.owner || !state.model.me.owner.handle)) {
      return '<div class="park-page" data-parking-root>' + heading +
        '<div class="park-error" aria-live="polite"><span>正在读取停车场…</span></div></div>';
    }
    return '<div class="park-page" data-parking-root>' + heading +
      '<div class="park-layout">' + lotView(currentLot()) + rail() + '</div>' + ticketLayer() + '</div>';
  }
  function paint() {
    if (!root) return;
    var host = root.parentNode;
    if (!host) return;
    var rebind = state.bound;
    var active = document.activeElement;
    var keep = active && active.getAttribute ? {
      action: active.getAttribute('data-park-action') || '',
      car: active.getAttribute('data-car') || '',
      slot: active.getAttribute('data-slot') || '',
      radio: active.name === 'park-car' ? active.value : ''
    } : null;
    host.innerHTML = shell();
    root = host.querySelector('[data-parking-root]');
    if (root && rebind) {
      root.addEventListener('click', onClick);
      root.addEventListener('change', onChange);
    }
    if (root && keep) {
      var nodes = keep.radio ? root.querySelectorAll('[name="park-car"]') : root.querySelectorAll('[data-park-action="' + keep.action + '"]');
      var next = Array.prototype.find.call(nodes, function (node) {
        return (!keep.car || node.getAttribute('data-car') === keep.car) && (!keep.slot || node.getAttribute('data-slot') === keep.slot) && (!keep.radio || node.value === keep.radio);
      });
      if (!next && keep.car) next = Array.prototype.find.call(root.querySelectorAll('[name="park-car"]'), function (node) { return node.value === keep.car; });
      if (!next && keep.slot) next = root.querySelector('[data-slot="' + keep.slot + '"]');
      if (next && next.focus) next.focus({ preventScroll: true });
    }
    bindAssetFallbacks();
  }

  function bindAssetFallbacks() {
    if (!root) return;
    root.querySelectorAll('[data-park-car-image]').forEach(function (image) {
      function loaded() { image.closest('.park-car').classList.add('has-image'); }
      function failed() { image.hidden = true; image.closest('.park-car').classList.remove('has-image'); }
      if (image.complete) {
        if (image.naturalWidth) loaded(); else failed();
      } else {
        image.addEventListener('load', loaded, { once: true });
        image.addEventListener('error', failed, { once: true });
      }
    });
  }
  function apiOptions() { return { idempotencyKey: window.CommonsAPI.newIdempotencyKey() }; }
  function loadLive() {
    if (!live() || state.loading) return;
    state.loading = true; state.error = '';
    var target = handle();
    Promise.all([
      window.CommonsAPI.get('/parking/me'),
      window.CommonsAPI.get('/parking/friends'),
      target ? window.CommonsAPI.get('/parking/' + encodeURIComponent(target)) : Promise.resolve(null)
    ]).then(function (rows) {
      state.model.me = rows[0].data;
      state.model.friends = rows[1].data;
      if (target && rows[2]) state.model.lots[target] = rows[2].data;
      state.selectedCar = (state.model.me.vehicles.find(function (car) { return !car.parked; }) || {}).vehicle_id || '';
      paint();
    }).catch(function (error) {
      state.model = emptyModel();
      state.error = (error && (error.status === 501 || error.code === 'capability_unavailable')) ? 'closed' : (error && error.message ? error.message : '停车场暂时没有回应');
      paint();
    }).finally(function () { state.loading = false; });
  }
  function demoPark(slot) {
    var car = state.model.me.vehicles.find(function (item) { return item.vehicle_id === state.selectedCar && !item.parked; });
    var lot = currentLot();
    var space = lot && lot.spaces.find(function (item) { return item.slot_no === slot; });
    if (!car) return toast('先选一辆在家的车');
    if (!space || space.vehicle) return toast('这个车位刚被占了');
    car.parked = true; car.lot_handle = lot.owner.handle; car.lot_name = lot.owner.display_name; car.slot_no = slot;
    car.earnings = { hours: 0, gross: 0, projected: 0 };
    space.vehicle = { vehicle_id: car.vehicle_id, nickname: car.nickname, model_key: car.model_key,
      vehicle_owner_name: state.model.me.owner.display_name, message: '来串门啦', earnings: car.earnings, can_ticket: false };
    var friend = state.model.friends.find(function (item) { return item.handle === lot.owner.handle; });
    if (friend) { friend.free_spaces = Math.max(0, friend.free_spaces - 1); friend.my_car_here = true; }
    state.selectedCar = (state.model.me.vehicles.find(function (item) { return !item.parked; }) || {}).vehicle_id || '';
    persist(); paint(); toast('停好了');
  }
  function demoMove(id) {
    var car = state.model.me.vehicles.find(function (item) { return item.vehicle_id === id; });
    if (!car || !car.parked) return;
    var lot = state.model.lots[car.lot_handle];
    if (lot) {
      var space = lot.spaces.find(function (item) { return item.vehicle && item.vehicle.vehicle_id === id; });
      if (space) space.vehicle = null;
    }
    changeBalance(amount(car.earnings.projected), 'parking.move');
    car.parked = false; car.stay_id = null; car.lot_handle = ''; car.lot_name = ''; car.slot_no = null;
    car.earnings = { hours: 0, gross: 0, projected: 0 };
    state.selectedCar = id; persist(); paint(); toast('收益已入袋');
  }
  function demoTicket(slot) {
    var space = state.model.me.spaces.find(function (item) { return item.slot_no === slot; });
    if (!space || !space.vehicle || !space.vehicle.can_ticket || space.welcome) return toast('现在还不能贴条');
    var fine = Math.floor(amount(space.vehicle.earnings.gross) / 2);
    changeBalance(fine, 'parking.ticket'); space.vehicle = null; state.ticket = { fine: fine };
    clearTimeout(ticketTimer); ticketTimer = setTimeout(function () { state.ticket = null; paint(); }, 1300);
    persist(); paint();
  }
  function liveAction(action, body, success) {
    state.error = '';
    window.CommonsAPI.post('/parking/' + action, body, apiOptions()).then(function (response) {
      if (success) success(response.data);
      var target = handle();
      return Promise.all([window.CommonsAPI.get('/parking/me'), window.CommonsAPI.get('/parking/friends'),
        target ? window.CommonsAPI.get('/parking/' + encodeURIComponent(target)) : Promise.resolve(null)]);
    }).then(function (rows) {
      state.model.me = rows[0].data; state.model.friends = rows[1].data;
      if (handle() && rows[2]) state.model.lots[handle()] = rows[2].data;
      paint();
    }).catch(function (error) { state.error = error.message || '操作没有完成'; paint(); });
  }
  function act(name, button) {
    var slot = Number(button.dataset.slot || 0);
    if (name === 'retry') return loadLive();
    if (name === 'park') {
      if (!state.selectedCar) return toast('先选一辆在家的车');
      if (live()) return liveAction('park', { vehicle_id: state.selectedCar, owner_handle: handle(), slot_no: slot, message: '来串门啦' });
      return demoPark(slot);
    }
    if (name === 'move') {
      if (live()) return liveAction('move', { vehicle_id: button.dataset.car });
      return demoMove(button.dataset.car);
    }
    if (name === 'ticket') {
      if (live()) return liveAction('ticket', { slot_no: slot }, function (data) {
        state.ticket = { fine: data.fine }; clearTimeout(ticketTimer);
        ticketTimer = setTimeout(function () { state.ticket = null; paint(); }, 1300);
      });
      return demoTicket(slot);
    }
    if (name === 'welcome') {
      var space = state.model.me.spaces.find(function (item) { return item.slot_no === slot; });
      if (!space) return;
      if (live()) return liveAction('welcome', { slot_no: slot, enabled: !space.welcome });
      space.welcome = !space.welcome; persist(); paint();
    }
  }
  function onClick(event) {
    var button = event.target.closest('[data-park-action]');
    if (button && root && root.contains(button)) act(button.dataset.parkAction, button);
  }
  function onChange(event) {
    if (event.target.name === 'park-car') state.selectedCar = event.target.value;
  }
  function mount() {
    destroy();
    root = document.querySelector('[data-parking-root]');
    if (!root) return;
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    state.bound = true;
    bindAssetFallbacks();
    if (window.CommonsEconomy && typeof window.CommonsEconomy.onChange === 'function') {
      state.offBalance = window.CommonsEconomy.onChange(function (value) {
        if (state.model) state.model.me.bamboo = value;
        paint();
      });
    }
    loadLive();
  }
  function destroy() {
    clearTimeout(ticketTimer); ticketTimer = 0;
    if (root && state.bound) { root.removeEventListener('click', onClick); root.removeEventListener('change', onChange); }
    if (state.offBalance) state.offBalance();
    state.offBalance = null;
    root = null; state.bound = false; state.ticket = null;
  }

  window.CommonsParking = {
    routes: { parking: shell },
    hub: ['parking'],
    nav: [['parking', '抢车位', 'car', 'games']],
    mount: mount,
    destroy: destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsParking);
  if (window.CommonsLinks && typeof window.CommonsLinks.provide === 'function') {
    window.CommonsLinks.provide('parking', function (handle) {
      if (live()) return null;
      var model = window.COMMONS_PARKING_SAMPLE || {};
      var lot = model.me && model.me.owner && model.me.owner.handle === handle ? model.me : model.lots && model.lots[handle];
      return lot ? { label: '车位', href: '#/parking/' + encodeURIComponent(handle), count: (lot.spaces || []).length, icon: 'car' } : null;
    });
  }
}());


/* R13 PET-1 · 熊猫小窝。demo 只改 Commons 本机存储；live 只走 CommonsAPI。 */
(function () {
  'use strict';

  var STORE = 'pet.demo.v1';
  var PALETTES = [
    ['classic', '经典黑白'], ['brand-blue', '先锋蓝'], ['mint', '薄荷青'],
    ['mist-purple', '雾紫'], ['graphite', '石墨灰'], ['night-sky', '夜空蓝']
  ];
  var state = { model: null, visiting: null, root: null, bound: false, busy: '', error: '', reaction: '', timer: 0, offBalance: null };

  function C() { return window.Commons || {}; }
  function live() { return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live'); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function esc(value) {
    if (C().esc) return C().esc(String(value == null ? '' : value));
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function toast(message) { if (C().toast) C().toast(message); }
  function safeUrl(value) { return C().safeUrl ? C().safeUrl(value) : (/^#\//.test(String(value || '')) ? String(value) : '#'); }
  function sample() { return window.COMMONS_PET_SAMPLE || { me: { owner: {}, pet: null, bamboo: 0, outfit: [] }, diary: [], friends: [] }; }
  function emptyModel() {
    return { me: { owner: {}, pet: null, bamboo: 0, outfit: [] }, diary: [], friends: [] };
  }
  function restore() {
    if (state.model) return;
    if (live()) {
      state.model = emptyModel();
      return;
    }
    var saved = C().read ? C().read(STORE, null) : null;
    state.model = saved && saved.me ? saved : clone(sample());
  }
  function persist() { if (!live() && C().write) C().write(STORE, state.model); }
  function paletteKey(value) {
    return PALETTES.some(function (item) { return item[0] === value; }) ? value : 'classic';
  }
  function pandaImage(palette, name, className) {
    return '<img class="' + esc(className || '') + '" src="assets/mascot/panda-avatar-' +
      esc(paletteKey(palette)) + '-512.webp" alt="' + esc(name || '熊猫') + '">';
  }
  function clamp(value) { return Math.max(0, Math.min(100, Number(value) || 0)); }
  function apiOptions() { return { idempotencyKey: window.CommonsAPI.newIdempotencyKey() }; }
  function targetHandle() {
    var parts = String(location.hash || '').replace(/^#\/?/, '').split('/');
    if (parts[0] !== 'pet' || !parts[1]) return '';
    try { return decodeURIComponent(parts[1]); } catch (error) { return ''; }
  }

  function petHref(handle) {
    if (window.CommonsLinks && typeof window.CommonsLinks.href === 'function') {
      var shared = window.CommonsLinks.href('pet', handle);
      if (shared) return shared;
    }
    return '#/pet/' + encodeURIComponent(handle || '');
  }

  function bambooBalance() {
    if (window.CommonsEconomy && typeof window.CommonsEconomy.balance === 'function') {
      return Math.max(0, Number(window.CommonsEconomy.balance()) || 0);
    }
    return Math.max(0, Number(state.model && state.model.me && state.model.me.bamboo) || 0);
  }

  function changeBamboo(delta, source) {
    var next;
    if (window.CommonsEconomy && typeof window.CommonsEconomy.change === 'function') {
      next = window.CommonsEconomy.change(delta, source);
    } else {
      next = Math.max(0, bambooBalance() + (Number(delta) || 0));
    }
    state.model.me.bamboo = Math.max(0, Number(next) || 0);
    return state.model.me.bamboo;
  }

  function adoption() {
    return '<section class="pet-adopt" aria-labelledby="pet-adopt-title"><div class="pet-adopt-copy"><span class="chip">第一次见面</span>' +
      '<h2 id="pet-adopt-title">领养一只熊猫</h2><p>选毛色，再给它一个最多 8 个字的名字。</p></div>' +
      '<form data-pet-adopt-form><div class="pet-palette" role="radiogroup" aria-label="熊猫毛色">' +
      PALETTES.map(function (item, index) {
        return '<label><input type="radio" name="palette" value="' + esc(item[0]) + '"' + (index === 1 ? ' checked' : '') + '>' +
          '<span>' + pandaImage(item[0], item[1], '') + '<b>' + esc(item[1]) + '</b></span></label>';
      }).join('') + '</div><label class="field"><span>名字</span><input name="name" maxlength="8" required value="团团" autocomplete="off"></label>' +
      '<button class="button primary large" type="submit"' + (state.busy ? ' disabled' : '') + '>带它回家</button></form></section>';
  }

  function ring(label, value, tone) {
    var score = clamp(value);
    return '<div class="pet-ring pet-ring-' + esc(tone) + '" style="--pet-progress:' + Number(score) + '">' +
      '<div><strong>' + Number(score) + '</strong><span>' + esc(label) + '</span></div></div>';
  }

  function stageProgress(pet) {
    if (pet.next_threshold == null) return '<span>最高阶段</span>';
    return '<span>距下一阶 ' + esc(Math.max(0, Number(pet.next_threshold) - Number(pet.affinity_total))) + ' 亲密</span>';
  }

  function outfit(items) {
    if (!items || !items.length) return '<span class="pet-outfit-empty">还没装备装扮</span>';
    return items.map(function (item) { return '<span class="chip">' + esc(item.name) + '</span>'; }).join('');
  }

  function petStage() {
    var me = state.model.me;
    var pet = me.pet;
    var sleeping = pet.sleeping ? '<span class="pet-sleeping">睡着了</span>' : '';
    return '<section class="pet-stage pet-stage-' + esc(pet.stage_key) + (state.reaction ? ' is-reacting' : '') + '">' +
      '<div class="pet-stage-top"><div><span>' + esc(pet.stage_label) + '</span><strong>' + esc(pet.name) + '</strong></div>' + sleeping + '</div>' +
      '<div class="pet-portrait">' + pandaImage(pet.palette, pet.name, '') + '<i aria-hidden="true"></i><span>' + esc(state.reaction) + '</span></div>' +
      '<div class="pet-rings" aria-label="熊猫状态">' + ring('饱腹', pet.fullness, 'full') + ring('心情', pet.mood, 'mood') + ring('亲密', pet.affinity, 'bond') + '</div>' +
      '<div class="pet-growth"><div><b>成长</b>' + stageProgress(pet) + '</div><span>已解锁 · ' + esc(pet.unlock) + '</span></div>' +
      '<div class="pet-outfit" aria-label="当前装扮">' + outfit(me.outfit) + '</div></section>';
  }

  function actions() {
    var pet = state.model.me.pet;
    return '<section class="pet-actions" aria-label="照料熊猫"><button class="button primary" data-pet-action="feed"' +
      (state.busy ? ' disabled' : '') + '>喂竹子 · 5</button><button class="button tonal" data-pet-action="pat"' +
      (state.busy ? ' disabled' : '') + '>摸摸头</button><button class="button" data-pet-action="play"' +
      (state.busy ? ' disabled' : '') + '>陪它玩</button><span>竹子 <b data-eco-shared-balance>' + esc(bambooBalance()) + '</b>' +
      (pet.sleeping ? ' · 照料后会醒来' : '') + '</span></section>';
  }

  function dateText(value) {
    var text = String(value || '');
    return text.length >= 16 ? text.slice(5, 10).replace('-', '.') + ' ' + text.slice(11, 16) : text;
  }

  function diary() {
    var rows = state.model.diary || [];
    return '<section class="pet-diary"><div class="pet-section-title"><h2>熊猫日记</h2><span>' + esc(rows.length) + ' 条</span></div>' +
      (rows.length ? '<ol>' + rows.map(function (row) {
        return '<li><time>' + esc(dateText(row.created_at)) + '</time><p>' + esc(row.entry) + '</p></li>';
      }).join('') + '</ol>' : '<div class="pet-empty"><p>第一篇日记会从你们的相处开始。</p><button class="button tonal" data-pet-action="pat">摸摸头</button></div>') + '</section>';
  }

  function friendRow(friend) {
    var status = friend.sleeping ? '睡着了' : friend.hungry ? '肚子饿了' : '状态不错';
    return '<article class="pet-friend"><a href="' + safeUrl(petHref(friend.owner.handle)) + '">' +
      pandaImage(friend.palette, friend.name, '') + '<div><strong>' + esc(friend.name) + '</strong><span>' +
      esc(friend.owner.display_name) + ' · ' + esc(status) + '</span></div></a><button class="button ghost small" data-pet-action="visit" data-handle="' +
      esc(friend.owner.handle) + '"' + (state.busy ? ' disabled' : '') + '>去串门</button></article>';
  }

  function friendRail() {
    var rows = state.model.friends || [];
    return '<aside class="pet-friend-rail"><div class="pet-section-title"><h2>好友熊猫</h2><span>互相关注</span></div>' +
      (rows.length ? '<div class="pet-friend-list">' + rows.map(friendRow).join('') + '</div>' :
        '<div class="pet-empty"><p>互相关注后，就能来这里串门。</p><a class="button tonal" href="#/friends">找好友</a></div>') + '</aside>';
  }

  function friendHome() {
    var handle = targetHandle();
    var source = state.visiting || (state.model.friends || []).find(function (item) { return item.owner.handle === handle; });
    if (!source) return '<section class="pet-missing"><h2>这只熊猫不可见</h2><a class="button" href="#/pet">回我的小窝</a></section>';
    var pet = source.pet || source;
    return '<div class="pet-layout"><section class="pet-stage pet-friend-home"><div class="pet-stage-top"><div><span>' +
      esc(pet.stage_label) + '</span><strong>' + esc(pet.name) + '</strong></div><a class="button ghost" href="#/pet">回我的小窝</a></div>' +
      '<div class="pet-portrait">' + pandaImage(pet.palette, pet.name, '') + '<i aria-hidden="true"></i><span></span></div>' +
      '<div class="pet-rings" aria-label="好友熊猫状态">' + ring('饱腹', pet.fullness, 'full') + ring('心情', pet.mood, 'mood') +
      ring('亲密', pet.affinity == null ? 0 : pet.affinity, 'bond') + '</div><div class="pet-growth"><div><b>' +
      esc(source.owner.display_name) + '的小窝</b><span>' + (pet.sleeping ? '睡着了' : pet.fullness <= 30 ? '肚子饿了' : '状态不错') +
      '</span></div><button class="button primary" data-pet-action="visit" data-handle="' + esc(source.owner.handle) + '">摸摸头 · 串门</button></div>' +
      '<div class="pet-outfit"><span class="pet-outfit-empty">日记只给主人自己看</span></div></section>' + friendRail() + '</div>';
  }

  function mainView() {
    if (targetHandle()) return friendHome();
    return '<div class="pet-layout"><div class="pet-main">' + petStage() + actions() + diary() + '</div>' + friendRail() + '</div>';
  }

  function page() {
    restore();
    var bambooHTML = state.model.me.pet ? '<div class="pet-bamboo"><span>竹子</span><strong data-eco-shared-balance>' + esc(bambooBalance()) + '</strong></div>' : '';
    var heading = targetHandle()
      ? '<header class="pet-head"><div><div class="pet-title"><h1>熊猫小窝</h1>' + (!live() ? '<span class="chip">示例</span>' : '') + '</div><p>你在社区做的真事，会被它记在心里。</p></div>' + bambooHTML + '</header>'
      : '<div class="pet-head pet-head-tab"><p>养只熊猫，记录你的社区日常。</p><div class="pet-head-actions">' + (!live() ? '<span class="chip">示例</span>' : '') + bambooHTML + '</div></div>';
    if (live() && state.error) {
      if (state.error === 'closed') {
        return '<div class="pet-page" data-pet-root>' + heading +
          '<div class="pet-error" role="status"><span>这个功能还没开放</span><p>管理员还没打开。</p></div></div>';
      }
      return '<div class="pet-page" data-pet-root>' + heading +
        '<div class="pet-error" role="alert"><span>' + esc(state.error) + '</span><button class="button" data-pet-action="retry">重试</button></div></div>';
    }
    if (live() && state.busy === 'load') {
      return '<div class="pet-page" data-pet-root>' + heading +
        '<div class="pet-error" aria-live="polite"><span>正在打开小窝…</span></div></div>';
    }
    return '<div class="pet-page" data-pet-root>' + heading +
      (state.model.me.pet ? mainView() : adoption()) + '</div>';
  }

  function paint() {
    if (!state.root || !state.root.parentNode) return;
    var host = state.root.parentNode;
    var rebind = state.bound;
    host.innerHTML = page();
    state.root = host.querySelector('[data-pet-root]');
    if (state.root && rebind) {
      state.root.addEventListener('click', onClick);
      state.root.addEventListener('submit', onSubmit);
    }
  }

  function react(text) {
    state.reaction = text;
    clearTimeout(state.timer);
    paint();
    state.timer = setTimeout(function () { state.reaction = ''; paint(); }, 900);
  }

  function demoAction(name, handle) {
    var pet = state.model.me.pet;
    if (name === 'feed') {
      if (bambooBalance() < 5) return toast('竹子不够了');
      pet.fullness = clamp(pet.fullness + 18); pet.mood = clamp(pet.mood + 2);
      state.model.diary.unshift({ id: String(Date.now()), entry: '今天主人喂了我一份竹子，肚子暖暖的。', created_at: new Date().toISOString() });
      changeBamboo(-5, 'pet.feed');
      persist(); return react('嚼嚼嚼');
    }
    if (name === 'pat' || name === 'play') {
      pet.mood = clamp(pet.mood + (name === 'pat' ? 12 : 18));
      pet.affinity = clamp(pet.affinity + (name === 'pat' ? 2 : 3));
      pet.affinity_total += name === 'pat' ? 2 : 3;
      state.model.diary.unshift({ id: String(Date.now()), entry: name === 'pat' ? '今天主人摸了摸我的头，我心情好多了。' : '今天主人陪我玩了一会儿，我开心地打了个滚。', created_at: new Date().toISOString() });
      persist(); return react(name === 'pat' ? '蹭蹭' : '再来一次');
    }
    if (name === 'visit') {
      var friend = state.model.friends.find(function (item) { return item.owner.handle === handle; });
      if (!friend) return;
      friend.mood = clamp(friend.mood + 8); changeBamboo(1, 'pet.visit');
      state.model.diary.unshift({ id: String(Date.now()), entry: '今天我去好友家串门，还带回了一根竹子。', created_at: new Date().toISOString() });
      persist(); paint(); toast('串门成功，双方各得 1 竹');
    }
  }

  function reloadLive() {
    var handle = targetHandle();
    return Promise.all([
      window.CommonsAPI.get('/pet/me'), window.CommonsAPI.get('/pet/friends'), window.CommonsAPI.get('/pet/diary'),
      handle ? window.CommonsAPI.get('/pet/' + encodeURIComponent(handle)) : Promise.resolve(null)
    ]).then(function (rows) {
      state.model.me = rows[0].data; state.model.friends = rows[1].data; state.model.diary = rows[2].data;
      state.visiting = rows[3] ? rows[3].data : null;
    });
  }

  function liveAction(name, body, reaction) {
    state.busy = name; state.error = ''; paint();
    window.CommonsAPI.post('/pet/' + (name === 'play' ? 'pat' : name), body || {}, apiOptions()).then(function () {
      return reloadLive();
    }).then(function () {
      state.busy = '';
      if (reaction) react(reaction); else paint();
    }).catch(function (error) {
      state.busy = ''; state.error = error && error.message ? error.message : '操作没有完成'; paint();
    });
  }

  function act(name, button) {
    if (name === 'retry') return loadLive();
    if (!live()) return demoAction(name, button.dataset.handle || '');
    if (name === 'feed') return liveAction('feed', {}, '嚼嚼嚼');
    if (name === 'pat') return liveAction('pat', { action: 'pat' }, '蹭蹭');
    if (name === 'play') return liveAction('play', { action: 'play' }, '再来一次');
    if (name === 'visit') return liveAction('visit', { handle: button.dataset.handle });
  }

  function onClick(event) {
    var button = event.target.closest('[data-pet-action]');
    if (button && state.root && state.root.contains(button)) act(button.dataset.petAction, button);
  }

  function onSubmit(event) {
    if (!event.target.matches('[data-pet-adopt-form]')) return;
    event.preventDefault();
    var form = new FormData(event.target);
    var body = { name: String(form.get('name') || '').trim(), palette: String(form.get('palette') || '') };
    if (!body.name || body.name.length > 8) return toast('名字限 1 到 8 个字');
    if (live()) return liveAction('adopt', body);
    state.model.me.pet = {
      name: body.name, palette: paletteKey(body.palette), palette_label: '', fullness: 72, mood: 70,
      affinity: 10, affinity_total: 10, sleeping: false, stage: 0, stage_key: 'cub', stage_label: '幼崽',
      unlock: '摸摸头', next_threshold: 40, adopted_at: new Date().toISOString()
    };
    state.model.diary = [{ id: String(Date.now()), entry: '今天我们第一次见面，我有名字啦。', created_at: new Date().toISOString() }];
    persist(); paint();
  }

  function loadLive() {
    if (!live() || state.busy) return;
    state.busy = 'load'; state.error = '';
    reloadLive().then(function () { state.busy = ''; paint(); }).catch(function (error) {
      state.model = emptyModel();
      state.busy = ''; state.error = (error && (error.status === 501 || error.code === 'capability_unavailable')) ? 'closed' : (error && error.message ? error.message : '熊猫小窝暂时没有回应'); paint();
    });
  }

  function badge(handle) {
    restore();
    var current = state.model.me.owner.handle === handle ? {
      owner: state.model.me.owner, name: state.model.me.pet && state.model.me.pet.name,
      palette: state.model.me.pet && state.model.me.pet.palette,
      sleeping: state.model.me.pet && state.model.me.pet.sleeping,
      hungry: state.model.me.pet && state.model.me.pet.fullness <= 30
    } : (state.model.friends || []).find(function (item) { return item.owner.handle === handle; });
    if (!current || !current.name) return '';
    var status = current.sleeping ? '睡着了' : current.hungry ? '饿了' : '心情不错';
    return '<a class="pet-badge" href="' + safeUrl(petHref(current.owner.handle)) + '" aria-label="' +
      esc(current.name + '，' + status) + '">' + pandaImage(current.palette, '', '') + '<span><b>' + esc(current.name) +
      '</b><small>' + esc(status) + '</small></span></a>';
  }

  function mount() {
    destroy();
    state.root = document.querySelector('[data-pet-root]');
    if (!state.root) return;
    state.root.addEventListener('click', onClick);
    state.root.addEventListener('submit', onSubmit);
    state.bound = true;
    if (window.CommonsEconomy && typeof window.CommonsEconomy.onChange === 'function') {
      state.offBalance = window.CommonsEconomy.onChange(function (value) {
        if (!state.model || !state.model.me) return;
        state.model.me.bamboo = Math.max(0, Number(value) || 0);
        paint();
      });
    }
    loadLive();
  }

  function destroy() {
    clearTimeout(state.timer); state.timer = 0;
    if (state.offBalance) state.offBalance();
    state.offBalance = null;
    if (state.root && state.bound) {
      state.root.removeEventListener('click', onClick);
      state.root.removeEventListener('submit', onSubmit);
    }
    state.root = null; state.bound = false; state.busy = ''; state.reaction = '';
  }

  window.CommonsPet = {
    routes: { pet: page },
    hub: ['pet'],
    nav: [['pet', '熊猫小窝', 'heart', 'games']],
    badge: badge,
    mount: mount,
    destroy: destroy
  };
  if (window.CommonsLinks && typeof window.CommonsLinks.provide === 'function') {
    window.CommonsLinks.provide('pet', function (handle) {
      restore();
      var own = state.model.me.owner && state.model.me.owner.handle === handle;
      var friend = (state.model.friends || []).find(function (item) { return item.owner.handle === handle; });
      var row = own ? state.model.me.pet : friend;
      return row ? { label: '熊猫小窝', href: petHref(handle), count: 1, icon: 'heart' } : null;
    });
  }
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsPet);
}());

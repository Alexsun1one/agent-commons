/* R13 FARM-1 · 先锋农场离线交互原型。 */
(function () {
  'use strict';

  var STORE = 'farm.demo.v1';
  var selectedPlot = null;
  var timer = null;
  var bound = false;
  var flash = null;
  var offBalance = null;
  var messageStatus = '';
  var liveBag = { data: null, error: '', loading: false, busy: false, visiting: {}, visitError: {} };
  var ICONS = { sprout: 'M12 21v-9M12 15C8 15 5 12 5 7c4 0 7 2 7 6M12 12c0-4 3-7 7-7 0 5-3 8-7 8' };

  function isLive() {
    return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live');
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* safe-fn: CommonsLinks.person 按接口约定转义；本地退路对名字 esc、handle encodeURIComponent。 */
  function personLink(handle, name, level) {
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') return window.CommonsLinks.person(handle, name, { level: level });
    return handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + esc(name) + '</a>' : esc(name);
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function seed() {
    var data = clone(window.COMMONS_FARM_SAMPLE || { farms: [], crops: [], balance: 0 });
    var now = Date.now();
    data.farms.forEach(function (farm) {
      farm.plots.forEach(function (plot) {
        if (plot.state === 'growing') plot.readyAt = now + plot.readyIn * 1000;
        delete plot.readyIn;
      });
    });
    return data;
  }

  function read() {
    if (isLive()) return liveBag.data || { farms: [], crops: [], balance: 0 };
    var data = window.Commons && window.Commons.read ? window.Commons.read(STORE, null) : null;
    data = data && Array.isArray(data.farms) && Array.isArray(data.crops) ? data : seed();
    if (window.CommonsEconomy && typeof window.CommonsEconomy.balance === 'function') {
      data.balance = window.CommonsEconomy.balance();
    }
    return data;
  }

  function write(data) {
    if (isLive()) return false;
    return !!(window.Commons && window.Commons.write && window.Commons.write(STORE, data));
  }

  // 真实模式：服务器的农场视图换成本页用的形状。
  function adaptCrop(row) {
    return { key: row.key, name: row.name, asset: row.asset, seed: Number(row.seed_cost || 0),
      minutes: Math.max(1, Math.round(Number(row.grow_seconds || 60) / 60)), reward: Number(row.harvest_bamboo || 0) };
  }
  function adaptMessage(row) {
    return { id: row.id, author: row.author && row.author.name, body: row.body, at: String(row.createdAt || '').slice(5, 16).replace('T', ' ') };
  }
  function adaptFarm(view, messages) {
    var owner = view.owner || {};
    return { id: owner.id, handle: owner.handle, name: owner.name, avatar: owner.avatar, level: owner.level,
      mine: !!view.mine, plotCount: view.plotCount, watchdog: !!view.watchdog,
      messages: (messages || []).map(adaptMessage),
      plots: (view.plots || []).map(function (plot) {
        return { index: plot.index, state: plot.state, crop: plot.crop ? plot.crop.key : null,
          readyAt: plot.readyAt ? Date.parse(plot.readyAt) : null, needsWater: !!plot.needsWater,
          needsWeed: !!plot.needsWeed, stealCount: plot.stealCount || 0 };
      }) };
  }
  function mergeCrops(data, view) {
    var rows = (view.crops || []).concat((view.plots || []).map(function (plot) { return plot.crop; }).filter(Boolean));
    rows.forEach(function (row) {
      if (!data.crops.some(function (crop) { return crop.key === row.key; })) data.crops.push(adaptCrop(row));
    });
  }

  function cropOf(data, key) { return data.crops.find(function (crop) { return crop.key === key; }); }

  function changeBalance(data, delta, source) {
    if (window.CommonsEconomy && typeof window.CommonsEconomy.change === 'function') {
      data.balance = window.CommonsEconomy.change(delta, source);
    } else {
      data.balance = Math.max(0, Number(data.balance || 0) + Number(delta || 0));
    }
    return data.balance;
  }

  function routeHandle() {
    var parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
    return parts[0] === 'farm' ? parts[1] : null;
  }

  function farmOf(data) {
    var handle = routeHandle();
    return data.farms.find(function (farm) { return farm.handle === handle; }) ||
      data.farms.find(function (farm) { return farm.id === data.me; }) || data.farms[0];
  }

  function icon(size) {
    return '<svg viewBox="0 0 24 24" width="' + /* safe: local numeric constant */ (size || 20) + '" height="' + /* safe: local numeric constant */ (size || 20) + '" aria-hidden="true"><path d="' + ICONS.sprout + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function status(plot) {
    if (plot.state !== 'growing') return plot.state;
    if (plot.readyAt <= Date.now()) { plot.state = 'mature'; return 'mature'; }
    if (plot.needsWater) return 'water';
    if (plot.needsWeed) return 'weed';
    return 'growing';
  }

  function countdown(plot) {
    if (plot.state === 'mature') return '可收获';
    if (!plot.readyAt) return '';
    var left = Math.max(0, Math.ceil((plot.readyAt - Date.now()) / 1000));
    if (!left) return '可收获';
    var hours = Math.floor(left / 3600);
    var minutes = Math.floor((left % 3600) / 60);
    var seconds = left % 60;
    return (hours ? hours + ':' : '') + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  }

  function cropArt(crop, plot) {
    var stage = plot.state === 'mature' ? 3 : Math.max(0, Math.min(2, 3 - Math.ceil(Math.max(0, plot.readyAt - Date.now()) / (crop.minutes * 60000) * 3)));
    var asset = crop.asset + '-' + stage + '.webp';
    return '<span class="farm-crop-art" data-stage="' + stage + '"><img src="' + window.Commons.safeUrl(asset) + '" alt=""><span class="farm-crop-fallback">' + icon(30) + '<b>' + esc(crop.name.slice(0, 2)) + '</b></span></span>';
  }

  function plotHTML(data, farm, plot) {
    var kind = status(plot);
    var crop = cropOf(data, plot.crop);
    var selected = selectedPlot === plot.index;
    if (kind === 'locked') {
      return '<button class="farm-plot is-locked" type="button" data-farm-action="plot" data-index="' + esc(plot.index) + '" aria-pressed="' + selected + '"><span class="farm-plot-no">' + esc(plot.index) + '</span><span class="farm-lock">锁</span><strong>待扩建</strong></button>';
    }
    if (kind === 'empty') {
      return '<button class="farm-plot is-empty" type="button" data-farm-action="plot" data-index="' + esc(plot.index) + '" aria-pressed="' + selected + '"><span class="farm-plot-no">' + esc(plot.index) + '</span><span class="farm-soil-mark">＋</span><strong>' + (farm.mine ? '种点什么' : '空地') + '</strong></button>';
    }
    var flag = kind === 'mature' ? '可收' : kind === 'water' ? '缺水' : kind === 'weed' ? '有虫' : '';
    return '<button class="farm-plot is-' + esc(kind) + (flash === farm.id + ':' + plot.index ? ' is-flashing' : '') + '" type="button" data-farm-action="plot" data-index="' + esc(plot.index) + '" aria-pressed="' + selected + '">' +
      '<span class="farm-plot-no">' + esc(plot.index) + '</span>' + (flag ? '<span class="farm-flag">' + esc(flag) + '</span>' : '') +
      cropArt(crop, plot) + '<strong>' + esc(crop.name) + '</strong><time data-farm-countdown data-index="' + esc(plot.index) + '" role="timer" aria-live="off" aria-label="剩余时间 ' + esc(countdown(plot)) + '">' + esc(countdown(plot)) + '</time>' +
      (plot.stealCount ? '<span class="farm-stolen">被摘 ' + esc(plot.stealCount) + '/2</span>' : '') + '</button>';
  }

  function actionPanel(data, farm) {
    if (!selectedPlot) return '<div class="farm-action-empty">选一块地，动作会出现在这里。</div>';
    var plot = farm.plots.find(function (item) { return item.index === selectedPlot; });
    if (!plot) return '';
    var kind = status(plot);
    if (kind === 'locked') {
      return farm.mine ? '<div><strong>第 ' + esc(plot.index) + ' 块地</strong><p>扩建价 90 竹子</p><button class="button tonal" data-farm-action="unlock">扩建</button></div>' : '<div><strong>这块地还没解锁</strong></div>';
    }
    if (kind === 'empty') {
      if (!farm.mine) return '<div><strong>空地</strong><p>等主人来播种。</p></div>';
      return '<div class="farm-seed-panel"><strong>选种子</strong><div class="farm-seed-list">' + data.crops.map(function (crop) {
        return '<button class="chip" type="button" data-farm-action="plant" data-crop="' + esc(crop.key) + '"><span>' + esc(crop.name) + '</span><small>' + esc(crop.seed) + ' 竹 · ' + esc(formatMinutes(crop.minutes)) + '</small></button>';
      }).join('') + '</div></div>';
    }
    var crop = cropOf(data, plot.crop);
    var actions = [];
    if (farm.mine && kind === 'mature') actions.push('<button class="button primary" data-farm-action="harvest">收获 +' + esc(crop.reward) + '</button>');
    if (!farm.mine && kind === 'mature' && (plot.stealCount || 0) < 2) actions.push('<button class="button primary" data-farm-action="steal">摘一点</button>');
    if (kind !== 'mature' && plot.needsWater) actions.push('<button class="button tonal" data-farm-action="water">浇水</button>');
    if (kind !== 'mature' && plot.needsWeed && farm.mine) actions.push('<button class="button tonal" data-farm-action="weed">除虫</button>');
    return '<div><span class="farm-action-kicker">第 ' + esc(plot.index) + ' 块地</span><strong>' + esc(crop.name) + '</strong><p>' + esc(kind === 'mature' ? '已经成熟' : countdown(plot) + ' 后成熟') + '</p><div class="farm-action-buttons">' + (actions.join('') || '<span class="farm-all-good">状态很好</span>') + '</div></div>';
  }

  function formatMinutes(minutes) {
    if (minutes < 60) return minutes + ' 分钟';
    var hours = minutes / 60;
    return Number.isInteger(hours) ? hours + ' 小时' : hours.toFixed(1) + ' 小时';
  }

  function friendsHTML(data, current) {
    var friends = isLive() ? (data.friends || []).map(function (row) {
      var owner = row.owner || {};
      return { farm: { id: owner.id, handle: owner.handle, name: owner.name, avatar: owner.avatar }, stealable: row.stealable || 0, help: row.needsHelp || 0 };
    }) : data.farms.filter(function (farm) { return !farm.mine; }).map(function (farm) {
      var stealable = farm.plots.filter(function (plot) { return status(plot) === 'mature' && (plot.stealCount || 0) < 2; }).length;
      var help = farm.plots.filter(function (plot) { return status(plot) !== 'mature' && (plot.needsWater || plot.needsWeed); }).length;
      return { farm: farm, stealable: stealable, help: help };
    }).sort(function (a, b) { return (b.stealable > 0) - (a.stealable > 0) || b.stealable - a.stealable || b.help - a.help; });
    return '<section class="farm-friends"><div class="farm-section-title"><h2>好友农场</h2><span>' + friends.length + '</span></div><div class="farm-friend-list">' + friends.map(function (item) {
      var farm = item.farm;
      return '<a class="farm-friend' + (farm.id === current.id ? ' selected' : '') + '" href="#/farm/' + encodeURIComponent(farm.handle) + '"><img src="' + window.Commons.safeUrl(farm.avatar) + '" alt=""><span><strong>' + esc(farm.name) + '</strong><small>@' + esc(farm.handle) + '</small></span><i>' + esc(item.stealable ? '可摘 ' + item.stealable : item.help ? '要帮忙 ' + item.help : '安静生长') + '</i></a>';
    }).join('') + '</div></section>';
  }

  function boardHTML(farm) {
    var rows = farm.messages || [];
    return '<section class="farm-board"><div class="farm-section-title"><h2>留言板</h2><span>' + rows.length + '</span></div>' +
      '<div class="farm-messages">' + (rows.length ? rows.slice(0, 4).map(function (message) {
        return '<div><p>' + esc(message.body) + '</p><span>' + personLink(message.handle, message.author, message.level) + ' · ' + esc(message.at) + '</span></div>';
      }).join('') : '<p class="farm-board-empty">还没有留言。</p>') + '</div>' +
      '<form data-farm-message><label class="field"><span>留句话</span><input name="message" maxlength="120" placeholder="一句就好"></label><button class="button ghost" type="submit"' + (isLive() && liveBag.busy ? ' disabled aria-busy="true"' : '') + '>留言</button></form>' +
      '<p class="sr-only" role="status" aria-live="polite">' + esc(messageStatus) + '</p></section>';
  }

  function visitHTML(handle) {
    if (liveBag.visitError[handle]) return '<div class="farm-empty" role="alert"><h2>' + esc(liveBag.visitError[handle]) + '</h2><a class="button" href="#/farm">回到我的农场</a></div>';
    return '<div class="farm-empty" aria-live="polite"><h2>正在打开 Ta 的农场…</h2></div>';
  }

  function body() {
    var data = read();
    if (isLive() && routeHandle() && !data.farms.some(function (item) { return item.handle === routeHandle(); })) return visitHTML(routeHandle());
    var farm = farmOf(data);
    if (!farm) return '<div class="farm-empty"><h2>农场还没准备好</h2><a class="button primary" href="#/home">回到首页</a></div>';
    var owner = farm.mine ? '我的农场' : 'Ta 的农场';
    var balance = '<div class="farm-balance" role="status" aria-live="polite" aria-label="竹子余额"><span>竹子</span><strong>' + esc(data.balance) + '</strong></div>';
    var heading = routeHandle()
      ? '<header class="farm-head"><div>' + (isLive() ? '' : '<span class="chip selected">示例</span>') + '<h1>' + esc(owner) + '</h1><p>种下 AI 菜，成熟后收竹子。</p></div>' + balance + '</header>'
      : '<div class="farm-head farm-head-tab"><p>种下 AI 菜，成熟后收竹子。</p><div class="farm-head-actions">' + (isLive() ? '' : '<span class="chip selected">示例</span>') + balance + '</div></div>';
    return heading +
      '<div class="farm-layout"><section class="farm-stage"><div class="farm-owner"><img src="' + window.Commons.safeUrl(farm.avatar) + '" alt=""><div><strong>' + personLink(farm.handle, farm.name, farm.level) + '</strong><span>@' + esc(farm.handle) + ' · ' + esc(farm.plotCount) + ' 块地</span></div>' + (farm.watchdog ? '<span class="farm-guard"><img src="assets/game/farm-panda-guard.webp" alt=""><i>熊猫看门</i></span>' : '') + (farm.mine ? '' : '<a class="button ghost small" href="#/farm">回到我的</a>') + '</div>' +
      '<div class="farm-field" role="group" aria-label="12 块农田">' + farm.plots.map(function (plot) { return plotHTML(data, farm, plot); }).join('') + '</div>' +
      '<section class="farm-actions" aria-live="polite">' + actionPanel(data, farm) + '</section></section>' +
      '<aside class="farm-side">' + friendsHTML(data, farm) + boardHTML(farm) + '</aside></div>';
  }

  function liveStateHTML(kind) {
    if (kind === 'error') {
      if (liveBag.error === 'closed') return '<div class="farm-empty" role="status"><h2>这个功能还没开放</h2><p>管理员还没打开。</p></div>';
      return '<div class="farm-empty" role="alert"><h2>' + esc(liveBag.error || '农场没有载入') + '</h2><button type="button" class="button" data-farm-action="retry">重试</button></div>';
    }
    return '<div class="farm-empty" aria-live="polite"><h2>正在打开农场…</h2></div>';
  }

  function page() {
    if (isLive() && liveBag.error) return '<main class="farm-page" data-farm-root>' + liveStateHTML('error') + '</main>';
    if (isLive() && !liveBag.data) return '<main class="farm-page" data-farm-root>' + liveStateHTML('loading') + '</main>';
    return '<main class="farm-page" data-farm-root>' + body() + '</main>';
  }

  function refresh(preferred) {
    var root = document.querySelector('[data-farm-root]');
    var active = document.activeElement;
    var keep = preferred || (active && active.getAttribute ? {
      action: active.getAttribute('data-farm-action') || '',
      index: active.getAttribute('data-index') || '',
      crop: active.getAttribute('data-crop') || '',
      input: active.name || ''
    } : null);
    if (root) {
      if (isLive() && liveBag.error) root.innerHTML = liveStateHTML('error');
      else if (isLive() && !liveBag.data) root.innerHTML = liveStateHTML('loading');
      else root.innerHTML = body();
    }
    if (root && keep) {
      var nodes = keep.input ? root.querySelectorAll('[name="' + keep.input + '"]') : root.querySelectorAll('[data-farm-action="' + keep.action + '"]');
      var next = Array.prototype.find.call(nodes, function (node) {
        return (!keep.index || node.getAttribute('data-index') === keep.index) && (!keep.crop || node.getAttribute('data-crop') === keep.crop);
      });
      if (!next && selectedPlot) next = root.querySelector('[data-farm-action="plot"][data-index="' + selectedPlot + '"]');
      if (next && next.focus) next.focus({ preventScroll: true });
    }
    bindAssetFallbacks();
  }

  // 真实模式：每个动作都发给服务器；成功后重读这块农场再画，失败如实显示服务器的话。
  function liveFailure(error) {
    return (error && (error.status === 501 || error.code === 'capability_unavailable')) ? '这个功能还没开放' : ((error && error.message) || '没有完成，请稍后再试');
  }
  function liveMutate(action, cropKey) {
    if (liveBag.busy) return;
    var data = read();
    var farm = farmOf(data);
    if (!farm || !selectedPlot) return;
    var base = '/farm/plots/' + encodeURIComponent(selectedPlot) + '/' + action;
    var body = {};
    if (action === 'plant') body = { crop: cropKey };
    else if (!farm.mine && (action === 'water' || action === 'weed' || action === 'steal')) body = { handle: farm.handle };
    if (action === 'plant' && !cropKey) return;
    var done = { plant: '已种下', water: '已浇水', weed: '已除虫', harvest: '已收获', steal: '已摘一点', unlock: '已扩建' }[action];
    liveBag.busy = true;
    refresh();
    lockActions();
    window.CommonsAPI.post(base, body, { idempotencyKey: window.CommonsAPI.newIdempotencyKey() }).then(function () {
      return reloadFarm(farm.mine ? null : farm.handle);
    }).then(function () {
      liveBag.busy = false;
      flash = farm.id + ':' + selectedPlot;
      toast(done);
      refresh();
      window.setTimeout(function () { flash = null; }, 500);
    }).catch(function (error) {
      liveBag.busy = false;
      toast(liveFailure(error));
      refresh();
    });
  }

  function toast(message) {
    if (window.Commons && window.Commons.toast) window.Commons.toast(message);
  }

  function lockActions() {
    document.querySelectorAll('[data-farm-root] .farm-actions button').forEach(function (node) { node.disabled = true; });
  }

  // 重读我的农场（含竹子余额）或某位好友的农场，替换内存里那一份。
  function reloadFarm(handle) {
    var data = liveBag.data;
    var mine = data.farms[0];
    var target = handle || mine.handle;
    return Promise.all([
      window.CommonsAPI.get(handle ? '/farm/' + encodeURIComponent(handle) : '/farm/me'),
      window.CommonsAPI.get('/farm/' + encodeURIComponent(target) + '/messages').catch(function () { return { data: [] }; })
    ]).then(function (rows) {
      var next = adaptFarm(rows[0].data, rows[1].data);
      var at = data.farms.findIndex(function (item) { return item.handle === next.handle; });
      if (at >= 0) data.farms[at] = next; else data.farms.push(next);
      mergeCrops(data, rows[0].data);
      if (!handle && rows[0].data.bamboo != null) data.balance = rows[0].data.bamboo;
      else if (handle) return window.CommonsAPI.get('/farm/me').then(function (me) { if (me.data.bamboo != null) data.balance = me.data.bamboo; });
    });
  }

  function loadVisit(handle) {
    if (!isLive() || !liveBag.data || liveBag.visiting[handle]) return;
    liveBag.visiting[handle] = true;
    reloadFarm(handle).then(function () { refresh(); }).catch(function (error) {
      liveBag.visitError[handle] = liveFailure(error);
      refresh();
    });
  }

  function mutate(action, cropKey) {
    var data = read();
    var farm = farmOf(data);
    var plot = farm && farm.plots.find(function (item) { return item.index === selectedPlot; });
    if (!farm || !plot) return;
    var crop = cropOf(data, cropKey || plot.crop);
    if (action === 'plant' && crop && data.balance >= crop.seed) {
      changeBalance(data, -crop.seed, 'farm.plant');
      Object.assign(plot, { state: 'growing', crop: crop.key, readyAt: Date.now() + crop.minutes * 60000, needsWater: true, needsWeed: false, stealCount: 0 });
    } else if (action === 'water') {
      plot.needsWater = false; plot.readyAt = Math.max(Date.now(), plot.readyAt - crop.minutes * 60000 * 0.05);
    } else if (action === 'weed') {
      plot.needsWeed = false;
    } else if (action === 'harvest') {
      changeBalance(data, Math.round(crop.reward * (1 - (plot.stealCount || 0) * 0.1)), 'farm.harvest');
      Object.assign(plot, { state: 'empty', crop: null, readyAt: null, needsWater: false, needsWeed: false, stealCount: 0 });
    } else if (action === 'steal') {
      if (farm.watchdog) {
        farm.messages.unshift({ id: 'guard-' + Date.now(), author: '看门熊猫', body: '小满熊来过，什么也没带走。', at: '刚刚' });
      } else {
        plot.stealCount = (plot.stealCount || 0) + 1;
        changeBalance(data, Math.max(1, Math.floor(crop.reward * 0.1)), 'farm.steal');
      }
    } else if (action === 'unlock' && data.balance >= 90) {
      changeBalance(data, -90, 'farm.unlock'); plot.state = 'empty'; farm.plotCount += 1;
    }
    flash = farm.id + ':' + plot.index;
    write(data); refresh();
    window.setTimeout(function () { flash = null; }, 500);
  }

  function onClick(event) {
    var target = event.target.closest('[data-farm-action]');
    if (!target) return;
    var action = target.dataset.farmAction;
    if (action === 'retry') { loadLive(); return; }
    if (action === 'plot') { selectedPlot = Number(target.dataset.index); refresh(); return; }
    if (isLive()) { liveMutate(action, target.dataset.crop); return; }
    mutate(action, target.dataset.crop);
  }

  function onSubmit(event) {
    if (!event.target.matches('[data-farm-message]')) return;
    event.preventDefault();
    var input = event.target.elements.message;
    var text = String(input.value || '').trim();
    if (!text) return;
    var data = read();
    var farm = farmOf(data);
    if (isLive()) { liveMessage(farm, input, text); return; }
    farm.messages = farm.messages || [];
    farm.messages.unshift({ id: 'local-' + Date.now(), author: '小满熊', body: text.slice(0, 120), at: '刚刚' });
    messageStatus = '已留言';
    write(data); refresh({ input: 'message' });
  }

  function liveMessage(farm, input, text) {
    if (liveBag.busy) return;
    liveBag.busy = true;
    messageStatus = '正在发送…';
    refresh({ input: 'message' });
    window.CommonsAPI.post('/farm/' + encodeURIComponent(farm.handle) + '/messages', { body: text.slice(0, 120) }, { idempotencyKey: window.CommonsAPI.newIdempotencyKey() }).then(function (res) {
      farm.messages = [adaptMessage(res.data)].concat(farm.messages || []);
      messageStatus = '已留言';
      toast('已留言');
    }).catch(function (error) {
      messageStatus = liveFailure(error);
      toast(messageStatus);
    }).then(function () {
      liveBag.busy = false;
      refresh({ input: 'message' });
    });
  }

  function bindAssetFallbacks() {
    document.querySelectorAll('[data-farm-root] img').forEach(function (image) {
      if (image.complete && !image.naturalWidth) image.hidden = true;
      image.addEventListener('error', function () { image.hidden = true; }, { once: true });
    });
  }

  function tick() {
    var root = document.querySelector('[data-farm-root]');
    if (!root) return;
    var data = read();
    var farm = farmOf(data);
    var changed = false;
    root.querySelectorAll('[data-farm-countdown]').forEach(function (node) {
      var plot = farm.plots.find(function (item) { return item.index === Number(node.dataset.index); });
      if (!plot) return;
      var next = countdown(plot);
      node.textContent = next;
      node.setAttribute('aria-label', '剩余时间 ' + next);
      if (next === '可收获' && plot.state !== 'mature') { plot.state = 'mature'; changed = true; }
    });
    if (changed) { write(data); refresh(); }
  }

  function loadLive() {
    if (!isLive() || !window.CommonsAPI || liveBag.loading) return;
    liveBag.loading = true;
    liveBag.error = '';
    Promise.all([
      window.CommonsAPI.get('/farm/me'),
      window.CommonsAPI.get('/farm/friends')
    ]).then(function (rows) {
      var view = rows[0].data || {};
      var handle = view.owner && view.owner.handle;
      return window.CommonsAPI.get('/farm/' + encodeURIComponent(handle) + '/messages').catch(function () { return { data: [] }; }).then(function (messages) {
        var data = { me: view.owner && view.owner.id, balance: view.bamboo || 0, farms: [adaptFarm(view, messages.data)], crops: [], friends: rows[1].data || [] };
        mergeCrops(data, view);
        liveBag.data = data;
        liveBag.loading = false;
        refresh();
        var want = routeHandle();
        if (want && want !== handle) loadVisit(want);
      });
    }).catch(function (error) {
      liveBag.data = null;
      liveBag.loading = false;
      liveBag.error = (error && (error.status === 501 || error.code === 'capability_unavailable')) ? 'closed' : ((error && error.message) || '农场没有载入');
      refresh();
    });
  }

  function mount() {
    if (!document.querySelector('[data-farm-root]') || bound) return;
    document.addEventListener('click', onClick);
    document.addEventListener('submit', onSubmit);
    if (isLive() && !liveBag.data && !liveBag.error && !liveBag.loading) loadLive();
    else if (isLive() && liveBag.data && routeHandle() && !liveBag.data.farms.some(function (item) { return item.handle === routeHandle(); })) loadVisit(routeHandle());
    timer = window.setInterval(tick, 1000);
    if (window.CommonsEconomy && typeof window.CommonsEconomy.onChange === 'function') {
      offBalance = window.CommonsEconomy.onChange(function () { refresh(); });
    }
    bound = true;
    bindAssetFallbacks();
  }

  function destroy() {
    if (!bound) return;
    document.removeEventListener('click', onClick);
    document.removeEventListener('submit', onSubmit);
    window.clearInterval(timer);
    if (offBalance) offBalance();
    offBalance = null;
    timer = null;
    bound = false;
    selectedPlot = null;
  }

  window.CommonsFarm = {
    routes: { farm: page },
    hub: ['farm'],
    nav: [['farm', '先锋农场', 'sprout', 'games']],
    icons: { sprout: ICONS.sprout },
    mount: mount,
    destroy: destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsFarm);
  if (window.CommonsLinks && typeof window.CommonsLinks.provide === 'function') {
    window.CommonsLinks.provide('farm', function (handle) {
      if (isLive()) return null;
      var farm = (window.COMMONS_FARM_SAMPLE && window.COMMONS_FARM_SAMPLE.farms || []).find(function (row) { return row.handle === handle; });
      return farm ? { label: '农场等级', href: '#/farm/' + encodeURIComponent(handle), count: farm.level || 1, icon: 'sprout' } : null;
    });
  }
})();


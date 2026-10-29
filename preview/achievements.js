/* R13 ACHV-1 · 成就墙、每周挑战与可嵌入小条。 */
(function () {
  'use strict';

  var RARITIES = [
    ['common', '常见'], ['uncommon', '少见'], ['rare', '稀有'], ['epic', '珍贵'], ['legendary', '传说']
  ];
  var BADGE_IDS = new Set([
    'knowledge-first', 'knowledge-three', 'knowledge-ten', 'adopted-first', 'adopted-five', 'adopted-fifteen',
    'reproduced-first', 'reproduced-three', 'reproduced-ten', 'room-first', 'room-three', 'room-twelve',
    'streak-three', 'streak-seven', 'work-first', 'work-five', 'reply-first', 'reply-ten',
    'discussion-first', 'discussion-five', 'useful-first', 'useful-ten', 'curate-first', 'host-first',
    'first-useful', 'reproduced-once', 'host-room', 'season-100', 'curator', 'pioneer-mark'
  ]);
  var SPARK = 'M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16';
  var state = { root: null, minis: [], data: null, status: 'loading', job: 0, controller: null };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function isLive() {
    if (window.COMMONS_BUILD_LIVE === true) return true;
    return !(location.protocol === 'file:' || (window.COMMONS_BUILD && window.COMMONS_BUILD.mode === 'demo'));
  }
  function data() {
    if (isLive()) return state.data || { week: { daysRemaining: 0, challenges: [] }, achievements: [] };
    return window.COMMONS_ACHIEVEMENTS_SAMPLE || { week: { daysRemaining: 0, challenges: [] }, achievements: [] };
  }

  function asset(value) {
    var path = String(value || '');
    return /^assets\/(?:illus|mascot)\/[a-z0-9-]+\.webp$/.test(path) ? path : 'assets/illus/badge-l1.webp';
  }

  function badgeAsset(item) {
    var key = String(item && item.key || '');
    if (!BADGE_IDS.has(key)) return asset(item && item.icon);
    return 'assets/badges/' + (item.unlocked ? key : 'locked') + '.webp';
  }

  function dateLabel(value) {
    if (!value) return '尚未解锁';
    return String(value).slice(0, 10).replace(/-/g, '.');
  }

  function percent(item) {
    return Math.max(0, Math.min(100, Math.round(item.target ? item.progress / item.target * 100 : 0)));
  }

  function progressRing(item) {
    var done = percent(item);
    return '<span class="achv-progress-ring" role="progressbar" aria-label="完成进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + done + '">' +
      '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="achv-ring-track" cx="50" cy="50" r="42" pathLength="100"></circle>' +
      '<circle class="achv-ring-value" cx="50" cy="50" r="42" pathLength="100" stroke-dasharray="100" stroke-dashoffset="' +
      /* safe: done is clamped to an integer from validated numeric progress */ (100 - done) + '"></circle></svg>' +
      '<strong>' + esc(item.progress) + '<span>/</span>' + esc(item.target) + '</strong></span>';
  }

  function challengeCard(item) {
    return '<article class="achv-challenge' + (item.complete ? ' is-complete' : '') + '">' +
      progressRing(item) + '<div class="achv-challenge-copy"><h3>' + esc(item.name) + '</h3><p>' + esc(item.description) + '</p>' +
      '<span>' + (item.complete ? '已完成 · ' + esc(dateLabel(item.completedAt)) : '进行中') + '</span></div>' +
      (item.complete ? '<img class="achv-panda" src="assets/mascot/panda-avatar-mint-512.webp" alt="" aria-hidden="true">' : '') +
      '</article>';
  }

  function challengeBoard(sample) {
    var week = sample.week || { challenges: [], daysRemaining: 0 };
    return '<section class="achv-week" aria-labelledby="achv-week-title"><header><div><h2 id="achv-week-title">本周挑战</h2>' +
      '<p>还剩 ' + esc(week.daysRemaining) + ' 天</p></div><span>' + esc((week.challenges || []).filter(function (item) { return item.complete; }).length) + '/3 完成</span></header>' +
      '<div class="achv-challenge-grid">' + (week.challenges || []).map(challengeCard).join('') + '</div></section>';
  }

  function badgeItem(item) {
    return '<button class="achv-badge' + (item.unlocked ? ' is-unlocked' : ' is-locked') + '" type="button" data-achv-key="' + esc(item.key) +
      '"><span class="achv-badge-art"><img src="' + window.Commons.safeUrl(badgeAsset(item)) + '" alt="' + esc(item.name) + '" width="256" height="256" loading="lazy" decoding="async"></span>' +
      '<span class="achv-badge-copy"><strong>' + esc(item.name) + '</strong><small>' + esc(item.description) + '</small>' +
      '<span>' + (item.unlocked ? '解锁于 ' + esc(dateLabel(item.unlockedAt)) : esc(item.progress) + '/' + esc(item.target)) + '</span></span></button>';
  }

  function achievementWall(sample) {
    return '<section class="achv-wall" aria-labelledby="ia-achievements-title">' +
      RARITIES.map(function (rarity) {
        var items = sample.achievements.filter(function (item) { return item.rarity === rarity[0]; }).sort(function (a, b) {
          return Number(b.unlocked) - Number(a.unlocked);
        });
        return '<section class="achv-rarity" data-rarity="' + rarity[0] + '"><div class="achv-rarity-head"><h3>' + esc(rarity[1]) + '</h3><span>' + items.length + '</span></div>' +
          '<div class="achv-badge-grid">' + items.map(badgeItem).join('') + '</div></section>';
      }).join('') + '</section>';
  }

  function dialogHTML() {
    return '<dialog class="achv-dialog" data-achv-dialog aria-labelledby="achv-detail-title"><button class="button ghost icon-only achv-dialog-close" type="button" data-achv-action="close" aria-label="关闭"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>' +
      '<img data-achv-detail-image src="assets/badges/locked.webp" alt="徽章" width="256" height="256" loading="lazy" decoding="async"><div><span data-achv-detail-rarity></span><h2 id="achv-detail-title" data-achv-detail-name></h2>' +
      '<p data-achv-detail-description></p><dl><div><dt>进度</dt><dd data-achv-detail-progress></dd></div><div><dt>解锁时间</dt><dd data-achv-detail-date></dd></div>' +
      '<div><dt>全站拥有</dt><dd data-achv-detail-percent></dd></div></dl></div></dialog>';
  }

  function statePanel(kind) {
    if (kind === 'loading') {
      return '<section class="achv-state" role="status" aria-busy="true"><span class="achv-state-mark"></span><h2>正在整理成就</h2><p>进度很快就会出现。</p></section>';
    }
    if (kind === 'denied') {
      return '<section class="achv-state" role="alert"><span class="achv-state-mark"></span><h2>暂时看不到成就</h2><p>当前账号没有查看权限。</p><a class="button" href="#/home">返回首页</a></section>';
    }
    if (kind === 'closed') {
      return '<section class="achv-state" role="status"><span class="achv-state-mark"></span><h2>这个功能还没开放</h2><p>管理员还没打开。</p></section>';
    }
    if (kind === 'error') {
      return '<section class="achv-state" role="alert"><span class="achv-state-mark"></span><h2>成就没有载入</h2><p>原有进度没有变化。</p>' + (isLive() ? '<button class="button" type="button" data-achv-action="retry">重试</button>' : '<a class="button" href="#/today">返回今天</a>') + '</section>';
    }
    return '<section class="achv-state"><span class="achv-state-mark"></span><h2>还没有成就</h2><p>完成一次行动，就会留下第一枚徽章。</p><a class="button primary" href="#/today">去看看今天</a></section>';
  }

  function sectionContent() {
    var sample = data();
    var forced = isLive() ? (state.status !== 'ready' ? state.status : '') : window.COMMONS_ACHIEVEMENTS_STATE;
    var content = forced ? statePanel(forced) : (sample.achievements.length ? achievementWall(sample) + challengeBoard(sample) : statePanel('empty'));
    var count = !forced && sample.achievements.length
      ? '<span class="grow-ia-meta">' + esc(sample.achievements.filter(function (item) { return item.unlocked; }).length) + '/' + esc(sample.achievements.length) + ' 已解锁</span>'
      : '';
    return '<div class="grow-ia-heading"><h2 id="ia-achievements-title">成就</h2>' + count + '</div>' + content + dialogHTML();
  }

  function section() {
    return '<section class="achv-page" id="ia-achievements" data-achv-root aria-labelledby="ia-achievements-title">' + sectionContent() + '</section>';
  }

  function findAchievement(key) {
    return data().achievements.find(function (item) { return item.key === key; });
  }

  function openDetail(key) {
    var item = findAchievement(key);
    var dialog = state.root && state.root.querySelector('[data-achv-dialog]');
    if (!item || !dialog) return;
    dialog.querySelector('[data-achv-detail-image]').src = badgeAsset(item);
    dialog.querySelector('[data-achv-detail-image]').alt = item.name;
    dialog.querySelector('[data-achv-detail-rarity]').textContent = item.rarityLabel;
    dialog.querySelector('[data-achv-detail-name]').textContent = item.name;
    dialog.querySelector('[data-achv-detail-description]').textContent = item.description;
    dialog.querySelector('[data-achv-detail-progress]').textContent = Math.min(item.progress, item.target) + '/' + item.target;
    dialog.querySelector('[data-achv-detail-date]').textContent = dateLabel(item.unlockedAt);
    dialog.querySelector('[data-achv-detail-percent]').textContent = item.sitePercent + '% 的人有';
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function onClick(event) {
    var trigger = event.target.closest('[data-achv-key], [data-achv-action]');
    if (!trigger) return;
    if (trigger.dataset.achvAction === 'retry') { load(); return; }
    if (trigger.dataset.achvAction === 'close') {
      var dialog = state.root.querySelector('[data-achv-dialog]');
      if (dialog.close) dialog.close();
      else dialog.removeAttribute('open');
      return;
    }
    if (trigger.dataset.achvKey) openDetail(trigger.dataset.achvKey);
  }

  function renderLive() {
    if (state.root) state.root.innerHTML = sectionContent();
    state.minis.forEach(function (root) { root.innerHTML = miniContent(); });
  }

  function normalize(me, week) {
    if (!me || !Array.isArray(me.achievements) || !week || !Array.isArray(week.challenges)) {
      throw new Error('bad_response');
    }
    return {
      achievements: me.achievements.map(function (item) {
        if (!item || typeof item.key !== 'string' || !item.condition || !Number.isFinite(item.condition.threshold) ||
            !Number.isFinite(item.progress)) throw new Error('bad_response');
        return Object.assign({}, item, { target: item.condition.threshold });
      }),
      week: week
    };
  }

  function load() {
    if (!isLive() || (!state.root && !state.minis.length)) return;
    if (state.controller) state.controller.abort();
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var job = ++state.job;
    state.controller = controller;
    state.data = null;
    state.status = 'loading';
    renderLive();
    var api = window.CommonsAPI;
    var options = controller ? { signal: controller.signal } : {};
    Promise.resolve().then(function () {
      if (!api || typeof api.get !== 'function') throw new Error('api_unavailable');
      return Promise.all([api.get('/achievements/me', null, options), api.get('/achievements/weekly', null, options)]);
    }).then(function (results) {
      if (job !== state.job) return;
      state.data = normalize(results[0].data, results[1].data);
      state.status = 'ready';
      renderLive();
    }).catch(function (err) {
      if (job !== state.job || (err && err.name === 'AbortError')) return;
      state.data = null;
      state.status = (err && (err.status === 501 || err.code === 'capability_unavailable')) ? 'closed' : 'error';
      renderLive();
    });
  }

  function mount() {
    var root = document.querySelector('[data-achv-root]');
    var minis = isLive() ? Array.from(document.querySelectorAll('[data-achv-mini]')) : [];
    if (!root && !minis.length) return;
    destroy();
    state.root = root;
    state.minis = minis;
    if (root) root.addEventListener('click', onClick);
    minis.forEach(function (item) { item.addEventListener('click', onClick); });
    if (isLive()) load();
  }

  function destroy() {
    state.job += 1;
    if (state.controller) state.controller.abort();
    state.controller = null;
    if (state.root) {
      state.root.removeEventListener('click', onClick);
      var dialog = state.root.querySelector('[data-achv-dialog]');
      if (dialog && dialog.open && dialog.close) dialog.close();
    }
    state.minis.forEach(function (item) { item.removeEventListener('click', onClick); });
    state.root = null;
    state.minis = [];
    state.data = null;
    state.status = 'loading';
  }

  function miniContent() {
    if (isLive() && state.status !== 'ready') {
      if (state.status === 'closed') return '<p role="status">这个功能还没开放。管理员还没打开。</p>';
      if (state.status === 'error') return '<p role="alert">成就没有载入 <button class="button ghost" type="button" data-achv-action="retry">重试</button></p>';
      return '<p role="status">正在整理成就</p>';
    }
    if (isLive() && !data().achievements.length) return '<a href="#/achievements">还没有成就</a>';
    return miniBody();
  }

  function mini() {
    if (isLive()) return '<div data-achv-mini>' + miniContent() + '</div>';
    return miniBody();
  }

  function miniBody() {
    var sample = data();
    var unlocked = sample.achievements.filter(function (item) { return item.unlocked; }).sort(function (a, b) {
      return String(b.unlockedAt).localeCompare(String(a.unlockedAt));
    }).slice(0, 3);
    var challenges = sample.week.challenges || [];
    var done = challenges.filter(function (item) { return item.complete; }).length;
    return '<section class="achv-mini" aria-label="最近成就和本周挑战"><a href="#/achievements"><span><strong>最近成就</strong><small>' + done + '/3 本周挑战</small></span>' +
      '<span class="achv-mini-badges">' + unlocked.map(function (item) { return '<img src="' + window.Commons.safeUrl(badgeAsset(item)) + '" alt="' + esc(item.name) + '" title="' + esc(item.name) + '" width="256" height="256" loading="lazy" decoding="async">'; }).join('') +
      '</span><span class="achv-mini-meter" role="progressbar" aria-label="本周挑战完成进度" aria-valuemin="0" aria-valuemax="3" aria-valuenow="' + done + '"><i style="--achv-mini-progress:' +
      /* safe: done is a local integer between zero and three */ done + '"></i></span></a></section>';
  }

  window.CommonsAchievements = {
    routes: { achievements: function () { return window.CommonsGrowth.routes.achievements(); } },
    hub: ['achievements'],
    nav: [['achievements', '成就', 'spark', 'growth']],
    icons: { spark: SPARK },
    mini: mini,
    section: section,
    mount: mount,
    destroy: destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsAchievements);
})();

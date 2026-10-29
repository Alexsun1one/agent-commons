/* R13 PROFILE-1 · 公开个人主页、作品详情、我的权益示例。 */
(function () {
  'use strict';

  var state = { root: null, unbind: [], htmlHandle: null, thumbRun: 0, previewDevice: 'desktop' };
  var LEVEL_NAMES = { 1: '新队员', 2: '队员', 3: '骨干', 4: '领航员', 5: '先锋' };
  var KIND_NAMES = { html: 'HTML 作品', knowledge: '知识卡', lecture: '讲堂', work: '作品', prompt: '提示词', talk: '讲堂' };
  var OWN_ICON_PATHS = {
    agent: 'M8 8a4 4 0 1 1 8 0v2a4 4 0 0 1-8 0zM5 21v-3a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v3M4 5h2M18 5h2',
    arrow: 'M4 12h16M14 6l6 6-6 6',
    back: 'M20 12H4M10 6l-6 6 6 6',
    book: 'M12 5c-4-3-9-2-9-2v17s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2zM12 5v17',
    code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
    favorite: 'M20 5a5 5 0 0 0-8 1 5 5 0 0 0-8-1c-4 5 8 15 8 15S24 10 20 5',
    lecture: 'M3 4h18v13H3zM7 21l5-4 5 4M9 8l6 3-6 3z',
    milestone: 'M6 22V3m0 2h11l-2 3 2 3H6',
    shield: 'M12 2 3 6v6c0 6 9 10 9 10s9-4 9-10V6zM8 12l3 3 5-6'
  };
  function isLive() {
    return !(location.protocol === 'file:' || (window.COMMONS_BUILD && window.COMMONS_BUILD.mode === 'demo'));
  }
  var livePeople = { data: null, error: '', loading: false, moreLoading: false, key: null, cursor: null, seq: 0, detail: null, busy: '', notice: '', confirm: '' };
  var liveWork = { key: null, item: null, error: '', loading: false, seq: 0, busy: '', notice: '' };
  var liveBenefits = { key: null, me: null, next: null, error: '', loading: false, seq: 0 };
  var handleById = {};
  var DEFAULT_AVATAR = 'assets/mascot/panda-avatar-classic-512.webp';
  function data() {
    if (isLive()) return livePeople.data || { label: '', profiles: [], works: [], benefits: [], viewer: {} };
    return window.COMMONS_PEOPLE_SAMPLE || { label: '示例数据', profiles: [], works: [], benefits: [], viewer: {} };
  }

  function C() { return window.Commons || {}; }
  function esc(value) {
    if (typeof C().esc === 'function') return C().esc(String(value == null ? '' : value));
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function safeUrl(value) {
    if (typeof C().safeUrl === 'function') return C().safeUrl(String(value || ''));
    var raw = String(value || '');
    return /^(?:#\/|\.{0,2}\/|assets\/|https?:\/\/|data:image\/)/i.test(raw) ? esc(raw) : '#';
  }
  function icon(name, size) {
    var shared = '';
    if (window.CommonsIcons && typeof window.CommonsIcons.svg === 'function') {
      shared = window.CommonsIcons.svg(name, { size: size || 16 }) || '';
    }
    if (!shared && typeof C().icon === 'function') shared = C().icon(name) || '';
    var path = OWN_ICON_PATHS[name] || OWN_ICON_PATHS.book;
    var px = Number(size) > 0 ? Math.min(48, Math.round(Number(size))) : 16;
    var own = '<svg class="people-own-icon" viewBox="0 0 24 24" width="' + esc(String(px)) + '" height="' + esc(String(px)) + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + esc(path) + '"></path></svg>';
    return shared || own;
  }
  function pathParts() { return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean); }
  function legacyPersonByHandle(handle) {
    if (isLive()) return null;
    return data().legacyPersonByHandle ? data().legacyPersonByHandle(handle) : null;
  }
  function profileByHandle(handle) {
    var profile = data().profiles.find(function (p) { return p.handle === handle; });
    var person = legacyPersonByHandle(handle);
    if (!profile || !person) return profile;
    var skills = Array.isArray(person.skills) ? person.skills.slice() : [];
    var workIds = Array.isArray(person.works) ? person.works.slice() : [];
    return Object.assign({}, profile, {
      sourcePersonId: person.id,
      role: person.role || '',
      intro: person.bio || profile.intro,
      direction: [],
      tools: skills,
      offer: person.offer || '',
      seek: person.seek || '',
      stats: { works: workIds.length, skills: skills.length },
      workIds: workIds,
      privacy: Object.assign({}, profile.privacy, { works: true, activity: true })
    });
  }
  function legacyWorkHub(handle) {
    var person = legacyPersonByHandle(handle);
    var workIds = person && Array.isArray(person.works) ? person.works : [];
    if (!workIds.length) return null;
    return { label: '作品', href: '#/work/' + encodeURIComponent(workIds[0]), count: workIds.length, icon: 'project' };
  }
  function buddyWorkById(id) { return !isLive() && data().buddyWorkById ? data().buddyWorkById(id) : null; }
  function campaignWorkById(id) { return !isLive() && data().campaignWorkById ? data().campaignWorkById(id) : null; }
  function workById(id) {
    if (isLive()) return liveWork.item && liveWork.item.id === id ? liveWork.item : null;
    return data().works.find(function (work) { return work.id === id; }) || buddyWorkById(id) || campaignWorkById(id);
  }
  function authorOf(work) { return profileByHandle(work && work.author); }
  function sourceOf(work) {
    return {
      href: work && work.sourceHref || '#/people',
      label: work && work.sourceLabel || '作品与同行'
    };
  }
  function visible(profile, key) { return !profile.privacy || profile.privacy[key] !== false; }

  /* safe-fn: CommonsLevel.attrs 只返回受限等级枚举；回退值同样来自本地等级表 */
  function levelAttrs(profile) {
    var value = profile && LEVEL_NAMES[Number(profile.level)] ? Number(profile.level) : 1;
    if (window.CommonsLevel && typeof window.CommonsLevel.attrs === 'function') return window.CommonsLevel.attrs(value);
    var tone = value >= 5 ? 'vanguard' : value >= 4 ? 'lead' : value >= 3 ? 'core' : 'plain';
    return 'data-level="' + value + '" data-level-tone="' + tone + '"';
  }

  /* safe-fn: CommonsLevel.ringClass 与回退均为受限类名 */
  function ringClass(profile) {
    var value = profile && LEVEL_NAMES[Number(profile.level)] ? Number(profile.level) : 1;
    if (window.CommonsLevel && typeof window.CommonsLevel.ringClass === 'function') return window.CommonsLevel.ringClass(value);
    return 'level-ring level-ring--l' + value;
  }

  /* safe-fn: CommonsLevel.nameplate 返回已转义 HTML；回退逐值 esc */
  function nameplate(profile) {
    if (!profile) return '';
    if (window.CommonsLevel && typeof window.CommonsLevel.nameplate === 'function') {
      return window.CommonsLevel.nameplate({ name: profile.name, level: profile.level, handle: profile.handle });
    }
    return '<span class="level-nameplate"><span class="level-nameplate-name">' + esc(profile.name) + '</span>' +
      '<span class="people-level-fallback">L' + esc(String(profile.level)) + ' ' + esc(profile.levelName || LEVEL_NAMES[profile.level] || '') + '</span>' +
      (profile.handle ? '<span class="level-nameplate-handle">@' + esc(profile.handle) + '</span>' : '') + '</span>';
  }

  /* safe-fn: 返回的头像 HTML 中，动态值均已转义且 URL 过白名单 */
  function avatar(profile, size) {
    if (!profile) return '';
    return '<span class="people-avatar ' + esc(ringClass(profile)) + '" data-size="' + esc(size || 'normal') + '" ' + levelAttrs(profile) + '>' +
      '<img src="' + safeUrl(profile.avatar) + '" alt="' + esc(profile.name) + '的熊猫头像">' +
      '<span class="people-level" aria-label="等级 L' + esc(String(profile.level)) + ' ' + esc(profile.levelName) + '">L' + esc(String(profile.level)) + '</span></span>';
  }

  /* safe-fn: 写死图标名，返回公共图标库生成的安全 SVG */
  function workIcon(kind) {
    return icon(kind === 'html' ? 'code' : (kind === 'lecture' || kind === 'talk' ? 'lecture' : 'book'), 16);
  }

  /* safe-fn: 动态文本均逐值转义 */
  function notFound(kind) {
    if (isLive()) return '<div class="people-empty" data-people-root><h1>没有找到这个' + esc(kind) + '</h1><p>可能尚未公开、已经撤回，或你现在看不到。</p><a class="button" href="#/people">返回成员页</a></div>';
    return '<div class="people-empty" data-people-root><img src="assets/illus/empty-not-found.webp" alt=""><h1>没有找到这个' +
      esc(kind) + '</h1><p>链接可能已经变化。示例数据没有被修改。</p><a class="button primary" href="#/u/' + encodeURIComponent(data().defaultHandle || '') + '">打开示例主页</a></div>';
  }

  /* safe-fn: 动态字段均逐值转义 */
  function statStrip(profile) {
    var labels = [
      ['works', '作品'], ['skills', '技能'], ['knowledge', '知识卡'], ['solved', '解决的问题'], ['adopted', '被采纳'], ['season', '本赛季贡献']
    ];
    var rows = labels.filter(function (row) {
      return Number(profile.stats && profile.stats[row[0]]) > 0;
    }).map(function (row) {
      return '<div><dt>' + esc(row[1]) + '</dt><dd>' + esc(String(profile.stats[row[0]])) + '</dd></div>';
    }).join('');
    if (!rows) return '';
    return '<dl class="people-stats' + (profile.sourcePersonId ? ' people-stats--compact' : '') + '">' + rows + '</dl>';
  }

  function heatSummary(values) {
    var weekdays = [0, 0, 0, 0, 0, 0, 0];
    var weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    var longest = 0;
    var streak = 0;
    (values || []).forEach(function (value, index) {
      var count = Math.max(0, Number(value) || 0);
      weekdays[index % 7] += count;
      streak = count > 0 ? streak + 1 : 0;
      longest = Math.max(longest, streak);
    });
    var busiest = weekdays.reduce(function (best, value, index) {
      return value > weekdays[best] ? index : best;
    }, 0);
    return { longest: longest, weekday: weekdayNames[busiest] };
  }

  /* safe-fn: 热力值为受限数字，日期为写死示例口径 */
  function heatmap(profile) {
    var values = profile.heatmap || [];
    var weeks = Math.ceil(values.length / 7);
    var summary = heatSummary(values);
    var cells = values.map(function (value, index) {
      var week = Math.floor(index / 7) + 1;
      var day = index % 7 + 1;
      return '<span data-level="' + esc(String(Math.max(0, Math.min(4, Number(value) || 0)))) + '" title="第 ' +
        esc(String(week)) + ' 周第 ' + esc(String(day)) + ' 天 · ' + esc(String(value || 0)) + ' 次公开贡献"></span>';
    }).join('');
    return '<section class="people-section" aria-labelledby="people-heat-title"><div class="people-section-head"><div><p>贡献记录</p><h2 id="people-heat-title">公开贡献热力图</h2></div><span>近 ' + esc(String(weeks)) + ' 周</span></div>' +
      '<div class="people-heat-wrap"><div class="people-heat" role="img" aria-label="近 ' + esc(String(weeks)) + ' 周公开贡献热力图">' +
      /* safe: cells 的值均在上方逐值转义 */ cells + '</div><div class="people-heat-meta"><p>本赛季最长连续 <b>' + esc(String(summary.longest)) + ' 天</b> · 最活跃的是 <b>' + esc(summary.weekday) + '</b></p><div class="people-heat-key"><span>少</span><i data-level="0"></i><i data-level="1"></i><i data-level="2"></i><i data-level="3"></i><i data-level="4"></i><span>多</span></div></div></div></section>';
  }

  /* safe-fn: 动态字段均逐值转义，图片 URL 过白名单 */
  function workCard(work) {
    var author = authorOf(work);
    var reproduced = Number(work.reproduced) > 0 ? ' · ' + esc(String(work.reproduced)) + ' 人复现' : '';
    var thumb = work.kind === 'html'
      ? '<div class="people-work-thumb" data-people-thumb="' + esc(work.id) + '"><img src="' + safeUrl(work.cover) + '" alt=""><span data-people-thumb-status>正在准备沙箱缩略图…</span></div>'
      : '<div class="people-work-thumb"><img src="' + safeUrl(work.cover) + '" alt=""><span>' + esc(KIND_NAMES[work.kind]) + '</span></div>';
    return '<article class="people-work-card">' + /* safe: thumb 已逐值转义 */ thumb +
      '<div class="people-work-copy"><p>' + workIcon(work.kind) + esc(KIND_NAMES[work.kind]) + '</p>' +
      '<h3><a href="#/work/' + esc(encodeURIComponent(work.id)) + '">' + esc(work.title) + '</a></h3>' +
      '<span>' + esc(work.summary) + '</span><small>' + nameplate(author) + reproduced + '</small></div></article>';
  }

  /* safe-fn: 合作偏好均逐值转义 */
  function collaboration(profile) {
    if (!profile.offer && !profile.seek) return '';
    return '<section class="people-section people-collaboration" aria-labelledby="people-collaboration-title"><div class="people-section-head"><div><p>合作偏好</p><h2 id="people-collaboration-title">一起做什么</h2></div></div><dl>' +
      (profile.offer ? '<div><dt>能提供</dt><dd>' + esc(profile.offer) + '</dd></div>' : '') +
      (profile.seek ? '<div><dt>在找</dt><dd>' + esc(profile.seek) + '</dd></div>' : '') + '</dl></section>';
  }

  /* safe-fn: 动态字段均逐值转义 */
  function badgeWall(profile) {
    var badgeAssets = {
      '第一次被采纳': 'adopted-first', '连续记录': 'streak-seven', '被人复现': 'reproduced-once',
      '赛季百分': 'season-100', '把知识理顺': 'curator', '主持成场': 'host-first',
      '知识领航': 'adopted-fifteen', '复现接力': 'reproduced-three', '先锋任命': 'pioneer-mark',
      '申诉复核': 'curate-first'
    };
    var rows = (profile.badges || []).map(function (badge) {
      var id = badgeAssets[badge.name];
      var image = id ? 'assets/badges/' + id + '.webp' : badge.image;
      return '<article class="people-badge"><img src="' + safeUrl(image) + '" alt="' + esc(badge.name) + '" width="256" height="256" loading="lazy" decoding="async"><div><h3>' + esc(badge.name) + '</h3><p>' +
        esc(badge.note) + '</p></div></article>';
    }).join('');
    return '<section class="people-section" aria-labelledby="people-badge-title"><div class="people-section-head"><div><p>认可记录</p><h2 id="people-badge-title">徽章墙</h2></div></div><div class="people-badges">' +
      /* safe: rows 的值均在上方逐值转义 */ rows + '</div></section>';
  }

  /* safe-fn: 动态字段均逐值转义 */
  function agents(profile) {
    var rows = (profile.agents || []).map(function (agent) {
      return '<li><span>' + icon('agent', 18) + '</span><div><b>' + esc(agent.name) + '</b><p>' + esc(agent.job) + '</p></div><small>' + esc(agent.status) + '</small></li>';
    }).join('');
    return '<section class="people-section" aria-labelledby="people-agent-title"><div class="people-section-head"><div><p>协作助手</p><h2 id="people-agent-title">名下的 Agent</h2></div><span>' + esc(String((profile.agents || []).length)) + ' 个</span></div><ul class="people-agent-list">' +
      /* safe: rows 的值均在上方逐值转义 */ rows + '</ul></section>';
  }

  /* safe-fn: 动态字段均逐值转义 */
  function activity(profile) {
    var rows = (profile.activity || []).map(function (item) {
      return '<li><time>' + esc(item.at) + '</time><span></span><p>' + esc(item.text) + '</p></li>';
    }).join('');
    if (!rows) {
      return '<section class="people-activity-empty" aria-label="最近动态"><p>还没有公开动态。</p><a class="button tonal" href="#/feed">去动态广场</a></section>';
    }
    return '<section class="people-section" aria-labelledby="people-act-title"><div class="people-section-head"><div><p>近期记录</p><h2 id="people-act-title">最近动态</h2></div><span>公开记录</span></div><ol class="people-activity">' +
      /* safe: rows 的值均在上方逐值转义 */ rows + '</ol></section>';
  }

  /* safe-fn: 会员数据均逐值转义 */
  function benefitsCard(context) {
    if (isLive()) return '';
    var rows = data().benefits || [];
    var viewer = data().viewer || {};
    var level = LEVEL_NAMES[Number(viewer.level)] ? Number(viewer.level) : 1;
    var levelName = window.CommonsLevel && typeof window.CommonsLevel.name === 'function' ? window.CommonsLevel.name(level) : (viewer.levelName || LEVEL_NAMES[level]);
    var title = context === 'tiers' ? '按当前 L' + level + ' ' + levelName + '查看我的权益' : '我的权益';
    var eyebrow = '会员权益';
    return '<a class="people-benefits-card" data-people-benefits href="#/benefits"><span class="people-benefits-mark">' + icon('milestone', 20) + '</span><div><small>' + esc(eyebrow) + '</small><h2>' + esc(title) + '</h2><p>' +
      rows.map(function (row) { return esc(row.name) + ' ' + esc(String(row.used)) + ' / ' + esc(String(row.quota)); }).join(' · ') +
      '</p></div><span class="people-benefits-go">查看明细 ' + icon('arrow', 16) + '</span></a>';
  }

  /* safe-fn: 页面由本模块安全视图函数和逐值转义字段组成 */
  function livePeopleHTML() {
    if (livePeople.key === liveKey() && livePeople.error) {
      if (livePeople.error === 'closed') {
        return '<div class="pp-page" data-people-root><div role="status"><p>这个功能还没开放</p><p>管理员还没打开。</p></div></div>';
      }
      return '<div class="pp-page" data-people-root><div role="alert"><p>' + esc(livePeople.error) + '</p><button type="button" class="button" data-people-act="retry">重试</button></div></div>';
    }
    return '<div class="pp-page" data-people-root><p>正在读取主页…</p></div>';
  }
  function profilePage() {
    if (isLive()) return liveProfileHTML();
    if (isLive() && (livePeople.error || !livePeople.data)) return livePeopleHTML();
    var parts = pathParts();
    var profile = profileByHandle(decodeURIComponent(parts[1] || ''));
    if (!profile) return notFound('成员');
    var followed = Array.isArray(C().read && C().read('people.following', [])) ? C().read('people.following', []) : [];
    var isFollowed = followed.indexOf(profile.handle) >= 0;
    var hidden = ['heatmap', 'works', 'badges', 'agents', 'activity'].filter(function (key) { return !visible(profile, key); }).length;
    var workRows = profile.sourcePersonId
      ? (profile.workIds || []).map(workById).filter(Boolean)
      : data().works.filter(function (work) { return (profile.workIds || []).indexOf(work.id) >= 0; });
    var profileHub = window.CommonsLinks ? window.CommonsLinks.hub({ handle: profile.handle, self: false }) : '';
    return '<div class="people-page" data-people-root data-theme="' + esc(profile.theme) + '" ' + levelAttrs(profile) + '>' +
      '<header class="people-hero"><div class="people-hero-band"><span>公开个人主页</span><span class="people-hero-pattern" aria-hidden="true"><i>L1</i><i>L2</i><i>L3</i><i>L4</i><i>L5</i><i>L1</i><i>L2</i><i>L3</i><i>L4</i><i>L5</i></span><img src="assets/mascot/panda-squad-512.webp" alt="熊猫先锋队"></div>' +
      '<div class="people-identity">' + avatar(profile, 'large') + '<div class="people-name"><h1>' + nameplate(profile) + '</h1>' +
      (profile.role ? '<p class="people-role">' + esc(profile.role) + '</p>' : '') + '<blockquote>' + esc(profile.intro) + '</blockquote><div class="people-tags">' +
      profile.direction.concat(profile.tools).map(function (tag) { return '<span class="chip">' + esc(tag) + '</span>'; }).join('') +
      '</div></div><button type="button" class="button primary" data-people-act="follow" data-handle="' + esc(profile.handle) + '" aria-pressed="' + esc(String(isFollowed)) + '">' +
      (isFollowed ? '已关注' : '关注') + '</button></div>' + statStrip(profile) + '</header>' +
      /* safe: CommonsLinks.hub 逐值转义并校验站内路由 */ profileHub +
      '<div class="people-layout"><main>' +
      (visible(profile, 'heatmap') ? heatmap(profile) : '') +
      collaboration(profile) +
      (visible(profile, 'works') ? '<section class="people-section" aria-labelledby="people-works-title"><div class="people-section-head"><div><p>代表作品</p><h2 id="people-works-title">作品墙</h2></div><span>HTML · 知识卡 · 讲堂</span></div><div class="people-work-wall">' + workRows.map(workCard).join('') + '</div></section>' : '') +
      (visible(profile, 'badges') ? badgeWall(profile) : '') +
      (visible(profile, 'agents') ? agents(profile) : '') +
      (visible(profile, 'activity') ? activity(profile) : '') +
      '</main><aside class="people-aside">' + benefitsCard('profile') +
      '<section class="people-privacy"><span>' + icon('shield', 18) + '</span><div><h2>由成员决定公开范围</h2><p>' + esc(String(hidden)) + ' 个分区设为不公开；未展示的数据不会由页面补猜。</p></div></section>' +
      '<nav aria-label="示例成员"><h2>其他成员</h2>' + data().profiles.filter(function (p) { return p.handle !== profile.handle; }).map(function (p) {
        return '<a href="#/u/' + esc(encodeURIComponent(p.handle)) + '">' + avatar(p, 'small') + '<span><b>' + nameplate(p) + '</b><small>公开主页</small></span>' + icon('arrow', 16) + '</a>';
      }).join('') + '</nav></aside></div>' +
      /* safe: CommonsSocial.wall 自行转义 */ (window.CommonsSocial && window.CommonsSocial.wall ? window.CommonsSocial.wall(profile.handle) : '') +
      '</div>';
  }

  /* safe-fn: 动态字段均逐值转义 */
  function preview(work) {
    if (work.kind === 'html') return '<div class="people-preview-tools"><span>预览设备</span><div class="segmented" aria-label="预览设备"><button type="button" data-people-act="preview-device" data-device="desktop" aria-pressed="' + esc(String(state.previewDevice === 'desktop')) + '">桌面</button><button type="button" data-people-act="preview-device" data-device="phone" aria-pressed="' + esc(String(state.previewDevice === 'phone')) + '">手机</button></div></div><div class="people-html-preview" data-people-html="' + esc(work.id) + '"><p>正在装入 HTML 沙箱…</p></div>';
    return '<figure class="people-static-preview"><img src="' + safeUrl(work.cover) + '" alt="' + esc(work.title) + '示例封面"><figcaption>' + esc(KIND_NAMES[work.kind] || '作品') + ' · 示例预览</figcaption></figure>';
  }

  /* safe-fn: 动态字段均逐值转义，HTML 缩略图由 CommonsHTML 在 mount 后替换 */
  function relatedPreview(work) {
    if (work.kind === 'html') {
      return '<span class="people-related-preview" data-people-thumb="' + esc(work.id) + '"><img src="' + safeUrl(work.cover) + '" alt=""><small data-people-thumb-status>HTML</small></span>';
    }
    if (work.kind === 'knowledge') {
      return '<span class="people-related-preview is-knowledge" aria-hidden="true"><i></i><i></i><i></i><small>知识</small></span>';
    }
    return '<span class="people-related-preview"><img src="' + safeUrl(work.cover) + '" alt=""><small>' + esc(KIND_NAMES[work.kind] || '作品') + '</small></span>';
  }

  /* safe-fn: 动态字段均逐值转义 */
  function workPage() {
    if (isLive()) return liveWorkHTML();
    var parts = pathParts();
    var work = workById(decodeURIComponent(parts[1] || ''));
    if (!work) return notFound('作品');
    var author = authorOf(work);
    var liked = Array.isArray(C().read && C().read('people.likes', [])) ? C().read('people.likes', []) : [];
    var saved = Array.isArray(C().read && C().read('people.saves', [])) ? C().read('people.saves', []) : [];
    var repro = Array.isArray(C().read && C().read('people.reproduced', [])) ? C().read('people.reproduced', []) : [];
    var related = (work.related || []).map(workById).filter(Boolean);
    var source = sourceOf(work);
    return '<div class="people-page people-work-page" data-people-root data-work-id="' + esc(work.id) + '"><header class="people-work-head"><a class="people-back" href="#/u/' + esc(encodeURIComponent(author.handle)) + '">' + icon('back', 16) + '<span>返回 ' + esc(author.name) + ' 的主页</span></a><div><p>' + workIcon(work.kind) + esc(KIND_NAMES[work.kind] || '作品') + '</p><h1>' + esc(work.title) + '</h1><span>' + esc(work.summary) + '</span></div><div class="people-work-actions"><button type="button" class="button primary" data-people-act="reproduce" data-id="' + esc(work.id) + '" aria-pressed="' + esc(String(repro.indexOf(work.id) >= 0)) + '">' + (repro.indexOf(work.id) >= 0 ? '已记录复现' : '我复现了') + '</button><button type="button" class="button" data-people-act="share" data-id="' + esc(work.id) + '">分享</button></div></header>' +
      '<div class="people-work-layout"><main><section class="people-preview-stage" aria-label="作品预览">' + preview(work) + '</section>' +
      '<section class="people-work-story"><div><p>作品说明</p><h2>为什么做、怎么复现</h2></div><p>' + esc(work.description) + '</p><dl><div><dt>工具</dt><dd>' + work.tools.map(function (tool) { return '<span class="chip">' + esc(tool) + '</span>'; }).join('') + '</dd></div><div><dt>使用范围</dt><dd>学习与讨论 · 商业复用另行确认</dd></div></dl></section>' +
      '<section class="people-section" aria-labelledby="people-version-title"><div class="people-section-head"><div><p>版本变化</p><h2 id="people-version-title">版本记录</h2></div><span>' + esc(String(work.versions.length)) + ' 个版本</span></div><ol class="people-versions">' + work.versions.map(function (row) { return '<li><b>' + esc(row.version) + '</b><time>' + esc(row.at) + '</time><p>' + esc(row.note) + '</p></li>'; }).join('') + '</ol></section>' +
      '<section class="people-work-social" aria-label="作品互动"><button type="button" class="button tonal" data-people-act="like" data-id="' + esc(work.id) + '" aria-pressed="' + esc(String(liked.indexOf(work.id) >= 0)) + '">' + icon('favorite', 16) + ' ' + (liked.indexOf(work.id) >= 0 ? '已点赞' : '点赞') + ' <span>' + esc(String(work.likes + (liked.indexOf(work.id) >= 0 ? 1 : 0))) + '</span></button><button type="button" class="button" data-people-act="save" data-id="' + esc(work.id) + '" aria-pressed="' + esc(String(saved.indexOf(work.id) >= 0)) + '">' + (saved.indexOf(work.id) >= 0 ? '已收藏' : '收藏') + ' <span>' + esc(String(work.saves + (saved.indexOf(work.id) >= 0 ? 1 : 0))) + '</span></button><span>' + esc(String(work.reproduced + (repro.indexOf(work.id) >= 0 ? 1 : 0))) + ' 人复现</span></section>' +
      '<section class="people-section" aria-labelledby="people-comment-title"><div class="people-section-head"><div><p>作品讨论</p><h2 id="people-comment-title">评论区</h2></div><span>合成讨论</span></div><div data-people-thread></div></section></main>' +
      '<aside class="people-aside"><a class="people-author-card" href="#/u/' + esc(encodeURIComponent(author.handle)) + '" ' + levelAttrs(author) + '>' + avatar(author, 'normal') + '<div><small>作者</small><h2>' + nameplate(author) + '</h2><p>' + esc(author.intro) + '</p></div>' + icon('arrow', 16) + '</a><section class="people-related"><h2>相关作品</h2>' + related.map(function (item) { return '<a href="#/work/' + esc(encodeURIComponent(item.id)) + '">' + relatedPreview(item) + '<div><b>' + esc(item.title) + '</b><small>' + esc(KIND_NAMES[item.kind] || '作品') + '</small></div>' + icon('arrow', 16) + '</a>'; }).join('') + '</section></aside></div>' +
      '<nav class="people-work-origin" aria-label="作品作者与来源"><a href="#/u/' + esc(encodeURIComponent(author.handle)) + '"><span>作者</span><b>' + esc(author.name) + '</b>' + icon('arrow', 16) + '</a><a href="' + safeUrl(source.href) + '"><span>回到来源</span><b>' + esc(source.label) + '</b>' + icon('arrow', 16) + '</a></nav></div>';
  }

  /* safe-fn: 会员示例数据均逐值转义 */
  function benefitsPage() {
    if (isLive()) return liveBenefitsHTML();
    var rows = data().benefits || [];
    return '<div class="people-page people-benefits-page" data-people-root><header><p>会员权益 · 示例</p><h1>我的权益</h1><span>' + esc(data().benefitHeading || '') + '</span></header><div class="people-benefit-list">' + rows.map(function (row) {
      var pct = Math.min(100, Math.round(Number(row.used) / Math.max(1, Number(row.quota)) * 100));
      return '<article><div><h2>' + esc(row.name) + '</h2><p>' + esc(String(row.used)) + ' / ' + esc(String(row.quota)) + ' ' + esc(row.unit) + '</p></div><div class="people-meter" role="progressbar" aria-label="' + esc(row.name) + '使用量" aria-valuemin="0" aria-valuemax="' + esc(String(row.quota)) + '" aria-valuenow="' + esc(String(row.used)) + '" style="--people-used:' + esc(String(pct)) + '%"><i></i></div></article>';
    }).join('') + '</div><p class="people-note">实际额度以账号页显示为准。</p><a class="button" href="#/tiers">看等级与会员制度</a></div>';
  }

  function toggleStored(key, id) {
    if (!C().read || !C().write) return false;
    var rows = C().read(key, []);
    if (!Array.isArray(rows)) rows = [];
    var exists = rows.indexOf(id) >= 0;
    C().write(key, exists ? rows.filter(function (value) { return value !== id; }) : rows.concat(id));
    return !exists;
  }

  function onClick(event) {
    var button = event.target.closest('[data-people-act]');
    if (!button) return;
    var action = button.dataset.peopleAct;
    var id = button.dataset.id || button.dataset.handle || '';
    if (isLive()) { onLiveClick(action, button); return; }
    if (action === 'follow') {
      toggleStored('people.following', id);
      if (C().refresh) C().refresh();
      return;
    }
    if (action === 'like' || action === 'save' || action === 'reproduce') {
      var keys = { like: 'people.likes', save: 'people.saves', reproduce: 'people.reproduced' };
      var on = toggleStored(keys[action], id);
      if (C().toast) C().toast(action === 'reproduce' ? (on ? '已记下这次复现；请继续补自己的产物。' : '已撤回这条复现记录。') : (on ? '已保存在本机。' : '已从本机记录移除。'));
      if (C().refresh) C().refresh();
      return;
    }
    if (action === 'preview-device') {
      state.previewDevice = button.dataset.device === 'phone' ? 'phone' : 'desktop';
      state.root.querySelectorAll('[data-people-act="preview-device"]').forEach(function (item) {
        item.setAttribute('aria-pressed', String(item.dataset.device === state.previewDevice));
      });
      if (state.htmlHandle && typeof state.htmlHandle.setDevice === 'function') state.htmlHandle.setDevice(state.previewDevice);
      return;
    }
    if (action === 'share' && C().modal) {
      var work = workById(id);
      C().modal('分享作品', '<div class="people-share-placeholder"><p>分享卡暂未接入，可先复制作品链接。</p><code>#/work/' + esc(work ? work.id : id) + '</code><p>尚未对外发布</p></div>');
    }
  }

  function injectBenefits() {
    var route = pathParts()[0] || 'home';
    if (route !== 'home' && route !== 'tiers') return;
    var host = route === 'tiers' ? document.querySelector('[data-growth]') : document.querySelector('#main .craft-home');
    if (!host || host.querySelector('[data-people-benefits]')) return;
    var slot = document.createElement('div');
    slot.className = 'people-benefits-injected';
    slot.innerHTML = benefitsCard(route);
    if (route === 'tiers') host.insertBefore(slot, host.firstChild ? host.firstChild.nextSibling : null);
    else host.appendChild(slot);
  }

  function mountHtml(work) {
    var host = state.root && state.root.querySelector('[data-people-html]');
    if (!host || !work || (isLive() ? work.type !== 'work' && work.kind !== 'html' : work.kind !== 'html')) return;
    if (!window.CommonsHTML || typeof window.CommonsHTML.render !== 'function') {
      host.innerHTML = '<div class="people-dependency"><b>HTML 预览模块未接入</b><p>预览模块接入后会显示作品画面。</p></div>';
      return;
    }
    var options = { title: work.title, device: state.previewDevice };
    if (isLive()) {
      // GET /content/objects/{id}: content.html_asset + assets[id].content_url.
      options.assetId = work.content && work.content.html_asset;
      var asset = options.assetId && work.assets && work.assets[options.assetId];
      if (asset && asset.content_url) options.contentUrl = asset.content_url;
    } else options.html = work.html;
    state.htmlHandle = window.CommonsHTML.render(host, options);
  }

  function mountThumbs() {
    if (!state.root || !window.CommonsHTML || typeof window.CommonsHTML.thumbnail !== 'function') return;
    var run = ++state.thumbRun;
    state.root.querySelectorAll('[data-people-thumb]').forEach(function (host) {
      var work = workById(host.dataset.peopleThumb);
      if (!work || !work.html) return;
      window.CommonsHTML.thumbnail(work.html, { width: 720, height: 450, title: work.title }).then(function (url) {
        if (run !== state.thumbRun || !host.isConnected) return;
        var image = host.querySelector('img');
        if (image) { image.src = url; image.alt = work.title + '沙箱缩略图'; }
        var label = host.querySelector('[data-people-thumb-status]');
        if (label) label.textContent = 'HTML 沙箱缩略图 · 示例';
      }).catch(function () {
        if (run !== state.thumbRun || !host.isConnected) return;
        var label = host.querySelector('[data-people-thumb-status]');
        if (label) label.textContent = '缩略图生成失败 · 已显示占位';
      });
    });
  }

  function mountThread(work) {
    var host = state.root && state.root.querySelector('[data-people-thread]');
    if (!host || !work) return;
    if (!window.CommonsThread || typeof window.CommonsThread.mount !== 'function') {
      host.innerHTML = '<div class="people-dependency"><b>评论模块未接入</b><p>讨论模块接入后会显示回复与反应。</p></div>';
      return;
    }
    var people = data().profiles.map(function (p) { return { id: p.handle, name: p.name, level: p.level, levelName: p.levelName }; });
    people.push(data().viewer);
    window.CommonsThread.mount(host, { targetId: 'work:' + work.id, messages: work.comments, me: data().viewer, people: people, mode: 'chat' });
  }

  function on(target, type, handler) {
    target.addEventListener(type, handler);
    state.unbind.push(function () { target.removeEventListener(type, handler); });
  }

  function liveKey() { return location.hash; }
  function refreshLive() { if (C().refresh) C().refresh(); }
  function enc(value) { return encodeURIComponent(String(value == null ? '' : value)); }
  function isClosed(error) { return !!error && (error.status === 501 || error.code === 'capability_unavailable'); }
  function liveMsg(error, fallback) {
    if (isClosed(error)) return '这个功能还没开放。';
    return (error && error.message) || fallback || '没有成功，原状态没有变化。';
  }
  function myHandle() {
    var me = window.CommonsSession && window.CommonsSession.me;
    return me && me.handle ? String(me.handle) : '';
  }
  function myId() {
    var me = window.CommonsSession && window.CommonsSession.me;
    return me && me.id ? String(me.id) : '';
  }
  function rememberHandles(rows) {
    (rows || []).forEach(function (row) {
      if (row && row.id && row.handle) handleById[row.id] = row.handle;
    });
  }
  function timeText(value) {
    var d = new Date(value);
    if (!value || isNaN(d.getTime())) return '';
    return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  /* 把接口里的成员行映射成 avatar() / nameplate() 认的形状 */
  function liveFace(row) {
    var level = LEVEL_NAMES[Number(row && row.level)] ? Number(row.level) : 1;
    return {
      name: (row && (row.display_name || row.name || row.handle)) || '成员',
      handle: row && row.handle || '',
      level: level,
      levelName: LEVEL_NAMES[level],
      avatar: row && row.avatar || DEFAULT_AVATAR
    };
  }
  function writeLive(method, path, body) {
    var api = window.CommonsAPI;
    if (!api) return Promise.reject(new Error('没有接上接口。'));
    var opts = { idempotencyKey: api.newIdempotencyKey() };
    if (method === 'POST') return api.post(path, body || {}, opts);
    if (method === 'PUT') return api.put(path, body || {}, opts);
    return api.del(path, undefined, opts);
  }
  function nullOn404(error) {
    if (error && error.status === 404) return { data: null };
    throw error;
  }

  /* ---------- 成员主页 ---------- */

  /* safe-fn: 动态文本均逐值转义 */
  function liveStats(rel) {
    var counts = rel && rel.counts;
    if (!counts) return '';
    var rows = [['关注', counts.following], ['被关注', counts.followers], ['好友', counts.friends]];
    if (Number(rel.mutual_friends) > 0) rows.push(['共同好友', rel.mutual_friends]);
    return '<dl class="people-stats">' + rows.map(function (row) {
      return '<div><dt>' + esc(row[0]) + '</dt><dd>' + esc(String(row[1] == null ? 0 : row[1])) + '</dd></div>';
    }).join('') + '</dl>';
  }

  /* safe-fn: 按钮文案写死，句柄逐值转义 */
  function liveActions(cur, detail, self) {
    var busy = livePeople.busy ? ' disabled' : '';
    var handle = esc(cur.handle);
    if (self) return '<a class="button" href="#/account">编辑资料</a>';
    var relation = detail.rel && detail.rel.relation;
    if (!relation) {
      return detail.relError
        ? '<button type="button" class="button" data-people-act="retry-rel">重试关系状态</button>'
        : '<span class="people-live-muted">正在读取关系…</span>';
    }
    if (relation.blocked) {
      return '<button type="button" class="button" data-people-act="unblock" data-handle="' + handle + '"' + busy + '>解除拉黑</button>';
    }
    var following = !!relation.following;
    var menu = [];
    if (following) menu.push(['star', relation.starred ? '取消特别关注' : '特别关注', false]);
    menu.push(['mute', relation.muted ? '取消静音' : '静音', false]);
    menu.push(['poke', relation.poked_today ? '今天已戳过' : '戳一下', !!relation.poked_today]);
    menu.push(['block', livePeople.confirm === 'block' ? '确认拉黑（互相看不到动态）' : '拉黑', false]);
    return '<button type="button" class="button primary" data-people-act="follow" data-handle="' + handle + '" aria-pressed="' + esc(String(following)) + '"' + busy + '>' + (following ? '已关注' : '关注') + '</button>' +
      '<button type="button" class="button" data-people-act="dm" data-handle="' + handle + '"' + busy + '>私信</button>' +
      '<details class="people-more"' + (livePeople.confirm ? ' open' : '') + '><summary class="button">更多</summary><div class="people-more-menu">' + menu.map(function (item) {
        return '<button type="button" class="button ghost" data-people-act="' + esc(item[0]) + '" data-handle="' + handle + '"' + (busy || item[2] ? ' disabled' : '') + '>' + esc(item[1]) + '</button>';
      }).join('') + '</div></details>';
  }

  /* safe-fn: 作品字段逐值转义 */
  function liveWorkCard(item) {
    return '<article class="people-work-card"><div class="people-work-copy"><p>' + workIcon('work') + '作品</p>' +
      '<h3><a href="#/work/' + esc(enc(item.id)) + '">' + esc(item.title || '未命名作品') + '</a></h3>' +
      '<span>' + esc(item.excerpt || '') + '</span><small>' + esc(timeText(item.published_at || item.created_at)) + '</small></div></article>';
  }

  /* safe-fn: 分区状态与作品卡逐值转义 */
  function liveWorksHTML(detail) {
    var works = detail.works || {};
    var body;
    if (works.loading) body = '<p class="people-live-muted">正在读取作品…</p>';
    else if (works.error) body = '<div role="alert"><p>' + esc(works.error) + '</p><button type="button" class="button" data-people-act="retry-works">重试</button></div>';
    else if (!works.items.length) body = '<p class="people-live-muted">还没有公开作品。</p>';
    else body = '<div class="people-work-wall">' + works.items.map(liveWorkCard).join('') + '</div>';
    return '<section class="people-section" aria-labelledby="people-works-title"><div class="people-section-head"><div><p>公开作品</p><h2 id="people-works-title">作品墙</h2></div></div>' +
      /* safe: body 由上方分支逐值转义 */ body + '</section>';
  }

  var SCOPE_NAMES = { members: '成员可见', friends: '好友可见', group: '小组内', 'private': '仅自己' };

  /* safe-fn: 动态字段逐值转义，链接过 safeUrl */
  function livePostHTML(post) {
    var meta = [timeText(post.created_at), SCOPE_NAMES[post.scope] || ''];
    if (post.group && post.group.name) meta.push('小组 ' + post.group.name);
    var images = Array.isArray(post.images) ? post.images.length : 0;
    var link = post.link && post.link.url
      ? '<p><a href="' + safeUrl(post.link.url) + '" target="_blank" rel="noopener noreferrer">' + esc(post.link.title || post.link.url) + '</a></p>'
      : '';
    var text = post.status === 'hidden' ? '这条动态已被隐藏。' : (post.body || '');
    return '<li class="people-live-post"><time>' + esc(meta.filter(Boolean).join(' · ')) + '</time><p class="people-live-text">' + esc(text) + '</p>' +
      /* safe: link 已转义 */ link +
      '<small>' + (images ? esc('含 ' + images + ' 张图片 · ') : '') + esc('评论 ' + Number(post.comments || 0) + ' · 转发 ' + Number(post.shares || 0)) + '</small></li>';
  }

  /* safe-fn: 动态由 livePostHTML 逐值转义 */
  function liveWallHTML(detail) {
    var wall = detail.wall || {};
    var body;
    if (wall.loading && !wall.items.length) body = '<p class="people-live-muted">正在读取动态…</p>';
    else if (wall.error) body = '<div role="alert"><p>' + esc(wall.error) + '</p><button type="button" class="button" data-people-act="retry-wall">重试</button></div>';
    else if (!wall.items.length) body = '<p class="people-live-muted">还没有公开动态。</p><a class="button tonal" href="#/feed">去动态广场</a>';
    else body = '<ol class="people-live-wall">' + wall.items.map(livePostHTML).join('') + '</ol>' +
      (wall.cursor ? '<button type="button" class="button" data-people-act="more-wall"' + (wall.loading ? ' disabled' : '') + '>更多动态</button>' : '');
    return '<section class="people-section" aria-labelledby="people-act-title"><div class="people-section-head"><div><p>近期记录</p><h2 id="people-act-title">最近动态</h2></div></div>' +
      /* safe: body 由上方分支逐值转义 */ body + '</section>';
  }

  /* safe-fn: 其他成员列表逐值转义 */
  function liveMembersNav() {
    var rows = livePeople.data.profiles;
    return '<nav class="people-live-others" aria-label="其他成员"><h2>其他成员</h2>' + rows.map(function (row) {
      return '<a href="#/u/' + esc(enc(row.handle)) + '">' + esc(row.display_name || row.handle) + '</a>';
    }).join('') + '</nav>' + (livePeople.cursor ? '<button type="button" class="button" data-people-act="more"' + (livePeople.moreLoading ? ' disabled' : '') + '>' + (livePeople.moreLoading ? '正在加载…' : '更多成员') + '</button>' : '');
  }

  /* safe-fn: 页面由本模块安全视图函数和逐值转义字段组成 */
  function liveProfileHTML() {
    if (livePeople.key !== liveKey() || (livePeople.loading && !livePeople.moreLoading) || livePeople.error || !livePeople.data) return livePeopleHTML();
    var cur = livePeople.data.current;
    if (!cur) {
      return '<div class="people-page" data-people-root><h1>没有找到这个成员</h1><p>尚无可见的公开主页。</p>' + liveMembersNav() + '</div>';
    }
    var detail = livePeople.detail || { rel: null, relError: '', works: { items: [], loading: true }, wall: { items: [], loading: true } };
    var rel = detail.rel;
    var self = !!(rel && rel.self) || (!!myId() && myId() === cur.id) || (!!myHandle() && myHandle() === cur.handle);
    var relation = rel && rel.relation;
    var face = liveFace(cur);
    var tie = relation && relation.following && relation.followed_by ? '互相关注' : (relation && relation.followed_by ? 'TA 关注了你' : '');
    var blocked = !!(relation && relation.blocked);
    return '<div class="people-page" data-people-root ' + levelAttrs(face) + '>' +
      '<header class="people-hero"><div class="people-hero-band"><span>公开个人主页</span><img src="assets/mascot/panda-squad-512.webp" alt="熊猫先锋队"></div>' +
      '<div class="people-identity">' + avatar(face, 'large') + '<div class="people-name"><h1>' + nameplate(face) + '</h1>' +
      '<p class="people-role">@' + esc(cur.handle) + ' · L' + esc(String(face.level)) + ' ' + esc(face.levelName) + (tie ? ' · ' + esc(tie) : '') + '</p></div>' +
      '<div class="people-live-actions">' + liveActions(cur, detail, self) + '</div></div>' +
      (blocked ? '' : liveStats(rel)) + '</header>' +
      (livePeople.notice ? '<p class="people-live-note" role="status">' + esc(livePeople.notice) + '</p>' : '') +
      (detail.relError && !rel ? '<p class="people-live-note" role="alert">' + esc(detail.relError) + '</p>' : '') +
      (blocked ? '<p class="people-live-note" role="status">你已拉黑 TA，动态和作品不再显示。</p>' : liveWorksHTML(detail) + liveWallHTML(detail)) +
      liveMembersNav() + '</div>';
  }

  function loadLive(more) {
    if (!isLive() || (livePeople.loading && livePeople.key === liveKey())) return;
    var key = liveKey();
    var handle = pathParts()[0] === 'u' ? decodeURIComponent(pathParts()[1] || '') : '';
    var prior = more && livePeople.key === key ? livePeople.data : null;
    var cursor = prior && livePeople.cursor;
    var seq = ++livePeople.seq;
    livePeople.key = key; livePeople.error = ''; livePeople.loading = true; livePeople.moreLoading = !!prior;
    if (prior) livePeople.notice = '';
    if (!prior) { livePeople.data = null; livePeople.detail = null; livePeople.notice = ''; livePeople.busy = ''; livePeople.confirm = ''; }
    Promise.resolve().then(function () {
      if (!window.CommonsAPI || typeof window.CommonsAPI.get !== 'function') throw new Error('没有接上接口。');
      return Promise.all([
        window.CommonsAPI.get('/social/profiles', cursor ? { cursor: cursor } : {}),
        prior ? Promise.resolve({ data: prior.current }) : handle ? window.CommonsAPI.get('/social/profiles/' + enc(handle)).catch(nullOn404) : Promise.resolve({ data: null })
      ]);
    }).then(function (pair) {
      if (seq !== livePeople.seq || key !== liveKey()) return;
      var rows = pair[0] && pair[0].data && pair[0].data.items || [];
      var combined = (prior ? prior.profiles : []).concat(rows);
      var current = pair[1] && pair[1].data;
      livePeople.data = { label: '', profiles: combined.filter(function (row, i) { return combined.findIndex(function (p) { return p.id === row.id; }) === i; }), current: current, works: [], benefits: [], viewer: {} };
      livePeople.cursor = pair[0] && pair[0].meta && pair[0].meta.cursor;
      livePeople.loading = false; livePeople.moreLoading = false;
      rememberHandles(combined.concat(current ? [current] : []));
      if (!prior && current) startDetail(current, key);
      refreshLive();
    }).catch(function (error) {
      if (seq !== livePeople.seq || key !== liveKey()) return;
      livePeople.loading = false;
      if (prior) {
        livePeople.moreLoading = false;
        livePeople.notice = liveMsg(error, '更多成员没有载入，可以再点一次。');
        refreshLive();
        return;
      }
      livePeople.moreLoading = false; livePeople.data = null; livePeople.cursor = null;
      livePeople.error = isClosed(error) ? 'closed' : ((error && error.message) || '主页没有载入'); refreshLive();
    });
  }

  /* 主页的三块独立数据：关系、作品、动态。任何一块失败只影响自己那一块。 */
  function detailFresh(key, detail) { return livePeople.key === key && livePeople.detail === detail; }
  function startDetail(cur, key) {
    var detail = livePeople.detail = {
      rel: null, relError: '',
      works: { items: [], loading: true, error: '' },
      wall: { items: [], loading: true, error: '', cursor: null }
    };
    loadRelation(cur.handle, key, detail);
    loadWorks(cur, key, detail);
    loadWall(cur.handle, key, detail, false);
  }
  function loadRelation(handle, key, detail) {
    detail.relError = '';
    Promise.resolve().then(function () {
      return window.CommonsAPI.get('/social/people/' + enc(handle));
    }).then(function (response) {
      if (!detailFresh(key, detail)) return;
      detail.rel = response && response.data || null;
      refreshLive();
    }, function (error) {
      if (!detailFresh(key, detail)) return;
      detail.relError = error && error.status === 404 ? '' : liveMsg(error, '关系状态没有载入。');
      refreshLive();
    });
  }
  function loadWorks(cur, key, detail) {
    detail.works = { items: [], loading: true, error: '' };
    Promise.resolve().then(function () {
      return window.CommonsAPI.get('/objects', { type: 'work', author_id: cur.id, limit: 12 });
    }).then(function (response) {
      if (!detailFresh(key, detail)) return;
      detail.works = { items: Array.isArray(response && response.data) ? response.data : [], loading: false, error: '' };
      refreshLive();
    }, function (error) {
      if (!detailFresh(key, detail)) return;
      detail.works = { items: [], loading: false, error: liveMsg(error, '作品没有载入。') };
      refreshLive();
    });
  }
  function loadWall(handle, key, detail, more) {
    var prior = more ? detail.wall.items : [];
    var cursor = more ? detail.wall.cursor : null;
    detail.wall = { items: prior, loading: true, error: '', cursor: cursor };
    Promise.resolve().then(function () {
      return window.CommonsAPI.get('/social/walls/' + enc(handle), cursor ? { limit: 10, cursor: cursor } : { limit: 10 });
    }).then(function (response) {
      if (!detailFresh(key, detail)) return;
      var rows = response && response.data && response.data.items || [];
      detail.wall = { items: prior.concat(rows), loading: false, error: '', cursor: response && response.meta && response.meta.cursor || null };
      refreshLive();
    }, function (error) {
      if (!detailFresh(key, detail)) return;
      detail.wall = { items: prior, loading: false, error: liveMsg(error, '动态没有载入。'), cursor: cursor };
      refreshLive();
    });
  }

  var REL_ACTIONS = {
    follow: function (relation) { return relation.following ? ['DELETE', 'follows', '已取消关注。'] : ['PUT', 'follows', '已关注。']; },
    star: function (relation) { return relation.starred ? ['DELETE', 'stars', '已取消特别关注。'] : ['PUT', 'stars', '已设为特别关注。']; },
    mute: function (relation) { return relation.muted ? ['DELETE', 'mutes', '已取消静音。'] : ['PUT', 'mutes', '已静音，TA 的动态不再出现在你的列表里。']; },
    block: function () { return ['PUT', 'blocks', '已拉黑，互相看不到动态。']; },
    unblock: function () { return ['DELETE', 'blocks', '已解除拉黑，之前的关注不会恢复。']; },
    poke: function () { return ['POST', 'pokes', '已戳了 TA 一下。']; }
  };

  function liveProfileAct(action, button) {
    var cur = livePeople.data && livePeople.data.current;
    var detail = livePeople.detail;
    if (!cur || !detail) return;
    var key = livePeople.key;
    if (action === 'retry-rel') { loadRelation(cur.handle, key, detail); refreshLive(); return; }
    if (action === 'retry-works') { loadWorks(cur, key, detail); refreshLive(); return; }
    if (action === 'retry-wall') { loadWall(cur.handle, key, detail, false); refreshLive(); return; }
    if (action === 'more-wall') { if (!detail.wall.loading) { loadWall(cur.handle, key, detail, true); refreshLive(); } return; }
    if (livePeople.busy) return;
    if (action === 'dm') {
      if (!window.CommonsDM || typeof window.CommonsDM.open !== 'function') {
        livePeople.notice = '私信模块没有载入。'; refreshLive(); return;
      }
      livePeople.busy = 'dm'; livePeople.notice = ''; refreshLive();
      // POST /dm/threads 的 with 要成员 id，不是 handle。
      Promise.resolve().then(function () { return window.CommonsDM.open({ with: cur.id }); }).then(function () {
        livePeople.busy = '';
      }, function (error) {
        if (!detailFresh(key, detail)) return;
        livePeople.busy = ''; livePeople.notice = liveMsg(error, '私信没能打开。'); refreshLive();
      });
      return;
    }
    var relation = detail.rel && detail.rel.relation;
    var make = REL_ACTIONS[action];
    if (!make || !relation) return;
    if (action === 'block' && livePeople.confirm !== 'block') { livePeople.confirm = 'block'; refreshLive(); return; }
    var spec = make(relation);
    livePeople.confirm = ''; livePeople.busy = action; livePeople.notice = '';
    refreshLive();
    writeLive(spec[0], '/social/' + spec[1] + '/' + enc(cur.handle)).then(function () {
      return window.CommonsAPI.get('/social/people/' + enc(cur.handle)).then(function (response) {
        return response && response.data;
      }, function () { return null; });
    }).then(function (fresh) {
      if (!detailFresh(key, detail)) return;
      if (fresh) detail.rel = fresh;
      livePeople.busy = '';
      livePeople.notice = fresh ? spec[2] : spec[2] + '（关系状态稍后刷新）';
      refreshLive();
    }, function (error) {
      if (!detailFresh(key, detail)) return;
      livePeople.busy = ''; livePeople.notice = liveMsg(error, '没有成功，原状态没有变化。'); refreshLive();
    });
  }

  /* ---------- 作品页 ---------- */

  var VISIBILITY_NAMES = { 'public': '公开', members: '登录成员可见', level: '达到等级可见', space: '空间成员可见', named: '指定成员可见' };

  /* safe-fn: 页面状态文案写死 */
  function liveWorkStatus(message, retry) {
    return '<div class="people-page" data-people-root><p role="' + (retry ? 'alert' : 'status') + '">' + esc(message) + '</p>' +
      (retry ? '<button type="button" class="button" data-people-act="retry">重试</button>' : '') + '</div>';
  }

  /* 作品正文：纯文本 body；没有就取文档里的文字；再没有就用摘要。 */
  function liveWorkText(content) {
    if (typeof content.body === 'string' && content.body.trim()) return content.body;
    if (content.doc && window.CommonsReader && typeof window.CommonsReader.plain === 'function') {
      var text = window.CommonsReader.plain(content.doc);
      if (text && text.trim()) return text;
    }
    return typeof content.summary === 'string' ? content.summary : '';
  }

  /* safe-fn: 作品字段逐值转义 */
  function liveWorkHTML() {
    if (liveWork.key !== liveKey() || liveWork.loading) return liveWorkStatus('正在读取作品…');
    if (liveWork.error === 'notfound') return notFound('作品');
    if (liveWork.error === 'closed') return '<div class="people-page" data-people-root><p role="status">这个功能还没开放</p></div>';
    if (liveWork.error) return liveWorkStatus(liveWork.error, true);
    var item = liveWork.item;
    if (!item) return notFound('作品');
    var content = item.content || {};
    var mine = item.mine || {};
    var stats = item.stats || {};
    var author = item.author || {};
    var face = liveFace(author);
    var handle = author.id === myId() ? myHandle() : (handleById[author.id] || '');
    var ownWork = !!author.id && author.id === myId();
    var busy = liveWork.busy ? ' disabled' : '';
    var tags = Array.isArray(content.tags) ? content.tags : [];
    var text = liveWorkText(content);
    var stage = content.html_asset
      ? '<section class="people-preview-stage" aria-label="作品预览"><div class="people-preview-tools"><span>预览设备</span><div class="segmented" aria-label="预览设备"><button type="button" data-people-act="preview-device" data-device="desktop" aria-pressed="' + esc(String(state.previewDevice === 'desktop')) + '">桌面</button><button type="button" data-people-act="preview-device" data-device="phone" aria-pressed="' + esc(String(state.previewDevice === 'phone')) + '">手机</button></div></div><div class="people-html-preview" data-people-html="' + esc(item.id) + '"><p>正在装入 HTML 沙箱…</p></div></section>'
      : '';
    var authorCard = (handle
      ? '<a class="people-author-card" href="#/u/' + esc(enc(handle)) + '"' : '<div class="people-author-card"') +
      ' ' + levelAttrs(face) + '>' + avatar(face, 'normal') + '<div><small>作者</small><h2>' + nameplate(face) + '</h2></div>' + (handle ? icon('arrow', 16) : '') + (handle ? '</a>' : '</div>');
    return '<div class="people-page people-work-page" data-people-root data-work-id="' + esc(item.id) + '">' +
      '<header class="people-work-head"><a class="people-back" href="#/people">' + icon('back', 16) + '<span>返回成员页</span></a>' +
      '<div><p>' + workIcon(content.html_asset ? 'html' : 'work') + esc(content.html_asset ? 'HTML 作品' : (KIND_NAMES[item.type] || '作品')) + '</p><h1>' + esc(item.title || '未命名作品') + '</h1><span>' + esc(content.summary || '') + '</span></div>' +
      '<div class="people-work-actions"><button type="button" class="button tonal" data-people-act="save" data-id="' + esc(item.id) + '" aria-pressed="' + esc(String(!!mine.saved)) + '"' + busy + '>' + (mine.saved ? '已收藏' : '收藏') + ' <span>' + esc(String(Number(stats.saves || 0))) + '</span></button>' +
      (ownWork ? '' : '<button type="button" class="button" data-people-act="useful" data-id="' + esc(item.id) + '" aria-pressed="' + esc(String(!!mine.useful)) + '"' + (busy || mine.useful ? ' disabled' : '') + '>' + (mine.useful ? '已标有用' : '有用') + ' <span>' + esc(String(Number(stats.useful || 0))) + '</span></button>') + '</div></header>' +
      (liveWork.notice ? '<p class="people-live-note" role="status">' + esc(liveWork.notice) + '</p>' : '') +
      '<div class="people-work-layout"><main>' + stage +
      '<section class="people-work-story"><div><p>作品说明</p><h2>内容</h2></div>' + (text ? '<p class="people-live-text">' + esc(text) + '</p>' : '<p class="people-live-muted">作者没有写说明。</p>') +
      '<dl><div><dt>标签</dt><dd>' + (tags.length ? tags.map(function (tag) { return '<span class="chip">' + esc(tag) + '</span>'; }).join('') : '无') + '</dd></div><div><dt>可见范围</dt><dd>' + esc(VISIBILITY_NAMES[item.visibility] || '按作者设置') + (item.visibility === 'level' ? esc(' · L' + Number(item.min_level || 1) + ' 起') : '') + '</dd></div><div><dt>发布时间</dt><dd>' + esc(timeText(item.published_at || item.created_at)) + '</dd></div></dl>' +
      '<p class="people-live-links"><a class="button" href="#/read/' + esc(enc(item.id)) + '">阅读页</a> <a class="button" href="#/threads/' + esc(enc(item.id)) + '">讨论（' + esc(String(Number(stats.replies || 0))) + ' 条回复）</a></p></section></main>' +
      '<aside class="people-aside">' + /* safe: authorCard 由 avatar / nameplate / esc 拼成 */ authorCard + '</aside></div></div>';
  }

  function loadLiveWork() {
    if (!isLive()) return;
    var key = liveKey();
    if (liveWork.loading && liveWork.key === key) return;
    var id = decodeURIComponent(pathParts()[1] || '');
    var seq = ++liveWork.seq;
    liveWork.key = key; liveWork.loading = true; liveWork.error = ''; liveWork.item = null; liveWork.notice = ''; liveWork.busy = '';
    Promise.resolve().then(function () {
      if (!window.CommonsAPI || typeof window.CommonsAPI.get !== 'function') throw new Error('没有接上接口。');
      return window.CommonsAPI.get('/content/objects/' + enc(id));
    }).then(function (response) {
      if (seq !== liveWork.seq || key !== liveKey()) return;
      liveWork.item = response && response.data || null;
      liveWork.loading = false;
      refreshLive();
    }, function (error) {
      if (seq !== liveWork.seq || key !== liveKey()) return;
      liveWork.loading = false; liveWork.item = null;
      liveWork.error = error && error.status === 404 ? 'notfound' : (isClosed(error) ? 'closed' : ((error && error.message) || '作品没有载入'));
      refreshLive();
    });
  }

  function liveWorkAct(action, button) {
    var item = liveWork.item;
    if (!item || liveWork.busy) return;
    var key = liveWork.key;
    var mine = item.mine = item.mine || {};
    var stats = item.stats = item.stats || {};
    var path;
    var request;
    var done;
    if (action === 'save') {
      var next = !mine.saved;
      path = '/content/objects/' + enc(item.id) + '/save';
      request = writeLive(next ? 'PUT' : 'DELETE', path);
      done = function () {
        mine.saved = next;
        stats.saves = Math.max(0, Number(stats.saves || 0) + (next ? 1 : -1));
        liveWork.notice = next ? '已收藏。' : '已取消收藏。';
      };
    } else if (action === 'useful') {
      path = '/content/objects/' + enc(item.id) + '/useful';
      request = writeLive('POST', path);
      done = function (response) {
        var result = response && response.data || {};
        mine.useful = true;
        stats.useful = result.useful != null ? Number(result.useful) : Number(stats.useful || 0) + 1;
        liveWork.notice = '已标记有用。';
      };
    } else return;
    liveWork.busy = action; liveWork.notice = '';
    refreshLive();
    request.then(function (response) {
      if (liveWork.key !== key) return;
      done(response); liveWork.busy = ''; refreshLive();
    }, function (error) {
      if (liveWork.key !== key) return;
      liveWork.busy = ''; liveWork.notice = liveMsg(error, '没有成功，原状态没有变化。'); refreshLive();
    });
  }

  /* ---------- 我的权益 ---------- */

  var UNIT_NAMES = { count: '次', slot: '个' };
  var PERIOD_WORDS = { month: '每月', season: '每赛季', account: '账号上限' };
  /* 额度单位：count → 次、slot → 个、megabyte → MB（额度 ≥ 1024 MB 时已用和额度都写成 GB）；未知单位不显示代码 */
  function formatAmount(value, unit, scaleBase) {
    var n = Number(value || 0);
    if (unit === 'megabyte') {
      if (Number(scaleBase) >= 1024) return (Math.round(n / 1024 * 10) / 10) + ' GB';
      return n + ' MB';
    }
    return n + (UNIT_NAMES[unit] ? ' ' + UNIT_NAMES[unit] : '');
  }
  function formatUsage(used, quota, unit) {
    var scaled = unit === 'megabyte' && Number(quota) >= 1024;
    var tail = scaled ? ' GB' : (unit === 'megabyte' ? ' MB' : (UNIT_NAMES[unit] ? ' ' + UNIT_NAMES[unit] : ''));
    var part = function (v) { return String(scaled ? Math.round(Number(v || 0) / 1024 * 10) / 10 : Number(v || 0)); };
    return part(used) + ' / ' + part(quota) + tail;
  }

  /* safe-fn: 权益字段逐值转义 */
  function liveBenefitRow(row, next) {
    var quota = Number(row.quota || 0);
    var used = Number(row.used || 0);
    var pct = quota > 0 ? Math.min(100, Math.round(used / quota * 100)) : 0;
    var word = PERIOD_WORDS[row.period] || '';
    var upgrade = next && Number(next.quota) > quota && next.available
      ? '<p class="people-live-muted">' + esc('升到 L' + next.level + ' 后' + (word ? word + (row.period === 'account' ? ' ' : '可用 ') : '可用 ') + formatAmount(next.quota, row.unit, next.quota)) + '</p>'
      : '';
    var lock = row.available ? '' : '<p class="people-live-muted">' + esc('L' + Number(row.minLevel || 1) + ' 起可用') + '</p>';
    return '<article><div><h2>' + esc(row.name) + '</h2><p>' + esc(formatUsage(used, quota, row.unit) + (row.periodLabel ? ' · ' + row.periodLabel : '')) + '</p>' +
      (row.description ? '<p class="people-live-muted">' + esc(row.description) + '</p>' : '') + lock + upgrade +
      '</div><div class="people-meter" role="progressbar" aria-label="' + esc(row.name) + '使用量" aria-valuemin="0" aria-valuemax="' + esc(String(quota)) + '" aria-valuenow="' + esc(String(used)) + '" style="--people-used:' + esc(String(pct)) + '%"><i></i></div></article>';
  }

  /* safe-fn: 权益字段逐值转义 */
  function liveBenefitsHTML() {
    if (liveBenefits.key !== liveKey() || liveBenefits.loading) {
      return '<div class="people-page" data-people-root><h1>我的权益</h1><p role="status">正在读取权益…</p></div>';
    }
    if (liveBenefits.error === 'closed') {
      return '<div class="people-page" data-people-root><h1>我的权益</h1><div role="status"><p>这个功能还没开放</p><p>管理员还没打开。</p></div></div>';
    }
    if (liveBenefits.error) {
      return '<div class="people-page" data-people-root><h1>我的权益</h1><div role="alert"><p>' + esc(liveBenefits.error) + '</p><button type="button" class="button" data-people-act="retry">重试</button></div></div>';
    }
    var me = liveBenefits.me || {};
    var nextRows = {};
    ((liveBenefits.next && liveBenefits.next.benefits) || []).forEach(function (row) {
      nextRows[row.key] = Object.assign({ level: liveBenefits.next.level }, row);
    });
    var rows = Array.isArray(me.benefits) ? me.benefits : [];
    return '<div class="people-page people-benefits-page" data-people-root><header><p>会员权益</p><h1>我的权益</h1><span>' + esc('当前 L' + Number(me.level || 1) + ' ' + (me.levelName || '')) + '</span></header>' +
      (rows.length
        ? '<div class="people-benefit-list">' + rows.map(function (row) { return liveBenefitRow(row, nextRows[row.key]); }).join('') + '</div>'
        : '<p class="people-live-muted">现在还没有可显示的权益。</p>') +
      '<p class="people-note">' + esc(me.note || '') + '</p><a class="button" href="#/tiers">看等级与会员制度</a></div>';
  }

  function loadLiveBenefits() {
    if (!isLive()) return;
    var key = liveKey();
    if (liveBenefits.loading && liveBenefits.key === key) return;
    var seq = ++liveBenefits.seq;
    liveBenefits.key = key; liveBenefits.loading = true; liveBenefits.error = ''; liveBenefits.me = null; liveBenefits.next = null;
    Promise.resolve().then(function () {
      if (!window.CommonsAPI || typeof window.CommonsAPI.get !== 'function') throw new Error('没有接上接口。');
      return window.CommonsAPI.get('/membership/me');
    }).then(function (response) {
      var me = response && response.data || {};
      var level = Number(me.level || 1);
      if (level >= 5) return [me, null];
      return window.CommonsAPI.get('/membership/benefits', { level: level + 1 }).then(function (next) {
        return [me, next && next.data || null];
      }, function () { return [me, null]; });
    }).then(function (pair) {
      if (seq !== liveBenefits.seq || key !== liveKey()) return;
      liveBenefits.me = pair[0]; liveBenefits.next = pair[1]; liveBenefits.loading = false; refreshLive();
    }, function (error) {
      if (seq !== liveBenefits.seq || key !== liveKey()) return;
      liveBenefits.loading = false;
      liveBenefits.error = isClosed(error) ? 'closed' : ((error && error.message) || '权益没有载入');
      refreshLive();
    });
  }

  var sessionAccountId = myId();
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('commons:session', function () {
      var next = myId();
      if (next === sessionAccountId) return;
      sessionAccountId = next;
      livePeople.seq += 1; liveWork.seq += 1; liveBenefits.seq += 1;
      livePeople.data = null; livePeople.detail = null; livePeople.key = null; livePeople.loading = false; livePeople.busy = ''; livePeople.notice = '';
      liveWork.item = null; liveWork.key = null; liveWork.loading = false; liveWork.busy = '';
      liveBenefits.me = null; liveBenefits.next = null; liveBenefits.key = null; liveBenefits.loading = false;
      if (isLive() && state.root) refreshLive();
    });
  }

  function onLiveClick(action, button) {
    var route = pathParts()[0];
    if (action === 'retry') {
      if (route === 'work') loadLiveWork();
      else if (route === 'benefits') loadLiveBenefits();
      else loadLive();
      return;
    }
    if (action === 'more') { if (!livePeople.moreLoading) loadLive(true); return; }
    if (action === 'preview-device') {
      state.previewDevice = button.dataset.device === 'phone' ? 'phone' : 'desktop';
      if (state.root) state.root.querySelectorAll('[data-people-act="preview-device"]').forEach(function (item) {
        item.setAttribute('aria-pressed', String(item.dataset.device === state.previewDevice));
      });
      if (state.htmlHandle && typeof state.htmlHandle.setDevice === 'function') state.htmlHandle.setDevice(state.previewDevice);
      return;
    }
    if (route === 'u') liveProfileAct(action, button);
    else if (route === 'work') liveWorkAct(action, button);
  }

  function mount() {
    destroy();
    state.root = document.querySelector('[data-people-root]');
    injectBenefits();
    if (!state.root) return;
    var parts = pathParts();
    if (isLive()) {
      if (parts[0] === 'u' && (livePeople.key !== liveKey() || (!livePeople.data && !livePeople.error && !livePeople.loading))) loadLive();
      if (parts[0] === 'work' && liveWork.key !== liveKey()) loadLiveWork();
      if (parts[0] === 'benefits' && liveBenefits.key !== liveKey()) loadLiveBenefits();
    }
    on(document, 'click', onClick);
    if (parts[0] === 'u') mountThumbs();
    if (parts[0] === 'work') {
      var work = workById(decodeURIComponent(parts[1] || ''));
      mountThumbs();
      mountHtml(work);
      if (!isLive()) mountThread(work);
    }
  }

  function destroy() {
    state.unbind.forEach(function (off) { off(); });
    state.unbind = [];
    state.thumbRun += 1;
    if (state.htmlHandle && typeof state.htmlHandle.destroy === 'function') state.htmlHandle.destroy();
    state.htmlHandle = null;
    state.root = null;
  }

  if (window.CommonsLinks && typeof window.CommonsLinks.provide === 'function') {
    window.CommonsLinks.provide('work', legacyWorkHub);
  }


  /* @ 补全：私信和 Agent 聊天的输入框共用。委托监听，输入框被重画也不用重新挂。 */
  var MENTION_RE = /(^|[\s，。,.!?！？、；;：:])@([^\s@]{0,20})$/;
  var mentionStyled = false;

  function mentionToken(value, caret) {
    var text = String(value == null ? '' : value);
    var end = typeof caret === 'number' ? caret : text.length;
    var head = text.slice(0, end);
    var hit = MENTION_RE.exec(head);
    if (!hit) return null;
    return { query: hit[2], start: end - hit[2].length - 1, end: end };
  }

  function mentionInsert(value, token, member) {
    var text = String(value == null ? '' : value);
    var name = member.display_name || member.handle || '';
    var before = text.slice(0, token.start);
    var after = text.slice(token.end);
    var inserted = '@' + name + ' ';
    return { value: before + inserted + after, caret: (before + inserted).length };
  }

  function mentionSearch(query, kinds) {
    var api = window.CommonsAPI;
    var q = String(query || '').trim();
    if (!q || !api || typeof api.get !== 'function') return Promise.resolve([]);
    var params = { q: q, limit: 6 };
    if (kinds) params.kinds = kinds;
    return api.get('/search/members', params).then(function (res) {
      var body = res && res.data ? res.data : res;
      return (body && body.items) || [];
    });
  }

  function mentionStyle() {
    if (mentionStyled || !document.head || !document.createElement) return;
    mentionStyled = true;
    var style = document.createElement('style');
    style.setAttribute('data-cm-style', '');
    style.textContent = '.cm-mention-host{position:relative}' +
      '.cm-mention-menu{position:absolute;left:var(--space-3);right:var(--space-3);bottom:100%;z-index:20;display:flex;flex-direction:column;gap:var(--space-1);padding:var(--space-1);margin:0;list-style:none;background:var(--surface-raised);border:var(--line-1) solid var(--line);border-radius:var(--radius-control);box-shadow:var(--shadow-2)}' +
      '.cm-mention-opt{display:flex;align-items:center;gap:var(--space-2);width:100%;padding:var(--space-2) var(--space-3);border:0;border-radius:var(--radius-thumb);background:transparent;color:var(--ink);font:var(--text-ui)/var(--leading-ui) var(--sans);text-align:left;cursor:pointer}' +
      '.cm-mention-opt[aria-selected="true"],.cm-mention-opt:hover{background:var(--accent-soft)}' +
      '.cm-mention-opt small{color:var(--muted);font-size:var(--text-meta)}' +
      '.cm-mention-tag{padding:0 var(--space-1);border-radius:var(--radius-pill);background:var(--agent-soft);color:var(--agent-ink);font-size:var(--text-micro)}';
    document.head.appendChild(style);
  }

  /* opts: selector 输入框选择器；kinds 'human,agent'；onPick(member, field) 选中后回调 */
  function mentionAttach(root, opts) {
    opts = opts || {};
    var selector = opts.selector || 'textarea';
    var cur = { field: null, token: null, items: [], index: 0, menu: null, timer: null, seq: 0 };

    function close() {
      if (cur.timer) { clearTimeout(cur.timer); cur.timer = null; }
      cur.seq += 1;
      cur.items = []; cur.token = null; cur.index = 0;
      if (cur.menu && cur.menu.parentNode) cur.menu.parentNode.removeChild(cur.menu);
      cur.menu = null;
    }

    /* safe-fn: 名字、handle、等级均 esc */
    function optionHTML(item, i) {
      var sub = item.kind === 'agent' ? '<span class="cm-mention-tag">Agent</span>' : '<small>@' + esc(item.handle || '') + ' · L' + esc(String(item.level || 1)) + '</small>';
      return '<li role="presentation"><button type="button" class="cm-mention-opt" role="option" data-cm-index="' + i + '" aria-selected="' + (i === cur.index ? 'true' : 'false') + '"><b>' + esc(item.display_name) + '</b>' + sub + '</button></li>';
    }

    function paint() {
      if (!cur.field || !cur.items.length) { close(); return; }
      var host = (cur.field.closest && cur.field.closest('form')) || cur.field.parentNode;
      if (!host) return;
      mentionStyle();
      if (!cur.menu || !cur.menu.isConnected) {
        cur.menu = document.createElement('ul');
        cur.menu.className = 'cm-mention-menu';
        cur.menu.setAttribute('role', 'listbox');
        cur.menu.setAttribute('aria-label', '提到谁');
      }
      if (host.classList) host.classList.add('cm-mention-host');
      cur.menu.innerHTML = /* safe: optionHTML 逐值转义 */ cur.items.map(optionHTML).join('');
      if (cur.menu.parentNode !== host) host.appendChild(cur.menu);
    }

    function pick(i) {
      var member = cur.items[i];
      var field = cur.field;
      var token = cur.token;
      if (!member || !field || !token) return;
      var next = mentionInsert(field.value, token, member);
      field.value = next.value;
      if (typeof field.setSelectionRange === 'function') field.setSelectionRange(next.caret, next.caret);
      if (field.focus) field.focus();
      close();
      if (typeof opts.onPick === 'function') opts.onPick(member, field);
      if (typeof Event === 'function' && field.dispatchEvent) field.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function onInput(event) {
      var field = event.target && event.target.closest ? event.target.closest(selector) : null;
      if (!field) return;
      var token = mentionToken(field.value, field.selectionStart);
      if (!token || !token.query) { close(); return; }
      cur.field = field; cur.token = token;
      if (cur.timer) clearTimeout(cur.timer);
      var seq = ++cur.seq;
      cur.timer = setTimeout(function () {
        cur.timer = null;
        mentionSearch(token.query, opts.kinds).then(function (items) {
          if (seq !== cur.seq) return;
          cur.items = items; cur.index = 0;
          paint();
        }).catch(function () { if (seq === cur.seq) close(); });
      }, 200);
    }

    function onKey(event) {
      if (!cur.menu || !cur.items.length) return;
      if (!event.target || !event.target.closest || !event.target.closest(selector)) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        cur.index = (cur.index + (event.key === 'ArrowDown' ? 1 : cur.items.length - 1)) % cur.items.length;
        paint();
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        pick(cur.index);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    }

    function onDown(event) {
      var option = event.target && event.target.closest ? event.target.closest('[data-cm-index]') : null;
      if (!option || !cur.menu || !cur.menu.contains(option)) return;
      event.preventDefault();
      pick(Number(option.getAttribute('data-cm-index')));
    }

    function onBlur(event) {
      if (event.target && event.target.closest && event.target.closest(selector)) setTimeout(close, 150);
    }

    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKey, true);
    root.addEventListener('mousedown', onDown);
    root.addEventListener('focusout', onBlur);
    return function detach() {
      close();
      root.removeEventListener('input', onInput);
      root.removeEventListener('keydown', onKey, true);
      root.removeEventListener('mousedown', onDown);
      root.removeEventListener('focusout', onBlur);
    };
  }

  window.CommonsMention = { attach: mentionAttach, token: mentionToken, insert: mentionInsert, search: mentionSearch };

  window.CommonsPeople = {
    routes: { u: profilePage, work: workPage, benefits: benefitsPage },
    mount: mount,
    destroy: destroy,
    profile: profilePage,
    work: workPage,
    benefitsCard: benefitsCard
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsPeople);
})();

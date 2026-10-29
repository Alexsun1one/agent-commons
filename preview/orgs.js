/* R13 ORG-1 · 团队目录与团队主页。 */
(function () {
  'use strict';

  var state = { root: null, unbind: [], type: 'all', sort: 'activity', query: '', tab: 'posts', live: null, liveError: '', liveLoading: false, detail: null, myWorks: null, busy: '', notice: '', account: '', apps: null, mine: null, post: null, keys: {} };
  var DEFAULT_LOGO = 'assets/mascot/panda-squad-512.webp';
  var DEFAULT_BANNER = 'assets/illus/empty-org.webp';

  function isLive() {
    return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live');
  }
  var ROLE_NAMES = { owner: '所有者', admin: '管理员', member: '成员' };
  var TAB_NAMES = { posts: '动态', works: '作品', jobs: '招聘', events: '活动', members: '成员' };
  var OWN_ICON_PATHS = {
    people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    search: 'M21 21l-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    check: 'M20 6 9 17l-5-5',
    arrow: 'M5 12h14M13 6l6 6-6 6',
    external: 'M14 3h7v7M10 14 21 3M21 14v7H3V3h7'
  };

  function data() {
    if (isLive()) return state.live || { label: '', types: [], orgs: [] };
    return window.COMMONS_ORGS_SAMPLE || { label: '示例', types: [], orgs: [] };
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
    return /^(?:#\/|assets\/|https?:\/\/)/i.test(String(value || '')) ? esc(value) : '#';
  }
  function icon(name, size) {
    if (window.CommonsIcons && typeof window.CommonsIcons.svg === 'function') {
      var shared = window.CommonsIcons.svg(name, { size: size || 16 });
      if (shared) return shared;
    }
    var path = OWN_ICON_PATHS[name] || OWN_ICON_PATHS.people;
    return '<svg viewBox="0 0 24 24" width="' + esc(String(size || 16)) + '" height="' + esc(String(size || 16)) +
      '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + esc(path) + '"></path></svg>';
  }
  function parts() { return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean); }
  function orgBySlug(slug) { return data().orgs.find(function (org) { return org.slug === slug; }); }
  function compact(value) { return Number(value) >= 1000 ? (Number(value) / 1000).toFixed(1) + 'k' : String(value); }
  function cleanHandle(value) { return String(value || '').trim().replace(/^@+/, '').toLowerCase(); }
  function teamsFor(handle) {
    var target = cleanHandle(handle);
    if (!target) return [];
    return data().orgs.filter(function (org) {
      return (org.membersList || []).some(function (member) { return cleanHandle(member.handle) === target; });
    });
  }
  function stored(key) {
    var value = C().read ? C().read(key, []) : [];
    return Array.isArray(value) ? value : [];
  }
  function toggleStored(key, id) {
    if (!C().write) return false;
    var list = stored(key);
    var on = list.indexOf(id) < 0;
    C().write(key, on ? list.concat(id) : list.filter(function (value) { return value !== id; }));
    return on;
  }

  function writeOpts() {
    return { idempotencyKey: window.CommonsAPI && window.CommonsAPI.newIdempotencyKey() };
  }

  /* 同一动作失败重试时复用同一个幂等键，成功后丢弃 */
  function keyFor(id) {
    if (!state.keys[id]) state.keys[id] = window.CommonsAPI && window.CommonsAPI.newIdempotencyKey();
    return state.keys[id];
  }
  function dropKey(id) { delete state.keys[id]; }

  function liveError(error, fallback) {
    if (error && (error.status === 501 || error.code === 'capability_unavailable')) return '这个功能还没开放。管理员还没打开。';
    return (error && error.message) || fallback || '没有成功，原数据没有动，可以再试一次。';
  }

  function orgOf(slug) {
    if (isLive() && state.detail && state.detail.slug === slug && state.detail.org) return state.detail.org;
    return (data().orgs || []).find(function (org) { return org.slug === slug; }) || null;
  }

  function myId() {
    var me = window.CommonsSession && window.CommonsSession.me;
    return me && me.id ? String(me.id) : '';
  }
  function dateText(value) { return String(value || '').slice(0, 10); }
  function clip(value, size) {
    var text = String(value == null ? '' : value);
    return text.length > size ? text.slice(0, size) + '…' : text;
  }
  function normOrg(raw) {
    var me = raw.me || {};
    function rows(list, make) { return (Array.isArray(list) ? list : []).map(make); }
    return Object.assign({}, raw, {
      logo: raw.logo || DEFAULT_LOGO,
      banner: raw.banner || DEFAULT_BANNER,
      website: raw.website || '',
      followed: !!raw.followed,
      followers: Number(raw.followers || 0),
      me: { state: me.state || 'none', role: me.role || null },
      membersList: rows(raw.membersList, function (m) {
        return { id: m.id, handle: m.handle || '', name: m.name || m.handle || '成员', level: m.level || 1, avatar: DEFAULT_LOGO, role: m.role };
      }),
      posts: rows(raw.posts, function (post) {
        return { id: post.id, title: post.title, body: post.summary || post.body || '', at: dateText(post.createdAt), author: post.author && post.author.name || '' };
      }),
      works: rows(raw.works, function (work) {
        return { id: work.id, kind: 'work', title: work.title, author: work.author && work.author.name || '', typeLabel: '作品', href: '#/work/' + encodeURIComponent(work.id) };
      }),
      jobs: rows(raw.jobs, function (job) {
        return { id: job.id, kind: 'job', title: job.title || job.position || '招聘', meta: '招聘', href: '#/market' };
      }),
      events: rows(raw.events, function (event) {
        return { id: event.id, kind: 'event', title: event.title || event.name || '活动', meta: '活动', href: '#/events' };
      })
    });
  }
  function isActiveMember(org) { return !!org && !!org.me && org.me.state === 'active'; }
  function isManager(org) { return !!org && !!org.me && org.me.state === 'active' && (org.me.role === 'owner' || org.me.role === 'admin'); }

  /* safe-fn: CommonsLevel 已转义成员字段；回退逐值转义 */
  function nameplate(member) {
    if (window.CommonsLevel && typeof window.CommonsLevel.nameplate === 'function') {
      return window.CommonsLevel.nameplate({ name: member.name, level: member.level, handle: member.handle });
    }
    return '<span class="org-nameplate"><b>' + esc(member.name) + '</b><small>L' + esc(member.level) + ' @' + esc(member.handle) + '</small></span>';
  }

  /* safe-fn: CommonsLinks.person 与 nameplate 都逐值转义 */
  function personLink(member) {
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') {
      return window.CommonsLinks.person(member.handle, member.name, { level: member.level });
    }
    return nameplate(member);
  }

  function objectHref(item) {
    if (window.CommonsLinks && typeof window.CommonsLinks.href === 'function') {
      var target = window.CommonsLinks.href(item.kind, item.id);
      if (target) return safeUrl(target);
    }
    return safeUrl(item.href || '#');
  }

  /* safe-fn: 动态字段逐值转义，图片地址过 safeUrl */
  function orgRow(org) {
    return '<li class="org-row"><a class="org-row-logo" href="#/org/' + esc(encodeURIComponent(org.slug)) +
      '"><img src="' + safeUrl(org.logo) + '" alt="" loading="lazy" width="64" height="64"></a>' +
      '<div class="org-row-main"><div class="org-row-title"><a href="#/org/' + esc(encodeURIComponent(org.slug)) + '"><b>' +
      esc(org.name) + '</b></a>' + (org.verified ? '<span class="org-verified" title="已认证">' + icon('check', 12) + ' 已认证</span>' : '') +
      '</div><p>' + esc(org.intro) + '</p><span>' + esc(org.typeLabel) + ' · ' + esc(compact(org.members)) + ' 位成员</span></div>' +
      '<dl><div><dt>关注</dt><dd>' + esc(compact(org.followers)) + '</dd></div><div><dt>活跃</dt><dd>' + esc(org.activity) + '</dd></div></dl>' +
      '<a class="button ghost small" href="#/org/' + esc(encodeURIComponent(org.slug)) + '">打开 ' + icon('arrow', 14) + '</a></li>';
  }

  function myTeamsView() {
    var viewer = data().viewer || {};
    var teams = teamsFor(viewer.handle);
    if (!teams.length) return '';
    return '<section class="org-my-teams" aria-label="我的团队"><b>我的团队</b><div>' + teams.map(function (org) {
      return '<a href="#/org/' + esc(encodeURIComponent(org.slug)) + '"><img src="' + safeUrl(org.logo) + '" alt="" width="32" height="32"><span>' + esc(org.name) + '</span></a>';
    }).join('') + '</div></section>';
  }

  function canCreate() {
    var session = window.CommonsSession;
    return !isLive() || !session || typeof session.can !== 'function' || session.can('orgs.create');
  }

  /* safe-fn: 按钮与说明文案写死 */
  function createEntry() {
    return baseEntry() + (isLive() ? '<a class="button ghost" href="#/orgs/mine">我的申请</a>' : '');
  }
  function baseEntry() {
    if (canCreate()) return '<button type="button" class="button primary" data-org-act="create">申请建团队</button>';
    var session = window.CommonsSession;
    var why = session && typeof session.reason === 'function' ? session.reason('orgs.create') : '';
    return '<button type="button" class="button primary" data-org-act="create" disabled' + (why ? ' title="' + esc(why) + '"' : '') + '>申请建团队</button>' +
      '<p class="org-live-muted" data-org-locked>' + (why ? esc(why) + (/^需要 L/.test(why) ? '，<a href="#/growth">看看怎么升级</a>' : '') : '你现在的等级还不能建团队，<a href="#/growth">看看怎么升级</a>') + '</p>';
  }

  function filtered() {
    var query = state.query.trim().toLowerCase();
    return data().orgs.filter(function (org) {
      return (state.type === 'all' || org.type === state.type) &&
        (!query || (org.name + ' ' + org.intro + ' ' + org.typeLabel).toLowerCase().indexOf(query) >= 0);
    }).sort(function (a, b) {
      var key = state.sort === 'followers' ? 'followers' : 'activity';
      return b[key] - a[key] || a.name.localeCompare(b.name, 'zh-CN');
    });
  }

  /* safe-fn: 数据字段逐值转义，行 HTML 来自安全视图函数 */
  function directoryPage() {
    if (isLive() && parts()[1] === 'mine') return minePage();
    if (isLive() && state.liveError) {
      if (state.liveError === 'closed') {
        return '<div class="org-page" data-org-root><div class="org-empty" role="status"><h2>这个功能还没开放</h2><p>管理员还没打开。</p></div></div>';
      }
      return '<div class="org-page" data-org-root><div class="org-empty" role="alert"><h2>' + esc(state.liveError) + '</h2><button type="button" class="button" data-org-act="retry">重试</button></div></div>';
    }
    if (isLive() && !state.live) {
      return '<div class="org-page" data-org-root><div class="org-empty"><h2>正在读取团队…</h2></div></div>';
    }
    var rows = filtered();
    var leader = rows[0] || data().orgs[0];
    if (!leader) {
      return '<div class="org-page" data-org-root><header class="org-directory-head"><p>找一群长期一起做事的人。</p><div class="org-directory-actions">' + createEntry() + '</div></header><div class="org-empty"><h2>还没有团队</h2></div>' + createDialog() + '</div>';
    }
    var typeButtons = [{ id: 'all', label: '全部' }].concat(data().types).map(function (item) {
      return '<button type="button" data-org-act="type" data-value="' + esc(item.id) + '" aria-pressed="' +
        esc(String(state.type === item.id)) + '">' + esc(item.label) + '</button>';
    }).join('');
    var list = rows.length ? '<ul class="org-list">' + rows.map(orgRow).join('') + '</ul>' :
      '<div class="org-empty"><h2>没有找到团队</h2><button type="button" class="button" data-org-act="reset">清空筛选</button></div>';
    return '<div class="org-page" data-org-root><header class="org-directory-head"><p>找一群长期一起做事的人。</p><div class="org-directory-actions">' + createEntry() + (isLive() ? '' : '<span class="chip">示例</span>') + '</div></header>' + myTeamsView() +
      '<section class="org-directory-tools" aria-label="团队筛选"><form data-org-search><label class="org-search">' + icon('search', 16) +
      '<span class="sr-only">搜索团队</span><input name="q" type="search" maxlength="80" placeholder="搜索名称或方向" value="' + esc(state.query) + '"></label>' +
      '<button class="button tonal" type="submit">搜索</button></form><div class="segmented org-types" role="group" aria-label="团队类型">' + typeButtons +
      '</div><label class="org-sort">排序<select data-org-sort><option value="activity"' + (state.sort === 'activity' ? ' selected' : '') +
      '>活跃度</option><option value="followers"' + (state.sort === 'followers' ? ' selected' : '') + '>关注数</option></select></label></section>' +
      '<div class="org-directory-layout"><main><div class="org-list-head"><h2>' + esc(String(rows.length)) + ' 个团队</h2><span>公司、实验室、社团与开源项目</span></div>' +
      /* safe: list 由 orgRow 逐值转义 */ list + '</main>' +
      '<aside class="org-spotlight"><div class="org-spotlight-logo"><img src="' + safeUrl(leader.logo) + '" alt=""></div><span>' + esc(leader.typeLabel) + '</span><h2>' + esc(leader.name) +
      '</h2><p>' + esc(leader.intro) + '</p><dl><div><dt>成员</dt><dd>' + esc(compact(leader.members)) + '</dd></div><div><dt>关注</dt><dd>' +
      esc(compact(leader.followers)) + '</dd></div><div><dt>活跃</dt><dd>' + esc(leader.activity) + '</dd></div></dl><a class="button primary" href="#/org/' +
      esc(encodeURIComponent(leader.slug)) + '">查看主页 ' + icon('arrow', 16) + '</a></aside></div>' + createDialog() + '</div>';
  }

  /* safe-fn: 表单选项来自固定示例类型 */
  function createDialog() {
    return '<dialog class="org-create" data-org-dialog><form method="dialog" data-org-create-form><header><div><span>团队申请</span><h2>建一个团队主页</h2></div><button class="button ghost small" value="cancel" aria-label="关闭">关闭</button></header>' +
      '<label class="field"><span>名称</span><input name="name" required maxlength="60"></label><label class="field"><span>简介</span><textarea name="intro" required maxlength="240" rows="3"></textarea></label>' +
      '<div class="org-form-grid"><label class="field"><span>类型</span><select name="type">' + data().types.map(function (item) {
        return '<option value="' + esc(item.id) + '">' + esc(item.label) + '</option>';
      }).join('') + '</select></label><label class="field"><span>加入方式</span><select name="join_policy"><option value="apply">申请加入</option><option value="invite">邀请加入</option></select></label></div>' +
      '<label class="field"><span>官网</span><input name="website" type="url" maxlength="300" placeholder="https://"></label><p data-org-form-status role="status"></p>' +
      '<footer><button class="button" value="cancel">取消</button><button class="button primary" type="submit" value="default">提交申请</button></footer></form></dialog>';
  }

  /* safe-fn: 成员字段逐值转义，personLink 自行转义 */
  function membersView(org) {
    return '<ul class="org-members">' + org.membersList.map(function (member) {
      return '<li><img src="' + safeUrl(member.avatar) + '" alt="" loading="lazy"><div>' + personLink(member) + '<span>' + esc(ROLE_NAMES[member.role]) + '</span></div></li>';
    }).join('') + '</ul>';
  }

  /* safe-fn: 动态字段逐值转义，标题链接通过 CommonsLinks 解析 */
  function postsView(org) {
    if (!org.posts.length) return emptyView('posts');
    return '<ol class="org-posts">' + org.posts.map(function (post) {
      return '<li><time>' + esc(post.at) + '</time><div><h3><a href="' + objectHref(post) + '">' + esc(post.title) + '</a></h3><p>' + esc(post.body) + '</p></div></li>';
    }).join('') + '</ol>';
  }

  function emptyView(kind) {
    var config = {
      posts: { image: 'assets/illus/empty-org.webp', text: '还没有团队动态。', action: '去动态', href: '#/feed' },
      jobs: { image: 'assets/illus/empty-market.webp', text: '暂时没有招聘。', action: '发布招聘', href: '#/market' },
      events: { image: 'assets/illus/empty-events.webp', text: '暂时没有活动。', action: '发起活动', href: '#/events' },
      works: { image: '', text: '还没有公开作品。', action: '浏览作品', href: '#/people' }
    }[kind];
    return '<div class="org-empty' + (config.image ? ' org-empty-illustrated' : '') + '">' +
      (config.image ? '<img src="' + safeUrl(config.image) + '" alt="" width="320" height="240">' : '') +
      '<p>' + esc(config.text) + '</p><a class="button tonal" href="' + safeUrl(config.href) + '">' + esc(config.action) + '</a></div>';
  }

  /* safe-fn: 动态字段逐值转义，链接通过 CommonsLinks 解析 */
  function linkedView(items, kind) {
    if (!items.length) return emptyView(kind);
    return '<ul class="org-linked">' + items.map(function (item) {
      return '<li><a href="' + objectHref(item) + '"><div><span>' + esc(item.typeLabel || item.meta || '') + '</span><h3>' + esc(item.title) + '</h3>' +
        (item.author ? '<p>' + esc(item.author) + '</p>' : '') + '</div>' + icon('arrow', 16) + '</a></li>';
    }).join('') + '</ul>';
  }

  /* safe-fn: 按钮文案写死 */
  function liveJoinButton(org, slug) {
    var st = org.me && org.me.state || 'none';
    var busy = state.busy === 'join' ? ' disabled' : '';
    var label = { active: '已加入', pending: '申请中', invited: '接受邀请', rejected: '重新申请' }[st] || (org.joinPolicy === 'invite' ? '只接受邀请' : '申请加入');
    var off = st === 'active' || st === 'pending' || (st === 'none' && org.joinPolicy === 'invite');
    return '<button type="button" class="button tonal" data-org-act="join" data-value="' + esc(slug) + '"' + (off ? ' disabled' : busy) + '>' + esc(label) + '</button>';
  }

  /* safe-fn: 动态与作品字段逐值转义 */
  function livePostsView(org) {
    var form = isActiveMember(org)
      ? '<form class="org-live-form" data-org-post-form="' + esc(org.slug) + '"><label class="field"><span>标题</span><input name="title" required maxlength="200"></label>' +
        '<label class="field"><span>内容</span><textarea name="body" required maxlength="20000" rows="4"></textarea></label>' +
        '<p data-org-form-status role="status"></p><button class="button primary" type="submit">发布团队动态</button></form>'
      : '';
    var list = org.posts.length
      ? '<ol class="org-posts">' + org.posts.map(function (post) {
        return '<li><time>' + esc(post.at) + '</time><div><h3><a href="#/org/' + esc(encodeURIComponent(org.slug)) + '/post/' + esc(encodeURIComponent(post.id)) + '">' + esc(post.title) + '</a></h3><p>' + esc(clip(post.body, 300)) + '</p>' + (post.author ? '<small>' + esc(post.author) + '</small>' : '') + '</div></li>';
      }).join('') + '</ol>'
      : '<div class="org-empty"><p>还没有团队动态。</p></div>';
    return /* safe: form 与 list 逐值转义 */ form + list;
  }

  /* safe-fn: 作品字段逐值转义 */
  function liveWorksView(org) {
    var attached = {};
    org.works.forEach(function (work) { attached[work.id] = true; });
    var form = '';
    if (isActiveMember(org)) {
      var mine = state.myWorks;
      var options = mine && !mine.loading ? mine.items.filter(function (item) { return !attached[item.id]; }) : [];
      if (!mine || mine.loading) form = '<p class="org-live-muted">正在读取你的作品…</p>';
      else if (mine.error) form = '<p class="org-live-muted" role="alert">' + esc(mine.error) + '</p>';
      else if (!options.length) form = '<p class="org-live-muted">你没有可以挂上来的作品。先去发布一个作品。</p>';
      else form = '<form class="org-live-form" data-org-work-form="' + esc(org.slug) + '"><label class="field"><span>把我的作品挂到团队</span><select name="object_id">' + options.map(function (item) {
        return '<option value="' + esc(item.id) + '">' + esc(item.title || '未命名作品') + '</option>';
      }).join('') + '</select></label><p data-org-form-status role="status"></p><button class="button primary" type="submit">挂到团队</button></form>';
    }
    return /* safe: form 逐值转义 */ form + linkedView(org.works, 'works');
  }

  /* safe-fn: 成员字段逐值转义 */
  function liveMembersView(org) {
    var base = membersView(org);
    if (!isManager(org)) return base;
    var owner = org.me.role === 'owner';
    var me = myId();
    var rows = org.membersList.filter(function (member) { return member.role !== 'owner' && member.id !== me; });
    if (!rows.length) return base;
    return base + '<div class="org-roles"><h3>成员角色</h3>' + (owner ? '' : '<p class="org-live-muted">只有所有者能调整角色。</p>') + rows.map(function (member) {
      return '<form class="org-live-form org-role-form" data-org-role-form="' + esc(org.slug) + '" data-member="' + esc(member.id) + '"><span>' + esc(member.name) + '</span>' +
        '<select name="role" aria-label="' + esc(member.name) + '的角色"' + (owner ? '' : ' disabled') + '><option value="member"' + (member.role === 'member' ? ' selected' : '') + '>成员</option><option value="admin"' + (member.role === 'admin' ? ' selected' : '') + '>管理员</option></select>' +
        '<button class="button small" type="submit"' + (owner ? '' : ' disabled') + '>更新角色</button><span data-org-form-status role="status"></span></form>';
    }).join('') + '</div>';
  }

  var APP_STATUS = { pending: '待审', approved: '已通过', rejected: '已拒绝' };
  var APP_EMPTY = { pending: '没有待审的申请。', approved: '还没有通过的申请。', rejected: '还没有拒绝过的申请。' };

  /* safe-fn: 申请人字段逐值转义，personLink 自行转义 */
  function applicationRow(item, slug, status) {
    var who = personLink({ handle: item.handle || '', name: item.name || '成员', level: item.level || 1 });
    var note = item.note ? '<p class="org-live-muted">申请说明：' + esc(item.note) + '</p>' : '';
    if (status !== 'pending') {
      var result = (status === 'approved' ? '已通过' : '已拒绝') + (item.reviewedAt ? ' · ' + dateText(item.reviewedAt) : '') +
        (item.reviewNote ? ' · ' + item.reviewNote : '');
      return '<li class="org-app"><div class="org-live-form org-role-form"><span>' + who + '</span><span class="org-live-muted">' + esc(result) + '</span></div>' + note + '</li>';
    }
    return '<li class="org-app" data-org-app="' + esc(item.id) + '"><div class="org-live-form org-role-form"><span>' + who +
      ' <small>' + esc(dateText(item.appliedAt)) + '</small></span><input name="note" maxlength="300" placeholder="处理说明（可选）" aria-label="给' + esc(item.name || '申请人') + '的处理说明">' +
      '<button type="button" class="button primary small" data-org-act="app-decide" data-value="approve">通过</button>' +
      '<button type="button" class="button small" data-org-act="app-decide" data-value="reject">拒绝</button>' +
      '<span data-org-form-status role="status"></span></div>' + note + '</li>';
  }

  /* safe-fn: 状态页签写死，申请行逐值转义 */
  function applicationsView(org) {
    var apps = state.apps && state.apps.slug === org.slug ? state.apps : null;
    var status = apps ? apps.status : 'pending';
    var switcher = '<div class="segmented" role="group" aria-label="申请状态">' + Object.keys(APP_STATUS).map(function (key) {
      return '<button type="button" data-org-act="app-status" data-value="' + key + '" aria-pressed="' + String(status === key) + '">' + APP_STATUS[key] + '</button>';
    }).join('') + '</div>';
    if (!apps || apps.loading) return switcher + '<p class="org-live-muted">正在读取申请…</p>';
    if (apps.error) return switcher + '<div class="org-empty" role="alert"><p>' + esc(apps.error) + '</p><button type="button" class="button" data-org-act="apps-retry">重试</button></div>';
    var more = appsMore(apps);
    if (!apps.items.length) return switcher + '<div class="org-empty"><p>' + esc(APP_EMPTY[status]) + '</p></div>' + more;
    return switcher + '<ul class="org-apps">' + apps.items.map(function (item) { return applicationRow(item, org.slug, status); }).join('') + '</ul>' + more;
  }

  function appsMore(apps) {
    if (!apps || (!apps.cursor && !apps.moreError)) return '';
    var note = apps.moreError ? '<p class="org-live-muted" role="alert">' + esc(apps.moreError) + '</p>' : '';
    return note + '<button type="button" class="button" data-org-act="apps-more"' + (apps.moreLoading ? ' disabled' : '') + '>' +
      (apps.moreLoading ? '正在加载…' : '加载更多') + '</button>';
  }

  /* safe-fn: 申请字段逐值转义，链接只指向站内团队主页 */
  function minePage() {
    var head = '<a class="org-back" href="#/orgs">返回团队目录</a><header class="org-directory-head"><p>我提交过的入组申请。</p></header>';
    var mine = state.mine;
    if (!mine || mine.loading) return '<div class="org-page" data-org-root>' + head + '<div class="org-empty"><h2>正在读取申请…</h2></div></div>';
    if (mine.error) return '<div class="org-page" data-org-root>' + head + '<div class="org-empty" role="alert"><h2>' + esc(mine.error) + '</h2><button type="button" class="button" data-org-act="retry">重试</button></div></div>';
    if (!mine.items.length) return '<div class="org-page" data-org-root>' + head + '<div class="org-empty"><h2>还没有申请记录</h2><p>在团队主页点「申请加入」，结果会出现在这里。</p><a class="button tonal" href="#/orgs">去团队目录</a></div></div>';
    return '<div class="org-page" data-org-root>' + head + '<ul class="org-linked">' + mine.items.map(function (item) {
      var line = item.status === 'pending' ? '申请于 ' + dateText(item.appliedAt) :
        (item.status === 'approved' ? '已于 ' + dateText(item.reviewedAt) + ' 通过' : '已于 ' + dateText(item.reviewedAt) + ' 拒绝') +
        (item.reviewNote ? '：' + item.reviewNote : '');
      return '<li><a href="#/org/' + esc(encodeURIComponent(item.slug)) + '"><div><span>' + esc(APP_STATUS[item.status] || item.status) + ' · ' + esc(item.typeLabel) +
        '</span><h3>' + esc(item.name) + '</h3><p>' + esc(line) + '</p>' + (item.note ? '<p>我的说明：' + esc(item.note) + '</p>' : '') + '</div>' + icon('arrow', 16) + '</a></li>';
    }).join('') + '</ul></div>';
  }

  /* safe-fn: 正文先逐值转义再把换行换成段落 */
  function paragraphs(text) {
    return String(text || '').split(/\n{2,}/).filter(function (chunk) { return chunk.trim(); }).map(function (chunk) {
      return '<p>' + esc(chunk.trim()).split('\n').join('<br>') + '</p>';
    }).join('');
  }

  /* safe-fn: 动态字段逐值转义，作者链接由 personLink 转义 */
  function postPage() {
    var slug = decodeURIComponent(parts()[1] || '');
    var id = decodeURIComponent(parts()[3] || '');
    var back = '<a class="org-back" href="#/org/' + esc(encodeURIComponent(slug)) + '">返回团队主页</a>';
    var cur = state.post;
    if (!cur || cur.slug !== slug || cur.id !== id || cur.loading) return '<div class="org-page" data-org-root>' + back + '<div class="org-empty"><h2>正在读取动态…</h2></div></div>';
    if (cur.error === 'notfound') return '<div class="org-page" data-org-root>' + back + '<div class="org-empty"><h2>没有找到这条动态</h2><p>它可能已被删除，或你没有权限查看。</p></div></div>';
    if (cur.error === 'closed') return '<div class="org-page" data-org-root>' + back + '<div class="org-empty" role="status"><h2>这个功能还没开放</h2><p>管理员还没打开。</p></div></div>';
    if (cur.error) return '<div class="org-page" data-org-root>' + back + '<div class="org-empty" role="alert"><h2>' + esc(cur.error) + '</h2><button type="button" class="button" data-org-act="retry">重试</button></div></div>';
    var item = cur.item;
    var author = personLink({ handle: item.author.handle || '', name: item.author.name || '成员', level: item.author.level || 1 });
    var tags = (item.tags || []).map(function (tag) { return '<span class="chip">' + esc(tag) + '</span>'; }).join(' ');
    return '<div class="org-page" data-org-root>' + back + '<article class="org-post-page"><span class="org-live-muted">' + esc(item.org.name) + ' · ' + esc(dateText(item.createdAt)) + ' · </span>' + author +
      '<h1>' + esc(item.title) + '</h1>' + (item.summary ? '<p class="org-live-muted">' + esc(item.summary) + '</p>' : '') + (tags ? '<p>' + tags + '</p>' : '') +
      '<div class="org-post-body">' + paragraphs(item.body) + '</div></article></div>';
  }

  /* safe-fn: 页签内容由各安全视图函数生成 */
  function liveTabContent(org) {
    if (state.tab === 'applications' && !isManager(org)) state.tab = 'posts';
    if (state.tab === 'members') return liveMembersView(org);
    if (state.tab === 'posts') return livePostsView(org);
    if (state.tab === 'works') return liveWorksView(org);
    if (state.tab === 'applications' && isManager(org)) return applicationsView(org);
    if (state.tab === 'jobs') return linkedView(org.jobs, 'jobs');
    return linkedView(org.events, 'events');
  }

  /* safe-fn: 页签内容由各安全视图函数生成 */
  function tabContent(org) {
    if (isLive()) return liveTabContent(org);
    if (state.tab === 'members') return membersView(org);
    if (state.tab === 'posts') return postsView(org);
    if (state.tab === 'works') return linkedView(org.works, 'works');
    if (state.tab === 'jobs') return linkedView(org.jobs, 'jobs');
    return linkedView(org.events, 'events');
  }

  /* safe-fn: 动态字段逐值转义，URL 过 safeUrl，页签内容来自安全函数 */
  function detailPage() {
    if (isLive() && parts()[2] === 'post' && parts()[3]) return postPage();
    var slug = decodeURIComponent(parts()[1] || '');
    var org;
    if (isLive()) {
      var det = state.detail;
      if (!det || det.slug !== slug || det.loading) return '<div class="org-page" data-org-root><div class="org-empty"><h2>正在读取团队…</h2></div></div>';
      if (det.error === 'closed') return '<div class="org-page" data-org-root><div class="org-empty" role="status"><h2>这个功能还没开放</h2><p>管理员还没打开。</p></div></div>';
      if (det.error && det.error !== 'notfound') return '<div class="org-page" data-org-root><a class="org-back" href="#/orgs">返回团队目录</a><div class="org-empty" role="alert"><h2>' + esc(det.error) + '</h2><button type="button" class="button" data-org-act="retry">重试</button></div></div>';
      org = det.org;
    } else org = orgBySlug(slug);
    if (!org) return '<div class="org-page org-empty" data-org-root><h1>没有找到这个团队</h1><a class="button primary" href="#/orgs">返回团队目录</a></div>';
    var followed = isLive() ? !!org.followed : stored('orgs.following').indexOf(slug) >= 0;
    var joined = isLive() ? false : stored('orgs.joined').indexOf(slug) >= 0;
    var tabIds = Object.keys(TAB_NAMES);
    if (isLive() && isManager(org)) tabIds.push('applications');
    var tabs = tabIds.map(function (id) {
      var count = id === 'members' ? org.members : id === 'applications' ? (org.pendingApplications || 0) : (org[id] || []).length;
      return '<button type="button" role="tab" data-org-act="tab" data-value="' + esc(id) + '" aria-selected="' +
        esc(String(state.tab === id)) + '">' + esc(id === 'applications' ? '入组申请' : TAB_NAMES[id]) + ' <span>' + esc(compact(count)) + '</span></button>';
    }).join('');
    return '<div class="org-page" data-org-root><a class="org-back" href="#/orgs">返回团队目录</a><header class="org-hero"><div class="org-hero-image"><img src="' +
      safeUrl(org.banner) + '" alt="">' + (isLive() ? '' : '<span class="chip">示例</span>') + '</div><div class="org-hero-main"><div><span>' + esc(org.typeLabel) + '</span><h1>' + esc(org.name) +
      (org.verified ? '<span class="org-verified" title="已认证">' + icon('check', 13) + ' 已认证</span>' : '') + '</h1><p>' + esc(org.intro) + '</p></div><div class="org-hero-actions"><button type="button" class="button primary" data-org-act="follow" data-value="' + esc(slug) + '" aria-pressed="' + esc(String(followed)) + '">' +
      (followed ? '已关注' : '关注') + '</button>' + (isLive() ? liveJoinButton(org, slug) : '<button type="button" class="button tonal" data-org-act="join" data-value="' + esc(slug) + '"' +
      (org.joinPolicy === 'invite' && !joined ? ' disabled title="只接受邀请"' : '') + '>' + (joined ? '已申请' : (org.joinPolicy === 'invite' ? '邀请加入' : '申请加入')) + '</button>') + '</div></div>' +
      '<dl class="org-stats"><div><dt>成员</dt><dd>' + esc(compact(org.members)) + '</dd></div><div><dt>关注</dt><dd>' + esc(compact(isLive() ? org.followers : org.followers + (followed ? 1 : 0))) +
      '</dd></div><div><dt>本月活跃</dt><dd>' + esc(org.activity) + '</dd></div></dl></header>' +
      '<div class="org-detail-layout"><main><nav class="tabs org-tabs" role="tablist" aria-label="团队内容">' + tabs + '</nav><section class="org-tab-panel" role="tabpanel">' +
      /* safe: tabContent 由安全视图函数生成 */ tabContent(org) + '</section></main><aside class="org-profile"><h2>团队资料</h2><dl><div><dt>类型</dt><dd>' + esc(org.typeLabel) + '</dd></div><div><dt>加入</dt><dd>' +
      esc(org.joinPolicy === 'apply' ? '申请后审核' : '成员邀请') + '</dd></div>' + (isLive() && !org.website ? '' : '<div><dt>官网</dt><dd><a href="' + safeUrl(org.website) + '" target="_blank" rel="noopener noreferrer">访问官网 ' + icon('external', 14) +
      '</a></dd></div>') + '</dl><h2>管理员</h2><div class="org-admins">' + membersView({ membersList: org.membersList.filter(function (member) { return member.role !== 'member'; }) }) +
      '</div></aside></div></div>';
  }

  function refresh() { if (C().refresh) C().refresh(); }

  function liveFollow(button, slug) {
    if (state.busy || !window.CommonsAPI) return;
    var org = orgOf(slug);
    if (!org) return;
    var next = !org.followed;
    state.busy = 'follow'; state.notice = '';
    button.disabled = true;
    window.CommonsAPI.post('/orgs/' + encodeURIComponent(slug) + '/follow', { on: next }, writeOpts()).then(function (response) {
      var result = response && response.data || {};
      org.followed = !!result.followed;
      if (result.followers != null) org.followers = Number(result.followers);
      state.busy = '';
      if (C().toast) C().toast(org.followed ? '已关注这个团队。' : '已取消关注。');
      refresh();
    }).catch(function (error) {
      state.busy = '';
      button.disabled = false;
      if (C().toast) C().toast(liveError(error, '关注没有改成。原状态没有变化。'));
    });
  }

  function liveJoin(button, slug) {
    if (state.busy || !window.CommonsAPI) return;
    var org = orgOf(slug);
    if (!org) return;
    state.busy = 'join';
    button.disabled = true;
    window.CommonsAPI.post('/orgs/' + encodeURIComponent(slug) + '/join', { note: '' }, writeOpts()).then(function (response) {
      var result = response && response.data || {};
      org.me = { state: result.state || 'pending', role: result.role || null };
      state.busy = '';
      state.mine = null;
      if (C().toast) C().toast(org.me.state === 'active' ? '已加入团队。' : '申请已提交，等待管理员处理。');
      refresh();
      if (org.me.state === 'active') loadDetail(slug, true);
    }).catch(function (error) {
      state.busy = '';
      button.disabled = false;
      if (C().toast) C().toast(liveError(error, '申请没有提交。原状态没有变化。'));
    });
  }

  function formStatus(form, message) {
    var host = form.querySelector('[data-org-form-status]');
    if (host) host.textContent = message;
  }

  function liveSubmitPost(form) {
    var slug = form.dataset.orgPostForm;
    var values = Object.fromEntries(new FormData(form).entries());
    var title = String(values.title || '').trim();
    var body = String(values.body || '').trim();
    if (!title || !body) { formStatus(form, '标题和内容都要写。'); return; }
    var submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    formStatus(form, '');
    window.CommonsAPI.post('/orgs/' + encodeURIComponent(slug) + '/posts', { title: title, body: body }, writeOpts()).then(function () {
      if (C().toast) C().toast('团队动态已发布。');
      loadDetail(slug, true);
    }).catch(function (error) {
      if (submit) submit.disabled = false;
      formStatus(form, liveError(error, '动态没有发布。原内容还在表单里。'));
    });
  }

  function liveSubmitWork(form) {
    var slug = form.dataset.orgWorkForm;
    var objectId = String(new FormData(form).get('object_id') || '');
    if (!objectId) { formStatus(form, '先选一个作品。'); return; }
    var submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    formStatus(form, '');
    window.CommonsAPI.post('/orgs/' + encodeURIComponent(slug) + '/works/' + encodeURIComponent(objectId), {}, writeOpts()).then(function () {
      if (C().toast) C().toast('作品已挂到团队。');
      loadDetail(slug, true);
    }).catch(function (error) {
      if (submit) submit.disabled = false;
      formStatus(form, liveError(error, '作品没有挂上。'));
    });
  }

  function liveSubmitRole(form) {
    var slug = form.dataset.orgRoleForm;
    var member = form.dataset.member;
    var role = String(new FormData(form).get('role') || 'member');
    var submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    formStatus(form, '');
    window.CommonsAPI.post('/orgs/' + encodeURIComponent(slug) + '/members/' + encodeURIComponent(member) + '/role', { role: role, state: 'active' }, writeOpts()).then(function () {
      if (C().toast) C().toast('角色已更新。');
      loadDetail(slug, true);
    }).catch(function (error) {
      if (submit) submit.disabled = false;
      formStatus(form, liveError(error, '角色没有改成。原角色没有变化。'));
    });
  }

  function loadApps(slug, status, more) {
    if (!isLive() || !window.CommonsAPI || !slug) return;
    var nextStatus = status || 'pending';
    var apps = state.apps;
    var same = apps && apps.slug === slug && apps.status === nextStatus;
    if (more && same) {
      if (!apps.cursor || apps.moreLoading) return;
      apps.moreLoading = true;
      apps.moreError = '';
    } else {
      apps = state.apps = { slug: slug, status: nextStatus, items: [], cursor: '', loading: true, moreLoading: false, error: '', moreError: '' };
    }
    var query = { status: apps.status, limit: 20 };
    if (more && apps.cursor) query.cursor = apps.cursor;
    window.CommonsAPI.get('/orgs/' + encodeURIComponent(slug) + '/applications', query).then(function (response) {
      if (state.apps !== apps) return;
      var payload = response && response.data;
      var rows = Array.isArray(payload) ? payload : (payload && payload.items) || [];
      apps.items = more ? apps.items.concat(rows) : rows;
      apps.cursor = (response && response.meta && response.meta.cursor) || '';
      apps.loading = false;
      apps.moreLoading = false;
      refresh();
    }).catch(function (error) {
      if (state.apps !== apps) return;
      apps.loading = false;
      apps.moreLoading = false;
      if (more && apps.items.length) apps.moreError = liveError(error, '后面的申请没有载入，可以再试一次。');
      else apps.error = liveError(error, '申请没有载入。');
      refresh();
    });
  }

  function loadMine() {
    if (!isLive() || !window.CommonsAPI) return;
    var mine = state.mine = { items: [], loading: true, error: '' };
    window.CommonsAPI.get('/orgs/mine/applications').then(function (response) {
      if (state.mine !== mine) return;
      var payload = response && response.data;
      mine.items = Array.isArray(payload) ? payload : (payload && payload.items) || [];
      mine.loading = false;
      refresh();
    }).catch(function (error) {
      if (state.mine !== mine) return;
      mine.loading = false;
      mine.error = liveError(error, '申请记录没有载入。');
      refresh();
    });
  }

  function loadPost(slug, id) {
    if (!isLive() || !window.CommonsAPI || !slug || !id) return;
    var cur = state.post = { slug: slug, id: id, item: null, error: '', loading: true };
    window.CommonsAPI.get('/orgs/' + encodeURIComponent(slug) + '/posts/' + encodeURIComponent(id)).then(function (response) {
      if (state.post !== cur) return;
      var item = response && response.data || {};
      cur.item = Object.assign({ tags: [], summary: '', body: '' }, item, { org: item.org || { slug: slug, name: '' }, author: item.author || {} });
      cur.loading = false;
      refresh();
    }).catch(function (error) {
      if (state.post !== cur) return;
      cur.loading = false;
      cur.error = error && error.status === 404 ? 'notfound' : ((error && (error.status === 501 || error.code === 'capability_unavailable')) ? 'closed' : ((error && error.message) || '动态没有载入'));
      refresh();
    });
  }

  function liveDecide(button) {
    var row = button.closest('[data-org-app]');
    if (!row || state.busy || !window.CommonsAPI) return;
    var slug = decodeURIComponent(parts()[1] || '');
    var pid = row.dataset.orgApp;
    var decision = button.dataset.value === 'reject' ? 'reject' : 'approve';
    var input = row.querySelector('input[name="note"]');
    var note = input ? String(input.value || '').trim() : '';
    var keyId = 'app:' + slug + ':' + pid + ':' + decision + ':' + note;
    var buttons = row.querySelectorAll('button');
    function lock(off) { buttons.forEach(function (b) { b.disabled = off; }); }
    state.busy = 'app';
    lock(true);
    formStatus(row, '');
    window.CommonsAPI.post('/orgs/' + encodeURIComponent(slug) + '/applications/' + encodeURIComponent(pid) + '/review',
      { decision: decision, note: note }, { idempotencyKey: keyFor(keyId) }).then(function () {
      dropKey(keyId);
      state.busy = '';
      var org = orgOf(slug);
      if (org && org.pendingApplications) org.pendingApplications -= 1;
      if (state.apps && state.apps.slug === slug) state.apps.items = state.apps.items.filter(function (item) { return item.id !== pid; });
      if (C().toast) C().toast(decision === 'approve' ? '已通过这条申请，申请人会收到结果。' : '已拒绝这条申请。');
      refresh();
      loadDetail(slug, true);
    }).catch(function (error) {
      state.busy = '';
      lock(false);
      if (error && error.status === 409) { dropKey(keyId); loadApps(slug, 'pending'); }
      formStatus(row, liveError(error, '没有处理成功，申请还在待审里，可以再试一次。'));
    });
  }

  function onClick(event) {
    var button = event.target.closest('[data-org-act]');
    if (!button) return;
    var action = button.dataset.orgAct;
    var value = button.dataset.value || '';
    if (action === 'retry') {
      if (isLive() && parts()[0] === 'org' && parts()[2] === 'post') loadPost(decodeURIComponent(parts()[1] || ''), decodeURIComponent(parts()[3] || ''));
      else if (isLive() && parts()[0] === 'org') loadDetail(decodeURIComponent(parts()[1] || ''));
      else if (isLive() && parts()[1] === 'mine') loadMine();
      else loadLive();
      return;
    }
    if (action === 'app-status') { loadApps(decodeURIComponent(parts()[1] || ''), value); refresh(); return; }
    if (action === 'apps-retry') { loadApps(decodeURIComponent(parts()[1] || ''), state.apps && state.apps.status || 'pending'); refresh(); return; }
    if (action === 'apps-more') { loadApps(decodeURIComponent(parts()[1] || ''), state.apps && state.apps.status || 'pending', true); refresh(); return; }
    if (action === 'app-decide') { liveDecide(button); return; }
    if (action === 'type') { state.type = value; refresh(); return; }
    if (action === 'reset') { state.type = 'all'; state.query = ''; refresh(); return; }
    if (action === 'tab') { state.tab = value; refresh(); return; }
    if (action === 'follow') {
      if (isLive()) { liveFollow(button, value); return; }
      var on = toggleStored('orgs.following', value);
      if (C().toast) C().toast(on ? '已关注这个团队。' : '已取消关注。');
      refresh(); return;
    }
    if (action === 'join') {
      if (isLive()) { liveJoin(button, value); return; }
      var applied = toggleStored('orgs.joined', value);
      if (C().toast) C().toast(applied ? '申请已提交，等待管理员处理。' : '已撤回本机申请。');
      refresh(); return;
    }
    if (action === 'create') {
      if (button.disabled || !canCreate()) return;
      var dialog = state.root && state.root.querySelector('[data-org-dialog]');
      if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
    }
  }
  function onSubmit(event) {
    if (event.target.matches('[data-org-search]')) {
      event.preventDefault(); state.query = String(new FormData(event.target).get('q') || '').trim(); refresh(); return;
    }
    if (isLive()) {
      if (event.target.matches('[data-org-post-form]')) { event.preventDefault(); liveSubmitPost(event.target); return; }
      if (event.target.matches('[data-org-work-form]')) { event.preventDefault(); liveSubmitWork(event.target); return; }
      if (event.target.matches('[data-org-role-form]')) { event.preventDefault(); liveSubmitRole(event.target); return; }
    }
    if (!event.target.matches('[data-org-create-form]')) return;
    event.preventDefault();
    var form = event.target;
    var values = Object.fromEntries(new FormData(form).entries());
    var safe = safeUrl(values.website || '');
    if (values.website && safe === '#') {
      form.querySelector('[data-org-form-status]').textContent = '官网只接受 http 或 https 地址。'; return;
    }
    if (isLive()) {
      if (!window.CommonsAPI) return;
      var submit = form.querySelector('[type="submit"]');
      if (submit) submit.disabled = true;
      window.CommonsAPI.post('/orgs', {
        name: String(values.name || '').trim(),
        intro: String(values.intro || '').trim(),
        type: values.type,
        website: String(values.website || ''),
        join_policy: values.join_policy || 'apply'
      }, writeOpts()).then(function (response) {
        if (submit) submit.disabled = false;
        if (form.closest('dialog')) form.closest('dialog').close();
        if (C().toast) C().toast('申请已提交，治理员审核通过后会出现在团队目录里。');
        state.live = null;
        loadLive();
      }).catch(function (error) {
        if (submit) submit.disabled = false;
        var host = form.querySelector('[data-org-form-status]');
        if (host) host.textContent = liveError(error, '申请没有提交。原内容还在表单里。');
        if (C().toast) C().toast(liveError(error, '申请没有提交。原内容还在表单里。'));
      });
      return;
    }
    var rows = stored('orgs.applications');
    rows.push({ name: values.name, intro: values.intro, type: values.type, website: values.website, joinPolicy: values.join_policy, at: new Date().toISOString() });
    if (C().write) C().write('orgs.applications', rows);
    if (C().toast) C().toast('申请已保存，等待治理员审核。');
    if (form.closest('dialog')) form.closest('dialog').close();
  }
  function onChange(event) {
    if (!event.target.matches('[data-org-sort]')) return;
    state.sort = event.target.value === 'followers' ? 'followers' : 'activity'; refresh();
  }
  function on(target, type, handler) {
    target.addEventListener(type, handler);
    state.unbind.push(function () { target.removeEventListener(type, handler); });
  }

  function loadLive() {
    if (!isLive() || !window.CommonsAPI || state.liveLoading || parts()[0] === 'org' || parts()[1] === 'mine') return;
    state.liveLoading = true;
    state.liveError = '';
    window.CommonsAPI.get('/orgs').then(function (response) {
      var payload = response && response.data;
      var orgs = Array.isArray(payload) ? payload : (payload && payload.items) || [];
      var meta = response && response.meta || {};
      state.live = { label: '', types: meta.types || (payload && payload.types) || [], orgs: orgs.map(normOrg) };
      state.liveLoading = false;
      refresh();
    }).catch(function (error) {
      state.live = null;
      state.liveLoading = false;
      state.liveError = (error && (error.status === 501 || error.code === 'capability_unavailable')) ? 'closed' : ((error && error.message) || '团队没有载入');
      refresh();
    });
  }

  function loadDetail(slug, quiet) {
    if (!isLive() || !window.CommonsAPI || !slug) return;
    var prior = state.detail && state.detail.slug === slug ? state.detail : null;
    if (!quiet && prior && prior.loading) return;
    var det = state.detail = { slug: slug, org: quiet && prior ? prior.org : null, error: '', loading: !quiet || !prior };
    if (!quiet) state.myWorks = null;
    window.CommonsAPI.get('/orgs/' + encodeURIComponent(slug)).then(function (response) {
      if (state.detail !== det) return;
      det.org = normOrg(response && response.data || {});
      det.loading = false;
      if (quiet) state.myWorks = null;
      refresh();
    }).catch(function (error) {
      if (state.detail !== det) return;
      det.loading = false;
      if (quiet && det.org) { if (C().toast) C().toast(liveError(error, '团队没有刷新。')); refresh(); return; }
      det.error = error && error.status === 404 ? 'notfound' : ((error && (error.status === 501 || error.code === 'capability_unavailable')) ? 'closed' : ((error && error.message) || '团队没有载入'));
      refresh();
    });
  }

  function loadMyWorks() {
    var me = myId();
    if (!isLive() || !window.CommonsAPI || !me || (state.myWorks && state.myWorks.loading)) return;
    var mine = state.myWorks = { items: [], loading: true, error: '' };
    window.CommonsAPI.get('/objects', { type: 'work', author_id: me, limit: 50 }).then(function (response) {
      if (state.myWorks !== mine) return;
      mine.items = Array.isArray(response && response.data) ? response.data : [];
      mine.loading = false;
      refresh();
    }).catch(function (error) {
      if (state.myWorks !== mine) return;
      mine.loading = false;
      mine.error = liveError(error, '你的作品没有载入。');
      refresh();
    });
  }

  function sessionAccount() { return myId(); }
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('commons:session', function () {
      var next = sessionAccount();
      if (next === state.account) return;
      state.account = next;
      state.live = null; state.liveError = ''; state.liveLoading = false;
      state.detail = null; state.myWorks = null; state.busy = ''; state.apps = null; state.mine = null; state.post = null; state.keys = {};
      if (isLive() && state.root) refresh();
    });
  }
  state.account = sessionAccount();

  function mount() {
    destroy();
    var onMine = parts()[0] === 'orgs' && parts()[1] === 'mine';
    var onPost = parts()[0] === 'org' && parts()[2] === 'post' && !!parts()[3];
    if (!onMine) state.mine = null;
    if (!onPost) state.post = null;
    if (parts()[0] !== 'org') state.apps = null;
    state.root = document.querySelector('[data-org-root]');
    if (!state.root) return;
    if (isLive() && !state.live && !state.liveError && !state.liveLoading) loadLive();
    if (isLive() && onMine && !state.mine) loadMine();
    if (isLive() && onPost) {
      var pslug = decodeURIComponent(parts()[1] || '');
      var pid = decodeURIComponent(parts()[3] || '');
      if (!state.post || state.post.slug !== pslug || state.post.id !== pid) loadPost(pslug, pid);
    } else if (isLive() && parts()[0] === 'org') {
      var slug = decodeURIComponent(parts()[1] || '');
      if (!state.detail || state.detail.slug !== slug) loadDetail(slug);
      else if (state.tab === 'works' && state.detail.org && isActiveMember(state.detail.org) && !state.myWorks) loadMyWorks();
      else if (state.tab === 'applications' && state.detail.org && isManager(state.detail.org) && (!state.apps || state.apps.slug !== slug)) loadApps(slug, 'pending');
    }
    on(document, 'click', onClick); on(document, 'submit', onSubmit); on(document, 'change', onChange);
  }
  function destroy() {
    state.unbind.forEach(function (off) { off(); });
    state.unbind = []; state.root = null;
  }

  window.CommonsOrgs = {
    routes: { orgs: directoryPage, org: detailPage },
    hub: ['orgs'],
    nav: [['orgs', '团队', 'people', 'projects']],
    icons: { people: OWN_ICON_PATHS.people },
    titles: { orgs: '团队', org: '团队主页' },
    mount: mount,
    destroy: destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsOrgs);
  if (window.CommonsLinks && typeof window.CommonsLinks.provide === 'function') {
    window.CommonsLinks.provide('org', function (handle) {
      var teams = teamsFor(handle);
      if (!teams.length) return null;
      return {
        label: '团队',
        href: '#/org/' + encodeURIComponent(teams[0].slug),
        count: teams.length,
        icon: 'people'
      };
    });
  }
})();

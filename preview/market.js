/* R13 MARKET-1 · 闲置与线索市集。路由 #/market、#/market/<id>、#/market/new、#/market/mine。
   只提供线索，不碰钱：交易在站外进行。示例数据在 market-sample.js，页首只标一次「示例」。
   演示模式把发布和状态写进 Commons.read/write；live 接口在 server/modules/market/，前端接线时再接。 */
(function () {
  'use strict';

  const TONE = { sell: 3, buy: 1, collab: 2, jobs: 5, groupbuy: 7, free: 4 };
  const CATEGORY_ASSET = {
    sell: 'assets/game/market-cat-used.webp', buy: 'assets/game/market-cat-wanted.webp',
    collab: 'assets/game/market-cat-gigs.webp', jobs: 'assets/game/market-cat-jobs.webp',
    groupbuy: 'assets/game/market-cat-group-buy.webp', free: 'assets/game/market-cat-free.webp'
  };
  const FIELD_KEYS = ['condition', 'price', 'city', 'shipping', 'budget', 'cycle',
    'company', 'position', 'work_mode', 'target', 'deadline'];
  const PLACEHOLDER = {
    price: '¥300 / 可议 / 免费',
    city: '城市',
    shipping: '可邮寄 / 仅同城 / 面交',
    condition: '九成新',
    budget: '预算或范围',
    cycle: '2 周',
    company: '公司或团队',
    position: '岗位',
    work_mode: '远程 / 坐班 / 混合',
    target: '拼几人或拼什么',
    deadline: '11.05'
  };
  const LIMIT = { 1: 1, 2: 3, 3: 5, 4: 8, 5: 10 };

  const FORBIDDEN = [
    [/(账号|帐号|账户|游戏号|社交号|邮箱号).{0,12}(买卖|出售|收购|转让|出租|租用|交易|共享)|(买卖|出售|收购|转让|出租|租用|交易|共享).{0,12}(账号|帐号|账户|游戏号|社交号|邮箱号)/i, '账号买卖'],
    [/(api\s*key|apikey|密钥|令牌|token|兑换码|激活码).{0,12}(出售|转售|倒卖|转让|出租|租用)/i, 'API key 转售'],
    [/(破解版|破解软件|注册机|激活工具|keygen|crack|绿色版|去限制版)/i, '破解软件'],
    [/(代充|代付|洗钱|刷单|接码|养号|黑产|灰产|博彩|赌博|色情|外挂|私彩|代开发票|代实名)|(银行卡|信用卡|身份证|实名).{0,8}(出售|出租|买卖|代办)|(出售|出租|买卖|代办).{0,8}(银行卡|信用卡|身份证|实名)/i, '灰产代充']
  ];

  const MAX_PHOTOS = 6;
  const PAGE = 50;

  const state = {
    root: null,
    category: 'all',
    q: '',
    view: 'all',
    step: 1,
    draft: {},
    photos: [],
    photoSeq: 0,
    photoIndex: 0,
    reportId: '',
    error: '',
    fieldErrors: {},
    focusAfter: '',
    selectedId: '',
    unbind: [],
    live: null,
    liveError: '',
    liveLoading: false,
    cursor: '',
    moreBusy: false,
    mine: { rows: null, cursor: '', loading: false, error: '' },
    busy: false,
    publishKey: { sig: '', key: '' }
  };

  function isLive() {
    return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live');
  }

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));

  /* safe-fn: CommonsLinks.person 按接口约定转义；本地退路对名字 esc、handle encodeURIComponent。 */
  function personLink(person) {
    const p = person || {};
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') {
      return window.CommonsLinks.person(p.handle, p.name, { level: p.level });
    }
    return p.handle ? `<a class="lk-person" href="#/u/${encodeURIComponent(p.handle)}">${esc(p.name)}</a>` : esc(p.name);
  }

  /* safe-fn: CommonsLinks.a 按接口约定转义；本地退路逐值 esc/encodeURIComponent。 */
  function marketLink(id, label, cls) {
    if (window.CommonsLinks && typeof window.CommonsLinks.a === 'function') return window.CommonsLinks.a('market', id, label, cls);
    return id ? `<a${cls ? ` class="${esc(cls)}"` : ''} href="#/market/${encodeURIComponent(id)}">${esc(label)}</a>` : esc(label);
  }

  /* safe-fn: CommonsLinks.a 按接口约定转义；无共用模块时只返回 esc 后的纯文字。 */
  function orgLink(slug, label) {
    if (window.CommonsLinks && typeof window.CommonsLinks.a === 'function') return window.CommonsLinks.a('org', slug, label);
    return esc(label);
  }

  const safeUrl = value => {
    if (window.Commons && typeof window.Commons.safeUrl === 'function') return window.Commons.safeUrl(value);
    const raw = String(value == null ? '' : value).trim();
    return raw.indexOf('#/') === 0 || raw.indexOf('assets/') === 0 ? esc(raw) : '#';
  };

  const icon = name => (window.Commons && typeof window.Commons.icon === 'function' ? window.Commons.icon(name) : '');

  const read = (key, fallback) => {
    if (window.Commons && typeof window.Commons.read === 'function') return window.Commons.read('market.' + key, fallback);
    return fallback;
  };

  const write = (key, value) => {
    if (window.Commons && typeof window.Commons.write === 'function') return window.Commons.write('market.' + key, value);
    return false;
  };

  const toast = message => {
    if (window.Commons && typeof window.Commons.toast === 'function') window.Commons.toast(message);
  };

  function writeOpts() {
    return { idempotencyKey: window.CommonsAPI && window.CommonsAPI.newIdempotencyKey() };
  }

  function liveError(error, fallback) {
    var code = error && error.code;
    if (code === 'capability_unavailable' || (error && error.status === 501)) return '这个功能还没开放。管理员还没打开。';
    if (code === 'market_daily_limit') return (error && error.message) || '今天的发布次数用完了';
    if (code === 'market_forbidden') return (error && error.message) || '这个品类不能在市集发布';
    return (error && error.message) || fallback || '没有成功，原数据没有动，可以再试一次。';
  }

  function livePost(path, body, key) {
    return window.CommonsAPI.post(path, body || {}, key ? { idempotencyKey: key } : writeOpts());
  }

  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  function sample() {
    const empty = { people: [], categories: [], fieldLabels: {}, statusLabels: {}, reportReasons: [], listings: [], comments: {} };
    if (isLive()) return state.live || empty;
    return window.COMMONS_MARKET_SAMPLE || empty;
  }

  function routeParts() {
    return location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  }

  function me() {
    const base = sample().people.find(person => person.id === 'me') || { id: 'me', name: '我', level: 3 };
    const identity = window.CommonsMember && typeof window.CommonsMember.identity === 'function'
      ? window.CommonsMember.identity() : null;
    return {
      id: 'me',
      name: identity && identity.hasProfile && identity.name ? identity.name : base.name,
      level: base.level,
      handle: base.handle || '',
      initial: identity && identity.initial ? identity.initial : '我'
    };
  }

  function author(id) {
    if (id === 'me') {
      const mine = me();
      return { id: 'me', name: mine.name, level: mine.level, handle: mine.handle };
    }
    return sample().people.find(person => person.id === id) || { id, name: id, level: 1 };
  }

  /* safe-fn: 返回头像 HTML；me 分支逐值转义，其余由 Commons.avatar 转义 */
  function avatar(id, size) {
    if (id === 'me') {
      return `<span class="mt-ava mt-ava-me" aria-hidden="true">${esc(me().initial)}</span>`;
    }
    if (window.Commons && typeof window.Commons.avatar === 'function') {
      return window.Commons.avatar(id, size || 'small');
    }
    return `<span class="mt-ava" aria-hidden="true">${esc(author(id).name.slice(0, 1))}</span>`;
  }

  function category(id) {
    return sample().categories.find(item => item.id === id) || sample().categories[0] ||
      { id, label: id, active: id, glyph: 'spark', fields: [], required: [] };
  }

  function statusLabel(listing) {
    if (listing.status === 'active') return category(listing.category).active;
    return sample().statusLabels[listing.status] || listing.status;
  }

  function priceLabel(listing) {
    if (listing.category === 'buy') return listing.budget ? `预算 ${listing.budget}` : '预算面议';
    if (listing.category === 'collab') return listing.budget ? `预算 ${listing.budget}` : '预算面议';
    if (listing.category === 'jobs') return '薪资面议';
    return listing.price || '面议';
  }

  function relTime(value) {
    const time = Date.parse(value);
    if (!time) return '';
    const diff = Math.max(0, Date.now() - time);
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 7 * 86400 * 1000) return `${Math.floor(diff / 86400000)} 天前`;
    const date = new Date(time);
    return `${date.getMonth() + 1}.${String(date.getDate()).padStart(2, '0')}`;
  }

  function metaLine(listing) {
    const bits = [];
    if (listing.category === 'groupbuy') {
      if (listing.deadline) bits.push(`截止 ${listing.deadline}`);
    } else if (listing.category === 'collab') {
      if (listing.cycle) bits.push(listing.cycle);
    } else {
      if (listing.city) bits.push(listing.city);
      if (listing.category === 'jobs' && listing.work_mode) bits.push(listing.work_mode);
    }
    if (listing.createdAt) bits.push(relTime(listing.createdAt));
    return bits.join(' · ');
  }

  function localPosts() {
    const rows = read('posts', []);
    return Array.isArray(rows) ? rows : [];
  }

  function overrides() {
    const rows = read('statusOverrides', {});
    return rows && typeof rows === 'object' ? rows : {};
  }

  function allListings() {
    if (isLive()) return (sample().listings || []).slice();
    const over = overrides();
    return [
      ...localPosts(),
      ...sample().listings.map(item => ({ ...item, ...(over[item.id] || {}) }))
    ];
  }

  function findListing(id) {
    return allListings().find(item => item.id === id) || null;
  }

  function isMine(listing) {
    if (!listing) return false;
    if (listing.mine === true) return true;
    var author = listing.author;
    if (author && typeof author === 'object') return author.id === 'me';
    return author === 'me';
  }

  function baseRows() {
    if (isLive() && state.view === 'mine') return (state.mine.rows || []).slice();
    return allListings().filter(item => state.view !== 'mine' || isMine(item));
  }

  function moreCursor() {
    if (!isLive()) return '';
    return state.view === 'mine' ? state.mine.cursor : state.cursor;
  }

  function moreHTML() {
    if (isLive() && state.view === 'mine' && state.mine.error) {
      return `<p class="mt-more-note" role="alert">${esc(state.mine.error)}</p><div class="mt-more"><button type="button" class="button" data-mt-act="more">重试</button></div>`;
    }
    if (!moreCursor()) return '';
    return `<div class="mt-more"><button type="button" class="button" data-mt-act="more"${state.moreBusy ? ' disabled' : ''}>${state.moreBusy ? '正在读取…' : '加载更多'}</button></div>`;
  }

  function filtered() {
    const needle = state.q.trim().toLowerCase();
    return baseRows()
      .filter(item => state.category === 'all' || item.category === state.category)
      .filter(item => {
        if (!needle) return true;
        return [item.title, item.body, item.city, item.company, item.position, item.target, item.price, item.budget]
          .join(' ').toLowerCase().includes(needle);
      })
      .sort((a, b) => {
        const rank = { active: 0, reserved: 1, sold: 2, expired: 3 };
        const byStatus = (rank[a.status] || 0) - (rank[b.status] || 0);
        if (byStatus) return byStatus;
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      });
  }

  function photoCount(listing) {
    return Math.max(1, Number(listing.photos) || (listing.imageUrls || []).length || 1);
  }

  function listingAsset(listing) {
    const match = /^mk(\d+)$/.exec(String(listing.id || ''));
    if (!match) return '';
    const index = ((Number(match[1]) - 1) % 12) + 1;
    return 'assets/game/market-item-' + index + '.webp';
  }

  /* safe-fn: 图片地址过 safeUrl，占位块只有写死的 class 与转义标签 */
  function coverHTML(listing, large) {
    const art = listingAsset(listing);
    const urls = art ? [art] : (Array.isArray(listing.imageUrls) ? listing.imageUrls.filter(Boolean) : []);
    if (urls.length) {
      return `<img class="mt-cover-img${large ? ' is-large' : ''}" src="${safeUrl(urls[0])}" alt="" loading="lazy" decoding="async" width="800" height="600">`;
    }
    const cat = category(listing.category);
    return `<span class="mt-ph${large ? ' is-large' : ''}" data-tone="${esc(String(TONE[listing.category] || 10))}" aria-hidden="true">
      <span class="mt-ph-glyph">${icon(cat.glyph)}</span>
      <b>${esc(cat.label)}</b>
      ${large ? `<small>${esc(String(photoCount(listing)))} 张图</small>` : ''}
    </span>`;
  }

  /* safe-fn: 所有字段逐值转义，头像与图标由安全函数返回 */
  function cardHTML(listing) {
    const cat = category(listing.category);
    const seller = author(listing.author);
    return `<article class="mt-card" data-status="${esc(listing.status)}">
      <span class="mt-card-cover">${coverHTML(listing, false)}</span>
      <span class="mt-card-body">
        <span class="mt-card-top"><b class="mt-price">${esc(priceLabel(listing))}</b><span class="mt-status" data-status="${esc(listing.status)}">${esc(statusLabel(listing))}</span></span>
        <span class="mt-card-title">${marketLink(listing.id, listing.title, 'mt-card-link')}</span>
        <span class="mt-card-meta">${esc(metaLine(listing))}</span>
        <span class="mt-card-author">${avatar(listing.author, 'tiny')}<span>${personLink(seller)}</span><small>L${esc(String(seller.level))}</small></span>
        <span class="mt-card-cat">${esc(cat.label)}</span>
        ${marketLink(listing.id, '查看详情', 'button tonal mt-card-action')}
      </span>
    </article>`;
  }

  function emptyHTML(message, cta) {
    return `<div class="mt-empty"><p>${esc(message)}</p><a class="button" href="#/market/new">${esc(cta || '发布')}</a></div>`;
  }

  function gridHTML(list) {
    if (!list.length) return emptyHTML('没有符合条件的帖子。', '发布');
    const cards = list.map(cardHTML);
    if (cards.length >= 7 && window.CommonsAnnounce && typeof window.CommonsAnnounce.adSlot === 'function') {
      const ad = window.CommonsAnnounce.adSlot('market-8');
      if (ad) cards.splice(7, 0, `<aside class="mt-ad">${/* safe: CommonsAnnounce.adSlot 返回已转义广告卡 */ ad}</aside>`);
    }
    return `<div class="mt-grid">${cards.join('')}</div>`;
  }

  function categoryChips() {
    const all = [{ id: 'all', label: '全部' }, ...sample().categories];
    return all.map(item => `<button type="button" class="chip${state.category === item.id ? ' selected' : ''}"
      data-mt-act="category-filter" data-category="${esc(item.id)}"
      aria-pressed="${state.category === item.id}">${item.id === 'all' ? '' : `<img src="${safeUrl(CATEGORY_ASSET[item.id])}" alt="">`}${esc(item.label)}</button>`).join('');
  }

  function countText(rows) {
    return `${rows.length}${moreCursor() ? '+' : ''} 条`;
  }

  function listBodyHTML(rows) {
    if (isLive() && state.view === 'mine' && !state.mine.rows) return state.mine.error ? '' : '<p class="mt-error" aria-live="polite">正在读取我的发布…</p>';
    return gridHTML(rows);
  }

  /* safe-fn: 静态文案和逐值转义的数据；链接只到站内路由 */
  function listView(view) {
    state.view = view;
    state.selectedId = '';
    const rows = filtered();
    return `<div class="mt" data-mt-root data-view="${esc(view)}">
      <header class="mt-head">
        ${view === 'mine' ? '<div class="mt-head-copy"><h1>闲置与线索</h1><p class="mt-offsite">只提供线索，交易在站外。</p></div>' : '<p class="mt-offsite">只提供线索，交易在站外。</p>'}
        <div class="mt-head-actions"><a class="button primary" href="#/market/new">发布 ${icon('pen')}</a>${isLive() ? '' : '<span class="mt-sample">示例</span>'}</div>
      </header>
      <div class="mt-toolbar">
        <div class="mt-chips" role="group" aria-label="分类">${categoryChips()}</div>
        <label class="field mt-search"><span class="mt-visually-hidden">搜索</span><input type="search" data-mt-search value="${esc(state.q)}" placeholder="搜标题、城市或岗位" autocomplete="off"></label>
      </div>
      <div class="mt-subbar">
        <nav class="mt-tabs" aria-label="查看范围">
          <a href="#/market" ${view === 'all' ? 'aria-current="page"' : ''}>全部</a>
          <a href="#/market/mine" ${view === 'mine' ? 'aria-current="page"' : ''}>我的发布</a>
        </nav>
        <span class="mt-count" data-mt-count role="status" aria-live="polite">${countText(rows)}</span>
      </div>
      <div data-mt-grid>${listBodyHTML(rows)}</div>
      <div data-mt-more>${moreHTML()}</div>
    </div>`;
  }

  function galleryItems(listing) {
    const art = listingAsset(listing);
    const urls = art ? [art] : (Array.isArray(listing.imageUrls) ? listing.imageUrls.filter(Boolean) : []);
    if (urls.length) return urls.map((src, index) => ({ type: 'image', src, index }));
    return Array.from({ length: photoCount(listing) }, (_, index) => ({ type: 'ph', index }));
  }

  /* safe-fn: 图片走 safeUrl 或 CommonsImage.html；占位块只有写死 class 与转义标签 */
  function galleryHTML(listing) {
    const items = galleryItems(listing);
    const index = Math.min(state.photoIndex, items.length - 1);
    const item = items[index] || items[0];
    const main = item.type === 'image'
      ? ( /* safe: CommonsImage.html 自行转义 */ window.CommonsImage && typeof window.CommonsImage.html === 'function'
        ? window.CommonsImage.html({
          src: item.src, width: 1200, height: 900, alt: listing.title,
          group: `market-${listing.id}`, tag: '图片', zoom: true
        })
        : `<img class="mt-cover-img is-large" src="${safeUrl(item.src)}" alt="" loading="lazy" decoding="async">` )
      : coverHTML(listing, true);
    const thumbs = items.length > 1 ? `<div class="mt-thumbs">${items.map((entry, i) => {
      const inner = entry.type === 'image'
        ? `<img src="${safeUrl(entry.src)}" alt="" loading="lazy" decoding="async" width="200" height="150">`
        : `<span class="mt-ph" data-tone="${esc(String(TONE[listing.category] || 10))}" aria-hidden="true">${icon(category(listing.category).glyph)}</span>`;
      return `<button type="button" class="mt-thumb" data-mt-act="photo" data-index="${esc(String(i))}" aria-pressed="${i === index}" aria-label="第 ${esc(String(i + 1))} 张">${/* safe: inner 由图片标签或占位块组成 */ inner}</button>`;
    }).join('')}</div>` : '';
    return `<div class="mt-gallery-main" data-mt-gallery-main>${/* safe: main 由 CommonsImage.html 或图片标签组成 */ main}</div>${thumbs}`;
  }

  /* safe-fn: 所有字段逐值转义 */
  function fieldRows(listing) {
    const keys = category(listing.category).fields.filter(key => key !== 'price' && key !== 'budget');
    return keys.filter(key => listing[key]).map(key => `<div><dt>${esc(sample().fieldLabels[key] || key)}</dt><dd>${key === 'company' ? orgLink(listing.orgSlug, listing[key]) : esc(listing[key])}</dd></div>`).join('');
  }

  /* safe-fn: 所有字段逐值转义 */
  function ownerActions(listing) {
    if (!isMine(listing)) return '';
    const buttons = [];
    if (listing.status === 'active') {
      buttons.push(`<button type="button" class="button small" data-mt-act="status" data-status="reserved" data-id="${esc(listing.id)}">标为已预订</button>`);
      buttons.push(`<button type="button" class="button small" data-mt-act="status" data-status="sold" data-id="${esc(listing.id)}">标为已成交</button>`);
    } else if (listing.status === 'reserved') {
      buttons.push(`<button type="button" class="button small" data-mt-act="status" data-status="active" data-id="${esc(listing.id)}">取消预订</button>`);
      buttons.push(`<button type="button" class="button small" data-mt-act="status" data-status="sold" data-id="${esc(listing.id)}">标为已成交</button>`);
    } else {
      buttons.push(`<button type="button" class="button small" data-mt-act="status" data-status="active" data-id="${esc(listing.id)}">重新上架</button>`);
    }
    return `<div class="mt-owner-actions"><span>我的发布</span>${buttons.join('')}</div>`;
  }

  /* safe-fn: 所有字段逐值转义；头像与图标由安全函数返回 */
  function detailView(id) {
    const listing = findListing(id);
    if (!listing) {
      return `<div class="mt" data-mt-root><div class="mt-empty"><h1>这条帖子不在了</h1><p>可能已经下架或过期。</p><a class="button" href="#/market">回到市集</a></div></div>`;
    }
    if (state.selectedId !== listing.id) state.photoIndex = 0;
    state.selectedId = listing.id;
    const cat = category(listing.category);
    const wished = read('wanted', []);
    const wanted = isLive() ? !!listing.wanted : (Array.isArray(wished) && wished.includes(listing.id));
    const canWant = !isMine(listing) && listing.status === 'active';
    const wantLabel = wanted ? '已表达兴趣' : canWant ? '我想要' : statusLabel(listing);
    return `<div class="mt" data-mt-root data-detail="${esc(listing.id)}">
      <div class="mt-detail-top">
        <a class="mt-back" href="${state.view === 'mine' ? '#/market/mine' : '#/market'}">${icon('back')} 市集</a>
        ${isLive() ? '' : `<span class="mt-sample">${listing.local ? '本机' : '示例'}</span>`}
      </div>
      <div class="mt-detail-grid">
        <section class="mt-gallery" aria-label="图片">${galleryHTML(listing)}</section>
        <aside class="mt-info">
          <div class="mt-info-top"><span class="mt-cat">${esc(cat.label)}</span><span class="mt-status" data-status="${esc(listing.status)}">${esc(statusLabel(listing))}</span></div>
          <h1>${esc(listing.title)}</h1>
          <p class="mt-price-lg">${esc(priceLabel(listing))}</p>
          <p class="mt-body">${esc(listing.body)}</p>
          <dl class="mt-fields">${fieldRows(listing)}</dl>
          <div class="mt-seller">${avatar(listing.author, 'normal')}<div><b>${personLink(author(listing.author))}</b><small>L${esc(String(author(listing.author).level))}</small></div></div>
          <div class="mt-actions">
            ${isMine(listing) ? '' : `<button type="button" class="button primary" data-mt-act="want" data-id="${esc(listing.id)}" ${canWant && !wanted ? '' : 'disabled'}>${esc(wantLabel)}</button>
            <button type="button" class="button ghost" data-mt-act="report" data-id="${esc(listing.id)}">举报</button>`}
          </div>
          ${ownerActions(listing)}
        </aside>
      </div>
      <section class="mt-comments" aria-labelledby="mt-comments-title">
        <div class="mt-comments-head"><h2 id="mt-comments-title">留言</h2><span>先留言，再决定怎么联系。</span></div>
        <div data-mt-thread></div>
      </section>
      <p class="mt-footnote">交易在站外进行，先锋不担保。</p>
    </div>`;
  }

  function draftValue(key) {
    const value = state.draft[key];
    return typeof value === 'string' ? value : '';
  }

  function fieldInput(key, cat) {
    const id = 'mt-' + key;
    const isRequired = cat.required.includes(key);
    const required = isRequired ? ' required' : '';
    const invalid = state.fieldErrors[key] ? ' aria-invalid="true" aria-describedby="mt-error-' + esc(key) + '"' : '';
    const max = ['company', 'position', 'target'].includes(key) ? 80 : 40;
    return `<div class="field"><label for="${esc(id)}">${esc(sample().fieldLabels[key] || key)}${isRequired ? '<span class="mt-required">必填</span>' : ''}</label>
      <input id="${esc(id)}" name="${esc(key)}" value="${esc(draftValue(key))}" maxlength="${max}" placeholder="${esc(PLACEHOLDER[key] || '')}"${required}${invalid}>` +
      (state.fieldErrors[key] ? `<small id="mt-error-${esc(key)}" class="mt-field-error">${esc(state.fieldErrors[key])}</small>` : '') + '</div>';
  }

  /* safe-fn: 静态表单与逐值转义的草稿 */
  function categoryStep() {
    const choices = sample().categories.map(item => `<button type="button" class="button mt-cat-choice" data-mt-act="category" data-category="${esc(item.id)}" aria-pressed="${state.draft.category === item.id}">
      <span class="mt-cat-icon"><img src="${safeUrl(CATEGORY_ASSET[item.id])}" alt=""></span><span>${esc(item.label)}</span></button>`).join('');
    return `<div class="mt-step"><h2 tabindex="-1">选一个分类</h2><div class="mt-cat-grid">${choices}</div></div>`;
  }

  /* safe-fn: 预览地址过 safeUrl，状态文字全部转义；线上图片的编号只进 data 属性且经 esc */
  function photoGridHTML() {
    const live = isLive();
    const photos = state.photos.map((photo, index) => {
      const remove = `<button type="button" class="icon-button" data-mt-act="remove-photo" data-index="${esc(String(index))}" aria-label="移除图片">×</button>`;
      if (!live) return `<div class="mt-photo"><img src="${safeUrl(photo.data)}" alt="" width="160" height="120">${remove}</div>`;
      if (photo.state === 'done') return `<div class="mt-photo"><img src="${safeUrl(photo.url)}" alt="" width="160" height="120">${remove}</div>`;
      if (photo.state === 'busy') return `<div class="mt-photo" role="status"><span class="mt-photo-note">${esc(photo.name)} · 上传中 ${esc(String(Math.round(photo.ratio * 100)))}%</span>${remove}</div>`;
      return `<div class="mt-photo"><span class="mt-photo-note" role="alert">${esc(photo.name)}：${esc(photo.error)}</span>${photo.retry ? `<button type="button" class="button ghost small" data-mt-act="retry-photo" data-index="${esc(String(index))}">重试</button>` : ''}${remove}</div>`;
    }).join('');
    const uploadWhy = live ? uploadBlockedWhy() : '';
    const add = state.photos.length < MAX_PHOTOS
      ? (uploadWhy
        ? `<label class="mt-photo-add is-disabled" title="${esc(uploadWhy)}" aria-disabled="true"><input type="file" disabled data-mt-photos class="mt-file-input"><span>+ 添加图片</span></label><small class="mt-why" role="status" data-mt-why="upload">${esc(uploadWhy)}</small>`
        : `<label class="mt-photo-add"><input type="file" accept="${live ? 'image/png,image/jpeg,image/webp,image/gif,image/avif' : 'image/*'}" multiple data-mt-photos class="mt-file-input"><span>+ 添加图片</span></label>`)
      : '';
    return photos + add;
  }

  /* safe-fn: 静态表单与逐值转义的草稿；图片预览走 safeUrl */
  function fieldStep() {
    const cat = category(state.draft.category);
    const photoGrid = `<div class="mt-photo-grid" data-mt-photo-grid>${photoGridHTML()}</div>`;
    return `<div class="mt-step">
      <div class="mt-step-head"><h2 tabindex="-1">${esc(cat.label)}</h2><button type="button" class="button ghost small" data-mt-act="step" data-step="1">换分类</button></div>
      <div class="field"><label for="mt-title">标题<span class="mt-required">必填</span></label><input id="mt-title" name="title" value="${esc(draftValue('title'))}" maxlength="200" required${state.fieldErrors.title ? ' aria-invalid="true" aria-describedby="mt-error-title"' : ''}>${state.fieldErrors.title ? `<small id="mt-error-title" class="mt-field-error">${esc(state.fieldErrors.title)}</small>` : ''}</div>
      <div class="field"><label for="mt-body">说明<span class="mt-required">必填</span></label><textarea id="mt-body" name="body" maxlength="5000" rows="4" required${state.fieldErrors.body ? ' aria-invalid="true" aria-describedby="mt-error-body"' : ''}>${esc(draftValue('body'))}</textarea>${state.fieldErrors.body ? `<small id="mt-error-body" class="mt-field-error">${esc(state.fieldErrors.body)}</small>` : ''}</div>
      <div class="mt-field-grid">${cat.fields.map(key => fieldInput(key, cat)).join('')}</div>
      <div class="mt-photos"><span class="mt-field-label">图片</span>${photoGrid}</div>
      <p class="mt-error" data-mt-error role="alert">${esc(state.error)}</p>
      <div class="mt-form-actions">
        <button type="button" class="button ghost" data-mt-act="step" data-step="1">上一步</button>
        <button type="submit" class="button primary">下一步</button>
      </div>
    </div>`;
  }

  /* safe-fn: 静态摘要，字段逐值转义 */
  function confirmStep() {
    const cat = category(state.draft.category);
    const rows = [
      ['分类', cat.label],
      ['标题', draftValue('title')],
      ...cat.fields.filter(key => draftValue(key)).map(key => [sample().fieldLabels[key] || key, draftValue(key)]),
      ['图片', isLive() ? (donePhotos().length ? `${donePhotos().length} 张` : '没有图片') : (state.photos.length ? `${state.photos.length} 张` : '没有图片')]
    ].map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');
    return `<div class="mt-step">
      <h2 tabindex="-1">确认发布</h2>
      <dl class="mt-summary">${rows}</dl>
      <label class="mt-check"><input type="checkbox" data-mt-confirm required><span>我知道交易在站外进行</span></label>
      <p class="mt-error" data-mt-error role="alert">${esc(state.error)}</p>
      <div class="mt-form-actions">
        <button type="button" class="button ghost" data-mt-act="step" data-step="2">上一步</button>
        <button type="submit" class="button primary">发布</button>
      </div>
    </div>`;
  }

  /* safe-fn: 静态表单壳；步骤内容由写死的视图函数组成 */
  function newView() {
    const steps = [
      [1, '分类'], [2, '信息'], [3, '确认']
    ].map(([id, label]) => `<li class="${state.step === id ? 'is-on' : state.step > id ? 'is-done' : ''}"><span>${id}</span>${esc(label)}</li>`).join('');
    const body = state.step === 1 ? categoryStep() : state.step === 2 ? fieldStep() : confirmStep();
    return `<div class="mt mt-new" data-mt-root>
      <header class="mt-head"><div class="mt-head-copy"><h1>发布</h1></div><a class="button ghost" href="#/market">取消</a></header>
      <ol class="mt-steps">${steps}</ol>
      <form data-mt-form="new">${body}</form>
    </div>`;
  }

  function liveStateHTML(kind) {
    if (kind === 'error') {
      if (state.liveError === 'closed') {
        return `<div class="mt-page" data-mt-root><div class="mt-error" role="status"><p>这个功能还没开放</p><p>管理员还没打开。</p></div></div>`;
      }
      return `<div class="mt-page" data-mt-root><div class="mt-error" role="alert"><p>${esc(state.liveError || '市集没有载入')}</p><button type="button" class="button" data-mt-act="retry">重试</button></div></div>`;
    }
    return `<div class="mt-page" data-mt-root><p class="mt-error" aria-live="polite">正在读取市集…</p></div>`;
  }

  function view() {
    if (isLive() && state.liveError) return liveStateHTML('error');
    if (isLive() && !state.live) return liveStateHTML('loading');
    const parts = routeParts();
    const id = parts[1] || '';
    if (id === 'new') {
      state.view = 'new';
      return newView();
    }
    if (id === 'mine') return listView('mine');
    if (id) return detailView(id);
    return listView('all');
  }

  function commentsFor(listing) {
    const bodies = (sample().comments[listing.category] || []).slice(0, 3);
    const base = listing.local ? Date.now() - 3 * 1800000 : (Date.parse(listing.createdAt) || Date.now());
    return bodies.map((body, index) => ({
      id: `${listing.id}-c${index + 1}`,
      authorId: index === 1 ? 'me' : index === 0 ? 'p2' : 'p3',
      body,
      createdAt: new Date(base + (index + 1) * 1800000).toISOString(),
      reply_to: index === 2 ? `${listing.id}-c1` : null,
      thread_root: `${listing.id}-c1`,
      status: 'ok',
      reactions: index === 0 ? { up: 2 } : index === 1 ? { learned: 1 } : {},
      mine: {}
    }));
  }

  function mountThread() {
    const host = state.root && state.root.querySelector('[data-mt-thread]');
    const listing = findListing(state.selectedId);
    if (!host || !listing || !window.CommonsThread || typeof window.CommonsThread.mount !== 'function') return;
    if (isLive()) {
      window.CommonsThread.mount(host, { targetId: listing.id, repliesOnly: true });
      return;
    }
    const mine = me();
    window.CommonsThread.mount(host, {
      targetId: listing.id,
      messages: commentsFor(listing),
      me: { id: 'me', name: mine.name, level: mine.level },
      people: sample().people.map(person => person.id === 'me' ? { ...person, name: mine.name } : person),
      mode: 'chat'
    });
  }

  function refresh() {
    if (window.Commons && typeof window.Commons.refresh === 'function') window.Commons.refresh();
  }

  function paintGrid() {
    const grid = state.root && state.root.querySelector('[data-mt-grid]');
    if (!grid) return;
    const rows = filtered();
    grid.innerHTML = listBodyHTML(rows);
    const more = state.root.querySelector('[data-mt-more]');
    if (more) more.innerHTML = moreHTML();
    const count = state.root.querySelector('[data-mt-count]');
    if (count) count.textContent = countText(rows);
    state.root.querySelectorAll('[data-mt-act="category-filter"]').forEach(button => {
      const on = button.getAttribute('data-category') === state.category;
      button.classList.toggle('selected', on);
      button.setAttribute('aria-pressed', String(on));
    });
  }

  function readFields(form) {
    const values = new FormData(form);
    FIELD_KEYS.concat(['title', 'body', 'category']).forEach(key => {
      if (values.has(key)) state.draft[key] = String(values.get(key) || '');
    });
    return state.draft;
  }

  function screenText(text) {
    const value = String(text || '').normalize('NFKC').toLowerCase();
    for (const [pattern, label] of FORBIDDEN) if (pattern.test(value)) return label;
    return '';
  }

  function handleCategory(id) {
    if (!sample().categories.some(item => item.id === id)) return;
    state.draft.category = id;
    state.step = 2;
    state.error = '';
    state.fieldErrors = {};
    state.focusAfter = '__heading__';
    refresh();
  }

  function handleStep(step) {
    const form = state.root && state.root.querySelector('[data-mt-form="new"]');
    if (form) readFields(form);
    state.step = Math.max(1, Math.min(3, Number(step) || 1));
    state.error = '';
    state.fieldErrors = {};
    state.focusAfter = '__heading__';
    refresh();
  }

  function nextStep(form) {
    readFields(form);
    const cat = category(state.draft.category);
    const missing = ['title', 'body', ...cat.required].find(key => !String(state.draft[key] || '').trim());
    if (missing) {
      const label = sample().fieldLabels[missing] || (missing === 'title' ? '标题' : missing === 'body' ? '说明' : missing);
      state.error = `${label}要填`;
      state.fieldErrors = { [missing]: state.error };
      state.focusAfter = missing;
      refresh();
      return;
    }
    if (!form.reportValidity()) return;
    state.error = '';
    state.fieldErrors = {};
    state.step = 3;
    state.focusAfter = '__heading__';
    refresh();
  }

  function publish(form) {
    if (!form.reportValidity()) return;
    const confirm = form.querySelector('[data-mt-confirm]');
    if (!confirm || !confirm.checked) {
      toast('先确认交易在站外进行。');
      return;
    }
    readFields(form);
    const cat = category(state.draft.category);
    const probe = [state.draft.title, state.draft.body, ...cat.fields.map(key => state.draft[key])].join('\n');
    const hit = screenText(probe);
    if (hit) {
      state.error = `这个品类不能发布：${hit}`;
      const host = state.root && state.root.querySelector('[data-mt-error]');
      if (host) host.textContent = state.error;
      return;
    }
    const missing = ['title', 'body', ...cat.required].find(key => !String(state.draft[key] || '').trim());
    if (missing) {
      state.step = 2;
      state.error = `${sample().fieldLabels[missing] || (missing === 'title' ? '标题' : missing === 'body' ? '说明' : missing)}要填`;
      state.fieldErrors = { [missing]: state.error };
      state.focusAfter = missing;
      refresh();
      return;
    }
    if (isLive()) {
      if (state.busy || !window.CommonsAPI) return;
      const payload = {
        category: state.draft.category,
        title: String(state.draft.title || '').trim(),
        body: String(state.draft.body || '').trim()
      };
      cat.fields.forEach(key => { payload[key] = String(state.draft[key] || '').trim(); });
      if (payload.category === 'free' && !payload.price) payload.price = '免费';
      if (state.photos.some(photo => photo.state === 'busy')) { toast('还有图片在上传，等它传完再发布。'); return; }
      if (state.photos.some(photo => photo.state === 'failed')) { toast('有图片没传上去：回上一步重试或移除，再发布。'); return; }
      const imageIds = donePhotos().map(photo => photo.assetId);
      if (imageIds.length) payload.images = imageIds;
      state.busy = true;
      const publishBtn = form.querySelector('[type="submit"]');
      if (publishBtn) publishBtn.disabled = true;
      /* 同一份表单在成功前复用同一个幂等键；内容一改就换新键。 */
      const sig = JSON.stringify(payload);
      if (state.publishKey.sig !== sig || !state.publishKey.key) state.publishKey = { sig: sig, key: window.CommonsAPI.newIdempotencyKey() };
      livePost('/market/listings', payload, state.publishKey.key).then(function (response) {
        state.busy = false;
        state.publishKey = { sig: '', key: '' };
        const data = response && response.data;
        const id = data && data.id;
        state.draft = {};
        state.photos = [];
        state.photoSeq += 1;
        state.step = 1;
        state.error = '';
        state.fieldErrors = {};
        toast('已发布。交易在站外进行。');
        if (id && window.Commons && typeof window.Commons.go === 'function') window.Commons.go('market/' + id);
        else loadLive();
      }).catch(function (error) {
        state.busy = false;
        if (publishBtn) publishBtn.disabled = false;
        toast(liveError(error, '没发布成功，内容还在表单里。'));
      });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const used = localPosts().filter(post => String(post.createdAt || '').slice(0, 10) === today).length;
    const limit = LIMIT[me().level] || LIMIT[1];
    if (used >= limit) {
      toast(`今天最多发布 ${limit} 条。`);
      return;
    }
    const now = new Date().toISOString();
    const listing = {
      id: 'local-' + Date.now().toString(36),
      category: state.draft.category,
      status: 'active',
      title: String(state.draft.title || '').trim(),
      body: String(state.draft.body || '').trim(),
      author: 'me',
      createdAt: now,
      local: true,
      photos: state.photos.length || 1
    };
    cat.fields.forEach(key => { listing[key] = String(state.draft[key] || '').trim(); });
    if (listing.category === 'free' && !listing.price) listing.price = '免费';
    const posts = [listing, ...localPosts()];
    if (!write('posts', posts)) {
      toast('没保存上，内容还在表单里。');
      return;
    }
    state.draft = {};
    state.photos = [];
    state.step = 1;
    state.error = '';
    state.fieldErrors = {};
    toast('已发布。交易在站外进行。');
    if (window.Commons && typeof window.Commons.go === 'function') window.Commons.go('market/' + listing.id);
  }

  function handleWant(id) {
    const listing = findListing(id);
    if (!listing) return;
    if (isLive()) {
      if (state.busy || !window.CommonsAPI || listing.wanted || isMine(listing)) return;
      state.busy = true;
      const button = state.root && state.root.querySelector('[data-mt-act="want"]');
      if (button) button.disabled = true;
      livePost('/market/listings/' + encodeURIComponent(id) + '/want', {}).then(function () {
        state.busy = false;
        listing.wanted = true;
        toast('已记下。先留言，再决定怎么联系。');
        if (button) {
          button.disabled = true;
          button.textContent = '已表达兴趣';
        }
        const thread = state.root && state.root.querySelector('[data-mt-thread]');
        if (thread && typeof thread.scrollIntoView === 'function') {
          thread.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
        }
      }).catch(function (error) {
        state.busy = false;
        if (button) {
          button.disabled = false;
          button.textContent = '我想要';
        }
        toast(liveError(error, '没有记下。原状态没有变化。'));
      });
      return;
    }
    const wanted = read('wanted', []);
    const rows = Array.isArray(wanted) ? wanted : [];
    if (!rows.includes(id)) {
      rows.push(id);
      write('wanted', rows);
    }
    toast('已记下。先留言，再决定怎么联系。');
    const button = state.root && state.root.querySelector('[data-mt-act="want"]');
    if (button) {
      button.disabled = true;
      button.textContent = '已表达兴趣';
    }
    const thread = state.root && state.root.querySelector('[data-mt-thread]');
    if (thread && typeof thread.scrollIntoView === 'function') {
      thread.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function handleStatus(id, status) {
    const listing = findListing(id);
    if (!listing || !isMine(listing)) return;
    if (isLive()) {
      if (state.busy || !window.CommonsAPI) return;
      const prev = listing.status;
      listing.status = status;
      state.busy = true;
      refresh();
      livePost('/market/listings/' + encodeURIComponent(id) + '/status', { status: status }).then(function (response) {
        state.busy = false;
        const data = response && response.data;
        if (data && data.status) listing.status = data.status;
        toast('状态已更新。');
        refresh();
      }).catch(function (error) {
        listing.status = prev;
        state.busy = false;
        toast(liveError(error, '状态没有改成。原数据没有变化。'));
        refresh();
      });
      return;
    }
    if (listing.local) {
      const posts = localPosts().map(item => item.id === id ? { ...item, status } : item);
      write('posts', posts);
    } else {
      const rows = overrides();
      rows[id] = { ...(rows[id] || {}), status };
      write('statusOverrides', rows);
    }
    toast('状态已更新。');
    refresh();
  }

  function openReport(id) {
    const listing = findListing(id);
    if (!listing) return;
    state.reportId = id;
    const reasons = sample().reportReasons.map((reason, index) => `<label class="mt-reason">
      <input type="radio" name="mt-reason" value="${esc(reason.id)}" ${index === 0 ? 'checked' : ''}><span>${esc(reason.label)}</span></label>`).join('');
    if (window.Commons && typeof window.Commons.modal === 'function') {
      window.Commons.modal('举报这条帖子', `<form data-mt-report-form data-id="${esc(id)}">
        <p class="mt-report-title">${esc(listing.title)}</p>
        <div class="mt-reasons">${reasons}</div>
        <div class="field"><label for="mt-report-note">补充说明</label><textarea id="mt-report-note" name="note" maxlength="500" rows="3"></textarea></div>
        <div class="mt-form-actions"><button type="submit" class="button primary">提交举报</button></div>
      </form>`);
    }
  }

  function submitReport(form) {
    const reason = form.querySelector('input[name="mt-reason"]:checked');
    if (!reason) {
      toast('选一个理由。');
      return;
    }
    if (isLive()) {
      if (state.busy || !window.CommonsAPI) return;
      state.busy = true;
      const submitBtn = form.querySelector('[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      livePost('/market/listings/' + encodeURIComponent(state.reportId) + '/report', {
        reason_code: reason.value,
        note: String((form.querySelector('[name="note"]') || {}).value || '')
      }).then(function () {
        state.busy = false;
        if (window.Commons && typeof window.Commons.closeModal === 'function') window.Commons.closeModal();
        toast('已提交，治理员会看到。');
      }).catch(function (error) {
        state.busy = false;
        if (submitBtn) submitBtn.disabled = false;
        toast(liveError(error, '举报没有提交。原数据没有变化。'));
      });
      return;
    }
    const rows = read('reports', []);
    const list = Array.isArray(rows) ? rows : [];
    list.push({
      listingId: state.reportId,
      reason: reason.value,
      note: String((form.querySelector('[name="note"]') || {}).value || ''),
      at: new Date().toISOString()
    });
    write('reports', list);
    if (window.Commons && typeof window.Commons.closeModal === 'function') window.Commons.closeModal();
    toast('已提交，治理员会看到。');
  }

  const donePhotos = () => state.photos.filter(photo => photo.state === 'done');

  function paintPhotos() {
    const grid = state.root && state.root.querySelector('[data-mt-photo-grid]');
    if (grid) grid.innerHTML = photoGridHTML();
  }

  function startPhoto(photo, again) {
    const M = window.CommonsMedia;
    photo.state = 'busy';
    photo.error = '';
    photo.retry = null;
    const seq = state.photoSeq;
    const go = again ? again() : (M && typeof M.upload === 'function'
      ? M.upload(photo.file, { purpose: 'image', onProgress: p => { photo.ratio = p.ratio; if (seq === state.photoSeq) paintPhotos(); } })
      : Promise.reject(new Error('上传组件没加载上，刷新页面再试。')));
    paintPhotos();
    return go.then(res => {
      if (seq !== state.photoSeq) return;
      photo.state = 'done';
      photo.assetId = res.id;
      photo.url = res.url;
      photo.file = null;
      paintPhotos();
    }, err => {
      if (seq !== state.photoSeq) return;
      photo.state = 'failed';
      photo.error = (err && err.message) || '上传没成功，请重试。';
      photo.retry = err && typeof err.retry === 'function' ? () => err.retry() : null;
      paintPhotos();
    });
  }

  // 不能上传时的原因（/api/me.capability_reasons）；能传或没有会话对象返回空串。
  function uploadBlockedWhy() {
    const session = window.CommonsSession;
    if (!session || typeof session.can !== 'function' || session.can('upload.create')) return '';
    return (typeof session.reason === 'function' && session.reason('upload.create')) || '你现在还不能上传图片。';
  }

  /* 一次选多张：按顺序一张一张传，最多 6 张；失败的那张可以单独重试或移除。 */
  function handleLiveFiles(input) {
    const room = Math.max(0, MAX_PHOTOS - state.photos.length);
    const files = Array.from(input.files || []);
    input.value = '';
    const blocked = uploadBlockedWhy();
    if (blocked) {
      toast(blocked);
      return;
    }
    if (files.length > room) toast(`最多 ${MAX_PHOTOS} 张图片，多出来的没有加。`);
    let chain = Promise.resolve();
    files.slice(0, room).forEach(file => {
      const photo = { name: String(file.name || '图片').slice(0, 40), file, state: 'busy', ratio: 0, error: '', retry: null, assetId: '', url: '' };
      state.photos.push(photo);
      chain = chain.then(() => startPhoto(photo));
    });
    paintPhotos();
  }

  function handleFiles(input) {
    if (isLive()) { handleLiveFiles(input); return; }
    const form = state.root && state.root.querySelector('[data-mt-form="new"]');
    if (form) readFields(form);
    const files = Array.from(input.files || []).slice(0, Math.max(0, 6 - state.photos.length));
    if (!files.length) return;
    let pending = files.length;
    files.forEach(file => {
      if (!/^image\//.test(file.type)) {
        pending -= 1;
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') state.photos.push({ name: file.name, data: reader.result });
        pending -= 1;
        if (pending === 0 && state.root) refresh();
      };
      reader.onerror = () => {
        pending -= 1;
        if (pending === 0 && state.root) refresh();
      };
      reader.readAsDataURL(file);
    });
  }

  function onClick(event) {
    const button = event.target.closest('[data-mt-act]');
    if (!button) return;
    const act = button.getAttribute('data-mt-act');
    if (act === 'retry') {
      event.preventDefault();
      loadLive();
      return;
    }
    if (act === 'more') {
      event.preventDefault();
      loadMore();
      return;
    }
    if (act === 'category-filter') {
      event.preventDefault();
      state.category = button.getAttribute('data-category') || 'all';
      paintGrid();
      return;
    }
    if (act === 'category') {
      event.preventDefault();
      handleCategory(button.getAttribute('data-category') || '');
      return;
    }
    if (act === 'step') {
      event.preventDefault();
      handleStep(button.getAttribute('data-step'));
      return;
    }
    if (act === 'photo') {
      event.preventDefault();
      state.photoIndex = Number(button.getAttribute('data-index')) || 0;
      const listing = findListing(state.selectedId);
      const gallery = state.root && state.root.querySelector('.mt-gallery');
      if (listing && gallery) {
        gallery.innerHTML = galleryHTML(listing);
        if (window.CommonsImage && typeof window.CommonsImage.mount === 'function') window.CommonsImage.mount(gallery);
      }
      state.root.querySelectorAll('[data-mt-act="photo"]').forEach(thumb => {
        thumb.setAttribute('aria-pressed', String(Number(thumb.getAttribute('data-index')) === state.photoIndex));
      });
      return;
    }
    if (act === 'retry-photo') {
      event.preventDefault();
      const photo = state.photos[Number(button.getAttribute('data-index')) || 0];
      if (photo && photo.state === 'failed' && photo.retry) startPhoto(photo, photo.retry);
      return;
    }
    if (act === 'remove-photo') {
      event.preventDefault();
      if (isLive()) {
        state.photos.splice(Number(button.getAttribute('data-index')) || 0, 1);
        paintPhotos();
        return;
      }
      const form = state.root && state.root.querySelector('[data-mt-form="new"]');
      if (form) readFields(form);
      state.photos.splice(Number(button.getAttribute('data-index')) || 0, 1);
      refresh();
      return;
    }
    if (act === 'want') {
      event.preventDefault();
      handleWant(button.getAttribute('data-id') || '');
      return;
    }
    if (act === 'report') {
      event.preventDefault();
      openReport(button.getAttribute('data-id') || '');
      return;
    }
    if (act === 'status') {
      event.preventDefault();
      handleStatus(button.getAttribute('data-id') || '', button.getAttribute('data-status') || '');
    }
  }

  function onInput(event) {
    if (event.target && event.target.matches('[data-mt-search]')) {
      state.q = String(event.target.value || '');
      paintGrid();
    }
  }

  function onChange(event) {
    if (event.target && event.target.matches('[data-mt-photos]')) handleFiles(event.target);
  }

  function onSubmit(event) {
    const report = event.target.closest('[data-mt-report-form]');
    if (report) {
      event.preventDefault();
      submitReport(report);
      return;
    }
    const form = event.target.closest('[data-mt-form="new"]');
    if (!form) return;
    event.preventDefault();
    if (state.step === 2) nextStep(form);
    else if (state.step === 3) publish(form);
  }

  function on(target, type, handler) {
    target.addEventListener(type, handler);
    state.unbind.push(() => target.removeEventListener(type, handler));
  }

  /* 接口的 images 是资产元数据列表（image.src 是 /api/media/f/ 地址），翻成卡片和图集用的 imageUrls。 */
  function imagesOf(row) {
    const list = Array.isArray(row && row.images) ? row.images : [];
    const urls = list.map(asset => asset && asset.image && asset.image.src).filter(Boolean);
    return urls.length ? { imageUrls: urls, photos: urls.length } : {};
  }

  function metaCursor(response) {
    return (response && response.meta && response.meta.next_cursor) || '';
  }

  function mapListing(row, people) {
    const a = row.author && typeof row.author === 'object' ? row.author : null;
    const authorId = a ? a.id : row.author;
    if (a && authorId && !people.some(function (p) { return p.id === authorId; })) {
      people.push({ id: authorId, name: a.display_name || a.name, level: a.level, handle: a.handle || '' });
    }
    return Object.assign({}, row, imagesOf(row), {
      author: authorId,
      createdAt: row.createdAt || row.created_at,
      body: row.body || row.excerpt || '',
      mine: !!row.mine,
      wanted: !!row.wanted
    });
  }

  /* 追加一页：按 id 去重，翻页期间有人新发布也不会重复出现。 */
  function mergeRows(target, incoming) {
    const seen = {};
    target.forEach(function (item) { seen[item.id] = true; });
    incoming.forEach(function (item) { if (!seen[item.id]) { seen[item.id] = true; target.push(item); } });
  }

  function loadMine(more) {
    if (!isLive() || !window.CommonsAPI || state.mine.loading) return;
    const mine = state.mine;
    mine.loading = true;
    mine.error = '';
    if (more) state.moreBusy = true;
    const query = { mine: 'true', limit: PAGE };
    if (more && mine.cursor) query.cursor = mine.cursor;
    window.CommonsAPI.get('/market/listings', query).then(function (response) {
      const raw = response.data;
      const people = (state.live && state.live.people) || [];
      const rows = (Array.isArray(raw) ? raw : (raw && raw.items) || []).map(function (row) {
        const item = mapListing(row, people);
        item.mine = true;
        return item;
      });
      mine.rows = more && mine.rows ? mine.rows : [];
      mergeRows(mine.rows, rows);
      mine.cursor = metaCursor(response);
      mine.loading = false;
      state.moreBusy = false;
      if (more) paintGrid();
      else refresh();
    }).catch(function (error) {
      mine.loading = false;
      state.moreBusy = false;
      mine.error = (error && error.message) || '我的发布没有载入';
      if (more) paintGrid();
      else refresh();
    });
  }

  function loadMore() {
    if (!isLive() || !window.CommonsAPI || state.moreBusy) return;
    if (state.view === 'mine') { loadMine(!!state.mine.rows); return; }
    if (!state.cursor || !state.live) return;
    state.moreBusy = true;
    paintGrid();
    window.CommonsAPI.get('/market/listings', { limit: PAGE, cursor: state.cursor }).then(function (response) {
      const raw = response.data;
      const rows = (Array.isArray(raw) ? raw : (raw && raw.items) || []).map(function (row) { return mapListing(row, state.live.people); });
      mergeRows(state.live.listings, rows);
      state.cursor = metaCursor(response);
      state.moreBusy = false;
      paintGrid();
    }).catch(function (error) {
      state.moreBusy = false;
      paintGrid();
      toast((error && error.message) || '没有载入更多，再点一次。');
    });
  }

  function loadLive() {
    if (!isLive() || !window.CommonsAPI || state.liveLoading) return;
    state.liveLoading = true;
    state.liveError = '';
    const detailId = state.selectedId || ((function () {
      const part = routeParts()[1];
      return part && part !== 'new' && part !== 'mine' ? part : '';
    })());
    const jobs = [
      window.CommonsAPI.get('/market/meta'),
      window.CommonsAPI.get('/market/listings', { limit: PAGE })
    ];
    if (detailId) jobs.push(window.CommonsAPI.get('/market/listings/' + encodeURIComponent(detailId)));
    Promise.all(jobs).then(function (rows) {
      const meta = rows[0].data || {};
      const raw = rows[1].data;
      const people = Array.isArray(meta.people) ? meta.people.slice() : [];
      const listings = (Array.isArray(raw) ? raw : (raw && raw.items) || []).map(function (row) { return mapListing(row, people); });
      state.cursor = metaCursor(rows[1]);
      state.mine = { rows: null, cursor: '', loading: false, error: '' };
      state.live = {
        people: people,
        categories: meta.categories || [],
        fieldLabels: meta.fieldLabels || meta.field_labels || {},
        statusLabels: meta.statusLabels || meta.status_labels || {},
        reportReasons: meta.reportReasons || meta.report_reasons || [],
        listings: listings,
        comments: meta.comments || {}
      };
      if (rows[2] && rows[2].data) {
        const full = rows[2].data;
        const a = full.author && typeof full.author === 'object' ? full.author : null;
        const mapped = Object.assign({}, full, imagesOf(full), {
          author: a ? a.id : full.author,
          createdAt: full.createdAt || full.created_at,
          body: full.body || full.excerpt || '',
          mine: !!full.mine,
          wanted: !!full.wanted
        });
        const idx = state.live.listings.findIndex(function (item) { return item.id === mapped.id; });
        if (idx >= 0) state.live.listings[idx] = mapped;
        else state.live.listings.unshift(mapped);
      }
      state.liveLoading = false;
      refresh();
    }).catch(function (error) {
      state.live = null;
      state.liveLoading = false;
      state.liveError = (error && (error.status === 501 || error.code === 'capability_unavailable')) ? 'closed' : ((error && error.message) || '市集没有载入');
      refresh();
    });
  }

  function mount() {
    const root = document.querySelector('[data-mt-root]');
    if (!root) return;
    destroy();
    state.root = root;
    const parts = routeParts();
    if (parts[1] && parts[1] !== 'new' && parts[1] !== 'mine') state.selectedId = parts[1];
    on(document, 'click', onClick);
    on(document, 'input', onInput);
    on(document, 'change', onChange);
    on(document, 'submit', onSubmit);
    if (isLive() && !state.live && !state.liveError && !state.liveLoading) loadLive();
    if (isLive() && state.live && parts[1] === 'mine' && !state.mine.rows && !state.mine.error && !state.mine.loading) loadMine(false);
    if (root.querySelector('[data-mt-thread]')) mountThread();
    if (window.CommonsImage && typeof window.CommonsImage.mount === 'function') window.CommonsImage.mount(root);
    if (state.focusAfter) {
      var focus = state.focusAfter === '__heading__' ? root.querySelector('.mt-step h2') : root.querySelector('[name="' + state.focusAfter + '"]');
      state.focusAfter = '';
      if (focus && focus.focus) focus.focus({ preventScroll: true });
    }
  }

  function destroy() {
    state.unbind.forEach(unbind => unbind());
    state.unbind = [];
    state.root = null;
  }

  window.CommonsMarket = {
    routes: { market: view },
    hub: ['market'],
    nav: [['market', '闲置与线索', 'tag', 'market']],
    icons: { tag: 'M20.6 13.4 12 22l-9-9V4h9zM7.5 7.5h.01' },
    titles: { market: '闲置与线索' },
    mount,
    destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsMarket);
  if (window.CommonsLinks && typeof window.CommonsLinks.provide === 'function') {
    window.CommonsLinks.provide('market', handle => {
      const ids = sample().people.filter(person => person.handle === handle).map(person => person.id);
      const count = allListings().filter(listing => ids.includes(listing.author) && listing.status === 'active').length;
      return count ? { label: '市集在售', href: '#/market', count, icon: 'tag' } : null;
    });
  }
})();

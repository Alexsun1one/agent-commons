/* R13 LAND-1 · 更新日志 #/changelog。自注册到 CommonsPages，进「我的社区」。
   数据在 changelog-data.js；只渲染已经接线、写进数据的条目。
   没有交互控件，mount/destroy 只管理根节点。 */
(function () {
  'use strict';

  const state = { root: null };

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));

  const icon = name => (window.Commons && typeof window.Commons.icon === 'function' ? window.Commons.icon(name) : '');

  const safeUrl = value => {
    if (window.Commons && typeof window.Commons.safeUrl === 'function') return window.Commons.safeUrl(value);
    const raw = String(value == null ? '' : value).trim();
    return raw.indexOf('#/') === 0 ? esc(raw) : '#';
  };

  const md = date => {
    const parts = String(date || '').split('-');
    return parts.length === 3 ? Number(parts[1]) + '.' + Number(parts[2]) : String(date || '');
  };

  const year = date => String(date || '').slice(0, 4);

  function group(entries) {
    const days = [];
    const index = new Map();
    entries.forEach(item => {
      const key = String(item.date || '');
      if (!index.has(key)) {
        index.set(key, { date: key, entries: [] });
        days.push(index.get(key));
      }
      index.get(key).entries.push(item);
    });
    return days.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  /* safe-fn: 数据字段逐值转义；图片和链接经 safeUrl；图标由 icon() 返回 */
  function entry(item) {
    const links = Array.isArray(item.links) ? item.links : [];
    return `<li class="cl-item">
      <h3>${esc(item.title)}</h3>
      <p>${esc(item.summary)}</p>
      ${item.image ? `<figure class="cl-figure"><img src="${safeUrl(item.image)}" alt="" width="1600" height="600" loading="lazy" decoding="async"></figure>` : ''}
      ${links.length ? `<div class="cl-links">${links.map(link => `<a href="${safeUrl(link.href)}">${esc(link.label)} ${icon('arrow')}</a>`).join('')}</div>` : ''}
    </li>`;
  }

  /* safe-fn: 每个条目都由 entry() 逐值转义 */
  function day(block) {
    const entries = Array.isArray(block.entries) ? block.entries : [];
    return `<section class="cl-day">
      <div class="cl-date"><h2>${esc(md(block.date))}</h2><span>${esc(year(block.date))}</span></div>
      <ol class="cl-list">
        ${entries.map(entry).join('')}
      </ol>
    </section>`;
  }

  /* safe-fn: 所有动态值来自 changelog-data.js，逐值转义或经 safeUrl */
  function view() {
    const data = window.COMMONS_CHANGELOG && typeof window.COMMONS_CHANGELOG === 'object' ? window.COMMONS_CHANGELOG : {};
    const entries = Array.isArray(data.entries) ? data.entries : [];
    const days = group(entries);
    const latest = days.length && days[0].date ? days[0].date : data.updated;
    return `<div class="cl" data-changelog-root>
      <header class="cl-head">
        <div class="cl-head-main">
          <p class="cl-kicker">只写已经能用的</p>
          <h1>更新日志</h1>
          <p class="cl-lead">按日期倒序，每条都能点开。</p>
        </div>
        <div class="cl-head-side">
          <span>最近更新</span>
          <b>${esc(md(latest) || '—')}</b>
          <a class="button ghost" href="#/hello">这里是什么 ${icon('arrow')}</a>
        </div>
      </header>
      <div class="cl-days">
        ${days.length ? days.map(day).join('') : '<p class="cl-empty">还没有记录。等第一条上线的东西接进来，这里会出现。</p>'}
      </div>
      <footer class="cl-foot">
        <p>内测版本还在变。页面上能点开的东西，都在交互预览里跑过；后端没有接上的地方会明确标「未接通」，不假装成功。</p>
        <a class="cl-back" href="#/hello">回到介绍 ${icon('arrow')}</a>
      </footer>
    </div>`;
  }

  function mount() {
    state.root = document.querySelector('[data-changelog-root]');
  }

  function destroy() {
    state.root = null;
  }

  window.CommonsChangelog = {
    routes: { changelog: view },
    nav: [['changelog', '更新日志', 'spark', 'personal']],
    titles: { changelog: '更新日志' },
    mount,
    destroy
  };
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsChangelog);
})();

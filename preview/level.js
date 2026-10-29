/* R13 LEVEL-1 · 全站等级名称、徽章、头像环与名牌。 */
(function () {
  'use strict';

  var LEVELS = {
    1: { name: '新队员', tone: 'plain', icon: '芽' },
    2: { name: '队员', tone: 'plain', icon: '–' },
    3: { name: '骨干', tone: 'core', icon: '◆' },
    4: { name: '领航员', tone: 'lead', icon: '✦' },
    5: { name: '先锋', tone: 'vanguard', icon: '✦' }
  };
  var SIZES = { xs: true, sm: true, md: true, lg: true };
  var SIZE_NAMES = { xs: '极小', sm: '小', md: '中', lg: '大' };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function normalized(level) {
    var value = Math.round(Number(level));
    return LEVELS[value] ? value : 1;
  }

  function name(level) {
    return LEVELS[normalized(level)].name;
  }

  function tone(level) {
    return LEVELS[normalized(level)].tone;
  }

  function attrs(level) {
    var value = normalized(level);
    return 'data-level="' + value + '" data-level-tone="' + LEVELS[value].tone + '"';
  }

  function ringClass(level) {
    var value = normalized(level);
    return value < 3 ? '' : 'level-ring level-ring--l' + value;
  }

  /* safe-fn: 等级、尺寸和图标均取自本文件常量；可变文案均 esc */
  function badge(level, options) {
    var value = normalized(level);
    var record = LEVELS[value];
    var config = options || {};
    var size = SIZES[config.size] ? config.size : 'sm';
    var withName = config.withName !== false;
    var icon = size === 'xs' ? '' : '<span class="level-badge-icon">' + esc(record.icon) + '</span>';
    return '<span class="level-badge level-badge--' + size + '" ' + attrs(value) +
      ' role="img" aria-label="' + SIZE_NAMES[size] + '号徽章：L' + value + ' ' + esc(record.name) + '">' +
      '<span class="level-badge-mark" aria-hidden="true"><span class="level-badge-code">L' + value + '</span>' +
      icon + '</span>' +
      (withName ? '<span class="level-badge-name">' + esc(record.name) + '</span>' : '') +
      '</span>';
  }

  /* safe-fn: badge 自行转义；姓名与账号均 esc */
  function nameplate(options) {
    var config = options || {};
    var value = normalized(config.level);
    var handle = String(config.handle || '').replace(/^@+/, '');
    return '<span class="level-nameplate" ' + attrs(value) + '>' +
      '<span class="level-nameplate-name">' + esc(config.name || '') + '</span>' +
      badge(value, { size: 'xs', withName: true }) +
      (handle ? '<span class="level-nameplate-handle">@' + esc(handle) + '</span>' : '') +
      '</span>';
  }

  window.CommonsLevel = {
    name: name,
    badge: badge,
    ringClass: ringClass,
    tone: tone,
    nameplate: nameplate,
    attrs: attrs
  };
})();

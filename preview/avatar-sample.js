/* LG-4 R2: demo-only content; excluded from live builds. */
window.COMMONS_AVATAR_SAMPLE = {
names: [
    '顾澄', '叶知', '闻溪', '程野', '陆遥', '许禾', '沈衡', '江岚', '苏晚', '白序',
    '方回', '林疏', '韩渚', '赵汀', '周澜', '吴衡', '郑桥', '冯川', '陈屿', '褚南',
    '尹策', '秦渡', '何岚', '曹野', '邓澄', '彭溯', '蒋宁', '蔡远', '丁衡', '魏岚',
    '范舟', '邹澄', '石野', '姚渡', '潘衡', '夏岚', '钟澄', '谭野', '郝渡', '龚衡'
  ],
create: function (env) {
  var LEVELS = env.LEVELS;
  var PANDAS = env.PANDAS;
  var SIZES = env.SIZES;
  var bar = env.bar;
  var esc = env.esc;
  var html = env.html;
  var meHTML = env.meHTML;
  var meLevel = env.meLevel;
  var meName = env.meName;
  var meSaved = env.meSaved;
  var memOf = env.memOf;
  var mergeCounts = env.mergeCounts;
  var stack = env.stack;
  var NAMES = env.names;
  var LAB_TARGET = 'lab-post-1';
  function labMeHTML(size) {
    if (meSaved()) return meHTML(size);
    return html({ id: 'me', name: meName(), size: size, src: 'assets/mascot/panda-avatar-brand-blue-512.webp' });
  }

  function wallPeople() {
    return NAMES.map(function (name, i) {
      return {
        id: 'm' + (i + 1),
        name: name,
        level: (i % 5) + 1,
        status: i % 11 === 0 ? 'speaking' : i % 7 === 0 ? 'room' : i % 4 === 0 ? 'online' : ''
      };
    });
  }

  /* safe-fn: CommonsLevel.badge 自行逐值转义；兜底分支逐值转义 */
  function levelCaption(lv) {
    var LV = window.CommonsLevel;
    if (LV && typeof LV.badge === 'function') return LV.badge(lv.level, { size: 'xs', withName: true });
    return 'L' + esc(String(lv.level)) + ' ' + esc(lv.name);
  }

  function labPage() {
    var people = wallPeople();
    var sizes = SIZES.map(function (n) {
      return '<figure class="ava-size-cell">' + /* safe: imported avatar view builder escapes all data values */ html({ id: 'm1', name: '顾澄', size: n, level: 2 }) + '<figcaption>' + esc(n) + '</figcaption></figure>';
    }).join('');
    var frames = LEVELS.map(function (lv) {
      return '<figure class="ava-size-cell">' + /* safe: imported avatar view builder escapes all data values */ html({ id: 'm' + lv.level, name: NAMES[lv.level - 1], size: 56, level: lv.level }) +
        '<figcaption>' + /* safe: CommonsLevel 已逐值转义 */ levelCaption(lv) + '</figcaption></figure>';
    }).join('');
    var statuses = [
      ['online', '在线'],
      ['room', '在房间里'],
      ['speaking', '正在说话']
    ].map(function (row) {
      return '<figure class="ava-size-cell">' + /* safe: imported avatar view builder escapes all data values */ html({ id: 'm2', name: '叶知', size: 56, level: 3, status: row[0] }) +
        '<figcaption>' + esc(row[1]) + '</figcaption></figure>';
    }).join('');
    var wall = people.map(function (p) {
      return '<li>' + /* safe: imported avatar view builder escapes all data values */ html({ id: p.id, name: p.name, size: 40, level: p.level, status: p.status }) +
        '<span>' + esc(p.name) + '<small>L' + esc(String(p.level)) + '</small></span></li>';
    }).join('');
    var stickers = PANDAS.map(function (p) {
      return '<li class="ava-panda"><img src="assets/mascot/panda-avatar-' + esc(p[0]) + '-512.webp" alt="" width="72" height="72" loading="lazy" decoding="async"><span>' + esc(p[1]) + '</span></li>';
    }).join('');
    var counts = { useful: 4, spark: 2, reproduced: 1 };
    mergeCounts(LAB_TARGET, counts, {});
    return '<div class="ava-lab" data-avatar-lab>' +
      '<div class="ava-lab-head"><span>选熊猫头像，或编辑自己的头像</span><div><span class="pill outline">示例</span><button type="button" class="button primary" data-ava-act="edit">编辑我的头像</button></div></div>' +
      '<div class="ava-specs">' +
      '<section class="ava-card">' +
      '<h2>我现在的头像</h2>' +
      '<div class="ava-me-row" data-ava-me>' + /* safe: imported avatar view builder escapes all data values */ labMeHTML(96) + '<div><b>' + esc(meName()) + '</b><small>L' + esc(meLevel()) + ' · 合成身份</small></div></div>' +
      '</section>' +
      '<section class="ava-card">' +
      '<h2>熊猫头像</h2>' +
      '<ul class="ava-pandas">' + stickers + '</ul>' +
      '</section>' +
      '</div>' +
      '<details class="ava-fallback"><summary>几何回退与状态样例</summary><div class="ava-specs">' +
      '<section class="ava-card">' +
      '<h2>五种尺寸</h2>' +
      '<div class="ava-row">' + sizes + '</div>' +
      '</section>' +
      '<section class="ava-card">' +
      '<h2>等级框</h2>' +
      '<div class="ava-row">' + frames + '</div>' +
      '</section>' +
      '<section class="ava-card">' +
      '<h2>状态点和一排人</h2>' +
      '<div class="ava-row">' + statuses + '<figure class="ava-size-cell ava-stack-cell">' + /* safe: imported avatar view builder escapes all data values */ stack(people.slice(0, 16), { max: 5 }) + '<figcaption>一排人</figcaption></figure></div>' +
      '</section>' +
      '</div></details>' +
      '<section class="ava-wall-block">' +
      '<h2>四十个合成成员</h2>' +
      '<ul class="ava-wall">' + wall + '</ul>' +
      '</section>' +
      '<div class="ava-specs">' +
      '<section class="ava-card">' +
      '<h2>反应条</h2>' +
      '<article class="ava-post">' +
      '<header>' + /* safe: imported avatar view builder escapes all data values */ html({ id: 'm1', name: '顾澄', size: 40, level: 2 }) +
      '<div><b>顾澄</b><small>今天 11:20</small></div></header>' +
      '<p>这个反应很有用。</p>' + /* safe: imported avatar view builder escapes all data values */ bar({ targetId: LAB_TARGET, counts: memOf(LAB_TARGET).counts, mine: memOf(LAB_TARGET).mine }) +
      '</article>' +
      '</section>' +
      '</div>' +
      '</div>';
  }

  function paintLab() {
    var root = document.querySelector('[data-avatar-lab]');
    if (!root) return;
    var host = root.querySelector('[data-ava-me]');
    if (host) {
      host.innerHTML = /* safe: avatar builder escapes all data values */ labMeHTML(96) + '<div><b>' + esc(meName()) + '</b><small>L' + esc(meLevel()) + ' · 合成身份</small></div>';
    }
  }


  return { page: labPage, paint: paintLab };
}
};

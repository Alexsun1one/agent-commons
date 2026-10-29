/* R13 ROOM-3 · 房间：列表 #/rooms、房间页 #/room/<id>。
   接口：window.CommonsRooms = { routes: { rooms, room }, mount, destroy }，自行登记 CommonsPages。
   本机预览：开始投屏走 getDisplayMedia，开麦走 getUserMedia，只在这台电脑上画画面和音量。
   不上传、不录制、不转写。取消或不支持时回到示意画面。示例数据仍挂「示例」。
   CommonsAPI.mode === 'live' 时房间状态走 /api/rooms，画面仍只留在本机。
   白板嵌 window.CommonsBoard（BOARD-1），不存在时显示占位。 */
(function () {
  'use strict';

  var KIND = { discussion: '讨论室', stage: '舞台', live: '直播', workshop: '工作坊' };
  var KIND_NOTE = {
    discussion: '所有人可以自己开麦（入场默认关），适合 20 人以内的小组。',
    stage: '听众举手、主持人批准后上台发言，可以容纳几百人。',
    live: '只有主讲人说话，上千人观看。',
    workshop: '讲师加点名学员，可以共享屏幕。'
  };
  var LEVEL = { 1: '新队员', 2: '队员', 3: '骨干', 4: '领航员', 5: '先锋' };
  var ROLE = { host: '主持人', speaker: '发言人', listener: '听众' };
  var REASONS = [['disruptive', '扰乱讨论'], ['off_topic', '长时间偏离主题'], ['spam', '刷屏或广告'],
    ['host_decision', '主持人决定']];
  var BOARD_MODES = [['host', '只有我能画'], ['speakers', '发言人能画'], ['all', '所有人能画']];
  var DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180];
  var FOLD = 24;
  var WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var PATHS = {
    mic: 'M10 3a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0v-4A2.5 2.5 0 0 1 10 3zM5.5 9.5a4.5 4.5 0 0 0 9 0M10 14v3m-3 0h6',
    micOff: 'M3 3l14 14M12.5 8.6V5.5a2.5 2.5 0 0 0-4.9-.7M7.5 9.5a2.5 2.5 0 0 0 4 2M5.5 9.5a4.5 4.5 0 0 0 7.3 3.5M14.5 9.5a4.4 4.4 0 0 1-.3 1.6M10 14v3m-3 0h6',
    hand: 'M7 10V4.8a1.3 1.3 0 0 1 2.6 0V9m0-5.6a1.3 1.3 0 0 1 2.6 0V9m0-4a1.3 1.3 0 0 1 2.6 0v5.5c0 3.6-2.2 6.5-5.4 6.5-2.3 0-3.6-1.2-4.8-3.3L3.4 10.6a1.3 1.3 0 0 1 2.2-1.3L7 11',
    leave: 'M12 4h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3M8 14l-4-4 4-4M4 10h9',
    lock: 'M6 9V6.5a4 4 0 0 1 8 0V9M5 9h10v8H5z',
    unlock: 'M6 9V6.5a4 4 0 0 1 7.7-1.5M5 9h10v8H5z',
    board: 'M3 4h14v10H3zM7 17l3-3 3 3M6 10l2.5-2.5 2 2L14 6',
    screen: 'M3 4h14v10H3zM7 17h6M10 14v3',
    full: 'M4 8V4h4M12 4h4v4M16 12v4h-4M8 16H4v-4',
    link: 'M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1',
    clock: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 6v4l2.5 2',
    users: 'M7.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM2.5 16c.4-2.6 2.4-4 5-4s4.6 1.4 5 4M13 4.2a2.5 2.5 0 0 1 0 4.6M14.5 12.3c1.5.5 2.6 1.8 3 3.7',
    crown: 'M3 14h14M4 14l-1-8 4 3 3-5 3 5 4-3-1 8',
    external: 'M11 3h6v6M17 3l-8 8M14 12v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4',
    check: 'M4 10.5l3.5 3.5L16 5.5',
    close: 'M5 5l10 10M15 5L5 15',
    plus: 'M10 4v12M4 10h12',
    back: 'M12 4l-6 6 6 6',
    queue: 'M4 6h12M4 10h8M4 14h5M14 12v5M11.5 14.5h5',
    room: 'M4 16V8.5L10 4l6 4.5V16M8 16v-4h4v4M2.5 16h15'
  };

  var S = {
    data: null,
    me: null,
    view: '',
    roomId: '',
    bound: false,
    timers: [],
    raf: 0,
    poll: 0,
    levels: {},
    conn: 'idle',
    reason: '',
    errorMsg: '',
    hostOpen: false,
    hostTrigger: null,
    confirm: null,
    boardOpen: false,
    board: null,
    boardFor: '',
    screenFit: 'fit',
    shareAudio: true,
    sharing: false,
    screenVideoTrack: null,
    screenAudioTrack: null,
    screenMediaEl: null,
    localDisplay: null,
    localMic: null,
    localVideoTrack: null,
    localScreenAudio: null,
    localMicTrack: null,
    localVideoEl: null,
    localThumbEl: null,
    localWhere: '',
    previewFor: '',
    audioCtx: null,
    micAnalyser: null,
    screenAnalyser: null,
    micSource: null,
    screenSource: null,
    bins: null,
    screenReason: '',
    micMuted: false,
    screenAudioMuted: false,
    captureSeq: 0,
    captureBusy: false,
    micBusy: false,
    follow: false,
    micOn: false,
    simOpen: true,
    live: { list: null, scheduled: null, ended: null, abilities: null, me: null, detail: null, join: null, error: null, chat: null },
    lk: null,
    lkAudio: [],
    create: null,
    estimateTimer: 0,
    chatDraft: ''
  };

  /* ------------------------------------------------------------ 基础 */

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeUrl(u) {
    var s = String(u || '');
    if (/^https?:\/\//i.test(s) || s.indexOf('#/') === 0) return esc(s);
    return '#';
  }

  function safeRoomAsset(u) {
    var s = String(u || '');
    return /^assets\/samples\/room-[a-z0-9-]+\.webp$/.test(s) ? esc(s) : '';
  }

  function icon(name) {
    var d = PATHS[name] || '';
    return '<svg class="rm-ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + esc(d) + '"/></svg>';
  }

  function avatar(p, size) {
    p = p || {};
    if (window.CommonsAvatar && typeof window.CommonsAvatar.html === 'function') {
      return window.CommonsAvatar.html({ id: p.id, name: p.name, size: size || 32, level: p.level, sample: !isLive() });
    }
    return '<span class="rm-ava-fallback" style="--rm-size:' + esc(String(size || 32)) + 'px" aria-hidden="true">' +
      esc(String(p.name || '?').charAt(0)) + '</span>';
  }

  /* safe-fn: CommonsLevel 只返回受限等级属性；降级为空串。 */
  function levelAttrs(p) {
    return window.CommonsLevel && typeof window.CommonsLevel.attrs === 'function'
      ? window.CommonsLevel.attrs((p && p.level) || 1) : '';
  }

  /* safe-fn: CommonsLinks.person / CommonsLevel.nameplate 内部逐值转义；降级分支在此转义。 */
  function levelPlate(p) {
    p = p || {};
    if (window.CommonsLinks && typeof window.CommonsLinks.person === 'function') {
      return window.CommonsLinks.person(p.handle, p.name, { level: p.level });
    }
    var plate;
    if (window.CommonsLevel && typeof window.CommonsLevel.nameplate === 'function') {
      plate = window.CommonsLevel.nameplate({ name: p.name, level: p.level, handle: p.handle });
    } else {
      plate = '<span class="rm-level-fallback"><b>' + esc(p.name || '成员') + '</b><small>L' + esc(String(p.level || 1)) + '</small></span>';
    }
    return p.handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(p.handle) + '">' + /* safe: plate is returned by a shared HTML helper or assembled with esc() above */ plate + '</a>' : plate;
  }

  function pill(text, tone) {
    return '<span class="pill ' + esc(tone || 'outline') + '">' + esc(text) + '</span>';
  }

  function sampleTag() {
    return isLive() ? '' : pill('示例', 'outline');
  }

  function meId() {
    return S.me ? S.me.id : '';
  }

  function isLive() {
    return !!(window.CommonsAPI && window.CommonsAPI.mode === 'live');
  }

  function api() {
    return window.CommonsAPI;
  }

  function reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function displayAudioSupported() {
    return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');
  }

  function toast(msg) {
    if (window.Commons && typeof window.Commons.toast === 'function') window.Commons.toast(msg);
  }

  function later(fn, ms) {
    var t = window.setTimeout(function () {
      S.timers = S.timers.filter(function (x) { return x !== t; });
      fn();
    }, ms);
    S.timers.push(t);
    return t;
  }

  function root() {
    return document.querySelector('[data-rooms-root]');
  }

  function region(name) {
    var r = root();
    return r ? r.querySelector('[data-rm-region="' + name + '"]') : null;
  }

  function setRegion(name, html) {
    var el = region(name);
    if (el) el.innerHTML = html;
  }

  function focusDescriptor() {
    var active = document.activeElement;
    if (!active || !root() || !root().contains(active) || !active.getAttribute) return null;
    return {
      act: active.getAttribute('data-room-act') || '',
      id: active.getAttribute('data-id') || '',
      host: active.getAttribute('data-host') || '',
      mode: active.getAttribute('data-mode') || '',
      field: active.getAttribute('data-room-field') || '',
      index: active.getAttribute('data-index') || ''
    };
  }

  function restoreDescriptor(keep) {
    if (!keep || !root()) return;
    var nodes = keep.field ? root().querySelectorAll('[data-room-field="' + keep.field + '"]') : root().querySelectorAll('[data-room-act="' + keep.act + '"]');
    var next = Array.prototype.find.call(nodes, function (node) {
      return node.getClientRects().length > 0 &&
        (!keep.id || node.getAttribute('data-id') === keep.id) &&
        (!keep.host || node.getAttribute('data-host') === keep.host) &&
        (!keep.mode || node.getAttribute('data-mode') === keep.mode) &&
        (!keep.index || node.getAttribute('data-index') === keep.index);
    });
    if (next && next.focus) next.focus({ preventScroll: true });
  }

  function syncHostModal(open) {
    var hp = region('hostpanel');
    if (!hp) return;
    var targets = root().querySelectorAll('[data-rm-region="banner"],[data-rm-region="head"],.rm-room,[data-rm-region="controls"],[data-rm-region="sim"]');
    Array.prototype.forEach.call(targets, function (node) {
      if (node === hp || hp.contains(node)) return;
      node.toggleAttribute('inert', !!open);
    });
  }

  function hashId() {
    var parts = location.hash.replace(/^#\/?/, '').split('/');
    return parts[0] === 'room' ? decodeURIComponent(parts[1] || '') : '';
  }

  /* ------------------------------------------------------------ 时间 */

  function ts(iso) {
    return Date.parse(iso) || 0;
  }

  function two(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function clockText(iso) {
    var d = new Date(ts(iso));
    return two(d.getHours()) + ':' + two(d.getMinutes());
  }

  function dayText(iso) {
    var d = new Date(ts(iso));
    var today = new Date();
    var start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    var diff = Math.floor((d.getTime() - start) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    return (d.getMonth() + 1) + '.' + d.getDate() + ' ' + WEEK[d.getDay()];
  }

  function minutesFrom(iso) {
    return Math.round((ts(iso) - Date.now()) / 60000);
  }

  function isoIn(min) {
    return new Date(Date.now() + min * 60000).toISOString();
  }

  /* ------------------------------------------------------------ 示例数据 → 视图模型 */

  function demo() {
    if (S.data) return S.data;
    var src = window.COMMONS_ROOMS_SAMPLE || { me: { id: 'me', name: '我', level: 3, roles: [] }, people: [], rooms: [] };
    var copy = JSON.parse(JSON.stringify(src));
    copy.rooms.forEach(function (r) {
      r.startsAt = isoIn(r.startOffsetMin);
      r.endsAt = isoIn(r.startOffsetMin + r.duration);
      r.speakers = r.speakers || [];
      r.listeners = r.listeners || [];
      r.queue = r.queue || [];
      r.agenda = r.agenda || [];
      r.materials = r.materials || [];
      r.chat = (r.chat || []).map(function (c) { return { id: c.id, text: c.text, at: isoIn(c.min) }; });
      r.extended = 0;
      r.removed = {};
      r.signupQueue = r.signups ? [] : [];
      r.screenShare = r.screenShare || { activeId: null, shareAudio: true, pending: [] };
      r.stageMode = r.stageMode || 'screen';
    });
    S.data = copy;
    S.me = copy.me;
    return copy;
  }

  function people() {
    var map = {};
    (demo().people || []).forEach(function (p) { map[p.id] = p; });
    return map;
  }

  function person(id) {
    return people()[id] || { id: id, name: '成员', level: 1 };
  }

  function demoRoom(id) {
    var list = demo().rooms;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function capFor(me) {
    var caps = demo().caps || [];
    var best = 0;
    caps.forEach(function (c) {
      var ok = (c.min_level && me.level >= c.min_level) || (c.role && (me.roles || []).indexOf(c.role) >= 0);
      if (ok && c.max_minutes > best) best = c.max_minutes;
    });
    if (!best && caps.length) best = Math.min.apply(null, caps.map(function (c) { return c.max_minutes; }));
    return best;
  }

  function demoAbilities() {
    var d = demo();
    var me = S.me;
    var kinds = ['discussion', 'stage', 'live', 'workshop'].map(function (k) {
      var rule = (d.rules || {})[k];
      if (!rule) return { kind: k, allowed: false, reason: 'step_two', need: null };
      var roleOk = (me.roles || []).some(function (r) { return rule.roles.indexOf(r) >= 0; });
      var allowed = me.level >= rule.level || roleOk;
      return { kind: k, allowed: allowed, reason: allowed ? null : 'action_not_allowed',
        need: { level: rule.level, roles: rule.roles }, duration_cap: allowed ? capFor(me) : null,
        capacity: rule.capacity };
    });
    return { level: me.level, roles: me.roles || [], kinds: kinds, link_hosts: d.linkHosts || [] };
  }

  function myRoleIn(r) {
    var meId = S.me.id;
    if (r.hostId === meId) return 'host';
    for (var i = 0; i < r.speakers.length; i++) if (r.speakers[i].id === meId) return r.speakers[i].role;
    return 'listener';
  }

  function visibleMaterial(m) {
    if (m.kind !== 'object') return true;
    var k = (demo().knowledge || []).filter(function (x) { return x.id === m.ref; })[0];
    return !!k && S.me.level >= (k.minLevel || 1);
  }

  function fromSample(r) {
    var role = myRoleIn(r);
    var isHost = role === 'host';
    var meId = S.me.id;
    var listeners = r.listeners.filter(function (id) { return id !== meId && !r.removed[id]; });
    var inRoom = r.state === 'live';
    if (inRoom && role === 'listener') listeners = [meId].concat(listeners);
    var speakers = r.speakers.filter(function (s) { return !r.removed[s.id]; });
    if (speakers.every(function (s) { return s.id !== r.hostId; })) {
      speakers = [{ id: r.hostId, role: 'host', speaking: false }].concat(speakers);
    }
    var mine = r.queue.filter(function (q) { return q.id === meId; })[0];
    var meSpeaker = speakers.filter(function (s) { return s.id === meId; })[0];
    var mats = r.materials.filter(visibleMaterial).map(function (m) {
      if (m.kind === 'object') {
        var k = (demo().knowledge || []).filter(function (x) { return x.id === m.ref; })[0];
        return { kind: 'object', title: k.title, type: k.type, ref: k.id };
      }
      return m;
    });
    var admitted = isHost || !r.access.some(function (a) { return a.kind === 'signup'; }) || r.mySignup === 'approved';
    return {
      id: r.id, kind: r.kind, title: r.title, summary: r.summary, background: r.background || '', provider: r.provider,
      host: person(r.hostId), state: r.state, startsAt: r.startsAt, endsAt: r.endsAt,
      durationMin: r.duration + r.extended, locked: !!r.locked, selfUnmute: !!r.selfUnmute,
      boardMode: r.boardMode || 'host', stageMode: r.stageMode || 'screen', capacity: r.kind === 'stage' ? 500 : 20,
      speakers: speakers.map(function (s) {
        var p = person(s.id);
        return { id: s.id, name: p.name, level: p.level, role: s.role, muted: !!s.muted,
          speaking: !!s.speaking && !s.muted && r.state === 'live' };
      }),
      listeners: listeners.map(person),
      listenerCount: listeners.length + (r.extraListeners || 0),
      presentCount: speakers.length + listeners.length + (r.extraListeners || 0),
      queue: (isHost ? r.queue : (mine ? [mine] : [])).map(function (q) { return { person: person(q.id), state: q.state }; }),
      raisedCount: r.queue.filter(function (q) { return q.state === 'raised'; }).length,
      signups: isHost ? (r.signupQueue || []).map(person) : [],
      agenda: r.agenda.map(function (a) { return { title: a.title, minutes: a.minutes, state: a.state }; }),
      materials: mats,
      access: r.access,
      external: r.provider === 'external_link' && admitted && r.state !== 'ended'
        ? { url: r.externalUrl, label: r.externalLabel } : null,
      externalLabel: r.externalLabel || '',
      me: { role: role, present: inRoom, muted: !!(meSpeaker && meSpeaker.muted), hand: mine ? mine.state : null,
        signup: r.mySignup || null, admitted: admitted, isHost: isHost },
      signupRequired: r.access.some(function (a) { return a.kind === 'signup'; }),
      mySignup: r.mySignup || null,
      screenShare: {
        active: r.screenShare.activeId ? person(r.screenShare.activeId) : null,
        shareAudio: !!r.screenShare.shareAudio,
        requests: (isHost ? (r.screenShare.pending || []) : []).map(person),
        mine: r.screenShare.activeId === meId ? 'active' : (r.screenShare.pending || []).indexOf(meId) >= 0 ? 'pending' : 'none',
        sample: r.screenShare.sample || ''
      },
      recording: { state: 'not_recorded', screen_track: null, audio_tracks: [], talk_id: null },
      minutes: { state: 'none' },
      policy: { canExtend: isHost && !r.extendedOnce && capFor(S.me) > r.duration + r.extended,
        extendLeft: Math.max(0, capFor(S.me) - r.duration - r.extended) },
      series: r.series || null,
      chat: r.chat,
      signupCount: r.signups || 0,
      attended: r.attended || 0
    };
  }

  function fromApi(d) {
    var me = d.me || {};
    var speakers = (d.participants || []).filter(function (p) { return p.role !== 'listener'; });
    var listeners = (d.participants || []).filter(function (p) { return p.role === 'listener'; });
    if (!d.participants) speakers = d.speakers || [];
    return {
      id: d.id, kind: d.kind, title: d.title, summary: d.summary, background: '', provider: d.provider, host: d.host,
      state: d.state, startsAt: d.starts_at, endsAt: d.ends_at, durationMin: d.duration_min, locked: !!d.locked,
      selfUnmute: !!d.self_unmute, boardMode: d.board_mode || 'host', stageMode: d.stage_mode || 'screen', capacity: d.capacity,
      speakers: speakers.map(function (s) {
        return { id: s.id, name: s.name, level: s.level, role: s.role, muted: !!s.muted,
          speaking: !s.muted && !!S.levels[s.id] && d.state === 'live' };
      }),
      listeners: listeners,
      listenerCount: d.listener_count != null ? d.listener_count : listeners.length,
      presentCount: d.present_count || 0,
      queue: (d.queue || []).map(function (q) { return { person: q.principal, state: q.state }; }),
      raisedCount: d.raised_count || 0,
      signups: d.signups || [],
      agenda: d.agenda || [],
      materials: d.materials || [],
      access: d.access || [],
      external: d.external || null,
      externalLabel: d.external_label || '',
      me: { role: me.role, present: !!me.present, muted: !!me.muted, hand: me.hand, signup: me.signup,
        admitted: !!me.admitted, isHost: !!me.is_host || !!d.is_host },
      signupRequired: !!d.signup_required,
      mySignup: d.my_signup || null,
      screenShare: {
        active: d.screen_share && d.screen_share.active ? d.screen_share.active.principal : null,
        shareAudio: !!(d.screen_share && d.screen_share.active && d.screen_share.active.share_audio),
        requests: d.screen_share ? (d.screen_share.requests || []).map(function (x) { return x.principal; }) : [],
        mine: d.screen_share ? d.screen_share.mine : 'none',
        sample: ''
      },
      recording: d.recording || { state: 'not_recorded' },
      minutes: d.minutes || { state: 'none' },
      policy: { canExtend: !!(d.policy && d.policy.can_extend), extendLeft: (d.policy && d.policy.extend_left_min) || 0 },
      reminders: d.reminders || {},
      series: d.series || null,
      chat: null,
      signupCount: 0,
      attended: 0
    };
  }

  /* ------------------------------------------------------------ 列表页 */

  function listShell() {
    return '<div class="rm" data-rooms-root data-rm-view="list">' +
      '<div class="rm-head"><p>想聊就开个房间，想听就进。</p>' +
      '<div class="rm-head-actions">' + sampleTag() + '<span data-rm-region="head-actions"></span></div></div>' +
      '<div data-rm-region="list">' + (isLive() ? skeleton() : '') + '</div>' +
      '<dialog class="rm-dialog" data-rm-dialog aria-labelledby="rm-create-title"><div data-rm-region="dialog"></div></dialog>' +
      '</div>';
  }

  function skeleton() {
    return '<div class="rm-skeleton" role="status" aria-busy="true" aria-label="正在加载"><i></i><i></i><i></i></div>';
  }

  function errorBox(msg, act) {
    return '<div class="rm-state" data-tone="danger" role="alert"><b>没能加载</b><p>' + esc(msg || '服务器出错了') +
      '。原来的数据没有动，可以再试一次。</p><button type="button" class="button" data-room-act="' + esc(act || 'reload') +
      '">重试</button></div>';
  }

  function isClosed(err) {
    return !!(err && (err.status === 501 || err.code === 'capability_unavailable'));
  }

  function closedBox() {
    return '<div class="rm-state" role="status"><b>这个功能还没开放</b><p>需要部署方配置音视频服务。</p></div>';
  }

  function paintList() {
    var abilities;
    var live;
    var soon;
    var ended;
    if (isLive()) {
      if (S.live.error) {
        setRegion('list', isClosed(S.live.error) ? closedBox() : errorBox(S.live.error.message));
        return;
      }
      if (!S.live.list) {
        setRegion('list', skeleton());
        return;
      }
      abilities = S.live.abilities;
      live = S.live.list.map(fromApi);
      soon = S.live.scheduled.map(fromApi);
      ended = (S.live.ended || []).map(fromApi);
    } else {
      demo();
      abilities = demoAbilities();
      var all = demo().rooms.map(fromSample);
      live = all.filter(function (r) { return r.state === 'live'; });
      soon = all.filter(function (r) { return r.state === 'scheduled'; }).sort(function (a, b) { return ts(a.startsAt) - ts(b.startsAt); });
      ended = all.filter(function (r) { return r.state === 'ended'; });
    }
    var canCreate = abilities.kinds.some(function (k) { return k.allowed; });
    setRegion('head-actions', canCreate
      ? '<button type="button" class="button primary" data-room-act="create-open">' + icon('plus') + '<span>建房</span></button>'
      : '<a class="button tonal" href="#rm-can-build">看看我能建什么</a>');
    var html = '<section class="rm-sec" aria-labelledby="rm-live-h"><div class="rm-sec-head"><h2 id="rm-live-h">正在开</h2>' +
      '<small>' + esc(String(live.length)) + ' 个房间</small></div>' +
      (live.length ? '<div class="rm-live-grid">' + live.map(liveCard).join('') + '</div>'
        : emptyBox('现在没有正在开的房间', canCreate ? '你可以开一个，或者给「待会儿开」的房间报名。' : '给「待会儿开」的房间报个名，到点会提醒你。')) +
      '</section>' +
      '<section class="rm-sec" aria-labelledby="rm-soon-h"><div class="rm-sec-head"><h2 id="rm-soon-h">待会儿开</h2>' +
      '<small>开始前 10 分钟提醒</small></div>' +
      (soon.length ? '<ol class="rm-soon">' + soon.map(soonRow).join('') + '</ol>'
        : emptyBox('还没有排上的房间', '每周例会排好以后会出现在这里。')) +
      '</section>' +
      buildSection(abilities) +
      (ended.length ? '<section class="rm-sec" aria-labelledby="rm-ended-h"><div class="rm-sec-head"><h2 id="rm-ended-h">刚结束</h2></div>' +
        '<ul class="rm-ended">' + ended.map(endedRow).join('') + '</ul></section>' : '');
    setRegion('list', html);
    ensureRaf();
  }

  function emptyBox(title, text) {
    return '<div class="rm-empty"><b>' + esc(title) + '</b><p>' + esc(text) + '</p></div>';
  }

  function speakerAva(s, size) {
    return '<span class="rm-spk" data-speaking="' + (s.speaking ? 'true' : 'false') + '">' +
      (s.speaking ? '<i class="rm-ring" data-rm-level="' + esc(s.id) + '" aria-hidden="true"></i>' : '') +
      avatar(s, size) +
      (s.muted ? '<span class="rm-muted-badge" title="已静音">' + icon('micOff') + '</span>' : '') +
      '</span>';
  }

  function liveCard(r) {
    var listening = Math.max(0, r.presentCount - r.speakers.length);
    var speaking = r.speakers.filter(function (s) { return s.speaking; });
    var art = safeRoomAsset(r.background);
    return '<article class="rm-card" data-kind="' + esc(r.kind) + '">' +
      (art ? '<img class="rm-card-art" src="' + window.Commons.safeUrl(art) + '" alt="" loading="lazy" aria-hidden="true">' : '') +
      '<div class="rm-card-top">' + pill(KIND[r.kind], r.kind === 'stage' ? 'accent' : 'info') +
      (r.provider === 'external_link' ? pill('音视频在' + (r.externalLabel || '外部会议'), 'gray') : '') +
      (r.locked ? pill('已锁房', 'notice') : '') +
      '<small class="rm-elapsed">' + icon('clock') + '开了 ' + esc(String(Math.max(0, -minutesFrom(r.startsAt)))) + ' 分钟</small></div>' +
      '<h3><a href="#/room/' + esc(r.id) + '">' + esc(r.title) + '</a></h3>' +
      '<div class="rm-card-host" ' + /* safe: CommonsLevel attrs 是受限枚举 */ levelAttrs(r.host) + '>主持 ' +
      /* safe: CommonsLevel nameplate 已逐值转义 */ levelPlate(r.host) +
      (r.series ? '<span>每周例会第 ' + esc(String(r.series.index)) + ' 场</span>' : '') + '</div>' +
      '<div class="rm-card-stage">' +
      '<div class="rm-spk-row">' + r.speakers.slice(0, 5).map(function (s) { return speakerAva(s, 40); }).join('') + '</div>' +
      '<div class="rm-card-count"><b>' + esc(String(listening)) + '</b><span>人在听</span>' +
      (speaking.length ? '<small>' + esc(speaking.map(function (s) { return s.name; }).join('、')) + ' 正在说</small>' : '') +
      '</div></div>' +
      '<div class="rm-card-foot"><a class="button primary small" href="#/room/' + esc(r.id) + '">进房</a></div>' +
      '</article>';
  }

  function signupButton(r) {
    if (r.me.isHost) return '<span class="pill accent">你主持</span>';
    if (r.mySignup === 'approved') {
      return '<button type="button" class="button small tonal" data-room-act="signup-withdraw" data-id="' + esc(r.id) +
        '" aria-pressed="true">' + icon('check') + '<span>已报名</span></button>';
    }
    if (r.mySignup === 'pending') return '<span class="pill notice">等主持人批准</span>';
    if (r.mySignup === 'rejected') return '<span class="pill gray">报名没通过</span>';
    return '<button type="button" class="button small" data-room-act="signup" data-id="' + esc(r.id) + '">' +
      (r.signupRequired ? '报名（需审核）' : '报名') + '</button>';
  }

  function soonRow(r) {
    var mins = minutesFrom(r.startsAt);
    var art = safeRoomAsset(r.background);
    return '<li class="rm-soon-row">' +
      (art ? '<img class="rm-soon-art" src="' + window.Commons.safeUrl(art) + '" alt="" loading="lazy" aria-hidden="true">' : '') +
      '<div class="rm-when"><b>' + esc(clockText(r.startsAt)) + '</b><small>' + esc(dayText(r.startsAt)) + '</small></div>' +
      '<div class="rm-soon-main"><div class="rm-soon-title"><a href="#/room/' + esc(r.id) + '">' + esc(r.title) + '</a>' +
      pill(KIND[r.kind], 'gray') + (r.series ? pill('每周 · 第 ' + r.series.index + (r.series.total ? '/' + r.series.total : '') + ' 场', 'info') : '') + '</div>' +
      '<small>主持 <span ' + /* safe: CommonsLevel attrs 是受限枚举 */ levelAttrs(r.host) + '>' +
      /* safe: CommonsLevel nameplate 已逐值转义 */ levelPlate(r.host) + '</span> · ' + esc(String(r.durationMin)) + ' 分钟' +
      (r.provider === 'external_link' ? ' · 音视频在' + esc(r.externalLabel || '外部会议') : '') +
      (r.signupCount ? ' · 已有 ' + esc(String(r.signupCount)) + ' 人报名' : '') +
      (mins >= 0 && mins <= 10 ? ' · <b class="rm-soon-alert">' + esc(String(mins)) + ' 分钟后开始</b>' : '') +
      '</small></div>' +
      '<div class="rm-soon-act">' + signupButton(r) + '</div></li>';
  }

  function endedRow(r) {
    return '<li><a href="#/room/' + esc(r.id) + '"><span>' + esc(r.title) + '</span><small>' + esc(dayText(r.startsAt)) +
      ' · ' + esc(KIND[r.kind]) + ' · 本场未录制</small></a></li>';
  }

  function needText(k, ab) {
    if (k.reason === 'step_two') return '第二步再开放。';
    if (k.reason === 'capability_unavailable') return '房间功能还没打开。';
    if (!k.need) return '';
    var parts = [];
    if (k.need.level) parts.push('升到 L' + k.need.level + ' ' + LEVEL[k.need.level] + '（你现在是 L' + ab.level + ' ' + LEVEL[ab.level] + '）');
    if (k.need.roles && k.need.roles.length) {
      parts.push('或者被任命为' + k.need.roles.map(function (r) { return r === 'host' ? '主持人' : r === 'lecturer' ? '讲师' : r; }).join('、'));
    }
    return '还差：' + parts.join('，') + '。';
  }

  function buildSection(ab) {
    var cards = ab.kinds.map(function (k) {
      var later2 = k.reason === 'step_two';
      return '<article class="rm-build" data-allowed="' + (k.allowed ? 'true' : 'false') + '" data-later="' + (later2 ? 'true' : 'false') + '">' +
        '<div class="rm-build-top"><h3>' + esc(KIND[k.kind]) + '</h3>' +
        (k.allowed ? pill('能建', 'success') : later2 ? pill('第二步', 'gray') : pill('还不能建', 'outline')) + '</div>' +
        '<p>' + esc(KIND_NOTE[k.kind]) + '</p>' +
        (k.allowed
          ? '<small>单场最长 ' + esc(String(k.duration_cap)) + ' 分钟 · 最多 ' + esc(String(k.capacity || '')) + ' 人</small>' +
            '<button type="button" class="button small" data-room-act="create-open" data-kind="' + esc(k.kind) + '">建' + esc(KIND[k.kind]) + '</button>'
          : '<small>' + esc(needText(k, ab)) + '</small>' +
            (later2 ? '' : '<a class="rm-link" href="#/growth">看怎么升级</a>')) +
        '</article>';
    }).join('');
    var who = isLive() ? '' :
      '<div class="rm-as" role="group" aria-label="以谁的身份看（示例）"><small>以谁的身份看</small><div class="segmented small" role="group" aria-label="示例身份">' +
      [['2', 'L2 队员'], ['3', 'L3 骨干'], ['4', 'L4 领航员'], ['host', '主持人']].map(function (o) {
        var on = o[0] === 'host' ? (S.me.roles || []).indexOf('host') >= 0 : (S.me.roles || []).indexOf('host') < 0 && String(S.me.level) === o[0];
        return '<button type="button" aria-pressed="' + (on ? 'true' : 'false') + '" data-room-act="as" data-id="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
      }).join('') + '</div>' + sampleTag() + '</div>';
    return '<section class="rm-sec" id="rm-can-build" aria-labelledby="rm-build-h"><div class="rm-sec-head"><h2 id="rm-build-h">我能建</h2>' +
      '<small>建房权限跟着等级走，规则写在规则表里，治理员可以调</small></div>' + who +
      '<div class="rm-build-grid">' + cards + '</div></section>';
  }

  /* ------------------------------------------------------------ 建房对话框 */

  function newForm(kind) {
    var start = new Date(Date.now() + 10 * 60000);
    start.setMinutes(Math.ceil(start.getMinutes() / 5) * 5, 0, 0);
    var local = start.getFullYear() + '-' + two(start.getMonth() + 1) + '-' + two(start.getDate()) + 'T' +
      two(start.getHours()) + ':' + two(start.getMinutes());
    return {
      kind: kind || 'discussion', title: '', summary: '', startsAt: local, duration: 30, repeat: false, repeatCount: 4,
      access: { level: false, minLevel: 2, space: false, spaceId: '', invite: false, invitees: [], inviteText: '', signup: false },
      selfUnmute: true, provider: 'livekit', externalUrl: '', agenda: [{ title: '', minutes: 10 }],
      errors: {}, busy: false, estimate: null, serverError: ''
    };
  }

  function abilitiesNow() {
    return isLive() ? S.live.abilities : demoAbilities();
  }

  function kindAbility(kind) {
    var ab = abilitiesNow();
    return ab ? ab.kinds.filter(function (k) { return k.kind === kind; })[0] : null;
  }

  function openCreate(kind) {
    var ab = abilitiesNow();
    if (!ab) return;
    var first = ab.kinds.filter(function (k) { return k.allowed; })[0];
    var k = kindAbility(kind);
    S.create = newForm(k && k.allowed ? kind : first ? first.kind : 'discussion');
    paintDialog();
    var dlg = root() && root().querySelector('[data-rm-dialog]');
    if (dlg && !dlg.open && typeof dlg.showModal === 'function') dlg.showModal();
    estimate();
    var title = dlg && dlg.querySelector('[data-room-field="title"]');
    if (title) title.focus();
  }

  function closeCreate() {
    var dlg = root() && root().querySelector('[data-rm-dialog]');
    if (dlg && dlg.open) dlg.close();
    S.create = null;
  }

  function mySpaces() {
    if (isLive()) return (S.live.me && S.live.me.spaces || []).map(function (s) { return { id: s.id, name: s.name, members: null }; });
    return demo().spaces || [];
  }

  function capNow() {
    var k = S.create && kindAbility(S.create.kind);
    return (k && k.duration_cap) || 60;
  }

  function accessList(f) {
    var out = [{ kind: 'members' }];
    if (f.access.level) out.push({ kind: 'level', min_level: Number(f.access.minLevel) });
    if (f.access.space && f.access.spaceId) out.push({ kind: 'space', space_id: f.access.spaceId });
    if (f.access.invite) out.push({ kind: 'invite', principal_ids: inviteIds(f) });
    if (f.access.signup) out.push({ kind: 'signup' });
    return out;
  }

  function inviteIds(f) {
    if (!isLive()) return f.access.invitees.slice();
    return f.access.inviteText.split(/[\s,，]+/).filter(Boolean);
  }

  function demoEstimate(f) {
    var d = demo();
    var pop = d.population || { total: 0, byLevel: {} };
    var n = pop.total;
    if (f.access.level) {
      n = 0;
      Object.keys(pop.byLevel).forEach(function (lv) { if (Number(lv) >= Number(f.access.minLevel)) n += pop.byLevel[lv]; });
    }
    if (f.access.space) {
      var sp = (d.spaces || []).filter(function (s) { return s.id === f.access.spaceId; })[0];
      n = sp ? Math.round(sp.members * n / Math.max(1, pop.total)) : 0;
    }
    if (f.access.invite) n = Math.min(n, f.access.invitees.length);
    return n;
  }

  function estimate() {
    var f = S.create;
    if (!f) return;
    if (!isLive()) {
      f.estimate = demoEstimate(f);
      paintEstimate();
      return;
    }
    if (S.estimateTimer) window.clearTimeout(S.estimateTimer);
    S.estimateTimer = window.setTimeout(function () {
      S.estimateTimer = 0;
      api().post('/rooms/estimate', { access: accessList(f).filter(function (a) { return a.kind !== 'invite' || a.principal_ids.length; }) })
        .then(function (r) {
          if (S.create !== f) return;
          f.estimate = r.data.count;
          paintEstimate();
        }, function () {
          if (S.create !== f) return;
          f.estimate = null;
          paintEstimate();
        });
    }, 400);
  }

  function paintEstimate() {
    var el = root() && root().querySelector('[data-rm-estimate]');
    if (!el || !S.create) return;
    var n = S.create.estimate;
    el.innerHTML = n == null ? '正在估算能进的人数…' : '大约 <b>' + esc(String(n)) + '</b> 人能进' +
      (S.create.access.signup ? '，报名后还要你批准' : '');
  }

  function fieldError(f, key) {
    return f.errors[key] ? '<small class="field-error" id="rm-err-' + esc(key) + '">' + esc(f.errors[key]) + '</small>' : '';
  }

  function kindOption(k, f) {
    var ab = kindAbility(k);
    var allowed = ab && ab.allowed;
    var later2 = ab && ab.reason === 'step_two';
    return '<label class="rm-kind-opt" data-disabled="' + (allowed ? 'false' : 'true') + '">' +
      '<input type="radio" name="rm-kind" value="' + esc(k) + '" data-room-field="kind"' +
      (f.kind === k ? ' checked' : '') + (allowed ? '' : ' disabled') + '>' +
      '<span><b>' + esc(KIND[k]) + '</b><small>' + esc(later2 ? '第二步' : allowed ? KIND_NOTE[k] : needText(ab, abilitiesNow())) + '</small></span></label>';
  }

  function paintDialog() {
    var f = S.create;
    if (!f) return;
    var cap = capNow();
    var spaces = mySpaces();
    var agendaSum = f.agenda.reduce(function (s, a) { return s + (Number(a.minutes) || 0); }, 0);
    var html = '<form class="rm-form" data-rm-form novalidate>' +
      '<header class="rm-dialog-head"><h2 id="rm-create-title">建房</h2>' + sampleTag() +
      '<button type="button" class="button ghost icon-only" data-room-act="create-close" aria-label="关闭">' + icon('close') + '</button></header>' +
      '<div class="rm-dialog-body">' +
      '<fieldset class="rm-fs"><legend>类型</legend><div class="rm-kinds">' +
      ['discussion', 'stage', 'live', 'workshop'].map(function (k) { return kindOption(k, f); }).join('') + '</div></fieldset>' +
      '<div class="field"><label for="rm-f-title">标题</label><input id="rm-f-title" data-room-field="title" maxlength="80" required value="' + esc(f.title) + '" placeholder="比如：周五 Agent 验收清单"' +
      (f.errors.title ? ' aria-invalid="true" aria-describedby="rm-err-title"' : '') + '>' + fieldError(f, 'title') + '</div>' +
      '<div class="field"><label for="rm-f-summary">简介</label><textarea id="rm-f-summary" data-room-field="summary" maxlength="500" rows="3" placeholder="这场聊什么、适合谁来">' + esc(f.summary) + '</textarea></div>' +
      '<div class="rm-row2"><div class="field"><label for="rm-f-start">开始时间</label><input id="rm-f-start" type="datetime-local" data-room-field="startsAt" value="' + esc(f.startsAt) + '"' +
      (f.errors.startsAt ? ' aria-invalid="true" aria-describedby="rm-err-startsAt"' : '') + '>' + fieldError(f, 'startsAt') + '</div>' +
      '<div class="field"><label for="rm-f-dur">时长</label><select id="rm-f-dur" data-room-field="duration"' +
      (f.errors.duration ? ' aria-invalid="true" aria-describedby="rm-err-duration"' : '') + '>' +
      DURATIONS.map(function (m) {
        return '<option value="' + esc(String(m)) + '"' + (m === Number(f.duration) ? ' selected' : '') + (m > cap ? ' disabled' : '') + '>' +
          esc(String(m)) + ' 分钟' + (m > cap ? '（超过上限）' : '') + '</option>';
      }).join('') + '</select><small>你单场最长 ' + esc(String(cap)) + ' 分钟；到点前 5 分钟提醒，可以延长一次</small>' + fieldError(f, 'duration') + '</div></div>' +
      '<label class="rm-check"><input type="checkbox" data-room-field="repeat"' + (f.repeat ? ' checked' : '') + '><span>每周重复（例会）</span></label>' +
      (f.repeat ? '<div class="field rm-indent"><label for="rm-f-rep">一次排几场</label><select id="rm-f-rep" data-room-field="repeatCount">' +
        [2, 4, 6, 8, 12].map(function (n) { return '<option value="' + esc(String(n)) + '"' + (n === Number(f.repeatCount) ? ' selected' : '') + '>' + esc(String(n)) + ' 场</option>'; }).join('') +
        '</select><small>每周同一时间，各场的议程可以分别改</small></div>' : '') +
      '<fieldset class="rm-fs"><legend>谁能进</legend><p class="rm-fs-note">勾上的条件都要满足；主持人自己总能进。</p>' +
      '<label class="rm-check"><input type="checkbox" checked disabled><span>全体成员（基础条件）</span></label>' +
      '<label class="rm-check"><input type="checkbox" data-room-field="access.level"' + (f.access.level ? ' checked' : '') + '><span>等级门槛</span></label>' +
      (f.access.level ? '<div class="rm-indent"><select aria-label="最低等级" data-room-field="access.minLevel">' +
        [1, 2, 3, 4, 5].map(function (lv) { return '<option value="' + esc(String(lv)) + '"' + (lv === Number(f.access.minLevel) ? ' selected' : '') + '>L' + esc(String(lv)) + ' ' + esc(LEVEL[lv]) + ' 及以上</option>'; }).join('') +
        '</select></div>' : '') +
      '<label class="rm-check"><input type="checkbox" data-room-field="access.space"' + (f.access.space ? ' checked' : '') + (spaces.length ? '' : ' disabled') + '><span>空间成员' + (spaces.length ? '' : '（你还不在任何空间里）') + '</span></label>' +
      (f.access.space ? '<div class="rm-indent"><select aria-label="哪个空间" data-room-field="access.spaceId"' +
        (f.errors.space ? ' aria-invalid="true" aria-describedby="rm-err-space"' : '') + '><option value="">选一个你所在的空间</option>' +
        spaces.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === f.access.spaceId ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') +
        '</select>' + fieldError(f, 'space') + '</div>' : '') +
      '<label class="rm-check"><input type="checkbox" data-room-field="access.invite"' + (f.access.invite ? ' checked' : '') + '><span>邀请名单</span></label>' +
      (f.access.invite ? inviteEditor(f) : '') +
      '<label class="rm-check"><input type="checkbox" data-room-field="access.signup"' + (f.access.signup ? ' checked' : '') + '><span>报名审核（等候室，你批准后才能进）</span></label>' +
      '<p class="rm-estimate" data-rm-estimate aria-live="polite"></p></fieldset>' +
      '<fieldset class="rm-fs"><legend>发言</legend>' +
      (f.kind === 'discussion'
        ? '<label class="rm-check"><input type="checkbox" data-room-field="selfUnmute"' + (f.selfUnmute ? ' checked' : '') + '><span>允许自己开麦（入场默认关）</span></label>'
        : '<p class="rm-fs-note">舞台：听众举手，你批准后上台；你也可以直接邀请某个人发言。</p>') +
      '</fieldset>' +
      '<fieldset class="rm-fs"><legend>音视频在哪开</legend><div class="segmented" role="group" aria-label="音视频提供方">' +
      [['livekit', '站内房间'], ['external_link', '外部会议链接']].map(function (o) {
        return '<button type="button" aria-pressed="' + (f.provider === o[0] ? 'true' : 'false') + '" data-room-act="provider" data-id="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
      }).join('') + '</div>' +
      (f.provider === 'external_link'
        ? '<div class="field"><label for="rm-f-url">会议链接</label><input id="rm-f-url" type="url" inputmode="url" data-room-field="externalUrl" value="' + esc(f.externalUrl) + '" placeholder="https://meeting.tencent.com/dm/…"' +
          (f.errors.externalUrl ? ' aria-invalid="true" aria-describedby="rm-err-externalUrl"' : '') + '>' +
          '<small>外部会议只负责音视频。</small>' + fieldError(f, 'externalUrl') + '</div>'
        : '<p class="rm-fs-note">站内房间用自建的音视频服务；进房默认只听，麦克风由本人打开。</p>') +
      '</fieldset>' +
      '<fieldset class="rm-fs"><legend>议程</legend><ol class="rm-agenda-edit"' +
      (f.errors.agenda ? ' aria-invalid="true" aria-describedby="rm-err-agenda"' : '') + '>' +
      f.agenda.map(function (a, i) {
        return '<li><input aria-label="第 ' + esc(String(i + 1)) + ' 条议程" data-room-field="agenda.title" data-index="' + esc(String(i)) + '" maxlength="80" value="' + esc(a.title) + '" placeholder="这一段聊什么"' +
          (f.errors.agenda && i === 0 ? ' aria-invalid="true" aria-describedby="rm-err-agenda"' : '') + '>' +
          '<input aria-label="预计分钟" type="number" min="1" max="180" data-room-field="agenda.minutes" data-index="' + esc(String(i)) + '" value="' + esc(String(a.minutes)) + '"><span>分钟</span>' +
          '<button type="button" class="button ghost small icon-only" data-room-act="agenda-del" data-index="' + esc(String(i)) + '" aria-label="删掉这条">' + icon('close') + '</button></li>';
      }).join('') + '</ol>' +
      '<div class="rm-agenda-foot"><button type="button" class="button ghost small" data-room-act="agenda-add"' + (f.agenda.length >= 20 ? ' disabled' : '') + '>' + icon('plus') + '<span>加一条</span></button>' +
      '<small' + (agendaSum > Number(f.duration) ? ' class="field-error"' : '') + '>合计 ' + esc(String(agendaSum)) + ' / ' + esc(String(f.duration)) + ' 分钟</small></div>' + fieldError(f, 'agenda') +
      '</fieldset>' +
      (f.serverError ? '<p class="rm-form-error" role="alert">' + esc(f.serverError) + '</p>' : '') +
      '</div><footer class="rm-dialog-foot"><button type="button" class="button ghost" data-room-act="create-close">取消</button>' +
      '<button type="submit" class="button primary"' + (f.busy ? ' aria-busy="true"' : '') + '>' + (f.repeat ? '排好 ' + esc(String(f.repeatCount)) + ' 场例会' : '建房') + '</button></footer></form>';
    setRegion('dialog', html);
    paintEstimate();
  }

  function inviteEditor(f) {
    if (isLive()) {
      return '<div class="field rm-indent"><label for="rm-f-inv">成员编号</label><textarea id="rm-f-inv" rows="2" data-room-field="access.inviteText" placeholder="一行一个，或用逗号隔开"' +
        (f.errors.invite ? ' aria-invalid="true" aria-describedby="rm-err-invite"' : '') + '>' +
        esc(f.access.inviteText) + '</textarea><small>成员编号在对方主页上能复制。</small>' + fieldError(f, 'invite') + '</div>';
    }
    var picked = f.access.invitees;
    var pool = (demo().people || []).filter(function (p) { return p.id !== S.me.id; }).slice(0, 14);
    return '<div class="rm-indent"><div class="rm-invite-pool" role="group" aria-label="点名邀请（示例成员）"' +
      (f.errors.invite ? ' aria-invalid="true" aria-describedby="rm-err-invite" tabindex="-1"' : '') + '>' +
      pool.map(function (p) {
        var on = picked.indexOf(p.id) >= 0;
        return '<button type="button" class="chip" aria-pressed="' + (on ? 'true' : 'false') + '" data-room-act="invite-toggle" data-id="' + esc(p.id) + '">' + esc(p.name) + '</button>';
      }).join('') + '</div><small>已选 ' + esc(String(picked.length)) + ' 人</small>' + fieldError(f, 'invite') + '</div>';
  }

  function hostAllowed(url) {
    var hosts = (abilitiesNow() && abilitiesNow().link_hosts) || [];
    var m = /^https:\/\/([^/?#:@\\\s]+)(\/[^\s"'<>`\\]*)?$/i.exec(String(url || '').trim());
    if (!m) return false;
    var host = m[1].toLowerCase();
    return hosts.some(function (h) { return h.host === host; });
  }

  function validate(f) {
    var e = {};
    if (!f.title.trim()) e.title = '写个标题，大家才知道聊什么';
    var start = Date.parse(f.startsAt);
    if (!start) e.startsAt = '选一个开始时间';
    else if (start < Date.now() - 5 * 60000) e.startsAt = '开始时间不能早于现在';
    if (Number(f.duration) > capNow()) e.duration = '超过了你单场的上限';
    if (f.access.space && !f.access.spaceId) e.space = '选一个空间';
    if (f.access.invite && !inviteIds(f).length) e.invite = '至少邀请一个人';
    if (f.provider === 'external_link' && !hostAllowed(f.externalUrl)) e.externalUrl = '只接受白名单里的 https 会议链接';
    var sum = f.agenda.reduce(function (s, a) { return s + (a.title.trim() ? Number(a.minutes) || 0 : 0); }, 0);
    if (sum > Number(f.duration)) e.agenda = '议程加起来超过了本场时长';
    return e;
  }

  function submitCreate() {
    var f = S.create;
    if (!f || f.busy) return;
    f.errors = validate(f);
    f.serverError = '';
    if (Object.keys(f.errors).length) {
      paintDialog();
      var bad = root().querySelector('input[aria-invalid="true"],select[aria-invalid="true"],textarea[aria-invalid="true"],[role="group"][aria-invalid="true"][tabindex]');
      if (bad && bad.focus) bad.focus();
      return;
    }
    var body = {
      kind: f.kind, title: f.title.trim(), summary: f.summary.trim(), starts_at: new Date(Date.parse(f.startsAt)).toISOString(),
      duration_min: Number(f.duration), provider: f.provider, access: accessList(f),
      self_unmute: f.kind === 'discussion' && !!f.selfUnmute, repeat_weekly: f.repeat ? Number(f.repeatCount) : 0,
      agenda: f.agenda.filter(function (a) { return a.title.trim(); }).map(function (a) { return { title: a.title.trim(), minutes: Number(a.minutes) || 1 }; })
    };
    if (f.provider === 'external_link') body.external_url = f.externalUrl.trim();
    if (!isLive()) {
      var id = demoCreate(body);
      closeCreate();
      toast(f.repeat ? '例会排好了（示例）' : '房间建好了（示例）');
      location.hash = '#/room/' + id;
      return;
    }
    f.busy = true;
    paintDialog();
    api().post('/rooms', body, { idempotencyKey: api().newIdempotencyKey() }).then(function (r) {
      closeCreate();
      location.hash = '#/room/' + encodeURIComponent(r.data.id);
    }, function (err) {
      f.busy = false;
      f.serverError = err && err.message ? err.message : '没建成，请再试一次';
      paintDialog();
    });
  }

  function demoCreate(body) {
    var d = demo();
    var id = 'r-new-' + Date.now().toString(36);
    var start = Date.parse(body.starts_at);
    var count = body.repeat_weekly || 1;
    for (var i = 0; i < count; i++) {
      var offset = Math.round((start - Date.now()) / 60000) + i * 7 * 24 * 60;
      d.rooms.push({
        id: i ? id + '-' + i : id, kind: body.kind, title: body.title, summary: body.summary || '', hostId: S.me.id,
        state: 'scheduled', startOffsetMin: offset, startsAt: isoIn(offset), endsAt: isoIn(offset + body.duration_min),
        duration: body.duration_min, extended: 0, provider: body.provider, externalUrl: body.external_url || '',
        externalLabel: body.external_url ? labelFor(body.external_url) : '',
        access: body.access.map(function (a) {
          if (a.kind === 'space') return { kind: 'space', space: ((d.spaces || []).filter(function (s) { return s.id === a.space_id; })[0] || {}).name };
          if (a.kind === 'invite') return { kind: 'invite', count: a.principal_ids.length };
          return a;
        }),
        selfUnmute: body.self_unmute, boardMode: 'host', stageMode: 'screen',
        screenShare: { activeId: null, shareAudio: true, pending: [] },
        locked: false, speakers: [], listeners: [], queue: [],
        agenda: body.agenda.map(function (a) { return { title: a.title, minutes: a.minutes, state: 'pending' }; }),
        materials: [], chat: [], removed: {}, series: count > 1 ? { index: i + 1, total: count } : null, mySignup: null
      });
    }
    return id;
  }

  function labelFor(url) {
    var hosts = demo().linkHosts || [];
    var m = /^https:\/\/([^/?#]+)/i.exec(url || '');
    var h = m ? m[1].toLowerCase() : '';
    var hit = hosts.filter(function (x) { return x.host === h; })[0];
    return hit ? hit.label : '外部会议';
  }

  /* ------------------------------------------------------------ 房间页 */

  function roomShell() {
    return '<div class="rm rm-room-page" data-rooms-root data-rm-view="room">' +
      '<div data-rm-region="banner"></div>' +
      '<div data-rm-region="body">' + (isLive() ? skeleton() : '') + '</div>' +
      '</div>';
  }

  function current() {
    if (isLive()) return S.live.detail ? fromApi(S.live.detail) : null;
    var r = demoRoom(S.roomId);
    return r ? fromSample(r) : null;
  }

  function stateCard(kind, title, text) {
    return '<div class="rm-statecard" data-kind="' + esc(kind) + '" role="status">' +
      '<span class="rm-statecard-ico">' + icon(kind === 'removed' ? 'leave' : kind === 'denied' ? 'lock' : kind === 'waiting' ? 'clock' : 'room') + '</span>' +
      '<h1>' + esc(title) + '</h1><p>' + esc(text) + '</p>' +
      '<a class="button" href="#/rooms">' + icon('back') + '<span>回到房间列表</span></a></div>';
  }

  function bodyOnly(html) {
    unmountBoard();
    setRegion('banner', '');
    setRegion('body', html);
  }

  function paintRoom(preferredFocus) {
    var keep = preferredFocus || focusDescriptor();
    var r = current();
    if (r && (myRole(r) === 'listener' || r.me.muted)) {
      if (S.micOn || S.localMic) stopMic();
      S.micOn = false;
    }
    if (r && myRole(r) === 'listener' && S.localDisplay) {
      dropLocalDisplay();
      S.sharing = false;
      S.localWhere = '';
      S.previewFor = '';
    }
    if (S.conn === 'denied' || (!r && !isLive())) {
      bodyOnly(stateCard('denied', '这个房间你现在进不了', '可能是房间不对你开放，或者链接有误。'));
    } else if (isLive() && !r) {
      bodyOnly(S.live.error ? (isClosed(S.live.error) ? closedBox() : errorBox(S.live.error.message, 'reload')) : skeleton());
    } else if (S.conn === 'removed') {
      bodyOnly(stateCard('removed', '你已被主持人移出这个房间', '原因：' + reasonText(S.reason) + '。这一场你不能再进来；有疑问可以在治理台申诉。'));
    } else if (S.conn === 'waiting') {
      bodyOnly(stateCard('waiting', '等待主持人批准', '「' + r.title + '」需要报名审核。主持人批准后，这个页面会自动进房。'));
    } else if (r.state === 'ended' || S.conn === 'ended') {
      stopLocalCapture();
      teardownMedia();
      bodyOnly(endedPage(r));
    } else if (S.conn === 'error') {
      bodyOnly('<div class="rm-state" data-tone="danger" role="alert"><b>' + esc(S.errorMsg || '进房失败') + '</b>' +
        '<p>房间和你的报名都没有变化，可以再试一次。</p><button type="button" class="button" data-room-act="rejoin">重试</button></div>');
    } else {
      paintBanner(r);
      if (!region('main')) setRegion('body', roomLayout(r));
      paintRegions(r);
    }
    paintSim();
    syncHostModal(!!(S.hostOpen && current() && current().me.isHost));
    restoreDescriptor(keep);
  }

  function reasonText(code) {
    var hit = REASONS.filter(function (x) { return x[0] === code; })[0];
    return hit ? hit[1] : '主持人决定';
  }

  function roomLayout(r) {
    return '<header class="rm-room-head" data-rm-region="head"></header>' +
      '<div class="rm-room">' +
      '<div class="rm-room-main" data-rm-region="main">' +
      '<section class="rm-stage" data-rm-region="stage" aria-label="发言区"></section>' +
      '<section class="rm-boardwrap" data-rm-region="board" aria-label="白板"' + (S.boardOpen ? '' : ' hidden') + '></section>' +
      '<section class="rm-agenda" data-rm-region="agenda" aria-label="议程"></section>' +
      '<section class="rm-audience" data-rm-region="audience" aria-label="听众"></section>' +
      '</div>' +
      '<aside class="rm-side" data-rm-region="side" aria-label="房间信息"></aside>' +
      '</div>' +
      '<section class="rm-hostpanel" id="rm-hostpanel" data-rm-region="hostpanel" role="dialog" aria-modal="true" aria-label="主持面板"' + (S.hostOpen && r.me.isHost ? '' : ' hidden') + '></section>' +
      '<div class="rm-controls" data-rm-region="controls"></div>';
  }

  function paintRegions(r) {
    var main = region('main');
    if (main) main.setAttribute('data-stage-mode', r.screenShare.active ? r.stageMode : 'people');
    setRegion('head', headHtml(r));
    setRegion('stage', stageHtml(r));
    paintBoard(r);
    setRegion('agenda', agendaHtml(r));
    setRegion('audience', audienceHtml(r));
    setRegion('side', sideHtml(r));
    var hp = region('hostpanel');
    if (hp) {
      hp.hidden = !(S.hostOpen && r.me.isHost);
      if (!hp.hidden) hp.innerHTML = hostPanelHtml(r);
    }
    setRegion('controls', controlsHtml(r));
    mountScreenMedia(r);
    ensureRaf();
  }

  function paintBanner(r) {
    var parts = [];
    if (S.sharing) parts.push('<div class="rm-banner rm-sharing" data-tone="info" role="status">' + icon('screen') + '<b>正在投屏 ·</b><button type="button" class="button small danger" data-room-act="screen-stop">停止</button></div>');
    if (S.conn === 'connecting') parts.push('<div class="rm-banner" data-tone="info" role="status">正在连接房间…</div>');
    if (S.conn === 'reconnecting') parts.push('<div class="rm-banner" data-tone="notice" role="status">网络断了一下，正在重连。重连时会重新核对你此刻还能不能进。</div>');
    var rem = reminders(r);
    if (rem.startsIn != null) parts.push('<div class="rm-banner" data-tone="info" role="status">' + icon('clock') + '还有 ' + esc(String(rem.startsIn)) + ' 分钟开始</div>');
    if (rem.endsIn != null) {
      parts.push('<div class="rm-banner" data-tone="notice" role="status">' + icon('clock') + '还有 ' + esc(String(rem.endsIn)) + ' 分钟到点' +
        (r.policy.canExtend ? '，可以延长一次（最多 ' + esc(String(r.policy.extendLeft)) + ' 分钟）<button type="button" class="button small" data-room-act="host" data-host="extend" data-minutes="' + esc(String(Math.min(15, r.policy.extendLeft))) + '">延长 ' + esc(String(Math.min(15, r.policy.extendLeft))) + ' 分钟</button>' : '') +
        '</div>');
    }
    setRegion('banner', parts.join(''));
  }

  function reminders(r) {
    if (isLive()) {
      var rm = r.reminders || {};
      return { startsIn: rm.starts_in_min, endsIn: rm.ends_in_min };
    }
    var out = { startsIn: null, endsIn: null };
    var s = minutesFrom(r.startsAt);
    if (r.state === 'scheduled' && s >= 0 && s <= 10) out.startsIn = s;
    var e = minutesFrom(r.endsAt);
    if (r.state === 'live' && r.me.isHost && e >= 0 && e <= 5) out.endsIn = e;
    return out;
  }

  function connChip() {
    var map = { connected: ['已连接', 'success'], connecting: ['连接中', 'info'], reconnecting: ['重连中', 'notice'], idle: ['未进房', 'gray'] };
    var m = map[S.conn] || map.idle;
    return '<span class="pill ' + esc(m[1]) + ' rm-conn" data-conn="' + esc(S.conn) + '">' + esc(m[0]) + '</span>';
  }

  function headHtml(r) {
    var left = r.state === 'live' ? Math.max(0, minutesFrom(r.endsAt)) : null;
    return '<a class="rm-back" href="#/rooms">' + icon('back') + '<span>房间</span></a>' +
      '<div class="rm-room-title"><h1>' + esc(r.title) + '</h1>' +
      '<div class="rm-room-meta">' + pill(KIND[r.kind], r.kind === 'stage' ? 'accent' : 'info') +
      (r.state === 'live' ? pill('进行中', 'dot') : pill(dayText(r.startsAt) + ' ' + clockText(r.startsAt) + ' 开始', 'gray')) +
      (r.locked ? '<span class="pill notice">' + icon('lock') + '已锁房</span>' : '') +
      '<small>' + esc(clockText(r.startsAt)) + '–' + esc(clockText(r.endsAt)) + (left != null ? ' · 还剩 ' + esc(String(left)) + ' 分钟' : '') + '</small>' +
      (r.state === 'live' ? connChip() : '') + sampleTag() + '</div></div>';
  }

  function stageHtml(r) {
    var ext = r.provider === 'external_link'
      ? (r.external
        ? '<div class="rm-external"><div><b>音视频在' + esc(r.external.label || '外部会议') + '里开</b></div>' +
          '<a class="button primary" href="' + safeUrl(r.external.url) + '" target="_blank" rel="noopener noreferrer">' + icon('external') + '<span>去外部会议</span></a></div>'
        : '<div class="rm-external"><div><b>音视频在' + esc(r.externalLabel || '外部会议') + '里开</b><p>会议链接只给能进房的人看。</p></div></div>')
      : '';
    if (r.state === 'scheduled') {
      var art = safeRoomAsset(r.background);
      return ext + '<div class="rm-prestage">' + (art ? '<img class="rm-stage-art" src="' + window.Commons.safeUrl(art) + '" alt="" aria-hidden="true">' : '') +
        '<p>' + esc(dayText(r.startsAt)) + ' ' + esc(clockText(r.startsAt)) + ' 开始 · ' + esc(String(r.durationMin)) + ' 分钟</p>' +
        (r.me.isHost
          ? '<button type="button" class="button primary" data-room-act="host" data-host="start">开始房间</button><small>开始前 15 分钟可以提前开</small>'
          : signupButton(r)) + '</div>';
    }
    if (r.screenShare.active) return ext + screenStageHtml(r);
    var speakers = r.speakers.map(function (s) {
      return '<figure class="rm-speaker rm-person" data-role="' + esc(s.role) + '" ' +
        /* safe: CommonsLevel attrs 是受限枚举 */ levelAttrs(s) + '>' + speakerAva(s, 96) +
        '<figcaption>' + /* safe: CommonsLevel nameplate 已逐值转义 */ levelPlate(s) +
        (s.id === meId() ? '<span class="rm-me">我</span>' : '') + '<small>' + esc(ROLE[s.role]) +
        (s.muted ? ' · 已静音' : s.speaking ? ' · 正在说' : '') + '</small></figcaption></figure>';
    }).join('');
    return ext + '<div class="rm-stage-grid">' + speakers + '</div>' +
      (r.kind === 'stage' && r.raisedCount ? '<p class="rm-stage-note">' + icon('hand') + esc(String(r.raisedCount)) + ' 人在举手排队</p>' : '');
  }

  function speakerRail(r) {
    return '<div class="rm-speaker-rail" role="group" aria-label="发言人">' + r.speakers.map(function (s) {
      return '<figure class="rm-speaker rm-speaker-small rm-person" data-role="' + esc(s.role) + '" ' +
        /* safe: CommonsLevel attrs 是受限枚举 */ levelAttrs(s) + '>' + speakerAva(s, 40) +
        '<figcaption>' + /* safe: CommonsLevel nameplate 已逐值转义 */ levelPlate(s) +
        (s.id === meId() ? '<span class="rm-me">我</span>' : '') + '<small>' +
        (s.speaking ? '正在说' : s.muted ? '已静音' : ROLE[s.role]) + '</small></figcaption></figure>';
    }).join('') + '</div>';
  }

  function editorSample() {
    return '<div class="rm-editor-demo" role="img" aria-label="代码编辑器示意画面"><div class="rm-editor-tabs"><span></span><b>room-policy.py</b><i>示例</i></div>' +
      '<ol><li><em>def</em> approve_screen(room, speaker):</li><li>  assert speaker.role == <q>speaker</q></li>' +
      '<li>  room.revoke_previous_share()</li><li>  grant = room.issue_screen_grant(speaker)</li>' +
      '<li>  <em>return</em> grant.with_sources(</li><li>    <q>screen_share</q>,</li><li>    <q>screen_share_audio</q>,</li><li>  )</li></ol></div>';
  }

  /* safe-fn: 两个按钮都是写死的文案和图标，按下状态只有 true/false */
  function micMuteHtml() {
    var has = !!S.localMicTrack;
    var live = has && S.micOn && !S.micMuted;
    return '<button type="button" class="button small ' + (live ? 'primary' : 'ghost') + '" data-room-act="track-mute" data-id="mic" aria-pressed="' +
      (live ? 'true' : 'false') + '"' + (has ? '' : ' disabled aria-disabled="true"') + '>' + icon(live ? 'mic' : 'micOff') +
      '<span>' + (live ? '静音' : '取消静音') + '</span></button>';
  }

  /* safe-fn: 两个按钮都是写死的文案和图标，按下状态只有 true/false */
  function screenMuteHtml() {
    var has = !!S.localScreenAudio;
    var live = has && !S.screenAudioMuted;
    return '<button type="button" class="button small ' + (live ? 'primary' : 'ghost') + '" data-room-act="track-mute" data-id="screen" aria-pressed="' +
      (live ? 'true' : 'false') + '"' + (has ? '' : ' disabled aria-disabled="true"') + '>' + icon(live ? 'mic' : 'micOff') +
      '<span>' + (live ? '静音' : '取消静音') + '</span></button>';
  }

  function showingLocalStage() {
    return !!(S.localDisplay && S.sharing && S.localWhere === 'stage');
  }

  function thumbTarget(r) {
    var reqs = (r.screenShare && r.screenShare.requests) || [];
    if (!S.localDisplay || !reqs.length) return '';
    var ids = reqs.map(function (p) { return p.id; });
    if (S.previewFor && ids.indexOf(S.previewFor) >= 0) return S.previewFor;
    return ids[0];
  }

  /* safe-fn: 缩略图里的示意是写死的；人物 id 走 esc */
  function shareThumbHtml(pid, liveId) {
    var live = !!liveId && pid === liveId;
    return '<div class="rm-share-thumb" data-rm-screen-thumb="' + esc(pid) + '">' +
      (live ? '' : '<div class="rm-editor-demo rm-thumb-demo" role="img" aria-label="投屏预览示意"><div class="rm-editor-tabs"><span></span><b>预览</b></div><ol><li>示意画面</li></ol></div>') +
      '</div>';
  }

  function screenStageHtml(r) {
    var owner = r.screenShare.active;
    var mine = owner.id === meId();
    var localStage = showingLocalStage();
    var boardAvailable = !!window.CommonsBoard || S.boardOpen;
    var audioName = localStage
      ? (S.localScreenAudio ? '电脑声音' : '这次没带电脑声音')
      : (r.screenShare.shareAudio ? '电脑声音' : '这次没带电脑声音');
    var switcher = r.me.isHost ? '<div class="segmented small rm-stage-switch" role="group" aria-label="主画面">' +
      '<button type="button" aria-pressed="' + (r.stageMode === 'screen' ? 'true' : 'false') + '" data-room-act="stage-mode" data-id="screen">投屏</button>' +
      '<button type="button" aria-pressed="' + (r.stageMode === 'board' ? 'true' : 'false') + '" data-room-act="stage-mode" data-id="board"' + (boardAvailable ? '' : ' disabled') + '>白板</button></div>' : '';
    var actions = '<div class="rm-share-actions"><button type="button" class="button small ghost" data-room-act="screen-fit" data-id="' +
      (S.screenFit === 'fit' ? 'original' : 'fit') + '">' + (S.screenFit === 'fit' ? '原始大小' : '适应') + '</button>' +
      '<button type="button" class="button small ghost" data-room-act="screen-full">' + icon('full') + '<span>全屏</span></button>' +
      (r.me.isHost && !mine ? '<button type="button" class="button small tonal" data-room-act="screen-takeover">接过投屏</button>' +
        '<button type="button" class="button small danger" data-room-act="screen-host-stop" data-id="' + esc(owner.id) + '">停止投屏</button>' : '') + '</div>';
    return '<div class="rm-share-head"><div><b>' + icon('screen') + /* safe: levelPlate returns escaped or shared helper HTML */ levelPlate(owner) + ' 正在投屏</b><small>' +
      (localStage ? (S.localScreenAudio ? '含电脑声音' : '只分享画面') : (r.screenShare.shareAudio ? '含电脑声音' : '只分享画面')) + '</small></div>' + switcher + actions + '</div>' +
      (S.screenReason ? '<p class="rm-share-reason" role="status">' + esc(S.screenReason) + '</p>' : '') +
      '<div class="rm-share-frame" data-fit="' + esc(S.screenFit) + '" data-stage-mode="' + esc(r.stageMode) + '" data-rm-fullscreen>' +
      '<div class="rm-share-media" data-rm-screen-media>' + (localStage ? '' : (!isLive() ? editorSample() : '<div class="rm-media-wait">正在接收投屏画面…</div>')) + '</div></div>' +
      '<p class="rm-share-note">只在这台电脑上显示，不上传、不录制。</p>' +
      '<div class="rm-track-levels" role="group" aria-label="音量"><span>麦克风<i><b data-rm-meter="mic" data-id="' + esc(owner.id) + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="麦克风音量"></b></i>' +
      micMuteHtml() + '</span><span>' + esc(audioName) + '<i><b data-rm-meter="screen" data-id="' + esc(owner.id) + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="电脑声音"></b></i>' +
      screenMuteHtml() + '</span></div>' + speakerRail(r) +
      (r.kind === 'stage' && r.raisedCount ? '<p class="rm-stage-note">' + icon('hand') + esc(String(r.raisedCount)) + ' 人在举手排队</p>' : '');
  }

  function audienceHtml(r) {
    if (r.state !== 'live') return '';
    var shown = r.listeners.slice(0, FOLD);
    var rest = Math.max(0, r.listenerCount - shown.length);
    return '<div class="rm-sec-head"><h2>' + icon('users') + '在听</h2><small>' + esc(String(r.listenerCount)) + ' 人 · 只听模式，不开麦</small></div>' +
      '<ul class="rm-aud-grid">' + shown.map(function (p) {
        return '<li class="rm-person" ' + /* safe: CommonsLevel attrs 是受限枚举 */ levelAttrs(p) + ' title="' + esc(p.name) + '">' +
          avatar(p, 40) + /* safe: CommonsLevel nameplate 已逐值转义 */ levelPlate(p) +
          (p.id === meId() ? '<span class="rm-me">我</span>' : '') + '</li>';
      }).join('') + '</ul>' +
      (rest ? '<p class="rm-aud-more">还有 ' + esc(String(rest)) + ' 人在听</p>' : '');
  }

  function agendaHtml(r) {
    if (!r.agenda.length) return '';
    var total = r.agenda.reduce(function (s, a) { return s + a.minutes; }, 0);
    return '<div class="rm-sec-head"><h2>议程</h2><small>' + esc(String(r.agenda.length)) + ' 条 · 预计 ' + esc(String(total)) + ' 分钟</small>' +
      (r.me.isHost && r.state === 'live' && r.agenda.some(function (a) { return a.state !== 'done'; })
        ? '<button type="button" class="button small ghost" data-room-act="host" data-host="agenda_next">下一条</button>' : '') + '</div>' +
      '<ol class="rm-agenda-list">' + r.agenda.map(function (a, i) {
        return '<li data-state="' + esc(a.state) + '"' + (a.state === 'current' ? ' aria-current="step"' : '') + '><span class="rm-agenda-n">' + esc(String(i + 1)) + '</span>' +
          '<span class="rm-agenda-t">' + esc(a.title) + '</span><small>' + esc(String(a.minutes)) + ' 分钟' +
          (a.state === 'current' ? ' · 进行中' : a.state === 'done' ? ' · 已过' : '') + '</small></li>';
      }).join('') + '</ol>';
  }

  function accessChips(r) {
    return r.access.map(function (a) {
      var t = a.kind === 'members' ? '全体成员' : a.kind === 'level' ? 'L' + a.min_level + ' ' + LEVEL[a.min_level] + ' 及以上'
        : a.kind === 'space' ? ((a.space && a.space.name) || a.space || '空间') + ' 成员'
          : a.kind === 'invite' ? '邀请名单' + (a.count ? ' ' + a.count + ' 人' : '') : '报名审核';
      return '<li>' + esc(t) + '</li>';
    }).join('');
  }

  function sideHtml(r) {
    var mats = r.materials;
    return '<section class="rm-side-sec"><h2>房间说明</h2><p>' + esc(r.summary || '主持人没有写简介。') + '</p>' +
      '<dl class="rm-kv"><dt>主持</dt><dd>' + /* safe: levelPlate returns escaped or shared helper HTML */ levelPlate(r.host) + '</dd>' +
      '<dt>时间</dt><dd>' + esc(dayText(r.startsAt)) + ' ' + esc(clockText(r.startsAt)) + '–' + esc(clockText(r.endsAt)) + '</dd>' +
      '<dt>音视频</dt><dd>' + esc(r.provider === 'external_link' ? (r.externalLabel || '外部会议') + '（外部链接）' : '站内房间') + '</dd>' +
      (r.series ? '<dt>例会</dt><dd>每周 · 第 ' + esc(String(r.series.index)) + (r.series.total ? '/' + esc(String(r.series.total)) : '') + ' 场</dd>' : '') +
      '<dt>录制</dt><dd>内测不录制、不转写</dd></dl></section>' +
      '<section class="rm-side-sec"><h2>谁能进</h2><ul class="rm-chips">' + accessChips(r) + '</ul></section>' +
      '<section class="rm-side-sec"><h2>材料和相关知识</h2>' +
      (mats.length ? '<ul class="rm-mats">' + mats.map(materialRow).join('') + '</ul>' : '<p class="rm-faint">还没有材料。</p>') +
      '<small class="rm-faint">只列你有权看的。</small></section>' +
      chatHtml(r);
  }

  function materialRow(m) {
    if (m.kind === 'link') {
      return '<li><a href="' + safeUrl(m.url) + '" target="_blank" rel="noopener noreferrer">' + icon('link') + '<span>' + esc(m.title) + '</span></a></li>';
    }
    if (m.kind === 'board') return '<li><span class="rm-mat">' + icon('board') + '<span>' + esc(m.title) + '</span></span></li>';
    var href = m.type === 'work' ? '#/work' : '#/knowledge';
    return '<li><a href="' + href + '">' + icon('link') + '<span>' + esc(m.title) + '</span>' + pill(m.type === 'work' ? '作品' : '知识', 'agent') + '</a></li>';
  }

  function chatHtml(r) {
    if (isLive()) return liveChatHtml(r);
    if (!r.chat) {
      return '<section class="rm-side-sec"><h2>文字讨论</h2><p class="rm-faint">文字讨论会接讨论串（THREAD-1），这一版房间里先不开。</p></section>';
    }
    return '<section class="rm-side-sec rm-chat"><h2>文字讨论 ' + sampleTag() + '</h2>' +
      '<ol class="rm-chat-list">' + r.chat.map(function (c) {
        var p = person(c.id);
        return '<li>' + avatar(p, 24) + '<div><b>' + /* safe: levelPlate returns escaped or shared helper HTML */ levelPlate(p) + '</b><small>' + esc(clockText(c.at)) + '</small><p>' + esc(c.text) + '</p></div></li>';
      }).join('') + '</ol>' +
      '<form class="rm-chat-form" data-rm-chat><input aria-label="说点什么" maxlength="200" data-room-field="chat" value="' + esc(S.chatDraft) + '" placeholder="说点什么（示例，不会发出去）">' +
      '<button type="submit" class="button small">发送</button></form></section>';
  }

  /* ------------------------------------------------------------ live 模式：文字讨论（GET/POST /rooms/{id}/messages） */

  function chatState() {
    var c = S.live.chat;
    if (!c || c.roomId !== S.roomId) c = S.live.chat = { roomId: S.roomId, items: [], status: 'idle', error: '', sig: '', sending: false, keys: {}, more: false, expanded: false, moreLoading: false, moreError: '' };
    return c;
  }

  function chatSig(items) {
    return items.map(function (m) { return m.id; }).join(',');
  }

  function chatItemHtml(m, r) {
    var a = m.author || { id: '', name: '成员', level: 1 };
    var mine = a.id === meId();
    var canDelete = mine || !!(r && r.me && r.me.isHost);
    return '<li>' + avatar(a, 24) + '<div><b>' + /* safe: levelPlate returns escaped or shared helper HTML */ levelPlate(a) + '</b><small>' + esc(clockText(m.at)) + '</small><p>' + esc(m.text) + '</p>' +
      (canDelete ? '<button type="button" class="rm-chat-del" data-room-act="chat-delete" data-id="' + esc(m.id) + '">' + (mine ? '撤回' : '删除') + '</button>' : '') + '</div></li>';
  }

  function chatListHtml(c, r) {
    if (!c.items.length) return '<p class="rm-faint">' + (c.status === 'ready' ? '还没有人说话。' : '正在读取…') + '</p>';
    var more = c.more ? '<button type="button" class="button ghost small" data-room-act="chat-more"' + (c.moreLoading ? ' disabled aria-busy="true"' : '') + '>' + (c.moreLoading ? '正在读取…' : (c.moreError ? '重试更早的消息' : '更早的消息')) + '</button>' : '';
    var error = c.moreError ? '<p class="rm-faint" role="alert">' + esc(c.moreError) + '</p>' : '';
    return more + error + '<ol class="rm-chat-list">' + c.items.map(function (m) { return chatItemHtml(m, r); }).join('') + '</ol>';
  }

  // 被能力门挡住：CommonsSession.reason('rooms.chat')；没挡住返回空串。
  function chatBlocked() {
    var s = window.CommonsSession;
    if (!s || typeof s.can !== 'function' || s.can('rooms.chat')) return '';
    return (typeof s.reason === 'function' && s.reason('rooms.chat')) || '现在还不能发言';
  }

  function liveChatHtml(r) {
    var c = chatState();
    var blocked = chatBlocked();
    var canSend = r.state === 'live' && r.me.present;
    var note = c.error && r.me.present ? '<p class="rm-faint" role="alert">' + esc(c.error) + '</p>' : '';
    var form = canSend && blocked
      ? '<form class="rm-chat-form" data-rm-chat><input aria-label="说点什么" disabled title="' + esc(blocked) + '" placeholder="说点什么"><button type="submit" class="button small" disabled title="' + esc(blocked) + '">发送</button></form><p class="rm-faint" role="note">' + esc(blocked) + '</p>'
      : canSend
      ? '<form class="rm-chat-form" data-rm-chat><input aria-label="说点什么" maxlength="200" data-room-field="chat" value="' + esc(S.chatDraft) + '" placeholder="说点什么">' +
        '<button type="submit" class="button small"' + (c.sending ? ' disabled aria-busy="true"' : '') + '>发送</button></form>'
      : '<p class="rm-faint">' + (r.state === 'live' ? '进房后才能发言。' : '这一场还没开始，开始后才能发言。') + '</p>';
    return '<section class="rm-side-sec rm-chat"><h2>文字讨论</h2><div data-rm-chat-list aria-live="polite">' +
      /* safe: chatListHtml 里的值逐个转义 */ chatListHtml(c, r) + '</div>' + note + form + '</section>';
  }

  function paintChat(prepended) {
    var list = root() && root().querySelector('[data-rm-chat-list]');
    var r = current();
    if (!list || !r) { paintRoom(); return; }
    var box = list.querySelector('.rm-chat-list');
    var previousHeight = box ? box.scrollHeight : 0, previousTop = box ? box.scrollTop : 0;
    var stick = !prepended && (!box || box.scrollTop + box.clientHeight >= box.scrollHeight - 24);
    list.innerHTML = chatListHtml(chatState(), r);
    box = list.querySelector('.rm-chat-list');
    if (box && prepended) box.scrollTop = previousTop + Math.max(0, box.scrollHeight - previousHeight);
    else if (box && stick) box.scrollTop = box.scrollHeight;
  }

  function loadChat() {
    var id = S.roomId;
    if (!isLive() || !id) return;
    var c = chatState();
    api().get('/rooms/' + encodeURIComponent(id) + '/messages').then(function (res) {
      if (S.roomId !== id) return;
      var items = (res.data && res.data.items) || [];
      var cutoff = items.length ? Number(items[0].seq) : 0;
      var older = c.expanded && cutoff ? c.items.filter(function (m) { return Number(m.seq) < cutoff; }) : [];
      var seen = {}, merged = older.concat(items).filter(function (m) {
        if (seen[m.id]) return false;
        seen[m.id] = true; return true;
      }).sort(function (a, b) { return Number(a.seq) - Number(b.seq); });
      var sig = chatSig(merged);
      var changed = sig !== c.sig || c.status !== 'ready' || !!c.error;
      c.status = 'ready'; c.error = ''; c.items = merged; c.sig = sig;
      if (!c.expanded) c.more = !!(res.data && res.data.more);
      if (changed) paintChat();
    }, function (err) {
      if (S.roomId !== id) return;
      c.error = isClosed(err) ? '文字讨论还没开放' : ((err && err.message) || '文字讨论没有读到');
    });
  }

  function loadMoreChat() {
    var c = chatState(), id = S.roomId;
    if (c.moreLoading || !c.more || !c.items.length) return;
    var before = Number(c.items[0].seq);
    if (!before) return;
    c.moreLoading = true; c.moreError = '';
    paintChat();
    api().get('/rooms/' + encodeURIComponent(id) + '/messages', { before: before }).then(function (res) {
      if (S.roomId !== id) return;
      var items = (res.data && res.data.items) || [], seen = {};
      c.items = items.concat(c.items).filter(function (m) {
        if (seen[m.id]) return false;
        seen[m.id] = true; return true;
      }).sort(function (a, b) { return Number(a.seq) - Number(b.seq); });
      c.expanded = true; c.more = !!(res.data && res.data.more);
      c.moreLoading = false; c.moreError = ''; c.sig = chatSig(c.items);
      paintChat(items.length);
    }, function (err) {
      if (S.roomId !== id) return;
      c.moreLoading = false;
      c.moreError = isClosed(err) ? '更早的文字讨论还没开放' : ((err && err.message) || '更早的消息没有读到，请重试。');
      paintChat();
    });
  }

  function sendChat() {
    var c = chatState();
    var text = S.chatDraft.trim();
    if (!text || c.sending) return;
    if (chatBlocked()) { toast(chatBlocked()); return; }
    var id = S.roomId;
    var sig = id + '\n' + text;
    c.keys[sig] = c.keys[sig] || api().newIdempotencyKey();
    c.sending = true;
    paintRoom();
    api().post('/rooms/' + encodeURIComponent(id) + '/messages', { text: text }, { idempotencyKey: c.keys[sig] }).then(function (res) {
      delete c.keys[sig];
      c.sending = false;
      if (S.roomId !== id) return;
      if (S.chatDraft.trim() === text) S.chatDraft = '';
      c.items = c.items.concat([res.data]); c.sig = chatSig(c.items); c.error = '';
      paintRoom();
      var input = root() && root().querySelector('[data-room-field="chat"]');
      if (input) input.focus();
    }, function (err) {
      c.sending = false;
      if (S.roomId !== id) return;
      if (err && (err.code === 'room_removed' || err.code === 'resource_not_found' || err.code === 'room_ended')) { onApiError(err); return; }
      toast(isClosed(err) ? '文字讨论还没开放' : ((err && err.message) || '没发出去，输入还在，再试一次。'));
      paintRoom();
    });
  }

  function deleteChat(messageId) {
    var id = S.roomId, c = chatState(), sig = 'delete\n' + id + '\n' + messageId;
    var btn = root() && root().querySelector('[data-room-act="chat-delete"][data-id="' + messageId + '"]');
    if (btn) btn.disabled = true;
    c.keys[sig] = c.keys[sig] || api().newIdempotencyKey();
    api().del('/rooms/' + encodeURIComponent(id) + '/messages/' + encodeURIComponent(messageId), undefined, { idempotencyKey: c.keys[sig] }).then(function () {
      delete c.keys[sig];
      c.items = c.items.filter(function (m) { return m.id !== messageId; }); c.sig = chatSig(c.items);
      paintChat();
    }, function (err) {
      if (btn) btn.disabled = false;
      toast((err && err.message) || '没有删掉，再试一次。');
    });
  }

  function myRole(r) {
    if (r.me.isHost) return 'host';
    return r.me.role || 'listener';
  }

  function controlsHtml(r) {
    if (r.state !== 'live') return '';
    var role = myRole(r);
    var btns = [];
    var hint = '';
    if (role === 'listener') {
      if (r.me.hand === 'invited') {
        btns.push('<button type="button" class="button primary" data-room-act="hand" data-id="accept">' + icon('mic') + '<span>接受邀请上台</span></button>');
        btns.push('<button type="button" class="button ghost" data-room-act="hand" data-id="decline">不了</button>');
        hint = '主持人邀请你发言。上台以后麦克风仍然由你自己打开。';
      } else if (r.me.hand === 'raised') {
        btns.push('<button type="button" class="button tonal" data-room-act="hand" data-id="lower" aria-pressed="true">' + icon('hand') + '<span>放下手</span></button>');
        hint = '已举手，等主持人批准。';
      } else {
        btns.push('<button type="button" class="button" data-room-act="hand" data-id="raise">' + icon('hand') + '<span>举手</span></button>');
        hint = '你在只听模式：能听到台上所有人，麦克风没有打开，也不会被录。';
      }
    } else if (r.me.muted) {
      btns.push('<button type="button" class="button" disabled aria-disabled="true">' + icon('micOff') + '<span>主持人已静音你</span></button>');
    } else if (r.provider === 'livekit') {
      btns.push('<button type="button" class="button ' + (S.micOn ? 'primary' : '') + '" data-room-act="mic" aria-pressed="' + (S.micOn ? 'true' : 'false') + '">' +
        icon(S.micOn ? 'mic' : 'micOff') + '<span>' + (S.micOn ? '闭麦' : '开麦') + '</span></button>');
    } else {
      hint = '你可以发言：在' + (r.externalLabel || '外部会议') + '里开麦。';
    }
    if (r.provider === 'livekit' && role === 'speaker') {
      if (r.screenShare.mine === 'active') {
        btns.push('<button type="button" class="button ' + (S.sharing ? 'danger' : 'tonal') + '" data-room-act="' +
          (S.sharing ? 'screen-stop' : 'screen-start') + '">' + icon('screen') + '<span>' +
          (S.sharing ? '停止投屏' : '开始投屏') + '</span></button>');
      } else if (r.screenShare.mine === 'pending') {
        btns.push('<button type="button" class="button tonal" disabled aria-disabled="true">' + icon('screen') + '<span>已申请投屏</span></button>');
      } else if (!r.screenShare.active) {
        btns.push('<button type="button" class="button" data-room-act="screen-request">' + icon('screen') + '<span>申请投屏</span></button>');
      }
      if (!S.sharing && displayAudioSupported()) {
        btns.push('<label class="rm-check rm-share-audio"><input type="checkbox" data-room-field="share-audio"' +
          (S.shareAudio ? ' checked' : '') + '><span>同时分享电脑声音</span></label>');
      }
    }
    if (r.me.isHost && r.screenShare.mine === 'active') {
      btns.push('<button type="button" class="button ' + (S.sharing ? 'danger' : 'tonal') + '" data-room-act="' +
        (S.sharing ? 'screen-stop' : 'screen-start') + '">' + icon('screen') + '<span>' +
        (S.sharing ? '停止投屏' : '开始投屏') + '</span></button>');
      if (!S.sharing && displayAudioSupported()) {
        btns.push('<label class="rm-check rm-share-audio"><input type="checkbox" data-room-field="share-audio"' +
          (S.shareAudio ? ' checked' : '') + '><span>同时分享电脑声音</span></label>');
      }
    }
    btns.push('<button type="button" class="button ghost" data-room-act="board-toggle" aria-pressed="' + (S.boardOpen ? 'true' : 'false') + '">' + icon('board') + '<span>白板</span></button>');
    if (r.me.isHost) {
      var badge = r.raisedCount + r.signups.length + r.screenShare.requests.length;
      btns.push('<button type="button" class="button ghost" data-room-act="host-toggle" aria-expanded="' + (S.hostOpen ? 'true' : 'false') + '" aria-controls="rm-hostpanel">' +
        icon('crown') + '<span>主持</span>' + (badge ? '<b class="rm-badge" aria-label="待处理 ' + esc(String(badge)) + ' 项">' + esc(String(badge)) + '</b>' : '') + '</button>');
    }
    btns.push('<button type="button" class="button ghost rm-leave" data-room-act="leave">' + icon('leave') + '<span>离开</span></button>');
    var reasonHere = r.screenShare && r.screenShare.active ? '' : (S.screenReason ? '<p class="rm-share-reason" role="status">' + esc(S.screenReason) + '</p>' : '');
    return '<div class="rm-controls-in">' + reasonHere + '<div class="rm-controls-btns">' + btns.join('') + '</div>' +
      (hint ? '<p class="rm-controls-hint">' + esc(hint) + '</p>' : '') + '</div>';
  }

  /* ------------------------------------------------------------ 主持面板 */

  function confirmRow(kind, p, r) {
    var c = S.confirm;
    if (!c || c.kind !== kind || (p && c.id !== p.id)) return '';
    if (kind === 'remove') {
      return '<div class="rm-confirm" role="group" aria-label="确认移出"><p>确认把 <b>' + esc(p.name) + '</b> 移出这一场？移出后对方马上断开，重连也进不来。</p>' +
        '<label>原因<select data-room-field="reason">' + REASONS.map(function (x) {
          return '<option value="' + esc(x[0]) + '"' + (c.reason === x[0] ? ' selected' : '') + '>' + esc(x[1]) + '</option>';
        }).join('') + '</select></label>' +
        '<div class="rm-confirm-btns"><button type="button" class="button danger small" data-room-act="confirm-yes">确认移出</button>' +
        '<button type="button" class="button ghost small" data-room-act="confirm-no">取消</button></div></div>';
    }
    if (kind === 'transfer') {
      return '<div class="rm-confirm" role="group" aria-label="确认转交"><p>把主持交给 <b>' + esc(p.name) + '</b>？之后你会变成发言人，主持面板归对方。</p>' +
        '<div class="rm-confirm-btns"><button type="button" class="button danger small" data-room-act="confirm-yes">确认转交</button>' +
        '<button type="button" class="button ghost small" data-room-act="confirm-no">取消</button></div></div>';
    }
    if (kind === 'end') {
      return '<div class="rm-confirm" role="group" aria-label="确认结束"><p>结束后所有人都会离开，房间不能再打开。' + (S.board ? '白板会存成房间的一件附件。' : '') + '</p>' +
        '<div class="rm-confirm-btns"><button type="button" class="button danger small" data-room-act="confirm-yes">确认结束</button>' +
        '<button type="button" class="button ghost small" data-room-act="confirm-no">取消</button></div></div>';
    }
    return '';
  }

  function personActions(p, r) {
    var acts = [];
    if (p.role === 'speaker') {
      if (r.kind === 'stage' || !r.selfUnmute) acts.push(['down', '下麦']);
      acts.push(p.muted ? ['unmute', '取消静音'] : ['mute', '静音']);
    } else if (p.role === 'listener') {
      acts.push(['invite', '邀请发言']);
    }
    if (p.role !== 'host') {
      acts.push(['transfer', '转交主持']);
      acts.push(['remove', '移出']);
    }
    return acts.map(function (a) {
      var danger = a[0] === 'remove';
      return '<button type="button" class="button small ' + (danger ? 'danger' : 'ghost') + '" data-room-act="' +
        (a[0] === 'remove' || a[0] === 'transfer' ? 'confirm' : 'host') + '" data-host="' + esc(a[0]) + '" data-id="' + esc(p.id) + '">' + esc(a[1]) + '</button>';
    }).join('');
  }

  /* safe-fn: 名字与徽章由共享组件转义；兜底和状态逐值 esc。 */
  function applicantHtml(p, status) {
    var name = window.CommonsLinks && typeof window.CommonsLinks.person === 'function'
      ? window.CommonsLinks.person(p.handle, p.name) : esc(p.name);
    var badge = window.CommonsLevel && typeof window.CommonsLevel.badge === 'function'
      ? window.CommonsLevel.badge(p.level, { size: 'xs', withName: true }) : pill('L' + String(p.level || 1), 'gray');
    return '<div class="rm-hp-who">' + avatar(p, 32) + '<span class="rm-hp-identity">' +
      '<span class="rm-hp-name"><strong>' + /* safe: CommonsLinks.person 自行转义 */ name + '</strong>' +
      /* safe: CommonsLevel.badge 自行转义 */ badge + '</span>' +
      '<small class="rm-hp-meta">' + (p.handle ? '@' + esc(p.handle) + ' · ' : '') + esc(status) + '</small></span></div>';
  }

  function hostPanelHtml(r) {
    var queue = r.queue.filter(function (q) { return q.state === 'raised' || q.state === 'invited'; });
    var me = meId();
    var everyone = r.speakers.filter(function (s) { return s.id !== me; }).concat(r.listeners.filter(function (p) { return p.id !== me; }).slice(0, 12)
      .map(function (p) { return { id: p.id, name: p.name, level: p.level, role: 'listener' }; }));
    var hidden = Math.max(0, r.listenerCount - 12 - (r.listeners.some(function (p) { return p.id === me; }) ? 1 : 0));
    return '<div class="rm-hp">' +
      '<header class="rm-hp-head"><h2>' + icon('crown') + '主持</h2>' + sampleTag() +
      '<button type="button" class="button ghost small icon-only" data-room-act="host-toggle" aria-label="收起主持面板">' + icon('close') + '</button></header>' +
      '<section class="rm-hp-sec"><h3>' + icon('queue') + '发言队列 <small>' + esc(String(queue.length)) + '</small></h3>' +
      (queue.length ? '<ol class="rm-hp-list">' + queue.map(function (q) {
        var p = q.person;
        return '<li class="rm-person" ' + /* safe: CommonsLevel attrs 是受限枚举 */ levelAttrs(p) + '>' +
          applicantHtml(p, q.state === 'invited' ? '已邀请，等对方接受' : '举手中') +
          (q.state === 'raised' ? '<div class="rm-hp-acts"><button type="button" class="button small primary" data-room-act="host" data-host="approve" data-id="' + esc(p.id) + '">批准上台</button>' +
            '<button type="button" class="button small ghost" data-room-act="host" data-host="reject" data-id="' + esc(p.id) + '">不了</button></div>' : '') + '</li>';
      }).join('') + '</ol>' : '<p class="rm-faint">没有人举手。</p>') + '</section>' +
      '<section class="rm-hp-sec"><h3>' + icon('screen') + '投屏申请 <small>' + esc(String(r.screenShare.requests.length)) + '</small></h3>' +
      (r.screenShare.requests.length ? '<ol class="rm-hp-list">' + r.screenShare.requests.map(function (p) {
        return '<li class="rm-person" ' + /* safe: CommonsLevel attrs 是受限枚举 */ levelAttrs(p) + '>' +
          applicantHtml(p, '申请画面和电脑声音') + shareThumbHtml(p.id, thumbTarget(r)) +
          '<div class="rm-hp-acts"><button type="button" class="button small primary" data-room-act="host" data-host="screen_approve" data-id="' + esc(p.id) + '">批准投屏</button>' +
          '<button type="button" class="button small ghost" data-room-act="host" data-host="screen_reject" data-id="' + esc(p.id) + '">拒绝</button></div></li>';
      }).join('') + '</ol>' : '<p class="rm-faint">没有待处理申请。</p>') + '</section>' +
      (r.signups.length ? '<section class="rm-hp-sec"><h3>报名待批 <small>' + esc(String(r.signups.length)) + '</small></h3><ol class="rm-hp-list">' +
        r.signups.map(function (p) {
          return '<li class="rm-person" ' + /* safe: CommonsLevel attrs 是受限枚举 */ levelAttrs(p) + '>' +
            applicantHtml(p, '报名待批') +
            '<div class="rm-hp-acts"><button type="button" class="button small primary" data-room-act="host" data-host="signup_approve" data-id="' + esc(p.id) + '">通过</button>' +
            '<button type="button" class="button small ghost" data-room-act="host" data-host="signup_reject" data-id="' + esc(p.id) + '">不通过</button></div></li>';
        }).join('') + '</ol></section>' : '') +
      '<section class="rm-hp-sec"><h3>' + icon('users') + '在场的人</h3><ul class="rm-hp-list">' +
      everyone.map(function (p) {
        return '<li class="rm-person" ' + /* safe: CommonsLevel attrs 是受限枚举 */ levelAttrs(p) + '><div class="rm-hp-who">' + avatar(p, 32) +
          /* safe: CommonsLevel nameplate 已逐值转义 */ levelPlate(p) + '<small>' + esc(ROLE[p.role]) + (p.muted ? ' · 已静音' : '') + '</small></div>' +
          '<div class="rm-hp-acts">' + personActions(p, r) + '</div>' + confirmRow('remove', p, r) + confirmRow('transfer', p, r) + '</li>';
      }).join('') + '</ul>' + (hidden ? '<small class="rm-faint">另有 ' + esc(String(hidden)) + ' 位听众没有列出。</small>' : '') + '</section>' +
      '<section class="rm-hp-sec"><h3>房间</h3>' +
      '<div class="rm-hp-row"><span>锁房</span><button type="button" class="button small ' + (r.locked ? 'tonal' : 'ghost') + '" data-room-act="host" data-host="' + (r.locked ? 'unlock' : 'lock') + '" aria-pressed="' + (r.locked ? 'true' : 'false') + '">' +
      icon(r.locked ? 'lock' : 'unlock') + '<span>' + (r.locked ? '已锁，点开解锁' : '锁上，新人进不来') + '</span></button></div>' +
      '<div class="rm-hp-row rm-hp-col"><span>白板谁能画</span><div class="segmented small" role="group" aria-label="白板谁能画">' +
      BOARD_MODES.map(function (m) {
        return '<button type="button" aria-pressed="' + (r.boardMode === m[0] ? 'true' : 'false') + '" data-room-act="host" data-host="board" data-mode="' + esc(m[0]) + '">' + esc(m[1]) + '</button>';
      }).join('') + '</div></div>' +
      '<div class="rm-hp-row"><span>延长</span>' + (r.policy.canExtend
        ? '<button type="button" class="button small ghost" data-room-act="host" data-host="extend" data-minutes="' + esc(String(Math.min(15, r.policy.extendLeft))) + '">+' + esc(String(Math.min(15, r.policy.extendLeft))) + ' 分钟（只能一次）</button>'
        : '<small class="rm-faint">已延长过，或已到上限</small>') + '</div>' +
      '<div class="rm-hp-row"><span>结束房间</span><button type="button" class="button small danger" data-room-act="confirm" data-host="end">结束</button></div>' +
      confirmRow('end', null, r) + '</section></div>';
  }

  /* ------------------------------------------------------------ 白板 */

  function boardRole(r) {
    var role = myRole(r);
    if (role === 'host') return 'host';
    if (r.boardMode === 'all') return 'drawer';
    if (r.boardMode === 'speakers' && role === 'speaker') return 'drawer';
    return 'viewer';
  }

  function paintBoard(r) {
    var el = region('board');
    if (!el) return;
    var alongsideScreen = !!r.screenShare.active;
    var show = S.boardOpen || (alongsideScreen && r.stageMode === 'board');
    el.hidden = !show;
    el.setAttribute('data-pip', alongsideScreen && r.stageMode === 'screen' ? 'true' : 'false');
    if (!show) {
      unmountBoard();
      return;
    }
    var role = boardRole(r);
    var modeName = (BOARD_MODES.filter(function (m) { return m[0] === r.boardMode; })[0] || BOARD_MODES[0])[1];
    var head = el.querySelector('[data-rm-board-head]');
    var headHtml2 = '<h2>' + icon('board') + '白板</h2><small>' + esc(modeName.replace('我', '主持人')) + ' · 你' + (role === 'viewer' ? '只能看' : '能画') + '</small>' +
      (role !== 'host' ? '<label class="rm-check rm-follow"><input type="checkbox" data-room-field="follow"' + (S.follow ? ' checked' : '') + '><span>跟随讲课人视角</span></label>' : '') +
      '<button type="button" class="button ghost small icon-only" data-room-act="board-toggle" aria-label="收起白板">' + icon('close') + '</button>';
    if (head) {
      head.innerHTML = headHtml2;
    } else {
      el.innerHTML = '<header class="rm-board-head" data-rm-board-head>' + headHtml2 + '</header><div class="rm-board-host" data-rm-board-host></div>';
    }
    var host = el.querySelector('[data-rm-board-host]');
    if (!window.CommonsBoard || typeof window.CommonsBoard.mount !== 'function') {
      host.innerHTML = '<div class="rm-board-empty"><p>白板还没加载。</p></div>';
      return;
    }
    if (S.board && S.boardFor === r.id) {
      try { if (S.board.setRole) S.board.setRole(role, { laser: role === 'host' }); } catch (e) { /* 白板接口还在变，不阻塞房间 */ }
      return;
    }
    unmountBoard();
    host.innerHTML = '';
    try {
      S.board = window.CommonsBoard.mount(host, { doc: null, role: role, readOnly: false, laser: role === 'host', onOp: onBoardOp,
        actor: meId(), name: (S.me && S.me.name) || '' });
      S.boardFor = r.id;
      if (S.follow && S.board && S.board.follow) S.board.follow(r.host.id);
    } catch (e) {
      S.board = null;
      host.innerHTML = '<div class="rm-board-empty"><b>白板没能打开</b><p>房间不受影响，可以收起白板再试一次。</p></div>';
    }
  }

  /* 白板权限在收端执行：发送者的 commons.role 由服务端写进令牌属性，客户端改不了（canUpdateOwnMetadata = false）。 */
  function boardOpAllowed(op, participant) {
    var attrs = participant.attributes || {};
    var role = attrs['commons.role'] || 'listener';
    var mode = (S.live.detail && S.live.detail.board_mode) || 'host';
    if (!op || typeof op !== 'object' || String(op.actor || '') !== String(participant.identity)) return false;
    if (role === 'host') return true;
    if (op.type === 'view' || op.type === 'laser') return false;
    if (op.type === 'cursor') return true;
    return mode === 'all' || (mode === 'speakers' && role === 'speaker');
  }

  function unmountBoard() {
    if (S.board && typeof S.board.destroy === 'function') {
      try { S.board.destroy(); } catch (e) { /* 忽略 */ }
    }
    S.board = null;
    S.boardFor = '';
  }

  function onBoardOp(op) {
    if (!isLive() || !S.lk || !S.lk.localParticipant) return;
    try {
      var bytes = new TextEncoder().encode(JSON.stringify(op));
      var lossy = op.type === 'cursor' || op.type === 'laser' || op.type === 'view';
      S.lk.localParticipant.publishData(bytes, { reliable: !lossy, topic: 'board' });
    } catch (e) { /* 数据通道断了就等重连 */ }
  }

  /* ------------------------------------------------------------ 会后页 */

  function endedPage(r) {
    var boards = r.materials.filter(function (m) { return m.kind === 'board'; });
    return '<header class="rm-room-head"><a class="rm-back" href="#/rooms">' + icon('back') + '<span>房间</span></a>' +
      '<div class="rm-room-title"><h1>' + esc(r.title) + '</h1><div class="rm-room-meta">' + pill(KIND[r.kind], 'gray') + pill('已结束', 'gray') +
      '<small>' + esc(dayText(r.startsAt)) + ' ' + esc(clockText(r.startsAt)) + ' · 主持 ' + esc(r.host.name) + (r.attended ? ' · ' + esc(String(r.attended)) + ' 人来过' : '') + '</small>' + sampleTag() + '</div></div></header>' +
      '<div class="rm-after">' +
      '<section class="rm-after-sec rm-norec"><h2>本场未录制</h2><p>本场未保存投屏、电脑声音或麦克风，也没有生成讲堂回看。</p>' +
      '<dl class="rm-kv"><dt>录制</dt><dd>' + esc(r.recording.state === 'not_recorded' ? '没有录' : r.recording.state) + '</dd><dt>纪要</dt><dd>' + esc(r.minutes.state === 'none' ? '没有纪要' : r.minutes.state) + '</dd></dl></section>' +
      (r.agenda.length ? '<section class="rm-after-sec"><h2>议程</h2>' + agendaHtml(r).replace(/<div class="rm-sec-head">[\s\S]*?<\/div>/, '') + '</section>' : '') +
      '<section class="rm-after-sec"><h2>附件</h2>' + (boards.length ? '<ul class="rm-mats">' + boards.map(materialRow).join('') + '</ul>' : '<p class="rm-faint">这一场没有存白板。</p>') + '</section>' +
      '</div>';
  }

  /* ------------------------------------------------------------ 演示「模拟」面板 */

  function demoSimHtml(r) {
    if (isLive() || !r || r.state === 'scheduled') return '';
    var role = myRole(r);
    return '<details class="rm-sim" ' + (S.simOpen ? 'open' : '') + ' data-rm-sim><summary>模拟 ' + pill('示例', 'outline') + '</summary>' +
      '<div class="rm-sim-row"><span>我的身份</span><div class="segmented small" role="group" aria-label="我的身份（示例）">' +
      [['host', '主持人'], ['speaker', '发言人'], ['listener', '听众']].map(function (o) {
        return '<button type="button" aria-pressed="' + (role === o[0] ? 'true' : 'false') + '" data-room-act="sim" data-id="role-' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
      }).join('') + '</div></div>' +
      '<div class="rm-sim-btns">' +
      [['raise', '有人举手'], ['approve', '批准第一个举手'], ['invite-me', '主持人邀请我发言'], ['mute-me', '我被静音'], ['reconnect', '断线重连'],
        ['removed', '我被移出'], ['waiting', '等候室'], ['denied', '没有权限'], ['overtime', '快到点了'], ['ended', '房间结束'], ['reset', '恢复']].map(function (o) {
        return '<button type="button" class="button small ghost" data-room-act="sim" data-id="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
      }).join('') + '</div></details>';
  }

  function paintSim() {
    var el = region('sim');
    if (!el) return;
    var open = el.querySelector('[data-rm-sim]');
    if (open) S.simOpen = open.open;
    el.innerHTML = demoSimHtml(current());
  }

  /* ------------------------------------------------------------ 演示动作 */

  function demoAct(r, act, id, extra) {
    var me = S.me.id;
    var queueOf = function (pid) { return r.queue.filter(function (q) { return q.id === pid; })[0]; };
    var speakerOf = function (pid) { return r.speakers.filter(function (s) { return s.id === pid; })[0]; };
    var dropQueue = function (pid) { r.queue = r.queue.filter(function (q) { return q.id !== pid; }); };
    var toSpeaker = function (pid) {
      r.listeners = r.listeners.filter(function (x) { return x !== pid; });
      if (!speakerOf(pid)) r.speakers.push({ id: pid, role: 'speaker', speaking: false });
      dropQueue(pid);
    };
    var toListener = function (pid) {
      r.speakers = r.speakers.filter(function (s) { return s.id !== pid; });
      if (pid !== me && r.listeners.indexOf(pid) < 0) r.listeners.unshift(pid);
    };
    if (act === 'hand') {
      if (id === 'raise' && !queueOf(me)) {
        if (S.me.level < 2) { toast('L2 以上才能举手（示例）'); return; }
        r.queue.push({ id: me, state: 'raised' });
      } else if (id === 'lower') {
        dropQueue(me);
      } else if (id === 'accept') {
        toSpeaker(me);
        S.micOn = false;
      } else if (id === 'decline') {
        dropQueue(me);
      }
    } else if (act === 'host') {
      if (id === 'approve') toSpeaker(extra.pid);
      else if (id === 'reject') dropQueue(extra.pid);
      else if (id === 'invite') { if (!queueOf(extra.pid)) r.queue.push({ id: extra.pid, state: 'invited' }); later(function () { toSpeaker(extra.pid); paintRoom(); }, 1600); }
      else if (id === 'down') { toListener(extra.pid); if (r.screenShare.activeId === extra.pid) clearDemoShare(r); }
      else if (id === 'mute' || id === 'unmute') { var s = speakerOf(extra.pid); if (s) { s.muted = id === 'mute'; s.speaking = false; if (extra.pid === me && id === 'mute') stopMic(); } }
      else if (id === 'remove') { r.removed[extra.pid] = extra.reason || 'host_decision'; toListener(extra.pid); r.listeners = r.listeners.filter(function (x) { return x !== extra.pid; }); dropQueue(extra.pid); if (r.screenShare.activeId === extra.pid) clearDemoShare(r); if (extra.pid === me) stopLocalCapture(); toast('已移出，对方重连也进不来（示例）'); }
      else if (id === 'lock' || id === 'unlock') r.locked = id === 'lock';
      else if (id === 'transfer') {
        var old = r.hostId;
        r.hostId = extra.pid;
        r.speakers = r.speakers.filter(function (x) { return x.id !== extra.pid; });
        r.listeners = r.listeners.filter(function (x) { return x !== extra.pid; });
        r.speakers.forEach(function (x) { if (x.id === old) x.role = 'speaker'; });
        r.speakers.unshift({ id: extra.pid, role: 'host', speaking: false });
        S.hostOpen = false;
        toast('主持已转交（示例）');
      } else if (id === 'end') {
        stopLocalCapture();
        if (S.board) r.materials.push({ kind: 'board', title: '白板 · ' + dayText(new Date().toISOString()) });
        r.state = 'ended';
        r.attended = r.speakers.length + r.listeners.length + (r.extraListeners || 0);
        S.boardOpen = false;
      } else if (id === 'extend') { r.extended += extra.minutes; r.extendedOnce = true; r.endsAt = new Date(ts(r.endsAt) + extra.minutes * 60000).toISOString(); }
      else if (id === 'board') r.boardMode = extra.mode;
      else if (id === 'stage') { r.stageMode = extra.surface; if (extra.surface === 'board') S.boardOpen = true; }
      else if (id === 'screen_approve') {
        r.screenShare.activeId = extra.pid;
        r.screenShare.pending = (r.screenShare.pending || []).filter(function (x) { return x !== extra.pid; });
        if (S.localDisplay) {
          S.sharing = true;
          S.localWhere = 'stage';
          r.screenShare.shareAudio = !!(S.localScreenAudio && !S.screenAudioMuted);
        }
      } else if (id === 'screen_reject') {
        r.screenShare.pending = (r.screenShare.pending || []).filter(function (x) { return x !== extra.pid; });
        if (extra.pid === me && S.localWhere === 'preview') {
          dropLocalDisplay();
          S.localWhere = '';
          S.previewFor = '';
        }
      } else if (id === 'screen_takeover') {
        dropLocalDisplay();
        S.sharing = false;
        S.localWhere = '';
        S.previewFor = '';
        S.screenReason = '';
        r.screenShare.activeId = me;
        r.screenShare.shareAudio = S.shareAudio;
      } else if (id === 'screen_stop') {
        if (r.screenShare.activeId === extra.pid) clearDemoShare(r);
      }
      else if (id === 'agenda_next') {
        var cur = r.agenda.findIndex(function (a) { return a.state === 'current'; });
        if (cur >= 0) r.agenda[cur].state = 'done';
        var nxt = r.agenda.findIndex(function (a) { return a.state === 'pending'; });
        if (nxt >= 0) r.agenda[nxt].state = 'current';
      } else if (id === 'start') {
        r.state = 'live';
        r.startOffsetMin = 0;
        r.startsAt = new Date().toISOString();
        r.endsAt = isoIn(r.duration);
        if (r.agenda.length && !r.agenda.some(function (a) { return a.state === 'current'; })) r.agenda[0].state = 'current';
        S.conn = 'connected';
      } else if (id === 'signup_approve' || id === 'signup_reject') {
        r.signupQueue = (r.signupQueue || []).filter(function (x) { return x !== extra.pid; });
      }
    } else if (act === 'mic') {
      S.micOn = !S.micOn;
      var mine = speakerOf(me);
      if (mine) mine.speaking = S.micOn;
    }
  }

  function simAct(r, id) {
    var me = S.me.id;
    if (id.indexOf('role-') === 0) {
      var role = id.slice(5);
      if (role === 'host') {
        if (r.hostId !== me) {
          var prev = r.hostId;
          r.speakers = r.speakers.filter(function (s) { return s.id !== me; });
          r.speakers.forEach(function (s) { if (s.id === prev) s.role = 'speaker'; });
          r.hostId = me;
          r.speakers.unshift({ id: me, role: 'host', speaking: true });
        }
      } else {
        if (r.hostId === me) {
          var other = r.speakers.filter(function (s) { return s.id !== me; })[0];
          r.hostId = other ? other.id : 'p-beichen';
          r.speakers = r.speakers.filter(function (s) { return s.id !== r.hostId; });
          r.speakers.unshift({ id: r.hostId, role: 'host', speaking: true });
          S.hostOpen = false;
        }
        r.speakers = r.speakers.filter(function (s) { return s.id !== me; });
        r.queue = r.queue.filter(function (q) { return q.id !== me; });
        if (role === 'speaker') r.speakers.push({ id: me, role: 'speaker', speaking: false });
      }
      stopMic();
    } else if (id === 'raise') {
      var cand = r.listeners.filter(function (pid) { return !r.queue.some(function (q) { return q.id === pid; }); })[0];
      if (cand) r.queue.push({ id: cand, state: 'raised' });
      toast(cand ? person(cand).name + ' 举手了（示例）' : '没有更多听众了');
    } else if (id === 'approve') {
      var first = r.queue.filter(function (q) { return q.state === 'raised'; })[0];
      if (first) demoAct(r, 'host', 'approve', { pid: first.id });
    } else if (id === 'invite-me') {
      if (myRole(fromSample(r)) === 'listener') r.queue = r.queue.filter(function (q) { return q.id !== me; }).concat([{ id: me, state: 'invited' }]);
    } else if (id === 'mute-me') {
      var mine = r.speakers.filter(function (s) { return s.id === me; })[0];
      if (mine && mine.role !== 'host') { mine.muted = true; mine.speaking = false; S.micOn = false; } else toast('先切到「发言人」再试（主持人不会被静音）');
    } else if (id === 'reconnect') {
      S.conn = 'reconnecting';
      later(function () { S.conn = 'connected'; paintRoom(); }, 2400);
    } else if (id === 'removed') {
      stopLocalCapture();
      S.conn = 'removed';
      S.reason = 'off_topic';
    } else if (id === 'waiting') {
      S.conn = 'waiting';
      later(function () { if (S.conn === 'waiting') { S.conn = 'connecting'; paintRoom(); later(function () { S.conn = 'connected'; paintRoom(); }, 700); } }, 3000);
    } else if (id === 'denied') {
      S.conn = 'denied';
    } else if (id === 'overtime') {
      r.endsAt = isoIn(4);
      r.duration = Math.max(15, Math.round((ts(r.endsAt) - ts(r.startsAt)) / 60000));
    } else if (id === 'ended') {
      demoAct(r, 'host', 'end', {});
    } else if (id === 'reset') {
      stopLocalCapture();
      S.data = null;
      S.conn = 'connected';
      S.micOn = false;
      S.hostOpen = false;
      S.confirm = null;
      demo();
    }
  }

  /* ------------------------------------------------------------ live 模式：接口 */

  function setLiveMe(m) {
    if (!m) return;
    S.live.me = m;
    S.me = { id: m.id, name: m.display_name, level: m.level, roles: m.roles || [] };
  }

  function loadList() {
    S.live.error = null;
    var a = api();
    Promise.all([
      a.get('/rooms', { state: 'live' }), a.get('/rooms', { state: 'scheduled' }), a.get('/rooms', { state: 'ended', limit: 5 }),
      a.get('/rooms/abilities'), a.me().catch(function () { return null; })
    ]).then(function (res) {
      if (S.view !== 'list') return;
      S.live.list = res[0].data;
      S.live.scheduled = res[1].data;
      S.live.ended = res[2].data;
      S.live.abilities = res[3].data;
      setLiveMe(res[4]);
      paintList();
    }, function (err) {
      if (S.view !== 'list') return;
      S.live.error = err;
      paintList();
    });
  }

  function onApiError(err) {
    var code = err && err.code;
    if (code === 'room_removed') {
      S.conn = 'removed';
      S.reason = (err.details && err.details.reason) || 'host_decision';
    } else if (code === 'resource_not_found') {
      S.conn = 'denied';
    } else if (code === 'room_ended') {
      S.conn = 'ended';
    } else if (code === 'room_locked') {
      S.conn = 'error';
      S.errorMsg = '房间已锁定，新人现在进不了';
    } else if (code === 'room_signup_rejected') {
      S.conn = 'error';
      S.errorMsg = '主持人没有通过你的报名';
    } else if (code === 'room_not_live') {
      S.conn = 'idle';
    } else {
      S.conn = 'error';
      S.errorMsg = (err && err.message) || '进房失败';
    }
    if (S.conn !== 'error') S.live.join = null;
    teardownMedia();
    paintRoom();
  }

  function loadRoom(autoJoin) {
    var id = S.roomId;
    var who = S.live.me ? Promise.resolve(S.live.me) : api().me().catch(function () { return null; });
    who.then(function (m) {
      setLiveMe(m);
      return api().get('/rooms/' + encodeURIComponent(id));
    }).then(function (r) {
      if (S.roomId !== id) return;
      var prevEpoch = S.live.detail && S.live.detail.me && S.live.detail.me.epoch;
      S.live.detail = r.data;
      if (r.data.state === 'ended') S.conn = 'ended';
      paintRoom();
      if (r.data.state !== 'ended') loadChat();
      if (autoJoin && r.data.state === 'live' && !S.live.join) join();
      else if (S.live.join && r.data.me && r.data.me.present && prevEpoch && r.data.me.epoch !== prevEpoch) refreshToken();
    }, function (err) {
      if (S.roomId !== id) return;
      if (!S.live.detail) S.live.error = err;
      onApiError(err);
    });
  }

  function join() {
    if (S.conn !== 'waiting') {
      S.conn = 'connecting';
      paintRoom();
    }
    api().post('/rooms/' + encodeURIComponent(S.roomId) + '/join', {}).then(function (r) {
      if (r.data.state === 'waiting') {
        S.conn = 'waiting';
        paintRoom();
        return;
      }
      S.live.join = r.data;
      connectMedia(r.data);
    }, onApiError);
  }

  function refreshToken() {
    api().post('/rooms/' + encodeURIComponent(S.roomId) + '/join', {}).then(function (r) {
      if (r.data.state === 'joined') S.live.join = r.data;
    }, onApiError);
  }

  function liveAction(path, body) {
    var opts = path === '/host' ? { idempotencyKey: api().newIdempotencyKey() } : undefined;
    return api().post('/rooms/' + encodeURIComponent(S.roomId) + path, body, opts).then(function (r) {
      if (r.data && r.data.id === S.roomId) S.live.detail = r.data;
      paintRoom();
      return r;
    }, function (err) {
      if (err && (err.code === 'room_removed' || err.code === 'resource_not_found' || err.code === 'room_ended')) onApiError(err);
      else toast((err && err.message) || '没有成功');
      return null;
    });
  }

  function startPoll() {
    stopPoll();
    S.poll = window.setInterval(function () {
      if (document.visibilityState !== 'visible' || S.view !== 'room') return;
      if (S.conn === 'removed' || S.conn === 'denied' || S.conn === 'ended') return;
      loadRoom(S.conn === 'waiting' || S.conn === 'idle');
    }, 5000);
  }

  function stopPoll() {
    if (S.poll) window.clearInterval(S.poll);
    S.poll = 0;
  }

  /* ------------------------------------------------------------ live 模式：媒体（LiveKit，部署机验证） */

  function loadLiveKit() {
    return new Promise(function (resolve, reject) {
      if (window.LivekitClient) { resolve(window.LivekitClient); return; }
      var s = document.createElement('script');
      s.src = 'vendor/livekit-client.min.js';
      s.onload = function () { if (window.LivekitClient) resolve(window.LivekitClient); else reject(new Error('missing')); };
      s.onerror = function () { reject(new Error('load')); };
      document.head.appendChild(s);
    });
  }

  function screenSource(track, publication) {
    return String((publication && publication.source) || (track && track.source) || '').toLowerCase().indexOf('screen') >= 0;
  }

  function streamTracks(stream, kind) {
    if (!stream) return [];
    var all = [];
    if (kind === 'video' && stream.getVideoTracks) all = stream.getVideoTracks();
    else if (kind === 'audio' && stream.getAudioTracks) all = stream.getAudioTracks();
    else if (stream.getTracks) all = stream.getTracks();
    return all || [];
  }

  function stopStream(stream) {
    streamTracks(stream).forEach(function (track) {
      if (track && typeof track.stop === 'function') {
        try { track.stop(); } catch (e) { /* 忽略 */ }
      }
    });
  }

  function disconnectAnalyser(kind) {
    var src = kind === 'mic' ? S.micSource : S.screenSource;
    if (src && src.disconnect) {
      try { src.disconnect(); } catch (e) { /* 忽略 */ }
    }
    if (kind === 'mic') { S.micSource = null; S.micAnalyser = null; }
    else { S.screenSource = null; S.screenAnalyser = null; }
  }

  function closeAudio() {
    disconnectAnalyser('mic');
    disconnectAnalyser('screen');
    var ctx = S.audioCtx;
    S.audioCtx = null;
    if (ctx && ctx.state !== 'closed' && typeof ctx.close === 'function') {
      try { ctx.close(); } catch (e) { /* 忽略 */ }
    }
  }

  function wireAnalyser(kind, track) {
    disconnectAnalyser(kind);
    if (!track) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (typeof AC !== 'function' || typeof MediaStream !== 'function') return;
    try {
      if (!S.audioCtx || S.audioCtx.state === 'closed') S.audioCtx = new AC();
      if (S.audioCtx.state === 'suspended' && S.audioCtx.resume) S.audioCtx.resume();
      var src = S.audioCtx.createMediaStreamSource(new MediaStream([track]));
      var an = S.audioCtx.createAnalyser();
      an.fftSize = 256;
      src.connect(an);
      if (kind === 'mic') { S.micSource = src; S.micAnalyser = an; }
      else { S.screenSource = src; S.screenAnalyser = an; }
    } catch (e) { /* 没有音频分析时音量条保持不动 */ }
  }

  function dropLocalDisplay() {
    var track = S.localVideoTrack;
    if (track && track.removeEventListener) track.removeEventListener('ended', onLocalVideoEnded);
    var stream = S.localDisplay;
    S.localDisplay = null;
    S.localVideoTrack = null;
    S.localScreenAudio = null;
    if (stream) stopStream(stream);
    disconnectAnalyser('screen');
    if (S.localVideoEl) { try { S.localVideoEl.srcObject = null; } catch (e) { /* 忽略 */ } }
    if (S.localThumbEl) { try { S.localThumbEl.srcObject = null; } catch (e) { /* 忽略 */ } }
  }

  function stopMic() {
    disconnectAnalyser('mic');
    var stream = S.localMic;
    S.localMic = null;
    S.localMicTrack = null;
    S.micOn = false;
    S.micMuted = false;
    if (stream) stopStream(stream);
  }

  function clearDemoShare(r) {
    if (S.localWhere === 'stage' || S.sharing) {
      dropLocalDisplay();
      S.localWhere = '';
      S.previewFor = '';
    }
    S.sharing = false;
    if (r && r.screenShare) r.screenShare.activeId = null;
  }

  function stopLocalCapture() {
    S.captureSeq += 1;
    S.captureBusy = false;
    S.micBusy = false;
    dropLocalDisplay();
    stopMic();
    S.sharing = false;
    S.localWhere = '';
    S.previewFor = '';
    S.screenReason = '';
    closeAudio();
  }

  function adoptDisplay(stream) {
    S.localDisplay = stream;
    S.screenReason = '';
    var videos = streamTracks(stream, 'video');
    var audios = streamTracks(stream, 'audio');
    S.localVideoTrack = videos[0] || null;
    S.localScreenAudio = audios[0] || null;
    if (S.localScreenAudio && !S.shareAudio) {
      S.localScreenAudio.enabled = false;
      S.screenAudioMuted = true;
    } else {
      S.screenAudioMuted = !S.localScreenAudio;
    }
    if (S.localVideoTrack && S.localVideoTrack.addEventListener) {
      S.localVideoTrack.addEventListener('ended', onLocalVideoEnded);
    }
    wireAnalyser('screen', S.localScreenAudio && S.localScreenAudio.enabled ? S.localScreenAudio : null);
  }

  function onLocalVideoEnded() {
    if (!S.localVideoTrack && !S.localDisplay) return;
    var r = !isLive() ? demoRoom(S.roomId) : null;
    var wasStage = S.localWhere === 'stage' || S.sharing;
    var wasPreview = S.localWhere === 'preview';
    dropLocalDisplay();
    S.sharing = false;
    S.localWhere = '';
    S.previewFor = '';
    if (wasStage && r && r.screenShare) r.screenShare.activeId = null;
    if (wasPreview && r && r.screenShare) {
      r.screenShare.pending = (r.screenShare.pending || []).filter(function (x) { return x !== meId(); });
    }
    if (S.view === 'room') paintRoom();
  }

  function captureDisplay() {
    var seq = S.captureSeq + 1;
    S.captureSeq = seq;
    var md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (!md || typeof md.getDisplayMedia !== 'function') {
      S.screenReason = '这台浏览器不能投屏';
      S.sharing = false;
      if (S.view === 'room') paintRoom();
      return Promise.resolve(null);
    }
    var pending;
    try {
      pending = md.getDisplayMedia({ video: true, audio: true });
    } catch (e) {
      S.screenReason = '这台浏览器不能投屏';
      S.sharing = false;
      if (S.view === 'room') paintRoom();
      return Promise.resolve(null);
    }
    if (!pending || typeof pending.then !== 'function') {
      S.screenReason = '这台浏览器不能投屏';
      S.sharing = false;
      if (S.view === 'room') paintRoom();
      return Promise.resolve(null);
    }
    return pending.then(function (stream) {
      if (seq !== S.captureSeq || S.view !== 'room') {
        stopStream(stream);
        return null;
      }
      if (!stream || typeof stream.getTracks !== 'function') {
        S.screenReason = '这台浏览器不能投屏';
        S.sharing = false;
        paintRoom();
        return null;
      }
      dropLocalDisplay();
      adoptDisplay(stream);
      return stream;
    }, function () {
      if (seq !== S.captureSeq) return null;
      S.screenReason = '已取消，仍显示示意画面';
      S.sharing = false;
      if (S.localWhere === 'stage') S.localWhere = '';
      if (S.view === 'room') paintRoom();
      return null;
    });
  }

  function openMic(r) {
    if (S.micBusy || S.micOn) return;
    var md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (!md || typeof md.getUserMedia !== 'function') {
      toast('这台浏览器不能开麦');
      return;
    }
    var pending;
    try { pending = md.getUserMedia({ audio: true }); }
    catch (e) { toast('没有打开麦克风'); return; }
    if (!pending || typeof pending.then !== 'function') { toast('没有打开麦克风'); return; }
    S.micBusy = true;
    pending.then(function (stream) {
      S.micBusy = false;
      if (S.view !== 'room') { stopStream(stream); return; }
      var vm = current();
      if (vm && (myRole(vm) === 'listener' || vm.me.muted)) { stopStream(stream); return; }
      stopMic();
      S.localMic = stream;
      var audios = streamTracks(stream, 'audio');
      S.localMicTrack = audios[0] || null;
      if (S.localMicTrack) S.localMicTrack.enabled = true;
      S.micOn = true;
      S.micMuted = false;
      wireAnalyser('mic', S.localMicTrack);
      if (!isLive() && r) {
        var mine = r.speakers.filter(function (s) { return s.id === meId(); })[0];
        if (mine && !mine.muted) mine.speaking = true;
      }
      paintRoom();
    }, function () {
      S.micBusy = false;
      toast('没有打开麦克风');
    });
  }

  function closeMic(r) {
    stopMic();
    if (!isLive() && r) {
      var mine = r.speakers.filter(function (s) { return s.id === meId(); })[0];
      if (mine) mine.speaking = false;
    }
    paintRoom();
  }

  function toggleTrackMute(r, kind) {
    if (kind === 'mic') {
      if (!S.localMicTrack) return;
      S.micMuted = !S.micMuted;
      S.localMicTrack.enabled = !S.micMuted;
      if (S.micMuted) disconnectAnalyser('mic');
      else wireAnalyser('mic', S.localMicTrack);
    } else {
      if (!S.localScreenAudio) return;
      S.screenAudioMuted = !S.screenAudioMuted;
      S.localScreenAudio.enabled = !S.screenAudioMuted;
      if (S.screenAudioMuted) disconnectAnalyser('screen');
      else wireAnalyser('screen', S.localScreenAudio);
    }
    if (!isLive() && r) {
      var mine = r.speakers.filter(function (s) { return s.id === meId(); })[0];
      if (mine) mine.speaking = !!(S.micOn && !S.micMuted && !mine.muted);
    }
    paintRoom();
  }

  function makeVideo(label) {
    var v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('aria-label', label);
    return v;
  }

  function playInto(el, stream) {
    if (!el) return;
    try { if (el.srcObject !== stream) el.srcObject = stream; } catch (e) { /* 忽略 */ }
    if (!el.play) return;
    try {
      var pending = el.play();
      if (pending && typeof pending.catch === 'function') pending.catch(function () {});
    } catch (e2) { /* 自动播放被拦 */ }
  }

  function mountLocalVideos(r) {
    var rootEl = root();
    if (!rootEl || !S.localDisplay) return;
    if (showingLocalStage()) {
      var host = rootEl.querySelector('[data-rm-screen-media]');
      if (host) {
        if (!S.localVideoEl) S.localVideoEl = makeVideo('本机投屏画面');
        host.innerHTML = '';
        host.appendChild(S.localVideoEl);
        playInto(S.localVideoEl, S.localDisplay);
      }
    }
    var liveId = r ? thumbTarget(r) : '';
    if (!liveId) return;
    var thumb = rootEl.querySelector('[data-rm-screen-thumb="' + String(liveId).replace(/"/g, '') + '"]');
    if (!thumb) return;
    if (!S.localThumbEl) S.localThumbEl = makeVideo('本机投屏预览');
    thumb.innerHTML = '';
    thumb.appendChild(S.localThumbEl);
    playInto(S.localThumbEl, S.localDisplay);
  }

  function mountScreenMedia(r) {
    mountLocalVideos(r);
    if (showingLocalStage()) return;
    var host = root() && root().querySelector('[data-rm-screen-media]');
    if (!host || !isLive() || !S.screenVideoTrack) return;
    if (!S.screenMediaEl) {
      try {
        S.screenMediaEl = S.screenVideoTrack.attach();
        S.screenMediaEl.setAttribute('playsinline', '');
        S.screenMediaEl.muted = true;
        S.screenMediaEl.setAttribute('muted', '');
        S.screenMediaEl.setAttribute('aria-label', '共享的屏幕');
      } catch (e) { return; }
    }
    host.innerHTML = '';
    host.appendChild(S.screenMediaEl);
  }

  function connectMedia(j) {
    if (!j.media || j.media.provider !== 'livekit') {
      S.conn = 'connected';
      paintRoom();
      return;
    }
    loadLiveKit().then(function (LK) {
      if (S.view !== 'room') return null;
      teardownMedia();
      var room = new LK.Room({ adaptiveStream: true, dynacast: true });
      var E = LK.RoomEvent;
      S.lk = room;
      room.on(E.Reconnecting, function () { S.conn = 'reconnecting'; paintRoom(); });
      room.on(E.Reconnected, function () { S.conn = 'connected'; paintRoom(); });
      room.on(E.Disconnected, function () { if (S.lk === room) onDisconnected(); });
      room.on(E.ActiveSpeakersChanged, function (list) {
        S.levels = {};
        (list || []).forEach(function (p) { S.levels[p.identity] = true; });
        if (S.live.detail) paintRoom();
      });
      room.on(E.TrackSubscribed, function (track, publication) {
        if (track && track.kind === 'video' && screenSource(track, publication)) {
          S.screenVideoTrack = track;
          if (S.live.detail) paintRoom();
        } else if (track && track.kind === 'audio') {
          if (screenSource(track, publication)) S.screenAudioTrack = track;
          var el = track.attach();
          el.hidden = true;
          document.body.appendChild(el);
          S.lkAudio.push(el);
        }
      });
      room.on(E.TrackUnsubscribed, function (track, publication) {
        if (track === S.screenVideoTrack || (track && track.kind === 'video' && screenSource(track, publication))) {
          S.screenVideoTrack = null;
          S.screenMediaEl = null;
          if (S.live.detail) paintRoom();
        }
        if (track === S.screenAudioTrack) S.screenAudioTrack = null;
      });
      room.on(E.DataReceived, function (payload, participant, kind, topic) {
        if (topic !== 'board' || !S.board || !S.board.apply || !participant) return;
        try {
          var op = JSON.parse(new TextDecoder().decode(payload));
          if (boardOpAllowed(op, participant)) S.board.apply(op);
        } catch (e) { /* 坏包丢弃 */ }
      });
      return room.connect(j.media.url, j.media.token, { autoSubscribe: true }).then(function () {
        S.conn = 'connected';
        S.micOn = false;
        paintRoom();
      });
    }).catch(function () {
      S.conn = 'error';
      S.errorMsg = '音视频没连上';
      paintRoom();
    });
  }

  function onDisconnected() {
    teardownMedia();
    api().get('/rooms/' + encodeURIComponent(S.roomId)).then(function (r) {
      S.live.detail = r.data;
      if (r.data.state === 'ended') { S.conn = 'ended'; paintRoom(); return; }
      S.live.join = null;
      join();
    }, onApiError);
  }

  function teardownMedia() {
    dropLocalDisplay();
    S.localWhere = '';
    S.previewFor = '';
    if (S.lk) {
      var room = S.lk;
      S.lk = null;
      try { room.disconnect(); } catch (e) { /* 忽略 */ }
    }
    S.lkAudio.forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
    S.lkAudio = [];
    if (S.screenVideoTrack && S.screenMediaEl) {
      try { S.screenVideoTrack.detach(S.screenMediaEl); } catch (e) { /* 忽略 */ }
    }
    S.screenVideoTrack = null;
    S.screenAudioTrack = null;
    S.screenMediaEl = null;
    S.sharing = false;
  }

  /* ------------------------------------------------------------ 声波：本机采集用 AnalyserNode，示意画面仍用合成电平 */

  function hash(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
    return h / 9973 * Math.PI * 2;
  }

  function synth(id, t) {
    var ph = hash(id);
    var env = Math.max(0, Math.sin(t * 0.9 + ph) * 0.6 + 0.5);
    var v = 0.5 * Math.abs(Math.sin(t * 7.1 + ph)) + 0.3 * Math.abs(Math.sin(t * 12.7 + ph * 1.7)) + 0.2 * Math.abs(Math.sin(t * 3.3 + ph * 0.5));
    return Math.min(1, v * env);
  }

  function levelOf(id, t) {
    if (!isLive()) return synth(id, t);
    var room = S.lk;
    if (!room) return 0;
    var p = room.localParticipant && room.localParticipant.identity === id ? room.localParticipant
      : room.remoteParticipants && room.remoteParticipants.get ? room.remoteParticipants.get(id) : null;
    return p ? Math.min(1, (p.audioLevel || 0) * 2) : 0;
  }

  function analyserLevel(an) {
    if (!an || typeof an.getByteTimeDomainData !== 'function') return null;
    var n = an.fftSize || 256;
    if (!S.bins || S.bins.length !== n) S.bins = new Uint8Array(n);
    try { an.getByteTimeDomainData(S.bins); } catch (e) { return null; }
    var sum = 0;
    var i;
    for (i = 0; i < S.bins.length; i++) {
      var v = (S.bins[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / S.bins.length) * 4);
  }

  function meterValue(kind, id, t) {
    if (kind === 'screen') {
      if (S.localDisplay) {
        if (!S.localScreenAudio || S.screenAudioMuted) return 0;
        var screenLevel = analyserLevel(S.screenAnalyser);
        if (screenLevel != null) return screenLevel;
      }
      if (!isLive()) return synth(id + '-screen', t);
      return Math.min(1, ((S.screenAudioTrack && S.screenAudioTrack.audioLevel) || 0) * 2);
    }
    if (S.localMicTrack) {
      if (!S.micOn || S.micMuted) return 0;
      var micLevel = analyserLevel(S.micAnalyser);
      if (micLevel != null) return micLevel;
    }
    return levelOf(id, t);
  }

  function ensureRaf() {
    if (S.raf) return;
    var r = root();
    if (!r) return;
    var motion = !reduced();
    if (!r.querySelector('[data-rm-meter]') && !(motion && r.querySelector('[data-rm-level]'))) return;
    var smooth = {};
    var tick = function (now) {
      S.raf = 0;
      var el = root();
      if (!el || document.visibilityState !== 'visible') return;
      var t = now / 1000;
      if (!reduced()) {
        Array.prototype.forEach.call(el.querySelectorAll('[data-rm-level]'), function (ring) {
          var id = ring.getAttribute('data-rm-level');
          var target = levelOf(id, t);
          var prev = smooth[id] || 0;
          var v = prev + (target - prev) * (target > prev ? 0.35 : 0.12);
          smooth[id] = v;
          ring.style.setProperty('--rm-lv', v.toFixed(3));
        });
      }
      Array.prototype.forEach.call(el.querySelectorAll('[data-rm-meter]'), function (meter) {
        var id = meter.getAttribute('data-id') || '';
        var kind = meter.getAttribute('data-rm-meter');
        var value = meterValue(kind, id, t);
        meter.style.setProperty('--rm-meter', value.toFixed(3));
        meter.setAttribute('aria-valuenow', String(Math.round(value * 100)));
      });
      if (el.querySelector('[data-rm-meter]') || (!reduced() && el.querySelector('[data-rm-level]'))) {
        S.raf = window.requestAnimationFrame(tick);
      }
    };
    S.raf = window.requestAnimationFrame(tick);
  }

  function stopRaf() {
    if (S.raf) window.cancelAnimationFrame(S.raf);
    S.raf = 0;
  }

  /* ------------------------------------------------------------ 事件 */

  function rerenderAfter() {
    if (S.view === 'room') paintRoom();
    else paintList();
  }

  function onClick(e) {
    var btn = e.target.closest('[data-room-act]');
    if (!btn || !root() || !root().contains(btn)) return;
    var act = btn.getAttribute('data-room-act');
    var id = btn.getAttribute('data-id') || '';
    if (btn.tagName === 'A' && act !== 'create-open') return;
    e.preventDefault();
    if (act === 'reload') { if (S.view === 'list') { S.live.list = null; paintList(); loadList(); } else { S.live.error = null; S.live.detail = null; S.conn = 'idle'; paintRoom(); loadRoom(true); } return; }
    if (act === 'create-open') { openCreate(btn.getAttribute('data-kind') || ''); return; }
    if (act === 'create-close') { closeCreate(); return; }
    if (act === 'provider') { S.create.provider = id; paintDialog(); return; }
    if (act === 'agenda-add') { S.create.agenda.push({ title: '', minutes: 10 }); paintDialog(); return; }
    if (act === 'agenda-del') { S.create.agenda.splice(Number(btn.getAttribute('data-index')), 1); if (!S.create.agenda.length) S.create.agenda.push({ title: '', minutes: 10 }); paintDialog(); return; }
    if (act === 'invite-toggle') {
      var inv = S.create.access.invitees;
      var at = inv.indexOf(id);
      if (at >= 0) inv.splice(at, 1); else inv.push(id);
      paintDialog();
      estimate();
      return;
    }
    if (act === 'as') {
      S.me = { id: S.me.id, name: S.me.name, level: id === 'host' ? 2 : Number(id), roles: id === 'host' ? ['host'] : [] };
      paintList();
      return;
    }
    if (act === 'signup' || act === 'signup-withdraw') { signupAct(id, act === 'signup-withdraw'); return; }
    if (act === 'chat-more') { loadMoreChat(); return; }
    if (act === 'chat-delete') { deleteChat(id); return; }
    if (act === 'rejoin') { S.conn = 'idle'; S.live.join = null; loadRoom(true); return; }
    roomClick(act, id, btn);
  }

  function signupAct(id, withdraw) {
    if (isLive()) {
      api().post('/rooms/' + encodeURIComponent(id) + '/signup', { withdraw: withdraw }).then(function () {
        if (S.view === 'list') loadList(); else loadRoom(false);
      }, function (err) { toast((err && err.message) || '没有成功'); });
      return;
    }
    var r = demoRoom(id);
    if (!r) return;
    var needs = r.access.some(function (a) { return a.kind === 'signup'; });
    r.mySignup = withdraw ? null : needs ? 'pending' : 'approved';
    if (!withdraw) toast(needs ? '已报名，等主持人批准（示例）' : '已报名，开始前 10 分钟提醒你（示例）');
    rerenderAfter();
  }

  function roomClick(act, id, btn) {
    var r = isLive() ? null : demoRoom(S.roomId);
    var vm = current();
    if (!vm) return;
    if (act === 'host-toggle') {
      S.hostOpen = !S.hostOpen;
      S.confirm = null;
      paintRoom(S.hostOpen ? null : { act: 'host-toggle' });
      if (S.hostOpen) focusHostPanel();
      return;
    }
    if (act === 'board-toggle') { S.boardOpen = !S.boardOpen; paintRoom(); return; }
    if (act === 'stage-mode') {
      if (id === 'board') S.boardOpen = true;
      if (isLive()) hostAct(r, 'stage', { surface: id });
      else { r.stageMode = id; rerenderAfter(); }
      return;
    }
    if (act === 'screen-fit') { S.screenFit = id === 'original' ? 'original' : 'fit'; paintRoom(); return; }
    if (act === 'screen-full') {
      var target = root().querySelector('[data-rm-fullscreen]');
      if (target && target.requestFullscreen) {
        var entered = target.requestFullscreen();
        if (entered && typeof entered.catch === 'function') entered.catch(function () { toast('浏览器没有进入全屏'); });
      }
      return;
    }
    if (act === 'screen-request') { requestScreen(r); return; }
    if (act === 'screen-start') { startScreenShare(r); return; }
    if (act === 'screen-stop') { stopScreenShare(r); return; }
    if (act === 'track-mute') { toggleTrackMute(r, id); return; }
    if (act === 'screen-takeover') { hostAct(r, 'screen_takeover', { share_audio: S.shareAudio }); return; }
    if (act === 'screen-host-stop') { hostAct(r, 'screen_stop', { pid: id }); return; }
    if (act === 'confirm') { S.confirm = { kind: btn.getAttribute('data-host'), id: id, reason: 'disruptive' }; paintRoom(); focusConfirm(); return; }
    if (act === 'confirm-no') { S.confirm = null; paintRoom(); return; }
    if (act === 'confirm-yes') {
      var c = S.confirm;
      S.confirm = null;
      if (!c) return;
      if (c.kind === 'end') endRoom(vm, r);
      else hostAct(r, c.kind, { pid: c.id, reason: c.reason });
      return;
    }
    if (act === 'host') {
      hostAct(r, btn.getAttribute('data-host'), { pid: id, mode: btn.getAttribute('data-mode'), minutes: Number(btn.getAttribute('data-minutes')) || 0 });
      return;
    }
    if (act === 'hand') {
      if (isLive()) { liveAction('/hand', { action: id }); return; }
      demoAct(r, 'hand', id);
      rerenderAfter();
      return;
    }
    if (act === 'mic') {
      if (S.micOn) closeMic(r);
      else openMic(r);
      return;
    }
    if (act === 'leave') {
      stopLocalCapture();
      if (isLive()) {
        var done = function () { teardownMedia(); location.hash = '#/rooms'; };
        S.live.join = null;
        api().post('/rooms/' + encodeURIComponent(S.roomId) + '/leave', {}).then(done, done);
        return;
      }
      toast('已离开房间（示例）');
      location.hash = '#/rooms';
      return;
    }
    if (act === 'sim' && r) {
      simAct(r, id);
      rerenderAfter();
    }
  }

  function hostAct(r, action, extra) {
    if (isLive()) {
      var body = { action: action };
      if (extra.pid) body.principal_id = extra.pid;
      if (action === 'remove') body.reason_code = extra.reason || 'host_decision';
      if (action === 'board') body.mode = extra.mode;
      if (action === 'stage') body.surface = extra.surface;
      if (action === 'screen_takeover') body.share_audio = extra.share_audio !== false;
      if (action === 'extend') body.minutes = extra.minutes || 15;
      liveAction('/host', body).then(function (res) {
        if (res && action === 'start' && !S.live.join) join();
      });
      return;
    }
    demoAct(r, 'host', action, extra);
    rerenderAfter();
  }

  function startScreenShare(r) {
    if (S.captureBusy) return;
    S.captureBusy = true;
    captureDisplay().then(function (stream) {
      S.captureBusy = false;
      if (!stream) return;
      S.localWhere = 'stage';
      S.sharing = true;
      S.previewFor = meId();
      S.screenReason = '';
      if (!isLive() && r && r.screenShare) {
        r.screenShare.activeId = meId();
        r.screenShare.shareAudio = !!S.localScreenAudio && !S.screenAudioMuted;
        r.screenShare.pending = (r.screenShare.pending || []).filter(function (x) { return x !== meId(); });
      }
      paintRoom();
    }, function () { S.captureBusy = false; });
  }

  function requestScreen(r) {
    if (S.captureBusy) return;
    S.captureBusy = true;
    if (isLive()) liveAction('/screen', { action: 'request', share_audio: S.shareAudio });
    captureDisplay().then(function (stream) {
      S.captureBusy = false;
      if (!stream) return;
      S.localWhere = 'preview';
      S.sharing = false;
      S.previewFor = meId();
      S.screenReason = '';
      if (!isLive() && r && r.screenShare && (r.screenShare.pending || []).indexOf(meId()) < 0) {
        r.screenShare.pending.push(meId());
      }
      paintRoom();
    }, function () { S.captureBusy = false; });
  }

  function stopScreenShare(r) {
    if (isLive() && S.lk && S.lk.localParticipant && typeof S.lk.localParticipant.setScreenShareEnabled === 'function') {
      try { S.lk.localParticipant.setScreenShareEnabled(false); } catch (e) { /* 本地停止不依赖媒体层 */ }
    }
    dropLocalDisplay();
    S.sharing = false;
    S.localWhere = '';
    S.previewFor = '';
    S.captureBusy = false;
    if (isLive()) {
      liveAction('/screen', { action: 'stop', share_audio: S.shareAudio });
      return;
    }
    if (r && r.screenShare) r.screenShare.activeId = null;
    paintRoom();
  }

  function endRoom(vm, r) {
    if (!isLive()) {
      hostAct(r, 'end', {});
      return;
    }
    var save = S.board && S.board.getDoc ? api().post('/rooms/' + encodeURIComponent(S.roomId) + '/board', { doc: S.board.getDoc() }).catch(function () { return null; }) : Promise.resolve(null);
    save.then(function () { return liveAction('/host', { action: 'end' }); }).then(function (res) {
      if (!res) return;
      S.conn = 'ended';
      teardownMedia();
      paintRoom();
    });
  }

  function focusHostPanel() {
    var hp = region('hostpanel');
    if (hp && !hp.hidden) {
      var first = hp.querySelector('button, select');
      if (first) first.focus();
    }
  }

  function focusConfirm() {
    var el = root() && root().querySelector('.rm-confirm button, .rm-confirm select');
    if (el) el.focus();
  }

  function setField(f, key, el) {
    var v = el.type === 'checkbox' ? el.checked : el.value;
    var parts = key.split('.');
    if (parts[0] === 'access') {
      f.access[parts[1]] = parts[1] === 'minLevel' ? Number(v) : v;
      return parts[1] !== 'inviteText';
    }
    if (parts[0] === 'agenda') {
      var i = Number(el.getAttribute('data-index'));
      if (f.agenda[i]) f.agenda[i][parts[1]] = parts[1] === 'minutes' ? (Number(v) || 0) : v;
      return false;
    }
    f[key] = key === 'duration' || key === 'repeatCount' ? Number(v) : v;
    return key === 'kind' || key === 'repeat' || key === 'repeatCount' || key === 'selfUnmute' || key === 'duration';
  }

  function onInput(e) {
    var el = e.target;
    if (!el || !el.getAttribute || !root() || !root().contains(el)) return;
    var key = el.getAttribute('data-room-field');
    if (!key) return;
    if (key === 'chat') { S.chatDraft = el.value; return; }
    if (key === 'reason') { if (S.confirm) S.confirm.reason = el.value; return; }
    if (key === 'follow') {
      S.follow = el.checked;
      var vm = current();
      if (S.board && S.board.follow && vm) {
        try { S.board.follow(S.follow ? vm.host.id : null); } catch (err) { /* 忽略 */ }
      }
      return;
    }
    if (key === 'share-audio') { S.shareAudio = el.checked; return; }
    var f = S.create;
    if (!f) return;
    var structural = setField(f, key, el);
    if (f.errors[key]) delete f.errors[key];
    if (e.type === 'change' && structural) {
      if (key === 'kind') {
        var cap = capNow();
        if (Number(f.duration) > cap) f.duration = DURATIONS.filter(function (m) { return m <= cap; }).pop() || 15;
      }
      paintDialog();
      var again = root().querySelector('[data-room-field="' + key + '"]' + (key === 'kind' ? '[value="' + f.kind + '"]' : ''));
      if (again) again.focus();
    }
    if (key.indexOf('access.') === 0) estimate();
    if (key.indexOf('agenda.') === 0 && e.type === 'input') {
      var sumEl = root().querySelector('.rm-agenda-foot small');
      var sum = f.agenda.reduce(function (s, a) { return s + (Number(a.minutes) || 0); }, 0);
      if (sumEl) {
        sumEl.textContent = '合计 ' + sum + ' / ' + f.duration + ' 分钟';
        sumEl.className = sum > Number(f.duration) ? 'field-error' : '';
      }
    }
  }

  function onSubmit(e) {
    var form = e.target;
    if (!form || !root() || !root().contains(form)) return;
    if (form.hasAttribute('data-rm-form')) {
      e.preventDefault();
      submitCreate();
    } else if (form.hasAttribute('data-rm-chat')) {
      e.preventDefault();
      if (isLive()) { sendChat(); return; }
      var text = S.chatDraft.trim();
      var r = demoRoom(S.roomId);
      if (!text || !r) return;
      r.chat.push({ id: S.me.id, text: text, at: new Date().toISOString() });
      S.chatDraft = '';
      paintRoom();
      var input = root().querySelector('[data-room-field="chat"]');
      if (input) input.focus();
    }
  }

  function onKey(e) {
    if (!root()) return;
    if (e.key === 'Tab' && S.hostOpen && S.view === 'room') {
      var hp = region('hostpanel');
      var focusable = hp ? hp.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') : [];
      if (focusable.length) {
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      return;
    }
    if (e.key !== 'Escape') return;
    if (S.confirm) { S.confirm = null; paintRoom(); return; }
    if (S.hostOpen && S.view === 'room') {
      e.preventDefault();
      S.hostOpen = false;
      paintRoom({ act: 'host-toggle' });
    }
  }

  function onDialogClose(e) {
    if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-rm-dialog')) S.create = null;
  }

  function onVisibility() {
    if (document.visibilityState === 'visible') ensureRaf();
    else stopRaf();
  }

  function bind() {
    if (S.bound) return;
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onInput);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('keydown', onKey);
    document.addEventListener('close', onDialogClose, true);
    document.addEventListener('visibilitychange', onVisibility);
    S.bound = true;
  }

  function unbind() {
    if (!S.bound) return;
    document.removeEventListener('click', onClick);
    document.removeEventListener('input', onInput);
    document.removeEventListener('change', onInput);
    document.removeEventListener('submit', onSubmit);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('close', onDialogClose, true);
    document.removeEventListener('visibilitychange', onVisibility);
    S.bound = false;
  }

  /* ------------------------------------------------------------ 页面 */

  function listPage() {
    S.view = 'list';
    return listShell();
  }

  function roomPage() {
    var id = hashId();
    if (id !== S.roomId) {
      stopLocalCapture();
      S.roomId = id;
      S.conn = 'idle';
      S.hostOpen = false;
      S.boardOpen = false;
      S.confirm = null;
      S.micOn = false;
      S.sharing = false;
      S.screenFit = 'fit';
      S.follow = false;
      S.live.detail = null;
      S.live.join = null;
      S.live.error = null;
      S.hostOpen = false;
    }
    S.view = 'room';
    return roomShell();
  }

  function mount() {
    var el = root();
    if (!el) return;
    bind();
    if (el.getAttribute('data-rm-view') === 'list') {
      S.view = 'list';
      if (isLive()) loadList(); else paintList();
      return;
    }
    S.view = 'room';
    if (!el.querySelector('[data-rm-region="sim"]') && !isLive()) {
      el.insertAdjacentHTML('beforeend', '<div class="rm-simwrap" data-rm-region="sim"></div>');
    }
    if (isLive()) {
      paintRoom();
      loadRoom(true);
      startPoll();
      return;
    }
    demo();
    var r = demoRoom(S.roomId);
    if (r && r.state === 'live' && (S.conn === 'idle' || S.conn === 'connecting')) {
      S.conn = 'connecting';
      later(function () { if (S.conn === 'connecting') { S.conn = 'connected'; paintRoom(); } }, 700);
    }
    paintRoom();
  }

  function destroy() {
    S.timers.forEach(function (t) { window.clearTimeout(t); });
    S.timers = [];
    if (S.estimateTimer) window.clearTimeout(S.estimateTimer);
    S.estimateTimer = 0;
    stopRaf();
    stopPoll();
    stopLocalCapture();
    unmountBoard();
    var dlg = document.querySelector('[data-rm-dialog]');
    if (dlg && dlg.open) dlg.close();
    S.create = null;
    syncHostModal(false);
    if (S.view === 'room' && hashId() !== S.roomId) {
      if (isLive() && S.live.join) api().post('/rooms/' + encodeURIComponent(S.roomId) + '/leave', {}).catch(function () { return null; });
      S.live.join = null;
      teardownMedia();
    }
    S.view = '';
    unbind();
  }

  window.CommonsRooms = {
    routes: { rooms: listPage, room: roomPage },
    hub: ['rooms'],
    nav: [['rooms', '房间', 'rooms', 'projects']],
    icons: { rooms: 'M4 20V10l8-6 8 6v10M9.5 20v-5h5v5M2 20h20M12 4v3' },
    mount: mount,
    destroy: destroy
  };
  if (window.CommonsLinks && typeof window.CommonsLinks.provide === 'function') {
    window.CommonsLinks.provide('room', function (handle) {
      var rows = !isLive() && demo().rooms ? demo().rooms.filter(function (room) { return person(room.hostId).handle === handle; }) : [];
      return rows.length ? { label: '主持的房间', href: '#/rooms?host=' + encodeURIComponent(handle), count: rows.length, icon: 'room' } : null;
    });
  }
  (window.CommonsPages = window.CommonsPages || []).push(window.CommonsRooms);
})();

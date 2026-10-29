/* 媒体件。全站播放器 CommonsMedia.player，演示页 #/media-lab。
   window 的 load 之前不插入脚本、样式和媒体元素，否则 readyState 会停在 interactive。 */
(function () {
  function isDemo() {
    if (window.COMMONS_BUILD_LIVE === true || (window.CommonsAPI && window.CommonsAPI.mode === 'live')) return false;
    if (window.COMMONS_BUILD && window.COMMONS_BUILD.mode) return window.COMMONS_BUILD.mode === 'demo';
    return !!((window.CommonsAPI && window.CommonsAPI.mode === 'demo') || window.location.protocol === 'file:');
  }
  var demoModule = null;
  function demo() {
    if (!isDemo()) return null;
    var source = window.COMMONS_MEDIA_SAMPLE;
    if (!source) return null;
    if (!demoModule) demoModule = source.create({ LOAD_FAIL: LOAD_FAIL, alertBox: alertBox, alive: alive, barHTML: barHTML, begin: begin, bindTransport: bindTransport, destroy: destroy, esc: esc, fail: fail, fmt: fmt, hexOf: hexOf, hideAlert: hideAlert, liveHTML: liveHTML, m3u8Problem: m3u8Problem, makeBag: makeBag, need: need, on: on, palette: palette, player: player, silenceExcept: silenceExcept, speedHTML: speedHTML, start: start, tokenRaw: tokenRaw, waveHeight: waveHeight, get gen() { return gen; }, set gen(value) { gen = value; }, get silencers() { return silencers; }, set silencers(value) { silencers = value; } });
    return demoModule;
  }
  function page() { var d = demo(); return d ? d.page() : '<section class="med-page"><p role="status">暂无媒体。</p></section>'; }

  var RATES = [0.75, 1, 1.25, 1.5, 2];
  var VENDORS = {
    hls: { global: 'Hls', src: 'vendor/hls.min.js' },
    wavesurfer: { global: 'WaveSurfer', src: 'vendor/wavesurfer.min.js' },
    rrweb: { global: 'rrwebPlayer', src: 'vendor/rrweb-player.min.js', css: 'vendor/rrweb-player.css' },
    asciinema: { global: 'AsciinemaPlayer', src: 'vendor/asciinema-player.min.js', css: 'vendor/asciinema-player.css' }
  };
  var ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l11-6.5z"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
  var ICON_REPLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 6a6 6 0 1 1-5.2 3H9V7H4v5h2.2A8 8 0 1 0 12 4v2z"/></svg>';
  var ICON_PIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 5h18v14H3V5zm2 2v10h14V7H5zm7 3h6v4h-6v-4z"/></svg>';
  var LOAD_FAIL = '组件没加载上。页面其他部分还能用。';
  var RESUME_INDEX = 'media.resume.index';
  var RESUME_MAX = 50;
  var gen = 0;
  var pendingLoad = null;
  var viewObs = null;
  var scriptCache = {};
  var colorCache = {};
  var registry = [];
  var silencers = [];

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var whole = Math.floor(sec + 0.001);
    var m = Math.floor(whole / 60);
    var s = whole % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function pad(n, w) {
    var t = String(n);
    while (t.length < w) t = '0' + t;
    return t;
  }

  function vttStamp(sec) {
    var ms = Math.max(0, Math.round((isFinite(sec) ? sec : 0) * 1000));
    var h = Math.floor(ms / 3600000);
    ms -= h * 3600000;
    var m = Math.floor(ms / 60000);
    ms -= m * 60000;
    var s = Math.floor(ms / 1000);
    var f = ms - s * 1000;
    return pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2) + '.' + pad(f, 3);
  }

  function hash32(text) {
    var h = 2166136261;
    var s = String(text);
    var i;
    for (i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function narrow() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 480px)').matches);
  }

  function halt(card) {
    if (card && typeof card._medStop === 'function') {
      var fn = card._medStop;
      card._medStop = null;
      try { fn(); } catch (err) {}
    }
  }

  function begin(card) {
    halt(card);
    var n = (Number(card.getAttribute('data-boot')) || 0) + 1;
    card.setAttribute('data-boot', String(n));
    return n;
  }

  function makeBag(card) {
    var fns = [];
    var bag = {
      add: function (fn) { fns.push(fn); },
      stop: function () {
        fns.splice(0).forEach(function (fn) {
          try { fn(); } catch (err) {}
        });
      }
    };
    card._medStop = bag.stop;
    return bag;
  }

  function on(el, ev, fn, bag) {
    if (!el || !el.addEventListener) return;
    el.addEventListener(ev, fn);
    if (bag) bag.add(function () { el.removeEventListener(ev, fn); });
  }

  function alive(card, n, g) {
    return g === gen && !!card && card.isConnected && card.getAttribute('data-boot') === String(n);
  }

  function fail(card, message, retry) {
    halt(card);
    var stage = card.querySelector('[data-slot]');
    card.setAttribute('data-state', 'error');
    if (!stage) return;
    stage.innerHTML = '<div class="med-error"><p>' + esc(message) + '</p><button type="button" class="button" data-retry>重试</button></div>';
    var btn = stage.querySelector('[data-retry]');
    if (btn) btn.addEventListener('click', retry);
  }

  function alertBox(card, bag, text, retry) {
    var stage = card.querySelector('[data-slot]');
    if (!stage) return;
    var box = card.querySelector('[data-alert]');
    if (!box) {
      box = document.createElement('div');
      box.className = 'med-error';
      box.setAttribute('data-alert', '');
      stage.appendChild(box);
    }
    box.hidden = false;
    box.textContent = '';
    var p = document.createElement('p');
    p.textContent = text;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button';
    btn.textContent = '重试';
    box.appendChild(p);
    box.appendChild(btn);
    on(btn, 'click', function () {
      box.hidden = true;
      retry();
    }, bag);
  }

  function hideAlert(card) {
    var box = card.querySelector('[data-alert]');
    if (box) box.hidden = true;
  }

  function need(name) {
    var spec = VENDORS[name];
    if (!spec) return Promise.reject(new Error('unknown'));
    if (window[spec.global]) return Promise.resolve(window[spec.global]);
    if (scriptCache[name]) return scriptCache[name];
    var pending = new Promise(function (resolve, reject) {
      if (spec.css && !document.querySelector('link[data-med-css="' + name + '"]')) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = spec.css;
        link.setAttribute('data-med-css', name);
        document.head.appendChild(link);
      }
      var script = document.createElement('script');
      script.src = spec.src;
      script.async = true;
      script.onload = function () {
        if (window[spec.global]) resolve(window[spec.global]);
        else {
          delete scriptCache[name];
          reject(new Error('missing'));
        }
      };
      script.onerror = function () {
        delete scriptCache[name];
        reject(new Error('load'));
      };
      document.head.appendChild(script);
    });
    scriptCache[name] = pending;
    return pending;
  }

  function tokenRaw(name) {
    if (colorCache[name]) return colorCache[name];
    var el = document.createElement('span');
    el.style.color = 'var(' + name + ')';
    document.body.appendChild(el);
    var value = getComputedStyle(el).color || '';
    el.remove();
    if (value) colorCache[name] = value;
    return value;
  }

  function hexOf(name) {
    var raw = tokenRaw(name);
    var nums = String(raw).match(/\d+(?:\.\d+)?/g);
    if (!nums || nums.length < 3) return '';
    function byte(part) {
      var n = Math.max(0, Math.min(255, Math.round(Number(part))));
      var s = n.toString(16);
      return s.length < 2 ? '0' + s : s;
    }
    return '#' + byte(nums[0]) + byte(nums[1]) + byte(nums[2]);
  }

  function fontOf() {
    var el = document.createElement('span');
    el.style.fontFamily = 'var(--mono)';
    el.style.fontSize = 'var(--text-ui)';
    document.body.appendChild(el);
    var css = getComputedStyle(el);
    var fam = css.fontFamily || '';
    var size = css.fontSize || '';
    el.remove();
    return { family: fam, size: size };
  }

  function waveHeight() {
    var el = document.createElement('span');
    el.style.width = 'var(--space-16)';
    document.body.appendChild(el);
    var px = parseFloat(getComputedStyle(el).width);
    el.remove();
    return px ? Math.round(px * 4) : 64;
  }

  function measure(el) {
    var w = el.clientWidth || (el.parentElement && el.parentElement.clientWidth) || 360;
    return Math.max(280, Math.min(640, Math.round(w)));
  }

  function m3u8Problem(value) {
    var text = String(value || '').trim();
    if (!text) return 'empty';
    if (text.indexOf('://') < 0 || text.indexOf('.m3u8') < 0) return 'format';
    return '';
  }

  function typingTarget(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toLowerCase();
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag !== 'input') return false;
    return (el.getAttribute('type') || 'text').toLowerCase() !== 'range';
  }

  function palette(names) {
    var out = [];
    var i;
    for (i = 0; i < names.length; i++) {
      var color = tokenRaw(names[i]);
      if (!color) return null;
      out.push(color);
    }
    return out;
  }

  function resumeRead(id) {
    if (!id || !window.Commons || !Commons.read) return 0;
    var value = Commons.read('media.resume.' + hash32(id).toString(16), null);
    return (typeof value === 'number' && isFinite(value) && value > 0) ? value : 0;
  }

  function resumeWrite(id, t) {
    if (!id || !window.Commons || !Commons.read || !Commons.write) return;
    var key = hash32(id).toString(16);
    var full = 'media.resume.' + key;
    var index = Commons.read(RESUME_INDEX, []);
    if (!Array.isArray(index)) index = [];
    index = index.filter(function (item) { return item !== key; });
    if (t == null || !(typeof t === 'number' && isFinite(t) && t > 0)) {
      Commons.write(full, null);
      Commons.write(RESUME_INDEX, index);
      return;
    }
    index.push(key);
    while (index.length > RESUME_MAX) {
      var old = index.shift();
      Commons.write('media.resume.' + old, null);
    }
    Commons.write(RESUME_INDEX, index);
    Commons.write(full, t);
  }

  function silenceExcept(self) {
    registry.slice().forEach(function (item) {
      if (item.api !== self) item.yieldTo();
    });
    silencers.slice().forEach(function (entry) {
      if (entry.owner !== self) {
        try { entry.fn(); } catch (err) {}
      }
    });
  }

  function barHTML() {
    return '<div class="med-bar">' +
      '<button type="button" class="button icon-only" data-play aria-label="播放">' + ICON_PLAY + '</button>' +
      '<span class="med-time" data-now>0:00</span>' +
      '<div class="med-scrub">' +
        '<div class="med-scrub__track" aria-hidden="true"><div class="med-scrub__fill" data-fill></div></div>' +
        '<input class="med-scrub__range" data-range type="range" min="0" max="1000" value="0" step="1" aria-label="进度">' +
        '<div class="med-tip" data-tip hidden>0:00</div>' +
      '</div>' +
      '<span class="med-time" data-dur>0:00</span>' +
    '</div>';
  }

  function speedHTML() {
    var bits = RATES.map(function (rate) {
      var on = rate === 1;
      return '<button type="button" data-rate="' + rate + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + rate + '</button>';
    }).join('');
    return '<div class="segmented small med-speed" role="group" aria-label="倍速">' + bits + '</div>';
  }

  function chaptersHTML(list) {
    if (!list || !list.length) return '';
    return '<div class="med-chapters" role="group" aria-label="章节">' + list.map(function (ch) {
      return '<button type="button" class="med-ch" data-t="' + Number(ch.t) + '">' + esc(ch.label) + '</button>';
    }).join('') + '</div>';
  }

  function liveHTML() {
    return '<div class="med-captions"><span class="med-live"></span></div>';
  }

  function cuesHTML(list) {
    if (!list || !list.length) return liveHTML();
    return '<div class="med-captions"><div class="med-cues">' + list.map(function (cue) {
      return '<button type="button" class="med-cue" data-t="' + Number(cue.t) + '" data-end="' + Number(cue.end) + '">' + esc(cue.text) + '</button>';
    }).join('') + '</div><span class="med-live"></span></div>';
  }

  function bindTransport(card, api, bag) {
    var playBtn = card.querySelector('[data-play]');
    var range = card.querySelector('[data-range]');
    var fill = card.querySelector('[data-fill]');
    var nowEl = card.querySelector('[data-now]');
    var durEl = card.querySelector('[data-dur]');
    var tip = card.querySelector('[data-tip]');
    var scrub = card.querySelector('.med-scrub');
    var speed = card.querySelector('.med-speed');
    var captions = card.querySelector('.med-captions');
    var live = card.querySelector('.med-live');
    var miniEl = card.querySelector('[data-mini]');
    var chapters = [].slice.call(card.querySelectorAll('.med-ch'));
    var cues = [].slice.call(card.querySelectorAll('.med-cue'));
    var dragging = false;
    var ended = false;
    var lastChapter = -1;
    var lastCue = -1;
    var liveArmed = false;
    var timer = 0;

    function isLive() {
      return !!(api.live && api.live());
    }
    function duration() {
      var d = 0;
      try { d = api.getDuration(); } catch (err) { d = 0; }
      return (typeof d === 'number' && isFinite(d) && d > 0) ? d : 0;
    }
    function current() {
      var t = 0;
      try { t = api.getTime(); } catch (err) { t = 0; }
      return (typeof t === 'number' && isFinite(t)) ? Math.max(0, t) : 0;
    }
    function label(mode) {
      if (!playBtn) return;
      playBtn.setAttribute('aria-label', mode === 'pause' ? '暂停' : mode === 'replay' ? '重播' : '播放');
      playBtn.innerHTML = mode === 'pause' ? ICON_PAUSE : mode === 'replay' ? ICON_REPLAY : ICON_PLAY;
    }
    function chapterIndex(t) {
      var i;
      var idx = -1;
      for (i = 0; i < chapters.length; i++) {
        if (Number(chapters[i].getAttribute('data-t')) <= t + 0.001) idx = i;
      }
      return idx;
    }
    function cueIndex(t) {
      var i;
      var idx = -1;
      for (i = 0; i < cues.length; i++) {
        var start = Number(cues[i].getAttribute('data-t'));
        var end = Number(cues[i].getAttribute('data-end'));
        if (t >= start && t < end) idx = i;
      }
      return idx;
    }
    function paintMarks(t) {
      var ci = chapterIndex(t);
      var qi = cueIndex(t);
      chapters.forEach(function (btn, i) {
        if (i === ci) btn.setAttribute('aria-current', 'true');
        else btn.removeAttribute('aria-current');
      });
      cues.forEach(function (btn, i) {
        if (i === qi) btn.setAttribute('aria-current', 'true');
        else btn.removeAttribute('aria-current');
      });
      if (qi !== lastCue && qi >= 0 && cues[qi] && cues[qi].scrollIntoView) {
        try {
          cues[qi].scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
        } catch (err) {
          try { cues[qi].scrollIntoView(); } catch (ignore) {}
        }
      }
      lastCue = qi;
      if (ci !== lastChapter && ci >= 0 && live && liveArmed) {
        live.textContent = '当前章节：' + (chapters[ci].textContent || '');
      }
      lastChapter = ci;
    }
    function paintTime(t, force) {
      if (dragging && !force) return;
      var d = duration();
      var liveMode = isLive();
      if (nowEl) nowEl.textContent = liveMode ? '直播' : fmt(t);
      if (durEl) durEl.textContent = liveMode ? '直播' : fmt(d);
      if (range) {
        var blocked = liveMode || !(d > 0);
        range.disabled = blocked;
        range.setAttribute('aria-disabled', blocked ? 'true' : 'false');
        if (!blocked && !dragging) range.value = String(Math.round((t / d) * 1000));
      }
      if (fill) {
        var p = (!liveMode && d > 0) ? Math.max(0, Math.min(1, t / d)) : 0;
        fill.style.transform = 'scaleX(' + p + ')';
      }
      paintMarks(t);
    }
    function placeTip(ratio, d, text) {
      if (!tip) return;
      var shown = Math.max(0.08, Math.min(0.92, ratio));
      tip.hidden = false;
      tip.textContent = text || fmt(ratio * d);
      tip.style.left = (shown * 100) + '%';
    }
    function notePlay() {
      ended = false;
      var already = card.getAttribute('data-state') === 'playing';
      card.setAttribute('data-state', 'playing');
      label('pause');
      if (!already && api.hook) api.hook('play');
    }
    function notePause() {
      if (ended || card.getAttribute('data-state') === 'ended') return;
      card.setAttribute('data-state', 'paused');
      label('play');
      if (api.hook) api.hook('pause');
    }
    function noteEnded() {
      if (card.getAttribute('data-state') === 'ended') return;
      ended = true;
      card.setAttribute('data-state', 'ended');
      label('replay');
      paintTime(duration() || current(), true);
      if (api.hook) api.hook('ended');
    }
    function toggle() {
      if (ended || card.getAttribute('data-state') === 'ended') {
        ended = false;
        try { api.seek(0); } catch (err) {}
        try { api.play(); } catch (err) {}
        return;
      }
      if (card.getAttribute('data-state') === 'playing') {
        try { api.pause(); } catch (err) {}
      } else {
        try { api.play(); } catch (err) {}
      }
    }
    function seekTo(t) {
      var d = duration();
      if (!(d > 0) || isLive()) return;
      var next = Math.max(0, Math.min(d, t));
      ended = false;
      if (card.getAttribute('data-state') === 'ended') {
        card.setAttribute('data-state', 'paused');
        label('play');
      }
      try { api.seek(next); } catch (err) {}
      paintTime(next, true);
    }
    function inside(target) {
      if (!target) return false;
      if (card.contains && card.contains(target)) return true;
      return !!(miniEl && miniEl.contains && miniEl.contains(target));
    }
    function onKey(ev) {
      if (ev.altKey || ev.metaKey || ev.ctrlKey) return;
      var target = ev.target;
      if (!inside(target)) return;
      var inSpeed = target.closest && target.closest('.med-speed');
      if (typingTarget(target)) return;
      var key = ev.key;
      if (key === 'f' || key === 'F') {
        if (api.fullscreen) { ev.preventDefault(); api.fullscreen(); }
        return;
      }
      if (key === 'm' || key === 'M') {
        if (api.mute) { ev.preventDefault(); api.mute(); }
        return;
      }
      if (key === 'c' || key === 'C') {
        if (api.captions) { ev.preventDefault(); api.captions(); }
        return;
      }
      if (inSpeed && (key === ' ' || key === 'Spacebar' || key === 'ArrowLeft' || key === 'ArrowRight')) return;
      var tag = (target.tagName || '').toLowerCase();
      if (key === ' ' || key === 'Spacebar') {
        if (tag === 'button') return;
        ev.preventDefault();
        toggle();
        return;
      }
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        if (isLive()) return;
        ev.preventDefault();
        seekTo(current() + (key === 'ArrowLeft' ? -5 : 5));
        return;
      }
      if ((key === '[' || key === ']') && chapters.length) {
        ev.preventDefault();
        var ci = chapterIndex(current());
        var ni = key === '[' ? Math.max(0, ci < 0 ? 0 : ci - 1) : Math.min(chapters.length - 1, ci + 1);
        seekTo(Number(chapters[ni].getAttribute('data-t')) || 0);
      }
    }

    if (captions) {
      var arm = requestAnimationFrame(function () {
        if (!captions.isConnected) return;
        captions.setAttribute('aria-live', 'polite');
        liveArmed = true;
      });
      bag.add(function () { cancelAnimationFrame(arm); });
    }
    if (playBtn) on(playBtn, 'click', toggle, bag);
    if (range) {
      on(range, 'pointerdown', function () { dragging = true; }, bag);
      on(range, 'input', function () {
        dragging = true;
        var d = duration();
        var ratio = Number(range.value) / 1000;
        if (fill) fill.style.transform = 'scaleX(' + ratio + ')';
        if (d > 0) {
          placeTip(ratio, d);
          if (nowEl && !isLive()) nowEl.textContent = fmt(ratio * d);
        }
      }, bag);
      on(range, 'change', function () {
        seekTo((Number(range.value) / 1000) * duration());
        dragging = false;
      }, bag);
    }
    function releaseDrag() {
      if (!dragging) return;
      seekTo((Number(range && range.value) / 1000) * duration());
      dragging = false;
    }
    on(window, 'pointerup', releaseDrag, bag);
    if (scrub) {
      on(scrub, 'pointermove', function (ev) {
        var d = duration();
        if (!(d > 0) || isLive()) return;
        var rect = scrub.getBoundingClientRect();
        var ratio = rect.width ? (ev.clientX - rect.left) / rect.width : 0;
        ratio = Math.max(0, Math.min(1, ratio));
        var name = '';
        var i;
        for (i = 0; i < chapters.length; i++) {
          var ct = Number(chapters[i].getAttribute('data-t'));
          if (d > 0 && Math.abs(ct / d - ratio) < 0.03) name = chapters[i].textContent || '';
        }
        placeTip(ratio, d, name ? name + ' ' + fmt(ratio * d) : '');
      }, bag);
      on(scrub, 'pointerleave', function () { if (tip) tip.hidden = true; }, bag);
    }
    if (speed) {
      on(speed, 'click', function (ev) {
        var btn = ev.target.closest ? ev.target.closest('button') : null;
        if (!btn || !speed.contains(btn)) return;
        var rate = Number(btn.getAttribute('data-rate'));
        if (!isFinite(rate) || !rate) return;
        speed.querySelectorAll('button').forEach(function (item) {
          item.setAttribute('aria-pressed', item === btn ? 'true' : 'false');
        });
        try { api.setRate(rate); } catch (err) {}
      }, bag);
    }
    on(card, 'click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('.med-ch, .med-cue, .med-tick') : null;
      if (!btn || !card.contains(btn)) return;
      var t = Number(btn.getAttribute('data-t'));
      if (!isFinite(t)) return;
      seekTo(t);
    }, bag);
    on(card, 'keydown', onKey, bag);
    if (miniEl) on(miniEl, 'keydown', onKey, bag);
    timer = window.setInterval(function () {
      var t = current();
      var d = duration();
      paintTime(t, false);
      if (api.hook) api.hook('time', t);
      if (api.watchEnd && !isLive() && d > 0 && t >= d - 0.08 && card.getAttribute('data-state') === 'playing') {
        noteEnded();
        try { api.pause(); } catch (err) {}
      }
    }, 200);
    bag.add(function () { window.clearInterval(timer); });
    paintTime(current(), true);
    return { notePlay: notePlay, notePause: notePause, noteEnded: noteEnded, paint: function () { paintTime(current(), true); }, seekTo: seekTo, toggle: toggle };
  }

  function vttBlob(cues) {
    var lines = ['WEBVTT', ''];
    cues.forEach(function (cue) {
      lines.push(vttStamp(cue.t) + ' --> ' + vttStamp(cue.end));
      lines.push(String(cue.text || ''));
      lines.push('');
    });
    return new Blob([lines.join('\n')], { type: 'text/vtt' });
  }

  function observer() {
    if (viewObs) return viewObs;
    if (!window.IntersectionObserver) return null;
    viewObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var inst = entry.target._medInst;
        if (!inst) return;
        if (entry.isIntersecting) inst.enter();
        else inst.leave();
      });
    });
    return viewObs;
  }

  function inert() {
    function noop() {}
    return { play: noop, pause: noop, seek: noop, setRate: noop, destroy: noop, on: noop };
  }

  function player(container, source, options) {
    if (!container) return inert();
    source = source || {};
    options = options || {};
    var kind = source.kind || 'video';
    var born = gen;
    var title = source.title || '';
    var cat = Number(options.cat);
    if (!(cat >= 1 && cat <= 10)) cat = (hash32(String(title || kind)) % 10) + 1;
    var root = document.createElement('div');
    root.className = 'med-player';
    root.setAttribute('data-kind', kind);
    root.setAttribute('data-state', 'poster');
    root.setAttribute('data-cc', 'on');
    var posterBits = source.poster ? '<img alt="" src="' + window.Commons.safeUrl(source.poster) + '">' : '';
    posterBits += '<span class="med-poster__title">' + esc(title || (isDemo() ? '示例' : '媒体')) + '</span>';
    var frameClass = kind === 'audio' ? 'med-frame med-frame--audio' : 'med-frame med-frame--video';
    root.innerHTML =
      '<div class="' + frameClass + '" data-frame>' +
        '<div class="med-poster" data-cat="' + cat + '" data-poster>' + posterBits +
          '<button type="button" class="button icon-only med-play-big" data-big aria-label="播放">' + ICON_PLAY + '</button>' +
        '</div>' +
        '<p class="med-float-note" data-float-note hidden>正在小窗里播放。</p>' +
        '<div class="med-blocked" data-blocked hidden>' +
          '<button type="button" class="button primary large med-blocked-play" data-blocked-play>点一下播放</button>' +
          '<p class="med-blocked-why" data-blocked-why>浏览器拦住了自动播放。</p>' +
        '</div>' +
        '<div class="med-screen" data-screen hidden></div>' +
      '</div>' +
      '<div class="med-resume" data-resume-row hidden>' +
        '<button type="button" class="button small" data-resume>继续</button>' +
        '<button type="button" class="button ghost small" data-dismiss>关闭</button>' +
      '</div>' +
      '<div class="med-transport">' + barHTML() + speedHTML() +
        '<button type="button" class="button icon-only med-tool" data-pip hidden aria-label="画中画">' + ICON_PIP + '</button>' +
        '<button type="button" class="button ghost small med-tool" data-cc hidden aria-pressed="true">字幕</button>' +
      '</div>' +
      chaptersHTML(source.chapters) +
      cuesHTML(source.captions) +
      '<div class="med-mini" data-mini data-kind="' + esc(kind) + '" hidden>' +
        '<div class="med-mini__stage" data-mini-stage></div>' +
        '<div class="med-mini__bar">' +
          '<button type="button" class="button icon-only" data-mini-play aria-label="暂停">' + ICON_PAUSE + '</button>' +
          '<span class="med-mini__title">' + esc(title || '正在播放') + '</span>' +
          '<button type="button" class="button ghost small" data-mini-back>回到原位</button>' +
          '<button type="button" class="button ghost small" data-mini-close>关闭</button>' +
        '</div>' +
      '</div>';
    container.textContent = '';
    container.appendChild(root);

    var frame = root.querySelector('[data-frame]');
    var screen = root.querySelector('[data-screen]');
    var mini = root.querySelector('[data-mini]');
    var pipBtn = root.querySelector('[data-pip]');
    var ccBtn = root.querySelector('[data-cc]');
    var big = root.querySelector('[data-big]');
    var listeners = {};
    var bag = makeBag(root);
    var dead = false;
    var booted = false;
    var wantPlay = false;
    var floating = false;
    var assigned = false;
    var readySent = false;
    var savedAt = 0;
    var rate = 1;
    var media = null;
    var hls = null;
    var rrPlayer = null;
    var castPlayer = null;
    var objUrl = '';
    var trackUrl = '';
    var knownDur = source.duration || 0;
    var castText = '';
    var ui = null;
    var entry = null;

    function emit(name, payload) {
      var list = listeners[name];
      if (!list) return;
      list.slice().forEach(function (fn) {
        try { fn(payload); } catch (err) {}
      });
    }
    function subscribe(name, fn) {
      if (dead || typeof fn !== 'function') return;
      if (!listeners[name]) listeners[name] = [];
      listeners[name].push(fn);
    }
    function resumeId() {
      if (typeof source.src === 'string' && source.src) return source.src;
      if (title) return kind + ':' + title;
      return '';
    }
    function readTime() {
      if (media) return media.currentTime || 0;
      if (kind === 'rrweb' && rrPlayer) {
        try {
          var replayer = rrPlayer.getReplayer();
          var ms = replayer && replayer.getCurrentTime ? replayer.getCurrentTime() : 0;
          return (ms || 0) / 1000;
        } catch (err) { return 0; }
      }
      if (kind === 'cast' && castPlayer && castPlayer.getCurrentTime) {
        try { return castPlayer.getCurrentTime() || 0; }
        catch (err) { return 0; }
      }
      return 0;
    }
    function readDur() {
      if (media) {
        var d = media.duration;
        if (d === Infinity) return 0;
        if (typeof d === 'number' && isFinite(d) && d > 0) return d;
      }
      if (kind === 'rrweb' && rrPlayer) {
        try {
          var meta = rrPlayer.getMetaData();
          if (meta && typeof meta.totalTime === 'number' && meta.totalTime > 0) return meta.totalTime / 1000;
        } catch (err) {}
      }
      if (kind === 'cast' && castPlayer && castPlayer.getDuration) {
        try {
          var cd = castPlayer.getDuration();
          if (typeof cd === 'number' && isFinite(cd) && cd > 0) return cd;
        } catch (err) {}
      }
      return knownDur || 0;
    }
    function remember(force) {
      var id = resumeId();
      if (!id || dead) return;
      if (media && media.duration === Infinity) return;
      if (root.getAttribute('data-state') === 'ended') {
        resumeWrite(id, null);
        return;
      }
      var t = readTime();
      var d = readDur();
      if (!(t > 1)) return;
      if (d > 0 && t > d - 0.4) {
        resumeWrite(id, null);
        return;
      }
      var now = Date.now();
      if (!force && now - savedAt < 2000) return;
      savedAt = now;
      resumeWrite(id, Math.round(t * 10) / 10);
    }
    function markReady() {
      if (readySent || dead) return;
      readySent = true;
      var state = root.getAttribute('data-state');
      if (!wantPlay && (state === 'poster' || state === 'loading')) root.setAttribute('data-state', 'ready');
      emit('ready');
    }
    function iconMode() {
      var state = root.getAttribute('data-state');
      return state === 'playing' ? 'pause' : state === 'ended' ? 'replay' : 'play';
    }
    function paintIcons() {
      var mode = iconMode();
      var html = mode === 'pause' ? ICON_PAUSE : mode === 'replay' ? ICON_REPLAY : ICON_PLAY;
      var label = mode === 'pause' ? '暂停' : mode === 'replay' ? '重播' : '播放';
      if (big && kind === 'audio') {
        big.innerHTML = html;
        big.setAttribute('aria-label', label);
      }
      var miniPlay = mini.querySelector('[data-mini-play]');
      if (miniPlay) {
        miniPlay.innerHTML = html;
        miniPlay.setAttribute('aria-label', label);
      }
    }
    function hook(name, payload) {
      if (name === 'time') {
        emit('time', payload);
        remember(false);
        return;
      }
      paintIcons();
      if (name === 'play') {
        hideBlocked();
        root.setAttribute('data-started', '1');
        emit('play');
      }
      else if (name === 'pause') {
        emit('pause');
        remember(true);
      } else if (name === 'ended') {
        emit('ended');
        var id = resumeId();
        if (id) resumeWrite(id, null);
        dock();
      }
    }
    function hideBlocked() {
      var overlay = root.querySelector('[data-blocked]');
      if (overlay) overlay.hidden = true;
    }
    function isAutoplayBlock(err) {
      var name = err && err.name;
      var msg = String((err && err.message) || '');
      return name === 'NotAllowedError' || /user didn't interact|autoplay|not allowed|gesture/i.test(msg);
    }
    function showBlocked() {
      if (dead) return;
      wantPlay = false;
      root.removeAttribute('data-started');
      root.setAttribute('data-state', 'blocked');
      var overlay = root.querySelector('[data-blocked]');
      if (overlay) {
        overlay.hidden = false;
        var why = overlay.querySelector('[data-blocked-why]');
        if (why) why.textContent = '浏览器拦住了自动播放。点一下再开始。';
      }
    }
    function catchPlay(pending) {
      if (!pending || !pending.then) return;
      pending.then(function () {
        if (dead) return;
        hideBlocked();
        root.setAttribute('data-started', '1');
      }).catch(function (err) {
        if (dead) return;
        if (isAutoplayBlock(err)) showBlocked();
      });
    }
    function showError(message) {
      if (dead) return;
      hideBlocked();
      root.setAttribute('data-state', 'error');
      emit('error', message);
      var box = root.querySelector('[data-error]');
      if (!box) {
        box = document.createElement('div');
        box.className = 'med-error';
        box.setAttribute('data-error', '');
        frame.appendChild(box);
      }
      box.hidden = false;
      box.textContent = '';
      var p = document.createElement('p');
      p.textContent = message;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'button';
      btn.textContent = '重试';
      box.appendChild(p);
      box.appendChild(btn);
      on(btn, 'click', function () {
        box.hidden = true;
        retry();
      }, bag);
    }
    function placeTicks(d) {
      if (!(d > 0)) return;
      root.querySelectorAll('.med-tick').forEach(function (tick) {
        var t = Number(tick.getAttribute('data-t'));
        tick.style.left = Math.max(0, Math.min(100, (t / d) * 100)) + '%';
      });
    }
    function buildTicks() {
      var scrub = root.querySelector('.med-scrub');
      var list = source.chapters || [];
      if (!scrub || list.length < 2) return;
      var host = document.createElement('div');
      host.className = 'med-ticks';
      list.forEach(function (ch) {
        if (!(Number(ch.t) > 0)) return;
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'med-tick';
        b.setAttribute('data-t', String(ch.t));
        b.setAttribute('aria-label', ch.label || '章节');
        var name = document.createElement('span');
        name.className = 'med-tick__name';
        name.textContent = ch.label || '';
        b.appendChild(name);
        host.appendChild(b);
      });
      scrub.appendChild(host);
      placeTicks(knownDur);
    }
    function attachTrack() {
      if (!media || !source.captions || !source.captions.length || trackUrl) return;
      var blob = vttBlob(source.captions);
      trackUrl = URL.createObjectURL(blob);
      var track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = '字幕';
      track.srclang = 'zh';
      track.src = trackUrl;
      track.default = true;
      media.appendChild(track);
    }
    function showTrack(on) {
      if (!media || !media.textTracks || !media.textTracks[0]) return;
      media.textTracks[0].mode = on ? 'showing' : 'hidden';
    }
    function playableUrl() {
      if (source.data instanceof Blob) {
        if (!objUrl) objUrl = URL.createObjectURL(source.data);
        return objUrl;
      }
      if (typeof source.src === 'string' && source.src.indexOf('sample:') !== 0 && source.src) return source.src;
      return '';
    }
    function wireMedia() {
      on(media, 'loadedmetadata', function () {
        if (dead) return;
        if (media.duration && isFinite(media.duration)) {
          knownDur = media.duration;
          placeTicks(knownDur);
        }
        showTrack(root.getAttribute('data-cc') !== 'off');
        markReady();
        if (ui) ui.paint();
      }, bag);
      on(media, 'play', function () { if (ui) ui.notePlay(); }, bag);
      on(media, 'pause', function () { if (ui) ui.notePause(); }, bag);
      on(media, 'ended', function () { if (ui) ui.noteEnded(); }, bag);
      on(media, 'error', function () {
        if (!assigned || dead) return;
        showError(kind === 'hls' ? '这段流没有播出来，页面里的其他东西没有改。确认地址还能打开，再按重试。' : '这段没有播出来。');
      }, bag);
      if ((kind === 'video' || kind === 'hls') && document.pictureInPictureEnabled && media.requestPictureInPicture) {
        pipBtn.hidden = false;
      }
    }
    function ensureMedia() {
      if (media) return;
      media = document.createElement(kind === 'audio' ? 'audio' : 'video');
      media.className = kind === 'audio' ? 'med-audio' : 'med-video';
      media.preload = 'none';
      media.controls = false;
      if (kind !== 'audio') {
        media.playsInline = true;
        media.setAttribute('playsinline', '');
        frame.appendChild(media);
      } else {
        root.appendChild(media);
      }
      attachTrack();
      wireMedia();
    }
    function nativeHls() {
      if (!media || !media.canPlayType) return false;
      var a = '';
      var b = '';
      try {
        a = media.canPlayType('application/vnd.apple.mpegurl') || '';
        b = media.canPlayType('application/x-mpegURL') || '';
      } catch (err) { return false; }
      return a === 'probably' || a === 'maybe' || b === 'probably' || b === 'maybe';
    }
    function openHls() {
      var url = typeof source.src === 'string' ? source.src : '';
      if (!url) { showError('没有可播的地址。'); return; }
      ensureMedia();
      if (nativeHls()) {
        assigned = true;
        media.src = url;
        var pendingPlay = media.play();
        catchPlay(pendingPlay);
        return;
      }
      need('hls').then(function (Hls) {
        if (dead || !wantPlay) return;
        if (!Hls.isSupported || !Hls.isSupported()) {
          showError('这个浏览器播不了这种流。换一个能播的浏览器，或换一条地址。');
          return;
        }
        if (hls) { try { hls.destroy(); } catch (err) {} }
        hls = new Hls();
        if (hls.on && Hls.Events && Hls.Events.ERROR) {
          hls.on(Hls.Events.ERROR, function (evt, data) {
            if (data && data.fatal) showError('这段流没有播出来，页面里的其他东西没有改。确认地址还能打开，再按重试。');
          });
        }
        if (hls.on && Hls.Events && Hls.Events.MANIFEST_PARSED) {
          hls.on(Hls.Events.MANIFEST_PARSED, function () {
            if (dead || !wantPlay) return;
            markReady();
            var pendingPlay = media.play();
            catchPlay(pendingPlay);
          });
        }
        assigned = true;
        hls.loadSource(url);
        hls.attachMedia(media);
      }).catch(function () {
        if (!dead) showError(LOAD_FAIL);
      });
    }
    function mountRrweb() {
      var events = source.data;
      if (!events || !events.length) { showError('没有可播的操作回放。'); return; }
      need('rrweb').then(function (Player) {
        if (dead) return;
        screen.hidden = false;
        screen.textContent = '';
        var width = measure(screen);
        try {
          rrPlayer = new Player({
            target: screen,
            props: {
              events: events,
              width: width,
              height: Math.round(width * 9 / 16),
              autoPlay: false,
              showController: false,
              skipInactive: false,
              speed: rate
            }
          });
        } catch (err) {
          booted = false;
          showError(LOAD_FAIL);
          return;
        }
        bag.add(function () {
          try { rrPlayer.pause(); } catch (err) {}
          try { if (rrPlayer.$destroy) rrPlayer.$destroy(); } catch (err) {}
          rrPlayer = null;
        });
        try {
          rrPlayer.addEventListener('ui-update-current-time', function () { if (ui) ui.paint(); });
        } catch (err) {}
        try {
          rrPlayer.addEventListener('ui-update-player-state', function (detail) {
            var payload = detail;
            if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'payload')) payload = detail.payload;
            var name = typeof payload === 'string' ? payload : (payload && payload.value) || '';
            if (name === 'playing' && ui) ui.notePlay();
            else if (name === 'paused' && ui) ui.notePause();
          });
        } catch (err) {}
        markReady();
        if (ui) ui.paint();
        if (wantPlay) {
          try { rrPlayer.play(); } catch (err) {}
        }
      }).catch(function () {
        booted = false;
        if (!dead) showError(LOAD_FAIL);
      });
    }
    function wireCast(inst) {
      if (!inst) return;
      if (inst.el) {
        inst.el.style.setProperty('--term-color-background', tokenRaw('--ink'));
        inst.el.style.setProperty('--term-color-foreground', tokenRaw('--teal-200'));
      }
      try { inst.addEventListener('playing', function () { if (ui) ui.notePlay(); }); } catch (err) {}
      try { inst.addEventListener('play', function () { if (ui) ui.notePlay(); }); } catch (err) {}
      try { inst.addEventListener('pause', function () { if (ui) ui.notePause(); }); } catch (err) {}
      try { inst.addEventListener('ended', function () { if (ui) ui.noteEnded(); }); } catch (err) {}
    }
    function mountCast() {
      if (typeof source.data === 'string') castText = source.data;
      else if (source.data && typeof source.data.cast === 'string') castText = source.data.cast;
      if (!castText) { showError('没有可播的终端回放。'); return; }
      need('asciinema').then(function (Api) {
        if (dead) return;
        var fonts = fontOf();
        var host = document.createElement('div');
        host.className = 'med-term';
        host.setAttribute('data-term', '');
        screen.hidden = false;
        screen.textContent = '';
        screen.appendChild(host);
        host.style.setProperty('--term-color-background', tokenRaw('--ink'));
        host.style.setProperty('--term-color-foreground', tokenRaw('--teal-200'));
        function spawn(shouldPlay, at) {
          if (castPlayer) {
            try { castPlayer.pause(); } catch (err) {}
            try { castPlayer.dispose(); } catch (err) {}
            castPlayer = null;
          }
          host.textContent = '';
          castPlayer = Api.create({ data: castText }, host, {
            autoPlay: !!shouldPlay,
            loop: false,
            controls: false,
            fit: 'width',
            speed: rate,
            startAt: at || 0,
            cursorMode: 'steady',
            adaptivePalette: false,
            terminalFontFamily: fonts.family,
            terminalFontSize: fonts.size,
            cols: source.width || 80,
            rows: source.height || 16
          });
          wireCast(castPlayer);
        }
        try { spawn(false, 0); }
        catch (err) {
          booted = false;
          showError(LOAD_FAIL);
          return;
        }
        var polls = 0;
        var poll = window.setInterval(function () {
          polls += 1;
          if (dead) { window.clearInterval(poll); return; }
          var d = readDur();
          if (d > 0) {
            knownDur = d;
            placeTicks(d);
            window.clearInterval(poll);
            markReady();
            if (ui) ui.paint();
            if (wantPlay && castPlayer) {
              var pendingPlay = castPlayer.play();
              catchPlay(pendingPlay);
            }
          } else if (polls >= 20) {
            window.clearInterval(poll);
            booted = false;
            showError(LOAD_FAIL);
          }
        }, 100);
        bag.add(function () { window.clearInterval(poll); });
      }).catch(function () {
        booted = false;
        if (!dead) showError(LOAD_FAIL);
      });
    }
    function ensure() {
      if (dead || booted) return;
      booted = true;
      if (kind === 'rrweb') {
        root.setAttribute('data-state', 'loading');
        mountRrweb();
      } else if (kind === 'cast') {
        root.setAttribute('data-state', 'loading');
        mountCast();
      } else ensureMedia();
    }
    function assignSource() {
      if (assigned || !media) return;
      var url = playableUrl();
      if (!url) {
        showError('没有可播的内容。');
        return;
      }
      assigned = true;
      media.preload = 'none';
      media.src = url;
      try { media.playbackRate = rate; } catch (err) {}
    }
    function play() {
      if (dead) return;
      silenceExcept(api);
      wantPlay = true;
      hideBlocked();
      if (root.getAttribute('data-state') === 'poster' || root.getAttribute('data-state') === 'blocked') root.setAttribute('data-state', 'loading');
      if (root.getAttribute('data-state') === 'ended') {
        try { api.seek(0); } catch (err) {}
      }
      if (!booted) ensure();
      if (kind === 'hls') {
        if (!assigned) openHls();
        else if (media) {
          var pendingHls = media.play();
          catchPlay(pendingHls);
        }
        return;
      }
      if (kind === 'rrweb') {
        if (rrPlayer) { try { rrPlayer.play(); } catch (err) {} }
        return;
      }
      if (kind === 'cast') {
        if (castPlayer) {
          var pendingCast = castPlayer.play();
          catchPlay(pendingCast);
        }
        return;
      }
      ensureMedia();
      assignSource();
      if (!media) return;
      var pendingPlay = media.play();
      catchPlay(pendingPlay);
    }
    function pause() {
      if (dead) return;
      wantPlay = false;
      if (media && !media.paused) media.pause();
      if (rrPlayer) { try { rrPlayer.pause(); } catch (err) {} }
      if (castPlayer) {
        try {
          var pendingPause = castPlayer.pause();
          if (pendingPause && pendingPause.catch) pendingPause.catch(function () {});
        } catch (err) {}
      }
    }
    function seek(t) {
      var d = readDur();
      var next = Math.max(0, d > 0 ? Math.min(d, t) : Math.max(0, t));
      if (root.getAttribute('data-state') === 'ended') root.setAttribute('data-state', 'paused');
      if (media) { try { media.currentTime = next; } catch (err) {} }
      if (rrPlayer) {
        var playing = root.getAttribute('data-state') === 'playing';
        try { rrPlayer.goto(Math.round(next * 1000), playing); } catch (err) {}
      }
      if (castPlayer) {
        try { castPlayer.seek(next); } catch (err) {}
      }
      if (ui) ui.paint();
    }
    function setRate(r) {
      if (!isFinite(r) || !r) return;
      rate = r;
      root.querySelectorAll('[data-rate]').forEach(function (btn) {
        btn.setAttribute('aria-pressed', Number(btn.getAttribute('data-rate')) === r ? 'true' : 'false');
      });
      if (media) { try { media.playbackRate = r; } catch (err) {} }
      if (rrPlayer) { try { rrPlayer.setSpeed(r); } catch (err) {} }
      if (castPlayer) {
        var at = readTime();
        var playing = root.getAttribute('data-state') === 'playing';
        try {
          if (castPlayer.pause) castPlayer.pause();
          if (castPlayer.dispose) castPlayer.dispose();
        } catch (err) {}
        castPlayer = null;
        var host = root.querySelector('[data-term]');
        if (host && window.AsciinemaPlayer) {
          host.textContent = '';
          try {
            var fonts = fontOf();
            castPlayer = window.AsciinemaPlayer.create({ data: castText }, host, {
              autoPlay: playing,
              loop: false,
              controls: false,
              fit: 'width',
              speed: rate,
              startAt: at || 0,
              cursorMode: 'steady',
              adaptivePalette: false,
              terminalFontFamily: fonts.family,
              terminalFontSize: fonts.size,
              cols: source.width || 80,
              rows: source.height || 16
            });
            wireCast(castPlayer);
          } catch (err) {}
        }
      }
    }
    function toggleCaptions() {
      var on = root.getAttribute('data-cc') === 'off';
      root.setAttribute('data-cc', on ? 'on' : 'off');
      var cues = root.querySelector('.med-cues');
      if (cues) cues.hidden = !on;
      if (ccBtn) ccBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      showTrack(on);
    }
    function toggleMute() {
      if (!media) return;
      media.muted = !media.muted;
      root.setAttribute('data-muted', media.muted ? '1' : '0');
    }
    function fullscreen() {
      var target = floating ? mini : root;
      if (document.fullscreenElement === target) {
        if (document.exitFullscreen) document.exitFullscreen();
        return;
      }
      var req = target.requestFullscreen || target.webkitRequestFullscreen;
      if (req) {
        try { req.call(target); } catch (err) {}
      }
    }
    function dock() {
      if (!floating) return;
      floating = false;
      root.removeAttribute('data-floating');
      var note = root.querySelector('[data-float-note]');
      if (note) note.hidden = true;
      if (media && frame.contains && kind !== 'audio' && media.parentNode !== frame) frame.appendChild(media);
      mini.hidden = true;
      if (mini.parentNode !== root) root.appendChild(mini);
    }
    function showMini() {
      if (dead || floating) return;
      if (root.getAttribute('data-state') !== 'playing') return;
      if (media && document.pictureInPictureElement === media) return;
      if (document.fullscreenElement && (document.fullscreenElement === root || (root.contains && root.contains(document.fullscreenElement)))) return;
      var phone = narrow();
      if (!phone && media && (kind === 'video' || kind === 'hls')) {
        var stage = mini.querySelector('[data-mini-stage]');
        if (stage && media.parentNode !== stage) stage.appendChild(media);
        var note = root.querySelector('[data-float-note]');
        if (note) note.hidden = false;
      }
      floating = true;
      root.setAttribute('data-floating', '1');
      mini.hidden = false;
      if (mini.parentNode !== document.body) document.body.appendChild(mini);
      paintIcons();
    }
    function retry() {
      if (dead) return;
      assigned = false;
      wantPlay = false;
      if (hls) { try { hls.destroy(); } catch (err) {} hls = null; }
      if (media) {
        try { media.pause(); } catch (err) {}
        media.removeAttribute('src');
        try { media.load(); } catch (err) {}
      }
      root.setAttribute('data-state', 'poster');
      root.removeAttribute('data-started');
      if (kind === 'rrweb' || kind === 'cast') {
        booted = false;
        if (rrPlayer) { try { if (rrPlayer.$destroy) rrPlayer.$destroy(); } catch (err) {} rrPlayer = null; }
        if (castPlayer) { try { castPlayer.dispose(); } catch (err) {} castPlayer = null; }
        ensure();
      } else {
        play();
      }
    }
    function userToggle() {
      var state = root.getAttribute('data-state');
      if (state === 'playing') pause();
      else if (state === 'ended') { seek(0); play(); }
      else play();
    }
    function destroy() {
      if (dead) return;
      dead = true;
      remember(true);
      wantPlay = false;
      if (entry) {
        var idx = registry.indexOf(entry);
        if (idx >= 0) registry.splice(idx, 1);
      }
      if (viewObs) { try { viewObs.unobserve(root); } catch (err) {} }
      root._medInst = null;
      dock();
      if (hls) { try { hls.destroy(); } catch (err) {} hls = null; }
      if (rrPlayer) {
        try { rrPlayer.pause(); } catch (err) {}
        try { if (rrPlayer.$destroy) rrPlayer.$destroy(); } catch (err) {}
        rrPlayer = null;
      }
      if (castPlayer) {
        try { castPlayer.pause(); } catch (err) {}
        try { castPlayer.dispose(); } catch (err) {}
        castPlayer = null;
      }
      if (media) {
        try { media.pause(); } catch (err) {}
        media.removeAttribute('src');
        try { media.load(); } catch (err) {}
        if (media.parentNode) media.remove();
        media = null;
      }
      if (objUrl) { try { URL.revokeObjectURL(objUrl); } catch (err) {} objUrl = ''; }
      if (trackUrl) { try { URL.revokeObjectURL(trackUrl); } catch (err) {} trackUrl = ''; }
      bag.stop();
      if (mini.parentNode) mini.remove();
    }

    buildTicks();
    if (source.captions && source.captions.length && ccBtn) ccBtn.hidden = false;
    var saved = resumeRead(resumeId());
    var resumeRow = root.querySelector('[data-resume-row]');
    var resumeBtn = root.querySelector('[data-resume]');
    if (resumeBtn && saved > 1 && (!(knownDur > 0) || saved < knownDur - 1)) {
      resumeBtn.textContent = '从 ' + fmt(saved) + ' 继续';
      resumeRow.hidden = false;
    }
    var transportApi = {
      watchEnd: kind === 'rrweb' || kind === 'cast',
      live: function () { return !!(media && media.duration === Infinity); },
      getTime: readTime,
      getDuration: readDur,
      seek: seek,
      play: play,
      pause: pause,
      setRate: setRate,
      fullscreen: fullscreen,
      mute: toggleMute,
      captions: (source.captions && source.captions.length) ? toggleCaptions : null,
      hook: hook
    };
    ui = bindTransport(root, transportApi, bag);
    on(root.querySelector('[data-blocked-play]'), 'click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      play();
    }, bag);
    on(big, 'click', userToggle, bag);
    on(root.querySelector('[data-poster]'), 'click', function (ev) {
      if (ev.target.closest && ev.target.closest('button')) return;
      userToggle();
    }, bag);
    on(pipBtn, 'click', function () {
      if (!media || !media.requestPictureInPicture) return;
      if (document.pictureInPictureElement === media) {
        if (document.exitPictureInPicture) document.exitPictureInPicture();
        return;
      }
      var pendingPip = media.requestPictureInPicture();
      if (pendingPip && pendingPip.catch) pendingPip.catch(function () {});
    }, bag);
    on(ccBtn, 'click', toggleCaptions, bag);
    on(resumeBtn, 'click', function () {
      resumeRow.hidden = true;
      seek(saved);
      play();
    }, bag);
    on(root.querySelector('[data-dismiss]'), 'click', function () {
      resumeRow.hidden = true;
    }, bag);
    on(mini.querySelector('[data-mini-play]'), 'click', userToggle, bag);
    on(mini.querySelector('[data-mini-back]'), 'click', function () {
      dock();
      try { root.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); }
      catch (err) { try { root.scrollIntoView(); } catch (ignore) {} }
    }, bag);
    on(mini.querySelector('[data-mini-close]'), 'click', function () {
      pause();
      dock();
    }, bag);
    var narrowQuery = window.matchMedia ? window.matchMedia('(max-width: 480px)') : null;
    function onNarrowChange() {
      if (dead || !floating) return;
      if (narrow()) {
        if (media && kind !== 'audio' && frame && media.parentNode !== frame) frame.appendChild(media);
        var note = root.querySelector('[data-float-note]');
        if (note) note.hidden = true;
      } else if (media && (kind === 'video' || kind === 'hls') && root.getAttribute('data-state') === 'playing') {
        var stage = mini.querySelector('[data-mini-stage]');
        if (stage && media.parentNode !== stage) stage.appendChild(media);
        var noteWide = root.querySelector('[data-float-note]');
        if (noteWide) noteWide.hidden = false;
      }
    }
    if (narrowQuery && narrowQuery.addEventListener) on(narrowQuery, 'change', onNarrowChange, bag);
    else if (narrowQuery && narrowQuery.addListener) {
      narrowQuery.addListener(onNarrowChange);
      bag.add(function () { narrowQuery.removeListener(onNarrowChange); });
    }

    var api = {
      play: play,
      pause: pause,
      seek: seek,
      setRate: setRate,
      destroy: destroy,
      on: subscribe
    };
    entry = {
      api: api,
      yieldTo: function () { pause(); dock(); }
    };
    registry.push(entry);
    root._medInst = { enter: function () { ensure(); if (floating) dock(); }, leave: function () { if (root.getAttribute('data-state') === 'playing') showMini(); } };
    var obs = observer();
    if (obs) obs.observe(root);
    else ensure();
    if (born !== gen || !root.isConnected) destroy();
    return api;
  }

  function start(root) {
    pendingLoad = null;
    var d = demo();
    if (!d || !root || !root.isConnected) return;
    d.lecture(root.querySelector('[data-med="lecture"]'));
    d.replay(root.querySelector('[data-med="replay"]'));
    d.terminal(root.querySelector('[data-med="terminal"]'));
    d.voice(root.querySelector('[data-med="voice"]'));
    d.hls(root.querySelector('[data-med="hls"]'));
    d.inline(root);
  }

  function mount() {
    var root = document.querySelector('[data-med-root]');
    if (!root || !root.isConnected) return;
    if (pendingLoad) {
      window.removeEventListener('load', pendingLoad);
      pendingLoad = null;
    }
    if (document.readyState === 'complete') {
      start(root);
      return;
    }
    pendingLoad = function () { start(root); };
    window.addEventListener('load', pendingLoad, { once: true });
  }

  function destroy() {
    gen += 1;
    if (pendingLoad) {
      window.removeEventListener('load', pendingLoad);
      pendingLoad = null;
    }
    registry.slice().forEach(function (item) {
      try { item.api.destroy(); } catch (err) {}
    });
    registry = [];
    silencers = [];
    var root = document.querySelector('[data-med-root]');
    if (root) [].slice.call(root.querySelectorAll('[data-med]')).forEach(halt);
    if (viewObs) {
      try { viewObs.disconnect(); } catch (err) {}
      viewObs = null;
    }
    [].slice.call(document.querySelectorAll('.med-mini')).forEach(function (el) {
      if (el.parentNode === document.body) el.remove();
    });
  }

  /* ---------- 上传：分片、进度、人话报错、可重试 ----------
     POST /media/uploads → PUT /uploads/{id}/chunks/{idx} → POST /uploads/{id}/complete → 轮询 GET /uploads/{id}。
     upload(file, {purpose, onProgress, signal, crop, forAsset}) 返回 Promise<{id, asset, url, width, height}>。
     失败时 error.message 是一句人话，error.retry() 复用同一个上传号和幂等键接着传。 */
  var UPLOAD_CHUNK = 1024 * 1024;
  var UPLOAD_MAX = 64 * 1024 * 1024;
  var POLL_MS = 600;
  var POLL_TRIES = 50;
  var IMAGE_TYPES = /^image\/(png|jpeg|webp|gif|avif)$/;
  var REJECT_TEXT = {
    svg_not_allowed: '不收 SVG：它能带脚本。请换成 PNG 或 JPEG。',
    type_not_allowed: '只收 JPEG、PNG、GIF、WebP、AVIF 图片。这个文件不是。',
    extension_mismatch: '文件后缀和实际内容对不上，换一张真正的图片。',
    too_many_pixels: '图片像素太多了（单边不超过 2 万，总共不超过 4000 万像素），先缩小一点。',
    corrupt: '这张图片打不开，可能已损坏。',
    not_utf8: 'HTML 文件要用 UTF-8 编码保存。',
    checksum_mismatch: '传的过程中文件内容出了差错，请重试。',
    crop_out_of_bounds: '裁剪框超出了图片范围。',
    abandoned: '这次上传放了太久，已作废，请重新选择文件。'
  };

  function sizeText(bytes) {
    var mb = bytes / (1024 * 1024);
    return (mb >= 10 || mb === Math.floor(mb) ? Math.round(mb) : Math.round(mb * 10) / 10) + ' MB';
  }

  function uploadError(message, extra) {
    var e = new Error(message);
    e.name = 'CommonsUploadError';
    e.retryable = false;
    e.code = (extra && extra.code) || 'upload_failed';
    e.reason = (extra && extra.reason) || '';
    if (extra && extra.retryable) e.retryable = true;
    return e;
  }

  /* 上传被权限挡住时优先用会话里的 reason('upload.create')；没有原因就不写等级数字。 */
  function uploadDeniedText(purpose) {
    if (purpose === 'avatar') return '你现在还不能换头像。';
    var session = window.CommonsSession;
    var why = session && typeof session.reason === 'function' ? session.reason('upload.create') : '';
    return why || '你的等级还不能上传文件。';
  }

  /* 把接口错误翻成给人看的一句话。服务端自带中文的（额度、大小）直接用。 */
  function describeUploadError(err, purpose) {
    var code = err && err.code;
    var d = (err && err.details) || {};
    if (err && err.name === 'CommonsUploadError') return { text: err.message, retryable: !!err.retryable, code: err.code };
    if (code === 'network_error') return { text: '网络断了，文件没传完。点「重试」会接着传。', retryable: true, code: code };
    if (code === 'demo_mode') return { text: '示例模式不连接后端，不能上传。', retryable: false, code: code };
    if (code === 'unauthenticated' || code === 'session_expired') return { text: '登录已过期，请重新登录后再传。', retryable: false, code: code };
    if (code === 'action_not_allowed') {
      return { text: uploadDeniedText(purpose), retryable: false, code: code };
    }
    if (code === 'payload_too_large') return { text: (err.message && err.message.indexOf('这个文件') === 0) ? err.message : '文件太大了，没有上传。', retryable: false, code: code };
    if (code === 'rate_limited') {
      var quotaOut = Number(d.retry_after_seconds) > 300;
      return { text: quotaOut && err.message ? err.message : '上传太频繁了，稍等一会儿再试。', retryable: !quotaOut, code: code };
    }
    if (code === 'capability_unavailable') return { text: '上传功能暂时没开放。', retryable: false, code: code };
    if (code === 'upload_rejected') return { text: REJECT_TEXT[d.reason] || err.message || '这个文件不能接受。', retryable: false, code: code };
    if (code === 'validation_failed') return { text: err.message || '文件信息不对，换一个文件试试。', retryable: false, code: code };
    return { text: '上传没成功，请重试一次。', retryable: true, code: code || 'upload_failed' };
  }

  function toBase64(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return window.btoa(out);
  }

  function readBuffer(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsArrayBuffer(file);
    });
  }

  function hex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), function (b) { return (b + 256).toString(16).slice(1); }).join('');
  }

  function pause(ms, signal) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(done, ms);
      function done() { if (signal) signal.removeEventListener('abort', stop); resolve(); }
      function stop() { clearTimeout(timer); reject(abortError()); }
      if (signal) {
        if (signal.aborted) { clearTimeout(timer); reject(abortError()); return; }
        signal.addEventListener('abort', stop);
      }
    });
  }

  function abortError() {
    var e = new Error('已取消上传');
    e.name = 'AbortError';
    return e;
  }

  function assetPick(asset) {
    var img = (asset && asset.image) || {};
    return {
      url: img.src || (asset && asset.fallback) || '',
      full: img.full || img.src || '',
      width: img.width || (asset && asset.width) || 0,
      height: img.height || (asset && asset.height) || 0
    };
  }

  /* 本地先拦一道：明显不对的文件不用白传。额度和大小以服务端为准，这里只读 /media/quota 做提示。 */
  function precheck(file, purpose, quota) {
    if (!file || typeof file.size !== 'number') return uploadError('没有选到文件。');
    if (purpose === 'html') {
      if (!/\.html?$/i.test(file.name || '')) return uploadError('这里只收 .html 文件。');
    } else {
      if (file.type === 'image/svg+xml' || /\.svgz?$/i.test(file.name || '')) return uploadError(REJECT_TEXT.svg_not_allowed);
      if (file.type && !IMAGE_TYPES.test(file.type)) return uploadError('这个文件不是能用的图片（收 JPEG、PNG、GIF、WebP、AVIF）。');
    }
    if (file.size < 1) return uploadError('这个文件是空的。');
    if (file.size > UPLOAD_MAX) return uploadError('文件超过 64 MB，没有上传。');
    var bucket = quota && quota[purpose === 'avatar' ? 'avatar' : 'file'];
    if (bucket) {
      var cap = purpose === 'html' && quota.html_max_bytes ? Math.min(bucket.max_bytes, quota.html_max_bytes) : bucket.max_bytes;
      if (bucket.daily_count < 1 || cap < 1) return uploadError(uploadDeniedText(purpose), { code: 'action_not_allowed' });
      if (file.size > cap) return uploadError('这个文件有 ' + sizeText(file.size) + '，超过了单个 ' + sizeText(cap) + ' 的上限，没有上传。', { code: 'payload_too_large' });
      if (bucket.used_today >= bucket.daily_count) return uploadError('今天的上传次数（' + bucket.daily_count + ' 个）已用完，明天再来。', { code: 'rate_limited' });
    }
    return null;
  }

  function quotaStatus() {
    var api = window.CommonsAPI;
    if (!api) return Promise.resolve(null);
    return api.get('/media/quota').then(function (r) { return r.data; }, function () { return null; });
  }

  function upload(file, options) {
    var api = window.CommonsAPI;
    options = options || {};
    var purpose = options.purpose || 'image';
    var progress = typeof options.onProgress === 'function' ? options.onProgress : function () {};
    var signal = options.signal || null;
    var job = { sha: '', buffer: null, id: '', chunks: 0, sent: {}, completed: false, key: api && api.newIdempotencyKey ? api.newIdempotencyKey() : String(Date.now()), result: null };

    function report(ratio, phase) { progress({ phase: phase, ratio: Math.max(0, Math.min(1, ratio)), loaded: Math.round(file.size * Math.max(0, Math.min(1, ratio))), total: file.size }); }
    function check() { if (signal && signal.aborted) throw abortError(); }

    function digest() {
      if (job.sha) return Promise.resolve();
      if (!window.crypto || !window.crypto.subtle) return Promise.reject(uploadError('这个浏览器不能在本地校验文件，换一个新版浏览器再试。'));
      return readBuffer(file).then(function (buf) {
        job.buffer = new Uint8Array(buf);
        return window.crypto.subtle.digest('SHA-256', buf);
      }).then(function (d) { job.sha = hex(d); });
    }

    function create() {
      if (job.id) return Promise.resolve();
      var body = { purpose: purpose, filename: String(file.name || 'file').slice(0, 200), size: file.size, sha256: job.sha };
      if (options.crop) body.crop = options.crop;
      if (options.forAsset) body.for_asset = options.forAsset;
      return api.post('/media/uploads', body, { idempotencyKey: job.key }).then(function (r) {
        job.id = r.data.id;
        job.chunks = r.data.chunks || Math.max(1, Math.ceil(file.size / UPLOAD_CHUNK));
      });
    }

    function sendChunks() {
      var idx = 0;
      function next() {
        check();
        while (idx < job.chunks && job.sent[idx]) idx += 1;
        if (idx >= job.chunks) return Promise.resolve();
        var at = idx;
        var part = job.buffer.subarray(at * UPLOAD_CHUNK, Math.min(file.size, (at + 1) * UPLOAD_CHUNK));
        return api.put('/media/uploads/' + encodeURIComponent(job.id) + '/chunks/' + at, { data: toBase64(part) }, { idempotencyKey: job.key + '-c' + at, signal: signal || undefined }).then(function () {
          job.sent[at] = true;
          report(0.9 * Object.keys(job.sent).length / job.chunks, 'upload');
          return next();
        });
      }
      return next();
    }

    function complete() {
      if (job.completed) return Promise.resolve();
      return api.post('/media/uploads/' + encodeURIComponent(job.id) + '/complete', {}, { idempotencyKey: job.key + '-done' }).then(function () {
        job.completed = true;
      }, function (err) {
        /* 上一次其实已经提交成功、只是响应丢了：服务端会回「已经提交」，直接去等结果。 */
        if (err && err.code === 'state_conflict') { job.completed = true; return; }
        throw err;
      });
    }

    function poll(tries) {
      check();
      return api.get('/media/uploads/' + encodeURIComponent(job.id)).then(function (r) {
        var u = r.data;
        if (u.state === 'ready' && u.asset) {
          var pick = assetPick(u.asset);
          report(1, 'done');
          return { id: u.asset.id, asset: u.asset, url: pick.url, full: pick.full, width: pick.width, height: pick.height, uploadId: job.id };
        }
        if (u.state === 'rejected') {
          throw uploadError(REJECT_TEXT[u.reason] || u.message || '这个文件不能接受。', { code: 'upload_rejected', reason: u.reason || '' });
        }
        if (tries >= POLL_TRIES) throw uploadError('服务器还在处理这个文件，稍后再点「重试」看看结果。', { retryable: true, code: 'processing_slow' });
        report(0.9 + 0.1 * Math.min(1, tries / 10), 'process');
        return pause(POLL_MS, signal).then(function () { return poll(tries + 1); });
      });
    }

    function run() {
      if (job.result) return Promise.resolve(job.result);
      return Promise.resolve().then(function () {
        check();
        report(0, 'start');
        return digest();
      }).then(create).then(sendChunks).then(complete).then(function () { return poll(0); }).then(function (res) {
        job.result = res;
        return res;
      });
    }

    /* 每次失败都换成一个带人话 message 和 retry() 的错误；AbortError 原样抛出。 */
    function attempt() {
      return run().catch(function (err) {
        if (err && err.name === 'AbortError') throw err;
        var d = describeUploadError(err, purpose);
        var e = uploadError(d.text, { code: d.code, retryable: d.retryable, reason: (err && (err.reason || (err.details && err.details.reason))) || '' });
        e.cause = err;
        e.retry = d.retryable ? attempt : null;
        throw e;
      });
    }

    var early = precheck(file, purpose, null);
    if (early) return Promise.reject(early);
    if (!api || api.mode !== 'live') return Promise.reject(uploadError('示例模式不连接后端，不能上传。', { code: 'demo_mode' }));
    return quotaStatus().then(function (q) {
      var bad = precheck(file, purpose, q);
      if (bad) throw bad;
      return attempt();
    });
  }

  window.CommonsMedia = {
    routes: { 'media-lab': page },
    mount: mount,
    destroy: destroy,
    need: need,
    player: player,
    upload: upload,
    quota: quotaStatus,
    describeUploadError: describeUploadError
  };
})();

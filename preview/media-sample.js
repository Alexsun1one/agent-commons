/* LG-4 R2: demo-only content; excluded from live builds. */
window.COMMONS_MEDIA_SAMPLE = {
create: function (env) {
  var LOAD_FAIL = env.LOAD_FAIL;
  var alertBox = env.alertBox;
  var alive = env.alive;
  var barHTML = env.barHTML;
  var begin = env.begin;
  var bindTransport = env.bindTransport;
  var destroy = env.destroy;
  var esc = env.esc;
  var fail = env.fail;
  var fmt = env.fmt;
  var hexOf = env.hexOf;
  var hideAlert = env.hideAlert;
  var liveHTML = env.liveHTML;
  var m3u8Problem = env.m3u8Problem;
  var makeBag = env.makeBag;
  var need = env.need;
  var on = env.on;
  var palette = env.palette;
  var player = env.player;
  var silenceExcept = env.silenceExcept;
  var speedHTML = env.speedHTML;
  var start = env.start;
  var tokenRaw = env.tokenRaw;
  var waveHeight = env.waveHeight;
  var SAMPLES = {
    lecture: 'assets/media-samples/lecture.js',
    formReplay: 'assets/media-samples/form-replay.js',
    terminal: 'assets/media-samples/terminal-cast.js'
  };
  var sampleCache = {};
  function loadSample(key) {
    var bag = window.CommonsMediaSamples;
    if (bag && bag[key]) return Promise.resolve(bag[key]);
    if (sampleCache[key]) return sampleCache[key];
    var src = SAMPLES[key];
    if (!src) return Promise.reject(new Error('sample'));
    var pending = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = function () {
        var got = window.CommonsMediaSamples && window.CommonsMediaSamples[key];
        if (got) resolve(got);
        else {
          delete sampleCache[key];
          reject(new Error('sample'));
        }
      };
      script.onerror = function () {
        delete sampleCache[key];
        reject(new Error('sample'));
      };
      document.head.appendChild(script);
    });
    sampleCache[key] = pending;
    return pending;
  }

  function synth(spec) {
    var Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Ctx) return Promise.reject(new Error('audio'));
    var rate = 22050;
    var duration = spec.duration;
    var ctx = new Ctx(1, Math.ceil(rate * duration), rate);
    (spec.tones || []).forEach(function (tone) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      var start = Math.max(0, tone.t);
      var end = Math.min(duration - 0.01, start + tone.d);
      if (!(end > start)) return;
      osc.type = 'sine';
      osc.frequency.value = tone.f;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, Math.min(end, start + 0.02));
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.01);
    });
    return ctx.startRendering().then(wavBlob);
  }

  function wavBlob(buffer) {
    var channel = buffer.getChannelData(0);
    var n = channel.length;
    var bytes = new ArrayBuffer(44 + n * 2);
    var view = new DataView(bytes);
    function str(offset, text) {
      var i;
      for (i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    }
    str(0, 'RIFF');
    view.setUint32(4, 36 + n * 2, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    str(36, 'data');
    view.setUint32(40, n * 2, true);
    var offset = 44;
    var i;
    for (i = 0; i < n; i++) {
      var sample = Math.max(-1, Math.min(1, channel[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
    return new Blob([bytes], { type: 'audio/wav' });
  }

  function recordBars(seconds, colors, still) {
    return new Promise(function (resolve, reject) {
      var canvas = null;
      if (typeof OffscreenCanvas === 'function') {
        try {
          var off = new OffscreenCanvas(320, 180);
          if (typeof off.captureStream === 'function') canvas = off;
        } catch (err) { canvas = null; }
      }
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
      }
      var ctx = canvas.getContext('2d');
      if (!ctx || typeof canvas.captureStream !== 'function' || !window.MediaRecorder) {
        reject(new Error('record'));
        return;
      }
      var mime = '';
      try {
        if (MediaRecorder.isTypeSupported) {
          if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) mime = 'video/webm;codecs=vp8';
          else if (MediaRecorder.isTypeSupported('video/webm')) mime = 'video/webm';
          else if (MediaRecorder.isTypeSupported('video/mp4')) mime = 'video/mp4';
        }
      } catch (err) { mime = ''; }
      var stream;
      try { stream = canvas.captureStream(12); }
      catch (err) { reject(err); return; }
      var rec;
      try {
        rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      } catch (err) {
        stream.getTracks().forEach(function (track) { try { track.stop(); } catch (e) {} });
        reject(err);
        return;
      }
      var chunks = [];
      var settled = false;
      function stopTracks() {
        stream.getTracks().forEach(function (track) { try { track.stop(); } catch (e) {} });
      }
      rec.ondataavailable = function (ev) {
        if (ev.data && ev.data.size) chunks.push(ev.data);
      };
      rec.onerror = function () {
        if (settled) return;
        settled = true;
        stopTracks();
        reject(new Error('record'));
      };
      rec.onstop = function () {
        if (settled) return;
        settled = true;
        stopTracks();
        if (still && !still()) { reject(new Error('gone')); return; }
        var blob = new Blob(chunks, { type: rec.mimeType || mime || 'video/webm' });
        if (!blob.size) reject(new Error('empty'));
        else resolve(blob);
      };
      function draw(p) {
        var i;
        var step = 320 / colors.length;
        ctx.fillStyle = colors[0];
        ctx.fillRect(0, 0, 320, 180);
        for (i = 0; i < colors.length; i++) {
          var h = Math.round((0.18 + 0.72 * Math.abs(Math.sin(p * Math.PI * 2 + i))) * 180);
          ctx.fillStyle = colors[i];
          ctx.fillRect(Math.round(i * step), 180 - h, Math.max(1, Math.round(step) - 2), h);
        }
      }
      draw(0);
      try { rec.start(200); }
      catch (err) {
        if (!settled) { settled = true; stopTracks(); reject(err); }
        return;
      }
      var dur = Math.max(1, seconds || 3) * 1000;
      var startedAt = (window.performance && performance.now) ? performance.now() : Date.now();
      function frame(now) {
        if (still && !still()) {
          try { rec.stop(); } catch (err) {}
          return;
        }
        var p = Math.min(1, ((now || Date.now()) - startedAt) / dur);
        draw(p);
        if (p < 1) requestAnimationFrame(frame);
        else {
          try { rec.stop(); } catch (err) {
            if (!settled) { settled = true; stopTracks(); reject(err); }
          }
        }
      }
      requestAnimationFrame(frame);
    });
  }

  function castOf(sample) {
    var slots = ['--ink', '--danger', '--success', '--notice', '--accent', '--cat-6', '--agent', '--slate-100', '--slate-600', '--danger', '--success', '--notice', '--accent', '--violet-400', '--teal-300', '--slate-50'];
    var paletteColors = slots.map(hexOf);
    var fg = hexOf('--teal-200');
    var bg = hexOf('--ink');
    if (!fg || fg.length !== 7 || !bg || bg.length !== 7 || paletteColors.some(function (item) { return item.length !== 7; })) {
      throw new Error('theme');
    }
    var header = {
      version: 2,
      width: sample.width,
      height: sample.height,
      theme: { fg: fg, bg: bg, palette: paletteColors.join(':') }
    };
    var lines = [JSON.stringify(header)];
    sample.events.forEach(function (ev) { lines.push(JSON.stringify(ev)); });
    return lines.join('\n');
  }

  function own(card, handle) {
    card._player = handle;
    card._medStop = function () {
      if (card._player) {
        var handleNow = card._player;
        card._player = null;
        handleNow.destroy();
      }
    };
  }

  /* safe-slot: body — 调用方传入本模块构造的完整媒体演示 HTML */
  function card(id, state, kicker, title, use, body, keys) {
    return '<article class="med-card" data-med="' + esc(id) + '" data-state="' + esc(state) + '" aria-label="' + esc(kicker) + '">' +
      '<div class="med-head">' +
        '<h2>' + esc(title) + '</h2>' +
        '<p class="med-use">' + esc(use) +
          (keys ? ' <span class="med-keys" tabindex="0" role="note" title="' + esc(keys) + '" aria-label="' + esc('快捷键：' + keys) + '">快捷键</span>' : '') +
        '</p>' +
      '</div>' +
      '<div class="med-stage" data-slot>' + body + '</div>' +
    '</article>';
  }

  function framePending(audio) {
    var name = audio ? 'med-frame med-frame--audio' : 'med-frame med-frame--video';
    return '<div class="' + name + '"><div class="med-skel"></div></div><div class="med-skel-bar" aria-hidden="true"></div>';
  }

  function slot(id, audio) {
    return '<div data-inline="' + esc(id) + '">' + framePending(audio) + '</div>';
  }

  function page() {
    var voice = '<div class="med-rec">' +
        '<button type="button" class="button" data-record>开始录音</button>' +
        '<button type="button" class="button danger" data-stop-rec hidden>停止</button>' +
        '<span class="med-clock" data-clock>0:00</span>' +
        '<div class="med-level" aria-hidden="true"><div class="med-level__fill" data-level></div></div>' +
      '</div>' +
      '<p class="med-note" data-note>声音只留在这一页的内存里，不上传。</p>' +
      '<div class="med-wave" data-wave hidden></div>' +
      '<div class="med-transport" data-transport hidden>' + /* safe: imported media control builder returns static escaped markup */ barHTML() + /* safe: imported media control builder returns static escaped markup */ speedHTML() + /* safe: imported media control builder returns static escaped markup */ liveHTML() + '</div>';
    var stream = '<p class="med-status" data-note></p>' +
      '<form class="med-paste" data-form>' +
        '<div class="field"><label for="med-hls-url">流地址</label>' +
        '<input id="med-hls-url" type="text" data-url autocomplete="off" spellcheck="false" placeholder="以 .m3u8 结尾"></div>' +
        '<button type="submit" class="button">试播</button>' +
      '</form>' +
      '<p class="med-note" data-msg></p>' +
      '<div data-hls-host></div>';
    return '<div class="med-page" data-med-root>' +
      '<header class="med-title"><div class="med-title-row"><h1>媒体件</h1><span class="pill outline">示例</span></div>' +
      '<p class="med-lead">录屏、终端和语音：能看、能跳、能对上文字。</p></header>' +
      '<div class="med-grid">' +
        card('lecture', 'loading', '讲解', '讲解播放器', '按章节或按句子跳。', framePending(true) + '<p class="med-status">正在准备这段讲解。</p>', '空格 播放/暂停 · ← → 跳 5 秒 · [ ] 换章 · f 全屏 · m 静音 · c 字幕') +
        card('replay', 'loading', '操作回放', '操作回放', '一段表单填写过程，可拖动回看。', framePending(false) + '<p class="med-status">正在准备这段操作回放。</p>') +
        card('terminal', 'loading', '终端', '终端回放', '跑测试、失败、改一行、再通过。', framePending(false) + '<p class="med-status">正在准备这段终端回放。</p>') +
        card('voice', 'empty', '语音', '语音笔记', '点开始才申请麦克风。', voice) +
        card('hls', 'empty', '流媒体', '流媒体', '粘贴 .m3u8 地址试播。', stream) +
      '</div>' +
      '<section class="med-story">' +
        '<div class="med-head">' +
          '<h2>在内容里</h2>' +
          '<p class="med-use">一段开始播，其他的自动停；滚出画面后缩到右下角。</p>' +
        '</div>' +
        '<article class="med-post">' +
          '<h3>把录屏嵌进正文</h3>' +
          '<p>先看一段运行时画出来的彩条。它带字幕和章节，不是网上的文件。</p>' +
          slot('v1', false) +
          '<p>再来一段，没有字幕。点它的时候，上一段会停。</p>' +
          slot('v2', false) +
          '<p>接着是一段提示音。</p>' +
          slot('a1', true) +
          '<p>最后是终端回放，和上面的画面不会一起走。</p>' +
          slot('t1', false) +
        '</article>' +
      '</section></div>';
  }

  function bootLecture(card) {
    if (!card) return;
    var n = begin(card);
    var g = env.gen;
    var stage = card.querySelector('[data-slot]');
    loadSample('lecture').then(function (data) {
      if (!alive(card, n, g)) return null;
      return synth(data).then(function (blob) { return { data: data, blob: blob }; });
    }).then(function (pack) {
      if (!pack || !alive(card, n, g) || !stage) return;
      own(card, player(stage, {
        kind: 'audio',
        src: 'sample:lecture',
        data: pack.blob,
        title: '讲解',
        poster: 'assets/samples/banner-contours.webp',
        duration: pack.data.duration,
        chapters: pack.data.chapters,
        captions: pack.data.cues
      }));
      card.setAttribute('data-state', 'ready');
    }).catch(function () {
      if (!alive(card, n, g)) return;
      fail(card, LOAD_FAIL, function () { bootLecture(card); });
    });
  }

  function bootReplay(card) {
    if (!card) return;
    var n = begin(card);
    var g = env.gen;
    var stage = card.querySelector('[data-slot]');
    loadSample('formReplay').then(function (data) {
      if (!alive(card, n, g) || !stage) return;
      own(card, player(stage, {
        kind: 'rrweb',
        src: 'sample:form-replay',
        data: data.events,
        title: '操作回放',
        poster: 'assets/samples/talk-accept-checklist.webp',
        duration: data.duration,
        chapters: data.chapters
      }));
      card.setAttribute('data-state', 'ready');
    }).catch(function () {
      if (!alive(card, n, g)) return;
      fail(card, LOAD_FAIL, function () { bootReplay(card); });
    });
  }

  function bootTerm(card) {
    if (!card) return;
    var n = begin(card);
    var g = env.gen;
    var stage = card.querySelector('[data-slot]');
    loadSample('terminal').then(function (sample) {
      if (!alive(card, n, g) || !stage) return;
      var dur = 0;
      sample.events.forEach(function (ev) { if (ev[0] > dur) dur = ev[0]; });
      own(card, player(stage, {
        kind: 'cast',
        src: 'sample:terminal',
        data: castOf(sample),
        title: '终端回放',
        duration: dur,
        width: sample.width,
        height: sample.height,
        chapters: sample.chapters
      }));
      card.setAttribute('data-state', 'ready');
    }).catch(function () {
      if (!alive(card, n, g)) return;
      fail(card, LOAD_FAIL, function () { bootTerm(card); });
    });
  }

  function bootVoice(card) {
    if (!card) return;
    var n = begin(card);
    var g = env.gen;
    var bag = makeBag(card);
    var recordBtn = card.querySelector('[data-record]');
    var stopBtn = card.querySelector('[data-stop-rec]');
    var clock = card.querySelector('[data-clock]');
    var level = card.querySelector('[data-level]');
    var note = card.querySelector('[data-note]');
    var wave = card.querySelector('[data-wave]');
    var rec = null;
    var ws = null;
    var ui = null;
    var raf = 0;
    var timer = 0;
    function ok() { return alive(card, n, g); }
    function releaseStream() {
      if (card._medStream) {
        card._medStream.getTracks().forEach(function (track) { try { track.stop(); } catch (err) {} });
        card._medStream = null;
      }
      if (card._medActx) {
        try { card._medActx.close(); } catch (err) {}
        card._medActx = null;
      }
    }
    function stopMeter() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (timer) window.clearInterval(timer);
      timer = 0;
      if (level) level.style.transform = 'scaleX(0)';
    }
    env.silencers.push({
      owner: card,
      fn: function () { if (ws && ws.pause) { try { ws.pause(); } catch (err) {} } }
    });
    bag.add(function () {
      env.silencers = env.silencers.filter(function (entry) { return entry.owner !== card; });
      stopMeter();
      if (rec && rec.state === 'recording') {
        try { rec.onstop = null; rec.stop(); } catch (err) {}
      }
      rec = null;
      releaseStream();
      if (ws) { try { ws.destroy(); } catch (err) {} }
      ws = null;
    });
    function ensureUi() {
      var wrap = card.querySelector('[data-transport]');
      if (wrap) wrap.hidden = false;
      if (ui) return ui;
      ui = bindTransport(card, {
        getTime: function () { return ws && ws.getCurrentTime ? ws.getCurrentTime() : 0; },
        getDuration: function () {
          var d = ws && ws.getDuration ? ws.getDuration() : 0;
          return (typeof d === 'number' && isFinite(d)) ? d : 0;
        },
        seek: function (t) { if (ws && ws.setTime) ws.setTime(t); },
        play: function () {
          if (!ws || !ws.play) return;
          silenceExcept(card);
          var pendingPlay = ws.play();
          if (pendingPlay && pendingPlay.catch) pendingPlay.catch(function (err) {
            if (err && err.name === 'NotAllowedError') {
              card.setAttribute('data-state', 'blocked');
              if (note) note.textContent = '浏览器拦住了自动播放。点一下播放。';
            }
          });
        },
        pause: function () { if (ws && ws.pause) ws.pause(); },
        setRate: function (r) { if (ws && ws.setPlaybackRate) ws.setPlaybackRate(r, true); }
      }, bag);
      return ui;
    }
    function showTake(blob, why) {
      card._medBlob = blob;
      card.setAttribute('data-state', 'loading');
      if (why && note) note.textContent = why;
      if (wave) wave.hidden = false;
      hideAlert(card);
      need('wavesurfer').then(function (WaveSurfer) {
        if (!ok()) return;
        if (ws) { try { ws.destroy(); } catch (err) {} ws = null; }
        ws = WaveSurfer.create({
          container: wave,
          height: waveHeight(),
          waveColor: tokenRaw('--muted'),
          progressColor: tokenRaw('--accent'),
          cursorColor: tokenRaw('--ink'),
          barWidth: 2,
          barGap: 2,
          barRadius: 2,
          interact: true,
          hideScrollbar: true,
          normalize: true
        });
        ws.on('play', function () { if (ui) ui.notePlay(); });
        ws.on('pause', function () { if (ui) ui.notePause(); });
        ws.on('finish', function () { if (ui) ui.noteEnded(); });
        return ws.loadBlob(blob).then(function () {
          if (!ok()) return;
          ensureUi();
          card.setAttribute('data-state', 'ready');
          if (ui) ui.paint();
        });
      }).catch(function () {
        if (!ok()) return;
        card.setAttribute('data-state', 'error');
        var missing = !window.WaveSurfer;
        alertBox(card, bag, missing ? LOAD_FAIL : '波形没有画出来。录音还在这一页里。', function () {
          showTake(card._medBlob, why);
        });
      });
    }
    function fallback(why) {
      card.setAttribute('data-state', 'loading');
      if (note) note.textContent = why;
      synth({
        duration: 4,
        tones: [
          { t: 0.3, f: 523, d: 0.35 },
          { t: 1.2, f: 659, d: 0.35 },
          { t: 2.2, f: 784, d: 0.4 }
        ]
      }).then(function (blob) {
        if (!ok()) return;
        showTake(blob, why);
      }).catch(function () {
        if (!ok()) return;
        card.setAttribute('data-state', 'error');
        alertBox(card, bag, LOAD_FAIL, function () { fallback(why); });
      });
    }
    function meter(stream) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx || !level) return;
      var actx = new Ctx();
      card._medActx = actx;
      var source = actx.createMediaStreamSource(stream);
      var analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      var bins = new Uint8Array(analyser.fftSize);
      function frame() {
        if (!ok()) return;
        analyser.getByteTimeDomainData(bins);
        var sum = 0;
        var i;
        for (i = 0; i < bins.length; i++) {
          var v = (bins[i] - 128) / 128;
          sum += v * v;
        }
        var rms = Math.min(1, Math.sqrt(sum / bins.length) * 3);
        level.style.transform = 'scaleX(' + rms + ')';
        raf = requestAnimationFrame(frame);
      }
      if (actx.resume) actx.resume();
      raf = requestAnimationFrame(frame);
    }
    function finishRec() {
      stopMeter();
      if (stopBtn) stopBtn.hidden = true;
      if (recordBtn) {
        recordBtn.hidden = false;
        recordBtn.textContent = '再录一段';
      }
      if (rec && rec.state === 'recording') rec.stop();
    }
    function startRec() {
      if (card.getAttribute('data-asking') === '1' || card.getAttribute('data-state') === 'recording') return;
      if (ws && ws.pause) { try { ws.pause(); } catch (err) {} }
      var devices = navigator.mediaDevices;
      if (!devices || !devices.getUserMedia) {
        fallback('找不到麦克风。已改播一段运行时生成的示例音。');
        return;
      }
      card.setAttribute('data-asking', '1');
      devices.getUserMedia({ audio: true }).then(function (stream) {
        card.removeAttribute('data-asking');
        if (!ok()) {
          stream.getTracks().forEach(function (track) { track.stop(); });
          return;
        }
        card._medStream = stream;
        if (!window.MediaRecorder) {
          releaseStream();
          fallback('这个浏览器录不了音。已改播一段运行时生成的示例音。');
          return;
        }
        var mime = '';
        try {
          if (window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm')) mime = 'audio/webm';
          else if (window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/mp4')) mime = 'audio/mp4';
        } catch (err) { mime = ''; }
        try {
          rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        } catch (err) {
          releaseStream();
          fallback('这个浏览器录不了音。已改播一段运行时生成的示例音。');
          return;
        }
        var chunks = [];
        rec.ondataavailable = function (ev) {
          if (g !== env.gen) return;
          if (ev.data && ev.data.size) chunks.push(ev.data);
        };
        rec.onstop = function () {
          var type = (rec && rec.mimeType) || mime || 'audio/webm';
          releaseStream();
          if (g !== env.gen || !card.isConnected) return;
          showTake(new Blob(chunks, { type: type }), '录音留在这一页的内存里，没有上传，也没有写入本机存储。');
        };
        rec.start();
        card.setAttribute('data-state', 'recording');
        if (recordBtn) recordBtn.hidden = true;
        if (stopBtn) stopBtn.hidden = false;
        var started = Date.now();
        if (clock) clock.textContent = '0:00';
        timer = window.setInterval(function () {
          if (clock) clock.textContent = fmt((Date.now() - started) / 1000);
        }, 200);
        meter(stream);
      }).catch(function (err) {
        card.removeAttribute('data-asking');
        if (!ok()) return;
        var name = err && err.name;
        var why = name === 'NotAllowedError' ? '麦克风被拒绝。' : name === 'NotFoundError' ? '没有找到麦克风。' : '麦克风用不了。';
        fallback(why + '已改播一段运行时生成的示例音。');
      });
    }
    on(recordBtn, 'click', startRec, bag);
    on(stopBtn, 'click', finishRec, bag);
  }

  function bootHls(card) {
    if (!card) return;
    var n = begin(card);
    var g = env.gen;
    var bag = makeBag(card);
    var note = card.querySelector('[data-note]');
    var msg = card.querySelector('[data-msg]');
    var form = card.querySelector('[data-form]');
    var input = card.querySelector('[data-url]');
    var host = card.querySelector('[data-hls-host]');
    function ok() { return alive(card, n, g); }
    function say(text) { if (msg) msg.textContent = text || ''; }
    on(form, 'submit', function (ev) {
      ev.preventDefault();
      if (!ok()) return;
      var problem = m3u8Problem(input && input.value);
      if (problem === 'empty') {
        card.setAttribute('data-state', 'empty');
        if (note) note.textContent = '先粘贴一个 .m3u8 地址。';
        say('');
        if (input) input.removeAttribute('aria-invalid');
        return;
      }
      if (problem) {
        if (input) input.setAttribute('aria-invalid', 'true');
        say('这不是能试播的流地址。请粘贴完整地址，并且以 .m3u8 结尾。');
        return;
      }
      if (input) input.removeAttribute('aria-invalid');
      say('');
      if (note) note.textContent = '';
      var url = String(input.value).trim();
      if (card._player) card._player.destroy();
      card._player = player(host, { kind: 'hls', src: url, title: '流', duration: 0 });
      card._player.on('error', function () { card.setAttribute('data-state', 'error'); });
      card._player.on('ready', function () { card.setAttribute('data-state', 'ready'); });
      card._player.play();
      card.setAttribute('data-state', 'loading');
    }, bag);
    bag.add(function () {
      if (card._player) {
        card._player.destroy();
        card._player = null;
      }
    });
  }

  function bootInline(root) {
    var g = env.gen;
    function still() { return g === env.gen && root.isConnected; }
    var v1 = root.querySelector('[data-inline="v1"]');
    var v2 = root.querySelector('[data-inline="v2"]');
    var a1 = root.querySelector('[data-inline="a1"]');
    var t1 = root.querySelector('[data-inline="t1"]');
    function explain(el) {
      if (!el || !el.isConnected || !still()) return;
      el.innerHTML = '<p class="med-note">这段示例画面没有生成出来。旁边的内容还能用。</p>';
    }
    function runVideo(el, seed, extra) {
      if (!el) return Promise.resolve();
      var colors = palette(seed
        ? ['--cat-4', '--cat-8', '--violet-400', '--accent', '--cat-2', '--teal-300']
        : ['--cat-1', '--cat-3', '--agent', '--accent', '--teal-300', '--cat-9']);
      if (!colors) { explain(el); return Promise.resolve(); }
      return recordBars(seed ? 3 : 4, colors, still).then(function (blob) {
        if (!still() || !el.isConnected) return;
        player(el, {
          kind: 'video',
          src: extra.src,
          data: blob,
          title: extra.title,
          duration: seed ? 3 : 4,
          poster: seed ? 'assets/samples/share-bg-2.webp' : 'assets/samples/share-bg-1.webp',
          chapters: extra.chapters,
          captions: extra.captions
        }, { cat: extra.cat });
      }).catch(function () { explain(el); });
    }
    runVideo(v1, 0, {
      src: 'sample:post-bars',
      title: '彩条',
      cat: 3,
      chapters: [{ t: 0, label: '起' }, { t: 2, label: '落' }],
      captions: [
        { t: 0.2, end: 1.8, text: '这是帖子里的第一段画面。' },
        { t: 2.0, end: 3.8, text: '字幕跟着走，刻度是章节。' }
      ]
    }).then(function () {
      return runVideo(v2, 1, { src: 'sample:post-bars-b', title: '另一段彩条', cat: 4 });
    });
    if (a1) {
      synth({
        duration: 5,
        tones: [
          { t: 0.3, f: 392, d: 0.4 },
          { t: 1.6, f: 494, d: 0.4 },
          { t: 3.1, f: 587, d: 0.45 }
        ]
      }).then(function (blob) {
        if (!still() || !a1.isConnected) return;
        player(a1, {
          kind: 'audio',
          src: 'sample:post-tone',
          data: blob,
          title: '帖子里的提示音',
          poster: 'assets/samples/banner-grid.webp',
          duration: 5
        }, { cat: 7 });
      }).catch(function () { explain(a1); });
    }
    if (t1) {
      loadSample('terminal').then(function (sample) {
        if (!still() || !t1.isConnected) return;
        var dur = 0;
        sample.events.forEach(function (ev) { if (ev[0] > dur) dur = ev[0]; });
        player(t1, {
          kind: 'cast',
          src: 'sample:post-terminal',
          data: castOf(sample),
          title: '终端回放',
          duration: dur,
          width: sample.width,
          height: sample.height,
          chapters: sample.chapters
        });
      }).catch(function () { explain(t1); });
    }
  }


  return { page: page, lecture: bootLecture, replay: bootReplay, terminal: bootTerm, voice: bootVoice, hls: bootHls, inline: bootInline };
}
};

/* R13 GAMES-1 · 乐园、模拟考场、猜提示词、熊猫抽签与抢沙发。 */
(function () {
  'use strict';
  var G = window;
  var SAMPLE = G.COMMONS_GAMES_SAMPLE || { games: [], weekly: [], sofas: [], questions: [], guesses: [], fortunes: [] };
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  var NAV = [['games', '游戏中心', 'dice', 'games']];
  var DICE = 'M8 4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4zM9 9h.01M15 9h.01M12 12h.01M9 15h.01M15 15h.01';
  var memory = {};
  var state = { root: null, bound: false, timer: null, controller: null, exam: null, guess: null, error: '', offBalance: null };

  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"'`]/g, function (c) { return ESC[c]; }); }
  /* safe-fn: CommonsLinks.person 按接口约定转义；本地退路对名字 esc、handle encodeURIComponent。 */
  function personLink(handle, name, level) {
    if (G.CommonsLinks && typeof G.CommonsLinks.person === 'function') return G.CommonsLinks.person(handle, name, { level: level });
    return handle ? '<a class="lk-person" href="#/u/' + encodeURIComponent(handle) + '">' + esc(name) + '</a>' : esc(name);
  }
  function safeUrl(value) {
    if (G.Commons && typeof G.Commons.safeUrl === 'function') return G.Commons.safeUrl(value);
    var text = String(value == null ? '' : value);
    return /^(?:assets\/|#\/)/.test(text) && text.indexOf('..') < 0 ? text : '';
  }
  function read(key, fallback) {
    if (G.Commons && typeof G.Commons.read === 'function') return G.Commons.read('games.' + key, fallback);
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : fallback;
  }
  function write(key, value) {
    if (G.Commons && typeof G.Commons.write === 'function') return G.Commons.write('games.' + key, value);
    memory[key] = value;
    return value;
  }
  function isLive() { return G.CommonsAPI && G.CommonsAPI.mode === 'live'; }
  function today() { return new Date().toISOString().slice(0, 10); }
  function enabled() { return read('playground-enabled', true) !== false; }
  function button(label, action, tone, disabled) {
    return '<button type="button" class="button ' + esc(tone || '') + '" data-games-action="' + esc(action) + '"' + (disabled ? ' disabled' : '') + '>' + esc(label) + '</button>';
  }
  function badge(text) { return '<span class="games-badge">' + esc(text) + '</span>'; }
  function statePanel(kind, retry) {
    var copy = {
      loading: ['正在整理今日乐园', '马上就好。'],
      error: ['乐园没有载入', '原有记录没有变化。'],
      closed: ['这个功能还没开放', '管理员还没打开。'],
      denied: ['暂时进不了乐园', '当前账号没有访问权限。'],
      empty: ['今天还没人开局', '先来玩第一局。']
    }[kind] || ['暂时没有内容', '稍后再来看看。'];
    return '<section class="games-state" data-games-state="' + esc(kind) + '"><span class="games-state-mark" aria-hidden="true"></span><h2>' + esc(copy[0]) + '</h2><p>' + esc(copy[1]) + '</p>' + (retry ? button('重试', retry, 'primary') : '') + '</section>';
  }

  function dependencySummary(id) {
    var module = id === 'farm' ? G.CommonsFarm : G.CommonsParking;
    if (!module || typeof module.summary !== 'function') return '即将开放';
    try {
      var value = module.summary();
      if (value && typeof value === 'object') return value.label || value.summary || value.status || '已开放';
      return value || '已开放';
    } catch (error) {
      return '暂时不可用';
    }
  }

  /* 卡片整张只有一个链接，活动摘要不再嵌套人名链接。 */
  function activityHTML(activity) {
    if (!activity || typeof activity !== 'object') return esc(activity);
    return esc(activity.text);
  }

  function gameCard(game, index, active) {
    var dependency = game.id === 'farm' || game.id === 'parking' ? dependencySummary(game.id) : '今天 ' + game.today + ' 人参加';
    return '<a class="games-card' + (index < 2 ? ' is-featured' : '') + (game.id === active ? ' is-selected' : '') + '" href="' + safeUrl(game.route) + '"' + (game.id === active ? ' aria-current="location"' : '') + '>' +
      '<span class="games-card-cover"><img src="' + safeUrl(game.cover) + '" alt="" loading="lazy"><span>' + esc(dependency) + '</span></span>' +
      '<span class="games-card-copy"><span><h2>' + esc(game.name) + '</h2><p>' + esc(game.line) + '</p></span>' +
      '<div class="games-card-meta"><span>' + esc(game.online) + ' 人正在玩</span><span>' + esc(game.today) + ' 人今日参加</span></div>' +
      '<p class="games-activity">' + activityHTML(game.activity) + '</p></span></a>';
  }

  function weeklyHTML(rows) {
    if (!rows || !rows.length) return '<p class="games-empty-line">本周还没有竹子记录。</p>';
    return '<ol class="games-rank">' + rows.map(function (row, index) {
      return '<li><span>' + (index + 1) + '</span><strong>' + personLink(row.handle, row.displayName || row.name, row.level) + '</strong><b>+' + esc(row.earned) + '</b></li>';
    }).join('') + '</ol>';
  }

  function bambooBalance() {
    return G.CommonsEconomy && typeof G.CommonsEconomy.balance === 'function'
      ? G.CommonsEconomy.balance()
      : Number(SAMPLE.balance) || 0;
  }

  function announceSlot(position) {
    return G.CommonsAnnounce && typeof G.CommonsAnnounce.adSlot === 'function'
      ? G.CommonsAnnounce.adSlot(position)
      : '';
  }

  function sofasHTML(rows) {
    if (!rows || !rows.length) return '<p class="games-empty-line">今天还有沙发，认真回一句。</p>';
    return '<ul class="games-sofa-list">' + rows.map(function (row) {
      return '<li><span>' + esc(row.position) + '</span><div><strong>' + esc(row.title || row.displayName) + '</strong><small>' + personLink(row.handle, row.name || row.displayName, row.level) + ' · +' + esc(row.reward) + ' 竹子</small></div><time>' + esc(row.time || String(row.createdAt || '').slice(11, 16)) + '</time></li>';
    }).join('') + '</ul>';
  }

  function gamesPage(active) {
    active = active || '';
    var on = enabled();
    var toggle = '<label class="games-toggle"><span><strong>侧栏入口</strong><small>' + (on ? '已显示' : '已隐藏') + '</small></span><input type="checkbox" data-games-toggle' + (on ? ' checked' : '') + '><i aria-hidden="true"></i></label>';
    var cards = SAMPLE.games.map(function (game, index) { return gameCard(game, index, active); }).join('');
    var ad = announceSlot('games-foot');
    return '<main class="games-page" data-games-root data-games-view="' + esc(active || 'home') + '">' +
      '<div class="games-toolbar"><span class="games-toolbar-copy">签到、开局、看本周榜。</span>' + toggle + (isLive() ? '' : badge('示例')) + '</div>' +
      '<section class="games-layout"><div class="games-main"><section class="games-today"><div class="games-today-copy"><span>今天</span><h2>先签到，再选一局</h2><p>模拟考场还有一场，猜提示词有 ' + esc(SAMPLE.guesses.length) + ' 题。</p><div class="games-today-actions"><a class="button primary" href="#/exam">开始模拟考</a><a class="button tonal" href="#/guess">猜提示词</a></div></div>' +
      '<div class="games-checkin" data-games-checkin><div class="games-checkin-fallback"><strong>今日签到</strong><p>竹子 ' + esc(bambooBalance()) + '</p></div></div></section>' +
      '<section class="games-catalog" aria-labelledby="games-catalog-title"><header><h2 id="games-catalog-title">挑一局</h2><span>6 款</span></header><div class="games-card-wall">' + cards + '</div></section>' + gamePanel(active) + '</div>' +
      '<aside class="games-side"><section><header><h2>本周游戏榜</h2><span>只算获得</span></header><div data-games-rank>' + weeklyHTML(SAMPLE.weekly) + '</div></section>' +
      (active === 'sofas' ? '' : '<section><header><h2>今天的沙发</h2><a href="#/sofas">全部</a></header><div data-games-sofas>' + sofasHTML(SAMPLE.sofas) + '</div></section>') + '</aside></section>' +
      (ad ? '<section class="games-ad">' + /* safe: CommonsAnnounce.adSlot 返回已转义的广告卡 */ ad + '</section>' : '') + '</main>';
  }

  function directionButtons() {
    return ['全部', 'Agent', '提示词', '编程工具', '模型常识', '安全合规'].map(function (item, index) {
      return '<button type="button" class="chip' + (index === 0 ? ' selected' : '') + '" data-games-direction="' + esc(item) + '" aria-pressed="' + (index === 0 ? 'true' : 'false') + '">' + esc(item) + '</button>';
    }).join('');
  }

  function examSnapshot() {
    return read('exam-summary', SAMPLE.examSummary || { score: 0, correctCount: 0, total: 10, direction: '全部', mistakes: [] });
  }

  function examLeaderboardHTML() {
    var rows = (SAMPLE.examLeaderboard || []).slice(0, 5);
    if (!rows.length) return '<p class="games-empty-line">本周还没有成绩。</p>';
    return '<ol class="games-exam-rank">' + rows.map(function (row, index) {
      return '<li><span>' + (index + 1) + '</span><strong>' + personLink(row.handle, row.name, row.level) + '</strong><small>' + esc(row.direction) + '</small><b>' + esc(row.score) + '</b></li>';
    }).join('') + '</ol>';
  }

  function examMistakesHTML(summary) {
    var rows = (summary && summary.mistakes || []).slice(0, 3);
    if (!rows.length) return '<p class="games-empty-line">上次没有错题。</p>';
    return '<ol class="games-exam-mistakes">' + rows.map(function (prompt) { return '<li>' + esc(prompt) + '</li>'; }).join('') + '</ol>';
  }

  function examStartHTML() {
    var summary = examSnapshot();
    return '<section class="games-exam-start"><section class="games-exam-config"><div><h2>AI 工具实战卷</h2></div>' +
      '<dl class="games-exam-facts"><div><dt>题数</dt><dd>10 题</dd></div><div><dt>时长</dt><dd>10 分钟</dd></div><div><dt>题型</dt><dd>4 种</dd></div></dl>' +
      '<div><strong>分类优先</strong><div class="games-direction-list">' + directionButtons() + '</div></div>' + button('开始考试', 'exam-start', 'primary') + '</section>' +
      '<aside class="games-exam-overview"><section class="games-exam-last"><header><h2>上次成绩</h2><span>' + esc(summary.direction || '全部') + '</span></header><div><strong>' + esc(summary.score || 0) + '</strong><span>答对 ' + esc(summary.correctCount || 0) + ' / ' + esc(summary.total || 10) + '</span></div></section>' +
      '<section><header><h2>本周考场榜</h2><span>前 5</span></header>' + examLeaderboardHTML() + '</section>' +
      '<section><header><h2>错题回看</h2><a href="#/solved">问题库</a></header>' + examMistakesHTML(summary) + '</section></aside></section>';
  }

  function questionControl(question, answer) {
    answer = answer || [];
    if (question.kind === 'order') {
      var order = answer.length ? answer : question.options;
      return '<ol class="games-order">' + order.map(function (option, index) {
        return '<li><span>' + (index + 1) + '</span><strong>' + esc(option) + '</strong><div><button type="button" class="button ghost icon-only" data-games-order="up" data-index="' + index + '" aria-label="上移">↑</button><button type="button" class="button ghost icon-only" data-games-order="down" data-index="' + index + '" aria-label="下移">↓</button></div></li>';
      }).join('') + '</ol>';
    }
    var multiple = question.kind === 'multiple';
    return '<div class="games-options">' + question.options.map(function (option) {
      var checked = answer.indexOf(option) >= 0;
      return '<button type="button" class="games-option' + (checked ? ' is-selected' : '') + '" data-games-answer="' + encodeURIComponent(option) + '" aria-pressed="' + (checked ? 'true' : 'false') + '"><span aria-hidden="true">' + (multiple ? (checked ? '✓' : '＋') : (checked ? '●' : '○')) + '</span><strong>' + esc(option) + '</strong></button>';
    }).join('') + '</div>';
  }

  function formatClock(seconds) {
    var safe = Math.max(0, Number(seconds) || 0);
    var minutes = Math.floor(safe / 60);
    var rest = safe % 60;
    return String(minutes).padStart(2, '0') + ':' + String(rest).padStart(2, '0');
  }

  function parseServerTime(value) {
    if (typeof value !== 'string') return Number(value) || 0;
    return Date.parse(value.replace(/(\.\d{3})\d+Z$/, '$1Z'));
  }

  function examRunningHTML() {
    var exam = state.exam;
    var question = exam.questions[exam.current];
    var answer = exam.answers[String(question.slot)] || [];
    return '<section class="games-exam-running"><header><div><span>第 ' + esc(exam.current + 1) + ' / ' + esc(exam.questions.length) + ' 题</span><strong>' + esc(question.direction) + ' · ' + esc(question.kind === 'single' ? '单选' : question.kind === 'multiple' ? '多选' : question.kind === 'boolean' ? '判断' : '排序') + '</strong></div><time data-games-timer role="timer" aria-live="off" aria-label="剩余时间 ' + esc(formatClock(exam.remainingSeconds)) + '">' + esc(formatClock(exam.remainingSeconds)) + '</time><span class="sr-only" role="status" aria-live="polite" data-games-timer-status></span></header>' +
      '<div class="games-exam-progress">' + exam.questions.map(function (item, index) { return '<i class="' + (exam.answers[String(item.slot)] ? 'is-done ' : '') + (index === exam.current ? 'is-current' : '') + '"></i>'; }).join('') + '</div>' +
      '<article class="games-question"><h2 tabindex="-1">' + esc(question.prompt) + '</h2>' + questionControl(question, answer) + '</article>' +
      '<footer><span data-games-exam-error role="alert">' + esc(state.error) + '</span><div>' + button('上一题', 'exam-prev', 'ghost', exam.current === 0) + (exam.current === exam.questions.length - 1 ? button('交卷', 'exam-submit', 'primary') : button('下一题', 'exam-next', 'primary')) + '</div></footer></section>';
  }

  function examResultHTML() {
    var exam = state.exam;
    return '<section class="games-exam-result"><div class="games-score"><span>本次成绩</span><strong>' + esc(exam.score) + '</strong><small>' + esc(exam.correctCount) + ' / ' + exam.questions.length + ' 题正确</small><div>' + button('分享成绩', 'exam-share', 'tonal') + button('再考一次', 'exam-reset', '') + '</div></div>' +
      '<div class="games-review"><h2>错题解析</h2>' + exam.questions.map(function (question, index) {
        if (question.correct) return '';
        return '<article><span>第 ' + (index + 1) + ' 题</span><h3>' + esc(question.prompt) + '</h3><p>' + esc(question.explanation) + '</p><a href="' + safeUrl(question.source && question.source.route || '#/solved') + '">查看' + esc(question.source && question.source.label || '原文') + '</a></article>';
      }).join('') + (exam.correctCount === exam.questions.length ? '<p class="games-empty-line">全部答对，没有错题。</p>' : '') + '</div></section>';
  }

  function guessPanel() {
    var stored = read('guess.v2.' + today(), null);
    state.guess = stored && Array.isArray(stored.items) && stored.items.length === SAMPLE.guesses.length
      ? stored
      : { day: today(), streak: 0, items: SAMPLE.guesses.map(function (item) { return Object.assign({}, item); }) };
    return '<div data-games-guess-list>' + guessHTML() + '</div>';
  }

  function guessResultHTML(item) {
    var prompt = item.correctPrompt || item.answer || '正确提示词由服务端返回';
    var difference = item.difference || item.explanation || '关键约束与模型输出的结构最吻合。';
    return '<div class="games-guess-result"><strong>' + (item.correct ? '答对了 · +' + esc(item.reward || 0) + ' 竹子' : '这题没猜中') + '</strong>' +
      '<p><span>正确提示词</span>' + esc(prompt) + '</p><small>差在哪：' + esc(difference) + '</small></div>';
  }

  function guessHTML() {
    var data = state.guess;
    return '<section class="games-guess-board"><header><div><span>今日进度</span><strong>' + data.items.filter(function (item) { return item.attempted; }).length + ' / ' + esc(data.items.length) + '</strong></div><div><span>当前连对</span><strong>' + esc(data.streak || 0) + '</strong></div></header>' +
      '<div class="games-guess-list">' + data.items.map(function (item) {
        return '<article class="games-guess-item' + (item.attempted ? (item.correct ? ' is-correct' : ' is-wrong') : '') + '" data-games-guess-item="' + esc(item.slot) + '"' + (item.attempted ? ' tabindex="-1"' : '') + '><div class="games-guess-prompt"><span>第 ' + esc(item.slot) + ' 题 · 模型输出</span><p>' + esc(item.output) + '</p></div><div class="games-guess-options" role="group" aria-label="第 ' + esc(item.slot) + ' 题提示词选项">' + item.options.map(function (option) {
          var value = typeof option === 'object' ? option.id : option;
          var label = typeof option === 'object' ? option.label : option;
          var isAnswer = item.attempted && (value === item.answer || label === item.answer || value === item.correctPrompt || label === item.correctPrompt);
          return '<button type="button" class="games-guess-option' + (item.choice === value ? ' is-chosen' : '') + (isAnswer ? ' is-answer' : '') + '" data-games-guess="' + encodeURIComponent(value) + '" data-slot="' + esc(item.slot) + '" aria-pressed="' + (item.choice === value) + '"' + (item.attempted ? ' disabled' : '') + '>' + esc(label) + '</button>';
        }).join('') + '</div>' + (item.attempted ? guessResultHTML(item) : '') + '</article>';
      }).join('') + '</div></section>';
  }

  function drawPanel() {
    var drawn = read('fortune.' + today(), null);
    return '<section class="games-fortune"><img src="assets/game/games-fortune.webp" alt="熊猫抱着今天的签"><div data-games-fortune>' + (drawn ? fortuneHTML(drawn) : '<span>' + esc(today().slice(5).replace('-', '.')) + '</span><h3>今天会抽到什么？</h3><p>签文不影响等级和权益。</p>' + button('抽一签', 'draw', 'primary')) + '</div></section>';
  }

  function fortuneHTML(fortune) {
    return '<span>' + esc(today().slice(5).replace('-', '.')) + '</span><h3>' + esc(fortune.text) + '</h3><p>今日签已收好，明天再来。</p><div>' + button('分享签文', 'draw-share', 'tonal') + '</div>';
  }

  function sofaPanel() {
    return '<section class="games-sofa-board"><header><span>今日</span><strong>' + SAMPLE.sofas.length + ' 张</strong><small>回复至少 15 字</small></header><div data-games-sofas>' + sofasHTML(SAMPLE.sofas) + '</div><a class="button primary" href="#/threads">去看新帖</a></section>';
  }

  function gamePanel(active) {
    var names = { exam: '模拟考场', guess: '猜提示词', draw: '熊猫抽签', sofas: '今天的沙发' };
    if (!names[active]) return '';
    var body = active === 'exam' ? '<div class="games-exam-shell" data-games-exam-shell>' + examStartHTML() + '</div>' :
      active === 'guess' ? guessPanel() : active === 'draw' ? drawPanel() : sofaPanel();
    return '<section class="games-active games-' + esc(active) + '-page" data-games-active tabindex="-1" aria-labelledby="games-active-title">' +
      '<header><h2 id="games-active-title">' + esc(names[active]) + '</h2><a class="button ghost small" href="#/games">收起</a></header>' + body + '</section>';
  }

  function renderExam(preferred) {
    var shell = state.root && state.root.querySelector('[data-games-exam-shell]');
    if (!shell || !state.exam) return;
    var active = document.activeElement;
    var keep = preferred || (active && active.getAttribute ? {
      answer: active.getAttribute('data-games-answer'),
      order: active.getAttribute('data-games-order'),
      index: active.getAttribute('data-index'),
      action: active.getAttribute('data-games-action')
    } : null);
    shell.innerHTML = state.exam.submittedAt ? examResultHTML() : examRunningHTML();
    var next = null;
    if (keep && keep.answer) next = shell.querySelector('[data-games-answer="' + keep.answer + '"]');
    if (!next && keep && keep.order) next = Array.prototype.find.call(shell.querySelectorAll('[data-games-order="' + keep.order + '"]'), function (node) { return node.getAttribute('data-index') === keep.index; });
    if (!next && keep && keep.action) next = shell.querySelector('[data-games-action="' + keep.action + '"]');
    if (!next && preferred && preferred.heading) next = shell.querySelector('.games-question h2');
    if (next && next.focus) next.focus({ preventScroll: true });
    startTimer();
  }

  function shuffle(values) {
    var copy = values.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var hold = copy[i]; copy[i] = copy[j]; copy[j] = hold;
    }
    return copy;
  }

  function sampleExam(direction) {
    var preferred = SAMPLE.questions.filter(function (question) { return direction === '全部' || question.direction === direction; });
    var rest = direction === '全部' ? [] : SAMPLE.questions.filter(function (question) { return question.direction !== direction; });
    var pool = direction === '全部' ? shuffle(preferred) : shuffle(preferred).concat(shuffle(rest));
    var questions = pool.slice(0, 10).map(function (question, index) {
      var copy = Object.assign({}, question, { slot: index + 1, options: shuffle(question.options) });
      return copy;
    });
    var answers = {};
    questions.forEach(function (question) { if (question.kind === 'order') answers[String(question.slot)] = question.options.slice(); });
    return { id: 'sample-exam-' + Date.now(), direction: direction, questions: questions, answers: answers, current: 0, startedAt: Date.now(), expiresAt: Date.now() + 600000, remainingSeconds: 600, submittedAt: null, sample: true };
  }

  function startExam() {
    var selected = state.root.querySelector('[data-games-direction][aria-pressed="true"]');
    var direction = selected ? selected.dataset.gamesDirection : '全部';
    state.error = '';
    if (!isLive()) {
      state.exam = sampleExam(direction);
      renderExam();
      return;
    }
    var shell = state.root.querySelector('[data-games-exam-shell]');
    shell.innerHTML = statePanel('loading');
    G.CommonsAPI.post('/games/exams', { direction: direction === '全部' ? null : ({ Agent: 'agent', '提示词': 'prompt', '编程工具': 'coding', '模型常识': 'model', '安全合规': 'safety' })[direction] }, { idempotencyKey: G.CommonsAPI.newIdempotencyKey() }).then(function (response) {
      state.exam = Object.assign(response.data, { answers: {}, current: 0 });
      state.exam.questions.forEach(function (question) { if (question.kind === 'order') state.exam.answers[String(question.slot)] = question.options.slice(); });
      renderExam();
    }).catch(function () { shell.innerHTML = statePanel('error', 'exam-reset'); });
  }

  function startTimer() {
    if (state.timer) clearInterval(state.timer);
    if (!state.exam || state.exam.submittedAt) return;
    state.timer = setInterval(function () {
      if (!state.exam || state.exam.submittedAt) return;
      state.exam.remainingSeconds = Math.max(0, Math.ceil((parseServerTime(state.exam.expiresAt) - Date.now()) / 1000));
      if (state.exam.sample) state.exam.remainingSeconds = Math.max(0, Math.ceil((state.exam.expiresAt - Date.now()) / 1000));
      var timer = state.root && state.root.querySelector('[data-games-timer]');
      if (timer) {
        timer.textContent = formatClock(state.exam.remainingSeconds);
        timer.setAttribute('aria-label', '剩余时间 ' + formatClock(state.exam.remainingSeconds));
      }
      if (state.exam.remainingSeconds === 60 || state.exam.remainingSeconds === 10) {
        var status = state.root && state.root.querySelector('[data-games-timer-status]');
        if (status) status.textContent = '考试还剩 ' + state.exam.remainingSeconds + ' 秒';
      }
      if (state.exam.remainingSeconds <= 0) {
        clearInterval(state.timer); state.timer = null; state.error = '时间到，这份试卷不能再提交。'; renderExam();
      }
    }, 1000);
  }

  function chooseAnswer(value) {
    var question = state.exam.questions[state.exam.current];
    var key = String(question.slot);
    var answer = state.exam.answers[key] || [];
    if (question.kind === 'multiple') {
      state.exam.answers[key] = answer.indexOf(value) >= 0 ? answer.filter(function (item) { return item !== value; }) : answer.concat(value);
    } else state.exam.answers[key] = [value];
    renderExam();
  }

  function moveOrder(direction, index) {
    var question = state.exam.questions[state.exam.current];
    var key = String(question.slot);
    var list = (state.exam.answers[key] || question.options).slice();
    var target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= list.length) return;
    var hold = list[index]; list[index] = list[target]; list[target] = hold;
    state.exam.answers[key] = list;
    renderExam();
  }

  function rememberExam() {
    if (!state.exam) return;
    write('exam-summary', {
      score: Number(state.exam.score) || 0,
      correctCount: Number(state.exam.correctCount) || 0,
      total: state.exam.questions.length,
      direction: state.exam.direction || '全部',
      completedAt: state.exam.submittedAt || new Date().toISOString(),
      mistakes: state.exam.questions.filter(function (question) { return question.correct === false; }).map(function (question) { return question.prompt; }).slice(0, 3)
    });
  }

  function submitExam() {
    var missing = state.exam.questions.some(function (question) { return !state.exam.answers[String(question.slot)] || !state.exam.answers[String(question.slot)].length; });
    if (missing) { state.error = '还有题目没答完。'; renderExam(); return; }
    if (state.exam.remainingSeconds <= 0) { state.error = '时间到，这份试卷不能再提交。'; renderExam(); return; }
    if (!isLive() || state.exam.sample) {
      var correct = 0;
      state.exam.questions.forEach(function (question) {
        var answer = state.exam.answers[String(question.slot)];
        question.response = answer;
        question.correct = question.kind === 'order' ? answer.join('\u0000') === question.answer.join('\u0000') : answer.slice().sort().join('\u0000') === question.answer.slice().sort().join('\u0000');
        correct += question.correct ? 1 : 0;
      });
      state.exam.correctCount = correct;
      state.exam.score = Math.round(correct * 100 / state.exam.questions.length);
      state.exam.submittedAt = new Date().toISOString();
      rememberExam();
      renderExam();
      return;
    }
    var shell = state.root.querySelector('[data-games-exam-shell]');
    shell.innerHTML = statePanel('loading');
    G.CommonsAPI.post('/games/exams/' + encodeURIComponent(state.exam.id) + '/submit', { answers: state.exam.answers }, { idempotencyKey: G.CommonsAPI.newIdempotencyKey() }).then(function (response) {
      state.exam = Object.assign(response.data, { answers: state.exam.answers, current: state.exam.current });
      rememberExam();
      renderExam();
    }).catch(function (error) {
      state.error = error && error.code === 'game_expired' ? '时间到，这份试卷不能再提交。' : '交卷失败，答案还在。';
      renderExam();
    });
  }

  function share(title, body) {
    if (G.CommonsShare && typeof G.CommonsShare.open === 'function') {
      G.CommonsShare.open({ title: title, body: body, visibility: { scope: 'public' }, format: 'portrait' });
    }
  }

  function answerGuess(slot, value) {
    var item = state.guess.items.find(function (row) { return Number(row.slot) === Number(slot); });
    if (!item || item.attempted) return;
    if (isLive() && typeof item.options[0] === 'object') {
      G.CommonsAPI.post('/games/guess/' + Number(slot), { option_id: value }, { idempotencyKey: G.CommonsAPI.newIdempotencyKey() }).then(function (response) {
        item.attempted = true; item.choice = value; item.correct = response.data.correct; item.reward = response.data.reward;
        item.answer = response.data.correct_prompt || response.data.answer || item.answer;
        item.difference = response.data.difference || response.data.explanation || item.difference;
        state.guess.streak = response.data.streak;
        write('guess.v2.' + today(), state.guess);
        state.root.querySelector('[data-games-guess-list]').innerHTML = guessHTML();
        var result = state.root.querySelector('[data-games-guess-item="' + Number(slot) + '"]');
        if (result) result.focus({ preventScroll: true });
      }).catch(function (error) { say(liveFailure(error)); });
      return;
    }
    item.attempted = true; item.choice = value; item.correct = value === item.answer;
    state.guess.streak = item.correct ? Number(state.guess.streak || 0) + 1 : 0;
    item.reward = item.correct ? Math.min(8, 2 + state.guess.streak) : 0;
    write('guess.v2.' + today(), state.guess);
    state.root.querySelector('[data-games-guess-list]').innerHTML = guessHTML();
    var result = state.root.querySelector('[data-games-guess-item="' + Number(slot) + '"]');
    if (result) result.focus({ preventScroll: true });
  }

  function liveFailure(error) {
    return (error && (error.status === 501 || error.code === 'capability_unavailable')) ? '这个功能还没开放' : ((error && error.message) || '没有完成，请稍后再试');
  }
  function say(message) {
    if (G.Commons && typeof G.Commons.toast === 'function') G.Commons.toast(message);
  }

  function togglePlayground(input) {
    var on = !!input.checked;
    if (isLive()) {
      // 真实模式：服务器记下来才算数；失败就把开关拨回去。
      input.disabled = true;
      G.CommonsAPI.post('/games/preferences', { playground_enabled: on }, { idempotencyKey: G.CommonsAPI.newIdempotencyKey() }).then(function () {
        input.disabled = false;
        applyPlayground(input, on);
      }).catch(function (error) {
        input.disabled = false;
        input.checked = !on;
        say(liveFailure(error));
      });
      return;
    }
    applyPlayground(input, on);
  }

  function applyPlayground(input, on) {
    write('playground-enabled', on);
    module.nav = on ? NAV : [];
    var label = input.closest('.games-toggle').querySelector('small');
    if (label) label.textContent = on ? '已显示' : '已隐藏';
    G.dispatchEvent(new CustomEvent('commons:games-preference', { detail: { enabled: on } }));
  }

  function drawFortune() {
    if (isLive()) {
      G.CommonsAPI.post('/games/draw', {}, { idempotencyKey: G.CommonsAPI.newIdempotencyKey() }).then(function (response) {
        write('fortune.' + today(), response.data);
        state.root.querySelector('[data-games-fortune]').innerHTML = fortuneHTML(response.data);
      }).catch(function (error) { say(liveFailure(error)); });
      return;
    }
    var seed = today().split('').reduce(function (sum, char) { return sum + char.charCodeAt(0); }, 0);
    var fortune = SAMPLE.fortunes[seed % SAMPLE.fortunes.length];
    write('fortune.' + today(), fortune);
    state.root.querySelector('[data-games-fortune]').innerHTML = fortuneHTML(fortune);
  }

  function onClick(event) {
    var direction = event.target.closest('[data-games-direction]');
    if (direction) {
      state.root.querySelectorAll('[data-games-direction]').forEach(function (item) { var selected = item === direction; item.classList.toggle('selected', selected); item.setAttribute('aria-pressed', String(selected)); });
      return;
    }
    var answer = event.target.closest('[data-games-answer]');
    if (answer) { chooseAnswer(decodeURIComponent(answer.dataset.gamesAnswer)); return; }
    var order = event.target.closest('[data-games-order]');
    if (order) { moveOrder(order.dataset.gamesOrder, Number(order.dataset.index)); return; }
    var guess = event.target.closest('[data-games-guess]');
    if (guess) { answerGuess(Number(guess.dataset.slot), decodeURIComponent(guess.dataset.gamesGuess)); return; }
    var action = event.target.closest('[data-games-action]');
    if (!action) return;
    var name = action.dataset.gamesAction;
    if (name === 'exam-start') startExam();
    else if (name === 'exam-prev') { state.exam.current = Math.max(0, state.exam.current - 1); renderExam({ heading: true }); }
    else if (name === 'exam-next') { state.exam.current = Math.min(state.exam.questions.length - 1, state.exam.current + 1); renderExam({ heading: true }); }
    else if (name === 'exam-submit') submitExam();
    else if (name === 'exam-reset') { state.exam = null; state.error = ''; state.root.querySelector('[data-games-exam-shell]').innerHTML = examStartHTML(); }
    else if (name === 'exam-share') share('模拟考成绩 ' + state.exam.score + ' 分', '答对 ' + state.exam.correctCount + '/' + state.exam.questions.length + ' 题');
    else if (name === 'draw') drawFortune();
    else if (name === 'draw-share') { var fortune = read('fortune.' + today(), {}); share('熊猫每日签', fortune.text || ''); }
  }

  function loadHome() {
    if (!isLive()) return;
    G.CommonsAPI.get('/games/home').then(function (response) {
      var data = response.data;
      var rank = state.root && state.root.querySelector('[data-games-rank]');
      var sofas = state.root && state.root.querySelectorAll('[data-games-sofas]');
      if (rank) rank.innerHTML = weeklyHTML(data.leaderboard);
      if (sofas) sofas.forEach(function (node) { node.innerHTML = sofasHTML(data.sofas); });
    }).catch(function (error) {
      if (error && (error.status === 501 || error.code === 'capability_unavailable') && state.root) {
        state.root.innerHTML = statePanel('closed');
      }
    });
  }

  function loadGuess() {
    if (!isLive()) return;
    G.CommonsAPI.get('/games/guess/today').then(function (response) {
      var library = SAMPLE.promptLibrary || {};
      var guide = SAMPLE.liveGuessGuide || {};
      var items = (response.data.items || []).map(function (item) {
        var answer = guide[item.output] || {};
        return Object.assign({}, item, {
          options: (item.options || []).map(function (option) {
            return Object.assign({}, option, { label: library[option.id] || option.label });
          }),
          answer: answer.answer,
          correctPrompt: library[answer.answer] || '',
          difference: answer.difference || ''
        });
      });
      state.guess = Object.assign(response.data, { items: items, streak: 0 });
      var target = state.root && state.root.querySelector('[data-games-guess-list]');
      if (target) target.innerHTML = guessHTML();
    }).catch(function () {});
  }

  function mount() {
    var root = document.querySelector('[data-games-root]');
    if (!root) return;
    if (state.bound) destroy();
    state.root = root;
    state.controller = new AbortController();
    root.addEventListener('click', onClick);
    root.addEventListener('change', function (event) { if (event.target.matches('[data-games-toggle]')) togglePlayground(event.target); }, { signal: state.controller.signal });
    state.bound = true;
    var checkin = root.querySelector('[data-games-checkin]');
    if (checkin && G.CommonsEconomy && typeof G.CommonsEconomy.checkin === 'function') G.CommonsEconomy.checkin(checkin);
    if (G.CommonsEconomy && typeof G.CommonsEconomy.onChange === 'function') {
      state.offBalance = G.CommonsEconomy.onChange(function (value) {
        var node = state.root && state.root.querySelector('[data-games-balance]');
        if (node) node.textContent = String(value);
      });
    }
    loadHome();
    if (root.dataset.gamesView === 'guess') loadGuess();
    else if (root.dataset.gamesView === 'exam' && state.exam && !state.exam.submittedAt) renderExam();
    var active = root.querySelector('[data-games-active]');
    if (active) state.jump = requestAnimationFrame(function () {
      state.jump = null;
      if (state.root === root) active.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
  }

  function destroy() {
    if (state.jump) cancelAnimationFrame(state.jump);
    state.jump = null;
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    if (state.root) state.root.removeEventListener('click', onClick);
    if (state.controller) state.controller.abort();
    if (state.offBalance) state.offBalance();
    state.offBalance = null;
    state.controller = null; state.root = null; state.bound = false;
  }

  var module = {
    routes: { games: gamesPage, exam: function () { return gamesPage('exam'); }, guess: function () { return gamesPage('guess'); }, draw: function () { return gamesPage('draw'); }, sofas: function () { return gamesPage('sofas'); } },
    hub: ['games', 'exam', 'guess', 'draw', 'sofas'],
    nav: enabled() ? NAV : [],
    icons: { dice: DICE },
    enabled: enabled,
    mount: mount,
    destroy: destroy
  };
  G.CommonsGames = module;
  (G.CommonsPages = G.CommonsPages || []).push(module);
  if (G.CommonsLinks && typeof G.CommonsLinks.provide === 'function') {
    G.CommonsLinks.provide('game', function (handle) {
      var count = SAMPLE.weekly.concat(SAMPLE.sofas).filter(function (row) { return row.handle === handle; }).length;
      return count ? { label: '乐园记录', href: '#/games', count: count, icon: 'dice' } : null;
    });
  }
})();


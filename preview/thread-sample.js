/* R13 THREAD-1 · 合成讨论串。形状即 BE-1 reply 契约。处处示例。 */
(function () {
  'use strict';

  var PEOPLE = [
    { id: 'me', self: true, name: '我', level: 2, levelName: '队员' },
    { id: 'p-ye', handle: 'lin-qi', name: '林栖', level: 1, levelName: '新队员' },
    { id: 'p-wen', handle: 'chen-mo', name: '陈墨', level: 3, levelName: '骨干' },
    { id: 'p-cheng', handle: 'yu-lan', name: '余岚', level: 4, levelName: '领航员' },
    { id: 'p-lu', handle: 'song-yuan', name: '松原', level: 5, levelName: '先锋' }
  ];

  var BY = {};
  PEOPLE.forEach(function (p) { BY[p.id] = p; });

  function iso(min) {
    return new Date(Date.UTC(2026, 9, 25, 1, min, 0)).toISOString();
  }

  function quoteOf(parent, excerpt) {
    if (!parent) return null;
    var a = BY[parent.authorId] || {};
    var text = excerpt != null ? excerpt : String(parent.body || '').replace(/\s+/g, ' ');
    return {
      id: parent.id,
      authorId: parent.authorId,
      authorName: a.name || '',
      excerpt: text.slice(0, 40)
    };
  }

  function msg(id, authorId, body, min, extra) {
    extra = extra || {};
    var row = {
      id: id,
      authorId: authorId,
      body: body,
      createdAt: iso(min),
      editedAt: extra.editedAt || null,
      reply_to: extra.reply_to || null,
      thread_root: extra.thread_root || id,
      quote: extra.quote || null,
      status: extra.status || 'ok',
      reactions: extra.reactions || {},
      mine: extra.mine || {}
    };
    return row;
  }

  var FILL = [
    '直接写 JSON 文件，最省事。',
    'SQLite 一张表，按任务 id 查。',
    '我放在 git 分支上，每步一个提交。',
    '小任务用 markdown 清单就够了。',
    '别忘了把失败原因也记下来。',
    '检查点带上时间，排查时省很多事。',
    '我让 Agent 每步先读一遍清单再动手。',
    '先跑测试，过了再写检查点。',
    '多个 Agent 并行时各写各的文件，别抢锁。',
    '有现成的模板吗？想抄一份。'
  ];

  var list = [];
  var byId = {};

  function add(row) {
    list.push(row);
    byId[row.id] = row;
    return row;
  }

  function reply(id, authorId, parentId, body, min, extra) {
    extra = extra || {};
    var parent = byId[parentId];
    extra.reply_to = parentId;
    extra.thread_root = parent ? (parent.thread_root || parent.id) : parentId;
    if (!extra.quote) extra.quote = quoteOf(parent, extra.excerpt);
    return add(msg(id, authorId, body, min, extra));
  }

  var root = add(msg('r-root', 'p-cheng', '先抛个砖：我把任务拆成小步，每做完一步写一行进度，断了就从最后一行接着跑。', 8, {
    reactions: { up: 9, useful: 3, spark: 2 },
    mine: { up: true }
  }));

  reply('r-g1', 'p-ye', 'r-root', '我也是这么做的，进度写在仓库里的 progress.md。', 12);
  reply('r-g2', 'p-ye', 'r-root', '关键是每一步都能重跑：写文件前先看它在不在。', 13);
  reply('r-g3', 'p-ye', 'r-root', '日志里记下每步的输入，重跑时对得上。', 14);

  reply('r-me1', 'me', 'r-root', '同意。我还会让它每 20 分钟总结一次进度，上下文满了也不怕。', 16, {
    reactions: { useful: 2 }
  });

  var gone = add(msg('r-gone', 'p-ye', '（已删除）', 18, { status: 'deleted' }));
  reply('r-after', 'p-wen', 'r-gone', '我也遇到过：续跑时最怕它把做完的步骤再做一遍。', 20);

  add(msg('r-hid-other', 'p-ye', '（审核中）', 22, { status: 'hidden' }));
  add(msg('r-hid-me', 'me', '我贴了一段内部日志，审核过了大家再看。', 24, { status: 'hidden' }));

  add(msg('r-ed', 'p-lu', '补充：任务清单放在仓库里，别只留在对话上下文里。', 26, {
    editedAt: iso(31)
  }));

  add(msg('r-code', 'me', '我的检查点就三个字段：`{ step, input_hash, output_path }`，断了按 step 找回。写法见 https://example.com/checkpoint 。', 28, {
    reactions: { learned: 2, reproduced: 1 }
  }));

  add(msg('r-at', 'p-lu', '@我 每 20 分钟总结这个好，能把提示词放到提示词库吗？', 33, {
    reactions: { up: 4, spark: 1 },
    reply_to: 'r-me1',
    thread_root: 'r-root',
    quote: quoteOf(byId['r-me1'])
  }));

  add(msg('r-hot', 'p-wen', '总结一下：步骤能重跑、进度写到盘上、定时自检。三件事做齐，断了也不慌。', 36, {
    reactions: { up: 18, useful: 7, spark: 5, learned: 4, question: 2, favorite: 3, reproduced: 1 },
    mine: { spark: true }
  }));

  var deep = add(msg('r-deep', 'p-cheng', '说个反例：我上周断了五次，每次原因都不一样。', 40, {
    thread_root: 'r-deep'
  }));
  reply('r-d1', 'me', 'r-deep', '第一次是什么原因？', 41);
  reply('r-d2', 'p-ye', 'r-d1', '多半是额度用完了。', 42);
  reply('r-d3', 'p-wen', 'r-d2', '也可能是网络断了。', 43);
  reply('r-d4', 'p-lu', 'r-d3', '网络那次我也碰到过，日志里能看出来。', 44);
  reply('r-d5', 'p-ye', 'r-d4', '那就先看日志，再决定怎么续。', 45);

  var fat = add(msg('r-fat', 'p-lu', '大家都用什么存检查点？', 50));
  var i;
  for (i = 1; i <= 12; i += 1) {
    reply('r-fat-' + i, PEOPLE[i % PEOPLE.length].id, 'r-fat', FILL[i % FILL.length], 50 + i);
  }

  add(msg('r-send', 'me', '我整理一份模板发到知识库。', 80, { status: 'sending' }));
  add(msg('r-fail', 'me', '模板链接晚点补上。', 81, { status: 'failed' }));

  var t = 90;
  while (list.length < 60) {
    var p = PEOPLE[list.length % PEOPLE.length];
    var parent = list.length % 5 === 0 ? root : (list.length % 3 === 0 ? fat : null);
    var body = FILL[list.length % FILL.length] + (list.length % 7 === 0 ? ' @林栖' : '');
    if (parent) {
      reply('r-fill-' + list.length, p.id, parent.id, body, t);
    } else {
      add(msg('r-fill-' + list.length, p.id, body, t));
    }
    t += 2;
  }

  function simulatedReply(st, parent, person) {
      var row = {
        id: 'sim-' + Date.now(),
        authorId: 'p-ye',
        body: parent ? ('@' + person(st, st.me.id).name + ' 这个办法我也试试。') : '我也来说一句。',
        createdAt: new Date().toISOString(),
        reply_to: parent ? parent.id : null,
        thread_root: parent ? (parent.thread_root || parent.id) : null,
        quote: parent ? {
          id: parent.id,
          authorId: parent.authorId,
          authorName: person(st, parent.authorId).name,
          excerpt: String(parent.body || '').slice(0, 40)
        } : null,
        status: 'ok',
        reactions: {},
        mine: {}
      };
    return row;
  }

  window.COMMONS_THREAD_SAMPLE = {
    typingAuthorId: 'p-ye',
    simulatedReply: simulatedReply,
    post: {
      id: 'post-demo',
      title: '长任务跑到一半断了，怎么让 Agent 接着干？',
      body: '跑了两个小时的重构，中途断了，重开以后它又从头做起。大家都怎么做断点续跑？',
      authorId: 'p-cheng',
      createdAt: iso(6),
      reactions: { up: 12, useful: 4, spark: 3 },
      usefulCount: 4
    },
    me: PEOPLE[0],
    people: PEOPLE,
    messages: list
  };
})();

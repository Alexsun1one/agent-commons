/* R13 TALK-1 · 讲堂合成数据。
   形状 commons.talk.review/1 就是以后真实转录管线要输出的样子。
   synthetic 为 true。consent.state 固定 not_recorded：内测不录、不转写、不外发。
   translation.en 是预置例句，不是模型译文。媒体 src 用 sample: 前缀，页面运行时再合成音频。 */
(function () {
  'use strict';

  function line(id, t, end, speakerId, text, en) {
    return { id: id, t: t, end: end, speakerId: speakerId, text: text, translation: { en: en } };
  }

  function op(id, t, clock, actor, type, target, patch) {
    return { id: id, t: t, actor: actor, clock: clock, type: type, target: target, patch: patch };
  }

  function consent(speakers) {
    return {
      purpose: ['class_replay', 'transcript'],
      training: 'refused',
      state: 'not_recorded',
      reason: '内测不录制。逐字稿、章节和英文都是预置示例，不是模型生成。',
      captured: [],
      speakers: speakers
    };
  }

  window.COMMONS_TALKS_SAMPLE = {
    schema: 'commons.talk.review/1',
    synthetic: true,
    durationCaps: [
      { id: 'L3', label: 'L3 骨干 · 讨论室', minutes: 60 },
      { id: 'L4', label: 'L4 领航员 · 舞台', minutes: 120 },
      { id: 'lecturer', label: '讲师或主持人', minutes: 180 }
    ],
    me: { id: 'lin', handle: 'yu-lan', name: '余岚', level: 4, levelName: '领航员', contribution: 860, capId: 'L4' },
    directions: [
      { id: 'agent', label: '智能体', cat: 1 },
      { id: 'code', label: '编程', cat: 3 },
      { id: 'model', label: '模型', cat: 2 },
      { id: 'product', label: '产品', cat: 5 }
    ],
    boardTemplates: [
      { id: 'flow', label: '流程' },
      { id: 'compare', label: '对比' },
      { id: 'timeline', label: '时间线' },
      { id: 'quad', label: '四象限' },
      { id: 'layers', label: '分层架构' },
      { id: 'triad', label: '问题 → 方法 → 证据' },
      { id: 'mind', label: '思维导图起点' },
      { id: 'vote', label: '投票便签' },
      { id: 'knowledge', label: '知识卡引用' },
      { id: 'code', label: '代码块卡' }
    ],
    speakers: [
      { id: 'lin', handle: 'yu-lan', name: '余岚', level: 4, levelName: '领航员', contribution: 860, focus: '把课讲到能复现', team: { id: 'agent-education-alliance', name: 'Agent 教育联盟' } },
      { id: 'zhou', handle: 'chen-mo', name: '陈墨', level: 3, levelName: '骨干', contribution: 420, focus: '把改动拆成步骤', team: { id: 'open-orchestration', name: '开源编排计划' } },
      { id: 'xu', handle: 'song-yuan', name: '松原', level: 5, levelName: '先锋', contribution: 710, focus: '模型回答跑偏时先改哪一层', team: { id: 'zero-one-lab', name: '零壹 Agent 实验室' } },
      { id: 'shen', handle: 'lin-qi', name: '林栖', level: 1, levelName: '新队员', contribution: 390, focus: '把想法收成下一场' }
    ],
    upcoming: [
      { id: 'next-repro', title: '用你自己的项目走一遍验收清单', speakerId: 'lin', when: '2026-11-05', time: '20:00', note: '公开课 · 报名在房间列表' },
      { id: 'next-model', title: '模型阅读会：一个跑偏的回答', speakerId: 'xu', when: '2026-11-10', time: '12:30', note: '公开课 · 报名在房间列表' }
    ],
    talks: [
      {
        id: 'accept',
        kind: 'lecture',
        featured: true,
        direction: 'agent',
        title: '怎么把一场公开课讲到能复现',
        summary: '不讲灵感。讲完如果别人做不出来，这课就没讲完。',
        speakerId: 'lin',
        duration: 84,
        watched: 186,
        reproduced: 24,
        learn: ['把「讲完」写成听众能看见的结果', '把步骤写成换一台电脑也能走', '把证据留进回执，而不是只留在口头'],
        media: { kind: 'audio', src: 'sample:talk:accept' },
        cover: 'assets/samples/talk-accept-checklist.webp',
        consent: consent([
          { id: 'lin', role: 'host', consent: 'not_asked' },
          { id: 'zhou', role: 'speaker', consent: 'not_asked' },
          { id: 'xu', role: 'speaker', consent: 'not_asked' },
          { id: 'shen', role: 'speaker', consent: 'not_asked' }
        ]),
        chapters: [
          { id: 'c1', t: 0, title: '先写失败的样子' },
          { id: 'c2', t: 21, title: '换一台电脑也能走' },
          { id: 'c3', t: 42, title: '证据写进回执' },
          { id: 'c4', t: 63, title: '留一个最小复现' }
        ],
        transcript: [
          line('a1', 0, 7, 'lin', '先把「讲完了」写成听众能看见的结果。', 'Write the outcome a listener can see, not the feeling that the talk is over.'),
          line('a2', 7, 14, 'lin', '这场不讲灵感。讲完如果别人做不出来，这课就没讲完。', 'This talk is not about inspiration. If nobody else can do it, it is not finished.'),
          line('a3', 14, 21, 'lin', '失败的样子要具体。说「变好了」不算一条验收。', 'A failure has to be specific. "It got better" is not a check.'),
          line('a4', 21, 28, 'zhou', '如果步骤只有你自己的电脑跑得通呢？', 'What if the steps only run on your computer?'),
          line('a5', 28, 35, 'lin', '那就还是笔记，不是验收。验收要换一台电脑也能走通。', 'Then it is still a note, not a check. A check has to run on someone else\'s machine.'),
          line('a6', 35, 42, 'lin', '每一步写输入、动作和你期待看见的结果。', 'Each step names the input, the action, and what you expect to see.'),
          line('a7', 42, 49, 'lin', '证据别只留在嘴里。命令、文件、结果写进回执。', 'Don\'t leave the evidence in the room. Put the command, the file, and the result in the receipt.'),
          line('a8', 49, 56, 'xu', '回执和当场的板书，哪个算数？', 'Which one counts: the receipt, or what you drew on the board?'),
          line('a9', 56, 63, 'lin', '都能算，但要标成示例还是当场记录。这场板书是示例。', 'Both can count. Mark whether it is a sample or a live note. This board is a sample.'),
          line('a10', 63, 70, 'lin', '讲完留一个最小复现：听众能交回来的那一小步。', 'Leave one small reproduction the listener can bring back.'),
          line('a11', 70, 77, 'shen', '听众一定要交作业吗？', 'Do listeners have to hand in homework?'),
          line('a12', 77, 84, 'lin', '不强制。留得出入口就行。交不交由听众决定。', 'No. Leave a way in. Handing it in stays their choice.')
        ],
        points: [
          { id: 'ap1', t: 4, title: '失败要写成能看见的结果', body: '不写「变好了」。写听众做完能指出来的那一个结果。' },
          { id: 'ap2', t: 28, title: '验收不能绑在讲者的电脑上', body: '换一个人、换一台机器还能走通，才算讲完。' },
          { id: 'ap3', t: 48, title: '回执留下命令、文件和结果', body: '口头说过不算证据。能对上的东西写下来。' },
          { id: 'ap4', t: 68, title: '留一个最小复现', body: '听众可以做一小步交回来。不强制交作业。' }
        ],
        board: {
          ops: [
            op('b1', 0, 1, 'lin', 'add', 'frame-fail', { kind: 'frame', x: 32, y: 28, w: 280, h: 140, name: '失败的样子', text: '失败的样子' }),
            op('b2', 8, 2, 'lin', 'add', 'note-fail', { kind: 'text', x: 48, y: 96, text: '听众能指出来' }),
            op('b3', 24, 3, 'lin', 'add', 'step-1', { kind: 'rect', x: 32, y: 200, w: 150, h: 64, text: '输入', cat: 1, color: 'cat-1' }),
            op('b4', 30, 4, 'lin', 'add', 'step-arrow', { kind: 'line', a: { x: 182, y: 232 }, b: { x: 214, y: 232 }, arrow: 'end', color: 'ink' }),
            op('b5', 32, 5, 'lin', 'add', 'step-2', { kind: 'rect', x: 214, y: 200, w: 160, h: 64, text: '换一台电脑', cat: 3, color: 'cat-3' }),
            op('b6', 46, 6, 'lin', 'add', 'card-receipt', { kind: 'card', x: 390, y: 36, w: 214, h: 120, title: '回执', meta: '命令 · 文件 · 结果' }),
            op('b7', 60, 7, 'lin', 'update', 'note-fail', { text: '失败要能被看见' }),
            op('b8', 68, 8, 'lin', 'add', 'step-3', { kind: 'rect', x: 400, y: 200, w: 180, h: 64, text: '最小复现', cat: 5, color: 'cat-5' })
          ]
        },
        questions: [
          { id: 'aq1', t: 21, askerId: 'zhou', text: '如果步骤只有你自己的电脑跑得通呢？', answered: true, answerAt: 28 },
          { id: 'aq2', t: 49, askerId: 'xu', text: '回执和当场的板书，哪个算数？', answered: true, answerAt: 56 },
          { id: 'aq3', t: 70, askerId: 'shen', text: '听众一定要交作业吗？', answered: false, answerAt: null }
        ],
        actions: []
      },
      {
        id: 'recover',
        kind: 'lecture',
        featured: false,
        direction: 'agent',
        title: 'Agent 调工具失败了，怎么让它接着干',
        summary: '先分清错在哪一层，再决定重试还是停下来问人。',
        speakerId: 'zhou',
        duration: 63,
        watched: 97,
        reproduced: 11,
        learn: ['把失败分成参数、权限、服务三种', '给重试定上限，每次换一点东西', '把失败写进回执，留给下一个人'],
        media: { kind: 'audio', src: 'sample:talk:recover' },
        cover: 'assets/samples/talk-agent-tool-recovery.webp',
        consent: consent([
          { id: 'zhou', role: 'host', consent: 'not_asked' },
          { id: 'xu', role: 'speaker', consent: 'not_asked' }
        ]),
        chapters: [
          { id: 'r1', t: 0, title: '先看错在哪一层' },
          { id: 'r2', t: 21, title: '重试要有上限' },
          { id: 'r3', t: 42, title: '失败写进回执' }
        ],
        transcript: [
          line('r1', 0, 7, 'zhou', '工具调用失败，先别急着让它重来。', 'When a tool call fails, don\'t rush to retry.'),
          line('r2', 7, 14, 'zhou', '先分清是参数错了、权限没给，还是服务本身挂了。', 'First tell apart bad arguments, missing permission, or a service that is down.'),
          line('r3', 14, 21, 'zhou', '三种错，恢复的办法完全不一样。', 'Each of the three needs a different recovery.'),
          line('r4', 21, 28, 'xu', '那能不能干脆让它一直重试？', 'Can we just let it retry forever?'),
          line('r5', 28, 35, 'zhou', '不行。重试要有上限，三次不过就停下来问人。', 'No. Cap the retries. After three failures, stop and ask a person.'),
          line('r6', 35, 42, 'zhou', '每次重试都要换一点东西，不然就是原地打转。', 'Each retry must change something, or it is just spinning.'),
          line('r7', 42, 49, 'zhou', '最后把失败写进回执：哪一步、什么错、试了几次。', 'Then write the failure into the receipt: which step, what error, how many tries.'),
          line('r8', 49, 56, 'xu', '回执写给谁看？', 'Who reads the receipt?'),
          line('r9', 56, 63, 'zhou', '写给下一个接手的人，也写给明天的自己。', 'The next person who picks it up, and yourself tomorrow.')
        ],
        points: [
          { id: 'rp1', t: 7, title: '先分清错在哪一层', body: '参数、权限、服务。三种错，恢复办法不同。' },
          { id: 'rp2', t: 28, title: '重试要有上限', body: '三次不过就停下来问人。每次重试换一点东西。' },
          { id: 'rp3', t: 44, title: '失败写进回执', body: '哪一步、什么错、试了几次。' }
        ],
        board: {
          ops: [
            op('rb1', 0, 1, 'zhou', 'add', 'kinds', { kind: 'card', x: 36, y: 36, w: 220, h: 110, title: '三种错', meta: '参数 · 权限 · 服务' }),
            op('rb2', 24, 2, 'zhou', 'add', 'cap', { kind: 'rect', x: 36, y: 180, w: 220, h: 64, text: '最多重试 3 次', cat: 1, color: 'cat-1' }),
            op('rb3', 44, 3, 'zhou', 'add', 'receipt', { kind: 'card', x: 320, y: 36, w: 240, h: 110, title: '回执', meta: '哪一步 · 什么错 · 几次' }),
            op('rb4', 46, 4, 'zhou', 'add', 'to-receipt', { kind: 'line', a: { x: 256, y: 91 }, b: { x: 320, y: 91 }, arrow: 'end', color: 'ink' })
          ]
        },
        questions: [
          { id: 'rq1', t: 21, askerId: 'xu', text: '那能不能干脆让它一直重试？', answered: true, answerAt: 28 },
          { id: 'rq2', t: 49, askerId: 'xu', text: '回执写给谁看？', answered: true, answerAt: 56 }
        ],
        actions: []
      },
      {
        id: 'diff',
        kind: 'lecture',
        featured: false,
        direction: 'code',
        title: '一次改动，怎么讲成别人能跟着做的步骤',
        summary: '只讲一个小改动。命令要能换到听众的机器上。',
        speakerId: 'zhou',
        duration: 63,
        watched: 142,
        reproduced: 17,
        learn: ['先讲改了哪一个文件', '再讲怎么知道改对了', '最后留一条别人能复跑的命令'],
        media: { kind: 'audio', src: 'sample:talk:diff' },
        cover: 'assets/samples/talk-understanding-diff.webp',
        consent: consent([
          { id: 'zhou', role: 'host', consent: 'not_asked' },
          { id: 'lin', role: 'speaker', consent: 'not_asked' }
        ]),
        chapters: [
          { id: 'd1', t: 0, title: '只讲一个改动' },
          { id: 'd2', t: 21, title: '命令要能换机器' },
          { id: 'd3', t: 42, title: '收成三行' }
        ],
        transcript: [
          line('d1', 0, 7, 'zhou', '今天只讲一个小改动，不讲整次发布。', 'Today is one small change, not a whole release.'),
          line('d2', 7, 14, 'zhou', '先说改了哪个文件，再说为什么动它。', 'Name the file first, then why you touched it.'),
          line('d3', 14, 21, 'zhou', '验证不要写成「我试过了」。写出你跑的那条命令。', 'Don\'t write "I tried it". Write the command you ran.'),
          line('d4', 21, 28, 'lin', '命令里有只有你本机才有的路径呢？', 'What if the command uses a path that exists only on your machine?'),
          line('d5', 28, 35, 'zhou', '就把它换成听众机器上的那一个，或者标明要换。', 'Swap in the listener\'s path, or mark the part they must change.'),
          line('d6', 35, 42, 'zhou', '失败也要留。红的那一次比绿的那一次更值得讲。', 'Keep the failure. The red run is more useful than the green one.'),
          line('d7', 42, 49, 'zhou', '讲完把命令、改动和结果合成三行，贴在大纲最后。', 'End with three lines: the command, the change, and the result.'),
          line('d8', 49, 56, 'lin', '三行够别人复现吗？', 'Are three lines enough for someone else to reproduce it?'),
          line('d9', 56, 63, 'zhou', '够起个头。复现不了的地方，就写成还没讲清。', 'Enough to start. Where it cannot be reproduced, say it is not clear yet.')
        ],
        points: [
          { id: 'dp1', t: 7, title: '一次只讲一个改动', body: '文件名先于理由。不要把整次发布塞进一节。' },
          { id: 'dp2', t: 28, title: '命令里的路径要能换', body: '只有讲者机器上有的路径，要标明替换，或者改成听众的。' },
          { id: 'dp3', t: 46, title: '大纲最后留三行', body: '命令、改动、结果。复现不了的地方写「还没讲清」。' }
        ],
        board: {
          ops: [
            op('db1', 0, 1, 'zhou', 'add', 'file', { kind: 'card', x: 36, y: 36, w: 220, h: 110, title: '一个文件', meta: '先说改了哪里' }),
            op('db2', 16, 2, 'zhou', 'add', 'cmd', { kind: 'rect', x: 36, y: 180, w: 250, h: 64, text: '一条命令', cat: 3, color: 'cat-3' }),
            op('db3', 36, 3, 'zhou', 'add', 'fail', { kind: 'rect', x: 320, y: 180, w: 250, h: 64, text: '留下失败', cat: 1, color: 'cat-1' }),
            op('db4', 48, 4, 'zhou', 'add', 'three', { kind: 'text', x: 320, y: 80, text: '命令 · 改动 · 结果' })
          ]
        },
        questions: [
          { id: 'dq1', t: 21, askerId: 'lin', text: '命令里有只有你本机才有的路径呢？', answered: true, answerAt: 28 },
          { id: 'dq2', t: 49, askerId: 'lin', text: '三行够别人复现吗？', answered: true, answerAt: 56 }
        ],
        actions: []
      },
      {
        id: 'prompt',
        kind: 'lecture',
        featured: false,
        direction: 'model',
        title: '模型回答跑偏时，先改问题还是先改例子',
        summary: '先看是不是问错了对象。例子是用来卡住边界的，不是用来堆的。',
        speakerId: 'xu',
        duration: 63,
        watched: 203,
        reproduced: 31,
        learn: ['先看问题是不是问错了对象', '补一个反例，而不是堆同类例子', '还不能确定的，留在问题里'],
        media: { kind: 'audio', src: 'sample:talk:prompt' },
        cover: 'assets/samples/talk-prompt-structure.webp',
        consent: consent([
          { id: 'xu', role: 'host', consent: 'not_asked' },
          { id: 'shen', role: 'speaker', consent: 'not_asked' }
        ]),
        chapters: [
          { id: 'm1', t: 0, title: '先看问的是谁' },
          { id: 'm2', t: 21, title: '补一个反例' },
          { id: 'm3', t: 42, title: '不确定就留着' }
        ],
        transcript: [
          line('m1', 0, 7, 'xu', '回答跑偏，先别加例子。先看你问的是不是这个对象。', 'When the answer drifts, don\'t add examples yet. Check you asked about the right thing.'),
          line('m2', 7, 14, 'xu', '对象错了，例子越多，偏得越稳。', 'If the subject is wrong, more examples only make the drift sturdier.'),
          line('m3', 14, 21, 'xu', '对象对了，再找一个它不该成立的例子。', 'Once the subject is right, find one case where the answer should not hold.'),
          line('m4', 21, 28, 'shen', '那我原来的五个正例要删吗？', 'Do I delete the five positive examples I already have?'),
          line('m5', 28, 35, 'xu', '留一个就够。剩下的位置给反例。', 'Keep one. Give the rest of the room to a counterexample.'),
          line('m6', 35, 42, 'xu', '反例要短，短到你能当着人读完。', 'Make the counterexample short enough to read aloud.'),
          line('m7', 42, 49, 'xu', '还不能确定的句子，不要写成结论。', 'If you are not sure, don\'t write it as a conclusion.'),
          line('m8', 49, 56, 'shen', '不确定的放哪？', 'Where does the unsure part go?'),
          line('m9', 56, 63, 'xu', '放回问题里。讲完，问题应该比开场更尖。', 'Put it back into the question. After the talk, the question should be sharper.')
        ],
        points: [
          { id: 'mp1', t: 4, title: '先核对对象', body: '问错对象时，加例子只会让偏的回答更稳。' },
          { id: 'mp2', t: 28, title: '正例留一个，空位给反例', body: '反例要短，短到能当着人读完。' },
          { id: 'mp3', t: 50, title: '不确定的放回问题', body: '不要写成结论。讲完，问题要比开场更尖。' }
        ],
        board: {
          ops: [
            op('mb1', 0, 1, 'xu', 'add', 'ask', { kind: 'frame', x: 32, y: 32, w: 250, h: 120, name: '问的是谁', text: '问的是谁' }),
            op('mb2', 22, 2, 'xu', 'add', 'yes', { kind: 'rect', x: 32, y: 190, w: 160, h: 60, text: '一个正例', cat: 2, color: 'cat-2' }),
            op('mb3', 30, 3, 'xu', 'add', 'no', { kind: 'rect', x: 220, y: 190, w: 180, h: 60, text: '一个反例', cat: 5, color: 'cat-5' }),
            op('mb4', 48, 4, 'xu', 'add', 'open', { kind: 'text', x: 430, y: 90, text: '不确定 · 留在问题里' })
          ]
        },
        questions: [
          { id: 'mq1', t: 21, askerId: 'shen', text: '那我原来的五个正例要删吗？', answered: true, answerAt: 28 },
          { id: 'mq2', t: 49, askerId: 'shen', text: '不确定的放哪？', answered: true, answerAt: 56 }
        ],
        actions: []
      },
      {
        id: 'local',
        kind: 'lecture',
        featured: false,
        direction: 'model',
        title: '在自己电脑上跑本地模型，先看三件事',
        summary: '先看放不放得下，再选能跑的尺寸，最后用已知答案验一遍。',
        speakerId: 'xu',
        duration: 63,
        watched: 121,
        reproduced: 15,
        learn: ['下载之前先看内存和显存', '先跑最小能跑的，再换大的', '用一个你知道答案的问题验一遍'],
        media: { kind: 'audio', src: 'sample:talk:local' },
        cover: 'assets/samples/talk-local-model-deploy.webp',
        consent: consent([
          { id: 'xu', role: 'host', consent: 'not_asked' },
          { id: 'shen', role: 'speaker', consent: 'not_asked' }
        ]),
        chapters: [
          { id: 'l1', t: 0, title: '先看放不放得下' },
          { id: 'l2', t: 21, title: '选一个能跑的尺寸' },
          { id: 'l3', t: 42, title: '用已知答案验一遍' }
        ],
        transcript: [
          line('l1', 0, 7, 'xu', '想在自己电脑上跑模型，先别急着下载。', 'Before running a model locally, don\'t rush to download.'),
          line('l2', 7, 14, 'xu', '先看内存和显存，够不够放下它。', 'Check memory and GPU memory first: can it fit?'),
          line('l3', 14, 21, 'xu', '放不下，再快的下载也是白等。', 'If it doesn\'t fit, a fast download is wasted time.'),
          line('l4', 21, 28, 'shen', '那应该选多大的？', 'So what size should I pick?'),
          line('l5', 28, 35, 'xu', '选你机器能稳稳跑起来的最小那个，先跑通再换大的。', 'Pick the smallest one your machine runs steadily. Get it working, then go bigger.'),
          line('l6', 35, 42, 'xu', '量化版本更省内存，答案会差一点，但够用来试。', 'A quantized version saves memory. Answers are a bit worse, but fine for trying.'),
          line('l7', 42, 49, 'xu', '跑起来以后，用一个你知道答案的问题验一遍。', 'Once it runs, test it with a question you already know the answer to.'),
          line('l8', 49, 56, 'shen', '答错了怎么办？', 'What if it answers wrong?'),
          line('l9', 56, 63, 'xu', '先记下来。本地模型不是拿来全信的，是拿来对照的。', 'Write it down. A local model is for comparison, not blind trust.')
        ],
        points: [
          { id: 'lp1', t: 8, title: '先看放不放得下', body: '内存和显存先于下载。' },
          { id: 'lp2', t: 30, title: '先跑最小能跑的', body: '跑通再换大的。量化版够用来试。' },
          { id: 'lp3', t: 44, title: '用已知答案验一遍', body: '答错先记下来。本地模型拿来对照，不拿来全信。' }
        ],
        board: {
          ops: [
            op('lb1', 0, 1, 'xu', 'add', 'fit', { kind: 'card', x: 36, y: 36, w: 220, h: 110, title: '放得下吗', meta: '内存 · 显存' }),
            op('lb2', 24, 2, 'xu', 'add', 'size', { kind: 'rect', x: 36, y: 180, w: 240, h: 64, text: '先跑最小能跑的', cat: 2, color: 'cat-2' }),
            op('lb3', 46, 3, 'xu', 'add', 'check', { kind: 'text', x: 320, y: 100, text: '用已知答案验一遍' })
          ]
        },
        questions: [
          { id: 'lq1', t: 21, askerId: 'shen', text: '那应该选多大的？', answered: true, answerAt: 28 },
          { id: 'lq2', t: 49, askerId: 'shen', text: '答错了怎么办？', answered: true, answerAt: 56 }
        ],
        actions: []
      },
      {
        id: 'meet',
        kind: 'meeting',
        featured: false,
        direction: 'product',
        title: '把「想开一堂课」收成下一场的安排',
        summary: '一场短会。只定听众带走什么、时长卡在哪、还剩哪个问题。',
        speakerId: 'shen',
        duration: 56,
        watched: 58,
        reproduced: 6,
        learn: ['先定听众做完能带走什么', '再把大纲压进等级允许的时长', '最后只留一个还没决定的问题'],
        media: { kind: 'audio', src: 'sample:talk:meet' },
        cover: 'assets/samples/talk-meeting-minutes.webp',
        consent: consent([
          { id: 'shen', role: 'host', consent: 'not_asked' },
          { id: 'lin', role: 'speaker', consent: 'not_asked' },
          { id: 'zhou', role: 'speaker', consent: 'not_asked' }
        ]),
        chapters: [
          { id: 'p1', t: 0, title: '听众带走什么' },
          { id: 'p2', t: 21, title: '时长卡在等级里' },
          { id: 'p3', t: 42, title: '只留一个问题' }
        ],
        transcript: [
          line('p1', 0, 7, 'shen', '这是安排，不是上课。我们不录音。', 'This is planning, not the class. We are not recording.'),
          line('p2', 7, 14, 'shen', '下一场结束时，听众要能带走一件具体的东西。', 'When the next session ends, a listener should leave with one concrete thing.'),
          line('p3', 14, 21, 'lin', '我可以带「验收清单」那一页。', 'I can bring the one-page acceptance list.'),
          line('p4', 21, 28, 'shen', '大纲先按骨干的 60 分钟卡，不要按讲师的 180。', 'Cap the outline at the 60 minutes for a core member, not the 180 for a lecturer.'),
          line('p5', 28, 35, 'zhou', '我来对一下列表上的时长和这个上限。', 'I will check the durations on the list against that cap.'),
          line('p6', 35, 42, 'shen', '超时的节先砍，不要先延长。', 'Cut the section that runs over. Don\'t extend first.'),
          line('p7', 42, 49, 'shen', '散会时只留一个还没决定的问题。', 'Leave with one undecided question, not a pile.'),
          line('p8', 49, 56, 'lin', '我的问题是：最小复现要不要写进报名说明。', 'Mine is whether the small reproduction belongs in the signup note.')
        ],
        points: [
          { id: 'pp1', t: 8, title: '先定带走的那一件', body: '这场定的是「验收清单」一页，不是一整门课。' },
          { id: 'pp2', t: 24, title: '先用更紧的时长上限', body: '按骨干 60 分钟卡大纲。超时先砍，不先延长。' },
          { id: 'pp3', t: 46, title: '只留一个未决问题', body: '最小复现要不要写进报名说明。别的当场定掉。' }
        ],
        board: {
          ops: [
            op('pb1', 0, 1, 'shen', 'add', 'take', { kind: 'card', x: 36, y: 40, w: 240, h: 110, title: '带走一件', meta: '验收清单 · 一页' }),
            op('pb2', 24, 2, 'shen', 'add', 'cap', { kind: 'rect', x: 36, y: 190, w: 200, h: 64, text: '先卡 60 分钟', cat: 5, color: 'cat-5' }),
            op('pb3', 46, 3, 'shen', 'add', 'open', { kind: 'text', x: 320, y: 100, text: '只留一个问题' })
          ]
        },
        questions: [],
        actions: [
          { id: 'act1', ownerId: 'lin', text: '补一页听众能带走的验收清单', due: '2026-11-03' },
          { id: 'act2', ownerId: 'zhou', text: '核对讲堂列表上的时长和等级上限', due: '2026-11-04' },
          { id: 'act3', ownerId: 'shen', text: '把下一场大纲压到 60 分钟以内', due: '2026-11-06' }
        ]
      }
    ]
  };

  var references = [
    [{ kind: 'knowledge', id: 'k2', label: '可接管的工作流' }, { kind: 'skill', id: 'skill-02', label: '先复现再修复' }],
    [{ kind: 'knowledge', id: 'k1', label: '有证据的 RAG' }, { kind: 'prompt', id: 'prompt-03', label: '最小复现' }],
    [{ kind: 'knowledge', id: 'k3', label: '可解释的原型' }, { kind: 'component', id: 'component-03', label: '可访问性交互' }],
    [{ kind: 'knowledge', id: 'k4', label: '保留条件与分歧' }, { kind: 'pattern', id: 'pattern-01', label: '对话 + 工件' }]
  ];
  window.COMMONS_TALKS_SAMPLE.talks.forEach(function (talk, index) {
    talk.references = references[index % references.length];
  });
})();

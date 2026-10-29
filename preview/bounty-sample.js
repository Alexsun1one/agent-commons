/* R13 BOUNTY-1 · 合成样例。形状即 /api/bounty/* 的返回体。处处示例，人物用与成长页相同的合成代号，不用真实群成员。 */
(() => {
  'use strict';

  const people = {
    me: { id: 'me', display_name: '陈墨', handle: 'chen-mo', level: 3 },
    ye: { id: 'p-ye', display_name: '林栖', handle: 'lin-qi', level: 1 },
    wen: { id: 'p-wen', display_name: '余岚', handle: 'yu-lan', level: 4 },
    cheng: { id: 'p-cheng', display_name: '松原', handle: 'song-yuan', level: 5 },
    lu: { id: 'p-lu', display_name: '陈墨', handle: 'chen-mo', level: 3 },
    xu: { id: 'p-xu', display_name: '林栖', handle: 'lin-qi', level: 1 },
    shen: { id: 'p-shen', display_name: '余岚', handle: 'yu-lan', level: 4 },
    jiang: { id: 'p-jiang', display_name: '松原', handle: 'song-yuan', level: 5 }
  };

  const base = (o) => Object.assign({
    state: 'open', settle_reason: null, cosmetic_id: null, cosmetic: null, has_perk: false, perk_note: null,
    answer_count: 0, submission_count: 0, task_count: 0, tags: [], contributors: 1, my_stake: 0,
    awards: [], useful: {}, tasks: [], submissions: [], promises: [], answers: [], held: 0, mine: false
  }, o, { label: o.kind === 'promo' ? '推广' : '求助' });

  window.COMMONS_BOUNTY_SAMPLE = {
    now: '2026-10-25T09:00:00.000000Z',
    me: people.me,
    people: people,
    rules: {
      caps: { L2: 50, L3: 200, L4: 500, L5: 1000 },
      concurrent: { L2: 1, L3: 3, L4: 5, L5: 5 },
      min_credits: 5,
      max_split: 3,
      grace_hours: 72,
      promo_per_week: 1,
      season_grant: 100,
      reward_types: [
        { type: 'credits', available: true }, { type: 'cosmetic', available: true }, { type: 'perk', available: true },
        { type: 'cash', available: false }, { type: 'goods', available: false }
      ],
      cosmetics: [
        { id: 'first-bug-hunter', kind: 'badge', label: '首个 bug 猎人' },
        { id: 'deep-reviewer', kind: 'badge', label: '深度体验官' },
        { id: 'early-tester', kind: 'badge', label: '首批试用' },
        { id: 'lifeline', kind: 'badge', label: '及时雨' },
        { id: 'panda-ink', kind: 'palette', label: '熊猫配色 · 墨蓝' },
        { id: 'panda-frost', kind: 'palette', label: '熊猫配色 · 霜银' },
        { id: 'panda-bamboo', kind: 'palette', label: '熊猫配色 · 青竹' }
      ],
      task_kinds: [
        { id: 'feedback', label: '试用后提问题' }, { id: 'bug', label: '报 bug' },
        { id: 'review', label: '写体验' }, { id: 'recording', label: '录一段使用过程' }
      ],
      promo_rules: [
        { id: 'no-like', category: 'engagement', enabled: true, pattern: '点赞|点个赞|求赞|赞一下|给个赞|一键三连|三连|\\blikes?\\b', message: '奖励不能换点赞。买来的赞会让大家分不清好坏，请改成试用以后的真实反馈。' },
        { id: 'no-favorite', category: 'engagement', enabled: true, pattern: '求收藏|收藏一下|帮.{0,6}收藏|加星|\\bstars?\\b|⭐', message: '奖励不能换收藏或加星。收藏和 star 应该来自真的觉得有用。' },
        { id: 'no-follow', category: 'follow', enabled: true, pattern: '求关注|加关注|关注(我|我们|一下|下|本号|账号|公众号|频道)|互粉|涨粉|粉丝|\\bfollow\\b|订阅(我|我们|频道|账号)', message: '奖励不能换关注或订阅。关注应该来自对内容的兴趣。' },
        { id: 'no-share', category: 'engagement', enabled: true, pattern: '转发|分享到|朋友圈|扩散|帮忙宣传|\\bretweet\\b|\\brepost\\b', message: '奖励不能换转发或分享。传播要靠东西本身好。' },
        { id: 'no-vote', category: 'engagement', enabled: true, pattern: '投票|拉票|打榜|\\bupvotes?\\b|\\bvotes?\\b', message: '奖励不能换投票或打榜。' },
        { id: 'no-offsite-review', category: 'offsite', enabled: true, pattern: '好评|五星|5 ?星|刷分|应用商店|app ?store|商店评论|product ?hunt|豆瓣评分', message: '不能用奖励换站外好评或评分。站外的评价必须是自发的，买来的好评也违反那些平台的规则。' },
        { id: 'no-traffic', category: 'offsite', enabled: true, pattern: '刷量|刷单|刷榜|刷阅读|刷播放|刷数据|引流|拉新|邀请.{0,8}注册|下载量|播放量|阅读量', message: '不能要求刷量、拉新或站外引流。任务只能是你本人试用以后给出的反馈。' },
        { id: 'no-contact', category: 'contact', enabled: true, pattern: '微信|\\bvx\\b|\\bwx\\b|加群|\\bqq\\b|手机号|电话|私聊|私信我|telegram|\\btg\\b', message: '任务说明里不留联系方式。提交和沟通都在站内完成，出了问题才能申诉。' }
      ]
    },
    myPosts: [
      { id: 'o-mine-1', type: 'discussion', title: '评测集里中英混排的样本怎么切分' },
      { id: 'o-mine-2', type: 'discussion', title: '本地知识库多久重建一次索引合适' },
      { id: 'o-mine-work', type: 'work', title: 'tr-cli：终端里的翻译助手' }
    ],
    bounties: [
      base({
        id: 'b-help-1', kind: 'help', status: 'active',
        object: { id: 'o-help-1', type: 'discussion', title: 'Claude Code 子代理总是读不到项目规则，怎么排查？' },
        owner: people.ye, credits: 70, held: 70, contributors: 2, my_stake: 20,
        cosmetic_id: 'lifeline', cosmetic: '及时雨',
        deadline_at: '2026-10-28T09:00:00.000000Z', settle_after: '2026-10-31T09:00:00.000000Z', remaining_seconds: 259200,
        answer_count: 4, tags: ['Agent 工作流', '排查'],
        post: { body: '主代理能读到仓库根目录的规则文件，但派出去的子代理每次都像第一次来，照着默认习惯改文件。工作树、权限都看过了，想知道还有哪些地方会让规则丢掉。' },
        useful: { 'o-a1': 4, 'o-a2': 2, 'o-a3': 1, 'o-a4': 0 },
        answers: [
          { id: 'o-a1', author: people.jiang, created_at: '2026-10-25T03:12:00.000000Z', body: '先看子代理是从哪个目录启动的。它只读启动目录往上的规则文件，如果派单时把 cwd 设到了临时目录，规则就一条都进不去。我的做法是在派单书第一行写明工作树路径。' },
          { id: 'o-a2', author: people.wen, created_at: '2026-10-25T04:40:00.000000Z', body: '检查一下设置里有没有额外目录。额外目录里的规则不会自动带给子代理，要在派单内容里点名让它读。' },
          { id: 'o-a3', author: people.lu, created_at: '2026-10-25T06:05:00.000000Z', body: '我遇到过同样的事：主代理的上下文太长，派单时把规则摘要截掉了。把规则压成十行以内的硬约束放进派单书，比让它自己去读稳定。' },
          { id: 'o-a4', author: people.xu, created_at: '2026-10-25T07:30:00.000000Z', body: '同问，我这边也是子代理不听规则，蹲一个答案。' }
        ]
      }),
      base({
        id: 'b-help-2', kind: 'help', status: 'active',
        object: { id: 'o-help-2', type: 'discussion', title: '向量检索召回总漏掉长文档的后半段' },
        owner: people.cheng, credits: 200, held: 200,
        deadline_at: '2026-10-30T09:00:00.000000Z', settle_after: '2026-11-02T09:00:00.000000Z', remaining_seconds: 432000,
        answer_count: 3, tags: ['RAG', '检索'], has_perk: true, perk_note: '一次 1 小时的结对排查（发起人自备）',
        post: { body: '切块 512、重叠 64，长文档后半段几乎召回不到。已经试过按标题切，效果没变。想听听实际调过的人怎么做。' },
        useful: { 'o-b1': 3, 'o-b2': 1 },
        answers: [
          { id: 'o-b1', author: people.jiang, created_at: '2026-10-25T05:00:00.000000Z', body: '先确认一下是不是写库时就截断了：很多嵌入接口对超长输入静默截断，后半段根本没进库。' },
          { id: 'o-b2', author: people.shen, created_at: '2026-10-25T06:30:00.000000Z', body: '试试给每个块加上文档标题和小节路径做前缀，召回后半段时排序会好很多。' }
        ]
      }),
      base({
        id: 'b-help-3', kind: 'help', status: 'judging',
        object: { id: 'o-help-3', type: 'discussion', title: '本地跑量化模型以后中文输出乱码' },
        owner: people.shen, credits: 30, held: 30,
        deadline_at: '2026-10-24T13:00:00.000000Z', settle_after: '2026-10-27T13:00:00.000000Z', remaining_seconds: 0,
        answer_count: 4, tags: ['本地模型'],
        post: { body: '4 位量化以后英文正常，中文一长就开始重复和乱码。' },
        useful: { 'o-c1': 2 },
        answers: [
          { id: 'o-c1', author: people.lu, created_at: '2026-10-23T08:00:00.000000Z', body: '多半是分词器文件和权重版本不对齐，换成同一个发布版本的分词器再试。' }
        ]
      }),
      base({
        id: 'b-help-4', kind: 'help', status: 'closed', state: 'awarded', settle_reason: 'owner',
        object: { id: 'o-help-4', type: 'discussion', title: 'MCP 服务器在 Windows 上起不来' },
        owner: people.lu, credits: 120, contributors: 1, has_perk: true, perk_note: '一次 1 小时的结对排查（发起人自备）',
        deadline_at: '2026-10-19T09:00:00.000000Z', settle_after: '2026-10-22T09:00:00.000000Z', remaining_seconds: 0,
        answer_count: 5, tags: ['MCP'],
        post: { body: '同一份配置在 macOS 上没问题，Windows 上进程起来就退出，日志是空的。' },
        awards: [
          { id: 'aw-1', mode: 'owner', answer_id: 'o-d1', recipient: people.ye, share: 70, credits: 84, created_at: '2026-10-19T11:00:00.000000Z' },
          { id: 'aw-2', mode: 'owner', answer_id: 'o-d2', recipient: people.me, share: 30, credits: 36, created_at: '2026-10-19T11:00:00.000000Z' }
        ],
        answers: [
          { id: 'o-d1', author: people.ye, created_at: '2026-10-18T02:00:00.000000Z', body: 'Windows 上 command 要写 cmd /c 再接 npx，否则找不到可执行文件，进程直接退出。' },
          { id: 'o-d2', author: people.me, created_at: '2026-10-18T03:00:00.000000Z', body: '路径里的反斜杠在 JSON 里要写成两个，不然配置读出来是错的。' }
        ]
      }),
      base({
        id: 'b-help-5', kind: 'help', status: 'closed', state: 'refunded', settle_reason: 'no_qualified',
        object: { id: 'o-help-5', type: 'discussion', title: '有没有好用的中文分词评测集' },
        owner: people.wen, credits: 20,
        deadline_at: '2026-10-15T09:00:00.000000Z', settle_after: '2026-10-18T09:00:00.000000Z', remaining_seconds: 0,
        answer_count: 1, tags: ['评测'],
        post: { body: '想找带领域词的评测集，最好有标注说明。' }
      }),
      base({
        id: 'b-help-6', kind: 'help', status: 'closed', state: 'awarded', settle_reason: 'auto',
        object: { id: 'o-help-6', type: 'discussion', title: '长上下文压缩有什么实测对比' },
        owner: people.jiang, credits: 500, contributors: 3,
        deadline_at: '2026-10-12T09:00:00.000000Z', settle_after: '2026-10-15T09:00:00.000000Z', remaining_seconds: 0,
        answer_count: 7, tags: ['长上下文'],
        post: { body: '想看真实任务上的对比，不要只看大海捞针。' },
        awards: [{ id: 'aw-3', mode: 'auto', answer_id: 'o-f1', recipient: people.cheng, share: 100, credits: 500, created_at: '2026-10-15T09:00:00.000000Z' }]
      }),
      base({
        id: 'b-promo-1', kind: 'promo', status: 'active',
        object: { id: 'o-promo-1', type: 'work', title: '拾页：把网页存成能检索的卡片' },
        owner: people.ye, credits: 110, held: 80,
        deadline_at: '2026-10-31T09:00:00.000000Z', settle_after: '2026-11-03T09:00:00.000000Z', remaining_seconds: 518400,
        submission_count: 6, task_count: 3, tags: ['浏览器插件', '知识管理'],
        post: { body: '一个浏览器插件：点一下把网页存成卡片，正文、来源和你的批注一起进本地库，可以全文检索。想找人真用一周，告诉我哪里不顺手。' },
        tasks: [
          { id: 't-1', title: '导出功能找 bug', kind: 'bug', description: '装好以后试一下导出 Markdown 和 CSV，把遇到的问题写清楚复现步骤。', credits_per: 10, max_claims: 5, cosmetic_id: 'first-bug-hunter', perk_note: null, accepted: 2, pending: 2 },
          { id: 't-2', title: '用一周写体验', kind: 'review', description: '连续用一周，写下哪三件事让你想继续用、哪三件事让你想卸载。', credits_per: 20, max_claims: 3, cosmetic_id: null, perk_note: '三个月专业版（发起人自备）', accepted: 0, pending: 1 },
          { id: 't-3', title: '录一段上手过程', kind: 'recording', description: '录三分钟以内的第一次上手，边用边说卡在哪。', credits_per: 0, max_claims: 10, cosmetic_id: 'early-tester', perk_note: null, accepted: 1, pending: 0 }
        ]
      }),
      base({
        id: 'b-promo-2', kind: 'promo', status: 'active', mine: true, created_at: '2026-10-17T09:00:00.000000Z',
        object: { id: 'o-mine-work', type: 'work', title: 'tr-cli：终端里的翻译助手' },
        owner: people.me, credits: 30, held: 20, my_stake: 30,
        deadline_at: '2026-10-29T09:00:00.000000Z', settle_after: '2026-11-01T09:00:00.000000Z', remaining_seconds: 345600,
        submission_count: 3, task_count: 1, tags: ['命令行'],
        post: { body: '在终端里选中一段英文直接翻译，支持管道。想请大家帮忙找 bug。' },
        tasks: [
          { id: 't-4', title: '找 bug', kind: 'bug', description: '在你常用的终端里试管道和长文本，遇到问题写下终端名称和复现步骤。', credits_per: 10, max_claims: 3, cosmetic_id: 'first-bug-hunter', perk_note: null, accepted: 1, pending: 2 }
        ],
        submissions: [
          { id: 's-1', task_id: 't-4', submitter: people.wen, status: 'accepted', body: '在 Windows Terminal 里管道输入超过 4KB 时卡住不返回，换成文件输入正常。复现：cat 大文件 | tr-cli。', created_at: '2026-10-23T10:00:00.000000Z' },
          { id: 's-2', task_id: 't-4', submitter: people.xu, status: 'pending', body: 'iTerm2 里中文标点翻译后变成问号，系统语言是英文。复现：echo 「你好，世界」 | tr-cli --to en。', created_at: '2026-10-24T08:20:00.000000Z' },
          { id: 's-3', task_id: 't-4', submitter: people.shen, status: 'pending', body: '挺好用的。', created_at: '2026-10-24T21:05:00.000000Z' }
        ]
      }),
      base({
        id: 'b-promo-3', kind: 'promo', status: 'judging',
        object: { id: 'o-promo-3', type: 'work', title: 'Agent 日志可视化面板' },
        owner: people.lu, credits: 60, held: 40,
        deadline_at: '2026-10-24T20:00:00.000000Z', settle_after: '2026-10-27T20:00:00.000000Z', remaining_seconds: 0,
        submission_count: 4, task_count: 2, tags: ['可观测性'],
        post: { body: '把多个 Agent 的调用日志画成时间线。' },
        tasks: [
          { id: 't-5', title: '接自己的日志试一次', kind: 'feedback', description: '把你自己的一份日志导进去，说说哪里看不懂。', credits_per: 10, max_claims: 4, cosmetic_id: null, perk_note: null, accepted: 2, pending: 2 }
        ]
      }),
      base({
        id: 'b-promo-4', kind: 'promo', status: 'closed', state: 'closed', settle_reason: 'expired',
        object: { id: 'o-promo-4', type: 'work', title: '提示词版本管理小工具' },
        owner: people.cheng, credits: 50,
        deadline_at: '2026-10-10T09:00:00.000000Z', settle_after: '2026-10-13T09:00:00.000000Z', remaining_seconds: 0,
        submission_count: 5, task_count: 1, tags: ['提示词'],
        post: { body: '给提示词做版本和对比。' },
        tasks: [
          { id: 't-6', title: '试用后提问题', kind: 'feedback', description: '用它管理你自己的三条提示词，提至少两个问题。', credits_per: 10, max_claims: 5, cosmetic_id: null, perk_note: null, accepted: 4, pending: 0 }
        ]
      })
    ],
    wallet: {
      available: 111,
      held: 40,
      season: 's2026q4',
      season_name: '2026 冬赛季',
      season_in: 166,
      season_out: 55,
      season_grant: 100,
      cap: 50,
      concurrent_limit: 1,
      open_bounties: 0,
      contribution: 86,
      entries: [
        { id: 'c-9', kind: 'release', amount: 0, held_delta: -10, source_type: 'award', reason_code: null, bounty: { id: 'b-promo-2', kind: 'promo', title: 'tr-cli：终端里的翻译助手', visible: true }, created_at: '2026-10-24T10:30:00.000000Z', note: '验收通过闻溪的 bug 报告，从托管里发出 10' },
        { id: 'c-8', kind: 'reverse', amount: -5, held_delta: 0, source_type: 'ledger', reason_code: 'reversal', ledger_label: null, bounty: null, created_at: '2026-10-24T09:00:00.000000Z', note: '一笔「有用」被治理员冲正（互相标记），积分跟着扣回' },
        { id: 'c-7', kind: 'grant', amount: 5, held_delta: 0, source_type: 'ledger', reason_code: 'useful', ledger_label: '回答被标「有用」', bounty: null, created_at: '2026-10-23T16:00:00.000000Z' },
        { id: 'c-5', kind: 'hold', amount: -20, held_delta: 20, source_type: 'topup', reason_code: null, bounty: { id: 'b-help-1', kind: 'help', title: 'Claude Code 子代理总是读不到项目规则，怎么排查？', visible: true }, created_at: '2026-10-21T09:00:00.000000Z', note: '给叶知的求助追加 20；没有合格回答时各退各的' },
        { id: 'c-6', kind: 'hold', amount: -30, held_delta: 30, source_type: 'task', reason_code: null, bounty: { id: 'b-promo-2', kind: 'promo', title: 'tr-cli：终端里的翻译助手', visible: true }, created_at: '2026-10-17T09:00:00.000000Z', note: '试用任务预算：10 积分 × 3 个名额' },
        { id: 'c-4', kind: 'award', amount: 36, held_delta: 0, source_type: 'award', reason_code: null, bounty: { id: 'b-help-4', kind: 'help', title: 'MCP 服务器在 Windows 上起不来', visible: true }, created_at: '2026-10-19T11:00:00.000000Z', note: '你的回答被采纳，分到 30%' },
        { id: 'c-3', kind: 'grant', amount: 20, held_delta: 0, source_type: 'ledger', reason_code: 'adopted', ledger_label: '知识被采纳或验证', bounty: null, created_at: '2026-10-15T10:00:00.000000Z' },
        { id: 'c-2', kind: 'grant', amount: 5, held_delta: 0, source_type: 'ledger', reason_code: 'useful', ledger_label: '回答被标「有用」', bounty: null, created_at: '2026-10-08T10:00:00.000000Z' },
        { id: 'c-1', kind: 'grant', amount: 100, held_delta: 0, source_type: 'season_start', reason_code: 'season_start', bounty: null, created_at: '2026-10-01T00:00:00.000000Z' }
      ],
      promises: [
        { id: 'pr-1', bounty_id: 'b-help-4', bounty_title: 'MCP 服务器在 Windows 上起不来', promiser: people.lu, recipient_id: 'me', note: '一次 1 小时的结对排查（发起人自备）', status: 'owed', created_at: '2026-10-19T11:00:00.000000Z' }
      ]
    }
  };
})();

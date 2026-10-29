/* R13 HOME-2 · 活动日历合成样例。处处示例；人物与标题均为虚构。 */
(function () {
  'use strict';

  window.COMMONS_CALENDAR_SAMPLE = {
    sample: true,
    timezone: 'Asia/Shanghai',
    subscribeHint: '沙箱不能下载文件。把下面的 ICS 文本复制到日历应用的「添加订阅 / 导入」。正式站会提供 webcal 地址。',
    aside: {
      sample: true,
      streakDays: 7,
      streakHint: '从上周三连续打开。只记在本机。',
      weekMarks: [1, 1, 0, 1, 1, 1, 1]
    },
    types: [
      { id: 'room', label: '讨论房间' },
      { id: 'talk', label: '讲堂' },
      { id: 'workshop', label: '工作坊' },
      { id: 'bounty', label: '悬赏截止' },
      { id: 'season', label: '赛季节点' }
    ],
    events: [
      {
        id: 'cal-room-trace',
        type: 'room',
        title: '调用轨迹复盘会',
        summary: '每人带一条失败的调用轨迹，一起找根因。需要报名。',
        start: '2026-10-25T20:00:00+08:00',
        end: '2026-10-25T20:45:00+08:00',
        place: '站内房间',
        href: '#/room/r-soon-trace', targetId: 'r-soon-trace',
        host: '陈墨', host_handle: 'chen-mo', host_level: 3,
        sample: true
      },
      {
        id: 'cal-room-eval',
        type: 'room',
        title: '评测集到底要多大？',
        summary: '小组讨论。音视频在腾讯会议，这边管议程和纪要。',
        start: '2026-10-26T19:30:00+08:00',
        end: '2026-10-26T20:30:00+08:00',
        place: '腾讯会议（示例）',
        href: '#/room/r-disc-eval', targetId: 'r-disc-eval',
        host: '松原', host_handle: 'song-yuan', host_level: 5,
        sample: true
      },
      {
        id: 'cal-room-weekly',
        type: 'room',
        title: '周四例会 · 本周热点里的 Agent',
        summary: '三位轮值讲者各十分钟，后面开放举手。',
        start: '2026-10-29T20:00:00+08:00',
        end: '2026-10-29T21:00:00+08:00',
        place: '飞书会议（示例）',
        href: '#/room/r-soon-weekly', targetId: 'r-soon-weekly',
        host: '余岚', host_handle: 'yu-lan', host_level: 4,
        sample: true
      },
      {
        id: 'cal-talk-accept',
        type: 'talk',
        title: '怎么把一场公开课讲到能复现',
        summary: '不讲灵感。讲完如果别人做不出来，这课就没讲完。',
        start: '2026-10-27T20:00:00+08:00',
        end: '2026-10-27T21:24:00+08:00',
        place: '讲堂回看',
        href: '#/talk/acceptance-replay', targetId: 'acceptance-replay',
        host: '余岚', host_handle: 'yu-lan', host_level: 4,
        sample: true
      },
      {
        id: 'cal-talk-repro',
        type: 'talk',
        title: '用你自己的项目走一遍验收清单',
        summary: '公开课 · 报名在房间列表。',
        start: '2026-11-05T20:00:00+08:00',
        end: '2026-11-05T21:30:00+08:00',
        place: '公开讲堂',
        href: '#/talk/repro-checklist', targetId: 'repro-checklist',
        host: '余岚', host_handle: 'yu-lan', host_level: 4,
        sample: true
      },
      {
        id: 'cal-talk-model',
        type: 'talk',
        title: '模型阅读会：一个跑偏的回答',
        summary: '公开课 · 报名在房间列表。',
        start: '2026-11-10T12:30:00+08:00',
        end: '2026-11-10T13:30:00+08:00',
        place: '公开讲堂',
        href: '#/talk/model-reading', targetId: 'model-reading',
        host: '陈墨', host_handle: 'chen-mo', host_level: 3,
        sample: true
      },
      {
        id: 'cal-ws-eval',
        type: 'workshop',
        title: '评测集切片工作坊',
        summary: '带一份自己的评测样本，现场切出最小可复现集。',
        start: '2026-10-31T14:00:00+08:00',
        end: '2026-10-31T17:00:00+08:00',
        place: '评测小组',
        href: '#/event/ws-eval', targetId: 'ws-eval',
        host: '陈墨', host_handle: 'chen-mo', host_level: 3,
        sample: true
      },
      {
        id: 'cal-ws-skill',
        type: 'workshop',
        title: '把一条 Skill 写到能安装',
        summary: '从目标、输入、验收三栏写成可复制的 SKILL.md。',
        start: '2026-11-08T15:00:00+08:00',
        end: '2026-11-08T17:00:00+08:00',
        place: 'Agent 实践组',
        href: '#/event/ws-skill', targetId: 'ws-skill',
        host: '林栖', host_handle: 'lin-qi', host_level: 1,
        sample: true
      },
      {
        id: 'cal-bounty-help1',
        type: 'bounty',
        title: '悬赏截止 · 子代理读不到项目规则',
        summary: '求助悬赏将在这一天截止，之后进入结算。',
        start: '2026-10-28T17:00:00+08:00',
        end: '2026-10-28T17:00:00+08:00',
        place: '悬赏',
        href: '#/bounties/help1', targetId: 'help1',
        host: '林栖', host_handle: 'lin-qi', host_level: 1,
        sample: true
      },
      {
        id: 'cal-bounty-mine',
        type: 'bounty',
        title: '我的悬赏截止 · tr-cli 找 bug',
        summary: '你发起的推广悬赏还剩两个待审提交。',
        start: '2026-10-29T17:00:00+08:00',
        end: '2026-10-29T17:00:00+08:00',
        place: '悬赏',
        href: '#/bounties/tr-cli', targetId: 'tr-cli',
        host: '陈墨', host_handle: 'chen-mo', host_level: 3,
        mine: true,
        sample: true
      },
      {
        id: 'cal-bounty-promo1',
        type: 'bounty',
        title: '悬赏截止 · 拾页插件试用',
        summary: '浏览器插件试用任务截止。',
        start: '2026-10-31T17:00:00+08:00',
        end: '2026-10-31T17:00:00+08:00',
        place: '悬赏',
        href: '#/bounties/plugin-trial', targetId: 'plugin-trial',
        host: '林栖', host_handle: 'lin-qi', host_level: 1,
        sample: true
      },
      {
        id: 'cal-season-mid',
        type: 'season',
        title: '2026 冬赛季 · 中期核对',
        summary: '核对本赛季积分口径，不改已确认的流水。',
        start: '2026-11-15T00:00:00+08:00',
        end: '2026-11-15T23:59:00+08:00',
        place: '成长',
        href: '#/growth', targetId: 'winter-2026-mid',
        host: '',
        sample: true
      },
      {
        id: 'cal-season-end',
        type: 'season',
        title: '2026 冬赛季结束',
        summary: '赛季积分冻结，下一季从 2027-01-01 开始。',
        start: '2026-12-31T23:59:00+08:00',
        end: '2026-12-31T23:59:00+08:00',
        place: '成长',
        href: '#/growth', targetId: 'winter-2026-end',
        host: '',
        sample: true
      }
    ]
  };
})();

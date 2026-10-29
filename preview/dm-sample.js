/* R13 DM-1 · six synthetic conversations. */
(function () {
  'use strict';

  window.COMMONS_DM_SAMPLE = {
    me: { id: 'local-self', handle: 'chen-mo', name: '我', level: 3, avatar: 'assets/mascot/panda-avatar-brand-blue-512.webp' },
    settings: { contact_policy: 'following' },
    threads: [
      {
        id: 'dm-linqi', kind: 'direct', title: '林栖', pinned: true, muted: false,
        unread: 2, request_state: 'accepted', updated_at: '2026-10-25T17:42:00Z',
        participants: [
          { id: 'local-self', handle: 'chen-mo', name: '我', level: 3, avatar: 'assets/mascot/panda-avatar-brand-blue-512.webp' },
          { id: 'linqi', handle: 'lin-qi', name: '林栖', level: 1, avatar: 'assets/mascot/panda-avatar-mint-512.webp', online: true }
        ],
        last_message: { text: '边界样本的复测结果，我补进这篇方法的评测表了。', created_at: '2026-10-25T17:42:00Z' }
      },
      {
        id: 'dm-group', kind: 'group', title: '周末共创小队', pinned: false, muted: true,
        unread: 0, request_state: 'accepted', updated_at: '2026-10-25T16:18:00Z',
        participants: [
          { id: 'local-self', handle: 'chen-mo', name: '我', level: 3, avatar: 'assets/mascot/panda-avatar-brand-blue-512.webp' },
          { id: 'wenxi', handle: 'song-yuan', name: '松原', level: 5, avatar: 'assets/mascot/panda-avatar-mist-purple-512.webp' },
          { id: 'chengye', handle: 'yu-lan', name: '余岚', level: 4, avatar: 'assets/mascot/panda-avatar-graphite-512.webp' },
          { id: 'luyao', handle: 'lin-qi', name: '林栖', level: 1, avatar: 'assets/mascot/panda-avatar-night-sky-512.webp' }
        ],
        last_message: { text: '林栖：活动页已经可以报名了。', created_at: '2026-10-25T16:18:00Z' }
      },
      {
        id: 'dm-request', kind: 'direct', title: '消息请求', pinned: false, muted: false,
        unread: 1, request_state: 'pending', request_recipient_id: 'local-self',
        updated_at: '2026-10-25T15:56:00Z',
        participants: [
          { id: 'local-self', handle: 'chen-mo', name: '我', level: 3, avatar: 'assets/mascot/panda-avatar-brand-blue-512.webp' },
          { id: 'xinqiao', handle: 'song-yuan', name: '松原', level: 5, avatar: 'assets/mascot/panda-avatar-classic-512.webp', online: null }
        ],
        last_message: { text: '你好，看到你在活动里分享了本地模型评测。', created_at: '2026-10-25T15:56:00Z' }
      },
      {
        id: 'dm-market', kind: 'direct', title: '陈墨', pinned: false, muted: false,
        unread: 0, request_state: 'accepted', updated_at: '2026-10-25T14:31:00Z',
        ref: { type: 'market', id: 'mk03', title: '树莓派 5 8GB 套件', subtitle: '¥420 · 深圳 · 已预订', href: '#/market/mk03' },
        participants: [
          { id: 'local-self', handle: 'chen-mo', name: '我', level: 3, avatar: 'assets/mascot/panda-avatar-brand-blue-512.webp' },
          { id: 'gucheng', handle: 'chen-mo', name: '陈墨', level: 3, avatar: 'assets/mascot/panda-avatar-classic-512.webp', online: false }
        ],
        last_message: { text: '有人先订了，周五前没来取就留给你。', created_at: '2026-10-25T14:31:00Z' }
      },
      {
        id: 'dm-recalled', kind: 'direct', title: '叶知', pinned: false, muted: false,
        unread: 0, request_state: 'accepted', updated_at: '2026-10-25T12:24:00Z',
        participants: [
          { id: 'local-self', handle: 'chen-mo', name: '我', level: 3, avatar: 'assets/mascot/panda-avatar-brand-blue-512.webp' },
          { id: 'yezhi', handle: 'yu-lan', name: '余岚', level: 4, avatar: 'assets/mascot/panda-avatar-mist-purple-512.webp', online: false }
        ],
        last_message: { text: '一条消息已撤回', recalled: true, created_at: '2026-10-25T12:24:00Z' }
      },
      {
        id: 'dm-blocked', kind: 'direct', title: '已拉黑成员', pinned: false, muted: false,
        unread: 0, request_state: 'accepted', blocked: true, updated_at: '2026-10-24T19:08:00Z',
        participants: [
          { id: 'local-self', handle: 'chen-mo', name: '我', level: 3, avatar: 'assets/mascot/panda-avatar-brand-blue-512.webp' },
          { id: 'blocked-member', name: '已拉黑成员', avatar: 'assets/mascot/panda-avatar-graphite-512.webp', online: null, blocked: true }
        ],
        last_message: { text: '已停止接收对方的消息', created_at: '2026-10-24T19:08:00Z' }
      }
    ],
    messages: {
      'dm-linqi': [
        { id: 'm-l-1', sender_id: 'linqi', sender_name: '林栖', text: '评测集里那 12 个边界样本，我重新跑了一遍。', created_at: '2026-10-25T17:36:00Z' },
        { id: 'm-l-2', sender_id: 'local-self', sender_name: '我', text: '差异主要在哪？', reply_to: 'm-l-1', created_at: '2026-10-25T17:39:00Z' },
        { id: 'm-l-3', sender_id: 'linqi', sender_name: '林栖', text: '边界样本的复测结果，我补进这篇方法的评测表了。', ref: { type: 'knowledge', id: 'k1', title: '让知识库回答有出处，也知道什么时候不回答', subtitle: '知识检索 · 实践方法', href: '#/knowledge/k1' }, created_at: '2026-10-25T17:42:00Z' },
        { id: 'm-l-4', sender_id: 'linqi', sender_name: '林栖', sticker_ref: 'assets/mascot/panda-avatar-mint-512.webp', created_at: '2026-10-25T17:42:30Z' }
      ],
      'dm-group': [
        { id: 'm-g-1', sender_id: 'wenxi', sender_name: '松原', text: '周六 14:00 开始，先走一轮作品互评。', created_at: '2026-10-25T16:03:00Z' },
        { id: 'm-g-2', sender_id: 'chengye', sender_name: '余岚', text: '我带白板模板。', created_at: '2026-10-25T16:08:00Z' },
        { id: 'm-g-3', sender_id: 'luyao', sender_name: '林栖', text: '活动页已经可以报名了：#/event/ev-hangzhou-meetup', created_at: '2026-10-25T16:18:00Z' }
      ],
      'dm-request': [
        { id: 'm-q-1', sender_id: 'xinqiao', sender_name: '新桥', text: '你好，看到你在活动里分享了本地模型评测。', created_at: '2026-10-25T15:56:00Z' }
      ],
      'dm-market': [
        { id: 'm-m-1', sender_id: 'local-self', sender_name: '我', text: '树莓派套件还在吗？', ref: { type: 'market', id: 'mk03', title: '树莓派 5 8GB 套件', subtitle: '¥420 · 深圳 · 已预订', href: '#/market/mk03' }, created_at: '2026-10-25T14:22:00Z' },
        { id: 'm-m-2', sender_id: 'gucheng', sender_name: '陈墨', text: '有人先订了，周五前没来取就留给你。', created_at: '2026-10-25T14:31:00Z' }
      ],
      'dm-recalled': [
        { id: 'm-r-1', sender_id: 'yezhi', sender_name: '余岚', text: '一条消息已撤回', recalled: true, created_at: '2026-10-25T12:24:00Z' }
      ],
      'dm-blocked': [
        { id: 'm-b-1', sender_id: 'local-self', sender_name: '我', text: '这段对话保留在本机示例中。', created_at: '2026-10-24T19:08:00Z' }
      ]
    },
    linkPreviews: {
      '#/event/ev-hangzhou-meetup': { type: 'event', id: 'ev-hangzhou-meetup', title: '杭州线下小聚', subtitle: '周日 14:00 · 带一件作品来', href: '#/event/ev-hangzhou-meetup' }
    }
  };
})();

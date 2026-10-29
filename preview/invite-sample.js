/* R13 INVITE-2 · 邀请页示例数据。只给预览，不进真实接口。 */
window.COMMONS_INVITE_SAMPLE = {
  quota: { level: 3, base: 3, memberBonus: 0, penalty: false, total: 3, used: 1, remaining: 2, month: '2026-10' },
  sent: 2,
  accepted: 1,
  invites: [
    { id: 'sample-onboarded', status: 'onboarded', handle: 'lin-qi', name: '小林', level: 2, avatar: 'assets/mascot/panda-avatar-mint-512.webp', note: '来把方法写成能复用的东西。' },
    { id: 'sample-pending', status: 'pending', name: null, level: null, note: '' }
  ],
  people: [{ name: '小林', level: 2 }],
  me: { name: '我', level: 3 },
  rewards: { onboarding: 20, first: 50 }
};

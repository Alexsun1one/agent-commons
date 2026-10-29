/* R13 PET-1 合成数据；页面只在页首标一次「示例」。 */
window.COMMONS_PET_SAMPLE = {
  me: {
    owner: { id: 'p-me', handle: 'chen-mo', display_name: '陈墨' },
    bamboo: 268,
    pet: {
      name: '蓝团', palette: 'brand-blue', palette_label: '先锋蓝',
      asset_path: 'assets/mascot/panda-avatar-brand-blue-512.webp',
      fullness: 76, mood: 88, affinity: 63, affinity_total: 76,
      sleeping: false, stage: 1, stage_key: 'youth', stage_label: '少年',
      unlock: '陪玩', next_threshold: 120, adopted_at: '2026-10-18T09:00:00Z'
    },
    outfit: [
      { item_key: 'panda_ocean', name: '海盐眼圈', category: 'panda_palette', category_label: '熊猫配色', equipped: true },
      { item_key: 'frame_sprout', name: '新芽边框', category: 'avatar_frame', category_label: '头像框', equipped: true }
    ]
  },
  diary: [
    { id: 'd1', entry: '今天主人在问题库帮了别人一次，我开心地打了个滚。', created_at: '2026-10-25T13:26:00Z' },
    { id: 'd2', entry: '今天主人发布了一张知识卡，我把它记进小本子。', created_at: '2026-10-25T10:08:00Z' },
    { id: 'd3', entry: '今天主人喂了我一份竹子，肚子暖暖的。', created_at: '2026-10-25T08:40:00Z' },
    { id: 'd4', entry: '今天主人参加了一场讲堂，我陪着听到了散场。', created_at: '2026-10-24T20:15:00Z' }
  ],
  friends: [
    { owner: { id: 'p-mira', handle: 'lin-qi', display_name: '林栖' }, name: '墨墨', palette: 'graphite',
      asset_path: 'assets/mascot/panda-avatar-graphite-512.webp', fullness: 18, mood: 66,
      sleeping: false, hungry: true, stage_label: '成年' },
    { owner: { id: 'p-lin', handle: 'yu-lan', display_name: '余岚' }, name: '薄荷', palette: 'mint',
      asset_path: 'assets/mascot/panda-avatar-mint-512.webp', fullness: 0, mood: 42,
      sleeping: true, hungry: true, stage_label: '幼崽' },
    { owner: { id: 'p-qi', handle: 'song-yuan', display_name: '松原' }, name: '小夜', palette: 'night-sky',
      asset_path: 'assets/mascot/panda-avatar-night-sky-512.webp', fullness: 81, mood: 92,
      sleeping: false, hungry: false, stage_label: '少年' }
  ]
};

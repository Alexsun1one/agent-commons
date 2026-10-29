/* R13 ECON-1 · 竹子商店与钱包的合成示例数据。 */
window.COMMONS_ECONOMY_SAMPLE = {
  me: {
    currency: 'bamboo',
    currency_name: '竹子',
    balance: 468,
    today: { day: '2026-10-25', earned: 115, cap: 300, remaining: 185 },
    inventory: [
      { item_key: 'panda-pioneer-blue', name: '先锋蓝', category: 'panda_palette', category_label: '熊猫配色', equipped: true, acquired_at: '2026-10-18T08:30:00.000000Z' },
      { item_key: 'sticker-it-works', name: '终于跑通', category: 'sticker_pack', category_label: '表情包', equipped: false, acquired_at: '2026-10-20T11:10:00.000000Z' },
      { item_key: 'frame-bamboo-mist', name: '青篁外框', category: 'avatar_frame', category_label: '头像框', equipped: false, acquired_at: '2026-10-23T03:40:00.000000Z' }
    ],
    checkin: {
      day: '2026-10-25', streak: 6, total_days: 19, claimed_today: false,
      last_reward: 40, next_cycle_day: 7, next_reward: 80,
      rewards: [10, 15, 20, 25, 30, 40, 80]
    }
  },
  categories: [
    { key: 'all', name: '全部' },
    { key: 'avatar_frame', name: '头像框' },
    { key: 'panda_palette', name: '熊猫配色' },
    { key: 'farm_decor', name: '农场装饰' },
    { key: 'vehicle', name: '车型' },
    { key: 'sticker_pack', name: '表情包' }
  ],
  shop: [
    { key: 'frame-bamboo-mist', name: '青篁外框', category: 'avatar_frame', category_label: '头像框', rarity: 'common', rarity_label: '普通', price: 80, limited: null, remaining: null, owned: true, equipped: false },
    { key: 'frame-blue-ink', name: '蓝墨边界', category: 'avatar_frame', category_label: '头像框', rarity: 'refined', rarity_label: '精致', price: 120, limited: null, remaining: null, owned: false, equipped: false },
    { key: 'frame-cloud-trace', name: '云影细框', category: 'avatar_frame', category_label: '头像框', rarity: 'rare', rarity_label: '稀有', price: 160, limited: 500, remaining: 328, owned: false, equipped: false },
    { key: 'frame-night-radio', name: '深夜电台', category: 'avatar_frame', category_label: '头像框', rarity: 'legendary', rarity_label: '典藏', price: 220, limited: 200, remaining: 47, owned: false, equipped: false },
    { key: 'panda-pioneer-blue', name: '先锋蓝', category: 'panda_palette', category_label: '熊猫配色', price: 100, limited: null, remaining: null, owned: true, equipped: true },
    { key: 'panda-mint', name: '薄荷青', category: 'panda_palette', category_label: '熊猫配色', price: 130, limited: null, remaining: null, owned: false, equipped: false },
    { key: 'panda-mist-violet', name: '雾紫', category: 'panda_palette', category_label: '熊猫配色', price: 160, limited: null, remaining: null, owned: false, equipped: false },
    { key: 'panda-graphite', name: '石墨灰', category: 'panda_palette', category_label: '熊猫配色', price: 180, limited: null, remaining: null, owned: false, equipped: false },
    { key: 'farm-waterwheel', name: '竹影水车', category: 'farm_decor', category_label: '农场装饰', price: 90, limited: null, remaining: null, owned: false, equipped: false },
    { key: 'farm-cloud-awning', name: '小云雨棚', category: 'farm_decor', category_label: '农场装饰', price: 110, limited: null, remaining: null, owned: false, equipped: false },
    { key: 'farm-stone-sign', name: '青石路牌', category: 'farm_decor', category_label: '农场装饰', price: 140, limited: null, remaining: null, owned: false, equipped: false },
    { key: 'farm-star-scarecrow', name: '星图稻草人', category: 'farm_decor', category_label: '农场装饰', price: 200, limited: 300, remaining: 166, owned: false, equipped: false },
    { key: 'car-sea-salt', name: '海盐小车', category: 'vehicle', category_label: '车型', price: 150, limited: null, remaining: null, owned: false, equipped: false },
    { key: 'car-blue-whale', name: '蓝鲸通勤车', category: 'vehicle', category_label: '车型', price: 220, limited: null, remaining: null, owned: false, equipped: false },
    { key: 'car-violet-tour', name: '雾紫巡游车', category: 'vehicle', category_label: '车型', price: 320, limited: 240, remaining: 91, owned: false, equipped: false },
    { key: 'car-night-flight', name: '夜航概念车', category: 'vehicle', category_label: '车型', price: 480, limited: 80, remaining: 12, owned: false, equipped: false },
    { key: 'sticker-it-works', name: '终于跑通', category: 'sticker_pack', category_label: '表情包', price: 60, limited: null, remaining: null, owned: true, equipped: false },
    { key: 'sticker-water-break', name: '先喝口水', category: 'sticker_pack', category_label: '表情包', price: 70, limited: null, remaining: null, owned: false, equipped: false },
    { key: 'sticker-reproduce', name: '我来复现', category: 'sticker_pack', category_label: '表情包', price: 90, limited: null, remaining: null, owned: false, equipped: false },
    { key: 'sticker-ship-today', name: '今天封板', category: 'sticker_pack', category_label: '表情包', price: 120, limited: 600, remaining: 403, owned: false, equipped: false }
  ],
  entries: [
    { id: 'e10', amount: 40, reason: 'economy.checkin', reason_label: '每日签到', ref: '2026-10-24', created_at: '2026-10-24T00:18:00.000000Z' },
    { id: 'e9', amount: 75, reason: 'farm.harvest', reason_label: '农场收获', ref: 'plot-18', created_at: '2026-10-24T00:05:00.000000Z' },
    { id: 'e8', amount: -80, reason: 'shop.purchase', reason_label: '购买「青篁外框」', ref: 'frame-bamboo-mist', created_at: '2026-10-23T03:40:00.000000Z' },
    { id: 'e7', amount: 30, reason: 'parking.fine', reason_label: '车位结算', ref: 'parking-27', created_at: '2026-10-23T02:11:00.000000Z' },
    { id: 'e6', amount: 30, reason: 'economy.checkin', reason_label: '每日签到', ref: '2026-10-23', created_at: '2026-10-23T00:12:00.000000Z' },
    { id: 'e5', amount: 60, reason: 'games.reward', reason_label: '猜提示词获胜', ref: 'prompt-guess-8', created_at: '2026-10-22T09:28:00.000000Z' },
    { id: 'e4', amount: -100, reason: 'shop.purchase', reason_label: '购买「先锋蓝」', ref: 'panda-pioneer-blue', created_at: '2026-10-18T08:30:00.000000Z' },
    { id: 'e3', amount: 25, reason: 'economy.checkin', reason_label: '每日签到', ref: '2026-10-18', created_at: '2026-10-18T00:07:00.000000Z' },
    { id: 'e2', amount: 120, reason: 'farm.harvest', reason_label: '农场收获', ref: 'plot-3', created_at: '2026-10-17T10:20:00.000000Z' },
    { id: 'e1', amount: 348, reason: 'admin_adjust', reason_label: '内测欢迎竹子', ref: 'beta-welcome', created_at: '2026-10-16T08:00:00.000000Z' }
  ]
};

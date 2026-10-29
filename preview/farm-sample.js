/* R13 FARM-1 · 离线示例。人物、余额、作物与互动均为合成数据。 */
window.COMMONS_FARM_SAMPLE = {
  me: 'chen-mo',
  balance: 286,
  crops: [
    { key: 'token_tomato', name: 'Token 番茄', minutes: 30, seed: 3, reward: 8, asset: 'assets/game/farm-crop-token-tomato' },
    { key: 'prompt_greens', name: '提示词青菜', minutes: 45, seed: 4, reward: 10, asset: 'assets/game/farm-crop-prompt-greens' },
    { key: 'vector_radish', name: '向量萝卜', minutes: 60, seed: 5, reward: 13, asset: 'assets/game/farm-crop-vector-radish' },
    { key: 'context_corn', name: '上下文玉米', minutes: 90, seed: 7, reward: 17, asset: 'assets/game/farm-crop-context-corn' },
    { key: 'embedding_eggplant', name: '嵌入茄子', minutes: 120, seed: 9, reward: 22, asset: 'assets/game/farm-crop-embedding-eggplant' },
    { key: 'rag_pepper', name: 'RAG 甜椒', minutes: 180, seed: 12, reward: 29, asset: 'assets/game/farm-crop-rag-pepper' },
    { key: 'agent_mushroom', name: 'Agent 蘑菇', minutes: 240, seed: 15, reward: 36, asset: 'assets/game/farm-crop-agent-mushroom' },
    { key: 'diff_melon', name: 'Diff 蜜瓜', minutes: 360, seed: 20, reward: 48, asset: 'assets/game/farm-crop-diff-melon' },
    { key: 'lora_lettuce', name: 'LoRA 生菜', minutes: 480, seed: 26, reward: 62, asset: 'assets/game/farm-crop-lora-lettuce' },
    { key: 'cache_cabbage', name: '缓存甘蓝', minutes: 600, seed: 31, reward: 75, asset: 'assets/game/farm-crop-cache-cabbage' },
    { key: 'eval_berry', name: '评测蓝莓', minutes: 960, seed: 43, reward: 104, asset: 'assets/game/farm-crop-eval-berry' },
    { key: 'gpu_pumpkin', name: 'GPU 南瓜', minutes: 1440, seed: 58, reward: 140, asset: 'assets/game/farm-crop-gpu-pumpkin' }
  ],
  farms: [
    {
      id: 'chen-mo', handle: 'chen-mo', name: '陈墨', level: 3, avatar: 'assets/mascot/panda-avatar-brand-blue-512.webp', mine: true,
      watchdog: true, plotCount: 8,
      plots: [
        { index: 1, state: 'mature', crop: 'agent_mushroom', readyIn: 0, needsWater: false, needsWeed: false, stealCount: 1 },
        { index: 2, state: 'growing', crop: 'vector_radish', readyIn: 1260, needsWater: true, needsWeed: false, stealCount: 0 },
        { index: 3, state: 'growing', crop: 'embedding_eggplant', readyIn: 4380, needsWater: false, needsWeed: true, stealCount: 0 },
        { index: 4, state: 'growing', crop: 'prompt_greens', readyIn: 480, needsWater: false, needsWeed: false, stealCount: 0 },
        { index: 5, state: 'empty' }, { index: 6, state: 'empty' },
        { index: 7, state: 'growing', crop: 'diff_melon', readyIn: 9200, needsWater: true, needsWeed: true, stealCount: 0 },
        { index: 8, state: 'mature', crop: 'token_tomato', readyIn: 0, needsWater: false, needsWeed: false, stealCount: 2 },
        { index: 9, state: 'locked' }, { index: 10, state: 'locked' }, { index: 11, state: 'locked' }, { index: 12, state: 'locked' }
      ],
      messages: [
        { id: 'm1', author: '余岚', handle: 'yu-lan', level: 4, body: '第 7 块地浇过水了。', at: '18:42' },
        { id: 'm2', author: '林栖', handle: 'lin-qi', level: 1, body: '来过，看门熊猫守住了第 1 块地。', at: '17:18' }
      ]
    },
    {
      id: 'lin-qi', handle: 'lin-qi', name: '林栖', level: 1, avatar: 'assets/mascot/panda-avatar-mint-512.webp', mine: false,
      watchdog: false, plotCount: 6,
      plots: [
        { index: 1, state: 'mature', crop: 'token_tomato', readyIn: 0, needsWater: false, needsWeed: false, stealCount: 0 },
        { index: 2, state: 'mature', crop: 'cache_cabbage', readyIn: 0, needsWater: false, needsWeed: false, stealCount: 1 },
        { index: 3, state: 'growing', crop: 'context_corn', readyIn: 1860, needsWater: true, needsWeed: false, stealCount: 0 },
        { index: 4, state: 'empty' }, { index: 5, state: 'empty' }, { index: 6, state: 'growing', crop: 'lora_lettuce', readyIn: 12400, needsWater: false, needsWeed: false, stealCount: 0 },
        { index: 7, state: 'locked' }, { index: 8, state: 'locked' }, { index: 9, state: 'locked' }, { index: 10, state: 'locked' }, { index: 11, state: 'locked' }, { index: 12, state: 'locked' }
      ], messages: [{ id: 'm3', author: '陈墨', handle: 'chen-mo', level: 3, body: '向量萝卜长得真快。', at: '16:30' }]
    },
    {
      id: 'yu-lan', handle: 'yu-lan', name: '余岚', level: 4, avatar: 'assets/mascot/panda-avatar-mist-purple-512.webp', mine: false,
      watchdog: false, plotCount: 9,
      plots: [
        { index: 1, state: 'growing', crop: 'gpu_pumpkin', readyIn: 38800, needsWater: true, needsWeed: true, stealCount: 0 },
        { index: 2, state: 'growing', crop: 'eval_berry', readyIn: 22100, needsWater: true, needsWeed: false, stealCount: 0 },
        { index: 3, state: 'growing', crop: 'rag_pepper', readyIn: 4800, needsWater: false, needsWeed: true, stealCount: 0 },
        { index: 4, state: 'empty' }, { index: 5, state: 'empty' }, { index: 6, state: 'empty' },
        { index: 7, state: 'growing', crop: 'agent_mushroom', readyIn: 8200, needsWater: false, needsWeed: false, stealCount: 0 },
        { index: 8, state: 'empty' }, { index: 9, state: 'empty' },
        { index: 10, state: 'locked' }, { index: 11, state: 'locked' }, { index: 12, state: 'locked' }
      ], messages: []
    },
    {
      id: 'song-yuan', handle: 'song-yuan', name: '松原', level: 5, avatar: 'assets/mascot/panda-avatar-graphite-512.webp', mine: false,
      watchdog: true, plotCount: 7,
      plots: [
        { index: 1, state: 'mature', crop: 'diff_melon', readyIn: 0, needsWater: false, needsWeed: false, stealCount: 0 },
        { index: 2, state: 'growing', crop: 'embedding_eggplant', readyIn: 2800, needsWater: false, needsWeed: false, stealCount: 0 },
        { index: 3, state: 'empty' }, { index: 4, state: 'empty' }, { index: 5, state: 'empty' }, { index: 6, state: 'empty' },
        { index: 7, state: 'growing', crop: 'context_corn', readyIn: 1200, needsWater: true, needsWeed: false, stealCount: 0 },
        { index: 8, state: 'locked' }, { index: 9, state: 'locked' }, { index: 10, state: 'locked' }, { index: 11, state: 'locked' }, { index: 12, state: 'locked' }
      ], messages: [{ id: 'm4', author: '看门熊猫', body: '今晚值班中。', at: '19:05' }]
    }
  ]
};


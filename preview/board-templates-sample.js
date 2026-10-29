/* LG-4 R2: populated demo knowledge/code cards. */
window.COMMONS_BOARD_TEMPLATES_SAMPLE = { list: [
    {
      id: 'knowledge',
      name: '知识卡引用',
      desc: '从知识地图挑一条，带佐证人数',
      items: [
        {
          kind: 'card', variant: 'knowledge', x: 0, y: 0, w: 340, h: 168,
          bind: {
            source: 'knowledge',
            prefer: ['ku151', 'ku139', 'ku042'],
            fallback: { id: 'ku151', title: '交给 Agent 前的任务说明检查表', question: '交给 Agent 之前，任务说明里要写清哪些东西？', corroboration: 5, status: 'verified' }
          },
          title: '{title}', text: '{question}', meta: '{corroboration} 人佐证 · {statusLabel}'
        }
      ]
    },
    {
      id: 'code',
      name: '代码块卡',
      desc: '等宽字体，适合贴命令',
      items: [
        { kind: 'card', variant: 'code', x: 0, y: 0, w: 440, h: 176, title: 'bash · 验收命令', text: 'node --check preview/board.js\npython3 tools/lint-tokens.py \\\n  --files preview/board.css\n# 期望：合计 0 条' }
      ]
    }
] };

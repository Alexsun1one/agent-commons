/* R13 ONB-1 · 新人引导与账号中心的离线示例。所有记录均为合成演示。 */
(function () {
  'use strict';

  window.COMMONS_ONBOARD_SAMPLE = {
    schemaVersion: 1,
    sample: true,
    directions: ['编程', '智能体', '设计', '产品', '内容', '知识管理', '自动化', '本地模型'],
    fallbackTools: ['Codex', 'Claude Code', 'Cursor', 'ChatGPT / GPT', 'Claude', 'Dify', 'n8n', 'Obsidian', 'Figma', 'ComfyUI', 'Ollama', '飞书 / 多维表格'],
    pandas: [
      { id: 'brand-blue', label: '先锋蓝' },
      { id: 'classic', label: '经典黑白' },
      { id: 'graphite', label: '石墨灰' },
      { id: 'mint', label: '薄荷青' },
      { id: 'mist-purple', label: '雾紫' },
      { id: 'night-sky', label: '夜空蓝' }
    ],
    firstActions: [
      { id: 'answer', title: '回答一个待解决的问题', note: '从一条具体问题开始，让经验被下一位队员复用。', href: '#/threads', icon: 'question' },
      { id: 'hot', title: '看今天的热点', note: '先看变化，再挑一个值得投入的方向。', href: '#/hot', icon: 'spark' },
      { id: 'connect', title: '接入你的 Agent', note: '给 Agent 最小权限，先完成一次可撤销的连接。', href: '#/connect', icon: 'agent' }
    ],
    account: {
      me: { handle: 'pioneer_demo', display_name: '新队员', level: 1, status: 'active', totp_enabled: false, metering_consent: true },
      devices: [
        { id: 'device-current', name: 'Mac · Safari', place: '洛杉矶', seen: '当前设备', current: true },
        { id: 'device-phone', name: 'iPhone · Safari', place: '洛杉矶', seen: '昨天 22:14', current: false },
        { id: 'device-studio', name: 'Windows · Edge', place: '上海', seen: '10.22 09:40', current: false }
      ],
      agents: [
        { id: 'agent-codex', name: '我的编码 Agent', href: '#/agents', scope: '读作品 · 写草稿', token: 'cma_demo_••••A72F', used: '今天 10:08' },
        { id: 'agent-notes', name: '知识整理 Agent', href: '#/agents', scope: '读知识 · 写建议', token: 'cma_demo_••••C91K', used: '10.24 18:32' }
      ],
      visibility: [
        ['self', '仅自己'],
        ['invited', '受邀成员'],
        ['members', '社区成员']
      ]
    }
  };
})();

/* R13 TOOLS-1 · 合成示例。工具字段、价格档、人数、评分、成员与短评均为示例，待治理复核。 */
(function () {
  'use strict';

  var PEOPLE = [
    { handle: 'chen-mo', name: '陈墨', level: 3, profilePublic: true },
    { handle: 'yu-lan', name: '余岚', level: 4, profilePublic: true },
    { handle: 'song-yuan', name: '松原', level: 5, profilePublic: true },
    { handle: 'lin-qi', name: '林栖', level: 1, profilePublic: true },
    { handle: 'lin-qi', name: '林栖', level: 1, profilePublic: false }
  ];

  var SEEDS = [
    ['claude-code','Claude Code','Anthropic','编程 Agent','https://www.anthropic.com/claude-code','订阅',['终端','代码','Agent'],'在终端里理解代码库、修改文件并执行开发任务。',196,24,4.7,38],
    ['cursor','Cursor','Anysphere','编程 Agent','https://cursor.com','订阅',['编辑器','代码','Agent'],'把代码生成、检索和多文件修改放进编辑器工作流。',182,19,4.5,31],
    ['codex','Codex','OpenAI','编程 Agent','https://openai.com/codex','按量',['终端','代码','并行'],'在明确边界内读代码、落改动并给出可核验证据。',168,27,4.6,44],
    ['github-copilot','GitHub Copilot','GitHub','编程 Agent','https://github.com/features/copilot','订阅',['编辑器','补全','代码'],'在常用编辑器和代码托管流程里辅助编写与解释代码。',151,12,4.2,26],
    ['cline','Cline','Cline','编程 Agent','https://cline.bot','免费',['编辑器','开源','Agent'],'在编辑器侧执行带工具调用的代码任务。',79,14,4.1,12],
    ['aider','Aider','Aider','编程 Agent','https://aider.chat','免费',['终端','开源','Git'],'以终端对话方式处理代码库里的定向修改。',58,8,null,4],
    ['chatgpt','ChatGPT','OpenAI','对话模型','https://chatgpt.com','订阅',['对话','研究','多模态'],'用于日常问答、写作、分析与多模态协作。',221,31,4.3,56],
    ['claude','Claude','Anthropic','对话模型','https://claude.ai','订阅',['对话','长文','分析'],'用于长文理解、分析、写作和复杂任务协作。',203,25,4.6,47],
    ['gemini','Gemini','Google','对话模型','https://gemini.google.com','订阅',['对话','多模态','研究'],'用于多模态问答、资料理解与内容生成。',134,18,4.0,22],
    ['deepseek','DeepSeek','DeepSeek','对话模型','https://chat.deepseek.com','免费',['对话','推理','代码'],'用于推理、代码讨论和中文问答。',126,29,4.2,19],
    ['kimi','Kimi','Moonshot AI','对话模型','https://kimi.com','订阅',['中文','长文','搜索'],'用于中文长文阅读、整理与问答。',119,17,null,3],
    ['doubao','豆包','字节跳动','对话模型','https://www.doubao.com','免费',['中文','对话','多模态'],'用于中文问答、内容处理和多模态任务。',93,11,null,4],
    ['ollama','Ollama','Ollama','本地模型','https://ollama.com','免费',['本地','模型运行','开发'],'在本机拉起和管理可用的开放模型。',142,22,4.4,27],
    ['lm-studio','LM Studio','LM Studio','本地模型','https://lmstudio.ai','免费',['本地','图形界面','模型运行'],'用图形界面下载、试用并提供本地模型接口。',84,9,4.1,11],
    ['open-webui','Open WebUI','Open WebUI','本地模型','https://openwebui.com','免费',['本地','开源','界面'],'为本地或自托管模型提供对话与管理界面。',67,13,null,4],
    ['n8n','n8n','n8n','自动化','https://n8n.io','订阅',['工作流','集成','自动化'],'用可视化节点连接服务并运行自动化流程。',116,20,4.5,18],
    ['zapier','Zapier','Zapier','自动化','https://zapier.com','订阅',['工作流','集成','SaaS'],'连接常用在线服务并自动执行重复任务。',88,7,4.0,15],
    ['make','Make','Make','自动化','https://www.make.com','订阅',['工作流','可视化','集成'],'用可视化流程编排多步骤自动化。',72,10,null,4],
    ['obsidian','Obsidian','Obsidian','知识管理','https://obsidian.md','免费',['本地优先','Markdown','双链'],'以本地 Markdown 文件组织笔记、链接和长期知识。',174,16,4.8,42],
    ['notion','Notion','Notion','知识管理','https://www.notion.so','订阅',['文档','数据库','协作'],'把文档、数据库和团队协作放进统一工作区。',149,9,4.1,34],
    ['logseq','Logseq','Logseq','知识管理','https://logseq.com','免费',['本地优先','大纲','双链'],'用大纲和双向链接管理本地知识。',61,6,null,3],
    ['figma','Figma','Figma','设计','https://www.figma.com','订阅',['界面设计','协作','原型'],'协作完成界面设计、组件系统与交互原型。',187,15,4.7,49],
    ['canva','Canva','Canva','设计','https://www.canva.com','订阅',['平面设计','模板','协作'],'快速制作社交图片、演示和常见视觉内容。',101,12,4.2,21],
    ['comfyui','ComfyUI','ComfyUI','设计','https://www.comfy.org','免费',['生图','节点','本地'],'用节点工作流搭建和复用本地生成图流程。',76,18,4.4,14]
  ];

  var REVIEW_TEXT = {
    '编程 Agent': ['适合跨文件任务，先把边界和验收写清楚会更稳。','用在重复改造上很省时间，关键步骤仍要自己复核。'],
    '对话模型': ['我主要用它整理材料和找反例，长任务会拆成几轮。','中文交流顺手，但涉及事实时仍会回到原始来源。'],
    '本地模型': ['适合处理不出本机的材料，模型和硬件配置要单独记录。','搭好以后很顺手，第一次配置需要留出排错时间。'],
    '自动化': ['稳定流程很好用，分支多时要把失败和重试画清楚。','先从一个可回滚的小流程开始，维护成本更容易看见。'],
    '知识管理': ['长期积累很好用，目录、链接和命名要先约定。','真正有价值的是可回到来源，不是把资料搬进来。'],
    '设计': ['协作和交付很方便，组件命名统一后效率明显更高。','适合快速比较方向，最终细节仍要在真实画面里检查。']
  };

  function make(seed, index) {
    var category = seed[3];
    var total = seed[8];
    var weekly = [];
    for (var i = 0; i < 12; i += 1) weekly.push(Math.max(1, Math.round(total * (.42 + i * .053))));
    var people = [PEOPLE[index % PEOPLE.length], PEOPLE[(index + 1) % PEOPLE.length], PEOPLE[(index + 3) % PEOPLE.length]];
    var texts = REVIEW_TEXT[category];
    return {
      id: 'tool-' + String(index + 1).padStart(2, '0'), slug: seed[0], name: seed[1], vendor: seed[2],
      category: category, official_url: seed[4], price_tier: seed[5], tags: seed[6], summary: seed[7],
      use_count: total, month_new_count: seed[9], rating: { median: seed[10], count: seed[11], label: seed[10] == null ? '评价不足' : null },
      reviews: [
        { id: seed[0] + '-r1', author: { handle: people[0].handle, display_name: people[0].name, level: people[0].level }, rating: index % 3 === 0 ? 5 : 4, body: texts[0], helpful_count: 11 + index % 8 },
        { id: seed[0] + '-r2', author: { handle: people[1].handle, display_name: people[1].name, level: people[1].level }, rating: 4, body: texts[1], helpful_count: 5 + index % 6 }
      ],
      top_review: null, public_users: people.filter(function (person) { return person.profilePublic; }),
      trend: weekly.map(function (value, week) { return { week: 'W' + String(week + 1).padStart(2, '0'), total: value, new: week ? value - weekly[week - 1] : value }; }),
      related: {
        skills: [{ title: category === '设计' ? '截图找茬' : category === '知识管理' ? '来源台账' : '改动边界守卫', href: '#/skills' }],
        prompts: [{ title: category === '自动化' ? '失败路径评审' : '论断缺口检查', href: '#/prompts' }],
        questions: [{ title: '这个工具最适合替代哪一步？', href: '#/solved' }]
      },
      commercial: { claimed_by: null, sponsored: null }, sample: true
    };
  }

  var rows = SEEDS.map(make);
  rows.forEach(function (row) { row.top_review = row.reviews[0]; });
  window.COMMONS_TOOLS_SAMPLE = rows;
})();


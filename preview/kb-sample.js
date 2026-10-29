/* R13 KB-1 · 问题库合成样例。所有人物、数据与次数均为示例。 */
(function () {
  'use strict';

  window.COMMONS_KB_SAMPLE = {
    stats: { solvedThisWeek: 23, duplicatesStopped: 61 },
    tools: [
      ['all', '全部工具'], ['codex', 'Codex'], ['claude-code', 'Claude Code'],
      ['cursor', 'Cursor'], ['ollama', 'Ollama'], ['openai-gpt', 'ChatGPT / GPT']
    ],
    industries: [
      ['all', '全部行业'], ['education', '教育'], ['ecommerce', '电商零售'],
      ['manufacturing', '制造业'], ['content', '内容创作'], ['research', '科研学术']
    ],
    problems: [
      {
        id: 'kb-py-path', title: 'Python 脚本换台机器就找不到配置文件',
        phenomenon: '在开发者电脑可以运行，交给同事或放进自动任务后立刻退出。',
        error_signature: "FileNotFoundError: [Errno 2] No such file or directory: '/Users/name/project/config.yaml'",
        status: 'verified', stale_hint: false, industry_key: 'education',
        environments: [
          { tool_key: 'codex', version: 'CLI 0.86', system: 'macOS 15' },
          { tool_key: 'claude-code', version: '2.0', system: 'Ubuntu 24.04' }
        ],
        root_cause: '代码把开发者机器上的绝对路径写死了，运行目录改变后仍去原位置找文件。',
        steps: ['把配置路径改为相对当前脚本文件解析', '启动时检查文件是否存在，并在报错里打印预期位置', '在另一台机器和自动任务里各运行一次'],
        verification: { success: 4, failed: 1, environments: ['macOS 15 · Python 3.12', 'Ubuntu 24.04 · Python 3.12', 'Windows 11 · Python 3.11'] },
        related: ['Node 构建时找不到本地模块'], updated_at: '2026-10-25'
      },
      {
        id: 'kb-node-module', title: 'Node 构建时找不到本地模块',
        phenomenon: '本机开发正常，CI 执行构建时报模块不存在。',
        error_signature: "Error: Cannot find module '/workspace/src/runtime.js'",
        status: 'pending', stale_hint: false, industry_key: 'ecommerce',
        environments: [{ tool_key: 'cursor', version: '1.7', system: 'Ubuntu 24.04 CI' }],
        root_cause: '导入路径大小写与文件名不一致；macOS 默认文件系统没有暴露这个差异。',
        steps: ['核对导入路径和文件名的大小写', '在 CI 同系统容器内重新执行构建', '加入区分大小写的路径检查'],
        verification: { success: 2, failed: 0, environments: ['Ubuntu 24.04 · Node 22', 'Debian 12 · Node 22'] },
        related: ['Python 脚本换台机器就找不到配置文件'], updated_at: '2026-10-24'
      },
      {
        id: 'kb-rust-openssl', title: 'Cargo 编译时找不到 OpenSSL',
        phenomenon: '升级系统后，原本能编译的 Rust 项目在链接阶段失败。',
        error_signature: 'error: could not find native static library `ssl`, perhaps an -L flag is missing?',
        status: 'stale', stale_hint: true, industry_key: 'manufacturing',
        environments: [{ tool_key: 'codex', version: 'CLI 0.72', system: 'Ubuntu 22.04' }],
        root_cause: '系统 OpenSSL 开发包缺失，且旧版构建说明固定了已过时的包名。',
        steps: ['确认当前发行版和 OpenSSL 大版本', '安装对应的开发包', '清理 Cargo 缓存后重新构建'],
        verification: { success: 3, failed: 2, environments: ['Ubuntu 22.04 · Rust 1.80', 'Debian 12 · Rust 1.81'] },
        related: [], updated_at: '2026-08-19'
      },
      {
        id: 'kb-browser-csp', title: '浏览器控制台拒绝加载内联脚本',
        phenomenon: '页面能打开，但按钮没有反应；控制台出现 CSP 拒绝信息。',
        error_signature: "Refused to execute inline script because it violates the following Content Security Policy directive: 'script-src self'",
        status: 'verified', stale_hint: false, industry_key: 'content',
        environments: [{ tool_key: 'openai-gpt', version: 'Web', system: 'Chrome 141' }],
        root_cause: '页面使用了内联事件处理器，而站点 CSP 只允许同源外部脚本。',
        steps: ['把内联脚本移到同源 JS 文件', '用 addEventListener 绑定事件', '保留严格 CSP 并复测交互'],
        verification: { success: 5, failed: 0, environments: ['Chrome 141 · macOS', 'Edge 141 · Windows'] },
        related: [], updated_at: '2026-10-23'
      }
    ],
    capture: {
      source: { kind: 'thread', id: 'post-demo', label: '讨论串第 184 号' },
      question: '我用 Codex 跑 Python 工具，本机正常，换到同事电脑就说找不到 config.yaml。路径里还带着我的用户名。',
      accepted: '不要写死 /Users/你的名字。用脚本自身目录拼 config.yaml，启动前先检查并把预期路径打出来。',
      draft: {
        title: 'Python 脚本换机器后找不到配置文件',
        phenomenon: '本机正常，换一台机器后提示找不到 config.yaml。',
        signature: 'FileNotFoundError: No such file or directory: <path>/config.yaml',
        rootCause: '配置文件使用了开发者机器上的绝对路径。'
      }
    }
  };

  var authors = [
    { handle: 'lin-qi', name: '林栖', level: 1 },
    { handle: 'chen-mo', name: '陈墨', level: 3 },
    { handle: 'yu-lan', name: '余岚', level: 4 },
    { handle: 'song-yuan', name: '松原', level: 5 }
  ];
  var knowledge = [
    { kind: 'knowledge', id: 'k1', label: '有证据的 RAG' },
    { kind: 'knowledge', id: 'k2', label: '可接管的工作流' },
    { kind: 'knowledge', id: 'k3', label: '可解释的原型' },
    { kind: 'knowledge', id: 'k4', label: '保留条件与分歧' }
  ];
  window.COMMONS_KB_SAMPLE.problems.forEach(function (problem, index) {
    problem.author = authors[index % authors.length];
    problem.related = [knowledge[index % knowledge.length], knowledge[(index + 1) % knowledge.length]];
  });
})();


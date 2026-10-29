/* 品牌 logo：只用来标出工具、模型和来源是谁家的。文件与许可见 assets/logos/LOGOS.md。 */
(function () {
  'use strict';

  var FILES = ['anthropic', 'arxiv', 'bytedance', 'claude', 'claude-code', 'cline', 'codex', 'comfyui', 'cursor', 'deepmind', 'deepseek', 'doubao', 'figma', 'gemini', 'github', 'github-copilot', 'google', 'grok', 'hacker-news', 'hermes', 'huggingface', 'kimi', 'langchain', 'lm-studio', 'logseq', 'make', 'moonshot', 'n8n', 'notion', 'obsidian', 'ollama', 'open-webui', 'openai', 'openclaw', 'producthunt', 'qwen', 'xai', 'zapier'];
  // 这几家只有官方站点图标（位图），没有矢量标。
  var PNG = ['aider', 'canva', 'sspai', 'jiqizhixin', 'qbitai', 'latent-space'];
  var ALIAS = {
    chatgpt: 'openai', gpt: 'openai', 'claude-desktop': 'claude', 'claude-ai': 'claude', copilot: 'github-copilot',
    'google-ai': 'google', 'hf-blog': 'huggingface', 'hugging-face': 'huggingface', hn: 'hacker-news', 'arxiv-ai': 'arxiv',
    'gh-trending': 'github', lmstudio: 'lm-studio', openwebui: 'open-webui', 'nous-research': 'hermes', 'x-ai': 'xai'
  };

  function key(id) {
    var k = String(id || '').trim().toLowerCase().replace(/\s+/g, '-');
    k = ALIAS[k] || k;
    return FILES.indexOf(k) >= 0 || PNG.indexOf(k) >= 0 ? k : '';
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
  }

  function src(id) {
    var k = key(id);
    return k ? 'assets/logos/' + k + (PNG.indexOf(k) >= 0 ? '.png' : '.svg') : '';
  }

  // size: 'sm' 24px · 默认 32px · 'lg' 48px。没有 logo 时回退成首字母方块。
  function html(id, name, opts) {
    var size = opts && opts.size ? ' is-' + esc(opts.size) : '';
    var k = key(id);
    if (k) return '<span class="brand-logo' + size + '" aria-hidden="true"><img src="' + /* safe: src() 只返回白名单内的本地 assets 路径 */ esc(src(k)) + '" alt="" loading="lazy" decoding="async"></span>';
    var initial = Array.from(String(name || id || '?').trim())[0] || '?';
    return '<span class="brand-logo is-mono' + size + '" aria-hidden="true">' + esc(initial.toUpperCase()) + '</span>';
  }

  window.CommonsLogo = { has: function (id) { return !!key(id); }, src: src, html: html };
})();

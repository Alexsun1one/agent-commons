-- OPEN-1 · 公开层：公开快照、开放数据集、爬虫策略、站点配置、爬虫计数
-- 只动 public_* / crawler_policy 表和 public.* 动作规则、public.enabled 开关；其他模块的行一概不碰。
-- 开关默认关：public.enabled = 0，上线要 Sun 拍板（FZ-05 不发布）。

CREATE TABLE public_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES principal(id)
) STRICT, WITHOUT ROWID;

CREATE TABLE public_snapshot (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL,
  object_version INTEGER NOT NULL CHECK (object_version >= 1),
  kind TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  markdown TEXT NOT NULL,
  html TEXT NOT NULL,
  search_text TEXT NOT NULL DEFAULT '',
  license TEXT NOT NULL,
  license_consent INTEGER NOT NULL DEFAULT 0 CHECK (license_consent IN (0, 1)),
  publisher_id TEXT NOT NULL REFERENCES principal(id),
  publisher_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'live')),
  screen_result TEXT NOT NULL DEFAULT 'pass',
  screen_reasons TEXT NOT NULL DEFAULT '[]',
  jsonld_type TEXT NOT NULL DEFAULT 'Article',
  meta_json TEXT NOT NULL DEFAULT '{}',
  source_hash TEXT NOT NULL,
  published_at TEXT NOT NULL,
  taken_down_at TEXT,
  takedown_reason TEXT,
  created_at TEXT NOT NULL
) STRICT;

-- 同一个公开链接只能有一个在线快照；下线的旧版本留在表里给 410 和审计用。
CREATE UNIQUE INDEX public_snapshot_live_slug ON public_snapshot(kind, slug)
  WHERE status = 'live' AND taken_down_at IS NULL;
CREATE INDEX public_snapshot_by_object ON public_snapshot(object_id, object_version);
CREATE INDEX public_snapshot_recent ON public_snapshot(published_at DESC, id);
CREATE INDEX public_snapshot_by_kind ON public_snapshot(kind, published_at DESC);
CREATE INDEX public_snapshot_by_status ON public_snapshot(status, taken_down_at);

CREATE TABLE public_dataset (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  license TEXT NOT NULL,
  columns_json TEXT NOT NULL,
  rows_json TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  sha256 TEXT NOT NULL,
  reviewed INTEGER NOT NULL DEFAULT 0 CHECK (reviewed IN (0, 1)),
  reviewed_by TEXT REFERENCES principal(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES principal(id)
) STRICT;

CREATE UNIQUE INDEX public_dataset_version ON public_dataset(name, version);
CREATE INDEX public_dataset_latest ON public_dataset(name, created_at DESC);

CREATE TABLE crawler_policy (
  id TEXT PRIMARY KEY,
  crawler_key TEXT NOT NULL UNIQUE,
  user_agent TEXT NOT NULL,
  vendor TEXT NOT NULL,
  purpose TEXT NOT NULL,
  welcome INTEGER NOT NULL DEFAULT 1 CHECK (welcome IN (0, 1)),
  source_url TEXT NOT NULL DEFAULT '',
  source_note TEXT NOT NULL DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES principal(id)
) STRICT;

-- 只记「哪个爬虫哪天来了多少次」，不落 IP、不落 UA 原串。
CREATE TABLE public_crawler_hit (
  crawler_key TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (crawler_key, day)
) STRICT, WITHOUT ROWID;

INSERT OR IGNORE INTO public_config (key, value, updated_at) VALUES
  ('site.name', '智能体先锋队', '2026-10-25T00:00:00.000000Z'),
  ('site.description', '中文 AI 实践者社区。公开层放作者主动发布的知识卡、公开讲堂、热点日报、工具热度周榜和开放数据集；成员私域、讨论和个人页永远不在这里。', '2026-10-25T00:00:00.000000Z'),
  ('site.lang', 'zh-CN', '2026-10-25T00:00:00.000000Z'),
  ('license.default', 'undecided', '2026-10-25T00:00:00.000000Z'),
  ('citation.format', '{publisher}：《{title}》，智能体先锋队，{date}。{url}', '2026-10-25T00:00:00.000000Z'),
  ('llms.max_bytes', '262144', '2026-10-25T00:00:00.000000Z'),
  ('feed.max_items', '50', '2026-10-25T00:00:00.000000Z'),
  ('sitemap.shard_size', '5000', '2026-10-25T00:00:00.000000Z'),
  ('rate.page_per_min', '120', '2026-10-25T00:00:00.000000Z'),
  ('rate.api_per_min', '60', '2026-10-25T00:00:00.000000Z'),
  ('rate.ua_per_min', '600', '2026-10-25T00:00:00.000000Z'),
  ('rate.ai_per_min', '600', '2026-10-25T00:00:00.000000Z'),
  ('crawlers.content_signal', '', '2026-10-25T00:00:00.000000Z'),
  ('dataset.tool_heat', 'tool-heat', '2026-10-25T00:00:00.000000Z');

-- 名单来自各厂商官方文档的 UA token；离线整理，verified=0 表示等主控联网核对。
INSERT OR IGNORE INTO crawler_policy
  (id, crawler_key, user_agent, vendor, purpose, welcome, source_url, source_note, verified, updated_at) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'gptbot', 'GPTBot', 'OpenAI', '训练与产品改进', 1,
   'https://platform.openai.com/docs/bots', '离线整理，待核', 0, '2026-10-25T00:00:00.000000Z'),
  ('c0000000-0000-4000-8000-000000000002', 'oai-searchbot', 'OAI-SearchBot', 'OpenAI', '搜索索引', 1,
   'https://platform.openai.com/docs/bots', '离线整理，待核', 0, '2026-10-25T00:00:00.000000Z'),
  ('c0000000-0000-4000-8000-000000000003', 'chatgpt-user', 'ChatGPT-User', 'OpenAI', '用户触发的实时取页', 1,
   'https://platform.openai.com/docs/bots', '离线整理，待核', 0, '2026-10-25T00:00:00.000000Z'),
  ('c0000000-0000-4000-8000-000000000004', 'claudebot', 'ClaudeBot', 'Anthropic', '训练', 1,
   'https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler',
   '离线整理，待核', 0, '2026-10-25T00:00:00.000000Z'),
  ('c0000000-0000-4000-8000-000000000005', 'claude-user', 'Claude-User', 'Anthropic', '用户触发的实时取页', 1,
   'https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler',
   '离线整理，待核', 0, '2026-10-25T00:00:00.000000Z'),
  ('c0000000-0000-4000-8000-000000000006', 'claude-searchbot', 'Claude-SearchBot', 'Anthropic', '搜索索引', 1,
   'https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler',
   '离线整理，待核', 0, '2026-10-25T00:00:00.000000Z'),
  ('c0000000-0000-4000-8000-000000000007', 'perplexitybot', 'PerplexityBot', 'Perplexity', '搜索索引', 1,
   'https://docs.perplexity.ai/guides/bots', '离线整理，待核', 0, '2026-10-25T00:00:00.000000Z'),
  ('c0000000-0000-4000-8000-000000000008', 'perplexity-user', 'Perplexity-User', 'Perplexity', '用户触发的实时取页', 1,
   'https://docs.perplexity.ai/guides/bots', '离线整理，待核', 0, '2026-10-25T00:00:00.000000Z'),
  ('c0000000-0000-4000-8000-000000000009', 'google-extended', 'Google-Extended', 'Google', 'AI 训练与 grounding；不影响搜索收录', 1,
   'https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers', '离线整理，待核', 0,
   '2026-10-25T00:00:00.000000Z'),
  ('c0000000-0000-4000-8000-000000000010', 'applebot-extended', 'Applebot-Extended', 'Apple', 'AI 训练', 1,
   'https://support.apple.com/en-us/119829', '离线整理，待核', 0, '2026-10-25T00:00:00.000000Z'),
  ('c0000000-0000-4000-8000-000000000011', 'ccbot', 'CCBot', 'Common Crawl', '开放语料', 1,
   'https://commoncrawl.org/faq', '离线整理，待核', 0, '2026-10-25T00:00:00.000000Z'),
  ('c0000000-0000-4000-8000-000000000012', 'bytespider', 'Bytespider', '字节跳动', '训练', 1,
   'https://www.bytespider.com/', '官方说明待核', 0, '2026-10-25T00:00:00.000000Z'),
  ('c0000000-0000-4000-8000-000000000013', 'amazonbot', 'Amazonbot', 'Amazon', '搜索与 Alexa 相关取页', 1,
   'https://developer.amazon.com/support/amazonbot', '离线整理，待核', 0, '2026-10-25T00:00:00.000000Z'),
  ('c0000000-0000-4000-8000-000000000014', 'meta-externalagent', 'meta-externalagent', 'Meta', 'AI 训练', 1,
   'https://developers.facebook.com/docs/sharing/webmasters/web-crawlers', '离线整理，待核', 0,
   '2026-10-25T00:00:00.000000Z'),
  ('c0000000-0000-4000-8000-000000000015', 'duckassistbot', 'DuckAssistBot', 'DuckDuckGo', 'DuckAssist 取页', 1,
   'https://duckduckgo.com/duckduckgo-help-pages/duckassist/', '官方说明待核', 0, '2026-10-25T00:00:00.000000Z'),
  ('c0000000-0000-4000-8000-000000000016', 'cohere-ai', 'cohere-ai', 'Cohere', '训练', 1,
   'https://docs.cohere.com/docs/crawling', '官方说明待核', 0, '2026-10-25T00:00:00.000000Z'),
  ('c0000000-0000-4000-8000-000000000017', 'mistralai-user', 'MistralAI-User', 'Mistral', '用户触发的实时取页', 1,
   'https://help.mistral.ai/', '官方说明待核', 0, '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO action_rule (action, min_level, roles, owner_only, require_totp, flag, note, updated_at) VALUES
  ('public.publish', 1, '[]', 1, 0, NULL, '作者把指定版本发布到公开层', '2026-10-25T00:00:00.000000Z'),
  ('public.unpublish', 1, '[]', 1, 0, NULL, '作者把自己的快照从公开层下线', '2026-10-25T00:00:00.000000Z'),
  ('public.moderate', NULL, '["admin"]', 0, 1, NULL, '审批或下线公开快照；GOV-1 合并后把 gov 角色加进来', '2026-10-25T00:00:00.000000Z'),
  ('public.crawlers', NULL, '["admin"]', 0, 1, NULL, '调整爬虫名单和欢迎与否，改动进审计', '2026-10-25T00:00:00.000000Z'),
  ('public.dataset', NULL, '["admin"]', 0, 1, NULL, '登记已审的开放数据集版本', '2026-10-25T00:00:00.000000Z'),
  ('public.config', NULL, '["admin"]', 0, 1, NULL, '改公开层站点配置（许可、限流、大小上限）', '2026-10-25T00:00:00.000000Z');

INSERT OR IGNORE INTO feature_flag (key, enabled, description, updated_at) VALUES
  ('public.enabled', 0,
   '公开层（robots、sitemap、llms.txt、服务端渲染公开页、feed、开放数据集、公开只读 API 与 MCP 工具描述）；默认关，上线由 Sun 拍板',
   '2026-10-25T00:00:00.000000Z');

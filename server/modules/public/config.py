"""公开层的常量与配置。

所有可调项都落在 public_config 表里（迁移给默认值，管理接口改值并记审计），
代码只读这张表，不把许可、限流、分卷大小写死在逻辑里。
"""

KINDS = {
    'knowledge': {'label': '实践知识', 'jsonld': 'Article', 'order': 10},
    'qa': {'label': '已解决的问题', 'jsonld': 'QAPage', 'order': 20},
    'skill': {'label': 'Skill', 'jsonld': 'HowTo', 'order': 30},
    'prompt': {'label': '提示词', 'jsonld': 'CreativeWork', 'order': 40},
    'tool': {'label': 'AI 工具', 'jsonld': 'SoftwareApplication', 'order': 50},
    'component': {'label': '组件', 'jsonld': 'CreativeWork', 'order': 60},
    'product': {'label': '产品形态', 'jsonld': 'CreativeWork', 'order': 70},
    'hot': {'label': '热点摘要', 'jsonld': 'NewsArticle', 'order': 80},
    'trend': {'label': '话题数据', 'jsonld': 'Dataset', 'order': 90},
    'talk': {'label': '公开讲堂', 'jsonld': 'Event', 'order': 100},
    'event': {'label': '公开活动', 'jsonld': 'Event', 'order': 110},
    'discussion': {'label': '公开讨论', 'jsonld': 'DiscussionForumPosting', 'order': 120},
    'term': {'label': '术语', 'jsonld': 'DefinedTerm', 'order': 130},
}

SCHEMA_VERSION = '1.0'

# llms.txt 不只列当前有内容的类型；固定目录让 Agent 可以长期依赖。
LLMS_SECTIONS = (
    ('问答', ('qa',), '每日', '已验证的问题、根因和采纳解法'),
    ('Skill', ('skill',), '每周', '可复用的 Skill，带输入、输出和使用条件'),
    ('提示词', ('prompt',), '每周', '带变量、输入和输出示例的提示词'),
    ('话题数据', ('trend', 'hot'), '每日 / 每周', '热点聚类、来源链接和话题漂移聚合'),
    ('讲堂', ('talk',), '活动后更新', '公开讲堂的要点与逐字稿'),
)

LICENSES = {
    'undecided': {'label': '许可待定', 'url': '', 'note': '发布时由作者和主控确认'},
    'cc-by-4.0': {'label': 'CC BY 4.0', 'url': 'https://creativecommons.org/licenses/by/4.0/', 'note': '署名'},
    'cc-by-sa-4.0': {'label': 'CC BY-SA 4.0', 'url': 'https://creativecommons.org/licenses/by-sa/4.0/', 'note': '署名、相同方式共享'},
    'cc-by-nc-4.0': {'label': 'CC BY-NC 4.0', 'url': 'https://creativecommons.org/licenses/by-nc/4.0/', 'note': '署名、非商业'},
    'reserved': {'label': '保留所有权利', 'url': '', 'note': '仅供阅读和引用，不授权再发布'},
}

DEFAULTS = {
    'site.name': '智能体先锋队',
    'site.description': '',
    'site.lang': 'zh-CN',
    'license.default': 'undecided',
    'citation.format': '{publisher}：《{title}》，智能体先锋队，{date}。{url}',
    'llms.max_bytes': '262144',
    'feed.max_items': '50',
    'sitemap.shard_size': '5000',
    'rate.page_per_min': '120',
    'rate.api_per_min': '60',
    'rate.ua_per_min': '600',
    'rate.ai_per_min': '600',
    'crawlers.content_signal': '',
    'dataset.tool_heat': 'tool-heat',
}

INT_LIMITS = {
    'llms.max_bytes': (1024, 4 * 1024 * 1024),
    'feed.max_items': (1, 200),
    'sitemap.shard_size': (1, 50000),
    'rate.page_per_min': (1, 100000),
    'rate.api_per_min': (1, 100000),
    'rate.ua_per_min': (1, 100000),
    'rate.ai_per_min': (1, 100000),
}

STR_LIMITS = {
    'site.name': 40,
    'site.description': 500,
    'site.lang': 12,
    'citation.format': 300,
    'crawlers.content_signal': 200,
    'dataset.tool_heat': 60,
}

WRITABLE = frozenset(DEFAULTS) | {'license.default'}

# 根路径的公开入口；Caddy 把它们转到 /api/public/…，robots 里逐个 Allow。
PUBLIC_PATHS = ('/p/', '/datasets/', '/llms.txt', '/llms-full.txt', '/sitemap.xml', '/feed.xml', '/feed.json',
                '/openapi.json', '/.well-known/', '/mcp', '/mcp/')

# 成员区、登录、个人页、控制面一律不抓。
PRIVATE_PATHS = ('/api/', '/api/auth/', '/api/me', '/login', '/join', '/logout', '/m/', '/u/', '/admin/',
                 '/settings/', '/search')

CACHE_PAGE = 'public, max-age=300, stale-while-revalidate=86400'
CACHE_IMMUTABLE = 'public, max-age=31536000, immutable'

SLUG_PATTERN = r'^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'
NAME_PATTERN = r'^[a-z][a-z0-9-]{1,40}$'
CRAWLER_KEY_PATTERN = r'^[a-z0-9][a-z0-9-]{1,40}$'


def load(conn):
    """默认值 + 表里的值。每次请求读一次，量很小（十几行）。"""
    cfg = dict(DEFAULTS)
    for row in conn.execute('SELECT key, value FROM public_config'):
        cfg[row['key']] = row['value']
    return cfg


def as_int(cfg, key):
    try:
        value = int(cfg.get(key, DEFAULTS[key]))
    except (TypeError, ValueError):
        value = int(DEFAULTS[key])
    low, high = INT_LIMITS[key]
    return min(high, max(low, value))


def license_info(code):
    return dict(LICENSES.get(code) or LICENSES['undecided'])


def kind_info(kind):
    return KINDS.get(kind)


def public_url(origin, path):
    return origin.rstrip('/') + path if path.startswith('/') else f'{origin.rstrip("/")}/{path}'


def citation(template, *, publisher, title, date, url):
    out = template
    for key, value in (('{publisher}', publisher), ('{title}', title), ('{date}', date), ('{url}', url)):
        out = out.replace(key, value)
    return out

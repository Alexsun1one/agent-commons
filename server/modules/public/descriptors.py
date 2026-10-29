"""给机器看的发现文件：OpenAPI、A2A 风格 agent card、MCP 只读工具描述。

这些都只是描述 + 普通 HTTP GET 端点，不跑 MCP/A2A 服务，也不连任何外部系统。
"""
from . import config, render

TOOLS = [
    {
        'name': 'search_public_knowledge',
        'title': '检索公开知识',
        'description': '在公开层快照里检索标题和正文。只返回作者主动发布到公开层的内容，'
                       '成员私域和讨论永远不在结果里。',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'query': {'type': 'string', 'minLength': 1, 'maxLength': 100, 'description': '关键词'},
                'kind': {'type': 'string', 'enum': sorted(config.KINDS), 'description': '只搜某一类'},
                'limit': {'type': 'integer', 'minimum': 1, 'maximum': 50, 'default': 10},
            },
            'required': ['query'],
            'additionalProperties': False,
        },
    },
    {
        'name': 'get_tool_heat',
        'title': '查工具热度',
        'description': '读已审核的匿名聚合数据集（默认 tool-heat），返回某周或某个工具的热度行。'
                       '被抑制的格子是 null，不是 0。',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'week': {'type': 'string', 'maxLength': 16, 'description': '周标识，例如 2026-W43'},
                'tool': {'type': 'string', 'maxLength': 60, 'description': '工具名或词条 key'},
                'limit': {'type': 'integer', 'minimum': 1, 'maximum': 200, 'default': 20},
            },
            'additionalProperties': False,
        },
    },
    {
        'name': 'get_hot_digest',
        'title': '取热点日报',
        'description': '取公开层的热点日报：多源聚合、去重、只放标题和自己写的一句话，附原文链接。',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'date': {'type': 'string', 'maxLength': 10, 'description': 'YYYY-MM-DD；不填取最新'},
            },
            'additionalProperties': False,
        },
    },
]

TOOL_NAMES = frozenset(tool['name'] for tool in TOOLS)


def _license(cfg):
    info = config.license_info(cfg.get('license.default'))
    out = {'name': info['label']}
    if info['url']:
        out['url'] = info['url']
    return out


def mcp_manifest(cfg, origin):
    tools = []
    for tool in TOOLS:
        item = dict(tool)
        item['http'] = {'method': 'GET', 'url': config.public_url(origin, f'/mcp/tools/{tool["name"]}')}
        item['annotations'] = {'readOnlyHint': True, 'idempotentHint': True, 'openWorldHint': False}
        tools.append(item)
    return {
        'schemaVersion': 1,
        'name': 'commons-public',
        'title': f'{render.text(cfg.get("site.name"), 60) or "智能体先锋队"} · 公开只读工具',
        'description': render.text(cfg.get('site.description'), 500),
        'readOnly': True,
        'requiresAuth': False,
        'transport': {
            'type': 'streamable-http',
            'method': 'POST',
            'url': config.public_url(origin, '/mcp'),
        },
        'capabilities': {'resources': {'listChanged': False}, 'tools': {'listChanged': False}},
        'resources': {
            'list': config.public_url(origin, '/mcp/resources.json'),
            'read': config.public_url(origin, '/mcp/resources/read'),
            'kinds': ['qa', 'skill', 'prompt', 'trend', 'hot'],
        },
        'tools': tools,
        'license': _license(cfg),
        'note': '无需登录。MCP 支持 resources/list 与 resources/read；GET 资源端点供不支持 JSON-RPC 的抓取器降级使用。',
    }


def agent_card(cfg, origin):
    site = render.text(cfg.get('site.name'), 60) or '智能体先锋队'
    return {
        'protocolVersion': '0.2.5',
        'name': f'{site} · 公开层',
        'description': (render.text(cfg.get('site.description'), 500)
                        + ' 本卡片只描述只读能力：检索公开知识、查工具热度、取热点日报。'),
        'url': config.public_url(origin, '/mcp'),
        'preferredTransport': 'HTTP+JSON',
        'version': '1.0.0',
        'provider': {'organization': site, 'url': origin + '/'},
        'contact': {'url': origin + '/'},
        'documentationUrl': config.public_url(origin, '/mcp/tools.json'),
        'capabilities': {'streaming': False, 'pushNotifications': False, 'stateTransitionHistory': False},
        'defaultInputModes': ['application/json'],
        'defaultOutputModes': ['application/json'],
        'skills': [{'id': tool['name'], 'name': tool['title'], 'description': tool['description'],
                    'tags': ['公开层', '只读'], 'examples': []} for tool in TOOLS],
        'securitySchemes': {},
        'security': [],
        'x-read-only': True,
        'x-no-task-endpoint': '本卡不提供 A2A 任务端点；请直接调用 x-mcp-tools 里的 HTTP GET。',
        'x-mcp-tools': config.public_url(origin, '/mcp/tools.json'),
        'x-mcp-resources': config.public_url(origin, '/mcp/resources.json'),
        'x-rate-limit': {'policy': '按 IP 和 User-Agent 分桶', 'retry': '429 响应的 Retry-After'},
        'x-license': _license(cfg),
        'x-protocol-note': 'A2A 卡片字段按 0.2.5 的常见形状离线整理，版本形状待主控按官方文档核对。',
    }


def _param(name, where='path', required=True, schema=None):
    return {'name': name, 'in': where, 'required': required, 'schema': schema or {'type': 'string'}}


def _op(summary, *, root_url, produces='application/json', params=None):
    op = {
        'summary': summary,
        'responses': {'200': {'description': 'OK', 'content': {produces: {'schema': {'type': 'string'}}}},
                      '404': {'description': '不在公开层'}},
        'x-public-url': root_url,
    }
    if params:
        op['parameters'] = params
    return op


def openapi(cfg, origin):
    site = render.text(cfg.get('site.name'), 60) or '智能体先锋队'
    p = origin.rstrip('/')
    paths = {
        '/api/public/robots.txt': {'get': _op('robots.txt', root_url=p + '/robots.txt', produces='text/plain')},
        '/api/public/sitemap.xml': {'get': _op('sitemap 索引', root_url=p + '/sitemap.xml', produces='application/xml')},
        '/api/public/sitemap-{shard}.xml': {'get': _op('sitemap 分片', root_url=p + '/sitemap-{shard}.xml',
                                                       produces='application/xml',
                                                       params=[_param('shard', schema={'type': 'integer'})])},
        '/api/public/sitemap-{kind}-{shard}.xml': {'get': _op(
            '按类型的 sitemap 分片', root_url=p + '/sitemap-{kind}-{shard}.xml',
            produces='application/xml', params=[_param('kind'), _param('shard', schema={'type': 'integer'})])},
        '/api/public/llms.txt': {'get': _op('llms.txt 站点索引', root_url=p + '/llms.txt', produces='text/plain')},
        '/api/public/llms-full.txt': {'get': _op('公开内容 Markdown 合集', root_url=p + '/llms-full.txt',
                                                 produces='text/plain')},
        '/api/public/llms-full-{part}.txt': {'get': _op('合集分卷', root_url=p + '/llms-full-{part}.txt',
                                                        produces='text/plain',
                                                        params=[_param('part', schema={'type': 'integer'})])},
        '/api/public/feed.xml': {'get': _op('Atom 订阅', root_url=p + '/feed.xml', produces='application/atom+xml')},
        '/api/public/feed.json': {'get': _op('JSON Feed', root_url=p + '/feed.json')},
        '/api/public/feed/{kind}.xml': {'get': _op(
            '按类型 Atom 订阅', root_url=p + '/feed/{kind}.xml', produces='application/atom+xml',
            params=[_param('kind')])},
        '/api/public/feed/{kind}.json': {'get': _op(
            '按类型 JSON Feed', root_url=p + '/feed/{kind}.json', params=[_param('kind')])},
        '/api/public/p/{kind}/{slug}': {
            'get': {
                'summary': '服务端渲染的公开页；Accept: text/markdown 时返回 Markdown',
                'parameters': [
                    {'name': 'kind', 'in': 'path', 'required': True, 'schema': {'type': 'string'}},
                    {'name': 'slug', 'in': 'path', 'required': True, 'schema': {'type': 'string'}},
                ],
                'responses': {
                    '200': {'description': 'HTML 或 Markdown'},
                    '404': {'description': '不在公开层'},
                    '410': {'description': '已从公开层下线'},
                    '429': {'description': '限流，带 Retry-After'},
                },
                'x-public-url': p + '/p/{kind}/{slug}',
            },
        },
        '/api/public/p/{kind}/{slug}.md': {
            'get': {
                'summary': '公开页的 Markdown 版',
                'parameters': [
                    {'name': 'kind', 'in': 'path', 'required': True, 'schema': {'type': 'string'}},
                    {'name': 'slug', 'in': 'path', 'required': True, 'schema': {'type': 'string'}},
                ],
                'responses': {'200': {'description': 'Markdown'}, '404': {'description': '不在公开层'},
                              '410': {'description': '已下线'}},
                'x-public-url': p + '/p/{kind}/{slug}.md',
            },
        },
        '/api/public/p/{kind}/{slug}.json': {'get': _op(
            '公开页的规范化 JSON 表示', root_url=p + '/p/{kind}/{slug}.json',
            params=[_param('kind'), _param('slug')])},
        '/api/public/datasets/': {'get': _op('开放数据集目录', root_url=p + '/datasets/')},
        '/api/public/datasets/{name}/{version}/manifest.json': {'get': _op(
            '数据集版本清单', root_url=p + '/datasets/{name}/{version}/manifest.json',
            params=[_param('name'), _param('version')])},
        '/api/public/datasets/{name}/{version}/data.json': {'get': _op(
            '数据集版本 JSON', root_url=p + '/datasets/{name}/{version}/data.json',
            params=[_param('name'), _param('version')])},
        '/api/public/datasets/{name}/{version}/data.csv': {'get': _op(
            '数据集版本 CSV', root_url=p + '/datasets/{name}/{version}/data.csv', produces='text/csv',
            params=[_param('name'), _param('version')])},
        '/api/public/datasets/{name}.csv': {'get': _op(
            '开放数据集 CSV', root_url=p + '/datasets/{name}.csv', produces='text/csv',
            params=[_param('name'), _param('version', where='query', required=False)])},
        '/api/public/datasets/{name}.json': {'get': _op(
            '开放数据集 JSON', root_url=p + '/datasets/{name}.json',
            params=[_param('name'), _param('version', where='query', required=False)])},
        '/api/public/mcp/tools.json': {'get': _op('给 Agent 的只读工具描述', root_url=p + '/mcp/tools.json')},
        '/api/public/mcp': {'post': {
            'summary': 'MCP JSON-RPC：initialize、resources/list、resources/read',
            'responses': {'200': {'description': 'JSON-RPC 结果'}, '429': {'description': '限流'}},
            'x-public-url': p + '/mcp',
        }},
        '/api/public/mcp/resources.json': {'get': _op(
            'MCP 公开资源清单', root_url=p + '/mcp/resources.json')},
        '/api/public/mcp/resources/read': {'get': _op(
            '读取 MCP 公开资源', root_url=p + '/mcp/resources/read',
            params=[_param('uri', where='query')])},
        '/api/public/well-known/agent.json': {'get': _op('Agent 能力卡片', root_url=p + '/.well-known/agent.json')},
        '/api/public/well-known/mcp.json': {'get': _op('MCP 描述入口', root_url=p + '/.well-known/mcp.json')},
    }
    for tool in TOOLS:
        paths[f'/api/public/mcp/tools/{tool["name"]}'] = {
            'get': {
                'summary': tool['title'],
                'description': tool['description'],
                'parameters': [
                    {'name': key, 'in': 'query', 'required': key in tool['inputSchema'].get('required', []),
                     'schema': schema}
                    for key, schema in tool['inputSchema']['properties'].items()
                ],
                'responses': {'200': {'description': '工具结果'}, '429': {'description': '限流'}},
                'x-public-url': p + f'/mcp/tools/{tool["name"]}',
            },
        }
    return {
        'openapi': '3.1.0',
        'info': {
            'title': f'{site} · 公开只读 API',
            'version': '1.0.0',
            'description': ('公开层只有作者主动发布到公开层的内容和平台匿名聚合；'
                            '成员私域、讨论、个人页不在任何公开接口里。所有端点只读，限流按 IP 和 User-Agent 分桶。'),
            'license': _license(cfg),
        },
        'servers': [{'url': origin}],
        'paths': paths,
        'x-internal-prefix': '/api/public',
        'x-notes': ['Caddy 把根路径的 robots.txt、sitemap.xml、llms.txt、feed、/p/、/datasets/ 转到 /api/public/。',
                    '被抑制的聚合格子是 null（CSV 里是空字段），不是 0。'],
    }

"""由问题库、Skill、提示词与模式库示例整理的 60 道审核题。"""


LESSONS = [
    {
        'key': 'path', 'direction': 'coding', 'source_kind': 'problem', 'source_id': 'kb-py-path',
        'route': '#/solved', 'single': 'Python 工具换机器后找不到 config.yaml，首要修复是什么？',
        'correct': '按脚本文件所在目录解析配置路径',
        'wrong': ['把开发者用户名写进环境变量', '捕获异常后继续运行', '把配置内容复制进每个函数'],
        'truth': ('绝对路径会把程序绑在开发者机器上。', True),
        'multi': ('处理跨机器路径问题时，哪些动作有效？', ['按脚本目录拼路径', '启动时检查文件存在', '在另一台机器复测', '隐藏 FileNotFoundError'], [0, 1, 2]),
        'order': ('按顺序处理跨机器配置路径问题。', ['确认失败路径', '改为相对脚本目录', '增加启动检查', '换环境复测']),
        'explanation': '问题库示例要求去掉写死的绝对路径，并在不同环境复测。',
    },
    {
        'key': 'case', 'direction': 'coding', 'source_kind': 'problem', 'source_id': 'kb-node-module',
        'route': '#/solved', 'single': 'macOS 正常、Linux CI 报模块不存在，最该先核对什么？',
        'correct': '导入路径与文件名的大小写',
        'wrong': ['把 CI 重跑十次', '关闭类型检查', '把依赖全部升级到最新版'],
        'truth': ('默认不区分大小写的文件系统可能掩盖路径大小写错误。', True),
        'multi': ('修复大小写路径问题应包含哪些动作？', ['核对真实文件名', '在区分大小写的环境构建', '加入路径检查', '忽略 CI 结果'], [0, 1, 2]),
        'order': ('按顺序排查 CI 的模块路径错误。', ['固定报错输入', '比较导入路径与文件名', '在 CI 同系统复现', '加入自动检查']),
        'explanation': '问题库示例把根因定位为导入路径大小写与文件名不一致。',
    },
    {
        'key': 'csp', 'direction': 'safety', 'source_kind': 'problem', 'source_id': 'kb-browser-csp',
        'route': '#/solved', 'single': '严格 CSP 下按钮失效，推荐做法是什么？',
        'correct': '把脚本移到同源文件并用 addEventListener 绑定',
        'wrong': ['允许 unsafe-inline', '关闭 CSP', '把事件代码写进 href'],
        'truth': ('为了恢复按钮，应优先放宽 CSP 到 unsafe-inline。', False),
        'multi': ('保持严格 CSP 时，哪些做法合适？', ['使用同源外部脚本', '使用 addEventListener', '复测交互', '加入内联 onclick'], [0, 1, 2]),
        'order': ('按顺序修复 CSP 拒绝内联脚本。', ['确认控制台 CSP 报错', '迁移到同源脚本', '改用事件监听', '保留策略并复测']),
        'explanation': '问题库示例明确要求保留严格 CSP，而不是用 unsafe-inline 绕过。',
    },
    {
        'key': 'repro', 'direction': 'coding', 'source_kind': 'skill', 'source_id': 'skill-02',
        'route': '#/skills', 'single': '“先复现再修复”的第一步是什么？',
        'correct': '固定现象、输入与期望行为',
        'wrong': ['直接改异常处理', '先重构相关模块', '先写发布说明'],
        'truth': ('修复前后应使用同一条复现路径。', True),
        'multi': ('最小复现应保留哪些信息？', ['报错', '复现步骤', '期望行为', '无关模块列表'], [0, 1, 2]),
        'order': ('排列“先复现再修复”的工作顺序。', ['固定输入与期望', '建立最小复现', '验证根因假设', '用同一路径回归']),
        'explanation': 'Skill 示例要求在改代码前建立最小复现与失败证据。',
    },
    {
        'key': 'boundary', 'direction': 'safety', 'source_kind': 'skill', 'source_id': 'skill-03',
        'route': '#/skills', 'single': '多人并行仓库里需要改共享文件时，应怎么做？',
        'correct': '把跨文件需求写进交接，由所有者接线',
        'wrong': ['顺手修改共享文件', '复制一份共享文件', '跳过该功能且不说明'],
        'truth': ('改动边界守卫允许顺手整理附近共享模块。', False),
        'multi': ('边界清单应写明哪些内容？', ['独占文件', '禁止项', '扩展点需求', '别人的提交历史'], [0, 1, 2]),
        'order': ('排列并行施工的边界流程。', ['确认独占文件', '识别跨文件需求', '只改授权路径', '把接线写进回执']),
        'explanation': 'Skill 示例要求最终改动只含授权路径，跨文件需求进入交接。',
    },
    {
        'key': 'evidence', 'direction': 'model', 'source_kind': 'skill', 'source_id': 'skill-05',
        'route': '#/skills', 'single': '来源台账最关键的作用是什么？',
        'correct': '让关键结论能回到原始位置与适用范围',
        'wrong': ['让正文更长', '替代事实核查', '自动消除所有不确定性'],
        'truth': ('无法核实的内容应标“待核”，不能补造事实。', True),
        'multi': ('来源台账应保留哪些字段？', ['来源位置', '日期', '适用范围', '缺口'], [0, 1, 2, 3]),
        'order': ('排列建立来源台账的步骤。', ['抽取关键结论', '找到原始位置', '记录日期与范围', '标记缺口']),
        'explanation': '来源台账示例强调来源、日期、范围和缺口四项。',
    },
    {
        'key': 'states', 'direction': 'agent', 'source_kind': 'skill', 'source_id': 'skill-07',
        'route': '#/skills', 'single': '界面状态清单不能只画什么？',
        'correct': '默认态',
        'wrong': ['错误态', '键盘聚焦态', '加载态'],
        'truth': ('状态验收需要覆盖键盘与窄屏。', True),
        'multi': ('完整交互状态通常包含哪些？', ['聚焦', '禁用', '加载', '错误'], [0, 1, 2, 3]),
        'order': ('排列补齐交互状态的做法。', ['确认组件目标', '列出触发条件', '写恢复动作', '核对焦点去向']),
        'explanation': 'Skill 示例要求默认、悬停、聚焦、禁用、加载、空、错与完成态。',
    },
    {
        'key': 'metric', 'direction': 'model', 'source_kind': 'skill', 'source_id': 'skill-10',
        'route': '#/skills', 'single': '“统计活跃用户”缺少的关键口径是什么？',
        'correct': '对象、事件、窗口、去重与例外',
        'wrong': ['图表颜色', '数据库品牌', '页面路由'],
        'truth': ('指标定义应明确分子分母和时区。', True),
        'multi': ('可实现的指标定义应明确哪些内容？', ['时间窗口', '去重方式', '排除对象', '时区'], [0, 1, 2, 3]),
        'order': ('排列指标落地顺序。', ['定义对象', '定义事件', '明确窗口与时区', '写去重和例外']),
        'explanation': '指标口径卡把含糊的“活跃”拆成可核验的计算定义。',
    },
    {
        'key': 'prompt-boundary', 'direction': 'prompt', 'source_kind': 'prompt', 'source_id': 'prompt-12',
        'route': '#/prompts', 'single': '工具型 Agent 的系统提示最不能缺什么？',
        'correct': '允许、禁止、前检、停止条件和回执',
        'wrong': ['夸奖模型的形容词', '越长越好的背景故事', '所有工具的源码'],
        'truth': ('“你是优秀工程师，完成任务”足以约束工具权限。', False),
        'multi': ('系统提示边界应包含哪些槽位？', ['职责', '允许动作', '停止条件', '输出契约'], [0, 1, 2, 3]),
        'order': ('排列工具型 Agent 的执行约束。', ['确认职责', '检查允许与禁止', '遇停止条件就报告', '按回执契约输出']),
        'explanation': '提示词示例把权限边界和停止条件写成可判定合同。',
    },
    {
        'key': 'fallback', 'direction': 'prompt', 'source_kind': 'prompt', 'source_id': 'prompt-13',
        'route': '#/prompts', 'single': '首选工具失败后，正确策略是什么？',
        'correct': '按预先定义的降级路径尝试并保留错误摘要',
        'wrong': ['无限重试同一调用', '假装已经成功', '立即扩大权限'],
        'truth': ('不能观察错误时，也应保持失败可见。', True),
        'multi': ('工具降级合同应写清哪些内容？', ['成功判据', '降级顺序', '错误留痕', '重试上限'], [0, 1, 2, 3]),
        'order': ('排列安全降级流程。', ['调用首选工具', '检查成功判据', '记录失败摘要', '走下一条降级路径']),
        'explanation': '提示词示例把成功、失败、降级和重试上限全部显式化。',
    },
    {
        'key': 'evidence-level', 'direction': 'model', 'source_kind': 'prompt', 'source_id': 'prompt-09',
        'route': '#/prompts', 'single': '静态检查通过能直接证明什么？',
        'correct': '语法与已覆盖规则符合要求',
        'wrong': ['真实手机完全可用', '生产系统已经上线', '所有视觉问题都不存在'],
        'truth': ('未做浏览器截图时，不能宣称真实窄屏视觉通过。', True),
        'multi': ('证据强度分级包含哪些类别？', ['直接证据', '间接支持', '推断', '缺口'], [0, 1, 2, 3]),
        'order': ('排列证据分级的做法。', ['列出材料', '判断证据类型', '限制可支持的结论', '保留缺口']),
        'explanation': '提示词示例明确区分静态检查、推断与真实验收面。',
    },
    {
        'key': 'compare', 'direction': 'prompt', 'source_kind': 'prompt', 'source_id': 'prompt-08',
        'route': '#/prompts', 'single': '比较方案时，最后应输出什么？',
        'correct': '只推荐一个，并写触发改选的条件',
        'wrong': ['把所有方案都列为最佳', '只写个人偏好', '只比较视觉风格'],
        'truth': ('方案比较应使用同一组维度。', True),
        'multi': ('高质量方案比较应包含哪些？', ['统一维度', '证据', '不可逆成本', '改选条件'], [0, 1, 2, 3]),
        'order': ('排列方案决策过程。', ['明确目标与约束', '限定候选', '按统一维度比较', '推荐并写改选条件']),
        'explanation': '提示词示例要求统一维度、唯一推荐和改选条件。',
    },
    {
        'key': 'master-detail', 'direction': 'agent', 'source_kind': 'pattern', 'source_id': 'pattern-09',
        'route': '#/patterns', 'single': '条目多、详情长时，优先选择哪种骨架？',
        'correct': '主从列表',
        'wrong': ['等权卡片墙', '无限画布', '单个大弹窗'],
        'truth': ('手机上应继续强制双栏，才能保持桌面结构一致。', False),
        'multi': ('主从列表解决哪些问题？', ['快速切换条目', '保留当前位置', '承载长详情', '保证所有内容等权'], [0, 1, 2]),
        'order': ('排列主从列表在手机上的退化方式。', ['先显示筛选列表', '选择条目', '进入连续详情', '保留返回位置']),
        'explanation': '模式库示例建议手机退化为先列表、后详情。',
    },
    {
        'key': 'timeline', 'direction': 'agent', 'source_kind': 'pattern', 'source_id': 'pattern-11',
        'route': '#/patterns', 'single': '执行时间线最不该只记录什么？',
        'correct': '成功结果',
        'wrong': ['触发条件', '输入输出', '重试语义'],
        'truth': ('时间线事件应能说明在哪一步失败并从那里重试。', True),
        'multi': ('执行时间线应包含哪些？', ['触发', '执行', '结果', '重试语义'], [0, 1, 2, 3]),
        'order': ('排列一次可回放的执行记录。', ['记录触发', '记录输入与执行', '记录结果或失败', '标出重试入口']),
        'explanation': '模式库示例强调触发、执行、结果与重试都可追溯。',
    },
    {
        'key': 'rank', 'direction': 'safety', 'source_kind': 'pattern', 'source_id': 'pattern-12',
        'route': '#/patterns', 'single': '赛季榜怎样避免把付费当能力？',
        'correct': '让排名回到透明的个人计分流水',
        'wrong': ['按会员价格加分', '隐藏计分规则', '只显示总榜不显示来源'],
        'truth': ('付费权益应直接混进能力等级以鼓励购买。', False),
        'multi': ('健康的榜单需要哪些约束？', ['规则透明', '流水可追溯', '付费与能力分离', '允许查分数来由'], [0, 1, 2, 3]),
        'order': ('排列可追溯榜单的阅读路径。', ['查看排名', '打开个人分数', '核对计分流水', '回到来源对象']),
        'explanation': '模式库示例明确禁止把付费权益混进能力等级。',
    },
]


def questions():
    rows = []
    for index, lesson in enumerate(LESSONS, 1):
        common = {
            'direction': lesson['direction'], 'source_kind': lesson['source_kind'],
            'source_id': lesson['source_id'], 'source_route': lesson['route'],
            'explanation': lesson['explanation'], 'review_status': 'reviewed', 'sample': 1,
        }
        rows.append({
            **common, 'id': f'q{index:02d}-single', 'kind': 'single', 'prompt': lesson['single'],
            'options': [lesson['correct'], *lesson['wrong']], 'answer': [lesson['correct']],
        })
        statement, correct = lesson['truth']
        rows.append({
            **common, 'id': f'q{index:02d}-boolean', 'kind': 'boolean', 'prompt': statement,
            'options': ['正确', '错误'], 'answer': ['正确' if correct else '错误'],
        })
        multi_prompt, multi_options, answer_indexes = lesson['multi']
        rows.append({
            **common, 'id': f'q{index:02d}-multiple', 'kind': 'multiple', 'prompt': multi_prompt,
            'options': multi_options, 'answer': [multi_options[i] for i in answer_indexes],
        })
        order_prompt, order_options = lesson['order']
        rows.append({
            **common, 'id': f'q{index:02d}-order', 'kind': 'order', 'prompt': order_prompt,
            'options': order_options, 'answer': order_options,
        })
    return rows


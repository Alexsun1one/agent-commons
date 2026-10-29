/* R13 LIB-1 · 四个资源板块的合成示例内容。所有成员名、计数与产出均为示例。 */
(function () {
  'use strict';

  var SAMPLE_AUTHOR = '资源库编辑组';

  function installsFor(clients, slug) {
    var out = {};
    clients.forEach(function (client) {
      if (client === 'Claude Code') out[client] = 'mkdir -p ~/.claude/skills/' + slug + '\n# 将下方 SKILL.md 保存到该目录';
      else if (client === 'Codex') out[client] = 'mkdir -p ~/.codex/skills/' + slug + '\n# 将下方 SKILL.md 保存到该目录';
      else if (client === 'Cursor') out[client] = 'mkdir -p .cursor/rules\n# 将规则内容保存为 .cursor/rules/' + slug + '.mdc';
      else if (client === 'MCP') out[client] = '# 在客户端 MCP 配置中登记服务；命令与参数以服务自己的 README 为准。';
    });
    return out;
  }

  function skill(seed, index) {
    var slug = seed[0];
    var name = seed[1];
    var category = seed[2];
    var clients = seed[3];
    var goal = seed[4];
    var input = seed[5];
    var output = seed[6];
    var checks = seed[7];
    var body = [
      '---',
      'name: ' + slug,
      'description: ' + goal,
      '---',
      '',
      '# ' + name,
      '',
      '## When to use',
      goal,
      '',
      '## Inputs',
      '- ' + input,
      '',
      '## Workflow',
      '1. 先确认目标、对象与不做什么。',
      '2. 只读取完成当前任务所需的最小材料。',
      '3. 产出：' + output + '。',
      '4. 自检：' + checks + '。',
      '',
      '## Output contract',
      '- 先给结论，再给可核验依据。',
      '- 不确定内容写「待核」，不补造事实。',
      '- 记录未验证项，不把静态检查写成真实运行结果。'
    ].join('\n');
    return {
      id: 'skill-' + String(index + 1).padStart(2, '0'),
      kind: 'skill',
      slug: slug,
      name: name,
      category: category,
      summary: goal,
      clients: clients,
      author: SAMPLE_AUTHOR,
      version: 'v1',
      usedCount: 24 + index * 7,
      before: seed[8],
      after: seed[9],
      exampleLabel: '完整 SKILL.md 示例',
      example: body,
      installs: installsFor(clients, slug),
      sample: true
    };
  }

  var skillSeeds = [
    ['requirement-slicer', '需求切片器', '知识管理', ['Claude Code', 'Codex', 'Cursor'], '把模糊需求收敛成目标、对象、做与不做、验收四个槽位。', '用户原话、当前模块与边界。', '一张不超过 12 行的执行卡', '四个槽位都有原文依据', '“帮我把后台做好看。”', '“对象：审核员；主任务：核对并放行；不做：新增权限；验收：3 个状态都可完成。”'],
    ['repro-first', '先复现再修复', '编程', ['Claude Code', 'Codex'], '在改代码前建立最小复现、期望行为与失败证据。', '报错、复现步骤、相关文件。', '最小复现与根因假设', '修复前后使用同一条复现路径', '看到 500 就直接改异常处理。', '先固定输入与期望，再定位是哪一层把有效状态丢掉。'],
    ['change-boundary', '改动边界守卫', '编程', ['Claude Code', 'Codex', 'Cursor'], '在多人并行仓库里只修改被授权文件，并把跨文件需求写进交接。', '独占文件、禁止项、需要的扩展点。', '边界清单与越界请求', '最终 diff 只含授权路径', '顺手整理附近的共享模块。', '只改独占文件；共享模块需要的接线写进回执。'],
    ['release-note-drafter', '面向用户的更新说明', '写作', ['Claude Code', 'Codex', 'Cursor'], '把技术改动改写成用户能感知的变化、限制与下一步。', '变更清单与验证证据。', '三段式更新说明', '不虚构上线范围或性能收益', '“优化若干，修复一些问题。”', '“搜索现在保留上次筛选；移动端仍未做真机验证。”'],
    ['source-ledger', '来源台账', '知识管理', ['Claude Code', 'Codex'], '为关键结论保留来源、日期、适用范围与缺口。', '结论与本地可读来源。', '可追溯的来源表', '每条结论都能回到原始位置', '把结论写进正文，不记来源。', '结论后附文件、段落、时间与“待核”字段。'],
    ['citation-gap-finder', '论断缺口检查', '写作', ['Claude Code', 'Codex', 'Cursor'], '找出文稿里需要来源、限定词或明确标为观点的句子。', '待审文稿与允许使用的来源。', '逐条缺口清单', '事实、推断、建议三类分开', '所有语句都用肯定口吻。', '把“证明了”改为“这份样本支持”，并写出样本边界。'],
    ['ui-state-checklist', '界面状态清单', '设计', ['Claude Code', 'Codex', 'Cursor'], '为一个交互补齐默认、悬停、聚焦、禁用、加载、空、错与完成状态。', '组件目标与用户动作。', '状态矩阵和验收路径', '键盘与窄屏状态都有落点', '只画默认态。', '列出每个状态的触发、文案、恢复动作和焦点去向。'],
    ['screenshot-critic', '截图找茬', '设计', ['Claude Code', 'Codex'], '根据实际截图检查层级、密度、对齐、溢出和可读性。', '同一路径的桌面与手机截图。', '按严重度排序的问题单', '每条问题都指向画面中的具体区域', '只说“感觉不够高级”。', '指出“首屏有三个同权主按钮，用户无法判断下一步”。'],
    ['csv-schema-inspector', 'CSV 结构检查', '数据', ['Claude Code', 'Codex'], '在分析前检查列名、类型、缺失、重复键与时间格式。', '脱敏 CSV 或字段样本。', '结构报告与阻断项', '不读取未授权数据，不把缺失当成零', '直接求平均数。', '先报告 3 个日期格式和 12% 缺失，再决定能否聚合。'],
    ['metric-definition', '指标口径卡', '数据', ['Claude Code', 'Codex', 'Cursor'], '把指标写成对象、事件、窗口、去重与例外都明确的计算口径。', '业务问题与可用字段。', '可实现的指标定义', '分子分母和时区明确', '“统计活跃用户。”', '“按自然日去重的已登录成员；测试账号排除；时区为站点时区。”'],
    ['meeting-actions', '会议转行动项', '自动化', ['Claude Code', 'Codex', 'Cursor'], '从会议记录中提取负责人、截止、依赖与未决问题。', '经过授权的会议记录。', '行动项与决策表', '没有负责人或日期的项明确标缺口', '输出一篇会议摘要。', '先列 5 个行动项，再单列 2 个无人负责的阻断。'],
    ['safe-file-batch', '安全批量改名', '自动化', ['Claude Code', 'Codex'], '先预演文件名映射，检查冲突后再执行可恢复的批量改名。', '授权目录与命名规则。', '旧名到新名的预演表', '零覆盖、零目录越界', '直接运行通配符 mv。', '先生成映射，发现两个目标重名后停止并报告。'],
    ['voice-preserving-editor', '保留作者声音的改稿', '写作', ['Claude Code', 'Codex', 'Cursor'], '压缩空话和模板腔，同时保留作者的观点、节奏与证据。', '原稿与不能改的表达。', '精修稿和关键改动说明', '不增造经历、引语或数据', '把全文改成统一的说明文口吻。', '保留短句和个人判断，只删重复铺垫。'],
    ['review-rubric', '评审尺子生成器', '知识管理', ['Claude Code', 'Codex', 'Cursor'], '把“好不好”改成可判定、带证据入口的评审项目。', '目标、风险与真实验收面。', '分级评审表', '通过条件和一票否决项明确', '给作品打一个总分。', '先验功能完成，再看视觉层级；未看真机就保持未验证。'],
    ['token-auditor', 'Design Token 审计', '设计', ['Claude Code', 'Codex'], '扫描界面样式里的硬编码颜色、字号、间距和动效例外。', 'token 正本与负责的 CSS。', '例外位置与替换建议', '不自动改共享 token', '把所有颜色统一成一个蓝色。', '区分品牌、语义、分类色，再只替换无职责的硬编码。'],
    ['mcp-contract-reviewer', 'MCP 工具契约检查', '自动化', ['Claude Code', 'Codex', 'MCP'], '检查工具名、输入、输出、失败语义和权限边界是否能被 Agent 稳定使用。', '工具 schema、示例调用与错误样本。', '契约问题与兼容建议', '不发明未声明字段', '只验证一次成功调用。', '同时检查缺字段、超时、权限拒绝与幂等重放。']
  ];

  function prompt(id, name, category, when, template, variables, exampleInput, exampleOutput, bad, good, notes) {
    return {
      id: id,
      kind: 'prompt',
      name: name,
      category: category,
      when: when,
      template: template,
      variables: variables,
      exampleInput: exampleInput,
      exampleOutput: exampleOutput,
      bad: bad,
      good: good,
      modelNotes: notes,
      author: SAMPLE_AUTHOR,
      usedCount: 31 + Number(id.slice(-2)) * 5,
      sample: true
    };
  }

  var prompts = [
    prompt('prompt-01', '受众—任务—证据', '写作', '写解释、报告或公告前，先把读者和证据边界说清。', '面向 {{audience}}，写一份 {{format}}，让读者完成 {{task}}。只能使用 {{evidence}}；缺口标“待核”。语气：{{tone}}。', [['audience','受众','第一次接触项目的成员'],['format','形式','600 字上手说明'],['task','任务','完成第一次投稿'],['evidence','证据','页面现有字段和本机保存规则'],['tone','语气','直接、克制']], '项目需要一份投稿说明。', '示例输出：先填写标题与正文，再检查预览；保存后只留在本机，不会自动发布。', '帮我写个专业说明。', '明确受众、动作、证据范围和不能承诺的结果。', '长上下文模型也要把证据范围放在任务前部；较小模型可把格式拆成编号清单。'),
    prompt('prompt-02', '观点—反例—边界', '写作', '论证一个观点，但不想写成单向宣传时。', '围绕“{{claim}}”写 {{length}}。必须包含：支持证据 {{support}}；反例 {{counter}}；结论适用边界 {{boundary}}。', [['claim','观点','先验收真实路径，再谈自动化'],['length','篇幅','三段'],['support','支持证据','失败发生在交接与权限边界'],['counter','反例','稳定重复任务适合先自动化'],['boundary','边界','高风险发布仍需人工确认']], '写一段工程方法论。', '示例输出：自动化能消除重复操作，但不能替代权限确认；对于稳定且可回滚的步骤，自动化应优先。', '证明人工永远比自动化可靠。', '要求支持、反例和适用边界同时出现。', '推理模型可先列论证骨架；非推理模型应把三项约束写成固定小标题。'),
    prompt('prompt-03', '最小复现', '编程', '定位 bug 而不是直接猜修复时。', '请根据 {{symptom}} 设计最小复现。环境：{{environment}}。期望：{{expected}}。只输出：复现步骤、观测点、三个按概率排序的假设、能证伪每个假设的检查。', [['symptom','现象','筛选后返回列表，筛选条件丢失'],['environment','环境','离线单页，hash 路由'],['expected','期望','返回后保持筛选']], '用户报告返回页面后筛选重置。', '示例输出：1. 进入列表选择“已收藏”；2. 打开详情并返回；观测 state 是否在 render 前被初始化。', '看看这个 bug 怎么修。', '先固定复现、期望、观测点和证伪检查。', '代码模型可附文件位置；无法读仓库时必须把假设标成假设。'),
    prompt('prompt-04', '变更计划含不做', '编程', '功能改动跨多个文件且需要控制范围时。', '目标：{{goal}}。允许修改：{{files}}。不做：{{nonGoals}}。请给最小切片、每片验证命令、回滚点，并列出需跨团队接线的内容。', [['goal','目标','新增资源库四个页面'],['files','允许文件','library*.js、library.css、回执'],['nonGoals','不做','不改导航和应用入口']], '规划前端资源库。', '示例输出：数据、渲染、交互、验证四片；导航与 script/link 接线写回执。', '把资源库功能都做好。', '把文件所有权、不做项和验收写进提示词。', '工具调用模型要把只读检查和写操作分开；无工具模型只产计划，不声称已修改。'),
    prompt('prompt-05', '失败优先代码评审', '评审与自查', '审查改动时优先找会导致错误或越权的问题。', '审查 {{diffScope}}。按严重度只报告可复现问题：行为回归、边界状态、权限/注入、漏测。每条包含位置、触发条件、实际影响、最小修复。忽略纯风格偏好。', [['diffScope','范围','本次提交的 library.js 与 library.css']], '评审一个页面模块。', '示例输出：高：切换条目后旧评论监听未解除，会重复提交；触发：连续打开两个详情。', '看看代码质量怎么样。', '要求位置、触发条件、影响和修复，禁止泛泛建议。', '推理模型可先静默枚举风险；输出仍只保留有证据的问题。'),
    prompt('prompt-06', '迁移前兼容检查', '编程', '改数据形状或存储格式前。', '旧形状：{{oldShape}}。新形状：{{newShape}}。消费者：{{consumers}}。请列兼容矩阵、迁移顺序、双读/回退策略与不能静默吞掉的错误。', [['oldShape','旧形状','items: array'],['newShape','新形状','sections: keyed object'],['consumers','消费者','前端四路由与后端列表接口']], '准备调整资源库数据格式。', '示例输出：先让消费者兼容两种形状，再写新数据；缺 kind 必须报错，不能默认成 skill。', '把数据结构改成新的。', '同时给出消费者、顺序和错误策略。', '较小模型适合用表格逐字段比对；代码模型可追加类型定义。'),
    prompt('prompt-07', '口径到查询', '分析', '把业务问题转成可核验的数据定义时。', '业务问题：{{question}}。可用字段：{{fields}}。时间窗口：{{window}}。先定义对象、事件、去重、排除、时区，再给伪 SQL；字段不足就停止并列缺口。', [['question','业务问题','一周内有多少成员完成首次投稿'],['fields','可用字段','member_id、submitted_at、status'],['window','窗口','站点时区自然周']], '需要计算首次投稿人数。', '示例输出：对象为 member_id；事件为 status=accepted 的首次 submitted_at；缺测试账号字段，结果需标待核。', '写个 SQL 算活跃。', '先定义口径，再写查询；缺字段不猜。', '数据模型必须禁止把 NULL 当 0；支持工具时先查 schema。'),
    prompt('prompt-08', '对比方案而非罗列', '分析', '需要在 2–4 个方案中做决定时。', '比较 {{options}}，决策目标 {{goal}}，硬约束 {{constraints}}。用同一组维度给证据，指出不可逆成本，最后只推荐一个并写触发改选的条件。', [['options','候选','主从列表、卡片墙、表格'],['goal','目标','快速浏览并查看完整示例'],['constraints','约束','390px 可用，内容很长']], '选择资源库页面骨架。', '示例输出：推荐主从列表；手机退化为先列表后详情。若需批量编辑，再改选表格。', '哪个方案最好？', '明确目标、约束、统一维度和改选条件。', '推理模型容易展开过度，应限制候选数量和最终只选一个。'),
    prompt('prompt-09', '证据强度分级', '分析', '汇总混合来源而不想把推断写成事实时。', '把以下材料按“直接证据 / 间接支持 / 推断 / 缺口”分类：{{materials}}。每条结论注明可支持到什么程度，禁止越级措辞。', [['materials','材料','静态检查通过；未做浏览器截图；用户原话要求手机可用']], '判断页面是否已经可交付。', '示例输出：静态检查直接支持语法与 token 合规；不能证明 390px 真实无溢出。', '根据这些材料证明已经完成。', '要求分级并限制每类证据能支持的结论。', '所有模型都应保留“缺口”栏目，不能为完整性补造证据。'),
    prompt('prompt-10', '图像构图四槽', '生图', '需要可控的产品插画或封面构图时。', '生成 {{ratio}} 图像。主体：{{subject}}；环境：{{setting}}；光线与色彩：{{light}}；必须清晰出现：{{must}}；禁止：{{avoid}}。画面用途：{{use}}。', [['ratio','比例','16:9'],['subject','主体','熊猫在整理四层资源架'],['setting','环境','明亮的数字工作室'],['light','光线','冷白自然光、品牌蓝点缀'],['must','必须出现','四个有区分的层级与留白标题区'],['avoid','禁止','黄色、密集小字、暗角'],['use','用途','资源库页头']], '生成资源库封面。', '示例输出：画面描述已固定主体、层级、光线、禁区与标题留白。', '画一个高级的 AI 资源库。', '把主体、环境、光线、必现元素、禁区和用途写全。', '生图模型不擅长长正文；文字留给界面叠加，提示词只要求留白。'),
    prompt('prompt-11', '同角色多画面一致性', '生图', '一组插画需要保持角色与视觉连续性时。', '角色锚点：{{character}}。固定：{{fixed}}。本张动作：{{action}}。镜头：{{camera}}。只允许变化：{{variable}}。与上一张保持同一配色和材质。', [['character','角色','圆润熊猫、蓝色短围巾'],['fixed','固定项','脸型、眼距、围巾、三色调色板'],['action','动作','把提示词卡放进抽屉'],['camera','镜头','三分之二侧面，中景'],['variable','可变项','手势与抽屉标签']], '做系列第二张插画。', '示例输出：角色锚点和不可变项先于动作，减少跨图漂移。', '再画一张同样的熊猫。', '写清身份锚点、固定项、动作、镜头与唯一可变量。', '若工具支持参考图，应同时传参考图；文字提示不能替代视觉参考。'),
    prompt('prompt-12', '系统提示边界', 'Agent 系统提示', '为可调用工具的 Agent 定义权限与停止条件时。', '你负责 {{scope}}。允许：{{allowed}}。禁止：{{denied}}。执行前检查 {{precheck}}。遇到 {{stop}} 必须停止并报告。输出必须包含 {{receipt}}。', [['scope','职责','只修改资源库前端独占文件'],['allowed','允许','读取本仓库、编辑 library*.js/css'],['denied','禁止','联网、起服务、改共享入口'],['precheck','前置检查','文件所有权与现有模块接口'],['stop','停止条件','需要密钥、删除文件、修改共享契约'],['receipt','回执','改动、验证、未验证与接线']], '写一个施工 Agent 系统提示。', '示例输出：边界、动作、停止条件与回执字段都可判定。', '你是优秀工程师，完成任务。', '把职责、允许、禁止、前检、停止条件和回执写成明确合同。', '工具型模型需要路径级授权；聊天模型可以省略工具细节但不能省停止条件。'),
    prompt('prompt-13', '工具选择与降级', 'Agent 系统提示', '同一任务有首选工具和安全降级路径时。', '任务：{{task}}。首选工具：{{primary}}，成功判据：{{success}}。失败后依次尝试 {{fallbacks}}。每次失败保留错误摘要；禁止重复同一无效调用超过 {{retries}} 次。', [['task','任务','复制生成后的提示词'],['primary','首选','Clipboard API'],['success','成功判据','Promise resolve 并提示已复制'],['fallbacks','降级','选中文本、提示手动复制'],['retries','重试次数','1']], '设计复制交互。', '示例输出：Clipboard API 失败后不循环调用，保留文本供手动复制。', '尽一切办法复制成功。', '定义首选、成功、降级、错误留痕和重试上限。', '模型若能观察工具错误，应基于错误分支；不能观察时要保持失败可见。'),
    prompt('prompt-14', '交接回执', 'Agent 系统提示', '多人并行后把结果交给主控接线时。', '按以下字段写交接：目标 {{goal}}；改动文件；数据/接口形状；验证命令与输出；需要主控做的接线；未验证项；停止标记 {{sentinel}}。不得写“已上线”，除非有生产证据。', [['goal','目标','四个资源库前端页面'],['sentinel','停止标记','R13 LIB-1 R1 · READY']], '写施工回执。', '示例输出：列出三份前端文件、四路由、静态检查结果和待主控加入的 script/link。', '总结一下做了什么。', '规定可验收字段与精确停止标记。', '上下文长时也应保持回执字段固定，避免末尾遗漏 sentinel。'),
    prompt('prompt-15', '反向验收', '评审与自查', '交付前从失败路径检查是否真的满足用户目标。', '目标：{{goal}}。请从 {{personas}} 的视角，各走一条最短路径；列会卡住的点、错误恢复、窄屏/键盘风险。只把亲自验证过的写“通过”，其余写“未验证”。', [['goal','目标','找到一个 Skill 并复制安装方法'],['personas','角色','第一次来的成员、键盘用户、390px 手机用户']], '验收资源库页面。', '示例输出：静态代码可见复制按钮；因未开浏览器，键盘顺序与 390px 溢出保持未验证。', '检查一下有没有问题。', '指定角色、路径、失败恢复与证据等级。', '视觉模型适合看截图；代码模型只看 DOM/CSS 时不能宣称实际视觉通过。'),
    prompt('prompt-16', '逐条事实核对', '评审与自查', '发布包含产品、许可、版本或数字的清单前。', '抽取文本中的外部事实，按 {{fields}} 建表。只保留有来源或有把握项；不确定写“待核”；版本、价格、star 数若未被要求则删除。', [['fields','核对字段','名称、官方用途、技术栈、许可、产品示例']], '核对组件库介绍。', '示例输出：Radix Primitives—无样式可访问组件—React—MIT；其余许可不确定项标待核。', '把所有库的信息补完整。', '显式允许删掉不必要的易过期字段，并保留待核。', '有浏览工具时优先官方来源；离线时不得把记忆中的易变信息当已核实。')
  ];

  function component(id, name, category, specialty, stack, license, choose, avoid, code, preview, pending) {
    return { id: id, kind: 'component', name: name, category: category, specialty: specialty, stack: stack, license: license, choose: choose, avoid: avoid, example: code, preview: preview, pending: pending || [], author: SAMPLE_AUTHOR, usedCount: 18 + Number(id.slice(-2)) * 4, sample: true };
  }

  var components = [
    component('component-01','Radix Primitives','无样式基础件','无样式、可组合的 React 交互原语。','React','MIT','需要自己掌控视觉，同时要可靠的弹层、菜单、标签页等行为时。','只想装上就得到完整品牌外观时。','import * as Dialog from "@radix-ui/react-dialog";\n<Dialog.Root><Dialog.Trigger>打开</Dialog.Trigger><Dialog.Content>内容</Dialog.Content></Dialog.Root>','dialog'),
    component('component-02','shadcn/ui','可拥有源码','把组件源码复制进项目，再按自己的设计系统维护。','React + Tailwind CSS','MIT','团队愿意拥有组件源码并持续维护视觉一致性时。','不想承担复制后升级与差异维护时。','import { Button } from "@/components/ui/button";\n<Button>保存</Button>','button'),
    component('component-03','Headless UI','无样式基础件','与 Tailwind CSS 配合的无样式 React / Vue 交互组件。','React / Vue','MIT','已有视觉系统，只缺菜单、对话框、列表框等行为时。','需要丰富现成视觉主题时。','import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";\n<Menu><MenuButton>操作</MenuButton><MenuItems><MenuItem>编辑</MenuItem></MenuItems></Menu>','menu'),
    component('component-04','React Aria','可访问性交互','以 hooks / components 组织可访问交互与国际化行为。','React','Apache-2.0','复杂表单、日期、集合组件对键盘和辅助技术要求高时。','团队不熟悉组合式 API、只需极小静态页面时。','// 示例：导入路径随所选 React Aria 包而定，请按当前官方文档核对。\n<Button onPress={save}>保存</Button>','focus',['最小导入示例待核']),
    component('component-05','Material UI','完整组件套件','Material Design 风格的 React 组件与主题能力。','React','MIT','需要成熟组件覆盖和主题系统，且接受 Material 语汇时。','品牌视觉需要明显脱离 Material 默认观感时。','import Button from "@mui/material/Button";\n<Button variant="contained">保存</Button>','button'),
    component('component-06','Ant Design','企业级组件','表格、表单、树、选择器等企业应用常用组件。','React','MIT','中后台需要高覆盖率和复杂数据录入组件时。','页面极轻、依赖预算很紧或品牌需要完全自定义时。','import { Button } from "antd";\n<Button type="primary">提交</Button>','table'),
    component('component-07','Chakra UI','主题化组件','通过样式属性与主题快速组合 React 界面。','React','MIT','希望在组件层快速应用主题与响应式样式时。','团队要求所有样式都由现有 CSS token 与类名控制时。','import { Button } from "@chakra-ui/react";\n<Button>继续</Button>','button'),
    component('component-08','Mantine','应用组件套件','提供表单、覆盖层、数据展示与 hooks。','React','MIT','希望一套 React 库覆盖常见应用界面和交互 hooks 时。','只需要少数无样式原语时。','import { Button } from "@mantine/core";\n<Button>发布</Button>','button'),
    component('component-09','Carbon Design System','企业设计系统','IBM 设计语言下的组件、图表与设计规范。','Web Components / React','Apache-2.0','大型企业产品需要一致的设计语言与规范资产时。','产品品牌不适合 Carbon 视觉或只需小型嵌入组件时。','// 示例：包名与组件 API 请按所用实现核对。\n<Button kind="primary">运行</Button>','status',['实现包名与最小导入示例待核']),
    component('component-10','Fluent UI React','微软生态设计系统','面向 Microsoft 生态的 React 组件与主题。','React','MIT','与 Microsoft 365 体验需要一致，或需要成熟办公场景组件时。','品牌希望与 Fluent 语汇保持明显距离时。','// 示例：不同主版本的导入路径不同，请按当前文档核对。\n<Button appearance="primary">保存</Button>','command',['主版本对应的导入路径待核']),
    component('component-11','Primer React','开发者产品界面','GitHub Primer 设计系统的 React 实现。','React','MIT','开发者工具、代码协作产品希望借鉴 Primer 语汇时。','消费级内容产品需要更柔和、媒介化的视觉时。','import { Button } from "@primer/react";\n<Button variant="primary">合并</Button>','review'),
    component('component-12','Bootstrap','通用前端组件','响应式网格、工具类与常见交互组件。','HTML / CSS / JavaScript','MIT','需要广泛熟悉、快速搭起常见响应式页面时。','已有严格设计系统，或只想引入极少量无样式行为时。','<button class="btn btn-primary" type="button">保存</button>','form')
  ];

  function pattern(id, name, category, scene, products, pitfalls, route, routeName, diagram, pending) {
    return { id: id, kind: 'pattern', name: name, category: category, scene: scene, products: products, pitfalls: pitfalls, route: route, routeName: routeName, diagram: diagram, pending: pending || [], author: SAMPLE_AUTHOR, usedCount: 20 + Number(id.slice(-2)) * 6, sample: true };
  }

  var patterns = [
    pattern('pattern-01','对话 + 工件','创作协作','边聊边生成文档、代码或可预览成果，并保持对话与成果各自可操作。',['Claude Artifacts'],'工件版本与对话引用脱节；手机上双栏被硬挤。','#/threads','讨论串',{type:'split',labels:['对话','可编辑工件']}),
    pattern('pattern-02','命令面板','快速导航','熟练用户需要跨页面搜索、跳转和执行短动作。',['Visual Studio Code','Raycast'],'命令命名含糊；搜索只匹配标题；危险动作没有确认。','#/home','发现页的 ⌘K',{type:'palette',labels:['输入命令','分组结果','快捷键']}),
    pattern('pattern-03','画布式编辑','空间组织','对象之间的空间关系、连线与分组本身有意义。',['Figma','Miro'],'无限画布缺少回到主线的路径；缩放后文字不可读。','#/knowledge','知识地图',{type:'canvas',labels:['节点','连线','详情']}),
    pattern('pattern-04','AI 日报','定时摘要','把多来源变化整理成少量可行动项目，并保留回到来源的路径。',['Microsoft Copilot Daily（待核）'],'摘要没有来源；每天堆积却没有完成或归档动作。','#/insights','话题与成长',{type:'digest',labels:['今日重点','证据','下一步']},['产品名称与当前形态待核']),
    pattern('pattern-05','多 Agent 看板','并行协作','多个 Agent 或车道并行处理独立任务，需要看到依赖、状态和回执。',['Cursor 的并行 Agent 视图（待核）'],'只显示忙碌动画；没有所有权、阻断、产物与验收人。','#/board','多 Agent 看板',{type:'board',labels:['待办','进行中','待验收']},['知名产品示例待核']),
    pattern('pattern-06','Discord 式社区','主题讨论','高频对话需要频道、回复、提及、反应和子串。',['Discord'],'频道过多导致找不到上下文；重要结论沉在聊天里。','#/threads','讨论串',{type:'community',labels:['频道','消息流','成员']}),
    pattern('pattern-07','Copilot 侧栏','上下文助手','主任务不能被打断，但用户需要随时询问、生成或解释当前对象。',['GitHub Copilot Chat in Visual Studio Code'],'侧栏不知道当前选中对象；建议无法一键落到主工作区。','#/workshop','实战工坊',{type:'sidebar',labels:['主工作区','助手侧栏']}),
    pattern('pattern-08','知识图谱','关系探索','用户需要理解概念、来源、实践和人的关联。',['Obsidian Graph view'],'关系线很多但没有任务入口；把共现误写成因果。','#/knowledge','知识地图',{type:'graph',labels:['概念','来源','实践']}),
    pattern('pattern-09','主从列表','密集目录','条目多、详情长，用户需要快速切换并保留当前位置。',['Notion 的侧栏 + 页面'],'列表和详情同权导致拥挤；手机上仍强制双栏。','#/skills','Skill 库',{type:'master',labels:['筛选列表','详情工作台']}),
    pattern('pattern-10','证据评审队列','治理审核','按风险和证据处理提交、变更或申诉。',['GitHub pull request review'],'只有通过/拒绝，没有证据、意见与复查记录。','#/governance','知识治理',{type:'review',labels:['待审','证据','决定']}),
    pattern('pattern-11','执行时间线','过程回放','需要知道任务按什么顺序发生、在哪一步失败并从那里重试。',['GitHub Actions workflow run'],'只记成功结果；时间线事件没有输入、输出与重试语义。','#/project','共同项目',{type:'timeline',labels:['触发','执行','结果']}),
    pattern('pattern-12','赛季榜 + 个人流水','激励反馈','展示阶段性进展，同时让每个数字都能回到个人可见的记分流水。',['Duolingo leagues'],'公开排名制造压力；分数规则不透明；把付费权益混进能力等级。','#/leaderboard','赛季榜',{type:'rank',labels:['排名','趋势','计分来由']})
  ];

  var skills = skillSeeds.map(skill);
  skills[0].bounty = { id: 'lib-bounty-skill-01', kind: 'help', amount: 30, status: 'open', synthetic: true };
  prompts[2].bounty = { id: 'lib-bounty-prompt-03', kind: 'help', amount: 20, status: 'open', synthetic: true };
  components[3].bounty = { id: 'lib-bounty-component-04', kind: 'help', amount: 25, status: 'open', synthetic: true };
  patterns[4].bounty = { id: 'lib-bounty-pattern-05', kind: 'help', amount: 40, status: 'open', synthetic: true };

  var IMAGES = {
    'skill-01': 'lib-skill-1', 'skill-02': 'lib-skill-2', 'skill-03': 'lib-skill-3', 'skill-04': 'lib-skill-4',
    'prompt-01': 'lib-prompt-1', 'prompt-03': 'lib-prompt-2', 'prompt-10': 'lib-prompt-3', 'prompt-13': 'lib-prompt-4',
    'component-01': 'lib-component-1', 'component-02': 'lib-component-2', 'component-03': 'lib-component-3', 'component-04': 'lib-component-4',
    'pattern-01': 'lib-pattern-1', 'pattern-02': 'lib-pattern-2', 'pattern-03': 'lib-pattern-3', 'pattern-04': 'lib-pattern-4'
  };
  [skills, prompts, components, patterns].forEach(function (list) {
    list.forEach(function (item) {
      if (IMAGES[item.id]) item.image = 'assets/samples/' + IMAGES[item.id] + '.webp';
    });
  });

  var PEOPLE = [
    { handle: 'lin-qi', name: '林栖', level: 1 },
    { handle: 'chen-mo', name: '陈墨', level: 3 },
    { handle: 'yu-lan', name: '余岚', level: 4 },
    { handle: 'song-yuan', name: '松原', level: 5 }
  ];
  skills.concat(prompts, components, patterns).forEach(function (item, index) {
    var author = PEOPLE[index % PEOPLE.length];
    item.author = author.name;
    item.authorHandle = author.handle;
    item.authorLevel = author.level;
    item.contributors = [PEOPLE[(index + 1) % PEOPLE.length]];
    item.usedBy = [PEOPLE[(index + 2) % PEOPLE.length], PEOPLE[(index + 3) % PEOPLE.length]];
  });

  var THREAD_PEOPLE = [
    { id: 'lib-gu', handle: 'chen-mo', name: '陈墨', level: 3, levelName: '骨干' },
    { id: 'lib-ye', handle: 'yu-lan', name: '余岚', level: 4, levelName: '领航员' },
    { id: 'lib-wen', handle: 'lin-qi', name: '林栖', level: 1, levelName: '新队员' }
  ];
  var THREAD_MESSAGES = [
    { id: 'lib-c1', authorId: 'lib-ye', body: '我最想看到的是失败条件，知道什么时候别用，比多一个功能更有帮助。', createdAt: '2026-10-25T09:10:00-07:00', reply_to: null, thread_root: 'lib-c1', status: 'ok', reactions: { useful: 2 }, mine: {} },
    { id: 'lib-c2', authorId: 'lib-wen', body: '安装段最好保留按客户端切换，这样不会把不同目录混在一起。', createdAt: '2026-10-25T09:24:00-07:00', reply_to: 'lib-c1', thread_root: 'lib-c1', quote: { id: 'lib-c1', authorId: 'lib-ye', authorName: '余岚', excerpt: '我最想看到的是失败条件' }, status: 'ok', reactions: { learned: 1 }, mine: {} }
  ];

  function componentPreview(kind) {
    if (kind === 'dialog') return '<div class="lib-mini-dialog"><small>确认操作</small><b>保留未保存内容？</b><span><i>取消</i><i>保留</i></span></div>';
    if (kind === 'menu') return '<div class="lib-mini-menu"><button>操作</button><span>编辑</span><span>复制链接</span><span>归档</span></div>';
    if (kind === 'table') return '<div class="lib-mini-table"><b>条目</b><b>状态</b><span>设计走查</span><i>待复核</i><span>数据契约</span><i>已通过</i></div>';
    if (kind === 'focus') return '<div class="lib-mini-focus"><span>键盘焦点</span><button>继续</button><small>Tab 顺序 2 / 4</small></div>';
    if (kind === 'status') return '<div class="lib-mini-status"><span>草稿</span><span>待复核</span><span>已发布</span></div>';
    if (kind === 'command') return '<div class="lib-mini-command"><b>输入命令…</b><span>打开资料库 <kbd>↵</kbd></span><span>新建草稿 <kbd>N</kbd></span></div>';
    if (kind === 'review') return '<div class="lib-mini-review"><span>2 个检查通过</span><b>请求修改</b><small>缺少空态恢复动作</small></div>';
    if (kind === 'form') return '<div class="lib-mini-form"><label>项目名称</label><span>资源库示例</span><button>保存</button></div>';
    return '<div class="lib-mini-button"><button>保存更改</button><span>使用本站 token 重画</span></div>';
  }

  window.COMMONS_LIBRARY_SAMPLE = {
    componentPreview: componentPreview,
    threadPeople: THREAD_PEOPLE, threadMessages: THREAD_MESSAGES, threadLastRead: '2026-10-25T08:00:00-07:00',
    skills: skills,
    prompts: prompts,
    components: components,
    patterns: patterns
  };
})();

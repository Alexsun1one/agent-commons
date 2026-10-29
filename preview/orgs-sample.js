/* R13 ORG-1 · 12 个合成团队示例。 */
(function () {
  'use strict';

  var avatars = [
    'assets/mascot/panda-avatar-brand-blue-512.webp',
    'assets/mascot/panda-avatar-classic-512.webp',
    'assets/mascot/panda-avatar-graphite-512.webp',
    'assets/mascot/panda-avatar-mint-512.webp',
    'assets/mascot/panda-avatar-mist-purple-512.webp',
    'assets/mascot/panda-avatar-night-sky-512.webp'
  ];
  var logos = [
    'assets/orgs/lab-nebula.webp',
    'assets/orgs/studio-tidal.webp',
    'assets/orgs/club-campus-ai.webp',
    'assets/orgs/oss-lantern.webp',
    'assets/orgs/team-bluefin.webp',
    'assets/orgs/lab-quartz.webp',
    'assets/orgs/studio-pixel-bamboo.webp',
    'assets/orgs/oss-tiny-agent.webp',
    'assets/orgs/club-prompt-guild.webp',
    'assets/orgs/team-cloudhop.webp',
    'assets/orgs/lab-glacier.webp',
    'assets/orgs/club-maker.webp'
  ];
  var banners = [
    'assets/orgs/banner-lab.webp',
    'assets/orgs/banner-studio.webp',
    'assets/orgs/banner-club.webp',
    'assets/orgs/banner-oss.webp'
  ];
  var people = [
    ['沈砚', 'shen-yan', 5], ['林川', 'lin-chuan', 4], ['叶舟', 'ye-zhou', 3],
    ['顾宁', 'gu-ning', 3], ['周岚', 'zhou-lan', 2], ['苏行', 'su-xing', 4]
  ];
  var seeds = [
    ['zero-one-lab', '零壹 Agent 实验室', 'lab', '把 Agent 评测做成可复现的公共基线。', 428, 960, 38, true, 'apply'],
    ['north-automation', '北岸自动化', 'company', '面向真实团队的流程自动化与交付工具。', 186, 742, 31, true, 'invite'],
    ['open-orchestration', '开源编排计划', 'open_source', '维护轻量、可审计的多 Agent 编排组件。', 312, 688, 35, true, 'apply'],
    ['deepblue-ai-club', '深蓝大学 AI 社', 'school_club', '学生发起的模型实践、讲堂与项目小队。', 274, 520, 27, false, 'apply'],
    ['knowledge-engineering', '知识工程同好会', 'interest_group', '研究检索、证据链和知识工作流。', 221, 496, 24, false, 'apply'],
    ['inspiration-factory', '灵感工厂', 'company', '让创意工作从一次生成走向稳定生产。', 94, 455, 22, true, 'invite'],
    ['local-model-workshop', '本地模型工坊', 'interest_group', '交流本地部署、量化和端侧推理经验。', 198, 431, 26, false, 'apply'],
    ['prompt-protocol', '提示词协议组', 'open_source', '整理提示词结构、版本和互操作约定。', 156, 389, 19, false, 'apply'],
    ['repro-lab', '可复现实验室', 'lab', '复现论文、公开失败过程并沉淀检查清单。', 83, 344, 21, true, 'invite'],
    ['smart-hardware-squad', '智能硬件小队', 'interest_group', '把模型接进传感器、机械臂和小设备。', 132, 302, 17, false, 'apply'],
    ['agent-education-alliance', 'Agent 教育联盟', 'open_source', '共建课程、作业与教师可复用的案例库。', 117, 278, 16, true, 'apply'],
    ['public-ai-coop', '公益智能协作社', 'interest_group', '为公益项目提供有边界的 AI 志愿协作。', 76, 214, 14, false, 'apply']
  ];
  var typeNames = {
    company: '公司', lab: '实验室', school_club: '学校社团',
    open_source: '开源项目', interest_group: '兴趣小组'
  };

  function members(offset) {
    var rows = people.slice(0, 5).map(function (person, index) {
      var source = people[(index + offset) % people.length];
      return {
        id: 'member-' + offset + '-' + index,
        name: source[0], handle: source[1], level: source[2],
        role: index === 0 ? 'owner' : (index < 2 ? 'admin' : 'member'),
        avatar: avatars[(index + offset) % avatars.length]
      };
    });
    if (offset < 2) {
      rows[4] = {
        id: 'member-self-' + offset, name: '陈墨', handle: 'chen-mo', level: 3,
        role: 'member', avatar: avatars[2]
      };
    }
    return rows;
  }

  function posts(name, index) {
    return [
      { id: 'p-' + index + '-1', kind: 'feed', title: '本周进展', body: name + ' 更新了公开路线图和两项复现实验。', at: '今天 10:20' },
      { id: 'p-' + index + '-2', kind: 'feed', title: '新成员见面会', body: '三位成员带着作品完成了第一次互评。', at: '昨天 18:40' },
      { id: 'p-' + index + '-3', kind: 'feed', title: '协作记录', body: '评审清单新增了失败样例与回退步骤。', at: '10 月 23 日' }
    ];
  }

  function works() {
    return [
      { id: 'agent-eval-bench', kind: 'work', typeLabel: 'HTML 作品', title: 'Agent 回归评测台', author: '沈砚', authorHandle: 'shen-yan' },
      { id: 'knowledge-trace', kind: 'knowledge', typeLabel: '知识卡', title: '知识检索证据图', author: '叶舟', authorHandle: 'ye-zhou' },
      { id: 'team-retro', kind: 'talk', typeLabel: '讲堂', title: '多人协作复盘', author: '林川', authorHandle: 'lin-chuan' }
    ];
  }

  function jobs(name, index) {
    return [
      { id: 'job-' + index + '-1', kind: 'market', title: 'Agent 工程实习生', meta: name + ' · 远程' },
      { id: 'job-' + index + '-2', kind: 'market', title: '知识工程协作者', meta: '项目制 · 每周 8 小时' }
    ];
  }

  function events(name, index) {
    return [
      { id: 'e-' + index + '-1', kind: 'event', title: '开放实验日', meta: '10 月 29 日 · 线上' },
      { id: 'e-' + index + '-2', kind: 'event', title: name + ' 月度分享', meta: '11 月 2 日 · 站内房间' }
    ];
  }

  window.COMMONS_ORGS_SAMPLE = {
    label: '示例',
    viewer: { id: 'local-self', handle: 'chen-mo', name: '陈墨' },
    types: Object.keys(typeNames).map(function (id) { return { id: id, label: typeNames[id] }; }),
    orgs: seeds.map(function (seed, index) {
      return {
        slug: seed[0], name: seed[1], type: seed[2], typeLabel: typeNames[seed[2]], intro: seed[3],
        members: seed[4], followers: seed[5], activity: seed[6], verified: seed[7], joinPolicy: seed[8],
        website: 'https://example.org/' + seed[0], logo: logos[index], banner: banners[index % banners.length],
        membersList: members(index), posts: posts(seed[1], index), works: works(),
        jobs: jobs(seed[1], index), events: events(seed[1], index)
      };
    })
  };
})();

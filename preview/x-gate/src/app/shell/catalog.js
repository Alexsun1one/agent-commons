export const SPACE_IDS = ['base', 'network', 'hub', 'cocreation', 'value'];
// entries：空间卡上的三个入口格（板块 id、两到四字名、图标名）；主按钮另走 primary。
const define = (id, title, en, tagline, labels, primary, first, entries) => ({
  id, title, en, tagline,
  sections: labels.map(([id, label]) => ({ id, label })),
  primary: { label: primary, section: first },
  entries: entries.map(([section, label, glyph]) => ({ section, label, glyph })),
});
export const CATALOG = {
  base: define('base', '中央总部', 'X-GATE BASE', '连接人与 AI，汇聚社群力量。', [['brand','品牌理念'],['mission','品牌使命'],['news','最新动态'],['guide','空间导览'],['start','新人起步']], '开始探索', 'start', [['brand','理念','spark'],['news','动态','pulse'],['guide','导览','compass']]),
  network: define('network', '智能体连接中心', 'AGENT NETWORK', '发现 Agent，认识能力，建立连接。', [['discover','Agent 发现'],['skills','能力与技能'],['relations','协作关系'],['cases','应用案例'],['graph','生态网络图']], '连接 Agent', 'discover', [['skills','能力','bolt'],['graph','图谱','graph'],['cases','案例','folder']]),
  hub: define('hub', '智能体管理中心', 'AGENT HUB', '管理自己的 Agent，让协作开始运转。', [['agents','我的 Agent'],['create','创建与配置'],['tools','工具与技能']], '新建 Agent', 'create', [['agents','智能体','agent'],['create','配置','flow'],['tools','工具','bolt']]),
  cocreation: define('cocreation', '社区共创中心', 'CO-CREATION', '人与 AI 一起做事。', [['members','成员与创作者'],['projects','共创项目'],['works','作品与案例'],['events','社区活动'],['recruit','协作与招募']], '发起共创', 'projects', [['members','成员','person'],['works','作品','frame'],['events','活动','calendar']]),
  value: define('value', '价值中心', 'VALUE CITY', '看见协作留下的成果与成长。', [['profile','成长档案'],['contrib','作品与贡献'],['impact','社区影响力'],['results','项目成果'],['growth','协作价值']], '查看我的成长', 'profile', [['contrib','贡献','trophy'],['impact','影响力','ripple'],['results','成果','check']]),
};
export function validSpaceModule(mod, id) {
  return !!mod && mod.id === id && typeof mod.title === 'string' && typeof mod.tagline === 'string'
    && Array.isArray(mod.sections) && CATALOG[id].sections.every(s => mod.sections.some(v => v.id === s.id && typeof v.label === 'string'))
    && mod.sections.some(s => s.id === mod.primary?.section) && typeof mod.primary?.label === 'string'
    && typeof mod.highlights === 'function' && typeof mod.mount === 'function';
}

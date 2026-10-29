(() => {
'use strict';
// 十个主页面：侧栏只列这些；子功能是页签（tabs）或二级页签（sub），旧路由全部保留并落到对应页签。
const HUBS=[
 {id:'home',label:'首页',icon:'home',tabs:[{route:'home',label:'首页',also:['today']}]},
 {id:'feed',label:'动态',icon:'feed',tabs:[
  {route:'feed',label:'动态'},
  {route:'hot',label:'热点',icon:'flame',also:['sources']},
  {route:'threads',label:'讨论',also:['discuss']},
  {route:'groups',label:'小组',also:['group']},
  {route:'agents',label:'Agent 广场'}]},
 {id:'knowledge',label:'知识',icon:'book',tabs:[
  {route:'knowledge',label:'知识网',also:['read','write']},
  {route:'solved',label:'问题库'},
  {route:'skills',label:'资源库',also:['prompts','components','patterns','tools','tool']},
  {route:'workshop',label:'实战工坊'}]},
 {id:'people',label:'作品与同行',icon:'people',tabs:[
  {route:'people',label:'作品与成员',also:['u','work','benefits']},
  {route:'friends',label:'关注'},
  {route:'orgs',label:'团队',also:['org','teams']},
  {route:'constellation',label:'星图',liveOnly:true},
  {route:'buddies',label:'找搭子'}]},
 {id:'rooms',label:'房间与活动',icon:'rooms',tabs:[
  {route:'rooms',label:'房间',also:['room','board']},
  {route:'talks',label:'讲堂',also:['talk','teaching']},
  {route:'events',label:'活动',also:['event'],sub:[['events','活动列表'],['calendar','日历']]},
  {route:'campaigns',label:'打榜',also:['campaign'],sub:[['campaigns','作品打榜'],['leaderboard','赛季榜']]}]},
 {id:'market',label:'市集与合作',icon:'tag',tabs:[
  {route:'market',label:'闲置与线索'},
  {route:'bounties',label:'悬赏'},
  {route:'opportunities',label:'合作机会',also:['sponsor']},
  {route:'project',label:'共同项目'}]},
 {id:'games',label:'乐园',icon:'dice',tabs:[
  {route:'games',label:'游戏',also:['exam','guess','draw','sofas']},
  {route:'farm',label:'农场'},
  {route:'parking',label:'车位'},
  {route:'pet',label:'小窝'},
  {route:'shop',label:'竹子',also:['wallet']}]},
 {id:'data',label:'数据',icon:'chart',tabs:[
  {route:'drift',label:'话题漂移'},
  {route:'insights',label:'群体成长'},
  {route:'archive',label:'群记录',demoOnly:true}]},
 {id:'me',label:'我',icon:'people',tabs:[
  {route:'me',label:'工作台',also:['profile','join']},
  {route:'contribute',label:'创作',sub:[['contribute','投稿'],['creator','创作者中心']]},
  {route:'growth',label:'成长',also:['tiers','levels','membership','pricing','achievements']},
  {route:'account',label:'设置',sub:[['account','账号'],['avatar-lab','头像'],['connect','接入 Agent'],['invite','邀请'],['app','安装应用']]}]},
 {id:'messages',label:'消息',icon:'chat',side:false,tabs:[
  {route:'messages',label:'私信'},
  {route:'notifications',label:'通知'},
  {route:'announcements',label:'公告'}]},
 {id:'manage',label:'管理',icon:'shield',tabs:[
  {route:'govern',label:'治理台',also:['governance']},
  {route:'admin',label:'总后台'}]}
];
// 这些路由是对象详情或全屏工具：侧栏高亮所属主页面，但不画主页面页首。
const DETAIL=new Set(['today','teaching','read','write','tool','u','work','benefits','org','teams','group','room','board','talk','event','campaign','sponsor','admin']);
// 已去掉自己页首的路由：外壳画完整页首（标题 + 页签）；其余只画页签，避免过渡期出现两个大标题。
const READY=new Set([]);
// 群记录是群聊原文，只在本机演示包里有；线上包不带，页签也不画。
const LIVE_AT_LOAD=window.COMMONS_BUILD_LIVE===true||window.CommonsAPI?.mode==='live';
HUBS.forEach(hub=>{hub.tabs=hub.tabs.filter(tab=>LIVE_AT_LOAD?!tab.demoOnly:!tab.liveOnly);});
const index=new Map();
HUBS.forEach(hub=>hub.tabs.forEach(tab=>{
 const add=(route,sub)=>{if(!index.has(route))index.set(route,{hub,tab,sub});};
 add(tab.route,tab.sub?.[0]);
 (tab.sub||[]).forEach(sub=>add(sub[0],sub));
 (tab.also||[]).forEach(route=>add(route,null));
}));
const locate=route=>index.get(route)||null;
const gamesOn=()=>window.CommonsGames?.enabled?.()!==false;
const live=()=>window.COMMONS_BUILD_LIVE===true||window.CommonsAPI?.mode==='live';
// 真实模式下「管理」只给管理员和治理员；演示模式照旧全显示。
const canManage=()=>!live()||['admin','governor'].some(role=>window.CommonsSession?.hasRole?.(role));
const visible=()=>HUBS.filter(hub=>hub.side!==false&&(hub.id!=='games'||gamesOn())&&(hub.id!=='manage'||canManage()));
const modules=()=>[window.CommonsHTML,window.CommonsInsights,window.CommonsGrowth,window.CommonsKnowledge,window.CommonsMember,window.CommonsContributions,window.CommonsBuddies,window.CommonsArchiveView,window.CommonsExtensions,...(window.CommonsPages||[])].filter(Boolean);
const isReady=route=>READY.has(route)||modules().some(page=>page.hub===true&&page.routes&&route in page.routes||Array.isArray(page.hub)&&page.hub.includes(route));
function head(route,id){
 const at=locate(route);
 if(!at||DETAIL.has(route)||id)return '';
 const {hub,tab}=at,C=window.Commons,full=isReady(route);
 if(hub.tabs.length<2&&!tab.sub)return '';
 const tabs=hub.tabs.length>1?`<nav class="hub-tabs" aria-label="${C.esc(hub.label)}">${hub.tabs.map(item=>{const current=item===tab;return `<a class="hub-tab${current?' is-current':''}" href="#/${C.esc(item.route)}"${current?` aria-current="${item.route===route?'page':'true'}"`:''}>${C.esc(item.label)}</a>`;}).join('')}</nav>`:'';
 const sub=tab.sub?`<nav class="hub-sub" aria-label="${C.esc(tab.label)}">${tab.sub.map(([subRoute,label])=>{const current=subRoute===route||at.sub?.[0]===subRoute;return `<a class="hub-sub-link${current?' is-current':''}" href="#/${C.esc(subRoute)}"${current?` aria-current="${subRoute===route?'page':'true'}"`:''}>${C.esc(label)}</a>`;}).join('')}</nav>`:'';
 return `<header class="hub-head${full?'':' is-tabs-only'}" data-hub="${C.esc(hub.id)}">${full?`<h1 class="hub-title">${C.esc(hub.label)}</h1>`:''}${tabs}${sub}</header>`;
}
function title(route){const at=locate(route);if(!at)return '';return at.hub.tabs.length>1?`${at.hub.label} · ${(at.sub?.[1]&&at.tab.sub?at.sub[1]:at.tab.label)}`:at.hub.label;}
function sameHub(a,b){const x=locate(a),y=locate(b);return !!(x&&y&&x.hub===y.hub);}
function focusTab(){const link=document.querySelector('#main .hub-head .hub-sub-link.is-current')||document.querySelector('#main .hub-head .hub-tab.is-current');if(!link)return false;link.focus({preventScroll:true});link.scrollIntoView?.({block:'nearest',inline:'nearest'});return true;}
function syncScroll(){document.querySelectorAll('#main .hub-tabs,#main .hub-sub').forEach(bar=>{const current=bar.querySelector('.is-current');if(!current||bar.scrollWidth<=bar.clientWidth)return;const left=current.offsetLeft-bar.clientWidth/2+current.offsetWidth/2;bar.scrollLeft=Math.max(0,left);});}

// ---- R17-F：真实模式下的实战工坊、合作机会、共同项目 ----
// 三页的演示版在 app.js；真实模式由 app.js 调 CommonsHubs.livePage(name)，数据来自 orgs 模块的只读聚合接口，没有数据就如实写「还没有」。
const LIVE_PAGES={
 workshop:{path:'/orgs/hub/workshop',lead:'能动手练的训练营、挑战，和可以照着装的 Skill。'},
 opportunities:{path:'/orgs/hub/opportunities',lead:'找项目、找工作，或加入一个正在招人的团队。'},
 project:{path:'/orgs/hub/projects',lead:'团队挂在主页上的作品，就是他们正在一起做的事。'}
};
const OPP_FILTERS=[['all','全部'],['collab','合作与外包'],['jobs','内推与招聘'],['team','团队招募']];
const hubLive={pages:{},filter:'all'};
const STALE_MS=30000;
const E=value=>window.Commons.esc(String(value??''));
const U=value=>window.Commons.safeUrl(String(value??''));
const day=value=>String(value||'').slice(0,10);
const closedError=error=>!!error&&(error.status===501||error.code==='capability_unavailable');
function refreshPage(){if(window.Commons&&window.Commons.refresh)window.Commons.refresh();}
function fetchLive(name){
 const api=window.CommonsAPI,spec=LIVE_PAGES[name];
 if(!api||!spec)return;
 const st=hubLive.pages[name]=hubLive.pages[name]||{};
 if(st.fetching)return;
 st.fetching=true;
 api.get(spec.path).then(res=>{
  st.data=res&&res.data;st.sources=(res&&res.meta&&res.meta.sources)||{};st.error='';st.at=Date.now();st.fetching=false;refreshPage();
 }).catch(error=>{
  st.fetching=false;st.at=Date.now();st.error=closedError(error)?'closed':((error&&error.message)||'没有读出来');refreshPage();
 });
}
/* safe-slot: actions、body — 只接收本文件里逐值转义过的片段 */
function pageShell(name,actions,body){
 return `<div class="page hub-tab-page hubp" data-hubs-page="${E(name)}"><header class="hubp-head"><p>${E(LIVE_PAGES[name].lead)}</p><div class="hubp-actions">${actions||''}</div></header>${body}</div>`;
}
function stateCard(title,text,links){
 return `<div class="empty hubp-empty"><h3>${E(title)}</h3>${text?`<p>${E(text)}</p>`:''}${(links||[]).map(([href,label])=>`<a class="button" href="${U(href)}">${E(label)}</a>`).join(' ')}</div>`;
}
function sourceNote(sources,names){
 const down=names.filter(([key])=>sources&&sources[key]==='unavailable').map(([,label])=>label);
 return down.length?`<p class="hubp-note" role="status">${E(down.join('、'))}暂时没有开放，这里先不显示。</p>`:'';
}
function oppCard(item){
 const facts=(item.facts||[]).map(fact=>`<span>${E(fact.label)} ${E(fact.value)}</span>`).join('');
 const org=item.orgSlug&&item.kind!=='team'?`<a class="hubp-org" href="#/org/${E(encodeURIComponent(item.orgSlug))}">看团队主页</a>`:'';
 return `<article class="hubp-card"><div class="hubp-kind"><span class="pill outline">${E(item.kindLabel)}</span></div><h2><a href="${U(item.href)}">${E(item.title)}</a></h2>${item.excerpt?`<p>${E(item.excerpt)}</p>`:''}<p class="hubp-facts">${facts}</p><p class="hubp-meta">${E([item.author,day(item.createdAt)].filter(Boolean).join(' · '))}</p><div class="hubp-card-actions"><a class="button primary" href="${U(item.href)}">${item.kind==='team'?'去看看':'我想参与'}</a>${org}</div></article>`;
}
function liveOpportunities(st){
 const items=Array.isArray(st.data)?st.data:[];
 const filter=OPP_FILTERS.some(([key])=>key===hubLive.filter)?hubLive.filter:'all';
 const shown=items.filter(item=>filter==='all'||item.kind===filter);
 const chips=`<div class="hubp-filters" role="group" aria-label="机会类型">${OPP_FILTERS.map(([key,label])=>`<button type="button" class="chip${key===filter?' selected':''}" data-hubs-act="filter" data-value="${key}" aria-pressed="${key===filter}">${label}</button>`).join('')}</div>`;
 const note=sourceNote(st.sources,[['collab','合作与外包'],['jobs','内推与招聘']]);
 const body=shown.length?`<section class="hubp-grid" aria-label="合作机会">${shown.map(oppCard).join('')}</section>`
  :stateCard('还没有合作机会','有人发布合作、外包或招聘，或有团队开始招人，会出现在这里。你有需求也可以自己发布。',[['#/market/new','发布合作需求'],['#/orgs','看看团队']]);
 return pageShell('opportunities','<a class="button primary" href="#/market/new">发布合作需求</a>',chips+note+body);
}
function liveProjects(st){
 const items=Array.isArray(st.data)?st.data:[];
 if(!items.length)return pageShell('project','<a class="button" href="#/orgs">去团队目录</a>',stateCard('还没有共同项目','团队成员把作品挂到团队主页后，这个团队的项目就会出现在这里。',[['#/orgs','去团队目录'],['#/opportunities','看看合作机会']]));
 const cards=items.map(item=>{
  const org=item.org||{};
  const works=(item.works||[]).map(work=>`<li><a href="#/work/${E(encodeURIComponent(work.id))}">${E(work.title)}</a><small>${E([work.author,day(work.createdAt)].filter(Boolean).join(' · '))}</small></li>`).join('');
  return `<article class="hubp-card"><div class="hubp-kind"><span class="pill outline">${E(org.typeLabel)}</span>${org.verified?'<span class="pill agent">已认证</span>':''}</div><h2><a href="#/org/${E(encodeURIComponent(org.slug))}">${E(org.name)}</a></h2>${org.intro?`<p>${E(org.intro)}</p>`:''}<p class="hubp-facts"><span>${E(item.members)} 位成员</span><span>${E(item.workCount)} 件作品</span></p><ul class="hubp-works">${works}</ul><div class="hubp-card-actions"><a class="button" href="#/org/${E(encodeURIComponent(org.slug))}">看团队主页</a></div></article>`;
 }).join('');
 return pageShell('project','<a class="button" href="#/orgs">去团队目录</a>',`<section class="hubp-grid" aria-label="共同项目">${cards}</section>`);
}
function liveWorkshop(st){
 const data=st.data&&typeof st.data==='object'?st.data:{};
 const events=Array.isArray(data.events)?data.events:[],skills=Array.isArray(data.skills)?data.skills:[];
 const note=sourceNote(st.sources,[['events','活动'],['skills','资源库']]);
 if(!events.length&&!skills.length)return pageShell('workshop','<a class="button" href="#/events">看活动</a>',note+stateCard('还没有可练习的内容','有训练营、挑战开始，或资源库里有了可以照着装的 Skill，会列在这里。',[['#/events','去活动'],['#/skills','去资源库']]));
 const eventList=events.length?`<ul class="hubp-rows">${events.map(event=>`<li><div><div class="hubp-kind"><span class="pill outline">${E(event.kindLabel)}</span><span class="pill ${event.status==='live'?'agent':'outline'}">${E(event.statusLabel)}</span></div><h3><a href="${U(event.href)}">${E(event.title)}</a></h3>${event.summary?`<p>${E(event.summary)}</p>`:''}<small>${E([event.host,`${day(event.startsAt)} 至 ${day(event.endsAt)}`,`${event.signups} 人报名`].filter(Boolean).join(' · '))}</small></div><a class="button small" href="${U(event.href)}">查看</a></li>`).join('')}</ul>`:'<p class="hubp-note">现在没有进行中或即将开始的训练营和挑战。</p>';
 const skillList=skills.length?`<ul class="hubp-rows">${skills.map(skill=>`<li><div><div class="hubp-kind"><span class="pill outline">${E(skill.category)}</span></div><h3><a href="${U(skill.href)}">${E(skill.title)}</a></h3>${skill.purpose?`<p>${E(skill.purpose)}</p>`:''}<small>${E(skill.author)}</small></div><a class="button small" href="${U(skill.href)}">照着做</a></li>`).join('')}</ul>`:'<p class="hubp-note">资源库里还没有可以照着做的 Skill。</p>';
 return pageShell('workshop','<a class="button" href="#/events">看活动</a>',`${note}<section class="hubp-section"><h2>训练营与挑战</h2>${eventList}</section><section class="hubp-section"><h2>可以照着做的 Skill</h2>${skillList}</section>`);
}
function livePage(name){
 if(!LIVE_PAGES[name])return '';
 const st=hubLive.pages[name];
 if(!st||(!st.fetching&&(!st.at||Date.now()-st.at>STALE_MS)))fetchLive(name);
 const now=hubLive.pages[name];
 if(now.error&&!now.fetching){
  if(now.error==='closed')return `<div class="page hubp">${stateCard('这个功能还没开放','管理员还没打开。',[])}</div>`;
  return `<div class="page hubp"><div class="empty hubp-empty" role="alert"><h3>没有读出来</h3><p>${E(now.error)}</p><button type="button" class="button" data-hubs-act="retry" data-value="${E(name)}">重试</button></div></div>`;
 }
 if(now.data===undefined)return `<div class="page hubp"><div class="empty hubp-empty" aria-live="polite"><h3>正在读取…</h3></div></div>`;
 return name==='opportunities'?liveOpportunities(now):name==='project'?liveProjects(now):liveWorkshop(now);
}
function onHubClick(event){
 const button=event.target&&event.target.closest&&event.target.closest('[data-hubs-act]');
 if(!button)return;
 const act=button.dataset.hubsAct,value=button.dataset.value||'';
 if(act==='filter'){hubLive.filter=value;refreshPage();}
 else if(act==='retry'&&LIVE_PAGES[value]){const st=hubLive.pages[value];if(st){st.error='';st.at=0;st.data=undefined;}refreshPage();}
}
if(typeof document!=='undefined'&&document.addEventListener)document.addEventListener('click',onHubClick);
if(typeof window.addEventListener==='function')window.addEventListener('commons:session',()=>{hubLive.pages={};hubLive.filter='all';});
window.CommonsHubs={HUBS,locate,visible,head,title,sameHub,focusTab,syncScroll,livePage,isDetail:route=>DETAIL.has(route)};
})();

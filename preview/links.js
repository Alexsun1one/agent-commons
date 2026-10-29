(() => {
'use strict';

// kind -> 站内路由。detail 为对象详情；没有 detail 的 kind 只退到 list。
const KIND_ROUTES=Object.freeze({
 person:{detail:'u',list:'people'},org:{detail:'org',list:'orgs'},thread:{detail:'threads',list:'threads'},
 knowledge:{detail:'knowledge',list:'knowledge'},talk:{detail:'talk',list:'talks'},
 room:{detail:'room',list:'rooms'},event:{detail:'event',list:'events'},
 campaign:{detail:'campaign',list:'campaigns'},bounty:{detail:'bounties',list:'bounties'},
 market:{detail:'market',list:'market'},tool:{detail:'tool',list:'tools'},skill:{list:'skills'},
 prompt:{list:'prompts'},component:{list:'components'},pattern:{list:'patterns'},
 group:{detail:'group',list:'groups'},farm:{detail:'farm',list:'farm'},
 parking:{detail:'parking',list:'parking'},pet:{detail:'pet',list:'pet'},game:{list:'games'},
 feed:{list:'feed'},work:{detail:'work',list:'people'},achievement:{list:'achievements'},
 message:{list:'messages'},wallet:{list:'wallet'},notification:{list:'notifications'},account:{list:'account'}
});

const BASE_ROUTES=new Set([
 'home','knowledge','people','work','workshop','opportunities','project','governance','sources',
 'me','join','profile','contribute','discuss'
]);

const ROUTE_LABELS=Object.freeze({
 home:'发现',today:'今天',hot:'AI 热点',threads:'讨论串',agents:'Agent 广场',bounties:'悬赏',people:'作品与同行',buddies:'找搭子',discuss:'开放讨论',
 feed:'动态流',groups:'小组与板块',friends:'好友与关注',solved:'问题库',skills:'Skill 库',prompts:'提示词库',components:'组件库',patterns:'产品形态库',tools:'AI 工具榜',
 knowledge:'知识地图',talks:'讲堂',write:'写点什么',workshop:'实战工坊',teaching:'共作课堂',sources:'外部观察',
 events:'活动专区',campaigns:'打榜',calendar:'活动日历',rooms:'房间',games:'游戏中心',farm:'先锋农场',parking:'抢车位',pet:'熊猫小窝',exam:'先锋考试',guess:'猜提示词',
 market:'闲置与线索',opportunities:'合作机会',project:'共同项目',orgs:'团队',insights:'话题与成长',drift:'话题漂移','media-lab':'媒体件','html-lab':'HTML 沙箱','image-lab':'图片件',board:'讲课白板',
 growth:'我的成长',achievements:'成就',leaderboard:'赛季榜',tiers:'等级制度',membership:'会员会馆',shop:'竹子商店',pricing:'会员方案',
 me:'我的工作台',profile:'我的主页',messages:'私信',notifications:'通知',contribute:'我的投稿',account:'账号与隐私','avatar-lab':'头像与表情',connect:'接入 Agent',app:'安装应用',invite:'邀请好友',creator:'创作者中心',
 admin:'管理后台',govern:'治理台',governance:'知识治理',announcements:'公告',archive:'群记录',changelog:'更新日志'
});

// 侧栏路由 -> 相关入口。渲染时会剔除当前未注册的路由。
const RELATED=Object.freeze({
 home:['today','hot','people','knowledge'],today:['feed','hot','events','threads'],hot:['today','threads','agents','sources'],threads:['discuss','bounties','agents','knowledge'],agents:['threads','tools','connect','bounties'],bounties:['market','threads','opportunities','messages'],people:['buddies','orgs','feed','workshop'],buddies:['people','groups','messages','opportunities'],discuss:['threads','knowledge','people','governance'],
 feed:['friends','groups','today','messages'],groups:['feed','friends','orgs','events'],friends:['feed','groups','messages','people'],
 solved:['knowledge','threads','bounties','skills'],skills:['prompts','components','tools','knowledge'],prompts:['skills','components','patterns','write'],components:['patterns','skills','tools','workshop'],patterns:['components','prompts','tools','knowledge'],tools:['skills','components','agents','workshop'],
 knowledge:['solved','talks','workshop','sources'],talks:['knowledge','rooms','events','teaching'],write:['prompts','contribute','discuss','knowledge'],workshop:['knowledge','tools','people','teaching'],teaching:['talks','workshop','knowledge','rooms'],sources:['knowledge','hot','archive','governance'],
 events:['campaigns','calendar','rooms','groups'],campaigns:['events','leaderboard','people','prompts'],calendar:['events','rooms','campaigns','today'],rooms:['talks','events','groups','messages'],
 games:['farm','parking','pet','shop'],farm:['parking','games','shop','pet'],parking:['farm','games','friends','pet'],pet:['farm','parking','shop','games'],exam:['guess','games','growth','leaderboard'],guess:['exam','games','prompts','leaderboard'],
 market:['bounties','opportunities','groups','messages'],opportunities:['project','orgs','buddies','market'],project:['opportunities','orgs','people','board'],orgs:['project','opportunities','groups','people'],
 insights:['drift','growth','archive','knowledge'],drift:['hot','insights','archive','knowledge'],'media-lab':['image-lab','html-lab','board','tools'],'html-lab':['media-lab','image-lab','board','components'],'image-lab':['media-lab','html-lab','board','components'],board:['teaching','rooms','media-lab','project'],
 growth:['achievements','leaderboard','tiers','membership'],achievements:['growth','leaderboard','tiers','shop'],leaderboard:['growth','achievements','campaigns','tiers'],tiers:['growth','achievements','leaderboard','membership'],membership:['pricing','growth','shop','tiers'],shop:['growth','achievements','farm','pet'],pricing:['membership','growth','creator','account'],
 me:['profile','contribute','notifications','account'],profile:['me','contribute','achievements','account'],messages:['friends','notifications','groups','account'],notifications:['messages','account','announcements','today'],contribute:['profile','write','people','creator'],account:['profile','notifications','connect','app'],'avatar-lab':['profile','achievements','shop','account'],connect:['agents','tools','account','app'],app:['account','connect','changelog','home'],invite:['friends','groups','people','account'],creator:['contribute','people','pricing','account'],
 admin:['govern','governance','announcements','changelog'],govern:['admin','governance','announcements','archive'],governance:['govern','archive','sources','announcements'],announcements:['notifications','changelog','governance','today'],archive:['sources','governance','drift','changelog'],changelog:['announcements','app','home','governance']
});

const HUB_SPECS=Object.freeze([
 {key:'feed',label:'动态',route:'feed',icon:'rss',count:h=>count(window.COMMONS_SOCIAL_SAMPLE?.posts,x=>same(x.author,h))},
 {key:'thread',label:'讨论串',route:'threads',icon:'chat',count:h=>count(window.COMMONS_THREAD_SAMPLE?.messages,x=>same(x.authorId,h))},
 {key:'knowledge',label:'知识卡',route:'knowledge',icon:'book',count:h=>count(window.COMMONS_KNOWLEDGE?.units,x=>includesPerson(x.contributors,h))},
 {key:'work',label:'作品',route:'people',icon:'project',count:h=>count(window.COMMONS_PEOPLE_SAMPLE?.works,x=>same(x.author,h))},
 {key:'talk',label:'讲堂',route:'talks',icon:'teach',count:h=>{const d=window.COMMONS_TALKS_SAMPLE,speakers=d?.speakers||[];const ids=speakers.filter(x=>same(x.id,h)||same(x.handle,h)).map(x=>x.id);return count(d?.talks,x=>ids.includes(x.speakerId));}},
 {key:'bounty',label:'悬赏',route:'bounties',icon:'spark',count:h=>count(window.COMMONS_BOUNTY_SAMPLE?.bounties,x=>personMatch(x.owner,h))},
 {key:'market',label:'市集闲置',route:'market',icon:'tag',count:h=>count(window.COMMONS_MARKET_SAMPLE?.listings,x=>same(x.author,h))},
 {key:'event',label:'活动报名',route:'events',icon:'calendar',count:h=>count(window.COMMONS_EVENTS_SAMPLE?.events,x=>eventHas(x,h))},
 {key:'campaign',label:'打榜作品',route:'campaigns',icon:'chart',count:h=>(window.COMMONS_EVENTS_SAMPLE?.campaigns||[]).reduce((n,x)=>n+count(x.candidates,c=>same(c.authorId,h)),0)},
 {key:'org',label:'团队',route:'orgs',icon:'people',count:h=>count(window.COMMONS_ORGS_SAMPLE?.orgs,x=>count(x.membersList,m=>same(m.handle,h))>0)},
 {key:'group',label:'小组',route:'groups',icon:'people',count:h=>count(window.COMMONS_SOCIAL_SAMPLE?.groups,x=>includesPerson(x.admins,h)||includesPerson(x.memberIds,h))},
 {key:'farm',label:'农场',route:'farm',icon:'spark',count:h=>count(window.COMMONS_FARM_SAMPLE?.farms,x=>same(x.handle,h))},
 {key:'parking',label:'车位',route:'parking',icon:'map',count:h=>count(window.COMMONS_PARKING_SAMPLE?.friends,x=>same(x.handle,h))},
 {key:'pet',label:'熊猫小窝',route:'pet',icon:'heart',count:h=>count(window.COMMONS_PET_SAMPLE?.friends,x=>personMatch(x.owner,h))},
 {key:'tool',label:'工具栈',route:'tools',icon:'settings',count:h=>count(window.COMMONS_TOOLS_SAMPLE,x=>includesPerson(x.public_users,h))},
 {key:'achievement',label:'等级与成就',route:'achievements',icon:'shield',count:h=>{const p=(window.COMMONS_PEOPLE_SAMPLE?.profiles||[]).find(x=>same(x.handle,h));return Array.isArray(p?.badges)?p.badges.length:0;}}
]);

const HUB_ASSET_KINDS=new Set([
 'feed','thread','knowledge','work','talk','bounty','market','event','campaign','org','group','farm','parking','pet','tool','achievement','messages','wallet','notifications','account'
]);
const RELATED_ASSET_KINDS=Object.freeze({
 feed:'feed',threads:'thread',knowledge:'knowledge',people:'work',talks:'talk',bounties:'bounty',market:'market',events:'event',campaigns:'campaign',orgs:'org',groups:'group',farm:'farm',parking:'parking',pet:'pet',tools:'tool',achievements:'achievement',messages:'messages',notifications:'notifications',account:'account',wallet:'wallet'
});

const providers=new Map();

function esc(value){return window.Commons?.esc?window.Commons.esc(value):String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function safeUrl(value){const raw=String(value??'');return window.Commons?.safeUrl?window.Commons.safeUrl(raw):/^#\/[a-z][a-z0-9-]*(?:[/?#]|$)/.test(raw)?esc(raw):'#';}
function count(rows,predicate){return Array.isArray(rows)?rows.filter(predicate).length:0;}
function clean(value){return String(value??'').trim().replace(/^@+/,'').toLowerCase();}
function same(value,handle){return clean(value)===clean(handle)&&clean(handle)!=='';}
function personMatch(value,handle){
 if(typeof value==='string')return same(value,handle);
 if(!value||typeof value!=='object')return false;
 return ['id','handle','authorId','ownerId','personId','userId'].some(key=>same(value[key],handle));
}
function includesPerson(value,handle){return Array.isArray(value)&&value.some(item=>personMatch(item,handle));}
function eventHas(item,handle){return same(item?.hostId,handle)||['signups','participants'].some(key=>includesPerson(item?.[key],handle));}
function routes(){
 const found=new Set(BASE_ROUTES);
 Object.keys(window).filter(key=>/^Commons/.test(key)).forEach(key=>{
  const api=window[key];
  if(api?.routes&&typeof api.routes==='object')Object.keys(api.routes).forEach(route=>found.add(route));
  if(Array.isArray(api?.nav))api.nav.forEach(row=>{if(Array.isArray(row)&&row[0])found.add(row[0]);});
 });
 return found;
}
function hasRoute(route){return typeof route==='string'&&/^[a-z][a-z0-9-]*$/.test(route)&&routes().has(route);}
function localHref(route,id){
 if(!hasRoute(route))return '';
 const tail=id===undefined||id===null||String(id).trim()===''?'':'/'+encodeURIComponent(String(id));
 return '#/'+route+tail;
}
function href(kind,id){
 const config=KIND_ROUTES[String(kind||'')];
 if(!config)return '';
 const hasId=id!==undefined&&id!==null&&String(id).trim()!=='';
 if(hasId&&config.detail)return localHref(config.detail,id);
 return config.list?localHref(config.list):'';
}
function person(handle,name,opts){
 const label=name??'';
 if(!clean(handle)||String(handle)==='已注销成员'||String(label)==='已注销成员')return esc(label);
 const target=href('person',handle);
 if(!target)return esc(label);
 let body=esc(label);
 if(opts?.level&&window.CommonsLevel?.nameplate)body=window.CommonsLevel.nameplate({name:label,level:opts.level,handle:String(handle).replace(/^@+/,'')});
 return `<a class="lk-person" href="${safeUrl(target)}">${/* safe: CommonsLevel.nameplate 已逐值转义；无等级时 body 来自 esc */body}</a>`;
}
function a(kind,id,label,cls){
 const target=href(kind,id),className=['lk-link',String(cls||'').trim()].filter(Boolean).join(' ');
 return target?`<a class="${esc(className)}" href="${safeUrl(target)}">${esc(label)}</a>`:`<span class="${esc(className)}">${esc(label)}</span>`;
}
function provide(kind,fn){
 if(typeof fn!=='function')return false;
 const key=String(kind||'').trim();
 if(!key)return false;
 const list=providers.get(key)||[];list.push(fn);providers.set(key,list);return true;
}
function providerCard(spec,handle){
 const list=providers.get(spec.key)||[];
 for(const fn of list){
  let result=null;
  try{result=fn(handle);}catch{result=null;}
  if(!result||typeof result!=='object')continue;
  const match=/^#\/([a-z][a-z0-9-]*)(?:[/?#]|$)/.exec(String(result.href||''));
  if(!match||!hasRoute(match[1]))continue;
  return {label:result.label||spec.label,href:String(result.href),count:Number.isFinite(Number(result.count))?Math.max(0,Number(result.count)):0,icon:result.icon||spec.icon,kind:spec.key};
 }
 return null;
}
function icon(name){return window.Commons?.icon?window.Commons.icon(name):'';}
/* safe-fn: kind 必须命中本地清单；降级图标由 Commons.icon 渲染内置路径。 */
function hubIcon(item){
 if(HUB_ASSET_KINDS.has(item.kind))return `<img src="assets/hub/${esc(item.kind)}.webp" alt="" width="160" height="160" loading="lazy" decoding="async">`;
 return icon(item.icon);
}
function card(item,extraClass){
 const classes=['lk-hub-card',extraClass||'',item.emptyCta?'is-empty':''].filter(Boolean).join(' ');
 const name=item.actionArrow?`<span class="lk-hub-name"><span>${esc(item.label)}</span><b aria-hidden="true">→</b></span>`:`<span class="lk-hub-name">${esc(item.label)}</span>`;
 const countRow=item.actionArrow?'':`<span class="lk-hub-count"><strong>${esc(item.count)}</strong>${item.emptyCta?'<span class="lk-hub-empty-cta">去发第一个 <b aria-hidden="true">→</b></span>':''}</span>`;
 return `<a class="${esc(classes)}" href="${safeUrl(item.href)}"><span class="lk-hub-icon">${/* safe: hubIcon 只渲染白名单资产或 Commons.icon */hubIcon(item)}</span>${name}${countRow}</a>`;
}
function fallbackCard(spec,handle,self){
 const provider=providerCard(spec,handle);if(provider)return provider;
 const target=localHref(spec.route);if(!target)return null;
 let total=0;try{total=spec.count(handle);}catch{total=0;}
 const item={label:spec.label,href:target,count:Number.isFinite(Number(total))?Math.max(0,Number(total)):0,icon:spec.icon,kind:spec.key};
 if(self&&item.count===0)item.emptyCta=true;
 return item;
}
function selfCards(){
 const unread=(window.COMMONS_DM_SAMPLE?.threads||[]).reduce((n,x)=>n+(Number(x.unread)||0),0);
 const notices=count(window.COMMONS_NOTIFY_SAMPLE?.items,x=>!x.read_at);
 const bamboo=Number(window.COMMONS_ECONOMY_SAMPLE?.me?.balance)||0;
 return [
  {route:'messages',label:'私信',count:unread,icon:'chat',kind:'messages'},
  {route:'wallet',label:'竹子',count:bamboo,icon:'spark',kind:'wallet'},
  {route:'notifications',label:'通知',count:notices,icon:'clock',kind:'notifications'},
  {route:'account',label:'账号',count:1,icon:'settings',kind:'account'}
 ].map(item=>({...item,href:localHref(item.route)})).filter(item=>item.href);
}
function visitorCards(handle){
 return [
  {route:'messages',label:'发私信',icon:'chat',kind:'messages'},
  {route:'farm',label:'去 Ta 的农场',icon:'spark',id:handle,kind:'farm'},
  {route:'parking',label:'去 Ta 的车位',icon:'map',id:handle,kind:'parking'}
 ].map(item=>({label:item.label,icon:item.icon,kind:item.kind,actionArrow:true,href:localHref(item.route,item.id)})).filter(item=>item.href);
}
function hub(options){
 const config=options||{},handle=String(config.handle||'').replace(/^@+/,''),self=config.self===true;
 const items=HUB_SPECS.map(spec=>fallbackCard(spec,handle,self)).filter(item=>item&&(self||Number(item.count)>0));
 items.forEach(item=>{if(self&&Number(item.count)===0)item.emptyCta=true;});
 const actions=self?selfCards():visitorCards(handle);
 if(!items.length&&!actions.length)return '';
 return `<section class="lk-hub" aria-label="在先锋的入口"><header><h2>在先锋</h2><span>${esc(items.length)} 个入口</span></header><div class="lk-hub-grid">${items.map(item=>card(item,'')).join('')}</div>${actions.length?`<div class="lk-hub-actions">${actions.map(item=>card(item,'is-action')).join('')}</div>`:''}</section>`;
}
function related(route){
 const key=String(route||'').replace(/^#\/?/,'').split(/[/?#]/).filter(Boolean)[0]||'';
 const items=(RELATED[key]||[]).filter(hasRoute).slice(0,6).map(id=>({id,label:ROUTE_LABELS[id]||id,href:localHref(id),kind:RELATED_ASSET_KINDS[id]}));
 if(items.length<2)return '';
 return `<nav class="lk-related" aria-label="相关入口"><h2>相关入口</h2><div>${items.map(item=>`<a href="${safeUrl(item.href)}"><span class="lk-related-copy">${item.kind?/* safe: hubIcon 只渲染白名单资产 */hubIcon(item):''}<span>${esc(item.label)}</span></span><b aria-hidden="true">→</b></a>`).join('')}</div></nav>`;
}

window.CommonsLinks={href,person,a,provide,hub,related};
})();

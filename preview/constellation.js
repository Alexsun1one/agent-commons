(() => {
'use strict';
function isLive(){return !!(window.CommonsAPI&&window.CommonsAPI.mode==='live');}
const EMPTY={people:[],works:[],methods:[]};
const live={data:null,loading:false,error:'',at:0};
function D(){if(live.data&&isLive())return live.data;if(isLive())return {people:[],works:[],methods:[]};const data=window.COMMONS_DATA;return data&&typeof data==='object'?data:EMPTY;}
const ROLE_NAME={owner:'所有者',admin:'管理员',member:'成员'};
const liveTitle=text=>{const t=String(text||'');return t.length>8?t.slice(0,8)+'…':t;};
// 把 /orgs/hub/constellation 的团队→作品→成员 摆进原来的三圈：内环团队（work）、中环团队作品（method）、外环成员（person）。
function shapeLive(rows){
 const out={people:[],works:[],methods:[]},seen=new Map();
 (Array.isArray(rows)?rows:[]).forEach(org=>{
  out.works.push({id:org.id,title:org.name,kind:org.typeLabel,subtitle:org.intro||'',slug:org.slug,owner:org.ownerId,method:(org.works[0]||{}).id||'',
   evidence:[(org.people||[]).length+' 位公开成员',(org.works||[]).length+' 件团队作品']});
  (org.works||[]).forEach(work=>out.methods.push({id:work.id,short:liveTitle(work.title),title:work.title,author:work.authorId,project:org.id,category:'团队作品',status:'',time:0,summary:'',premise:''}));
  (org.people||[]).forEach(person=>{
   let entry=seen.get(person.id);
   if(!entry){entry={id:person.id,name:person.name||person.handle||'成员',handle:person.handle,works:[],skills:['L'+person.level],role:ROLE_NAME[person.role]||'成员',offer:'',seek:'',available:false};seen.set(person.id,entry);out.people.push(entry);}
   entry.works.push(org.id);
  });
 });
 return out;
}
function loadLive(){
 const api=window.CommonsAPI;
 if(!api||live.loading)return;
 live.loading=true;live.error='';
 api.get('/orgs/hub/constellation').then(res=>{
  const keepSelected=selected,keepFilter=filter;
  live.data=shapeLive(res&&res.data);live.loading=false;live.at=Date.now();cachedGraph=null;
  if(keepSelected&&!find(keepSelected))selected=null;
  if(keepFilter!=='all'&&!graph().groups.some(g=>g.id===keepFilter))filter='all';
  C().refresh&&C().refresh();
 }).catch(error=>{
  live.loading=false;live.at=Date.now();live.error=(error&&(error.status===501||error.code==='capability_unavailable'))?'closed':((error&&error.message)||'没有读出来');C().refresh&&C().refresh();
 });
}
if(typeof window.addEventListener==='function')window.addEventListener('commons:session',()=>{live.data=null;live.error='';live.loading=false;live.at=0;cachedGraph=null;selected=null;filter='all';});
const C=()=>window.Commons;
const esc=value=>C().esc(String(value??''));
const tones=['knowledge','workflow','teaching'];
function sampleAtlas(){return (!isLive()&&window.COMMONS_CONSTELLATION_SAMPLE)||{};}
const shortWork=()=>sampleAtlas().shortWork||{};
const shortMethod=()=>sampleAtlas().shortMethod||{};
const label=node=>node.kind==='person'?node.data.name:node.kind==='work'?(shortWork()[node.id]||node.data.title):(shortMethod()[node.id]||node.data.short);
const KIND_SAMPLE={person:'同行',work:'作品',method:'方法'},KIND_LIVE={person:'成员',work:'团队',method:'团队作品'};
const kindName={get person(){return (isLive()?KIND_LIVE:KIND_SAMPLE).person;},get work(){return (isLive()?KIND_LIVE:KIND_SAMPLE).work;},get method(){return (isLive()?KIND_LIVE:KIND_SAMPLE).method;}};
const chipLabel=g=>isLive()?liveTitle(g.work.title):(shortWork()[g.id]||g.work.kind);
const initial=node=>`<span class="atlas-initial" aria-hidden="true">${esc(Array.from(String(node.data.name||'?'))[0]||'?')}</span>`;
const personFace=(node,size)=>isLive()?initial(node):C().avatar(node.id,size);
const polar=(angle,r)=>({x:360+Math.cos(angle*Math.PI/180)*r,y:320+Math.sin(angle*Math.PI/180)*r});
const point=(angle,r)=>{const p=polar(angle,r);return `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;};
let view=null,filter='all',selected=null,returnKey=null;

function membershipAngle(person,groups){
 const memberships=groups.filter(g=>person.works.includes(g.id));
 if(!memberships.length)return 0;
 if(memberships.length===1)return memberships[0].angle;
 const point=memberships.reduce((out,g)=>{const angle=g.angle*Math.PI/180;return {x:out.x+Math.cos(angle),y:out.y+Math.sin(angle)};},{x:0,y:0});
 if(Math.hypot(point.x,point.y)>=0.001)return Math.atan2(point.y,point.x)*180/Math.PI;
 const base=memberships[0].angle,offset=memberships.reduce((sum,g)=>{const delta=((g.angle-base)%360+360)%360;return sum+(delta>180?delta-360:delta);},0);
 return base+offset/memberships.length;
}
function buildGraph(){
 const nodes=[],edges=[],groups=D().works.map((work,i)=>({id:work.id,work,angle:-90+i*360/D().works.length,tone:tones[i%tones.length]}));
 const add=(data,kind,group,angle,r)=>{nodes.push({id:data.id,key:kind+':'+data.id,kind,data,group:group?.id||null,tone:group?.tone||'workflow',...polar(angle,r)});};
 groups.forEach(group=>{
  add(group.work,'work',group,group.angle,88);
  const methods=D().methods.filter(m=>m.project===group.id);
  methods.forEach((m,i)=>add(m,'method',group,group.angle+(i-(methods.length-1)/2)*48,190));
  if(!isLive()){
   const people=D().people.filter(p=>p.works[0]===group.id);
   people.forEach((p,i)=>add(p,'person',group,group.angle+(i-(people.length-1)/2)*88,282));
  }
 });
 if(isLive())D().people.forEach(person=>{
  const memberships=groups.filter(g=>person.works.includes(g.id));
  if(memberships.length)add(person,'person',memberships[0],membershipAngle(person,groups),282);
 });
 const known=new Set(nodes.map(n=>n.key));
 const link=(from,to,relation,group)=>{if(known.has(from)&&known.has(to))edges.push({from,to,relation,group});};
 D().people.forEach(p=>p.works.forEach(id=>{const w=D().works.find(w=>w.id===id);if(w)link('person:'+p.id,'work:'+id,w.owner===p.id?'作品主作者':'参与作品',id);}));
 D().methods.forEach(m=>{
  const w=D().works.find(w=>w.id===m.project);
  link('person:'+m.author,'method:'+m.id,'方法作者',m.project);
  if(w)link('method:'+m.id,'work:'+w.id,w.method===m.id?'作品主方法':'关联作品',w.id);
 });
 return {nodes,edges,groups};
}
let cachedGraph=null;
function graph(){if(!cachedGraph)cachedGraph=buildGraph();return cachedGraph;}
const find=key=>graph().nodes.find(n=>n.key===key);
const visible=node=>filter==='all'||node.group===filter||node.kind==='person'&&node.data.works.includes(filter);
function related(){
 if(!selected)return new Set(graph().nodes.filter(visible).map(n=>n.key));
 const keys=new Set([selected]);
 graph().edges.forEach(e=>{if(e.from===selected)keys.add(e.to);if(e.to===selected)keys.add(e.from);});
 return keys;
}
function path(edge){
 const a=find(edge.from),b=find(edge.to);
 const offset=edge.relation==='方法作者'?0:edge.relation.includes('作品')&&a.kind==='person'?22:-10;
 const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
 return `M${a.x} ${a.y} C${a.x+dx*.38-dy/len*offset} ${a.y+dy*.38+dx/len*offset} ${a.x+dx*.72-dy/len*offset} ${a.y+dy*.72+dx/len*offset} ${b.x} ${b.y}`;
}
function rings(){
 const ticks=Array.from({length:72},(_,i)=>`<path d="M${point(i*5,292)}L${point(i*5,i%6===0?300:296)}" class="atlas-tick ${i%6===0?'major':''}"/>`).join('');
 return `<svg class="atlas-wires" viewBox="0 0 720 640" aria-hidden="true"><g class="atlas-grid"><circle cx="360" cy="320" r="282"/><circle cx="360" cy="320" r="190"/><circle cx="360" cy="320" r="88"/>${ticks}${graph().groups.map(g=>`<path d="M${point(g.angle-60,48)}L${point(g.angle-60,284)}" class="atlas-divider"/>`).join('')}</g>${graph().groups.map(g=>`<path class="atlas-sector" style="--atlas-tone:var(--${esc(g.tone)}-ink)" d="M${point(g.angle-48,284)}A284 284 0 0 1 ${point(g.angle+48,284)}"/>`).join('')}<g class="atlas-edges">${graph().edges.map((edge,i)=>`<path data-atlas-edge="${i}" class="atlas-edge ${edge.relation==='方法作者'?'is-authorship':edge.from.startsWith('method:')?'is-method':'is-contribution'}" d="${esc(path(edge))}"/>`).join('')}</g></svg>`;
}
function nodeButton(node){
 return `<button class="atlas-node atlas-node-${esc(node.kind)}" style="left:${node.x/7.2}%;top:${node.y/6.4}%;--atlas-tone:var(--${esc(node.tone)}-ink);--atlas-soft:var(--${esc(node.tone)}-soft)" data-action="constellation-select" data-id="${esc(node.id)}" data-value="${esc(node.kind)}" data-atlas-node="${esc(node.key)}" aria-pressed="false" aria-label="查看${esc(kindName[node.kind])}：${esc(node.kind==='person'?node.data.name:node.data.title)}">${node.kind==='person'?personFace(node):`<span class="atlas-glyph">${C().icon(node.kind==='work'?'project':'book')}</span>`}<b>${esc(label(node))}</b>${node.kind==='person'?`<small>${esc(node.data.skills[0])}</small>`:''}</button>`;
}
function diagram(){
 return `<div class="atlas-map-scroll" data-atlas-map tabindex="0" role="region" aria-label="组织星图，可横向滚动"><div class="atlas-map">${rings()}<div class="atlas-centre" aria-hidden="true"><span>共作</span></div>${graph().nodes.map(nodeButton).join('')}${graph().groups.map(g=>{const p=polar(g.angle,308);return `<span class="atlas-sector-label" style="left:${p.x/7.2}%;top:${p.y/6.4}%;--atlas-tone:var(--${esc(g.tone)}-ink)">${esc(chipLabel(g))}</span>`;}).join('')}</div></div>`;
}
function selectButton(node,meta){
 return `<button class="atlas-list-node" data-action="constellation-select" data-id="${esc(node.id)}" data-value="${esc(node.kind)}" data-atlas-list-node="${esc(node.key)}" aria-pressed="false">${node.kind==='person'?personFace(node,'tiny'):C().icon('book')}<span><b>${esc(label(node))}</b><small>${esc(meta)}</small></span><span class="atlas-list-arrow" aria-hidden="true">${C().icon('arrow')}</span></button>`;
}
function list(){
 return `<div class="atlas-list" data-atlas-list hidden>${graph().groups.map(g=>`<section class="atlas-list-group" data-atlas-group="${esc(g.id)}" style="--atlas-tone:var(--${esc(g.tone)}-ink)"><button class="atlas-list-work" data-action="constellation-select" data-id="${esc(g.id)}" data-value="work" data-atlas-list-node="work:${esc(g.id)}" aria-pressed="false"><span>${esc(g.work.kind)}</span><b>${esc(g.work.title)}</b>${C().icon('arrow')}</button><div class="atlas-list-columns"><div><h3>${isLive()?'成员':'参与同行'}</h3>${graph().nodes.filter(n=>n.kind==='person'&&n.data.works.includes(g.id)).map(n=>selectButton(n,isLive()?n.data.role:(g.work.owner===n.id?'作品主作者':'参与作品'))).join('')}</div><div><h3>${isLive()?'团队作品':'关联方法'}</h3>${graph().nodes.filter(n=>n.kind==='method'&&n.group===g.id).map(n=>selectButton(n,isLive()?`${D().people.find(p=>p.id===n.data.author)?.name||'成员'}发布`:`${D().people.find(p=>p.id===n.data.author)?.name||''}编写 · ${g.work.method===n.id?'作品主方法':'关联方法'}`)).join('')}</div></div></section>`).join('')}</div>`;
}
function miniLink(node,relationship){
 return `<button class="atlas-detail-link" data-action="constellation-select" data-id="${esc(node.id)}" data-value="${esc(node.kind)}"><span>${esc(label(node))}</span><small>${esc(relationship)}</small>${C().icon('arrow')}</button>`;
}
function relationSection(title,nodes,relation){
 return nodes.length?`<section class="atlas-detail-section"><h3>${esc(title)} <span>${nodes.length}</span></h3>${nodes.map(n=>miniLink(n,typeof relation==='function'?relation(n):relation)).join('')}</section>`:'';
}
function actions(node){
 if(isLive()){
  const d=node.data;
  if(node.kind==='person')return d.handle?`<a class="button primary" href="#/u/${esc(encodeURIComponent(d.handle))}">看主页 ${C().icon('arrow')}</a>`:'';
  if(node.kind==='work')return `<a class="button primary" href="#/org/${esc(encodeURIComponent(d.slug))}">打开团队主页 ${C().icon('arrow')}</a>`;
  return `<a class="button primary" href="#/work/${esc(encodeURIComponent(d.id))}">打开作品 ${C().icon('arrow')}</a>`;
 }
 if(node.kind==='person')return `<a class="button" href="#/people/${esc(node.id)}">看主页 ${C().icon('arrow')}</a>${node.data.available?`<button class="button primary" data-action="connect-buddy" data-id="${esc(node.id)}">${node.id===C().currentPersonId?'发起组队':'约个搭子'}</button>`:''}`;
 if(node.kind==='work')return `<a class="button primary" href="#/work/${esc(node.id)}">打开作品 ${C().icon('arrow')}</a><a class="button" href="#/workshop/${esc(node.data.method)}">跟着做一遍</a>`;
 return `<a class="button primary" href="#/knowledge/${esc(node.id)}">阅读方法 ${C().icon('arrow')}</a><a class="button" href="#/workshop/${esc(node.id)}">开始实践</a>`;
}
function detail(){
 const node=find(selected);
 if(!node){
  const liveMode=isLive();
  return `<div class="atlas-detail-inner"><button class="atlas-return" data-action="constellation-return">返回${view==='map'?'星图':'关系清单'} ${C().icon('back')}</button><span class="atlas-detail-type">${liveMode?'从团队认识作品与成员':'从一件作品认识同行'}</span><h2 tabindex="-1">每条连接，都有来处</h2><p>${liveMode?'选团队，看它的作品与成员；选成员，看他所在的团队和发布的作品。':'选作品，看谁参与和用了什么方法；选同行，看他的作品与共作意愿。'}</p><dl class="atlas-reading-key"><div><dt>内环</dt><dd>${liveMode?'团队':'作品'}</dd></div><div><dt>中环</dt><dd>${liveMode?'团队作品':'关联方法'}</dd></div><div><dt>外环</dt><dd>${liveMode?'成员':'参与同行'}</dd></div></dl><p class="atlas-detail-note">位置用于归类，距离与大小不表示能力或组织层级。</p></div>`;
 }
 const d=node.data;
 let body='';
 if(isLive()){
  if(node.kind==='person'){
   const orgs=graph().nodes.filter(n=>n.kind==='work'&&d.works.includes(n.id)),works=graph().nodes.filter(n=>n.kind==='method'&&n.data.author===d.id);
   body=`<p class="atlas-person-role">${esc(d.role)}</p>${relationSection('所在团队',orgs,'成员')}${relationSection('发布的团队作品',works,'作者')}`;
  }else if(node.kind==='work'){
   const people=graph().nodes.filter(n=>n.kind==='person'&&n.data.works.includes(d.id)),works=graph().nodes.filter(n=>n.kind==='method'&&n.data.project===d.id);
   body=`<p>${esc(d.subtitle)}</p><section class="atlas-detail-section"><h3>团队概况 <span>${d.evidence.length}</span></h3><ul class="atlas-evidence">${d.evidence.map(t=>`<li>${C().icon('check')}<span>${esc(t)}</span></li>`).join('')}</ul></section>${relationSection('成员',people,n=>n.data.role)}${relationSection('团队作品',works,'团队作品')}`;
  }else{
   const author=find('person:'+d.author),org=find('work:'+d.project);
   body=`${relationSection('作者',author?[author]:[],'发布者')}${relationSection('所属团队',org?[org]:[],'团队作品')}`;
  }
 }else if(node.kind==='person'){
  const works=graph().nodes.filter(n=>n.kind==='work'&&d.works.includes(n.id));
  const methods=graph().nodes.filter(n=>n.kind==='method'&&n.data.author===d.id);
  body=`<p class="atlas-person-role">${esc(d.role)}</p><span class="atlas-availability ${d.available?'is-open':''}">${d.available?'愿意共作':'近期专注创作'}</span><dl class="atlas-person-intent"><div><dt>我可以带来</dt><dd>${esc(d.offer)}</dd></div><div><dt>我在寻找</dt><dd>${esc(d.seek)}</dd></div></dl>${relationSection('参与作品',works,n=>n.data.owner===d.id?'主作者':'参与者')}${relationSection('编写的方法',methods,'方法作者')}`;
 }else if(node.kind==='work'){
  const people=graph().nodes.filter(n=>n.kind==='person'&&n.data.works.includes(d.id));
  const methods=graph().nodes.filter(n=>n.kind==='method'&&n.data.project===d.id);
  body=`<p>${esc(d.subtitle)}</p><section class="atlas-detail-section"><h3>作品证据 <span>${d.evidence.length}</span></h3><ul class="atlas-evidence">${d.evidence.map(t=>`<li>${C().icon('check')}<span>${esc(t)}</span></li>`).join('')}</ul></section>${relationSection('参与同行',people,n=>d.owner===n.id?'主作者':'参与者')}${relationSection('关联方法',methods,n=>d.method===n.id?'主方法':'关联方法')}`;
 }else{
  const author=find('person:'+d.author),work=find('work:'+d.project);
  body=`<div class="atlas-method-meta"><span>${esc(d.status)}</span><span>${esc(d.time)} 分钟实践</span></div><p>${esc(d.summary)}</p><section class="atlas-detail-section"><h3>适用前提</h3><p>${esc(d.premise)}</p></section>${relationSection('方法作者',author?[author]:[],'编写者')}${relationSection('关联作品',work?[work]:[],n=>n.data.method===d.id?'用于作品主流程':'关联实践')}`;
 }
 return `<div class="atlas-detail-inner" style="--atlas-tone:var(--${esc(node.tone)}-ink)"><button class="atlas-return" data-action="constellation-return">返回${view==='map'?'星图':'关系清单'} ${C().icon('back')}</button><span class="atlas-detail-type">${esc(kindName[node.kind])}${node.kind==='method'&&!isLive()?' · '+esc(d.category):''}</span><div class="atlas-detail-title">${node.kind==='person'?personFace(node):''}<h2 tabindex="-1">${esc(node.kind==='person'?d.name:d.title)}</h2></div>${body}<div class="atlas-detail-actions">${actions(node)}</div>${!isLive()&&node.kind==='person'&&!d.available?'<p class="atlas-detail-note">当前未开放共作，可先了解作品。</p>':''}</div>`;
}
function liveState(){
 if(!live.data&&!live.error&&!live.loading)loadLive();
 else if(live.data&&!live.loading&&Date.now()-live.at>60000)loadLive();
 if(live.error==='closed')return '<div class="empty"><h3>这个功能还没开放</h3><p>管理员还没打开。</p></div>';
 if(live.error&&!live.data)return `<div class="empty" role="alert"><h3>没有读出来</h3><p>${esc(live.error)}</p><button class="button" type="button" data-action="constellation-retry">重试</button></div>`;
 if(!live.data)return '<div class="empty" aria-live="polite"><h3>正在读取…</h3></div>';
 if(!live.data.works.length)return '<div class="empty"><h3>还没有可展示的团队</h3><p>团队有了公开成员或作品后，会出现在星图里。</p><a class="button" href="#/orgs">去团队目录</a></div>';
 return '';
}
const dataNote=()=>isLive()?`${D().works.length} 个团队 / ${D().people.length} 位成员 / ${D().methods.length} 件团队作品`:`示例作品 · ${D().people.length} 位同行 / ${D().works.length} 件作品 / ${D().methods.length} 条方法`;
const legend=()=>isLive()?['内环 · 团队','中环 · 团队作品','外环 · 成员']:['内环 · 作品','中环 · 方法','外环 · 同行'];
function render(){
 if(isLive()){const state=liveState();if(state)return state;}
 if(view===null)view=matchMedia('(max-width:760px)').matches?'list':'map';
 if(!selected&&graph().groups.length)selected='work:'+graph().groups[0].id;
 return `<section class="constellation" aria-label="组织星图"><div class="atlas-heading"><div><h2>${isLive()?'沿着团队，找到作品与成员':'沿着作品，找到方法与同行'}</h2></div><span class="atlas-data-note">${dataNote()}</span></div><div class="atlas-toolbar"><div class="atlas-filters" role="group" aria-label="按作品查看星图"><button data-action="constellation-filter" data-id="all" aria-pressed="${filter==='all'}">全部方向</button>${graph().groups.map(g=>`<button data-action="constellation-filter" data-id="${esc(g.id)}" style="--atlas-tone:var(--${esc(g.tone)}-ink)" aria-pressed="${filter===g.id}">${esc(chipLabel(g))}</button>`).join('')}</div><div class="atlas-views" role="group" aria-label="组织关系展示方式"><button data-action="constellation-view" data-id="map" aria-pressed="${view==='map'}">星图</button><button data-action="constellation-view" data-id="list" aria-pressed="${view==='list'}">清单</button></div></div><div class="atlas-layout"><div class="atlas-stage"><p class="atlas-pan-hint" data-atlas-pan>左右滑动查看完整星图，也可切换清单</p>${graph().nodes.length?diagram()+list():'<div class="empty"><p>还没有可展示的作品关系。</p></div>'}<div class="atlas-legend"><span><i class="atlas-legend-work"></i>${legend()[0]}</span><span><i class="atlas-legend-method"></i>${legend()[1]}</span><span><i class="atlas-legend-person"></i>${legend()[2]}</span><button data-action="constellation-overview">读图说明</button></div><p class="atlas-relation-note">${isLive()?'实线：成员与团队、作者与作品 · 虚线：作品归属团队':'实线：作者与参与关系 · 虚线：方法关联作品'}</p></div><aside class="atlas-detail" data-atlas-detail aria-label="所选对象详情">${detail()}</aside></div><p class="atlas-live" role="status" aria-live="polite" data-atlas-live></p></section>`;
}
function update({animate=false,announce=false}={}){
 const root=document.querySelector('.constellation');if(!root)return;
 const keys=related();
 root.dataset.view=view;
 root.querySelector('[data-atlas-map]')?.toggleAttribute('hidden',view!=='map');
 root.querySelector('[data-atlas-list]')?.toggleAttribute('hidden',view!=='list');
 root.querySelector('[data-atlas-pan]')?.toggleAttribute('hidden',view!=='map');
 root.querySelectorAll('[data-action="constellation-filter"]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.id===filter)));
 root.querySelectorAll('[data-action="constellation-view"]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.id===view)));
 root.querySelectorAll('[data-atlas-node],[data-atlas-list-node]').forEach(el=>{
  const key=el.dataset.atlasNode||el.dataset.atlasListNode,node=find(key),isSelected=key===selected;
  el.setAttribute('aria-pressed',String(isSelected));el.classList.toggle('is-selected',isSelected);el.classList.toggle('is-related',keys.has(key));el.classList.toggle('is-distant',!!selected&&!keys.has(key));
  if(el.dataset.atlasNode)el.hidden=false;
 });
 root.querySelectorAll('[data-atlas-group]').forEach(el=>el.hidden=filter!=='all'&&el.dataset.atlasGroup!==filter);
 root.querySelectorAll('[data-atlas-edge]').forEach(el=>{
  const edge=graph().edges[Number(el.dataset.atlasEdge)];
  el.style.display='';el.classList.toggle('is-related',keys.has(edge.from)&&keys.has(edge.to));el.classList.toggle('is-distant',!!selected&&(!keys.has(edge.from)||!keys.has(edge.to)));
 });
 const pane=root.querySelector('[data-atlas-detail]');pane.innerHTML=detail();
 if(animate)window.CommonsMotion?.reveal(pane.querySelector('.atlas-detail-inner'),4);
 if(announce){const node=find(selected);root.querySelector('[data-atlas-live]').textContent=node?`已选择${esc(kindName[node.kind])}${label(node)}，详情已更新。`:'已显示读图说明。';}
}
function handle(action,el){
 if(!action.startsWith('constellation-'))return false;
 if(action==='constellation-retry'){live.error='';live.at=0;loadLive();return true;}
 if(action==='constellation-return'){
  const root=document.querySelector('.constellation'),selector=view==='map'?'[data-atlas-node]':'[data-atlas-list-node]';
  const target=[...root.querySelectorAll(selector)].find(n=>(n.dataset.atlasNode||n.dataset.atlasListNode)===(returnKey||selected)&&!n.closest('[hidden]'))||root.querySelector('.atlas-toolbar button');
  target?.scrollIntoView({block:'center',inline:'center',behavior:'instant'});target?.focus({preventScroll:true});return true;
 }
 if(action==='constellation-select'){
  const key=el.dataset.value+':'+el.dataset.id;
  if(!find(key))return true;
  selected=key;
  if(!visible(find(key)))filter='all';
 }else if(action==='constellation-filter'){
  if(el.dataset.id!=='all'&&!graph().groups.some(g=>g.id===el.dataset.id))return true;
  filter=el.dataset.id;
  if(filter!=='all')selected='work:'+filter;
 }else if(action==='constellation-view'){
  if(!['map','list'].includes(el.dataset.id))return true;
  view=el.dataset.id;
 }else if(action==='constellation-overview')selected=null;
 else return false;
 const fromDetail=!!el.closest('[data-atlas-detail]');
 if(action==='constellation-select'&&!fromDetail)returnKey=selected;
 update({animate:action!=='constellation-view',announce:true});
 const narrow=matchMedia('(max-width:1200px)').matches;
 if(fromDetail||(narrow&&['constellation-select','constellation-overview'].includes(action))){
  const pane=document.querySelector('[data-atlas-detail]');pane.querySelector('h2')?.focus({preventScroll:true});
  if(narrow)pane.scrollIntoView({block:'start',behavior:'instant'});
 }
 return true;
}
function mount(){update();}
function homePreview(){
 if(isLive()||!graph().nodes.length)return '';
 const people=graph().nodes.filter(n=>n.kind==='person');
 return `<section class="craft-compass"><div class="craft-section-head"><h2>协作罗盘</h2><span>示例作品</span></div><button class="compass-open" data-action="open-constellation" aria-label="打开组织星图，查看同行、方法与作品的关系"><span class="compass-mini" aria-hidden="true"><svg viewBox="0 0 260 220"><circle cx="130" cy="110" r="77"/><circle cx="130" cy="110" r="44"/>${graph().groups.map(g=>{const a=g.angle*Math.PI/180,x=130+Math.cos(a)*39,y=110+Math.sin(a)*39;return `<path style="--atlas-tone:var(--${esc(g.tone)}-ink)" class="compass-spoke" d="M130 110L${esc(x)} ${esc(y)}"/><circle style="--atlas-tone:var(--${esc(g.tone)}-ink)" class="compass-hub" cx="${esc(x)}" cy="${esc(y)}" r="5"/>`;}).join('')}${people.map(n=>{const a=Math.atan2(n.y-320,n.x-360),g=graph().groups.find(g=>g.id===n.group),ga=g.angle*Math.PI/180;return `<path class="compass-connection" d="M${130+Math.cos(ga)*39} ${110+Math.sin(ga)*39} Q${130+Math.cos(a)*52} ${110+Math.sin(a)*52} ${130+Math.cos(a)*77} ${110+Math.sin(a)*77}"/>`;}).join('')}</svg><span class="compass-core">共作</span>${people.map(n=>{const a=Math.atan2(n.y-320,n.x-360);const side=Math.abs(Math.cos(a))>.2?(Math.cos(a)>0?'e':'w'):(Math.sin(a)>0?'s':'n');return `<span class="compass-person is-${esc(side)}" style="left:${(130+Math.cos(a)*77)/2.6}%;top:${(110+Math.sin(a)*77)/2.2}%">${C().avatar(n.id,'tiny')}<small>${esc(n.data.name)}</small></span>`;}).join('')}<span class="compass-direction compass-north">知识助手</span><span class="compass-direction compass-east">协作 Agent</span><span class="compass-direction compass-west">教学台</span></span><span class="compass-summary">${D().people.length} 位同行 · ${D().works.length} 件作品 · ${D().methods.length} 条方法</span><span class="compass-cta">打开组织星图 ${C().icon('arrow')}</span></button></section>`;
}
window.CommonsConstellation={render,handle,mount,homePreview,buildGraph};
// 真实模式的入口：#/constellation（作品与同行 · 星图页签）。演示版仍从「作品」页的关系视图进入。
(window.CommonsPages=window.CommonsPages||[]).push({routes:{constellation:()=>render()},titles:{constellation:'星图'}});
})();

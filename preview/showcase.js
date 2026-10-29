(() => {
'use strict';
const isLive=()=>!!(window.CommonsAPI&&window.CommonsAPI.mode==='live');
const sample=()=>isLive()?{}:(window.COMMONS_SHOWCASE_SAMPLE||{});
const toneNames=()=>sample().toneNames||{w1:'knowledge',w2:'workflow',w3:'teaching'};
const meta=()=>sample().meta||{};
const C=()=>window.Commons;
const esc=value=>C().esc(String(value??''));
const vars=w=>['ink','soft','face','side'].map(role=>`--work-${role}:var(--${(toneNames()[w.id]||'workflow')}-${role})`).join(';');
// Each object depicts a real stage of the work; the links preserve its actual order.
function stageObject(kind){
 const objects={
  brief:`<path class="object-side" d="M-25-31 5-48 27-35-3-18v5L-25-26Z"/><path class="object-sheet" d="M-25-35 5-52 27-39-3-22Z"/><path class="object-rule" d="m-13-36 16-9m-10 14 19-11m-10 16 13-8"/>`,
  index:`<path class="object-side" d="M-25-36h50v22c0 15-50 15-50 0Z"/><ellipse class="object-sheet" cx="0" cy="-36" rx="25" ry="12"/><path class="object-rule" d="M-25-27c0 15 50 15 50 0M-25-17c0 15 50 15 50 0"/><path class="object-rule" d="m-10-36 10-5 10 5-10 5Z"/>`,
  gate:`<path class="object-side" d="m-27-31 27-22 27 22v7L0-2-27-24Z"/><path class="object-sheet" d="m-27-31 27-22 27 22L0-9Z"/><path class="object-mark" d="m-10-31 8 6 14-14"/>`,
  answer:`<path class="object-side" d="m-24-42 43-10v37l-43 10Z"/><path class="object-sheet" d="m-28-46 43-10v37l-13 3-9 11v-9l-21 5Z"/><path class="object-rule" d="m-18-37 22-5m-22 13 18-4"/><path class="object-mark" d="m-16-19 4-1m5-1 4-1"/>`,
  plan:`<path class="object-side" d="m-28-26 17-10 17 10v8l-17 10-17-10Zm25-14 17-10 17 10v8L14-22-3-32Z"/><path class="object-sheet" d="m-28-26 17-10 17 10-17 10Zm25-14 17-10 17 10-17 10Z"/><path class="object-rule" d="m-6-31 7-4m-18 8 6-3m20-11 7-4"/>`,
  approval:`<circle class="object-side" cx="0" cy="-29" r="23"/><circle class="object-sheet" cx="-3" cy="-33" r="23"/><path class="object-mark" d="m-15-33 9 9 17-20"/>`,
  tools:`<path class="object-side" d="m-26-34 26-15 26 15v20L0 1-26-14Z"/><path class="object-sheet" d="m-26-34 26-15 26 15L0-19Z"/><path class="object-rule" d="M0-19V1m-14-34 9-5m10 12 9-5"/><path class="object-mark" d="m-17-17 7 4m20 0 7-4"/>`,
  target:`<ellipse class="object-side" cx="2" cy="-30" rx="24" ry="28"/><ellipse class="object-sheet" cx="-2" cy="-33" rx="24" ry="28"/><ellipse class="object-rule" cx="-2" cy="-33" rx="14" ry="17"/><ellipse class="object-mark" cx="-2" cy="-33" rx="5" ry="6"/><path class="object-rule" d="m-2-33 27-23m-2 0 2 0v5"/>`,
  demo:`<path class="object-side" d="m-27-45 50-10v35l-50 10Z"/><path class="object-sheet" d="m-30-48 50-10v35l-50 10Z"/><path class="object-mark" d="m-11-44 12 5-12 10Z"/><path class="object-rule" d="m-6-18 0 11m-10 5 20-5"/>`,
  practice:`<path class="object-side" d="m-29-26 29-17 29 17v7L0-2-29-19Z"/><path class="object-sheet" d="m-29-26 29-17 29 17L0-9Z"/><path class="object-rule" d="m-17-26 17-10 17 10-17 10Z"/><path class="object-mark" d="m-4-26 18-26 6 5-18 26-9 2Z"/>`,
  feedback:`<path class="object-side" d="m-21-43 37-9v30l-11 3-8 10v-8l-18 5Z"/><path class="object-sheet" d="m-26-47 37-9v30l-11 3-8 10v-8l-18 5Z"/><path class="object-mark" d="m-16-36 6 5 11-14"/><path class="object-rule" d="M18-25c18 9 15 22-3 25m0 0 4-6m-4 6 7 1"/>`
 };
 return objects[kind]||objects.brief;
}
function diagram(w,selected=0,interactive=false,compact=false){
 const stageTones=['source','operation','judgement','outcome'];
 const esc=C().esc,points=[[64,94],[194,94],[324,94],[454,94]],nodes=w.nodes;
 const kinds={w1:['brief','index','gate','answer'],w2:['brief','plan','approval','tools'],w3:['target','demo','practice','feedback']}[w.id];
 const routes=points.slice(0,-1).map(([x,y],i)=>{const [nx]=points[i+1];return `<path class="schematic-wire ${interactive&&i===selected-1?'is-current':''}" data-flow-link="${i}" d="M${x+35} ${y+10}H${nx-35}"/><path class="schematic-arrow" d="m${nx-40} ${y+7} 5 3-5 3"/>`;}).join('');
 const slabs=points.map(([x,y],i)=>`<g class="schematic-node ${i===selected?'is-selected':''}" data-node="${i}" transform="translate(${x} ${y})" style="--stage-ink:var(--stage-${stageTones[i]})"><path class="slab-shadow" d="M-37 17 0-4 37 17 0 38Z"/><path class="slab-left" d="M-35 0 0 20V27L-35 7Z"/><path class="slab-right" d="M0 20 35 0V7L0 27Z"/><path class="slab-top" d="M-35 0 0-20 35 0 0 20Z"/><g class="stage-object">${stageObject(kinds[i])}</g></g>`).join('');
 return `<div class="work-schematic ${compact?'is-compact':''}" style="${/* safe: 色板键只来自 knowledge/workflow/teaching */ vars(w)}"><svg viewBox="0 0 520 160" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${routes}${slabs}<circle class="flow-signal" r="3"/></svg>${points.map(([x],i)=>interactive?`<button class="schematic-step ${i===selected?'is-selected':''}" data-action="spotlight-step" data-id="${esc(w.id)}" data-value="${i}" style="left:${x/5.2}%;--stage-ink:var(--stage-${stageTones[i]})" aria-pressed="${i===selected}" aria-label="步骤${i+1}：${esc(nodes[i])}"><span class="step-label"><small>${String(i+1).padStart(2,'0')}</small>${esc(nodes[i])}</span></button>`:`<span class="schematic-label" style="left:${x/5.2}%">${esc(nodes[i])}</span>`).join('')}</div>`;
}
function preview(w){const label=(meta()[w.id]||[w.title||'作品'])[0];return `<div class="work-art structure-preview" style="${/* safe: 色板键只来自 knowledge/workflow/teaching */ vars(w)}"><span class="structure-preview-label">${C().esc(label)}</span>${diagram(w,1,false,true)}</div>`;}
// R13 SOCIAL-1：登录后首页 = 左（我与常用入口）+ 中（发布框与动态）+ 右（今天、活动、好友在玩、纪念日、作品精选）。
const safeUrl=u=>C().safeUrl(u);
const SC=()=>window.CommonsSocial;
const SS=()=>isLive()?(SC()?.data?.()||{}):(SC()?.data?.()||window.COMMONS_SOCIAL_SAMPLE||{});
const SHORTCUTS=[['feed','动态','feed','blue'],['groups','小组','groups','teal'],['friends','好友','friends','teal'],['games','游戏','game','violet'],['market','市集','tag','violet'],['events','活动','flag','blue'],['knowledge','知识地图','map','teal'],['benefits','我的权益','gift','violet']];
const EVENT_STATUS={live:'进行中',upcoming:'即将开始',ended:'已结束'};
function greeting(){const h=new Date().getHours();return h<5?'夜深了':h<11?'早上好':h<14?'中午好':h<18?'下午好':'晚上好';}
/* safe-fn: 入口表是写死常量，名字与地址逐值转义 */
function shortcuts(me,cls){return [[`u/${me.handle}`,'我的主页','user','blue'],...SHORTCUTS].map(([route,label,ic,tone])=>`<a class="${esc(cls)}" data-tone="${esc(tone)}" href="#/${esc(route)}"><span class="sh-ic">${SC().icon(ic)}</span><span>${esc(label)}</span></a>`).join('');}
/* safe-fn: 小组字段逐值转义，封面过 safeUrl */
function myGroups(){const list=SC().groups().filter(g=>g.me==='active').slice(0,5);if(!list.length)return '';return `<section class="sh-block sh-groups"><div class="sh-block-head"><h2>我的小组</h2><a href="#/groups">全部</a></div><ul>${list.map(g=>`<li><a href="#/group/${esc(g.slug)}"><img src="${safeUrl(g.cover)}" alt="" width="32" height="32" loading="lazy"><span class="sh-copy"><b>${esc(g.name)}</b><small>今天 ${Number(g.today)||0} 条</small></span></a></li>`).join('')}</ul></section>`;}
/* safe-fn: 活动字段逐值转义，封面过 safeUrl */
function liveEvents(){if(isLive())return '';const E=window.COMMONS_EVENTS_SAMPLE;const list=(E&&Array.isArray(E.events)?E.events:[]).filter(e=>e.status!=='ended').sort((a,b)=>(a.status==='live'?0:1)-(b.status==='live'?0:1)).slice(0,3);if(!list.length)return '';return `<section class="sh-block"><div class="sh-block-head"><h2>正在进行的活动</h2><a href="#/events">全部</a></div><ul class="sh-events">${list.map(e=>`<li><a href="#/event/${esc(e.id)}"><img src="${safeUrl(e.cover)}" alt="" width="64" height="48" loading="lazy"><span class="sh-copy"><b>${esc(e.title)}</b><small><span class="sh-status" data-status="${esc(e.status)}">${esc(EVENT_STATUS[e.status]||'')}</span>${Number(e.signups)||0} 人报名</small></span></a></li>`).join('')}</ul></section>`;}
/* safe-fn: 好友与游戏字段逐值转义，地址过 safeUrl */
function playing(){const R=SC().relations();const list=(SS().playing||[]).filter(x=>!R.blocked.has(x.id));if(!list.length)return '';return `<section class="sh-block"><div class="sh-block-head"><h2>好友在玩</h2><a href="#/games">乐园</a></div><ul class="sh-people">${list.map(x=>{const p=SC().person(x.id);return `<li>${SC().avatar(p,32)}<span class="sh-copy"><b>${esc(p.name)}</b><small>${esc(x.game)} · ${esc(x.what)}</small></span><a class="button ghost small" href="${safeUrl(x.href)}">去看看</a></li>`;}).join('')}</ul></section>`;}
/* safe-fn: 纪念日字段逐值转义 */
function anniversaries(){const R=SC().relations();const list=(SS().anniversaries||[]).filter(x=>!R.blocked.has(x.id));if(!list.length)return '';return `<section class="sh-block"><div class="sh-block-head"><h2>入群纪念日</h2></div><ul class="sh-people">${list.map(x=>{const p=SC().person(x.id),done=SC().greeted(x.id);return `<li>${SC().avatar(p,32)}<span class="sh-copy"><b>${esc(p.name)}</b><small>${esc(x.text)}</small></span><button type="button" class="button tonal small" data-soc-act="greet" data-id="${esc(x.id)}"${done?' disabled':''}>${done?'已送祝福':'送祝福'}</button></li>`;}).join('')}</ul></section>`;}
/* safe-fn: 作品字段逐值转义，封面与地址过 safeUrl */
function works(){const list=SS().works||[];if(!list.length)return '';return `<section class="sh-block"><div class="sh-block-head"><h2>作品精选</h2><a href="#/people">全部</a></div><ul class="sh-works">${list.map(w=>`<li><a href="${safeUrl(w.href)}"><img src="${safeUrl(w.cover)}" alt="" width="80" height="56" loading="lazy"><span class="sh-copy"><b>${esc(w.title)}</b><small>${esc(w.meta)}</small></span></a></li>`).join('')}</ul></section>`;}
function homeMe(){
 if(isLive()){
  const me=window.CommonsSession&&window.CommonsSession.me;
  if(me){
   const level=Number(me.level)||1;
   return {id:me.id||me.handle||'',handle:me.handle||'',name:me.display_name||me.handle||'',level,levelName:me.level_name||me.levelName||'',avatar:me.avatar_ref||me.avatar||'',line:me.line||''};
  }
  return {id:'',handle:'',name:'',level:1,levelName:'',avatar:'',line:''};
 }
 return SC().viewer();
}
function home(){
 if(!SC())return `<div class="page sh-fallback"><h1>首页</h1><p>动态模块还没有加载。</p><a class="button" href="#/knowledge">去知识地图</a></div>`;
 const me=homeMe();
 return `<div class="page sh-home" data-soc-root="home"><div class="sh-grid">
<aside class="sh-left" aria-label="我与常用入口"><a class="sh-me" href="#/u/${esc(me.handle)}">${SC().avatar(me,48)}<span class="sh-copy"><b>${esc(me.name)}</b><small>L${Number(me.level)||1} ${esc(me.levelName)} · ${esc(me.line)}</small></span></a><nav class="sh-shortcuts" aria-label="常用入口">${shortcuts(me,'sh-shortcut')}</nav>${myGroups()}</aside>
<section class="sh-center" aria-labelledby="sh-hello"><div class="sh-hello"><h1 id="sh-hello">${esc(greeting())}，${esc(me.name)}</h1>${SC().live?.()?'':'<span class="pill outline">示例</span>'}</div><nav class="sh-chips" aria-label="常用入口">${shortcuts(me,'chip sh-chip')}</nav>${/* safe: 发布框由社交模块生成并转义 */ SC().composer('home')}${/* safe: 新动态提示条由社交模块生成 */ SC().newbar()}${/* safe: 动态列表由社交模块生成并转义 */ SC().stream({source:'home',limit:10})}</section>
<aside class="sh-right" aria-label="今天"><div class="sh-digest" data-digest-host></div>${liveEvents()}${playing()}${anniversaries()}${works()}<div class="sh-mobile-groups">${myGroups()}</div></aside>
</div></div>`;
}
const demoIcon=paused=>`<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paused?'<path d="M5 3v10M11 3v10"/>':'<path d="m5 3 8 5-8 5Z"/>'}</svg>`;
let demo=null,demoTimer=0;
function syncDemo(){
 const button=document.querySelector('.ledger-featured [data-action="spotlight-demo"]');if(!button)return;
 const current=demo?.id===button.dataset.id?demo:null,running=!!current?.running;
 button.setAttribute('aria-pressed',String(running));
 const reduced=window.CommonsMotion?.reduced(),complete=!!current?.complete;
 button.innerHTML=demoIcon(running)+`<span>${reduced?'逐步查看':running?'暂停演示':complete?'重新演示':current?'继续演示':'演示流程'}</span>`;
 button.setAttribute('aria-label',reduced?'查看下一个流程环节':running?'暂停流程演示':complete?'重新演示当前作品的流程':current?'继续流程演示':'演示当前作品的流程');
 const hint=document.querySelector('.ledger-featured .work-stage-heading>span:last-child');
 if(hint)hint.textContent=current?`${running?'正在演示':complete?'演示完成':'演示暂停'} · ${current.step+1}/4`:'点击环节查看做法';
}
function stopDemo(reset=true){clearTimeout(demoTimer);demoTimer=0;if(demo)demo.running=false;if(reset)demo=null;syncDemo();}
function selectStep(w,index){
 const scope=document.querySelector('.ledger-featured'),schematic=scope?.querySelector('.work-schematic');
 if(!schematic||scope.querySelector('.schematic-step')?.dataset.id!==w.id)return false;
 const previous=Number(schematic.querySelector('.schematic-step[aria-pressed="true"]')?.dataset.value);
 schematic.querySelectorAll('.schematic-step').forEach((button,i)=>{button.classList.toggle('is-selected',i===index);button.setAttribute('aria-pressed',String(i===index));});
 schematic.querySelectorAll('.schematic-node').forEach((node,i)=>node.classList.toggle('is-selected',i===index));
 schematic.querySelectorAll('[data-flow-link]').forEach((path,i)=>path.classList.toggle('is-current',i===index-1));
 const detail=scope.querySelector('.work-step-detail');
 detail.querySelector('b').textContent=String(index+1).padStart(2,'0');detail.querySelector('p').textContent=w.nodeNotes[index];
 if(previous!==index){window.CommonsMotion?.reveal(detail.querySelector('p'),3);window.CommonsMotion?.flow(schematic,index);}
 return true;
}
function toggleDemo(w,onStep){
 if(window.CommonsMotion?.reduced()){
  stopDemo();const selected=Number(document.querySelector('.schematic-step[aria-pressed="true"]')?.dataset.value)||0;onStep((selected+1)%w.nodes.length);return;
 }
 if(demo?.id===w.id&&demo.running){stopDemo(false);return;}
 if(!demo||demo.id!==w.id||demo.complete){stopDemo();demo={id:w.id,step:0,running:true,complete:false};onStep(0);}else demo.running=true;
 const session=demo;syncDemo();
 const tick=()=>{
  if(demo!==session||!session.running)return;
  if(document.hidden){stopDemo(false);return;}
  if(!document.querySelector(`.ledger-featured [data-id="${w.id}"]`)){stopDemo();return;}
  session.step++;onStep(session.step);
  if(session.step===w.nodes.length-1){session.running=false;session.complete=true;demoTimer=0;syncDemo();return;}
  syncDemo();demoTimer=setTimeout(tick,1600);
 };
 demoTimer=setTimeout(tick,1600);
}
window.CommonsShowcase={home,preview,selectStep,toggleDemo,stopDemo,syncDemo};
})();

(() => {
'use strict';
const groups=()=>window.CommonsHubs.visible();
const live=()=>window.COMMONS_BUILD_LIVE===true||window.CommonsAPI?.mode==='live';
let state={collapsed:false,branches:{}},active='home';
const readState=()=>{const value=window.Commons.read('navigation',{});return {collapsed:value?.collapsed===true,branches:value?.branches&&typeof value.branches==='object'?value.branches:{}};};
const persist=()=>window.Commons.write('navigation',state);
function mobile(current){
 const H=window.CommonsHubs,hubOf=id=>H.locate(id)?.hub.id;
 const third=H.visible().some(hub=>hub.id==='games')?{id:'games',label:'乐园',icon:'dice',hub:'games'}:{id:'knowledge',label:'知识',icon:'book',hub:'knowledge'};
 const items=[{id:'home',label:'首页',icon:'home',hub:'home'},{id:'feed',label:'动态',icon:'chat',hub:'feed'},third,{id:'messages',label:'消息',icon:'chat',hub:'messages'},{id:'me',label:'我',icon:'people',hub:'me'}];
 const at=hubOf(current);
 return items.map(item=>({...item,active:at===item.hub}));
}
function sync(){
 const compact=state.collapsed&&innerWidth>760;
 document.body.classList.toggle('nav-tree-compact',compact);
 document.body.classList.toggle('nav-tree-expanded',!compact);
 document.querySelectorAll('[data-nav-action="width"]').forEach(button=>{
  button.setAttribute('aria-expanded',String(!compact));
  button.setAttribute('aria-label',compact?'展开导航':'收起导航');
  button.title=compact?'展开导航':'收起导航';
 });
 if(!compact)requestAnimationFrame(()=>{const menu=document.querySelector('.nav-tree'),link=menu?.querySelector('[aria-current="page"]');if(!menu||!link)return;const box=menu.getBoundingClientRect(),item=link.getBoundingClientRect();if(item.bottom>box.bottom)menu.scrollTop+=item.bottom-box.bottom+8;else if(item.top<box.top)menu.scrollTop-=box.top-item.top+8;});
}
function render(nav,current){
 state=readState();active=current;
 const C=window.Commons,H=window.CommonsHubs,byId=new Map(nav.map(row=>[row[0],row]));
 const shown=groups(),at=H.locate(active),currentGroup=at?.hub;
 const groupIcon=group=>`<span class="nav-tree-group-icon">${C.icon(group.icon)}</span>`;
 const chevron='<svg class="nav-tree-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>';
 const link=(tab,group)=>{const on=at?.tab===tab;const icon=byId.get(tab.route)?.[2]||tab.icon||group.icon;return `<a class="nav-tree-link ${on?'active':''}" href="#/${C.esc(tab.route)}" ${on?'aria-current="page"':''}>${C.icon(icon)}<span>${C.esc(tab.label)}</span>${on?'<i class="nav-tree-current" aria-hidden="true"></i>':''}</a>`;};
 const branch=group=>{
  const current=group.id===currentGroup?.id;
  if(group.tabs.length<2){const tab=group.tabs[0];return `<a class="nav-tree-top ${current?'is-current':''}" href="#/${C.esc(tab.route)}" data-nav-group="${C.esc(group.id)}" ${current?'aria-current="page"':''}>${groupIcon(group)}<span>${C.esc(group.label)}</span></a>`;}
  return `<details class="nav-tree-branch ${current?'is-current':''}" data-nav-group="${C.esc(group.id)}" ${current||state.branches[group.id]===true?'open':''}><summary class="nav-tree-summary">${groupIcon(group)}<span>${C.esc(group.label)}</span>${chevron}</summary><div class="nav-tree-children">${group.tabs.map(tab=>link(tab,group)).join('')}</div></details>`;
 };
 const rail=group=>group.tabs.length<2?`<a href="#/${C.esc(group.tabs[0].route)}" class="${group.id===currentGroup?.id?'is-current':''}" aria-label="${C.esc(group.label)}" title="${C.esc(group.label)}">${groupIcon(group)}<span>${C.esc(group.label.slice(0,2))}</span></a>`:`<button data-nav-action="group" data-nav-group="${C.esc(group.id)}" class="${group.id===currentGroup?.id?'is-current':''}" aria-label="展开${C.esc(group.label)}" title="${C.esc(group.label)}">${groupIcon(group)}<span>${C.esc(group.label.slice(0,2))}</span></button>`;
 return `<div class="nav-tree-header"><a class="nav-tree-brand" href="#/home" aria-label="智能体先锋队首页">${C.brandMark()}<span>先锋<small>AGENT COMMONS</small></span></a><button class="nav-tree-width" data-nav-action="width" aria-controls="nav-tree-menu" aria-expanded="${!state.collapsed}" aria-label="收起导航"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M7 4v12m6-9-3 3 3 3"/></svg></button><button class="icon-button drawer-close" data-action="close-menu" aria-label="关闭导航">×</button></div><button class="nav-tree-search" type="button" data-nav-action="search">${C.icon('search')}<span>搜索全部内容</span></button><nav id="nav-tree-menu" class="nav-tree" aria-label="全部功能">${shown.map(branch).join('')}</nav><nav class="nav-tree-rail" aria-label="功能栏目">${shown.map(rail).join('')}</nav>${live()?'':`<button class="nav-tree-about" data-action="about-prototype">${C.icon('shield')}<span>数据与原型说明</span></button>`}`;
}
document.addEventListener('click',event=>{
 const summary=event.target.closest('#sidebar .nav-tree-summary');
 if(summary&&window.CommonsMotion?.allowed()){event.preventDefault();window.CommonsMotion.details(summary.parentElement,open=>{state.branches[summary.parentElement.dataset.navGroup]=open;persist();});return;}
 const target=event.target.closest('[data-nav-action]');if(!target)return;
 const action=target.dataset.navAction;
 if(action==='search'){
  document.querySelector('#sidebar [data-action="close-menu"]')?.click();
  queueMicrotask(()=>document.querySelector('.search-trigger')?.click());
  return;
 }
 if(action==='width'){window.CommonsMotion.rail(()=>{state.collapsed=!state.collapsed;persist();sync();});}
 if(action==='group'){
  const id=target.dataset.navGroup;if(!groups().some(group=>group.id===id))return;
  window.CommonsMotion.rail(()=>{state.collapsed=false;state.branches[id]=true;persist();sync();});
  const branch=document.querySelector(`#sidebar [data-nav-group="${id}"]`);if(branch)branch.open=true;
  sync();branch?.querySelector('summary')?.focus({preventScroll:true});
 }
});
document.addEventListener('toggle',event=>{
 const branch=event.target;
 if(!(branch instanceof HTMLDetailsElement)||!branch.matches('#sidebar .nav-tree-branch:not(.is-current)')||!branch.isConnected)return;
 state.branches[branch.dataset.navGroup]=branch.open;persist();
},true);
window.addEventListener('resize',sync);
window.addEventListener('commons:games-preference',()=>window.Commons.refresh?.());
window.CommonsNavigation={render,sync,mobile};
})();

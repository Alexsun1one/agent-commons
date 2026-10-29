(() => {
'use strict';
const root=document.documentElement,reduce=matchMedia('(prefers-reduced-motion: reduce)');
const active=new Map(),closingDialogs=new Map(),closingBranches=new Map();
const tabSelectors=['.craft-goals','.gallery-mode','.discussion-tabs'];
let input='pointer',resizeFrame=0;
root.dataset.input=input;
const css=getComputedStyle(root);
const timing=name=>parseFloat(css.getPropertyValue('--motion-'+name))||180;
const easing=css.getPropertyValue('--ease-out').trim()||'cubic-bezier(.23,1,.32,1)';
const allowed=()=>!reduce.matches&&input!=='keyboard'&&!document.hidden;
function cancel(element){const animation=active.get(element);if(animation){active.delete(element);animation.cancel();}}
const spring=()=>css.getPropertyValue('--ease-spring').trim()||easing;
function play(element,frames,{duration=timing('base'),delay=0,ease=easing,pseudoElement}={}){
 if(!element?.isConnected)return null;
 cancel(element);
 if(!allowed()||!element.animate)return null;
 const animation=element.animate(frames,{duration,delay,easing:ease,fill:'both',...(pseudoElement?{pseudoElement}:{})});
 active.set(element,animation);
 const clean=()=>{if(active.get(element)===animation)active.delete(element);};
 animation.finished.then(()=>{clean();animation.cancel();},clean);
 return animation;
}
function settle(){
 for(const [element,animation] of [...active]){
  if(closingDialogs.get(element)===animation||[...closingBranches.values()].some(item=>item.animation===animation))animation.finish();
  else cancel(element);
 }
}
function modality(value){if(input===value)return;input=value;root.dataset.input=value;if(value==='keyboard')settle();}
document.addEventListener('pointerdown',()=>modality('pointer'),true);
document.addEventListener('pointermove',()=>{if(input==='keyboard')modality('pointer');},{capture:true,passive:true});
document.addEventListener('keydown',event=>{if(!['Shift','Control','Alt','Meta'].includes(event.key))modality('keyboard');},true);
document.addEventListener('click',event=>{if(event.detail===0)modality('keyboard');},true);
reduce.addEventListener('change',()=>{settle();window.CommonsShowcase?.stopDemo();window.CommonsShowcase?.syncDemo();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){settle();window.CommonsShowcase?.stopDemo(false);}});
function reveal(element,distance=6,delay=0){return play(element,[{opacity:.25,transform:`translateY(${distance}px)`},{opacity:1,transform:'translateY(0)'}],{duration:timing('enter'),delay});}
function appearance(element){const style=getComputedStyle(element);return {opacity:style.opacity,transform:style.transform};}
function currentTab(parent){return parent.querySelector('button[aria-pressed="true"],button.active');}
function tabGeometry(parent){const button=currentTab(parent);if(!button)return null;const a=parent.getBoundingClientRect(),b=button.getBoundingClientRect();return {x:b.left-a.left+parent.scrollLeft,width:b.width};}
function capture(){
 const tabs=new Map();
 tabSelectors.forEach(selector=>document.querySelectorAll(selector).forEach((parent,i)=>{const indicator=parent.querySelector('.motion-tab-line');if(indicator){const a=parent.getBoundingClientRect(),b=indicator.getBoundingClientRect();tabs.set(selector+':'+i,{x:b.left-a.left+parent.scrollLeft,width:b.width});}else tabs.set(selector+':'+i,tabGeometry(parent));}));
 return {route:document.body.dataset.route,work:document.querySelector('.schematic-step')?.dataset.id,tabs,nav:document.querySelector('#sidebar .nav-tree-link.active')?.getBoundingClientRect().top};
}
function syncTabs(previous){
 tabSelectors.forEach(selector=>document.querySelectorAll(selector).forEach((parent,i)=>{
  const next=tabGeometry(parent);if(!next)return;
  let indicator=parent.querySelector('.motion-tab-line');
  if(!indicator){indicator=document.createElement('i');indicator.className='motion-tab-line';indicator.setAttribute('aria-hidden','true');parent.append(indicator);}
  parent.dataset.motionTabs='true';
  const transform=`translateX(${next.x}px) scaleX(${next.width})`;indicator.style.transform=transform;
  const old=previous?.get(selector+':'+i);
  if(old&&(Math.abs(old.x-next.x)>1||Math.abs(old.width-next.width)>1))play(indicator,[{transform:`translateX(${old.x}px) scaleX(${old.width})`},{transform}],{duration:timing('enter')});
 }));
}
function beforeRender(){
 const snapshot=capture();
 for(const branch of closingBranches.keys()){closingBranches.delete(branch);cancel(branch.querySelector('.nav-tree-children'));if(branch.isConnected)branch.open=false;}
 for(const element of [...active.keys()])if(!element.isConnected||document.querySelector('#main')?.contains(element)||document.querySelector('#sidebar')?.contains(element))cancel(element);
 return snapshot;
}
function afterRender({enter,previous}){
 window.CommonsShowcase?.syncDemo();
 syncTabs(previous?.route===document.body.dataset.route?previous.tabs:null);
 const navLink=document.querySelector('#sidebar .nav-tree-link.active'),navShift=previous?.nav==null||!navLink?0:previous.nav-navLink.getBoundingClientRect().top;
 if(Math.abs(navShift)>1&&Math.abs(navShift)<320)play(navLink,[{transform:`translateY(${navShift}px)`},{transform:'none'}],{duration:timing('layout'),ease:spring(),pseudoElement:'::after'});
 if(!allowed())return;
 const main=document.querySelector('#main');
 if(document.body.dataset.route==='home'){
  const nextWork=main.querySelector('.schematic-step')?.dataset.id;
  if(enter){
   reveal(main.querySelector('.craft-heading'),4);
   reveal(main.querySelector('.ledger-featured'),7,24);
   reveal(main.querySelector('.craft-side'),5,42);
  }else if(previous?.work!==nextWork){
   reveal(main.querySelector('.ledger-work'),8);
   main.querySelectorAll('.ledger-compact').forEach((element,i)=>reveal(element,5,20+i*18));
  }
 }else if(enter){
  const blocks=[...main.querySelector('.page:not(.hub-page-head)')?.children||[]].filter(element=>element.getBoundingClientRect().top<innerHeight).slice(0,4);
  blocks.forEach((element,i)=>{
   if(document.body.dataset.route==='archive')play(element,[{opacity:.25},{opacity:1}],{duration:timing('enter'),delay:i*18});
   else reveal(element,5,i*18);
  });
 }
}
function flow(schematic,index){
 const signal=schematic?.querySelector('.flow-signal'),path=schematic?.querySelector(`[data-flow-link="${index-1}"]`);
 if(!signal||!path||!allowed())return;
 const start=path.getPointAtLength(0),end=path.getPointAtLength(path.getTotalLength());
 play(signal,[{transform:`translate(${start.x}px,${start.y}px)`,opacity:0},{offset:.15,opacity:1},{offset:.8,opacity:1},{transform:`translate(${end.x}px,${end.y}px)`,opacity:0}],{duration:timing('enter')});
}
function details(branch,onIntent){
 const pending=closingBranches.get(branch),children=branch.querySelector('.nav-tree-children');
 const from=appearance(children);
 if(pending){closingBranches.delete(branch);onIntent?.(true);play(children,[from,{opacity:1,transform:'translateY(0)'}]);return;}
 const branches=[...branch.parentElement.children].filter(n=>n instanceof HTMLDetailsElement);
 const change=open=>{
  const positions=new Map(branches.map(n=>[n,n.getBoundingClientRect().top]));
  branches.forEach(cancel);
  branch.open=open;
  branches.forEach(n=>{const dy=positions.get(n)-n.getBoundingClientRect().top;if(Math.abs(dy)>1)play(n,[{transform:`translateY(${dy}px)`},{transform:'translateY(0)'}]);});
  if(open)reveal(children,-4);
 };
 onIntent?.(!branch.open);
 if(!branch.open){change(true);return;}
 const animation=play(children,[from,{opacity:0,transform:'translateY(-3px)'}],{duration:timing('exit')});
 if(!animation){change(false);return;}
 closingBranches.set(branch,{animation});
 animation.finished.then(()=>{if(closingBranches.get(branch)?.animation===animation){closingBranches.delete(branch);if(branch.isConnected)change(false);}},()=>{});
}
function rail(change){
 // The archive contains a fixed tooltip; keep its containing block stationary.
 const elements=[document.body.dataset.route!=='archive'&&document.querySelector('#main'),document.querySelector('.topbar'),document.querySelector('.nav-tree-brand>.pioneer-mark')].filter(Boolean);
 const positions=elements.map(n=>n.getBoundingClientRect());elements.forEach(cancel);change();
 elements.forEach((element,i)=>{const next=element.getBoundingClientRect(),old=positions[i];play(element,[{transform:`translate(${old.x-next.x}px,${old.y-next.y}px)`},{transform:'translate(0,0)'}],{duration:timing('enter')});});
 const content=document.body.classList.contains('nav-tree-compact')?document.querySelector('.nav-tree-rail'):document.querySelector('.nav-tree');reveal(content,3);
}
function openDialog(dialog){
 const from=dialog.open?appearance(dialog):{opacity:0,transform:'translateY(6px) scale(.98)'};
 closingDialogs.delete(dialog);cancel(dialog);
 if(!dialog.open)dialog.showModal();
 play(dialog,[from,{opacity:1,transform:'translateY(0) scale(1)'}],{duration:timing('layout'),ease:spring()});
}
function closeDialog(dialog,immediate=false){
 if(!dialog.open)return;
 if(immediate||!allowed()){closingDialogs.delete(dialog);cancel(dialog);dialog.close();return;}
 if(closingDialogs.has(dialog))return;
 const animation=play(dialog,[appearance(dialog),{opacity:0,transform:'translateY(4px) scale(.99)'}],{duration:timing('exit')});
 if(!animation){dialog.close();return;}
 closingDialogs.set(dialog,animation);
 animation.finished.then(()=>{if(closingDialogs.get(dialog)===animation){closingDialogs.delete(dialog);if(dialog.open)dialog.close();}},()=>{});
}
window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>syncTabs());});
window.CommonsMotion={allowed,reduced:()=>reduce.matches,play,reveal,flow,details,rail,beforeRender,afterRender,openDialog,closeDialog,cancel};
})();

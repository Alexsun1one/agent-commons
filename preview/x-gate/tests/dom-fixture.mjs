// 小型 DOM 夹具仅验证事件与清理，不提供浏览器布局/绘制证据。
export class Element extends EventTarget {
  constructor(tag='div', doc=null) { super(); this.tagName=tag.toUpperCase(); this.ownerDocument=doc; this.children=[]; this.parentNode=null; this.attributes=new Map(); this.dataset={}; this.style={}; this.hidden=false; this.inert=false; this.tabIndex=['BUTTON','INPUT','SELECT','TEXTAREA','SUMMARY'].includes(this.tagName)?0:-1; this._text=''; this.className=''; this.scrollTop=0; this.classList={toggle:(name,on)=>{const all=new Set(this.className.split(' ').filter(Boolean)); if(on??!all.has(name))all.add(name);else all.delete(name);this.className=[...all].join(' ');},remove:name=>{this.className=this.className.split(' ').filter(n=>n!==name).join(' ');}}; }
  set textContent(value) { this._text=String(value); this.children.forEach(c=>c.parentNode=null);this.children=[]; }
  get textContent() { return this._text+this.children.map(c=>c.textContent).join(''); }
  append(...nodes) { for(let child of nodes) { if(!(child instanceof Element)) {const n=new Element('#text',this.ownerDocument);n.textContent=child;child=n;} if(child.parentNode)child.parentNode.children=child.parentNode.children.filter(c=>c!==child); child.parentNode=this; this.children.push(child); } }
  replaceChildren(...nodes) {this.textContent='';this.append(...nodes);}
  setAttribute(name,value) {this.attributes.set(name,String(value));if(name==='class')this.className=String(value);if(name==='id')this.id=String(value);if(name==='tabindex')this.tabIndex=Number(value);if(name==='hidden')this.hidden=true;}
  getAttribute(name) {return name==='class'?this.className:this.attributes.get(name)??null;}
  removeAttribute(name) {this.attributes.delete(name);}
  get isConnected() {return !!this.parentNode || this===this.ownerDocument?.body;}
  get lastChild(){return this.children.at(-1);}
  get firstChild(){return this.children[0];}
  getRootNode(){return this.ownerDocument;}
  getBoundingClientRect(){return {left:0,top:0,width:1440,height:900};}
  getClientRects(){return this.closest('[hidden]')?[]:[this.getBoundingClientRect()];}
  matches(selector) {
    const tag=selector.match(/^[a-z]+/i)?.[0]; if(tag&&tag.toUpperCase()!==this.tagName)return false;
    for(const [,name] of selector.matchAll(/\.([\w-]+)/g)) if(!this.className.split(' ').includes(name)) return false;
    if(selector.startsWith('#')&&this.id!==selector.slice(1))return false;
    for(const [,name,value] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      const actual=name==='hidden'?(this.hidden?'':null):name.startsWith('data-')?this.dataset[name.slice(5)]:this.getAttribute(name);
      if(value===undefined?actual==null:actual!==value)return false;
    }
    return true;
  }
  querySelectorAll(selector){const out=[];const selectors=selector.split(',');const walk=node=>{for(const c of node.children){if(selectors.some(s=>c.matches(s.trim())))out.push(c);walk(c);}};walk(this);return out;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){for(let n=this;n;n=n.parentNode)if(n.matches(selector))return n;return null;}
  scrollIntoView(options){this.lastScrollOptions=options;}
  focus(){this.ownerDocument.activeElement=this;}
  click(){this.dispatchEvent(new Event('click'));}
}
export function installDOM() {
  const doc=new EventTarget();doc.createElement=tag=>new Element(tag,doc);doc.createTextNode=text=>{const n=doc.createElement('#text');n.textContent=text;return n;};doc.body=doc.createElement('body');doc.head=doc.createElement('head');doc.getElementById=id=>doc.body.querySelector(`#${id}`)||doc.head.querySelector(`#${id}`);doc.activeElement=doc.body;
  doc.createElementNS=(_ns,tag)=>doc.createElement(tag);
  globalThis.document=doc;globalThis.Node=Element;globalThis.MutationObserver=class{observe(){}disconnect(){}};
  globalThis.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),0);globalThis.cancelAnimationFrame=clearTimeout;
  const structure={
    'x-app':['x-navigation','x-space-card','x-scene-actions','x-hotspot-label','x-location','x-announcer','x-workbench','x-messages'],
    'x-workbench':['x-workbench-title','x-workbench-close','x-sections','x-content'],
    'x-messages':['x-messages-title','x-messages-close','x-messages-content'],
  };
  const app=doc.createElement('div');app.id='x-app';doc.body.append(app);
  for(const [parent,ids] of Object.entries(structure))for(const id of ids){const node=doc.createElement(id.includes('close')?'button':'div');node.id=id;doc.getElementById(parent).append(node);}
  for(const id of ['x-workbench','x-messages','x-space-card'])doc.getElementById(id).hidden=true;
  return doc;
}

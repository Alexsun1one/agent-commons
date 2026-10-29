"""LG-6C R8: real-mode app.js empty states, guest shell and third-party complaint page (offline VM)."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]

COMMON = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const source=name=>fs.readFileSync(root+'/preview/'+name+'.js','utf8');
const BEFORE=fs.readFileSync(root+'/docs/evidence/LG-6C/before-app.js','utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function eventTarget(){const events={};return {events,addEventListener(k,f){(events[k]??=new Set()).add(f)},removeEventListener(k,f){events[k]?.delete(f)},dispatchEvent(e){for(const f of [...(events[e.type]||[])])f(e);return true}}}
function context(demo){
 const c=Object.assign(eventTarget(),{console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,
  location:{protocol:demo?'file:':'https:',hash:'#/home',href:'https://fixture.invalid/index.html',replace(hash){this.hash=hash}},
  document:{querySelector:()=>null},CustomEvent:class{constructor(type,opts){this.type=type;Object.assign(this,opts)}},
  crypto:{randomUUID:()=> 'fixture'},calls:[],pending:[]});
 c.fetch=(url,opts)=>{c.calls.push({url,opts});return new Promise((resolve,reject)=>c.pending.push({resolve,reject}))};
 c.reply=(status,data,index=0)=>{const item=c.pending.splice(index,1)[0];assert(item,'pending request');item.resolve({status,ok:status>=200&&status<300,headers:{get:()=>null},text:()=>Promise.resolve(data===undefined?'':JSON.stringify({data})),json:()=>Promise.resolve({data})})};
 c.fail=()=>c.pending.shift().reject(Error('offline fixture'));
 c.window=c;c.self=c;vm.createContext(c);return c;
}
const member={handle:'real-user',display_name:'真实队员',avatar_ref:'/api/media/f/face.webp',level:3,roles:[]};
function setup(demo,original,hash='#/home'){
 const c=context(demo),nodes={},stored={},classes=new Set();
 function node(){return Object.assign(eventTarget(),{innerHTML:'',textContent:'',open:false,inert:false,dataset:{},style:{setProperty(){}},isConnected:true,
  classList:{contains:()=>false,toggle(){},add(){},remove(){}},setAttribute(){},removeAttribute(){},getAttribute(){return null},
  querySelector:()=>null,querySelectorAll:()=>[],insertAdjacentHTML(where,text){this.innerHTML=(where==='afterbegin'?text:'')+this.innerHTML+(where==='afterbegin'?'':text)},
  focus(){},close(){},getClientRects:()=>[],replaceChildren(){},contains:()=>false});}
 for(const key of ['#main','#sidebar','#topbar','#mobile-nav','#dialog','#dialog-title','#dialog-body','#toast','.app-shell','.app-footer','#announce-slot','#sh-hello','#main .sh-me'])nodes[key]=node();
 nodes['.app-footer'].innerHTML='DEMO FOOTER';
 const body=node();body.classList={contains:k=>classes.has(k),toggle(){},add(k){classes.add(k)},remove(k){classes.delete(k)}};
 c.document=Object.assign(eventTarget(),{body,activeElement:null,querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],getElementById:id=>nodes['#'+id]||null,createElement:node});
 Object.assign(c,{innerWidth:1440,CSS:{escape:s=>s},setTimeout:()=>1,clearTimeout(){},queueMicrotask:()=>{},scrollTo(){},matchMedia:()=>({matches:true}),
  localStorage:{getItem:k=>stored[k]??null,setItem:(k,v)=>stored[k]=v},
  CommonsNavigation:{render:()=>'<nav>MEMBER NAV</nav>',sync(){},mobile:()=>[]},
  CommonsMotion:{beforeRender(){},afterRender(){},closeDialog(){}},
  CommonsShowcase:{stopDemo(){}},CommonsPages:[],COMMONS_DATA:{people:[],works:[],methods:[],goals:[],topics:[],opportunities:[]}});
 c.location.hash=hash;if(demo)c.CommonsShowcase.home=()=>'<section>DEMO_HOME</section>';
 vm.runInContext(source('api'),c);vm.runInContext(original?BEFORE:source('app'),c);
 return {c,nodes,stored,classes};
}
// app.js already asked /api/me once on start; answer every pending request so refresh() settles
async function answer(x,status,data){const p=x.c.CommonsSession.refresh();while(x.c.pending.length)x.c.reply(status,data,0);await p;await tick();}
const asMember=x=>answer(x,200,member),asGuest=x=>answer(x,401);
const textOf=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
'''

EMPTY = r'''
(async()=>{
 const x=setup(false,false),{c,nodes}=x;await asMember(x);
 // route, heading, "what appears" sentence, links
 const cases=[
  ['#/home','还没有新内容','关注成员、加入小组后，他们的动态会汇总到这里。',['#/groups']],
  ['#/people','还没有作品和成员','成员发布作品、完善主页后会出现在这里',['#/contribute']],
  ['#/people/p1','没有找到这位成员','这个主页可能不存在',['#/people']],
  ['#/knowledge','知识地图还是空的','问题库和资源库有了内容之后，知识地图才会长出来。',['#/solved','#/skills']],
  ['#/knowledge/x','没有找到这篇内容','它可能还没发布或已被撤回',['#/knowledge']],
  ['#/work/x','没有找到这件作品','它可能还没发布',['#/people']],
  ['#/workshop','还没有可练习的方法','对应的练习会列在这里。',['#/solved']],
  ['#/opportunities','还没有合作机会','有人发布合作需求后会出现在这里',['#/market/new']],
  ['#/project','还没有共同项目','项目会出现在这里。',['#/opportunities']],
  ['#/discuss','还没有讨论','有人发起话题后会出现在这里。',['#/threads']],
 ];
 const tabNames=['今天','同行','作品与同行','知识地图','知识','成员','作品','实战工坊','合作机会','共同项目','知识治理','开放讨论'];
 for(const [hash,head,what,links] of cases){
  c.location.hash=hash;c.Commons.refresh();const html=nodes['#main'].innerHTML;
  assert(html.includes('class="empty"'),hash+' empty card');
  assert.equal((html.match(/class="empty"/g)||[]).length,1,hash+' one empty card');
  assert(!html.includes('暂无可显示的内容'),hash);assert(!html.includes('重试'),hash+' no retry');assert(!html.includes('data-action'),hash+' no actions');assert(!html.includes('<h1'),hash+' no repeated title');
  assert(html.includes('<h3>'+head+'</h3>'),hash+' heading '+head);assert(html.includes(what),hash+' sentence');
  assert(!tabNames.includes(textOf(html.match(/<h3>(.*?)<\/h3>/)[1])),hash+' heading must not be a tab name');
  const hrefs=[...html.matchAll(/class="button" href="([^"]*)"/g)].map(m=>m[1]);assert.deepEqual(hrefs,links,hash+' links');
  assert(!/\b(NaN|undefined|null)\b/.test(html),hash);
 }
 // 主控 R17：真实模式的 #/governance 不再画空卡，直接跳到知识治理页
 c.location.hash='#/governance';c.Commons.refresh();assert.equal(c.location.hash,'#/knowledge/govern','#/governance redirects to knowledge governance');
 // a real interface error is not an empty state: session notice keeps its retry
 let p=c.CommonsSession.refresh();c.fail();await assert.rejects(p);
 c.location.hash='#/opportunities';c.Commons.refresh();assert(nodes['#main'].innerHTML.includes('session-retry'));
 console.log('EMPTY_PASS 10 routes + governance redirect: one calm empty card, what+how, no retry, no repeated title');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

GUEST_SHELL = r'''
(async()=>{
 const x=setup(false,false),{c,nodes,classes}=x;await asGuest(x);
 for(const route of ['hello','login','welcome','govern']){
  c.location.hash='#/'+route;c.Commons.refresh();const side=nodes['#sidebar'].innerHTML;
  assert(!side.includes('nav-link'),route+' old class');
  assert(side.includes('class="nav-tree-header"'));assert(side.includes('class="nav-tree-brand"'));assert(side.includes('pioneer-mark'));assert(side.includes('先锋<small>AGENT COMMONS</small>'));
  assert.equal((side.match(/class="nav-tree-top/g)||[]).length,4,route);
  assert.equal((side.match(/aria-current="page"/g)||[]).length,1,route);
  assert(new RegExp('class="nav-tree-top is-current" href="#/'+route+'" aria-current="page"').test(side),route+' current link');
  for(const label of ['首页','登录','用邀请码加入','第三方投诉'])assert(side.includes('<span>'+label+'</span>'),label);
  for(const word of ['竹子','私信','通知','我的空间','管理'])assert(!side.includes(word),word);
  assert(classes.has('nav-tree-expanded')&&!classes.has('nav-tree-compact'));
  assert(nodes['#topbar'].innerHTML.includes('用邀请码加入'));
 }
 assert.equal(nodes['#sidebar'].inert,false);c.innerWidth=500;c.Commons.refresh();assert.equal(nodes['#sidebar'].inert,true);
 // member shell is untouched: navigation module renders it
 const y=setup(false,false);await asMember(y);y.c.location.hash='#/home';y.c.Commons.refresh();assert.equal(y.nodes['#sidebar'].innerHTML,'<nav>MEMBER NAV</nav>');
 console.log('GUEST_SHELL_PASS navigation.css classes, brand, current link, member shell untouched');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

COMPLAINT = r'''
(async()=>{
 const x=setup(false,false),{c,nodes}=x;await asGuest(x);
 c.location.hash='#/govern';c.Commons.refresh();const html=nodes['#main'].innerHTML;
 assert(html.includes('class="gov-page" style="max-width:40rem"'),'form column limited to reading width');
 const intro=textOf(html);
 for(const phrase of ['不需要账号','治理队列','治理员','受理编号'])assert(intro.includes(phrase),phrase);
 assert(!/小时|工作日|天内|时限|承诺|保证/.test(intro),'no handling deadline');
 assert(html.includes('data-form="guest-complaint"'));assert(html.includes('data-receipt hidden'));assert(html.includes('data-receipt-id'));
 assert(/data-receipt-id style="[^"]*user-select:all/.test(html),'receipt id is one-click selectable');
 c.FormData=class{constructor(form){this.fields=form.fields}get(k){return this.fields[k]}};
 const button={disabled:false,textContent:'提交投诉'},note={textContent:''},wrap={hidden:true},idEl={textContent:''};
 const form={dataset:{form:'guest-complaint'},fields:{locator:'/read/item',category:'privacy',statement:'请核对'},isConnected:true,reportValidity:()=>true,reset(){this.resetDone=true},
  querySelector:s=>({'button[type="submit"]':button,'[role="status"]':note,'[data-receipt]':wrap,'[data-receipt-id]':idEl})[s]||null};
 const submit=()=>c.document.dispatchEvent({type:'submit',target:{closest:()=>form},preventDefault(){}});
 submit();assert.equal(wrap.hidden,true);assert.equal(note.textContent,'正在提交…');
 c.fail();await tick();assert.equal(wrap.hidden,true,'failed submit shows no receipt');assert.equal(idEl.textContent,'');assert.equal(button.textContent,'重试提交');
 submit();c.reply(200,{id:'GC-20261027-0042'});await tick();
 assert.equal(wrap.hidden,false);assert.equal(idEl.textContent,'GC-20261027-0042');assert(note.textContent.includes('请保存这个编号'));assert(!note.textContent.includes('GC-20261027-0042'),'id lives on its own line');
 assert(form.resetDone);assert.equal(button.textContent,'提交投诉');
 submit();assert.equal(wrap.hidden,true,'resubmit hides the previous receipt');c.reply(200,{id:'GC-2'});await tick();assert.equal(idEl.textContent,'GC-2');
 console.log('COMPLAINT_PASS width, intro, no deadline, receipt on its own selectable line, failure/resubmit');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

DEMO = r'''
(async()=>{
 const routes=['home','hello','knowledge','people','people/p1','workshop','opportunities','project','governance','discuss','sources','nope','govern','login'];
 let compared=0;
 for(const route of routes){
  const out=[];
  for(const original of [true,false]){
   let x,state;
   try{x=setup(true,original,'#/'+route);x.c.Commons.refresh();state=['#main','#sidebar','#topbar','#mobile-nav','.app-footer'].map(k=>x.nodes[k].innerHTML).join('\u0001')+'|'+[...x.classes].sort().join(',');}catch(e){state='THROW '+e.message;}
   out.push(state);if(x)assert.equal(x.c.calls.length,0,'demo makes no request');
  }
  assert.equal(out[1],out[0],'demo output changed for '+route);if(!out[0].startsWith('THROW'))compared++;
 }
 assert(compared>=6,'enough demo routes rendered ('+compared+')');
 console.log('DEMO_PASS '+compared+' of '+routes.length+' routes byte-identical to the pre-change app.js');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


class LG6CAppShellTests(unittest.TestCase):
    def run_node(self, script):
        result = subprocess.run(['node', '-e', COMMON + script, str(ROOT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('_PASS ', result.stdout)
        return result.stdout

    def test_empty_states_say_what_and_how_without_retry_or_repeated_title(self):
        self.run_node(EMPTY)

    def test_guest_sidebar_uses_member_navigation_classes_and_brand(self):
        self.run_node(GUEST_SHELL)

    def test_third_party_complaint_page_is_narrow_explained_and_shows_receipt(self):
        self.run_node(COMPLAINT)

    def test_demo_mode_output_is_unchanged(self):
        self.run_node(DEMO)

    def test_source_has_no_legacy_empty_state_or_old_guest_links(self):
        text = (ROOT / 'preview/app.js').read_text()
        self.assertNotIn('暂无可显示的内容', text)
        # R8 removed the old empty-state retry action; R13's own fetch-failure button uses data-live-retry
        self.assertNotIn('data-action="live-retry"', text)
        self.assertNotIn("case'live-retry'", text)
        self.assertNotIn('class="nav-link"', text)
        import re
        # R13: pages with a data source call liveHost(key) (which embeds the same empty card); the others still call liveEmpty(key)
        keys = set(re.findall(r"live(?:Empty|Host)\(\s*'([a-z]+)'", text))
        for pair in re.findall(r"live(?:Empty|Host)\(id\?'([a-z]+)':'([a-z]+)'", text):
            keys |= set(pair)
        table = set(re.findall(r"^ ([a-z]+):\['", text.split('const EMPTY={')[1].split('};')[0], re.M))
        self.assertTrue(keys and keys <= table, keys - table)


if __name__ == '__main__':
    unittest.main()

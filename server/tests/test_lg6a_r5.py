"""LG-6A R5: real session state, guarded shell and worker replacement (offline VM)."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]

COMMON = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const source=name=>fs.readFileSync(root+'/preview/'+name+'.js','utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function eventTarget(){const events={};return {events,addEventListener(k,f){(events[k]??=new Set()).add(f)},removeEventListener(k,f){events[k]?.delete(f)},dispatchEvent(e){for(const f of [...(events[e.type]||[])])f(e)}}}
function context(demo=false){
 const c=Object.assign(eventTarget(),{console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,
  location:{protocol:demo?'file:':'https:',hash:'#/home',href:'https://fixture.invalid/index.html',replace(hash){this.hash=hash}},
  document:{querySelector:()=>null},CustomEvent:class{constructor(type,opts){this.type=type;Object.assign(this,opts)}},
  crypto:{randomUUID:()=> 'fixture'},calls:[],pending:[]});
 c.fetch=(url,opts)=>{c.calls.push({url,opts});return new Promise((resolve,reject)=>c.pending.push({resolve,reject}))};
 c.reply=(status,data,index=0)=>{const item=c.pending.splice(index,1)[0];assert(item,'pending request');item.resolve({status,ok:status>=200&&status<300,headers:{get:()=>null},text:()=>Promise.resolve(JSON.stringify(status===200?{data}:{error:{code:status===401?'unauthenticated':'unavailable',message:'RAW ERROR'}}))})};
 c.fail=()=>c.pending.shift().reject(Error('offline fixture'));
 c.window=c;c.self=c;vm.createContext(c);return c;
}
const member={handle:'real-user',display_name:'真实 <队员>',avatar_ref:'/api/media/f/face.webp',level:3,roles:['admin','lecturer']};
'''

SESSION = r'''
(async()=>{
 const c=context();vm.runInContext(source('api'),c);const s=c.CommonsSession,events=[];c.addEventListener('commons:session',e=>events.push(e.detail));
 assert.equal(s.state,'loading');assert.equal(s.me,null);assert.equal(c.calls.length,0);
 let p=s.refresh();c.fail();await assert.rejects(p);assert.equal(s.state,'loading');assert.equal(s.me,null);assert(s.error);assert.equal(events.length,1);
 p=s.refresh();c.reply(401);await p;assert.equal(s.state,'guest');assert.equal(s.me,null);assert.equal(s.error,null);
 p=s.refresh();c.reply(200,member);await p;assert.equal(s.state,'member');assert.equal(s.me.handle,member.handle);assert(s.hasRole('admin'));assert(s.hasRole('lecturer'));assert(!s.hasRole('owner'));assert(!s.hasRole('governor'));
 const same=s.me;p=s.refresh();c.fail();await assert.rejects(p);assert.strictEqual(s.me,same);assert.equal(s.state,'member');assert(s.error);
 p=s.refresh();c.reply(503);await assert.rejects(p);assert.strictEqual(s.me,same);
 const old=s.refresh(),fresh=s.refresh();c.reply(200,{...member,display_name:'新名字'},1);await fresh;c.reply(401);await old;assert.equal(s.me.display_name,'新名字');
 p=s.signOut();c.fail();await assert.rejects(p);assert.equal(s.state,'member');assert.equal(c.calls.at(-1).url,'/api/auth/logout');assert.equal(c.calls.at(-1).opts.method,'POST');assert.equal(c.calls.at(-1).opts.headers['X-Commons-CSRF'],'1');
 p=s.signOut();c.reply(200,{signed_out:true});await tick();assert.equal(c.calls.at(-1).url,'/api/me');assert.equal(s.state,'guest');c.reply(401);await p;assert.equal(c.location.hash,'#/hello');assert.equal(s.me,null);
 p=s.refresh();c.reply(200,member);await p;
 const stale=s.refresh();p=s.signOut();c.reply(200,{signed_out:true},1);await tick();c.reply(200,member,0);await stale;c.fail();await assert.rejects(p);assert.equal(s.state,'guest');assert.equal(s.me,null);assert.equal(c.location.hash,'#/hello');
 const d=context(true);vm.runInContext(source('api'),d);await d.CommonsSession.refresh();await d.CommonsSession.signOut();assert.equal(d.CommonsSession.state,'member');assert.equal(d.CommonsSession.me,null);assert.equal(d.calls.length,0);assert.equal(d.location.hash,'#/home');
 console.log('SESSION_PASS loading/guest/member; 401/network/503; roles; latest response; logout; demo');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

SHELL = r'''
function setup(demo=false,original=false){
 const c=context(demo),nodes={},stored={},mounts={public:0,private:0},counts={badges:0,nav:0};
 function node(){return Object.assign(eventTarget(),{innerHTML:'',textContent:'',open:false,inert:false,dataset:{},style:{setProperty(){}},isConnected:true,
  classList:{contains:()=>false,toggle(){},add(){},remove(){}},setAttribute(){},removeAttribute(){},getAttribute(){return null},
  querySelector:()=>null,querySelectorAll:()=>[],insertAdjacentHTML(where,text){this.innerHTML=(where==='afterbegin'?text:'')+this.innerHTML+(where==='afterbegin'?'':text)},
  focus(){},close(){},getClientRects:()=>[],replaceChildren(){},contains:()=>false});}
 for(const key of ['#main','#sidebar','#topbar','#mobile-nav','#dialog','#dialog-title','#dialog-body','#toast','.app-shell','.app-footer','#announce-slot','#sh-hello','#main .sh-me'])nodes[key]=node();
 nodes['#sh-hello'].textContent='早上好，我';nodes['.app-footer'].innerHTML='DEMO FOOTER';
 c.document=Object.assign(eventTarget(),{body:node(),activeElement:null,querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],getElementById:id=>nodes['#'+id]||null,createElement:node});
 Object.assign(c,{innerWidth:1440,CSS:{escape:s=>s},setTimeout:()=>1,clearTimeout(){},queueMicrotask:()=>{},scrollTo(){},matchMedia:()=>({matches:true}),
  localStorage:{getItem:k=>stored[k]??null,setItem:(k,v)=>stored[k]=v},
  CommonsNavigation:{render:()=>{counts.nav++;return '<nav>MEMBER NAV</nav>'},sync(){},mobile:()=>[]},
  CommonsMotion:{beforeRender(){},afterRender(){},closeDialog(){}},
  CommonsPages:[{routes:{hello:()=>'<section>HELLO</section>',login:()=>'<section>LOGIN</section>',welcome:()=>'<section>WELCOME</section>'},mount(){mounts.public++}},
    {routes:{protected:()=>'<section>PRIVATE</section>',govern:()=>{throw Error('guest must not render governance console')}},mount(){mounts.private++}}],
  CommonsEconomy:{badge:()=>{counts.badges++;return '<i>竹子</i>'}},CommonsDM:{badge:()=>{counts.badges++;return '<i>私信</i>'}},CommonsNotify:{bell:()=>{counts.badges++;return '<i>通知</i>'}},
  CommonsShowcase:{home:()=>'<section>MEMBER HOME</section>',stopDemo(){}},COMMONS_DATA:{people:[],works:[],methods:[],goals:[],topics:[],opportunities:[]}});
 if(!demo)c.location.hash='#/protected/item?view=detail';
 vm.runInContext(source('api'),c);vm.runInContext(original?fs.readFileSync(root+'/docs/evidence/LG-6A/r5/before-app.js','utf8'):source('app'),c);
 return {c,nodes,stored,mounts,counts};
}
(async()=>{
 const x=setup(),{c,nodes,counts,mounts}=x;
 assert.equal(c.calls.length,1);assert.equal(c.calls[0].url,'/api/me');assert(nodes['#main'].innerHTML.includes('aria-busy="true"'));assert.equal(mounts.private,0);assert.equal(counts.badges,0);assert.equal(counts.nav,0);
 c.fail();await tick();assert.equal(c.CommonsSession.state,'loading');assert(nodes['#main'].innerHTML.includes('重试'));assert.equal(counts.badges,0);
 let p=c.CommonsSession.refresh();c.reply(401);await p;assert.equal(c.location.hash,'#/hello');assert(nodes['#main'].innerHTML.includes('HELLO'));
 assert.equal(c.Commons.read('session.returnTo',''),'#/protected/item?view=detail');assert(nodes['#topbar'].innerHTML.includes('登录'));assert(nodes['#topbar'].innerHTML.includes('用邀请码加入'));
 for(const word of ['竹子','私信','通知','我的空间','管理'])assert(!nodes['#topbar'].innerHTML.includes(word)&&!nodes['#sidebar'].innerHTML.includes(word),word);
 assert.equal(mounts.private,0);assert.equal(counts.badges,0);
 c.document.dispatchEvent({type:'keydown',key:'k',ctrlKey:true,preventDefault(){}});assert(['#/login','/login'].includes(c.location.hash));
 for(const route of ['login','welcome','govern','hello']){c.location.hash='#/'+route;c.Commons.refresh();assert.equal(c.location.hash,'#/'+route);}
 c.location.hash='#/govern';c.Commons.refresh();assert(nodes['#main'].innerHTML.includes('data-form="guest-complaint"'));assert(!nodes['#main'].innerHTML.includes('治理台'));assert.equal(mounts.private,0);
 c.FormData=class{constructor(form){this.fields=form.fields}get(k){return this.fields[k]}};
 const button={disabled:false,textContent:'提交投诉'},note={textContent:''};
 const form={dataset:{form:'guest-complaint'},fields:{locator:' /read/item ',category:'privacy',statement:' 请核对 '},isConnected:true,reportValidity:()=>true,reset(){this.resetDone=true},querySelector:s=>s==='button[type="submit"]'?button:note};
 const submit=()=>c.document.dispatchEvent({type:'submit',target:{closest:()=>form},preventDefault(){}});
 submit();assert.equal(c.calls.at(-1).url,'/api/governance/complaints');assert.deepEqual(JSON.parse(c.calls.at(-1).opts.body),{locator:'/read/item',category:'privacy',statement:'请核对'});assert(button.disabled);
 c.fail();await tick();assert.equal(button.disabled,false);assert.equal(button.textContent,'重试提交');assert(!note.textContent.includes('RAW ERROR'));
 submit();c.reply(200,{id:'complaint-fixture'});await tick();assert(note.textContent.includes('complaint-fixture'));assert(form.resetDone);

 c.location.hash='#/protected/item?view=detail';c.Commons.refresh();assert.equal(c.location.hash,'#/hello');
 c.location.hash='#/login';c.Commons.refresh();p=c.CommonsSession.refresh();c.reply(200,member);await p;assert.equal(c.location.hash,'#/protected/item?view=detail');assert(nodes['#main'].innerHTML.includes('PRIVATE'));
 assert(nodes['#topbar'].innerHTML.includes('真实 &lt;队员&gt;'));assert(nodes['#topbar'].innerHTML.includes('L3'));assert(nodes['#topbar'].innerHTML.includes('/api/media/f/face.webp'));assert(!nodes['#topbar'].innerHTML.includes('我的空间'));
 c.location.hash='#/home';c.Commons.refresh();assert.equal(nodes['#sh-hello'].textContent,'早上好，真实 <队员>');assert(nodes['#main .sh-me'].innerHTML.includes('真实 &lt;队员&gt;'));
 p=c.CommonsSession.refresh();c.fail();await assert.rejects(p);assert.equal(c.CommonsSession.state,'member');assert(nodes['#main'].innerHTML.includes('MEMBER HOME'));assert(nodes['#main'].innerHTML.includes('重试'));
 p=c.CommonsSession.refresh();c.reply(401);await p;assert.equal(c.location.hash,'#/hello');assert(!nodes['#main'].innerHTML.includes('MEMBER HOME'));
 const d=setup(true),before=setup(true,true);assert.equal(d.c.calls.length,0);for(const k of ['#main','#sidebar','#topbar','#mobile-nav','.app-footer'])assert.equal(d.nodes[k].innerHTML,before.nodes[k].innerHTML,'demo changed '+k);
 console.log('SHELL_PASS guarded routes; exact return hash; public-only mounts; real identity; network retry; demo chrome equality');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

PWA = r'''
function setup(controlled=false){
 const c=context(),sw=eventTarget(),reg=eventTarget(),worker=eventTarget(),bars=[];
 function node(){return {textContent:'',children:[],setAttribute(){},appendChild(x){this.children.push(x)},get childElementCount(){return this.children.length},remove(){const i=bars.indexOf(this);if(i>=0)bars.splice(i,1)}}}
 c.document=Object.assign(eventTarget(),{body:{appendChild:x=>bars.push(x)},currentScript:{src:'https://fixture.invalid/app.js'},querySelector:()=>null,querySelectorAll:s=>s==='[data-pwa-bars]'?bars.slice():[],createElement:node});
 sw.controller=controlled?{id:'old'}:null;reg.active={scriptURL:'https://fixture.invalid/sw.js?v=app-1'};reg.installing=worker;reg.waiting=controlled?{id:'waiting'}:null;
 sw.getRegistration=()=>Promise.resolve(null);sw.register=()=>Promise.resolve(reg);c.navigator={serviceWorker:sw};c.matchMedia=()=>({matches:false});c.Commons={read:(k,d)=>d,write:()=>true};
 vm.runInContext(source('pwa'),c);const text=n=>(n.textContent||'')+(n.children||[]).map(text).join('');return {c,sw,reg,worker,updated:()=>bars.map(text).join('').includes('有新版本')};
}
(async()=>{
 const s=setup();s.c.CommonsPwa.mount();await tick();assert(!s.updated());
 s.reg.dispatchEvent({type:'updatefound'});s.worker.state='installed';s.worker.dispatchEvent({type:'statechange'});assert(!s.updated());
 s.sw.controller={id:'first'};s.sw.dispatchEvent({type:'controllerchange'});s.worker.state='activated';s.worker.dispatchEvent({type:'statechange'});assert(!s.updated(),'first install activation is not update');
 s.sw.dispatchEvent({type:'controllerchange'});assert(!s.updated(),'same controller is not update');
 s.c.CommonsPwa.destroy();s.c.CommonsPwa.mount();await tick();assert(!s.updated());
 s.sw.controller={id:'second'};s.sw.dispatchEvent({type:'controllerchange'});assert(s.updated(),'replacement must show update');s.c.CommonsPwa.destroy();
 const old=setup(true);old.c.CommonsPwa.mount();await tick();assert(!old.updated(),'waiting worker has not replaced controller');old.sw.controller={id:'new'};old.sw.dispatchEvent({type:'controllerchange'});assert(old.updated());old.c.CommonsPwa.destroy();
 console.log('PWA_PASS first installation silent; duplicate controller silent; real replacement notified; remount');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


class R5SessionTests(unittest.TestCase):
    def run_node(self, script):
        result = subprocess.run(['node', '-e', COMMON + script, str(ROOT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('_PASS ', result.stdout)

    def test_session_contract_error_races_logout_and_demo(self):
        self.run_node(SESSION)

    def test_shell_guard_return_identity_guest_complaint_and_demo(self):
        self.run_node(SHELL)

    def test_worker_only_notifies_after_controller_replacement(self):
        self.run_node(PWA)

    def test_auth_assets_are_wired_before_shell(self):
        text = (ROOT / 'preview/index.html').read_text()
        self.assertEqual(text.count('src="auth.js"'), 1)
        self.assertEqual(text.count('href="auth.css"'), 1)
        self.assertLess(text.index('src="api.js"'), text.index('src="auth.js"'))
        self.assertLess(text.index('src="auth.js"'), text.index('src="app.js"'))
        self.assertTrue((ROOT / 'preview/auth.js').is_file())
        self.assertTrue((ROOT / 'preview/auth.css').is_file())

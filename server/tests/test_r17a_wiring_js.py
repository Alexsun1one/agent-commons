"""R17-A · account.js（换头像、公开排名开关）、market.js（带图发布、卡片图）、editor.js（线上插图入口）的离线 VM 测试。

假返回值的形状来自 test_r17a_media_wiring.py 里对真实路由的断言：
/api/me 带 capabilities 和 avatar_ref；/api/growth/me → data.optedOut；/api/growth/rules → data.publicRanking；
/api/market/listings 的 images 是资产元数据列表（image.src）；PUT /api/account/avatar → data.avatar_ref / data.avatar['128']。
"""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

ACCOUNT = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const tick=async(n=30)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
const same=(a,b,m)=>assert.equal(JSON.stringify(a),JSON.stringify(b),m);
const SRC=fs.readFileSync(root+'/preview/account.js','utf8');
function make(opts){
  opts=opts||{};
  const handlers={};const calls=[];let html='';
  const err=(status,code,message)=>Object.assign(new Error(message),{status,code});
  const me={handle:'wirer',display_name:'接线员',level:2,status:'active',avatar_ref:opts.avatarRef||null,totp_enabled:false,metering_consent:true,
    capabilities:opts.caps||['upload.avatar','account.avatar.set','upload.create']};
  const puts=[];let keyN=0;
  const api={mode:'live',newIdempotencyKey:()=>'idem-key-'+(++keyN),
    get(path){calls.push(['GET',path]);
      if(path==='/me')return Promise.resolve({data:me});
      if(path==='/growth/me')return opts.noGrowth?Promise.reject(err(501,'capability_unavailable','x')):Promise.resolve({data:{optedOut:!!opts.optedOut}});
      if(path==='/growth/rules')return Promise.resolve({data:{publicRanking:!!opts.publicOn}});
      if(path.indexOf('/media/assets/')===0)return Promise.resolve({data:{id:'av-1',purpose:'avatar',sizes:{'64':'/api/media/f/'+'d'.repeat(64)+'.webp','128':'/api/media/f/'+'e'.repeat(64)+'.webp'}}});
      return Promise.reject(err(404,'resource_not_found','x'));},
    post(path,body,o){calls.push(['POST',path,body,o&&o.idempotencyKey]);
      if(path==='/growth/optout'){if(opts.optoutFails)return Promise.reject(err(0,'network_error','x'));return Promise.resolve({data:{optedOut:!!body.optout}});}
      return Promise.resolve({data:{}});},
    put(path,body,o){calls.push(['PUT',path,body,o&&o.idempotencyKey]);
      if(opts.putFailsOnce&&!puts.length){puts.push(1);return Promise.reject(err(0,'network_error','x'));}
      puts.push(2);
      return Promise.resolve({data:{avatar_ref:body.asset_id,avatar:{'64':'/api/media/f/'+'d'.repeat(64)+'.webp','128':'/api/media/f/'+'e'.repeat(64)+'.webp'}}});},
    del(path,body,o){calls.push(['DELETE',path,body,o&&o.idempotencyKey]);return Promise.resolve({data:{avatar_ref:null,avatar:null}});}
  };
  const rootEl={contains:()=>true,querySelector:()=>null,set innerHTML(v){html=String(v)},get innerHTML(){return html}};
  const uploads=[];
  const c={console,Promise,Object,String,Number,Array,Math,JSON,Date,Error,setTimeout,clearTimeout,URL,Blob:function(){},
    AbortController,CustomEvent:function(t,d){this.type=t;this.detail=d&&d.detail},
    location:{protocol:'https:',hash:'#/account'},
    document:{querySelector:s=>s==='[data-account]'?rootEl:null,createElement:()=>({set innerHTML(v){this._h=v},firstElementChild:null}),
      addEventListener(t,f){(handlers[t]??=[]).push(f)},removeEventListener(){}},
    addEventListener(){},removeEventListener(){},dispatchEvent(){},
    Commons:{toast(){},read:(k,f)=>f,write:()=>true,esc:x=>String(x),safeUrl:x=>String(x||'#'),icon:()=>''},CommonsAPI:api,
    CommonsSession:{can:a=>(opts.caps||['upload.avatar','account.avatar.set','upload.create']).indexOf(a)>=0},
    CommonsMedia:{upload:(file,o)=>{uploads.push({file,o});return opts.uploadFails?Promise.reject(Object.assign(new Error('网络断了，文件没传完。点「重试」会接着传。'),{retry:()=>Promise.resolve({id:'av-1',url:'/x'})})):Promise.resolve({id:'av-1',url:'/x'});}}};
  c.window=c;c.self=c;c.globalThis=c;c.COMMONS_BUILD={mode:'live'};
  vm.createContext(c);vm.runInContext(SRC,c);
  return {c,calls,handlers,uploads,api,rootEl,get html(){return html}};
}
function fire(t,type,target){(t.handlers[type]||[]).forEach(f=>f({target,preventDefault(){}}));}
const btn=(act)=>({closest:s=>s==='[data-acc-act]'?btn(act):null,dataset:{accAct:act},getAttribute:()=>null});
async function boot(opts){const t=make(opts);t.c.CommonsAccount.mount();await tick();return t;}
'''

AVATAR_VISIBLE = r'''
(async()=>{
 const t=await boot();
 assert.ok(t.html.includes('data-acc-avatar-file'),'file input shown to a member who can upload avatars');
 assert.ok(t.html.includes('换头像'));
 assert.ok(!t.html.includes('data-acc-act="avatar-clear"'),'nothing to remove yet');
 const locked=await boot({caps:[]});
 assert.ok(!locked.html.includes('data-acc-avatar-file'));
 assert.ok(locked.html.includes('你现在还不能换头像'));
 const has=await boot({avatarRef:'av-1'});
 assert.ok(has.html.includes('data-acc-act="avatar-clear"'),'remove button when there is an avatar');
 assert.ok(has.calls.some(c=>c[0]==='GET'&&c[1]==='/media/assets/av-1'),'avatar_ref is resolved through the assets route');
 assert.ok(has.html.includes('/api/media/f/'+'e'.repeat(64)+'.webp'),'face uses the 128 size');
 console.log('_PASS avatar-visible');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

AVATAR_FLOW = r'''
(async()=>{
 const t=await boot();
 const input={files:[{name:'me.png',size:10,type:'image/png'}],value:'x',closest:s=>s==='[data-acc-avatar-file]'?input:null};
 fire(t,'change',input);
 await tick();
 assert.equal(t.uploads.length,1);assert.equal(t.uploads[0].o.purpose,'avatar');
 const put=t.calls.find(c=>c[0]==='PUT');
 same([put[1],put[2]],['/account/avatar',{asset_id:'av-1'}]);
 assert.ok(put[3],'avatar write carries an idempotency key');
 assert.ok(t.html.includes('头像换好了'));
 assert.ok(t.html.includes('/api/media/f/'+'e'.repeat(64)+'.webp'));
 // 第二次：PUT 先失败一次，重试复用同一个幂等键
 const u=await boot({putFailsOnce:true});
 const input2={files:[{name:'me.png',size:10,type:'image/png'}],value:'x',closest:s=>s==='[data-acc-avatar-file]'?input2:null};
 fire(u,'change',input2);await tick();
 assert.ok(u.html.includes('data-acc-act="avatar-retry"'),'retry offered after a failed write');
 fire(u,'click',btn('avatar-retry'));await tick();
 const puts=u.calls.filter(c=>c[0]==='PUT');
 assert.equal(puts.length,2);assert.equal(puts[0][3],puts[1][3],'same idempotency key on retry');
 assert.ok(u.html.includes('头像换好了'));
 console.log('_PASS avatar-flow');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

AVATAR_UPLOAD_FAILS = r'''
(async()=>{
 const t=await boot({uploadFails:true});
 const input={files:[{name:'me.png',size:10,type:'image/png'}],value:'x',closest:s=>s==='[data-acc-avatar-file]'?input:null};
 fire(t,'change',input);await tick();
 assert.ok(t.html.includes('网络断了'),'upload message shown');
 assert.ok(t.html.includes('data-acc-act="avatar-retry"'));
 assert.ok(!t.calls.some(c=>c[0]==='PUT'),'nothing committed when the upload failed');
 fire(t,'click',btn('avatar-retry'));await tick();
 assert.ok(t.calls.some(c=>c[0]==='PUT'&&c[2].asset_id==='av-1'),'retry upload then commit');
 console.log('_PASS avatar-upload-fails');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

RANKING = r'''
(async()=>{
 const t=await boot();
 const sw=h=>/data-acc-act="ranking" role="switch" aria-checked="(true|false)"/.exec(h)[1];
 assert.equal(sw(t.html),'true','default: not opted out, shown as on');
 assert.ok(t.html.includes('全站榜单现在还没公开'),'note explains the site-wide flag is off');
 assert.ok(!/data-acc-act="ranking"[^>]*disabled/.test(t.html),'switch is usable');
 fire(t,'click',btn('ranking'));await tick();
 const post=t.calls.find(c=>c[0]==='POST'&&c[1]==='/growth/optout');
 same(post[2],{optout:true});assert.ok(post[3],'idempotency key');
 assert.equal(sw(t.html),'false');assert.ok(t.html.includes('已退出公开排名'));
 fire(t,'click',btn('ranking'));await tick();
 const posts=t.calls.filter(c=>c[0]==='POST'&&c[1]==='/growth/optout');
 same(posts[1][2],{optout:false});assert.equal(sw(t.html),'true');
 // 总开关已开：文案变
 const on=await boot({publicOn:true});
 assert.ok(on.html.includes('你会出现在公开赛季榜上'));
 // 失败：开关回到原状
 const bad=await boot({optoutFails:true});
 fire(bad,'click',btn('ranking'));await tick();
 assert.equal(sw(bad.html),'true');assert.ok(bad.html.includes('排名设置没有改成')||bad.html.includes('没有连上'));
 // 成长模块没开：开关禁用并说明
 const off=await boot({noGrowth:true});
 assert.ok(/data-acc-act="ranking"[^>]*disabled/.test(off.html));assert.ok(off.html.includes('排名设置暂未开放'));
 console.log('_PASS ranking');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

MARKET = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const tick=async(n=30)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
const SRC=fs.readFileSync(root+'/preview/market.js','utf8');
// 与 preview/api.js CommonsSession.reason 的 level 句一致。这条原因不在时返回空串。
function reasonText(me,action){
  const why=me&&me.capability_reasons&&me.capability_reasons[action];
  if(!why||why.reason!=='level')return '';
  return '需要 L'+why.min_level+'（你现在是 L'+why.level+'）';
}
function make(opts){
  opts=opts||{};
  const handlers={};const calls=[];const toasts=[];let html='';let keyN=0;
  const err=(status,code,message)=>Object.assign(new Error(message),{status,code});
  const img=(n)=>({id:'asset-'+n,image:{src:'/api/media/f/'+String(n).repeat(64)+'.webp'}});
  const denied=opts.canUpload===false;
  const reasons=Object.prototype.hasOwnProperty.call(opts,'reasons')?(opts.reasons||{}):(denied?{'upload.create':{reason:'level',min_level:2,level:1}}:{});
  const me={id:'me',display_name:'我',handle:'me',level:denied?1:2,capabilities:denied?[]:['upload.create'],capability_reasons:reasons};
  const api={mode:'live',newIdempotencyKey:()=>'idem-key-'+(++keyN),
    get(path){calls.push(['GET',path]);
      if(path==='/api/me'||path==='/me')return Promise.resolve({data:me});
      if(path==='/market/meta')return Promise.resolve({data:{people:[],categories:[{id:'sell',label:'出售',fields:['price'],required:[]}],field_labels:{},status_labels:{},report_reasons:[]}});
      if(path==='/market/listings')return Promise.resolve({data:[{id:'l1',category:'sell',title:'带图',status:'active',author:{id:'p1',display_name:'卖家',level:2},images:[img(1),img(2)],created_at:'2026-10-28T00:00:00Z'},{id:'l2',category:'sell',title:'无图',status:'active',author:{id:'p1',display_name:'卖家',level:2},images:[],created_at:'2026-10-27T00:00:00Z'}]});
      return Promise.reject(err(404,'resource_not_found','x'));},
    post(path,body,o){calls.push(['POST',path,body,o&&o.idempotencyKey]);return Promise.resolve({data:{id:'new-1'}});}};
  const rootEl={querySelector:()=>null,querySelectorAll:()=>[],set innerHTML(v){html=String(v)},get innerHTML(){return html}};
  const uploads=[];
  const c={console,Promise,Object,String,Number,Array,Math,JSON,Date,Error,setTimeout,clearTimeout,URL,Set,Map,
    location:{protocol:'https:',hash:'#/market'},
    document:{querySelector:s=>s==='[data-mt-root]'?rootEl:null,addEventListener(t,f){(handlers[t]??=[]).push(f)},removeEventListener(){}},
    matchMedia:()=>({matches:false}),
    Commons:{toast:m=>toasts.push(m),read:(k,f)=>f,write:()=>true,refresh(){},go(){},esc:s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),safeUrl:s=>String(s||'#'),icon:()=>''},
    CommonsAPI:api,CommonsSession:{can:a=>opts.canUpload!==false},
    CommonsMedia:{upload:(file,o)=>{uploads.push(file);if(file.name.startsWith('bad'))return Promise.reject(Object.assign(new Error('这个文件不是能用的图片'),{retry:null}));
      const n=uploads.length;if(o&&o.onProgress)o.onProgress({ratio:0.5,phase:'upload'});
      return Promise.resolve({id:'asset-'+n,url:'/api/media/f/'+String(n).repeat(64)+'.webp'});}}};
  c.window=c;c.self=c;c.globalThis=c;c.COMMONS_BUILD={mode:'live'};
  vm.createContext(c);vm.runInContext(SRC,c);
  return {c,calls,handlers,toasts,uploads,me,get html(){return html}};
}
'''

MARKET_UPLOAD = MARKET + r'''
(async()=>{
 const t=make();
 t.c.CommonsMarket.mount();await tick();
 // 卡片：接口的 images 变成 imageUrls
 const cards=t.c.CommonsMarket.routes.market();
 assert.ok(cards.includes('/api/media/f/'+'1'.repeat(64)+'.webp'),'listing card shows the first uploaded photo');
 assert.ok(!cards.includes('线上暂不能带图'));
 console.log('_PASS market-cards');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

MARKET_PUBLISH = MARKET + r"""
(async()=>{
 const t=make();
 t.c.FormData=function(form){this.has=k=>k in form.values;this.get=k=>form.values[k];};
 const form={values:{title:'二手显卡',body:'自用',price:'¥100',category:'sell'},reportValidity:()=>true,querySelector:s=>s==='[data-mt-confirm]'?{checked:true}:null,querySelectorAll:()=>[]};
 t.c.document.querySelector=s=>s==='[data-mt-root]'?{querySelector:q=>q==='[data-mt-form="new"]'?form:null,querySelectorAll:()=>[],set innerHTML(v){},get innerHTML(){return ''}}:null;
 t.c.CommonsMarket.mount();await tick();
 const fire=(type,e)=>(t.handlers[type]||[]).forEach(f=>f(e));
 const click=(act,attrs)=>fire('click',{target:{closest:s=>s==='[data-mt-act]'?btn(act,attrs):null},preventDefault(){}});
 const btn=(act,attrs)=>({getAttribute:k=>k==='data-mt-act'?act:(attrs&&attrs[k])||null});
 click('category',{'data-category':'sell'});
 const files=['a.png','b.png','bad.svg'].map(n=>({name:n,size:10,type:'image/png'}));
 const input={files,value:'x',matches:s=>s==='[data-mt-photos]'};
 fire('change',{target:input});
 await tick();
 assert.equal(t.uploads.length,3,'files go through CommonsMedia.upload one by one');
 fire('submit',{target:{closest:s=>s==='[data-mt-report-form]'?null:(s==='[data-mt-form="new"]'?form:null)},preventDefault(){}});  // step 2 -> 3
 await tick();
 // 有一张失败：不能发布
 fire('submit',{target:{closest:s=>s==='[data-mt-report-form]'?null:(s==='[data-mt-form="new"]'?form:null)},preventDefault(){}});
 await tick();
 assert.ok(!t.calls.some(c=>c[0]==='POST'),'a failed photo blocks publishing');
 assert.ok(t.toasts.some(m=>/没传上去/.test(m)));
 // 移除失败的那张后发布，带上两个资产号
 click('remove-photo',{'data-index':'2'});
 fire('submit',{target:{closest:s=>s==='[data-mt-report-form]'?null:(s==='[data-mt-form="new"]'?form:null)},preventDefault(){}});
 await tick();
 const post=t.calls.find(c=>c[0]==='POST'&&c[1]==='/market/listings');
 assert.ok(post,'published');
 assert.equal(JSON.stringify(post[2].images),JSON.stringify(['asset-1','asset-2']));
 assert.ok(post[3],'idempotency key');
 console.log('_PASS market-publish');
})().catch(e=>{console.error(e);process.exitCode=1});
"""

MARKET_CAN = MARKET + r'''
(async()=>{
 const t=make({canUpload:false});
 const me=(await t.c.CommonsAPI.get('/api/me')).data;
 const why=me.capability_reasons['upload.create'];
 assert.deepEqual(why,{reason:'level',min_level:2,level:1});
 t.c.CommonsSession.reason=action=>reasonText(me,action);
 assert.equal(t.c.CommonsSession.reason('upload.create'),'需要 L2（你现在是 L1）');
 t.c.CommonsMarket.mount();await tick();
 const input={files:[{name:'a.png',size:10,type:'image/png'}],value:'x'};
 (t.handlers.change||[]).forEach(f=>f({target:{matches:s=>s==='[data-mt-photos]',files:input.files,get value(){return input.value},set value(v){input.value=v}}}));
 await tick();
 assert.equal(t.uploads.length,0,'no upload when the member cannot upload');
 assert.ok(t.toasts.includes('需要 L2（你现在是 L1）'));
 console.log('_PASS market-can');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

MARKET_CAN_BARE = MARKET + r'''
(async()=>{
 const t=make({canUpload:false,reasons:{}});
 const me=(await t.c.CommonsAPI.get('/api/me')).data;
 assert.equal(me.capability_reasons['upload.create'],undefined);
 t.c.CommonsSession.reason=action=>reasonText(me,action);
 assert.equal(t.c.CommonsSession.reason('upload.create'),'');
 t.c.CommonsMarket.mount();await tick();
 const input={files:[{name:'a.png',size:10,type:'image/png'}],value:'x'};
 (t.handlers.change||[]).forEach(f=>f({target:{matches:s=>s==='[data-mt-photos]',files:input.files,get value(){return input.value},set value(v){input.value=v}}}));
 await tick();
 assert.equal(t.uploads.length,0,'no upload when the member cannot upload');
 assert.ok(t.toasts.includes('你现在还不能上传图片。'));
 assert.ok(t.toasts.every(m=>!/L\d/.test(String(m))));
 console.log('_PASS market-can-noreason');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

EDITOR = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const SRC=fs.readFileSync(root+'/preview/editor.js','utf8');
let html='';
const host={appendChild(){return this},set innerHTML(v){html=String(v)},get innerHTML(){return html},
  querySelector(){const n={style:{},hidden:false,className:'',innerHTML:'',value:'',textContent:'',scrollHeight:24,addEventListener(){},querySelector(){return n},querySelectorAll:()=>[],classList:{add(){},remove(){},toggle(){}},contains(){return true}};return n}};
const ev=()=>({addEventListener(){},removeEventListener(){}});
const c=Object.assign(ev(),{console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,AbortController,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},
  fetch:()=>Promise.reject(Error('no')),location:{protocol:'https:',hash:'#/write'},matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}})});
c.document=Object.assign(ev(),{activeElement:null,getElementById:()=>null,querySelector:s=>s==='[data-edt-page="write"] [data-edt-host]'?host:(s==='[data-edt-page="write"]'?ev():null),querySelectorAll:()=>[],createElement:()=>({innerHTML:'',classList:{add(){}},setAttribute(){}}),head:{appendChild(){}},body:{classList:{add(){},remove(){}}}});
c.Commons={read:(k,f)=>f,write:()=>true,toast(){},refresh(){},go(){},icon:()=>'',esc:s=>String(s),safeUrl:s=>String(s||'#')};
c.CommonsAPI={mode:'live',get:()=>Promise.reject(Object.assign(Error('x'),{status:404})),post:()=>Promise.resolve({data:{}}),newIdempotencyKey:()=>'idem-key-1'};
c.COMMONS_BUILD={mode:'live'};
c.CommonsSession={me:{id:'me',display_name:'我',handle:'me',level:2},can:()=>true};
c.CommonsReader={esc:s=>String(s==null?'':s),levels:{2:'熟手'},visibility:()=>({who:'',label:''}),safeImage:s=>/^\/api\/media\/f\//.test(String(s))?String(s):''};
c.window=c;c.self=c;c.globalThis=c;vm.createContext(c);vm.runInContext(SRC,c);
(async()=>{
 c.CommonsEditorPage.mount();await new Promise(r=>setImmediate(r));
 assert.ok(html.includes('data-edt-act="insert-image"'),'live toolbar has the image button');
 assert.ok(html.includes('data-edt-img-input'),'hidden multi-file input');
 assert.ok(/data-edt-img-input[^>]*multiple|multiple[^>]*data-edt-img-input/.test(html));
 assert.ok(html.includes('data-edt-uploads'),'status region for uploads');
 assert.ok(html.includes('粘贴或拖入图片'),'hint mentions paste and drop');
 assert.ok(!/image\/svg/.test(html.split('data-edt-img-input')[0].slice(-200)),'svg not offered');
 console.log('_PASS editor-live-markup');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


def run_node(script: str) -> str:
    done = subprocess.run(['node', '-e', script, str(ROOT)], capture_output=True, text=True, timeout=60)
    if done.returncode != 0:
        raise AssertionError((done.stdout + done.stderr)[-3000:])
    return done.stdout


class AccountWiringTest(unittest.TestCase):
    def test_avatar_controls_follow_capabilities(self):
        self.assertIn('_PASS avatar-visible', run_node(ACCOUNT + AVATAR_VISIBLE))

    def test_avatar_upload_then_commit_with_retry_reusing_key(self):
        self.assertIn('_PASS avatar-flow', run_node(ACCOUNT + AVATAR_FLOW))

    def test_avatar_upload_failure_is_retryable_and_commits_nothing(self):
        self.assertIn('_PASS avatar-upload-fails', run_node(ACCOUNT + AVATAR_UPLOAD_FAILS))

    def test_ranking_switch_reads_and_writes_optout(self):
        self.assertIn('_PASS ranking', run_node(ACCOUNT + RANKING))


class MarketWiringTest(unittest.TestCase):
    def test_cards_use_uploaded_photo_urls(self):
        self.assertIn('_PASS market-cards', run_node(MARKET_UPLOAD))

    def test_publish_sends_asset_ids_and_is_blocked_by_failed_photo(self):
        self.assertIn('_PASS market-publish', run_node(MARKET_PUBLISH))

    def test_member_who_cannot_upload_is_told_why(self):
        self.assertIn('_PASS market-can', run_node(MARKET_CAN))

    def test_member_without_a_reason_is_not_told_a_level(self):
        self.assertIn('_PASS market-can-noreason', run_node(MARKET_CAN_BARE))


class EditorWiringTest(unittest.TestCase):
    def test_live_markup_has_image_entry_points(self):
        self.assertIn('_PASS editor-live-markup', run_node(EDITOR))

"""LG-6B R11 · 举报通用接口、put/del、市集选图、真实模式示例标签。"""
from __future__ import annotations

import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PREVIEW = ROOT / 'preview'

OWNED = [
    'market.js', 'bounty.js', 'thread.js', 'agentchat.js', 'library.js', 'tools.js',
    'kb.js', 'hot.js', 'editor.js', 'social.js', 'dm.js', 'notify.js', 'orgs.js',
    'people.js', 'buddies.js', 'contributions.js', 'connect.js', 'avatar.js',
    'invite.js', 'announce.js', 'account.js',
]
PILL = re.compile(
    r'<span class="(?:pill(?: outline)?|sample-badge|mt-sample|chip|inv-badge|'
    r'announce-sample|bty-demo|soc-sample)[^"]*">(?:示例|本机[^<]*)',
)
REPORT_BTN = re.compile(r'>举报<')

COMMON = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const source=name=>fs.readFileSync(root+'/preview/'+name+'.js','utf8');
const tick=async(n=16)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
function eventTarget(){const events={};return {events,addEventListener(k,f){(events[k]??=new Set()).add(f)},removeEventListener(k,f){events[k]?.delete(f)},dispatchEvent(type,ev){(events[type]||[]).forEach(f=>f(ev))}}}
function context(mode){
  const posts=[],writes=[],toasts=[];
  const store={};
  const rootNode={innerHTML:'',nodeType:1,setAttribute(){},closest(){return null},querySelector:()=>null,querySelectorAll:()=>[],contains(){return true}};
  const c=Object.assign(eventTarget(),{
    console,URL,URLSearchParams,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,
    AbortController,setTimeout,clearTimeout,fetch:()=>Promise.reject(Error('no fetch')),
    location:{protocol:'https:',hash:'#/threads/t1',replace(){},assign(){}},
    matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}}),
    posts,writes,toasts,rootNode,store
  });
  c.document=Object.assign(eventTarget(),{
    activeElement:null,
    querySelector:s=>/data-notify-root|data-notify-bell|data-th-root/.test(s)?rootNode:null,
    querySelectorAll:()=>[],
    body:{classList:{add(){},remove(){},toggle(){}}}
  });
  c.Commons={
    read:(k,fb)=>k in store?store[k]:fb,write:(k,v)=>{store[k]=v;writes.push({k,v});return true;},
    toast:m=>toasts.push(m),refresh(){},go(r){c.location.hash='#/'+r;},icon:()=>'',esc:s=>String(s),safeUrl:s=>String(s||'#')
  };
  const routes={};
  const record=(method,path,body,opts)=>{posts.push({method,path,body:body||{},opts:opts||{}});const r=routes[method+' '+path];if(r===undefined)return Promise.resolve({data:{id:'new-1'}});if(typeof r==='function')return r(body,opts);return r;};
  c.CommonsAPI={
    mode,
    get(path){const r=routes[path];return r===undefined?Promise.reject(Object.assign(Error('no '+path),{status:404})):Promise.resolve({data:typeof r==='function'?r():r,meta:{}});},
    post(path,body,opts){return record('POST',path,body,opts);},
    patch(path,body,opts){return record('PATCH',path,body,opts);},
    put(path,body,opts){return record('PUT',path,body,opts);},
    del(path,body,opts){return record('DELETE',path,body,opts);},
    newIdempotencyKey:()=>'idem-1'
  };
  c.COMMONS_BUILD={mode};
  c.routes=routes;
  c.window=c;c.self=c;
  vm.createContext(c);
  return c;
}
'''

THREAD = r'''
(async()=>{
 const host={nodeType:1,innerHTML:'',setAttribute(){},closest(){return null},querySelector:()=>null,querySelectorAll:()=>[],contains(){return true}};
 const c=context('live');
 vm.runInContext(source('thread'),c);
 const msg={id:'m1',authorId:'p2',body:'hello',createdAt:'2026-01-01T00:00:00.000Z',status:'ok'};
 c.CommonsThread.mount(host,{targetId:'t1',messages:[msg],me:{id:'me',name:'我',level:1},people:[{id:'p2',name:'他'}]});
 const btn={getAttribute:n=>n==='data-th-act'?'report':'',dataset:{id:'m1'},closest(s){return s==='[data-th-act]'?this:null}};
 c.document.dispatchEvent('click',{target:btn,preventDefault(){}});
 await tick();
 assert.equal(c.posts.length,1,'report posts once');
 assert.equal(c.posts[0].method,'POST');
 assert.equal(c.posts[0].path,'/governance/reports');
 assert.deepEqual(c.posts[0].body,{target_id:'m1',reason_code:'other',note:''});
 assert.ok(c.posts[0].opts.idempotencyKey);
 assert.ok(c.toasts.includes('已提交举报。'));
 const saveWrites=c.writes.filter(w=>w.k==='thread.saved');
 const saveBtn={getAttribute:n=>n==='data-th-act'?'save':'',dataset:{id:'m1'},closest(s){return s==='[data-th-act]'?this:null}};
 c.document.dispatchEvent('click',{target:saveBtn,preventDefault(){}});
 await tick();
 const save=c.posts.find(p=>p.path==='/content/objects/m1/save');
 assert.ok(save,'save uses content save');
 assert.equal(save.method,'PUT');
 assert.ok(save.opts.idempotencyKey);
 assert.ok(c.writes.some(w=>w.k==='thread.saved'),'save keeps local toggle');
 c.document.dispatchEvent('click',{target:saveBtn,preventDefault(){}});
 await tick();
 const unsaves=c.posts.filter(p=>p.path==='/content/objects/m1/save');
 assert.equal(unsaves.length,2);
 assert.equal(unsaves[1].method,'DELETE');
 const f=context('live');
 const fhost={nodeType:1,innerHTML:'',setAttribute(){},closest(){return null},querySelector:()=>null,querySelectorAll:()=>[],contains(){return true}};
 f.routes['POST /governance/reports']=()=>Promise.reject(Object.assign(Error('网络连接失败，请稍后再试'),{status:0,code:'network_error'}));
 vm.runInContext(source('thread'),f);
 f.CommonsThread.mount(fhost,{targetId:'t1',messages:[msg],me:{id:'me',name:'我',level:1},people:[{id:'p2',name:'他'}]});
 const fbtn={getAttribute:n=>n==='data-th-act'?'report':'',dataset:{id:'m1'},closest(s){return s==='[data-th-act]'?this:null}};
 f.document.dispatchEvent('click',{target:fbtn,preventDefault(){}});
 await tick();
 assert.ok(f.toasts.some(t=>String(t).includes('没有提交')||String(t).includes('网络')),'fail toasts');
 assert.ok(!f.toasts.includes('已提交举报。'),'fail is not fake success');
 const d=context('demo');
 const dhost={nodeType:1,innerHTML:'',setAttribute(){},closest(){return null},querySelector:()=>null,querySelectorAll:()=>[],contains(){return true}};
 vm.runInContext(source('thread'),d);
 d.CommonsThread.mount(dhost,{targetId:'t1',messages:[msg],me:{id:'me',name:'我',level:1},people:[{id:'p2',name:'他'}]});
 const dbtn={getAttribute:n=>n==='data-th-act'?'report':'',dataset:{id:'m1'},closest(s){return s==='[data-th-act]'?this:null}};
 d.document.dispatchEvent('click',{target:dbtn,preventDefault(){}});
 await tick();
 assert.equal(d.posts.length,0,'demo does not post report');
 assert.ok(d.toasts.includes('已提交举报。'));
 console.log('THREAD_PASS report put/del save, fail no fake success, demo local');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

NOTIFY = r'''
(async()=>{
 const prefs={categories:{reply:true},quiet_start:null,quiet_end:null,timezone_offset_min:0,daily_digest:true};
 const c=context('live');
 c.routes['/notify/notifications']=[];
 c.routes['/notify/preferences']=prefs;
 vm.runInContext(source('notify'),c);
 c.CommonsNotify.mount();
 await tick();
 c.document.dispatchEvent('change',{target:{dataset:{notifyPref:'reply'},checked:false}});
 await tick();
 const put=c.posts.find(p=>p.method==='PUT'&&p.path==='/notify/preferences');
 assert.ok(put,'prefs put once');
 assert.equal(put.body.categories.reply,false);
 assert.ok(put.opts.idempotencyKey);
 assert.equal(c.writes.length,0,'prefs does not Commons.write');
 const f=context('live');
 f.routes['/notify/notifications']=[];
 f.routes['/notify/preferences']=JSON.parse(JSON.stringify(prefs));
 f.routes['PUT /notify/preferences']=()=>Promise.reject(Object.assign(Error('偏好没有保存。'),{status:500}));
 vm.runInContext(source('notify'),f);
 f.CommonsNotify.mount();
 await tick();
 f.document.dispatchEvent('change',{target:{dataset:{notifyPref:'reply'},checked:false}});
 await tick();
 assert.ok(f.toasts.some(t=>String(t).includes('没有保存')),'fail toasts');
 console.log('NOTIFY_PASS put preferences, fail rollback toast');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


class Lg6bR11Patches(unittest.TestCase):
    def test_thread_report_uses_governance_and_commons_put_del(self):
        thread = (PREVIEW / 'thread.js').read_text(encoding='utf-8')
        self.assertIn("post('/governance/reports'", thread)
        self.assertIn('target_id:', thread)
        self.assertIn("reason_code: 'other'", thread)
        self.assertIn("CommonsAPI.put(savePath", thread)
        self.assertIn("CommonsAPI.del(savePath", thread)
        self.assertNotIn("fetch('/api/content/objects/", thread)
        self.assertNotIn("act === 'report' ? '这个功能还没开放'", thread)
        notify = (PREVIEW / 'notify.js').read_text(encoding='utf-8')
        self.assertIn("put('/notify/preferences'", notify)
        self.assertNotIn("fetch('/api/notify/preferences'", notify)
        dm = (PREVIEW / 'dm.js').read_text(encoding='utf-8')
        self.assertIn("CommonsAPI.put('/dm/settings'", dm)
        self.assertIn("CommonsAPI.put('/dm/threads/'", dm)
        self.assertNotIn('function put(path, body)', dm)
        self.assertNotIn("fetch('/api' + path", dm)

    def test_market_live_photo_picker_uploads_through_media(self):
        """R17-A：线上能带图。选择器只在 live 走 CommonsMedia.upload，发布只带上传完成的资产号；示例模式仍读本机 dataURL。"""
        text = (PREVIEW / 'market.js').read_text(encoding='utf-8')
        self.assertNotIn('线上暂不能带图', text)
        field = text.split('function fieldStep()')[1].split('function confirmStep()')[0]
        self.assertIn('data-mt-photo-grid', field)
        grid = text.split('function photoGridHTML()')[1].split('function fieldStep()')[0]
        self.assertIn('data-mt-photos', grid)
        self.assertIn("image/png,image/jpeg,image/webp,image/gif,image/avif", grid)
        self.assertNotIn('image/svg', grid)
        files = text.split('function handleFiles(input)')[1].split('function onClick')[0]
        self.assertIn('if (isLive()) { handleLiveFiles(input); return; }', files)
        self.assertIn('reader.readAsDataURL(file)', files)  # 示例模式的读法没动
        live_files = text.split('function startPhoto(')[1].split('function handleFiles(input)')[0]
        self.assertIn("M.upload(photo.file, { purpose: 'image'", live_files)
        self.assertIn("can('upload.create')", live_files)
        live_pub = text.split('function publish(form)')[1].split('function handleWant')[0].split('const today')[0]
        self.assertIn("photo.state === 'busy'", live_pub)
        self.assertIn("photo.state === 'failed'", live_pub)
        self.assertIn('payload.images = imageIds', live_pub)
        self.assertNotIn('dataURL', live_pub)
        self.assertNotIn('photo.data', live_pub)  # 本机 dataURL 不会进线上请求

    def test_owned_live_sample_pills_are_gated(self):
        unguarded = []
        for name in OWNED:
            text = (PREVIEW / name).read_text(encoding='utf-8')
            for match in PILL.finditer(text):
                start = max(0, match.start() - 80)
                window = text[start:match.end()]
                if 'isLive()' in window or 'live()' in window or 'data.demo' in window or 'data && data.demo' in window:
                    continue
                if "opts.sample !== false" in window:
                    continue
                line = text.count('\n', 0, match.start()) + 1
                unguarded.append(f'{name}:{line}:{match.group(0)}')
        self.assertEqual(unguarded, [])

    def test_object_report_buttons_only_thread_needs_generic(self):
        hits = {}
        for name in OWNED:
            text = (PREVIEW / name).read_text(encoding='utf-8')
            found = REPORT_BTN.findall(text)
            if found:
                hits[name] = len(found)
        # R17-H4：buddies.js 也有举报，走自己的 /social/buddies/{id}/report，不走通用举报
        self.assertEqual(set(hits), {'market.js', 'dm.js', 'thread.js', 'agentchat.js', 'buddies.js'})
        buddies = (PREVIEW / 'buddies.js').read_text(encoding='utf-8')
        self.assertIn('/report', buddies)
        self.assertNotIn('/governance/reports', buddies)
        self.assertIn("post('/governance/reports'", (PREVIEW / 'thread.js').read_text(encoding='utf-8'))
        # agentchat 有自己的举报：走 /agentchat/messages/{id}/report，不走通用举报
        agentchat = (PREVIEW / 'agentchat.js').read_text(encoding='utf-8')
        self.assertIn("'/report'", agentchat)
        self.assertIn('/agentchat/messages/', agentchat)
        self.assertNotIn('/governance/reports', agentchat)
        market = (PREVIEW / 'market.js').read_text(encoding='utf-8')
        self.assertIn("'/report'", market)
        dm = (PREVIEW / 'dm.js').read_text(encoding='utf-8')
        self.assertIn("'/report'", dm)

    def run_node(self, script):
        result = subprocess.run(['node', '-e', COMMON + script, str(ROOT)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn('_PASS ', result.stdout)

    def test_thread_report_and_save_vm(self):
        self.run_node(THREAD)

    def test_notify_prefs_put_vm(self):
        self.run_node(NOTIFY)

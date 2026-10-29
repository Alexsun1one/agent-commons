"""R17-A · CommonsMedia.upload 的离线 VM 测试。

假后端的返回值照真实路由写（见 test_r17a_media_wiring.py）：创建 201 → data.id/chunks；
PUT 分块 → data.received；complete 202 → data.state='processing'；轮询 → data.state / data.asset.image；
额度 → data.file/avatar 的 daily_count/used_today/max_bytes。
"""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

COMMON = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const src=fs.readFileSync(root+'/preview/media.js','utf8');
const MB=1024*1024;
function fakeFile(bytes,name,type){
  const buf=new Uint8Array(bytes);for(let i=0;i<bytes;i++)buf[i]=(i*31+7)&255;
  return {name,type,size:bytes,arrayBuffer:()=>Promise.resolve(buf.buffer)};
}
function backend(opts){
  opts=opts||{};
  const calls=[],progress=[];
  const state={id:'u-1',received:{},polls:0,failChunk:opts.failChunk,failComplete:opts.failComplete,completed:false,created:0};
  const quota={data:{file:{daily_count:20,used_today:0,max_bytes:10*MB},avatar:{daily_count:5,used_today:0,max_bytes:5*MB},html_max_bytes:2*MB,chunk_bytes:MB}};
  if(opts.quota)Object.assign(quota.data.file,opts.quota);
  const err=(status,code,message,extra)=>Object.assign(new Error(message),{status,code,details:Object.assign({code,message},extra||{})});
  let keyN=0;
  const api={
    mode:'live',
    newIdempotencyKey:()=>'idem-key-'+(++keyN),
    get(path){
      calls.push({m:'GET',path});
      if(path==='/media/quota')return Promise.resolve(quota);
      if(path==='/media/uploads/u-1'){
        state.polls++;
        if(opts.rejectOnPoll)return Promise.resolve({data:{id:'u-1',state:'rejected',reason:opts.rejectOnPoll,message:'服务端原文'}});
        if(state.polls<(opts.pollsBefore||2))return Promise.resolve({data:{id:'u-1',state:'processing',purpose:'image'}});
        return Promise.resolve({data:{id:'u-1',state:'ready',purpose:'image',asset:{id:'a-1',purpose:'image',
          image:{src:'/api/media/f/'+'a'.repeat(64)+'.webp',full:'/api/media/f/'+'b'.repeat(64)+'.webp',width:1200,height:800,srcset:''},
          sizes:{'128':'/api/media/f/'+'c'.repeat(64)+'.webp'}}}});
      }
      return Promise.reject(err(404,'resource_not_found','x'));
    },
    post(path,body,o){
      calls.push({m:'POST',path,body,key:o&&o.idempotencyKey});
      if(path==='/media/uploads'){
        if(opts.createError)return Promise.reject(opts.createError(err));
        state.created++;
        return Promise.resolve({data:{id:'u-1',purpose:body.purpose,state:'receiving',size:body.size,chunks:Math.max(1,Math.ceil(body.size/MB))}});
      }
      if(path==='/media/uploads/u-1/complete'){
        if(state.failComplete&&!state.completed){state.completed=true;return Promise.reject(err(0,'network_error','网络连接失败，请稍后再试'));}
        if(state.completed&&opts.completeConflict)return Promise.reject(err(409,'state_conflict','这个上传已经提交'));
        state.completed=true;
        return Promise.resolve({data:{id:'u-1',state:'processing'}});
      }
      return Promise.reject(err(404,'resource_not_found','x'));
    },
    put(path,body,o){
      calls.push({m:'PUT',path,bytes:Buffer.from(body.data,'base64').length,key:o&&o.idempotencyKey});
      const idx=Number(path.split('/').pop());
      if(state.failChunk===idx){state.failChunk=undefined;return Promise.reject(err(0,'network_error','网络连接失败，请稍后再试'));}
      state.received[idx]=1;
      return Promise.resolve({data:{id:'u-1',state:'receiving',received:Object.keys(state.received).length}});
    }
  };
  return {api,calls,progress,state};
}
function load(b){
  const c={console,Promise,Object,String,Number,Array,Math,JSON,Date,Uint8Array,Error,setTimeout,clearTimeout,
    location:{protocol:'https:',hash:'#/'},btoa:s=>Buffer.from(s,'binary').toString('base64'),crypto:globalThis.crypto,
    document:{readyState:'complete',querySelectorAll:()=>[],body:{appendChild(){}},head:{appendChild(){}},createElement:()=>({style:{},setAttribute(){}})},
    matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){},removeEventListener(){}};
  c.window=c;c.self=c;c.globalThis=c;c.CommonsAPI=b.api;c.COMMONS_BUILD={mode:'live'};
  vm.createContext(c);vm.runInContext(src,c);
  return c;
}
'''

HAPPY = r'''
(async()=>{
 const b=backend();const c=load(b);
 const seen=[];
 const res=await c.CommonsMedia.upload(fakeFile(2*MB+300000,'photo.png','image/png'),{purpose:'image',onProgress:p=>seen.push(p)});
 assert.equal(res.id,'a-1');
 assert.match(res.url,/^\/api\/media\/f\/a{64}\.webp$/);
 assert.equal(res.width,1200);assert.equal(res.height,800);
 const order=b.calls.map(x=>x.m+' '+x.path.replace('/media/uploads/u-1','/U'));
 assert.deepStrictEqual(order.slice(0,6),['GET /media/quota','POST /media/uploads','PUT /U/chunks/0','PUT /U/chunks/1','PUT /U/chunks/2','POST /U/complete']);
 assert.ok(order.slice(6).every(x=>x==='GET /U'),'then polling only');
 assert.deepStrictEqual(b.calls.filter(x=>x.m==='PUT').map(x=>x.bytes),[MB,MB,300000]);
 const create=b.calls.find(x=>x.path==='/media/uploads');
 assert.equal(create.body.size,2*MB+300000);assert.equal(create.body.purpose,'image');assert.match(create.body.sha256,/^[0-9a-f]{64}$/);
 assert.ok(create.key&&/^[A-Za-z0-9_-]{8,128}$/.test(create.key),'idempotency key is header-safe');
 assert.ok(b.calls.filter(x=>x.m==='PUT'||x.path.endsWith('/complete')).every(x=>/^[A-Za-z0-9_-]{8,128}$/.test(x.key)));
 const ratios=seen.map(p=>p.ratio);
 assert.ok(ratios.every((r,i)=>i===0||r>=ratios[i-1]),'progress never goes backwards');
 assert.equal(ratios[ratios.length-1],1);assert.equal(seen[seen.length-1].phase,'done');
 assert.ok(seen.some(p=>p.phase==='upload'&&p.ratio>0&&p.ratio<=0.9));
 console.log('_PASS happy');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

RESUME = r'''
(async()=>{
 const b=backend({failChunk:1});const c=load(b);
 let err;
 try{await c.CommonsMedia.upload(fakeFile(3*MB,'a.png','image/png'),{purpose:'image'});}catch(e){err=e;}
 assert.ok(err,'first attempt fails');
 assert.match(err.message,/网络断了/);assert.equal(typeof err.retry,'function');
 assert.equal(b.state.created,1);
 const keyBefore=b.calls.find(x=>x.path==='/media/uploads').key;
 const res=await err.retry();
 assert.equal(res.id,'a-1');
 assert.equal(b.state.created,1,'retry does not create a second upload');
 assert.equal(b.calls.filter(x=>x.m==='PUT'&&x.path.endsWith('/chunks/0')).length,1,'chunk 0 not re-sent');
 assert.equal(b.calls.filter(x=>x.m==='PUT'&&x.path.endsWith('/chunks/1')).length,2,'failed chunk re-sent once');
 assert.equal(b.calls.filter(x=>x.path==='/media/uploads').length,1);
 assert.equal(b.calls.find(x=>x.path==='/media/uploads').key,keyBefore);
 console.log('_PASS resume');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

COMPLETE_LOST = r'''
(async()=>{
 const b=backend({failComplete:true,completeConflict:true});const c=load(b);
 let err;
 try{await c.CommonsMedia.upload(fakeFile(MB/2,'a.png','image/png'),{purpose:'image'});}catch(e){err=e;}
 assert.ok(err&&err.retry,'lost complete response is retryable');
 const res=await err.retry();
 assert.equal(res.id,'a-1','409 on second complete is treated as already submitted');
 console.log('_PASS complete-lost');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

LOCAL_CHECKS = r'''
(async()=>{
 async function fails(file,opts,re,why){
  const b=backend(opts&&opts.backend);const c=load(b);
  let err;try{await c.CommonsMedia.upload(file,{purpose:(opts&&opts.purpose)||'image'});}catch(e){err=e;}
  assert.ok(err,why+': rejected');assert.match(err.message,re,why+': '+err.message);
  assert.ok(!err.retry,why+': not retryable');
  assert.equal(b.calls.filter(x=>x.m!=='GET').length,0,why+': nothing was sent');
  return err;
 }
 await fails(fakeFile(1000,'x.svg','image/svg+xml'),null,/SVG/,'svg');
 await fails(fakeFile(1000,'x.pdf','application/pdf'),null,/不是能用的图片/,'type');
 await fails(fakeFile(11*MB,'big.png','image/png'),null,/超过了单个 10 MB 的上限/,'too big for the level');
 await fails(fakeFile(1000,'a.png','image/png'),{backend:{quota:{used_today:20}}},/今天的上传次数（20 个）已用完/,'daily count used up');
 await fails(fakeFile(1000,'a.png','image/png'),{backend:{quota:{daily_count:0,max_bytes:0}}},/等级还不能上传/,'level too low');
 await fails(fakeFile(70*MB,'huge.png','image/png'),null,/64 MB/,'hard cap');
 console.log('_PASS local-checks');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

SERVER_ERRORS = r'''
(async()=>{
 async function run(opts,re,retryable,why){
  const b=backend(opts);const c=load(b);
  let err;try{await c.CommonsMedia.upload(fakeFile(1000,'a.png','image/png'),{purpose:'image'});}catch(e){err=e;}
  assert.ok(err,why);assert.match(err.message,re,why+': '+err.message);
  assert.equal(typeof err.retry,retryable?'function':'object',why+' retry');
  return err;
 }
 await run({createError:e=>e(429,'rate_limited','今天的上传次数（20 个）已用完，明天再来',{retry_after_seconds:40000})},/今天的上传次数/,false,'daily quota from server');
 await run({createError:e=>e(429,'rate_limited','请求太频繁',{retry_after_seconds:5})},/稍等一会儿/,true,'burst limit is retryable');
 await run({createError:e=>e(403,'action_not_allowed','没有权限')},/等级还不能上传/,false,'level');
 await run({createError:e=>e(413,'payload_too_large','这个文件超过了单个 10 MB 的上限')},/这个文件超过了单个 10 MB/,false,'size from server');
 await run({createError:e=>e(501,'capability_unavailable','x')},/暂时没开放/,false,'flag off');
 await run({createError:e=>e(401,'session_expired','x')},/登录已过期/,false,'session');
 await run({createError:e=>e(500,'internal_error','boom')},/没成功，请重试/,true,'unknown is retryable');
 await run({rejectOnPoll:'svg_not_allowed'},/不收 SVG/,false,'async svg rejection');
 await run({rejectOnPoll:'too_many_pixels'},/像素太多/,false,'pixel bomb');
 await run({rejectOnPoll:'corrupt'},/打不开/,false,'corrupt');
 await run({rejectOnPoll:'abandoned'},/放了太久/,false,'abandoned');
 console.log('_PASS server-errors');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

ABORT_AND_DEMO = r'''
(async()=>{
 const b=backend();const c=load(b);
 const ac=new AbortController();ac.abort();
 let err;try{await c.CommonsMedia.upload(fakeFile(1000,'a.png','image/png'),{purpose:'image',signal:ac.signal});}catch(e){err=e;}
 assert.equal(err&&err.name,'AbortError');
 const d=backend();d.api.mode='demo';const c2=load(d);
 let e2;try{await c2.CommonsMedia.upload(fakeFile(1000,'a.png','image/png'),{purpose:'image'});}catch(e){e2=e;}
 assert.match(e2.message,/示例模式/);assert.equal(d.calls.length,0);
 console.log('_PASS abort-demo');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


def run_node(script: str) -> str:
    done = subprocess.run(['node', '-e', COMMON + script, str(ROOT)], capture_output=True, text=True, timeout=60)
    if done.returncode != 0:
        raise AssertionError((done.stdout + done.stderr)[-3000:])
    return done.stdout


class UploadHelperTest(unittest.TestCase):
    def test_happy_path_chunks_progress_and_result(self):
        self.assertIn('_PASS happy', run_node(HAPPY))

    def test_network_failure_then_retry_resumes_same_upload(self):
        self.assertIn('_PASS resume', run_node(RESUME))

    def test_lost_complete_response_is_not_a_failure(self):
        self.assertIn('_PASS complete-lost', run_node(COMPLETE_LOST))

    def test_local_checks_give_human_messages_without_network(self):
        self.assertIn('_PASS local-checks', run_node(LOCAL_CHECKS))

    def test_server_error_codes_map_to_human_messages(self):
        self.assertIn('_PASS server-errors', run_node(SERVER_ERRORS))

    def test_abort_and_demo_mode(self):
        self.assertIn('_PASS abort-demo', run_node(ABORT_AND_DEMO))

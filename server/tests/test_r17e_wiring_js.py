"""R17-E · library.js（收藏、只看收藏、翻页、评论）和 market.js（列表翻页、我的发布）的离线 VM 测试。

假返回值的形状来自 modules/library/tests/test_r17e_library.py 与 modules/market/router.py 里对真实路由的断言：
列表返回 {data:[…], meta:{next_cursor, …}}；收藏 PUT/DELETE /content/objects/{id}/save → data.saved；
市集 GET /market/listings?mine=true&limit=50&cursor=… 带 meta.next_cursor 和 meta.count。
"""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

LIBRARY = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const tick=async(n=30)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
const same=(a,b,m)=>assert.equal(JSON.stringify(a),JSON.stringify(b),m);
const SRC=fs.readFileSync(root+'/preview/library.js','utf8');
const raw=(i,type,status)=>({id:(type||'skill')+'-'+i,type:type||'skill',title:'条目'+i,category:'写作',status:status||'active',
  author:{id:'p1',display_name:'作者'},content:{purpose:'用途'+i,version:'1',skill_md:'# x'},usage:{count:0,useful_count:0,mine:null},saved:false,installs:[],examples:[]});
function make(opts){
  opts=opts||{};
  const handlers={};const calls=[];const toasts=[];const threads=[];let html='';let keyN=0;
  const err=(status,code,message)=>Object.assign(new Error(message),{status,code});
  const first=[];for(let i=1;i<=50;i++)first.push(raw(i,'skill',i===2&&opts.pendingSecond?'pending_review':'active'));
  const second=[];for(let i=51;i<=57;i++)second.push(raw(i));
  const api={mode:'live',newIdempotencyKey:()=>'idem-key-'+(++keyN),
    get(path,query){calls.push(['GET',path,query]);
      if(path==='/library/items'){
        query=query||{};
        if(query.saved==='true')return Promise.resolve({data:[Object.assign(raw(2),{saved:true})],meta:{next_cursor:opts.savedCursor||null}});
        if(query.type==='skill'){
          if(query.cursor==='cur-2')return Promise.resolve({data:second.concat([first[0]]),meta:{next_cursor:null}});
          return Promise.resolve({data:first,meta:{next_cursor:'cur-2'}});}
        const t=query.type;return Promise.resolve({data:[raw(1,t)],meta:{next_cursor:null}});}
      return Promise.reject(err(404,'resource_not_found','x'));},
    put(path,body,o){calls.push(['PUT',path,body,o&&o.idempotencyKey]);if(opts.saveFails)return Promise.reject(err(0,'network_error','网络断了'));return Promise.resolve({data:{saved:true}});},
    del(path,body,o){calls.push(['DELETE',path,body,o&&o.idempotencyKey]);return Promise.resolve({data:{saved:false}});},
    post(path,body,o){calls.push(['POST',path,body,o&&o.idempotencyKey]);return Promise.resolve({data:{}});}};
  const rootEl={dataset:{route:'skills'},addEventListener(){},removeEventListener(){},
    querySelector(s){return s==='[data-library-thread]'&&html.includes('data-library-thread')?{id:'thread-host'}:null},
    querySelectorAll:()=>[],set innerHTML(v){html=String(v)},get innerHTML(){return html}};
  const c={console,Promise,Object,String,Number,Array,Math,JSON,Date,Error,setTimeout,clearTimeout,URL,Set,Map,
    location:{protocol:'https:',hash:'#/skills'},navigator:{},
    document:{querySelector:s=>s==='[data-library-page]'&&html.includes('data-library-page')?rootEl:null,
      addEventListener(t,f){(handlers[t]??=[]).push(f)},removeEventListener(t,f){handlers[t]=(handlers[t]||[]).filter(g=>g!==f)}},
    Commons:{toast:m=>toasts.push(m),read:(k,f)=>f,write:()=>true,esc:s=>String(s==null?'':s),safeUrl:s=>String(s||'#'),icon:()=>'',
      refresh(){html=c.CommonsLibrary.routes.skills();c.CommonsLibrary.mount();}},
    CommonsAPI:api,CommonsSession:{can:a=>opts.cannotSave?a!=='content.save':true},
    CommonsThread:{mount(host,o){threads.push([host,o]);},destroy(){}}};
  c.window=c;c.self=c;c.globalThis=c;c.COMMONS_BUILD={mode:'live'};
  vm.createContext(c);vm.runInContext(SRC,c);
  return {c,calls,handlers,toasts,threads,get html(){return html}};
}
async function boot(opts){const t=make(opts);t.c.Commons.refresh();await tick();return t;}
const btn=(act,id)=>({closest:s=>s==='[data-lib-act]'?{dataset:{libAct:act,id:id||''},disabled:false}:null});
function click(t,act,id){(t.handlers.click||[]).forEach(f=>f({target:btn(act,id),preventDefault(){}}));}
const rows=(html)=>(html.match(/data-lib-act="select"/g)||[]).length;
'''

LIB_PAGING = LIBRARY + r'''
(async()=>{
 const t=await boot();
 // 第一页就是接口上限 50 条，请求带 limit:50 且不带 cursor
 const firstGet=t.calls.find(c=>c[1]==='/library/items'&&c[2].type==='skill');
 same(firstGet[2],{type:'skill',limit:50},'first page asks for 50');
 assert.equal(rows(t.html),50);
 assert.ok(t.html.includes('50+'),'header says there is more');
 assert.ok(t.html.includes('data-lib-act="more"'),'load-more shown while a cursor exists');
 click(t,'more');await tick();
 const more=t.calls.filter(c=>c[1]==='/library/items'&&c[2].cursor);
 assert.equal(more.length,1);
 same(more[0][2],{type:'skill',limit:50,cursor:'cur-2'},'next page sends the cursor from meta');
 assert.equal(rows(t.html),57,'7 new rows appended, the repeated first row is not duplicated');
 assert.ok(!t.html.includes('data-lib-act="more"'),'no more button once the cursor is gone');
 assert.ok(!t.html.includes('57+'));
 console.log('_PASS library-paging');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

LIB_SAVE = LIBRARY + r'''
(async()=>{
 const t=await boot();
 assert.ok(t.html.includes('data-lib-act="favorite"'));
 assert.ok(/data-lib-act="favorite" data-id="skill-1"[^>]*aria-pressed="false"/.test(t.html),'not saved yet');
 click(t,'favorite','skill-1');await tick();
 const put=t.calls.find(c=>c[0]==='PUT');
 assert.equal(put[1],'/content/objects/skill-1/save','reuses the content save route');
 assert.ok(/^[A-Za-z0-9_-]{8,128}$/.test(put[3]),'idempotency key in the accepted shape');
 assert.ok(/data-lib-act="favorite" data-id="skill-1"[^>]*aria-pressed="true"/.test(t.html),'button shows saved');
 assert.ok(t.toasts.includes('已收藏。'));
 click(t,'favorite','skill-1');await tick();
 const del=t.calls.find(c=>c[0]==='DELETE');
 assert.equal(del[1],'/content/objects/skill-1/save');
 assert.notEqual(del[3],put[3],'a new action gets a new key');
 assert.ok(/data-lib-act="favorite" data-id="skill-1"[^>]*aria-pressed="false"/.test(t.html));
 // 失败：状态不变，给出原因
 const bad=await boot({saveFails:true});
 click(bad,'favorite','skill-1');await tick();
 assert.ok(/data-lib-act="favorite" data-id="skill-1"[^>]*aria-pressed="false"/.test(bad.html),'failed save leaves the button unsaved');
 assert.ok(bad.toasts.some(m=>m.includes('网络断了')));
 // 没有收藏权限：按钮在但不可点
 const locked=await boot({cannotSave:true});
 assert.ok(/data-lib-act="favorite"[^>]*disabled/.test(locked.html));
 console.log('_PASS library-save');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

LIB_SAVED_FILTER = LIBRARY + r'''
(async()=>{
 const t=await boot();
 assert.ok(t.html.includes('data-lib-act="only-saved"'));
 click(t,'only-saved');await tick();
 const g=t.calls.filter(c=>c[1]==='/library/items'&&c[2].saved==='true');
 assert.equal(g.length,1);
 same(g[0][2],{type:'skill',saved:'true',limit:50},'saved filter is a server query, not a filter over the first page');
 assert.equal(rows(t.html),1,'only the saved row remains');
 assert.ok(!t.html.includes('data-lib-act="more"'));
 click(t,'only-saved');await tick();
 assert.equal(rows(t.html),50,'switching back restores the full list');
 console.log('_PASS library-saved-filter');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

LIB_COMMENTS = LIBRARY + r'''
(async()=>{
 const t=await boot();
 assert.ok(t.html.includes('data-library-thread'));
 const last=t.threads[t.threads.length-1];
 same([last[1].targetId,last[1].repliesOnly],['skill-1',true],'live comments mount the shared thread on the library object');
 // 未过审的条目不能评论，只给一句说明
 const p=await boot({pendingSecond:true});
 click(p,'select','skill-2');await tick();
 assert.ok(p.html.includes('审核通过后可以评论。'));
 assert.ok(!p.html.includes('data-library-thread'));
 console.log('_PASS library-comments');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

MARKET = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=process.argv[1];
const tick=async(n=30)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
const same=(a,b,m)=>assert.equal(JSON.stringify(a),JSON.stringify(b),m);
const SRC=fs.readFileSync(root+'/preview/market.js','utf8');
const listing=(i,mine)=>({id:'l'+i,category:'sell',title:'帖子'+i,status:'active',mine:!!mine,author:{id:'p1',display_name:'卖家',level:2},images:[],created_at:'2026-10-28T00:00:'+String(i%60).padStart(2,'0')+'Z'});
function make(opts){
  opts=opts||{};
  const handlers={};const calls=[];const toasts=[];let html='';let keyN=0;let painted=false;
  const err=(status,code,message)=>Object.assign(new Error(message),{status,code});
  const all1=[];for(let i=1;i<=50;i++)all1.push(listing(i,i<=3));
  const all2=[];for(let i=51;i<=55;i++)all2.push(listing(i,false));
  const mine1=[];for(let i=1;i<=50;i++)mine1.push(listing(i,true));
  const mine2=[];for(let i=51;i<=58;i++)mine2.push(listing(i,true));
  let mineFail=opts.mineMoreFailsOnce;
  const api={mode:'live',newIdempotencyKey:()=>'idem-key-'+(++keyN),
    get(path,query){
      if(query){const q=Object.keys(query).map(k=>k+'='+query[k]).join('&');path=path+'?'+q;}
      calls.push(['GET',path]);
      if(path==='/market/meta')return Promise.resolve({data:{people:[],categories:[{id:'sell',label:'出售',fields:['price'],required:[]}],field_labels:{},status_labels:{},report_reasons:[]}});
      if(path==='/market/listings?limit=50')return Promise.resolve({data:all1,meta:{next_cursor:'all-2',count:55}});
      if(path==='/market/listings?limit=50&cursor=all-2')return Promise.resolve({data:all2.concat([all1[0]]),meta:{next_cursor:null,count:55}});
      if(path==='/market/listings?mine=true&limit=50')return Promise.resolve({data:mine1,meta:{next_cursor:'mine-2',count:58}});
      if(path==='/market/listings?mine=true&limit=50&cursor=mine-2'){
        if(mineFail){mineFail=false;return Promise.reject(err(0,'network_error','网络断了'));}
        return Promise.resolve({data:mine2.concat([mine1[0]]),meta:{next_cursor:null,count:58}});}
      return Promise.reject(err(404,'resource_not_found','x '+path));},
    post(){return Promise.resolve({data:{}});}};
  const gridEl={innerHTML:''},moreEl={innerHTML:''},countEl={textContent:''};
  const rootEl={querySelector(s){if(!painted)return null;return s==='[data-mt-grid]'?gridEl:s==='[data-mt-more]'?moreEl:s==='[data-mt-count]'?countEl:null},
    querySelectorAll:()=>[],set innerHTML(v){html=String(v);painted=false},get innerHTML(){return html}};
  const c={console,Promise,Object,String,Number,Array,Math,JSON,Date,Error,setTimeout,clearTimeout,URL,Set,Map,
    location:{protocol:'https:',hash:opts.hash||'#/market'},
    document:{querySelector:s=>s==='[data-mt-root]'?rootEl:null,addEventListener(t,f){(handlers[t]??=[]).push(f)},removeEventListener(t,f){handlers[t]=(handlers[t]||[]).filter(g=>g!==f)}},
    matchMedia:()=>({matches:false}),
    Commons:{toast:m=>toasts.push(m),read:(k,f)=>f,write:()=>true,go(){},esc:s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),safeUrl:s=>String(s||'#'),icon:()=>'',
      refresh(){html=c.CommonsMarket.routes.market();painted=false;c.CommonsMarket.mount();painted=true;gridEl.innerHTML=(html.match(/<div data-mt-grid>([\s\S]*?)<\/div>\s*<div data-mt-more>/)||[])[1]||'';moreEl.innerHTML=(html.match(/<div data-mt-more>([\s\S]*?)<\/div>\s*<\/div>\s*$/)||[])[1]||'';}},
    CommonsAPI:api,CommonsSession:{can:()=>true},CommonsMedia:{upload(){return Promise.reject(new Error('x'))}}};
  c.window=c;c.self=c;c.globalThis=c;c.COMMONS_BUILD={mode:'live'};
  vm.createContext(c);vm.runInContext(SRC,c);
  return {c,calls,handlers,toasts,gridEl,moreEl,countEl,markPainted(){painted=true},get html(){return html}};
}
async function boot(opts){const t=make(opts);t.c.Commons.refresh();await tick();return t;}
const btn=(act)=>({closest:s=>s==='[data-mt-act]'?{getAttribute:n=>n==='data-mt-act'?act:null}:null});
function click(t,act){t.markPainted();(t.handlers.click||[]).forEach(f=>f({target:btn(act),preventDefault(){}}));}
const cards=(h)=>(h.match(/<article class="mt-card"/g)||[]).length;
'''

MARKET_ALL = MARKET + r'''
(async()=>{
 const t=await boot();
 assert.ok(t.calls.some(c=>c[1]==='/market/listings?limit=50'),'list asks for 50 rows');
 assert.equal(cards(t.gridEl.innerHTML),50);
 assert.ok(t.moreEl.innerHTML.includes('data-mt-act="more"'));
 click(t,'more');await tick();
 assert.ok(t.calls.some(c=>c[1]==='/market/listings?limit=50&cursor=all-2'),'cursor passes through');
 assert.equal(cards(t.gridEl.innerHTML),55,'5 new rows, the repeated row is dropped');
 assert.equal(t.moreEl.innerHTML,'');
 assert.equal(t.countEl.textContent,'55 条');
 console.log('_PASS market-all-paging');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

MARKET_MINE = MARKET + r'''
(async()=>{
 const t=await boot({hash:'#/market/mine'});
 // 我的发布向服务器要 mine=true 的数据，而不是在“全部”的前 50 条里挑
 assert.ok(t.calls.some(c=>c[1]==='/market/listings?mine=true&limit=50'),'mine view queries the server');
 assert.equal(cards(t.gridEl.innerHTML),50,'all 50 of my posts, not only the 3 that were in the first all-page');
 assert.ok(t.moreEl.innerHTML.includes('data-mt-act="more"'));
 assert.ok(t.html.includes('50+ 条'),'header count says there is more');
 click(t,'more');await tick();
 assert.ok(t.calls.some(c=>c[1]==='/market/listings?mine=true&limit=50&cursor=mine-2'));
 assert.equal(cards(t.gridEl.innerHTML),58);
 assert.equal(t.moreEl.innerHTML,'');
 assert.equal(t.countEl.textContent,'58 条');
 console.log('_PASS market-mine-paging');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

MARKET_MINE_RETRY = MARKET + r'''
(async()=>{
 const t=await boot({hash:'#/market/mine',mineMoreFailsOnce:true});
 click(t,'more');await tick();
 assert.equal(cards(t.gridEl.innerHTML),50,'a failed page keeps the rows already loaded');
 assert.ok(t.moreEl.innerHTML.includes('网络断了'),'the failure is shown');
 assert.ok(t.moreEl.innerHTML.includes('重试'));
 click(t,'more');await tick();
 assert.equal(cards(t.gridEl.innerHTML),58,'retry fetches the same cursor again');
 console.log('_PASS market-mine-retry');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


def run_node(script: str) -> str:
    done = subprocess.run(['node', '-e', script, str(ROOT)], capture_output=True, text=True, timeout=60)
    if done.returncode != 0:
        raise AssertionError((done.stdout + done.stderr)[-3000:])
    return done.stdout


class LibraryWiringTest(unittest.TestCase):
    def test_list_pages_past_fifty(self):
        self.assertIn('_PASS library-paging', run_node(LIB_PAGING))

    def test_favorite_uses_content_save_and_reports_failure(self):
        self.assertIn('_PASS library-save', run_node(LIB_SAVE))

    def test_only_saved_filter_queries_the_server(self):
        self.assertIn('_PASS library-saved-filter', run_node(LIB_SAVED_FILTER))

    def test_comments_mount_shared_thread(self):
        self.assertIn('_PASS library-comments', run_node(LIB_COMMENTS))


class MarketPagingTest(unittest.TestCase):
    def test_all_view_pages_and_dedupes(self):
        self.assertIn('_PASS market-all-paging', run_node(MARKET_ALL))

    def test_mine_view_is_server_filtered_and_pages(self):
        self.assertIn('_PASS market-mine-paging', run_node(MARKET_MINE))

    def test_mine_page_failure_keeps_rows_and_retries(self):
        self.assertIn('_PASS market-mine-retry', run_node(MARKET_MINE_RETRY))


if __name__ == '__main__':
    unittest.main()

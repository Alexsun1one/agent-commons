"""LG-8A R16 · hot.js「开个房间聊」、tools.js「我在用」：请求中置灰、重复点击不发第二次、失败恢复。

BEFORE_R16 是动手前复制的 hot.js / tools.js（docs/evidence/LG-8A/before-r16/），反跑必须失败。
"""
from __future__ import annotations

import subprocess
import unittest

from tests.test_lg8a_r13_members_teams import COMMON, ROOT
from tests.test_lg8a_r15_writes import HOT

BEFORE_R16 = ROOT / 'docs' / 'evidence' / 'LG-8A' / 'before-r16'

HOT_ROOM = HOT + r'''
(async()=>{
 const c=hotCtx([{id:'e1',title:'Evt',related:{}}]); await tick();
 const col={querySelector:()=>({textContent:''})};
 const mk=()=>hotBtn('room','e1',{'.hot-detail-col':col});
 let release;
 c.routes['POST /feed/events/e1/room']=()=>new Promise(r=>{release=()=>r({data:{}});});
 const b=mk();
 click(c,b); await tick();
 let posts=find(c,'POST','/feed/events/e1/room');
 assert.equal(posts.length,1,'room POST');
 assert.ok(posts[0].opts.idempotencyKey,'idempotency key');
 assert.equal(b.disabled,true,'disabled while pending');
 click(c,b); click(c,b); await tick();
 assert.equal(find(c,'POST','/feed/events/e1/room').length,1,'no second POST while pending');
 release(); await tick();
 assert.equal(b.disabled,false,'released after success');
 assert.ok(c.toasts.some(t=>t.includes('已记下开房意向')),'success toast');
 for(const [err,want] of [
   [Object.assign(new Error('x'),{status:501,code:'capability_unavailable'}),'这个功能还没开放'],
   [Object.assign(new Error('服务器说：开房太频繁'),{status:429}),'开房太频繁'],
   [Object.assign(new Error('x'),{status:401}),'登录后才能开房间']]){
  c.routes['POST /feed/events/e1/room']=err;
  const f=mk(); click(c,f); await tick();
  assert.ok(c.toasts.some(t=>t.includes(want)),'toast '+want+' got '+JSON.stringify(c.toasts));
  assert.equal(f.disabled,false,'re-enabled after failure');
 }
 console.log('HOT_ROOM_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

TOOLS_USE = r'''
(async()=>{
 const tool=mine=>({slug:'codex',name:'Codex',vendor:'x',category:'编程 Agent',price_tier:'免费',official_url:'https://x.example',summary:'s',tags:[],use_count:1,month_new_count:0,rating:{median:null,count:0},reviews:[],mine,trend:[],related:{}});
 const setup=async mine=>{
  const c=context({hash:'#/tool/codex',rootSel:'tools-page'});
  c.routes['GET /tools/codex']={data:tool(mine),meta:{}};
  c.rootNode.querySelector=s=>s==='[data-tools-purpose]'?{value:'写代码'}:null;
  vm.runInContext(source('tools'),c);
  c.CommonsTools.mount(); await tick();
  return c;
 };
 // 标记在用：POST
 let c=await setup(null), release;
 c.routes['POST /tools/codex/use']=()=>new Promise(r=>{release=()=>r({data:{}});});
 const b=btn('[data-tools-act]',{toolsAct:'use-toggle',id:'codex'});
 click(c,b); await tick();
 let posts=find(c,'POST','/tools/codex/use');
 assert.equal(posts.length,1,'use POST');
 assert.deepEqual(posts[0].body,{purpose:'写代码',show_on_profile:true});
 assert.ok(posts[0].opts.idempotencyKey,'idempotency key');
 assert.equal(b.disabled,true,'disabled while pending');
 click(c,b); click(c,b); await tick();
 assert.equal(find(c,'POST','/tools/codex/use').length,1,'no second POST while pending');
 release(); await tick();
 assert.ok(c.toasts.some(t=>t.includes('已标记')),'success toast');
 // 取消在用：DELETE
 c=await setup({started_at:'2026-01-01T00:00:00.000Z',purpose:'x'});
 c.routes['DELETE /tools/codex/use']={data:{}};
 click(c,btn('[data-tools-act]',{toolsAct:'use-toggle',id:'codex'})); await tick();
 assert.equal(find(c,'DELETE','/tools/codex/use').length,1,'use DELETE');
 // 失败：恢复并显示服务器的话 / 501
 for(const [err,want] of [
   [Object.assign(new Error('服务器说：先满三天'),{status:409}),'先满三天'],
   [Object.assign(new Error('x'),{status:501,code:'capability_unavailable'}),'这个功能还没开放']]){
  c=await setup(null);
  c.routes['POST /tools/codex/use']=err;
  const f=btn('[data-tools-act]',{toolsAct:'use-toggle',id:'codex'});
  click(c,f); await tick();
  assert.ok(c.toasts.some(t=>t.includes(want)),'toast '+want+' got '+JSON.stringify(c.toasts));
  assert.equal(f.disabled,false,'re-enabled after failure');
 }
 console.log('TOOLS_USE_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


def run(script, before=False):
    args = ['node', '-e', COMMON + script, str(ROOT)] + ([str(BEFORE_R16)] if before else [])
    return subprocess.run(args, capture_output=True, text=True, timeout=120)


CASES = {'hot_room': (HOT_ROOM, 'HOT_ROOM_PASS'), 'tools_use': (TOOLS_USE, 'TOOLS_USE_PASS')}


class Lg8aR16Toggles(unittest.TestCase):
    def test_current_code_passes(self):
        for name, (script, marker) in CASES.items():
            with self.subTest(name):
                r = run(script)
                self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
                self.assertIn(marker, r.stdout)

    def test_fails_on_old_code(self):
        for name, (script, _m) in CASES.items():
            with self.subTest(name):
                self.assertNotEqual(run(script, before=True).returncode, 0)


if __name__ == '__main__':
    unittest.main()

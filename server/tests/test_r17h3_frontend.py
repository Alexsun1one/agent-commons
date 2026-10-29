"""R17-H3 · 换头像 / 移除头像后，外壳头像当场变（不刷新整页、不冲掉账号页提示）。离线 VM。
运行：cd server && python3 -m unittest tests.test_r17h3_frontend -q
反跑：R17H3_APP=改前 app.js 路径；R17H3_ACCOUNT=改前 account.js 路径。"""
from pathlib import Path
import os
import subprocess
import unittest

from tests.test_lg6c_app_shell import COMMON as APP_SHELL
from tests import test_r17a_wiring_js as wj

ROOT = Path(__file__).resolve().parents[2]

APP_COMMON = APP_SHELL.replace("vm.runInContext(source('api'),c);vm.runInContext(original?BEFORE:source('app'),c);",
    "vm.runInContext(source('api'),c);vm.runInContext(process.env.R17H3_APP?fs.readFileSync(process.env.R17H3_APP,'utf8'):(original?BEFORE:source('app')),c);")
assert 'R17H3_APP' in APP_COMMON

ACCOUNT = wj.ACCOUNT.replace("const SRC=fs.readFileSync(root+'/preview/account.js','utf8');",
    "const SRC=fs.readFileSync(process.env.R17H3_ACCOUNT||(root+'/preview/account.js'),'utf8');")
assert 'R17H3_ACCOUNT' in ACCOUNT


def run(script):
    done = subprocess.run(['node', '-e', script, str(ROOT)], capture_output=True, text=True, timeout=60, env=dict(os.environ))
    if done.returncode != 0:
        raise AssertionError((done.stdout + done.stderr)[-3000:])
    return done.stdout


SHELL = r'''
(async()=>{
 const x=setup(false,false),{c,nodes}=x;c.CommonsMotion.reveal=()=>{};await asMember(x);
 const top0=nodes['#topbar'].innerHTML;
 assert.ok(top0.includes('<img class="member-self-avatar" src="/api/media/f/face.webp"'),'起始头像');
 const fresh=()=>({outerHTML:'<old>'});const a=fresh(),b=fresh();
 c.document.querySelectorAll=s=>s.includes('member-self-avatar')?[a,b]:[];
 const fetches=c.calls.length;
 c.dispatchEvent(new c.CustomEvent('commons:avatar',{detail:{avatar_ref:'asset-9',url:'/api/media/f/new128.webp'}}));
 assert.ok(a.outerHTML.includes('<img class="member-self-avatar" src="/api/media/f/new128.webp"')&&b.outerHTML===a.outerHTML,'顶栏和侧栏的头像当场换');
 assert.equal(nodes['#topbar'].innerHTML,top0,'没有整页重画');
 assert.equal(c.calls.length,fetches,'没有再去读 /api/me');
 // 之后换页（render）仍用新头像，不会退回旧图
 c.location.hash='#/people';c.Commons.refresh();
 assert.ok(nodes['#topbar'].innerHTML.includes('src="/api/media/f/new128.webp"')&&!nodes['#topbar'].innerHTML.includes('face.webp'),'换页后仍是新头像');
 // 移除：回到首字
 c.dispatchEvent(new c.CustomEvent('commons:avatar',{detail:{avatar_ref:'',url:''}}));
 assert.ok(a.outerHTML.includes('member-self-avatar member-color-blue')&&!a.outerHTML.includes('<img'),'移除后显示首字');
 // 危险地址不进 src
 c.dispatchEvent(new c.CustomEvent('commons:avatar',{detail:{avatar_ref:'x',url:'javascript:alert(1)'}}));
 assert.ok(!a.outerHTML.includes('javascript:')&&!a.outerHTML.includes('<img'),'危险地址退回首字');
 // 服务端的会话数据回来了，就以它为准
 await answer(x,200,Object.assign({},member,{avatar_ref:'/api/media/f/server.webp'}));
 assert.ok(nodes['#topbar'].innerHTML.includes('src="/api/media/f/server.webp"'),'会话刷新后以服务端为准');
 console.log('_PASS shell-avatar-live');
})().catch(e=>{console.error(e);process.exitCode=1});
'''

ACC_FLOW = r'''
(async()=>{
 const t=await boot();const events=[];t.c.dispatchEvent=e=>events.push(e);
 const sess=[];t.c.CommonsSession.refresh=()=>{sess.push(1);return Promise.resolve()};
 const input={files:[{name:'me.png',size:10,type:'image/png'}],value:'x',closest:s=>s==='[data-acc-avatar-file]'?input:null};
 fire(t,'change',input);await tick();
 const ev=events.filter(e=>e.type==='commons:avatar');
 assert.equal(ev.length,1,'换好头像发一次轻量事件');
 same([ev[0].detail.avatar_ref,ev[0].detail.url],['av-1','/api/media/f/'+'e'.repeat(64)+'.webp']);
 assert.ok(t.html.includes('头像换好了'),'账号页提示还在');
 assert.equal(sess.length,0,'不走会话刷新，免得整页重挂');
 // 移除
 fire(t,'click',btn('avatar-clear'));await tick();
 const gone=events.filter(e=>e.type==='commons:avatar');
 assert.equal(gone.length,2);same([gone[1].detail.avatar_ref,gone[1].detail.url],['','']);
 assert.ok(t.html.includes('头像已移除'),'移除提示还在');
 // 失败不发事件
 const u=await boot({putFailsOnce:true});const ue=[];u.c.dispatchEvent=e=>ue.push(e);
 const i2={files:[{name:'me.png',size:10,type:'image/png'}],value:'x',closest:s=>s==='[data-acc-avatar-file]'?i2:null};
 fire(u,'change',i2);await tick();
 assert.equal(ue.filter(e=>e.type==='commons:avatar').length,0,'没换成功就不通知外壳');
 fire(u,'click',btn('avatar-retry'));await tick();
 assert.equal(ue.filter(e=>e.type==='commons:avatar').length,1,'重试成功后才通知');
 console.log('_PASS account-announces');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


class R17H3Frontend(unittest.TestCase):
    def test_shell_avatar_changes_in_place_without_rerender(self):
        self.assertIn('_PASS shell-avatar-live', run(APP_COMMON + SHELL))

    def test_account_announces_avatar_change_and_keeps_its_own_status(self):
        self.assertIn('_PASS account-announces', run(ACCOUNT + ACC_FLOW))


if __name__ == '__main__':
    unittest.main()

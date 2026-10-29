"""LG-6C R12: real-mode "我 · 工作台" shows the session identity, server posts and saved items; no local workspace (offline VM).

The mutation tests run the same scripts against the pre-change copies in docs/evidence/LG-6C/r12/, which must FAIL.
"""
from pathlib import Path
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_lg6c_app_shell import COMMON as APP_COMMON  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BEFORE = 'docs/evidence/LG-6C/r12/'

MEMBER = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const file=process.argv[1]+'/'+process.argv[2];
const tick=async(n=12)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));};
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function make(mode,routes={}){
 const calls=[],listeners={};
 const slots={};
 const slot=sel=>slots[sel]??={innerHTML:'',textContent:'',setAttribute(){}};
 const root={dataset:{memberWorkspace:'dashboard'},isConnected:true,querySelector:sel=>/^\[data-member-(posts|saved|post-count|saved-count|drafts|activity|draft-count)\]$/.test(sel)?slot(sel):null};
 const c={console,Promise,Date,Math,Number,String,Array,Object,JSON,Boolean,Map,Set,Intl,RegExp,URL,Blob,setTimeout,clearTimeout,calls,slots,root,
  crypto:{randomUUID:()=>'id'},FormData:class{},
  document:{querySelector:s=>s==='[data-member-workspace]'?root:null,addEventListener(k,f){listeners[k]=f}},
  Commons:{esc,safeUrl:u=>/^(\/|#|https?:)/.test(String(u))?esc(u):'#',icon:n=>'',avatar:()=>'',read:(k,d)=>d,write:()=>true,refresh(){},toast(){}},
  COMMONS_DATA:{people:[],methods:[],works:[]},COMMONS_FIELDWORK:{items:[]},
  CommonsContributions:{listSummary:()=>Promise.resolve([])},
  CommonsAPI:{mode,get(p,q){calls.push([p,q]);const r=routes[p];if(r instanceof Error)return Promise.reject(r);return Promise.resolve({data:r||[],meta:{next_cursor:null}})}},
  CommonsSession:{state:'member',me:{id:'u1',handle:'real-user',display_name:'真实队员',avatar_ref:'/api/media/f/face.webp',level:3,roles:[]}}};
 c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(file,'utf8'),c);return c;
}
(async()=>{
 const obj={id:'o1',type:'discussion',title:'我的第一篇',lifecycle:'active',created_at:'2026-10-20T10:00:00Z',published_at:'2026-10-20T10:00:00Z'};
 const sav={id:'s1',type:'knowledge',title:'收藏的条目',lifecycle:'active',created_at:'2026-10-21T10:00:00Z',author:{display_name:'某人'}};
 const rep={id:'r1',type:'reply',title:'一条回复',root_id:'o1',lifecycle:'active',created_at:'2026-10-22T10:00:00Z'},soc={id:'p1',type:'social_post',title:'一条动态',lifecycle:'active',created_at:'2026-10-23T10:00:00Z'},odd={id:'x1',type:'weird_type',title:'奇怪类型',lifecycle:'active',created_at:'2026-10-24T10:00:00Z'};
 let c=make('live',{'/objects':[obj,rep,soc,odd],'/content/saved':[sav]});
 let html=c.CommonsMember.dashboard();
 assert(!html.includes('本机'),'no 本机 wording in live dashboard');
 assert(html.includes('href="#/write"'),'write link is #/write');
 assert(html.includes('href="#/account"'),'edit profile points to #/account');
 for(const bad of ['#/join','#/profile','#/contribute','data-scroll="member-notes"','member-practice','export-local','reset-local'])assert(!html.includes(bad),'live dashboard must not contain '+bad);
 assert(html.includes('真实队员')&&html.includes('@real-user')&&html.includes('L3')&&html.includes('/api/media/f/face.webp'),'identity from session');
 c.CommonsMember.mount();await tick();
 assert.deepEqual(c.calls,[['/objects',{author_id:'u1',limit:50}],['/content/saved',{limit:20}]]);
 const posts=c.slots['[data-member-posts]'].innerHTML,saved=c.slots['[data-member-saved]'].innerHTML;
 assert(posts.includes('href="#/read/o1"')&&posts.includes('我的第一篇')&&posts.includes('讨论')&&posts.includes('已发布'),posts);
 assert(!posts.includes('一条回复')&&!posts.includes('href="#/read/r1"'),'replies are not listed as posts');
 assert(posts.includes('动态')&&!posts.includes('social_post')&&!posts.includes('weird_type')&&posts.includes('内容'),'type codes are mapped to Chinese, unknown -> 内容');
 assert(saved.includes('href="#/read/s1"')&&saved.includes('收藏的条目')&&saved.includes('某人'),saved);
 assert.equal(c.slots['[data-member-post-count]'].textContent,3);assert.equal(c.slots['[data-member-saved-count]'].textContent,1);
 assert(!posts.includes('本机')&&!saved.includes('本机'));
 // empty states
 c=make('live',{'/objects':[],'/content/saved':[]});c.CommonsMember.mount();await tick();
 assert(c.slots['[data-member-posts]'].innerHTML.includes('href="#/write"')&&c.slots['[data-member-posts]'].innerHTML.includes('写第一篇'));
 assert(!c.slots['[data-member-posts]'].innerHTML.includes('本机'));
 // errors: server message + retry; 501 neutral
 c=make('live',{'/objects':Object.assign(Error('服务暂时不可用'),{status:503}),'/content/saved':Object.assign(Error('x'),{status:501,code:'capability_unavailable'})});c.CommonsMember.mount();await tick();
 assert(c.slots['[data-member-posts]'].innerHTML.includes('服务暂时不可用')&&c.slots['[data-member-posts]'].innerHTML.includes('data-action="member-retry"'));
 assert(c.slots['[data-member-saved]'].innerHTML.includes('这个功能还没开放')&&!c.slots['[data-member-saved]'].innerHTML.includes('member-retry'));
 // profile / setup never show the local form in live
 for(const page of ['profile','setup']){const h=c.CommonsMember[page]();assert(h.includes('href="#/account"')&&!h.includes('本机')&&!h.includes('<form'),page);}
 assert.equal(c.CommonsMember.welcome(),'');assert.equal(c.CommonsMember.identity().name,'真实队员');
 // demo unchanged
 const d=make('demo');html=d.CommonsMember.dashboard();
 assert(html.includes('本机工作区 · 内容只保存在本机，尚未连接社区账号或消息服务。')&&html.includes('href="#/join"')&&html.includes('href="#/contribute"'),'demo keeps the local workspace');
 assert(d.CommonsMember.setup().includes('本机试用资料'));
 console.log('MEMBER_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});

'''

APP_REDIRECT = r'''
(async()=>{
 const go=async(demo,original,hash)=>{
  const x=setup(demo,original),{c}=x;if(!demo)await asMember(x);
  c.CommonsMotion.reveal=()=>{};
  c.location.hash=hash;
  try{c.Commons.refresh();}catch(e){}
  return c.location.hash;
 };
 assert.equal(await go(false,ORIG,'#/join'),'#/account','live #/join goes to the account page');
 assert.equal(await go(false,ORIG,'#/profile'),'#/u/real-user','live #/profile goes to own public page');
 assert.equal(await go(true,ORIG,'#/join'),'#/join','demo #/join untouched');
 assert.equal(await go(true,ORIG,'#/profile'),'#/profile','demo #/profile untouched');
 console.log('APP_REDIRECT_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


def node(script, *args, common=''):
    return subprocess.run(['node', '-e', common + script, str(ROOT), *args], capture_output=True, text=True)


def app_common(original):
    return APP_COMMON.replace('LG-6C/before-app.js', 'LG-6C/r12/before-app.js') if original else APP_COMMON


class LG6CR12Member(unittest.TestCase):
    def test_live_workspace_uses_session_and_server_lists(self):
        result = node(MEMBER, 'preview/member.js')
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertIn('MEMBER_PASS', result.stdout)

    def test_pre_change_member_fails(self):
        result = node(MEMBER, BEFORE + 'before-member.js')
        self.assertNotEqual(result.returncode, 0)

    def test_live_join_and_profile_redirect_demo_untouched(self):
        script = APP_REDIRECT.replace('ORIG', 'false')
        result = node(script, common=app_common(False))
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertIn('APP_REDIRECT_PASS', result.stdout)

    def test_pre_change_app_does_not_redirect(self):
        script = APP_REDIRECT.replace('ORIG', 'true')
        result = node(script, common=app_common(True))
        self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()

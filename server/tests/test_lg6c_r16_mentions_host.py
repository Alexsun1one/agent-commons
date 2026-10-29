"""LG-6C R16: thread.js @mentions survive member names that collide with Object.prototype keys;
events.js hostLink returns '' for an empty host name so the tag line has no extra separator (offline VM).

Mutation tests run the same scripts against the pre-change copies in docs/evidence/LG-6C/before-r16/, which must FAIL.
"""
from pathlib import Path
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_lg6c_r13_pages import EVENTS as R13_EVENTS  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BEFORE_DIR = 'docs/evidence/LG-6C/before-r16/'

HARNESS = R13_EVENTS[:R13_EVENTS.index('(async()=>{')]

MENTIONS = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync(process.argv[1]+'/'+process.argv[2],'utf8');
const lift=name=>{const i=src.indexOf('  function '+name+'(');assert(i>=0,'missing '+name);const j=src.indexOf('\n  }\n',i);return src.slice(i,j+5);};
const code=['esc','safeUrl','peopleOf','inlineMention','formatBody'].map(lift).join('\n')+'\nthis.formatBody=formatBody;';
const c={String,Object,Array,RegExp,Map,encodeURIComponent,sample:()=>({people:[]}),agentLink:(id,l)=>'<a class="lk-agent">'+l+'</a>'};
vm.createContext(c);vm.runInContext(code,c);
const mention=(n,h)=>'<span class="th-mention"><a class="lk-person" href="#/u/'+h+'">@'+n+'</a></span>';
for(const name of ['constructor','toString','__proto__','hasOwnProperty','valueOf']){
 const people=[{id:'p1',name,handle:'h-'+name}];
 const html=c.formatBody('你好 @'+name+' 在吗',{people});
 assert.equal(html,'你好 '+mention(name,'h-'+name)+' 在吗',name+' -> '+html);
}
// two people, one with a prototype-key name: each maps to its own handle
const html=c.formatBody('@constructor 和 @小明',{people:[{id:'a',name:'constructor',handle:'c1'},{id:'b',name:'小明',handle:'xm'}]});
assert.equal(html,mention('constructor','c1')+' 和 '+mention('小明','xm'),html);
// ordinary names and plain text are unchanged
assert.equal(c.formatBody('@谁 & 你',{people:[]}),'@谁 &amp; 你');
console.log('MENTIONS_PASS');
'''

HOST = HARNESS + r'''
(async()=>{
 const base={id:'ev1',kind:'challenge',title:'活动',summary:'s',startsAt:'2026-10-28T10:00:00Z',endsAt:'2026-10-29T10:00:00Z',status:'live',signups:0,place:'线上'};
 const tags=html=>{const m=/<div class="evt-detail-tags">[\s\S]*?<span>([\s\S]*?)<\/span><\/div>/.exec(html);assert(m,'tag line rendered');return m[1];};
 // Same shape as preview/links.js: a handle with an empty name still yields an (empty) link tag; org link yields an empty span.
 const links={person:(handle,name)=>handle?'<a class="lk-person" href="#/u/'+handle+'">'+(name??'')+'</a>':(name??''),
  a:(kind,id,label)=>'<span class="lk-link">'+(label??'')+'</span>'};
 const live=async (ev,people)=>{
  const e=JSON.parse(JSON.stringify(ev));
  const c=make({get:{'/events':[e],'/events/campaigns':[],'/events/ev1':e},post:{}},'#/event/ev1');
  c.CommonsSession={hasRole:()=>false,can:()=>true};c.CommonsLinks=links;
  c.CommonsEvents.mount();await tick();
  if(people){/* nothing: live people come from the server list */}
  c.rootN.innerHTML=c.CommonsEvents.routes.event();return tags(c.rootN.innerHTML);};
 const when='10.28–10.29';
 // person host with an empty name -> no empty link tag, no trailing separator
 let t=await live({...base,hostId:'',host:''});
 assert.equal(t,when+' · 线上','empty person host -> '+t);
 t=await live({...base,hostId:'u1',host:'  '});
 assert(!t.includes('<a')||!/<a[^>]*><\/a>/.test(t),'no empty link: '+t);
 // org host with an empty name -> no empty span
 t=await live({...base,hostSlug:'team-a',host:''});
 assert.equal(t,when+' · 线上','empty org host -> '+t);
 // names present: unchanged
 t=await live({...base,hostSlug:'team-a',host:'运营组'});
 assert.equal(t,when+' · 线上 · <span class="lk-link">运营组</span>','org host unchanged -> '+t);
 t=await live({...base,hostId:'',host:'运营组'});
 assert(t.startsWith(when+' · 线上 · ')&&t.includes('运营组')&&!/·\s*$/.test(t),'person host unchanged -> '+t);
 console.log('HOST_R16_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


def node(script, rel):
    return subprocess.run(['node', '-e', script, str(ROOT), rel], capture_output=True, text=True)


class LG6CR16(unittest.TestCase):
    def test_mentions_with_prototype_key_names(self):
        result = node(MENTIONS, 'preview/thread.js')
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertIn('MENTIONS_PASS', result.stdout)

    def test_mentions_pre_change_fails(self):
        self.assertNotEqual(node(MENTIONS, BEFORE_DIR + 'before-thread.js').returncode, 0, 'the pre-change file must fail this test')

    def test_host_link_empty_name(self):
        result = node(HOST, 'preview/events.js')
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertIn('HOST_R16_PASS', result.stdout)

    def test_host_link_pre_change_fails(self):
        self.assertNotEqual(node(HOST, BEFORE_DIR + 'before-events.js').returncode, 0, 'the pre-change file must fail this test')


if __name__ == '__main__':
    unittest.main()

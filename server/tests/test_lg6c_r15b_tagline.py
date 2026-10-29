"""LG-6C R15b: the event detail tag line joins only non-empty parts (when · place · host) (offline VM).

Applies to live and demo alike; the only demo change is that an empty part no longer leaves a bare separator.
The mutation test runs the same script against the pre-change copy in docs/evidence/LG-6C/r15/, which must FAIL.
"""
from pathlib import Path
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_lg6c_r13_pages import EVENTS as R13_EVENTS  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BEFORE = 'docs/evidence/LG-6C/r15/before-events-r15b.js'

HARNESS = R13_EVENTS[:R13_EVENTS.index('(async()=>{')]

TAGLINE = HARNESS + r'''
(async()=>{
 const base={id:'ev1',kind:'challenge',title:'活动',summary:'s',startsAt:'2026-10-28T10:00:00Z',endsAt:'2026-10-29T10:00:00Z',status:'live',signups:0,hostId:'',host:'运营组',place:''};
 const tags=html=>{const m=/<div class="evt-detail-tags">[\s\S]*?<span>([\s\S]*?)<\/span><\/div>/.exec(html);assert(m,'tag line rendered');return m[1];};
 const live=async ev=>{
  const e=JSON.parse(JSON.stringify(ev));
  const c=make({get:{'/events':[e],'/events/campaigns':[],'/events/ev1':e},post:{}},'#/event/ev1');
  c.CommonsSession={hasRole:()=>false,can:()=>true};
  c.CommonsEvents.mount();await tick();c.rootN.innerHTML=c.CommonsEvents.routes.event();return tags(c.rootN.innerHTML);};
 const demo=ev=>{
  const c=make({get:{},post:{}},'#/event/ev1');c.CommonsAPI.mode='demo';
  c.COMMONS_EVENTS_SAMPLE={viewer:{},people:{},campaigns:[],events:[JSON.parse(JSON.stringify(ev))]};
  c.rootN.querySelector=()=>null;return tags(c.CommonsEvents.routes.event());};
 const when='10.28–10.29';
 for(const [name,run] of [['live',live],['demo',demo]]){
  // place empty, host present: no doubled separator
  let t=await run(base);
  assert.equal(t,when+' · 运营组',name+': place empty -> '+t);
  assert(!/·\s*·/.test(t),name+': no consecutive separators');
  // everything present: unchanged
  t=await run({...base,place:'线上'});
  assert.equal(t,when+' · 线上 · 运营组',name+': full line unchanged -> '+t);
  // host empty: no trailing separator
  t=await run({...base,host:'',place:'线上'});
  assert(t.startsWith(when+' · 线上')&&!/·\s*$/.test(t),name+': no trailing separator -> '+t);
  // time empty
  t=await run({...base,startsAt:'',endsAt:'',place:'线上'});
  assert(!/^\s*·/.test(t)&&t.includes('线上'),name+': no leading separator -> '+t);
 }
 console.log('EVENTS_R15B_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


def node(rel):
    return subprocess.run(['node', '-e', TAGLINE, str(ROOT), rel], capture_output=True, text=True)


class LG6CR15bTagline(unittest.TestCase):
    def test_tag_line_skips_empty_parts(self):
        result = node('preview/events.js')
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertIn('EVENTS_R15B_PASS', result.stdout)

    def test_tag_line_pre_change_fails(self):
        self.assertNotEqual(node(BEFORE).returncode, 0, 'the pre-change file must fail this test')


if __name__ == '__main__':
    unittest.main()

"""LG-6C R15: real-mode event detail does not draw the demo-only discussion shell (offline VM).

Events are not content objects and have no reply API, so live mode shows no 讨论 section and never mounts
CommonsThread; demo mode keeps the section and mounts the thread. The mutation test runs the same script against
the pre-change copy in docs/evidence/LG-6C/r15/, which must FAIL.
"""
from pathlib import Path
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_lg6c_r13_pages import EVENTS as R13_EVENTS  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BEFORE = 'docs/evidence/LG-6C/r15/before-events.js'

HARNESS = R13_EVENTS[:R13_EVENTS.index('(async()=>{')]

THREAD = HARNESS + r'''
(async()=>{
 const ev={id:'ev1',kind:'challenge',title:'进行中活动',summary:'s',startsAt:'2020-01-01',endsAt:'2099-01-02',status:'live',signups:2,signedUp:false,submitted:false};
 const mkLive=()=>{
  const e=JSON.parse(JSON.stringify(ev));
  const c=make({get:{'/events':[e],'/events/campaigns':[],'/events/ev1':e},post:{}},'#/event/ev1');
  c.mounted=[];c.CommonsThread={mount(h,o){c.mounted.push(o)},destroy(){}};
  c.CommonsSession={hasRole:()=>false,can:()=>true};
  return c;};
 // live: no discussion section, thread never mounted, also not after the data arrives
 let c=mkLive();c.CommonsEvents.mount();await tick();
 c.rootN.innerHTML=c.CommonsEvents.routes.event();c.CommonsEvents.mount();await tick();
 assert(c.rootN.innerHTML.includes('进行中活动'),'detail rendered');
 assert(!c.rootN.innerHTML.includes('data-evt-thread')&&!c.rootN.innerHTML.includes('evt-thread-wrap'),'live: no discussion section');
 assert.equal(c.mounted.length,0,'live: CommonsThread.mount is not called');
 // demo: the section and the thread mount are unchanged
 const d=make({get:{},post:{}},'#/event/ev1');d.CommonsAPI.mode='demo';
 d.COMMONS_EVENTS_SAMPLE={viewer:{},people:{},campaigns:[],events:[{id:'ev1',kind:'challenge',title:'示例活动',summary:'s',startsAt:'2020-01-01',endsAt:'2099-01-02',status:'live',comments:[]}]};
 d.mounted=[];d.CommonsThread={mount(h,o){d.mounted.push(o)},destroy(){}};
 d.rootN.querySelector=s=>s==='[data-evt-thread]'?node():null;
 d.rootN.innerHTML=d.CommonsEvents.routes.event();
 assert(d.rootN.innerHTML.includes('data-evt-thread')&&d.rootN.innerHTML.includes('evt-thread-wrap'),'demo keeps the discussion section');
 d.CommonsEvents.mount();
 assert.equal(d.mounted.length,1,'demo mounts the thread');
 console.log('EVENTS_R15_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


def node(script, rel):
    return subprocess.run(['node', '-e', script, str(ROOT), rel], capture_output=True, text=True)


class LG6CR15Thread(unittest.TestCase):
    def test_live_event_has_no_demo_thread(self):
        result = node(THREAD, 'preview/events.js')
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertIn('EVENTS_R15_PASS', result.stdout)

    def test_live_event_thread_pre_change_fails(self):
        result = node(THREAD, BEFORE)
        self.assertNotEqual(result.returncode, 0, 'the pre-change file must fail this test')


if __name__ == '__main__':
    unittest.main()

"""LG-6C R14: events.js capability gates, driven by CommonsSession.can (offline VM).

events.manage decides the 「创建活动」 entry (not roles); events.submit disables 「提交作品」 with a hint.
The mutation test runs the same script against the pre-change copy in docs/evidence/LG-6C/r14/, which must FAIL.
"""
from pathlib import Path
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_lg6c_r13_pages import APP_LIVE, EVENTS as R13_EVENTS, app_common  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BEFORE = 'docs/evidence/LG-6C/r14/before-events.js'

# Reuse the fake-DOM harness (everything before the test body) from the R13 script.
HARNESS = R13_EVENTS[:R13_EVENTS.index('(async()=>{')]

GATES = HARNESS + r'''
(async()=>{
 const live={id:'ev1',kind:'challenge',title:'进行中活动',summary:'s',startsAt:'2020-01-01',endsAt:'2099-01-02',status:'live',signups:2,signedUp:false,submitted:false};
 const mk=(caps,hash)=>{
  const e=JSON.parse(JSON.stringify(live));
  const c=make({get:{'/events':[e],'/events/campaigns':[],'/events/ev1':e},post:{}},hash);
  // hasRole says admin on purpose: the gate must follow can(), not roles.
  c.CommonsSession={hasRole:()=>true,can:a=>caps.includes(a)};
  c.Commons.refresh=function(){c.rootN.innerHTML=c.CommonsEvents.routes[hash.startsWith('#/event/')?'event':'events']();c.CommonsEvents.mount();};
  return c;};
 const page=async(caps,hash)=>{const c=mk(caps,hash);c.CommonsEvents.mount();await tick();
  c.rootN.innerHTML=c.CommonsEvents.routes[hash.startsWith('#/event/')?'event':'events']();c.CommonsEvents.mount();return c;};
 // events.manage: shown iff can() says so, whatever the roles are
 let c=await page([],'#/events');
 assert(!c.rootN.innerHTML.includes('data-evt-act="create-open"'),'no events.manage: no create entry even with host/admin role');
 c=await page(['events.manage'],'#/events');
 assert(c.rootN.innerHTML.includes('data-evt-act="create-open"'),'events.manage: create entry shown');
 // events.submit: locked -> disabled button + hint with growth link, no level number
 c=await page(['events.manage'],'#/event/ev1');
 let html=c.rootN.innerHTML;
 assert(/data-evt-act="submit"[^>]*disabled/.test(html),'submit button disabled without events.submit');
 assert(html.includes('data-evt-locked="submit"')&&html.includes('你现在的等级还不能提交作品')&&html.includes('href="#/growth"'),'hint with growth link');
 assert(!/L\d|\d+\s*级/.test(html.slice(html.indexOf('data-evt-locked'))),'no hard-coded level number');
 assert(html.includes('data-evt-act="signup"')&&!/data-evt-act="signup"[^>]*disabled/.test(html),'signup is unaffected');
 // events.submit: allowed -> unchanged button, no hint
 c=await page(['events.submit'],'#/event/ev1');
 html=c.rootN.innerHTML;
 assert(/data-evt-act="submit"/.test(html)&&!/data-evt-act="submit"[^>]*disabled/.test(html),'submit enabled with events.submit');
 assert(!html.includes('data-evt-locked'),'no hint when allowed');
 console.log('EVENTS_R14_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


def node(script, rel):
    return subprocess.run(['node', '-e', script, str(ROOT), rel], capture_output=True, text=True)


class LG6CR14Gates(unittest.TestCase):
    def test_events_gates_follow_can(self):
        result = node(GATES, 'preview/events.js')
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertIn('EVENTS_R14_PASS', result.stdout)

    def test_events_gates_pre_change_fails(self):
        result = node(GATES, BEFORE)
        self.assertNotEqual(result.returncode, 0, 'the pre-change file must fail this test')


class LG6CR14Profiles(unittest.TestCase):
    """#/people reads GET /social/profiles as data.items (the real router shape), not a bare array."""

    def run_app(self, original):
        common = app_common(True).replace('LG-6C/r13/before-app.js', 'LG-6C/r14/before-app.js') if original else app_common(False)
        return subprocess.run(['node', '-e', common + APP_LIVE.replace('ORIG', 'true' if original else 'false'), str(ROOT), ''],
                              capture_output=True, text=True)

    def test_people_members_read_data_items(self):
        result = self.run_app(False)
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertIn('APP_LIVE_PAGES_PASS', result.stdout)

    def test_people_members_pre_change_fails(self):
        self.assertNotEqual(self.run_app(True).returncode, 0, 'the pre-change app.js must fail this test')


if __name__ == '__main__':
    unittest.main()

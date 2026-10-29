"""LG-8A R14 · 团队目录「申请建团队」按 CommonsSession.can('orgs.create') 门控。"""
from __future__ import annotations

import subprocess
import unittest

from tests.test_lg8a_r13_members_teams import BEFORE, COMMON, ORGS_COMMON, ROOT

SCRIPT = r'''
const mk=(allowed,orgs)=>{
 const c=context({hash:'#/orgs',rootSel:'data-org-root'});
 c.routes['GET /orgs']={data:orgs,meta:{types:[{id:'lab',label:'实验室'}]}};
 c.asked=[];
 c.CommonsSession.can=a=>{c.asked.push(a);return allowed;};
 return c;
};
(async()=>{
 for(const orgs of [[],[teamRaw({state:'none',role:null})]]){
  const no=mk(false,orgs);
  startOrgs(no,'orgs'); await tick();
  assert.ok(no.page.includes('data-org-act="create" disabled'),'disabled when can() is false');
  assert.ok(no.page.includes('你现在的等级还不能建团队') && no.page.includes('href="#/growth"'),'explains + upgrade link');
  assert.ok(!/L\d/.test(no.page.split('data-org-locked')[1].split('</p>')[0]),'no hard-coded level number');
  assert.ok(no.page.includes('data-org-dialog'),'dialog rendered');
  assert.ok(no.asked.includes('orgs.create'));
  let opened=0;
  const dlg={showModal(){opened++;}};
  no.rootNode.querySelector=s=>s.includes('data-org-dialog')?dlg:null;
  click(no,btn('[data-org-act]',{orgAct:'create'}));
  assert.equal(opened,0,'locked button does not open the dialog');
  const yes=mk(true,orgs);
  startOrgs(yes,'orgs'); await tick();
  assert.ok(yes.page.includes('data-org-act="create">申请建团队'),'enabled when can() is true');
  assert.ok(!yes.page.includes('data-org-locked') && yes.page.includes('data-org-dialog'));
  let o2=0; yes.rootNode.querySelector=s=>s.includes('data-org-dialog')?{showModal(){o2++;}}:null;
  click(yes,btn('[data-org-act]',{orgAct:'create'}));
  assert.equal(o2,1,'enabled button opens the dialog');
 }
 console.log('GATE_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


def run(before=False):
    args = ['node', '-e', COMMON + ORGS_COMMON + SCRIPT, str(ROOT)] + ([str(BEFORE)] if before else [])
    return subprocess.run(args, capture_output=True, text=True, timeout=60)


class Lg8aR14Gate(unittest.TestCase):
    def test_create_entry_follows_can_in_empty_and_filled_directory(self):
        r = run()
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        self.assertIn('GATE_PASS', r.stdout)

    def test_scenario_fails_on_old_code(self):
        self.assertNotEqual(run(before=True).returncode, 0)


if __name__ == '__main__':
    unittest.main()

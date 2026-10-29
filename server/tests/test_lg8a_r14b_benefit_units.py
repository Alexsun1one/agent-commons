"""LG-8A R14b · #/benefits 把 count / megabyte / slot 写成中文单位。"""
from __future__ import annotations

import subprocess
import unittest

from tests.test_lg8a_r13_members_teams import BEFORE, COMMON, ROOT

SCRIPT = r'''
(async()=>{
 const c=context({hash:'#/benefits',rootSel:'data-people-root'});
 const row=(key,name,unit,period,quota,used)=>({key,name,description:'',minLevel:1,available:true,quota,unit,period,periodLabel:period==='month'?'2026-10 月':(period==='season'?'2026 赛季':'账号上限'),used,remaining:quota-used});
 c.routes['GET /membership/me']={data:{level:2,levelName:'队员',note:'',benefits:[
   row('rooms','讨论室','count','month',10,3),
   row('upload','上传额度','megabyte','season',1024,512),
   row('small','小额度','megabyte','season',200,50),
   row('seat','席位','slot','account',4,1),
   row('odd','奇怪项','widget','month',7,2)]},meta:{}};
 c.routes['GET /membership/benefits']={data:{level:3,levelName:'骨干',benefits:[
   {key:'rooms',available:true,quota:20,unit:'count',minLevel:1},
   {key:'upload',available:true,quota:4096,unit:'megabyte',minLevel:1},
   {key:'seat',available:true,quota:8,unit:'slot',minLevel:1}]},meta:{}};
 vm.runInContext(source('people'),c);
 const P=c.CommonsPeople;
 c.rerender=()=>{c.page=P.routes.benefits();P.mount();};
 c.rerender(); await tick();
 for(const code of ['count','megabyte','slot','widget']) assert.ok(!c.page.includes(code),'raw unit code leaked: '+code);
 assert.ok(c.page.includes('3 / 10 次'),'count -> 次');
 assert.ok(c.page.includes('0.5 / 1 GB'),'>=1024 MB -> GB');
 assert.ok(c.page.includes('50 / 200 MB'),'small stays MB');
 assert.ok(c.page.includes('1 / 4 个'),'slot -> 个');
 assert.ok(c.page.includes('2 / 7 ·'),'unknown unit shows no code');
 assert.ok(c.page.includes('升到 L3 后每月可用 20 次'),'period wording');
 assert.ok(c.page.includes('升到 L3 后每赛季可用 4 GB'),'GB upgrade');
 assert.ok(c.page.includes('升到 L3 后账号上限 8 个'),'account cap wording');
 assert.ok(!c.page.includes('每周期'),'no awkward 每周期');
 console.log('UNITS_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''


def run(before=False):
    args = ['node', '-e', COMMON + SCRIPT, str(ROOT)] + ([str(BEFORE)] if before else [])
    return subprocess.run(args, capture_output=True, text=True, timeout=60)


class Lg8aR14bUnits(unittest.TestCase):
    def test_units_are_chinese(self):
        r = run()
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        self.assertIn('UNITS_PASS', r.stdout)

    def test_fails_on_old_code(self):
        self.assertNotEqual(run(before=True).returncode, 0)


if __name__ == '__main__':
    unittest.main()

"""LG-6A R2 legal delivery, PWA lifetime and business mode isolation."""
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
import unittest
from . import test_lg6a_delivery as fixtures

ROOT = fixtures.ROOT

class LegalDeliveryTests(unittest.TestCase):
    setUp = fixtures.LiveDeliveryTests.setUp
    write = fixtures.LiveDeliveryTests.write
    build = fixtures.LiveDeliveryTests.build

    def test_five_full_legal_pages_with_table_links_and_source_hashes(self):
        legal = self.root / 'docs/legal'
        (legal / 'privacy.md').write_text('# 隐私政策\n\n完整正文 UNIQUE-LEGAL-BODY。\n\n[保留期限](retention.md)\n')
        (legal / 'retention.md').write_text('# 保留期限\n\n| 类别 | 期限 |\n|---|---|\n| 测试 | 未定义 |\n')
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stderr)
        stats = json.loads(result.stdout)
        output = self.root / 'delivery-live/legal'
        self.assertEqual({p.name for p in output.glob('*.html')}, {'privacy.html','terms.html','rules.html','age-18.html','retention.html'})
        privacy = (output / 'privacy.html').read_text()
        self.assertIn('UNIQUE-LEGAL-BODY', privacy)
        self.assertIn('href="retention.html"', privacy)
        self.assertIn('第三方投诉', privacy)
        self.assertNotIn('../docs/', privacy)
        self.assertIn('<table>', (output / 'retention.html').read_text())
        self.assertEqual(len(stats['legal_sources']), 5)
        for row in stats['legal_sources']:
            self.assertEqual(row['sha256'], hashlib.sha256((self.root / row['path']).read_bytes()).hexdigest())
        self.assertEqual(len([row for row in stats['files'] if row['path'].startswith('legal/')]), 5)

    def test_missing_or_empty_legal_document_fails_before_output(self):
        missing = self.root / 'docs/legal/terms.md'
        missing.unlink()
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('法律正文缺失', result.stderr)
        self.assertFalse((self.root / 'delivery-live').exists())
        missing.write_text('')
        self.assertIn('法律正文为空', self.build().stderr)

    def test_lazy_component_vendor_dependencies_are_required_and_copied(self):
        self.write('app.js', 'window.lazy=["vendor/hls.min.js","vendor/rrweb-player.css"];')
        missing = self.build()
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn('依赖未审核或缺失', missing.stderr)
        self.assertFalse((self.root / 'delivery-live').exists())
        self.write('vendor/hls.min.js', 'window.Hls=function(){};')
        self.write('vendor/rrweb-player.css', '.player{display:block}')
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stderr)
        for name in ['hls.min.js', 'rrweb-player.css']:
            self.assertEqual((self.root / 'delivery-live/vendor' / name).read_bytes(),
                             (self.preview / 'vendor' / name).read_bytes())

    def test_legal_docs_reference_and_inline_code_are_rejected(self):
        policy = self.root / 'docs/legal/privacy.md'
        for source in ['# policy\n[missing](../docs/private.md)', '# policy\n<script>run()</script>',
                       '# policy\n<a onclick="run()">x</a>', '# policy\n[x](javascript:alert(1))']:
            with self.subTest(source=source):
                policy.write_text(source)
                result = self.build()
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.root / 'delivery-live').exists())


class FrontendR2Tests(unittest.TestCase):
    def run_node(self, script, *paths):
        result = subprocess.run(['node', '-e', script, *map(str, paths)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_pwa_native_registration_retry_and_lifecycle_without_image_module(self):
        script = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(process.argv[1],'utf8');
function target(){const listeners=new Map();return {listeners,addEventListener(k,f){if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(f)},removeEventListener(k,f){listeners.get(k)?.delete(f)}};}
function size(t){return [...t.listeners.values()].reduce((n,s)=>n+s.size,0)}
function setup(protocol='https:',fail=false,deferred=false){
 const win=target(),doc=target(),sw=target(),reg=target(),worker=target();let calls=[],resolve;
 reg.active={scriptURL:'https://fixture.invalid/community/sw.js?v=app-1'};reg.installing=worker;reg.waiting=null;
 sw.controller=null;sw.getRegistration=()=>Promise.resolve(null);sw.register=(url,opts)=>{
  calls.push([url,opts]);if(fail&&calls.length===1)return Promise.reject(Error('offline'));
  return deferred?new Promise(r=>resolve=r):Promise.resolve(reg);
 };
 Object.assign(doc,{body:null,currentScript:{src:'https://fixture.invalid/community/app.hash.js'},querySelector:()=>null,querySelectorAll:()=>[]});
 const c=Object.assign(win,{document:doc,navigator:{serviceWorker:sw},location:{protocol,href:'https://fixture.invalid/community/index.html',hash:'#/home'},
  URL,Promise,Date,console,Commons:{read:(k,d)=>d,write:()=>true},matchMedia:()=>({matches:false})});
 c.window=c;vm.createContext(c);vm.runInContext(source,c);return {c,sw,reg,worker,win,doc,calls,resolve:()=>resolve(reg)};
}
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 const s=setup();s.c.CommonsPwa.mount();await tick();
 assert.equal(s.calls.length,1);assert.equal(s.calls[0][0],'https://fixture.invalid/community/sw.js?v=app-1');assert.equal(s.calls[0][1].updateViaCache,'none');
 assert.equal(size(s.win),2);assert.equal(size(s.sw),1);assert.equal(size(s.reg),1);
 [...s.reg.listeners.get('updatefound')][0]();assert.equal(size(s.worker),1);
 s.c.CommonsPwa.destroy();for(const t of [s.win,s.sw,s.reg,s.worker,s.doc])assert.equal(size(t),0);
 s.c.CommonsPwa.mount();await tick();assert.equal(s.calls.length,1);assert.equal(size(s.reg),1);s.c.CommonsPwa.destroy();
 const retry=setup('https:',true);retry.c.CommonsPwa.mount();await tick();retry.c.CommonsPwa.destroy();retry.c.CommonsPwa.mount();await tick();assert.equal(retry.calls.length,2);retry.c.CommonsPwa.destroy();
 const late=setup('https:',false,true);late.c.CommonsPwa.mount();await tick();late.c.CommonsPwa.destroy();late.resolve();await tick();assert.equal(size(late.reg),0);
 const file=setup('file:');file.c.CommonsPwa.mount();await tick();assert.equal(file.calls.length,0);file.c.CommonsPwa.destroy();
 console.log('PWA_NATIVE_LIFECYCLE_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''
        self.assertIn('PWA_NATIVE_LIFECYCLE_PASS', self.run_node(script, ROOT / 'preview/pwa.js'))

    def test_business_live_empty_network_error_retry_and_sample_poison(self):
        script = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync(process.argv[1],'utf8');let behavior='empty',calls=[],handlers={};
const root={innerHTML:'',getAttribute:()=> 'teams',contains:()=>true,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(k,f)=>handlers[k]=f,removeEventListener(){}};
const c={console,Promise,Date,Math,Number,String,Array,document:{activeElement:null,querySelector:s=>s==='[data-biz-root]'?root:null},location:{hash:'#/teams'},
 Commons:{esc:v=>String(v??''),safeUrl:v=>v,icon:()=>'',read:(k,v)=>v,write:()=>true},CommonsAPI:{mode:'live',get:p=>{calls.push(p);return behavior==='error'?Promise.reject(Error('SECRET-SERVER-DETAIL')):Promise.resolve({data:p==='/billing/plans'?{plans:[],benefits:[]}:null})}}};
Object.defineProperty(c,'COMMONS_BUSINESS_SAMPLE',{get(){throw Error('LIVE_READ_SAMPLE')}});c.window=c;vm.createContext(c);vm.runInContext(src,c);
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 for(const route of ['teams','creator','sponsor'])assert(c.CommonsBusiness.routes[route]().includes('暂无'),route);
 c.CommonsBusiness.mount();await tick();assert(root.innerHTML.includes('暂无团队方案'));assert.deepEqual(calls,['/billing/plans','/billing/me']);
 behavior='error';const button={tagName:'BUTTON',getAttribute:k=>k==='data-biz-act'?'retry':null};handlers.click({target:{closest:()=>button},preventDefault(){}});await tick();
 assert(root.innerHTML.includes('方案没有读到'));assert(root.innerHTML.includes('重试'));assert(!root.innerHTML.includes('SECRET-SERVER-DETAIL'));
 behavior='empty';handlers.click({target:{closest:()=>button},preventDefault(){}});await tick();assert(root.innerHTML.includes('暂无团队方案'));
 c.CommonsBusiness.destroy();console.log('BUSINESS_LIVE_ISOLATION_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''
        self.assertIn('BUSINESS_LIVE_ISOLATION_PASS', self.run_node(script, ROOT / 'preview/business.js'))

    def test_commercial_artwork_copies_are_byte_identical(self):
        names=['biz-members-club','biz-enterprise-team','biz-creator-earnings','biz-instructor-program','biz-sponsor-partners']
        for name in names:
            self.assertEqual((ROOT/'preview/assets/business'/f'{name}.webp').read_bytes(),
                             (ROOT/'preview/assets/samples'/f'{name}.webp').read_bytes())
        source=(ROOT/'preview/business.js').read_text()
        self.assertNotIn('assets/samples/',source)
        self.assertEqual(source.count('assets/business/'),5)


if __name__ == '__main__':
    unittest.main(verbosity=2)

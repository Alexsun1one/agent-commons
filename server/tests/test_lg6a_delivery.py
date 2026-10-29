"""LG-6A offline build gates; fixtures only, no service or network."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
BUILDER = ROOT / 'tools/build-delivery.py'


class LiveDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.preview = self.root / 'preview'
        self.preview.mkdir()
        self.write('index.html', '<html><head><link rel="stylesheet" href="site.css"></head>'
                   '<body><script src="api.js"></script><script src="data.js"></script>'
                   '<script src="fixture-sample.js"></script><script src="app.js"></script></body></html>')
        self.write('api.js', (ROOT / 'preview/api.js').read_text())
        self.write('site.css', "body{color:var(--ink)}.avatar{background-image:url('assets/fictional-members.png')}")
        self.write('data.js', 'window.COMMONS_DATA={people:[{name:"林杉"}]};')
        self.write('fixture-sample.js', 'window.COMMONS_FIXTURE_SAMPLE={name:"顾澄"};')
        self.write('app.js', 'if(!window.COMMONS_BUILD_LIVE){window.fixture="林杉";}window.LIVE_READY=true;')
        self.write('assets/fictional-members.png', 'fixture portrait')
        self.write('assets/samples/fake.webp', 'fixture work')
        self.write('assets/brand/icon.svg', '<svg/>')
        self.write('sw.js', "var PREFIX = 'commons-';\nvar PRECACHE_STATIC = ['fixture-sample.js', 'data.js'];")
        legal = self.root / 'docs/legal'
        legal.mkdir(parents=True)
        for stem in ['privacy', 'terms', 'community-rules', 'age-18', 'retention']:
            (legal / (stem + '.md')).write_text('# ' + stem + '\n\nDraft policy body.\n')

    def write(self, relative, text):
        path = self.preview / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def build(self):
        return subprocess.run([sys.executable, str(BUILDER), '--root', str(self.root), '--live'],
                              text=True, capture_output=True)

    def test_live_excludes_records_assets_and_precache_and_folds_demo_branch(self):
        before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in self.preview.rglob('*') if p.is_file()}
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stderr)
        stats = json.loads(result.stdout)
        output = self.root / 'delivery-live'
        self.assertEqual(stats['mode'], 'live')
        self.assertIn('content="live"', (output / 'index.html').read_text())
        self.assertNotIn('<script>', (output / 'index.html').read_text())
        self.assertFalse((output / 'data.js').exists())
        self.assertFalse((output / 'fixture-sample.js').exists())
        self.assertFalse((output / 'assets/fictional-members.png').exists())
        self.assertFalse((output / 'assets/samples/fake.webp').exists())
        self.assertTrue((output / 'assets/brand/icon.svg').exists())
        self.assertNotIn('fictional-members', (output / stats['css_bundle']).read_text())
        self.assertNotIn('林杉', (output / stats['js_bundle']).read_text())
        worker = (output / 'sw.js').read_text()
        self.assertNotIn('-sample.js', worker)
        self.assertIn(stats['js_bundle'], worker)
        self.assertIn('commons-live-', worker)
        check = subprocess.run(['node', '--check', str(output / stats['js_bundle'])], capture_output=True, text=True)
        self.assertEqual(check.returncode, 0, check.stderr)
        after = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in self.preview.rglob('*') if p.is_file()}
        self.assertEqual(before, after)

    def test_embedded_renamed_sample_data_rejected(self):
        self.write('app.js', 'window.COMMONS_HIDDEN_SAMPLE={items:[{title:"fake"}]};')
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('示例数据定义', result.stderr)

    def test_escaped_fictional_identity_rejected(self):
        self.write('app.js', r'window.person="\u6797\u6749";')
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('合成记录指纹', result.stderr)

    def test_sample_script_reference_rejected(self):
        self.write('app.js', 'window.lazy="hidden-sample.js";')
        self.assertIn('示例脚本', self.build().stderr)

    def test_parent_docs_reference_rejected(self):
        self.write('app.js', 'window.url="../docs/legal.md";')
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('../docs/', result.stderr)

    def test_transform_failure_never_ships_original(self):
        self.write('app.js', 'window.BROKEN = ;')
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('transform', result.stderr)
        self.assertFalse((self.root / 'delivery-live').exists())

    def test_nonempty_output_is_preserved_and_rejected(self):
        output = self.root / 'delivery-live'
        output.mkdir()
        sentinel = output / 'other.txt'
        sentinel.write_text('keep')
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(sentinel.read_text(), 'keep')
        self.assertIn('空目录', result.stderr)

    def test_inline_executable_html_rejected(self):
        for fragment in ['<script>window.BAD=true</script>', '<button onclick="run()">x</button>',
                         '<iframe srcdoc="bad"></iframe>']:
            with self.subTest(fragment=fragment):
                self.write('index.html', '<html><head></head><body>' + fragment + '</body></html>')
                result = self.build()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('线上入口不得包含', result.stderr)

    def test_unreviewed_script_rejected(self):
        self.write('index.html', '<html><head></head><script src="renamed.js"></script></html>')
        self.write('renamed.js', 'window.people=[{name:"unknown fixture"}];')
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('未审核的线上脚本', result.stderr)

    def test_missing_resource_rejected(self):
        self.write('index.html', '<html><head></head><script src="missing.js"></script></html>')
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('missing.js', result.stderr)

    def test_preview_destination_rejected_without_mutation(self):
        before = (self.preview / 'index.html').read_bytes()
        result = subprocess.run([sys.executable, str(BUILDER), '--root', str(self.root), '--live',
                                 '--output', str(self.preview / 'live')], text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(before, (self.preview / 'index.html').read_bytes())

    def test_live_api_mode_overrides_demo_configuration_and_errors_never_fallback(self):
        script = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(process.argv[1],'utf8');
function context(protocol,meta,build,forced){
 let calls=0;
 const c={Object,Error,Uint8Array,Promise,location:{protocol},
  COMMONS_BUILD:build&&{mode:build},COMMONS_BUILD_LIVE:forced,
  COMMONS_DATA:{people:[{name:'POISON'}]},COMMONS_FIELDWORK:{items:[{title:'POISON'}]},
  document:{querySelector:()=>meta&&{content:meta}},
  fetch:()=>{calls++;return Promise.reject(new Error('offline'));}};
 c.window=c;vm.createContext(c);vm.runInContext(source,c);return {c,calls:()=>calls};
}
(async()=>{
 for(const args of [['https:',null,null,false],['file:','live',null,false],['file:','demo','demo',true]]){
  const {c,calls}=context(...args);assert.equal(c.CommonsAPI.mode,'live');
  assert.equal(c.COMMONS_DATA.people.length,0);assert.equal(c.COMMONS_FIELDWORK.items.length,0);
  assert(Object.isFrozen(c.COMMONS_DATA));
  await assert.rejects(c.CommonsAPI.get('/me'),e=>e.code==='network_error');assert.equal(calls(),1);
 }
 const {c,calls}=context('https:','demo',null,false);assert.equal(c.CommonsAPI.mode,'demo');
 await assert.rejects(c.CommonsAPI.get('/me'),e=>e.code==='demo_mode');assert.equal(calls(),0);
 assert.equal(c.COMMONS_DATA.people[0].name,'POISON');
 console.log('API_MODE_AND_FAILURE_PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
'''
        result = subprocess.run(['node', '-e', script, str(ROOT / 'preview/api.js')], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('API_MODE_AND_FAILURE_PASS', result.stdout)

    def test_shell_without_data_renders_legacy_empty_states_and_isolates_demo_storage(self):
        script = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(process.argv[1],'utf8');
function run(poison,live=true){
 const listeners={},nodes={};
 function node(){return {innerHTML:'',textContent:'',open:false,inert:false,dataset:{},
  classList:{contains:()=>false,toggle(){},add(){},remove(){}},
  setAttribute(){},removeAttribute(){},getAttribute(){return null},
  addEventListener(){},querySelector(){return null},querySelectorAll(){return []},
  insertAdjacentHTML(){},focus(){},close(){},getClientRects(){return []}};}
 for(const key of ['#main','#sidebar','#topbar','#mobile-nav','#dialog','#dialog-title','#dialog-body','#toast','.app-shell','.app-footer'])nodes[key]=node();
 const stored={'commons.prototype.saved':JSON.stringify(['POISON'])};
 const redirects=[];
 const c={console,URL,Map,Set,Promise,Object,String,Number,Array,Boolean,Math,JSON,Date,
  COMMONS_BUILD_LIVE:live,COMMONS_DATA:poison,CommonsAPI:{mode:live?'live':'demo'},
  CommonsSession:{state:'member',me:{handle:'fixture',display_name:'真实成员',level:2,roles:[]},refresh:()=>Promise.resolve(null)},
  CommonsPages:[{routes:{hello:()=>'<section>访客页</section>'}}],
  location:{protocol:'https:',hash:'#/home',replace(h){redirects.push(h)}},
  innerWidth:1440,crypto:{randomUUID:()=> 'fixture'},CSS:{escape:s=>s},
  setTimeout:()=>1,clearTimeout(){},queueMicrotask:()=>{},scrollTo(){},
  matchMedia:()=>({matches:true}),addEventListener:(k,f)=>listeners[k]=f,
  localStorage:{getItem:k=>stored[k]??null,setItem:(k,v)=>stored[k]=v},
  document:{body:node(),activeElement:null,querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],
   getElementById:id=>nodes['#'+id]||null,addEventListener(){},createElement:node},
  CommonsNavigation:{render:()=>'<nav></nav>',sync(){},mobile:()=>[]},
  CommonsMotion:{beforeRender(){},afterRender(){},closeDialog(){}},
 };
 const originalFooter='<span>先锋</span><span>数据与原型说明</span>';nodes['.app-footer'].innerHTML=originalFooter;
 if(!live)c.CommonsShowcase={home:()=>'<section>DEMO_HOME</section>',stopDemo(){}};
 c.window=c;vm.createContext(c);vm.runInContext(source,c);
 if(!live){assert.equal(nodes['.app-footer'].innerHTML,originalFooter);assert(nodes['#topbar'].innerHTML.includes('交互预览'));return;}
 for(const name of ['privacy','terms','rules','age-18','retention'])assert(nodes['.app-footer'].innerHTML.includes('legal/'+name+'.html'));
 assert(nodes['.app-footer'].innerHTML.includes('第三方投诉'));assert(!nodes['.app-footer'].innerHTML.includes('数据与原型说明'));assert(!nodes['#topbar'].innerHTML.includes('交互预览'));
 assert(nodes['#main'].innerHTML.includes('class="empty"'));
 for(const route of ['home','knowledge','knowledge/missing','people','people/p1','work/missing','workshop','opportunities','project','discuss']){
  c.location.hash='#/'+route;listeners.hashchange();
  assert(nodes['#main'].innerHTML.includes('class="empty"'),route);
  assert(!nodes['#main'].innerHTML.includes('暂无可显示的内容'),route);
  assert(!nodes['#main'].innerHTML.includes('POISON'),route);
 }
 assert.deepEqual(redirects,[],'空态页面不应跳转');
 c.location.hash='#/governance';listeners.hashchange();
 assert.deepEqual(redirects,['#/knowledge/govern'],'#/governance 跳到知识治理页');
 assert.equal(c.Commons.person('missing').name,'');
 assert.equal(c.Commons.read('saved',[]).length,0);
 c.Commons.write('saved',['live']);assert.equal(stored['commons.prototype.saved'],'["POISON"]');
 assert.equal(stored['commons.live.saved'],'["live"]');
 c.CommonsShowcase={home:()=>'<section>LIVE_HOME</section>',stopDemo(){}};c.location.hash='#/home';c.Commons.refresh();assert(nodes['#main'].innerHTML.includes('LIVE_HOME'));
 c.location.hash='#/hello';c.Commons.refresh();assert(nodes['#main'].innerHTML.includes('访客页'));assert(nodes['#main'].innerHTML.includes('第三方投诉'));
}
run(undefined);run({people:[{id:'p1',name:'POISON'}],works:[{title:'POISON'}],methods:[{title:'POISON'}]});
run({people:[],works:[],methods:[],goals:[],topics:[],opportunities:[]},false);
console.log('SHELL_EMPTY_AND_POISON_ISOLATION_PASS 22 routes; live legal/complaint links; demo chrome preserved');
'''
        result = subprocess.run(['node', '-e', script, str(ROOT / 'preview/app.js')], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('SHELL_EMPTY_AND_POISON_ISOLATION_PASS', result.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=2)

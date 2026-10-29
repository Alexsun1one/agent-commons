"""LG-6C R15: thread.js formatBody splits code / link / plain text segments (offline VM).

@mentions only apply to plain text; links and code stay intact; link text is escaped once.
The mutation test runs the same script against the pre-change copy in docs/evidence/LG-6C/r15/, which must FAIL.
"""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]
BEFORE = 'docs/evidence/LG-6C/r15/before-thread.js'

SCRIPT = r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync(process.argv[1]+'/'+process.argv[2],'utf8');
// formatBody is private to thread.js; lift it and its helpers out of the source and run them in a VM.
const lift=name=>{const i=src.indexOf('  function '+name+'(');assert(i>=0,'missing '+name);const j=src.indexOf('\n  }\n',i);return src.slice(i,j+5);};
const code=['esc','safeUrl','peopleOf','inlineMention','formatBody'].map(lift).join('\n')+'\nthis.formatBody=formatBody;';
const c={String,Object,Array,RegExp,encodeURIComponent,sample:()=>({people:[]}),agentLink:(id,l)=>'<a class="lk-agent">'+l+'</a>'};
vm.createContext(c);vm.runInContext(code,c);
const people=[{id:'p1',name:'小明',handle:'xm'},{id:'p2',name:'小明明',handle:'xmm'}];
const f=t=>c.formatBody(t,{people});
const mention=(n,h)=>'<span class="th-mention"><a class="lk-person" href="#/u/'+h+'">@'+n+'</a></span>';
// 1. plain @name
assert.equal(f('你好 @小明 在吗'),'你好 '+mention('小明','xm')+' 在吗');
// longest name wins, and generated markup is not matched again
assert.equal(f('@小明明'),mention('小明明','xmm'));
// 2. link containing @name: the href is untouched, no mention span inside the tag
let h=f('看 https://example.com/@小明/post 吧');
assert.equal(h,'看 <a href="https://example.com/@小明/post" rel="noopener noreferrer">https://example.com/@小明/post</a> 吧');
assert(!h.includes('th-mention'));
// link text is escaped once (& stays &amp;, not &amp;amp;), href too
h=f('https://example.com/?a=1&b=2');
assert.equal(h,'<a href="https://example.com/?a=1&amp;b=2" rel="noopener noreferrer">https://example.com/?a=1&amp;b=2</a>');
// 3. code containing @name stays literal
h=f('用 `@小明 说` 然后 @小明');
assert.equal(h,'用 <code>@小明 说</code> 然后 '+mention('小明','xm'));
// html in plain text / code / link is still escaped; newline still becomes <br>
h=f('<b>x</b>\n`<i>`');
assert.equal(h,'&lt;b&gt;x&lt;/b&gt;<br><code>&lt;i&gt;</code>');
assert(!f('"><script>').includes('<script>'));
// no people: no mention regex, text still escaped
assert.equal(c.formatBody('@谁 & 你',{people:[]}),'@谁 &amp; 你');
console.log('FORMATBODY_PASS');
'''


def node(rel):
    return subprocess.run(['node', '-e', SCRIPT, str(ROOT), rel], capture_output=True, text=True)


class LG6CR15FormatBody(unittest.TestCase):
    def test_format_body_segments(self):
        result = node('preview/thread.js')
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertIn('FORMATBODY_PASS', result.stdout)

    def test_format_body_pre_change_fails(self):
        self.assertNotEqual(node(BEFORE).returncode, 0, 'the pre-change file must fail this test')


if __name__ == '__main__':
    unittest.main()

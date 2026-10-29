// Offline event/HTML contract checks, not browser or visual acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../../../../preview/govern.js'), 'utf8');
const listeners = new Map();
const root = { innerHTML: '' };
const calls = [];
let failSubmit = true;
const document = {
  activeElement: null,
  querySelector: selector => selector === '[data-gov-root]' ? root : null,
  querySelectorAll: () => [],
  addEventListener: (name, fn) => listeners.set(name, fn),
  removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); }
};
const window = {
  CommonsAPI: {
    mode: 'live',
    get: () => Promise.reject({ code: 'unauthenticated' }),
    post: (url, body) => {
      calls.push({ url, body });
      return failSubmit ? Promise.reject(new Error('private server diagnostic'))
        : Promise.resolve({ data: { id: 'receipt-123', state: 'pending' } });
    }
  }
};
vm.runInNewContext(source, { window, document });
const moduleView = window.CommonsGovern;
function input(name, value) {
  listeners.get('input')({ target: {
    value, closest: () => root,
    getAttribute: key => key === 'data-gov-input' ? 'complaint-' + name : null
  } });
}
function submit() {
  const element = { closest: () => root, disabled: false,
    getAttribute: key => key === 'data-gov-act' ? 'complaint-submit' : null };
  listeners.get('click')({ target: { closest: () => element }, preventDefault() {} });
}
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  assert.match(moduleView.routes.govern(), /第三方投诉（无需登录）/);
  moduleView.mount();
  await flush();
  assert.match(root.innerHTML, /第三方投诉（无需登录）/);
  assert.doesNotMatch(root.innerHTML, /治理台没有加载出来/);
  submit();
  assert.equal(calls.length, 0);
  input('locator', '<img src=x onerror=alert(1)>');
  input('statement', '第三方投诉说明');
  submit();
  assert.match(root.innerHTML, /disabled aria-busy="true"/);
  await flush();
  assert.match(root.innerHTML, /重试提交/);
  assert.match(root.innerHTML, /&lt;img/);
  assert.doesNotMatch(root.innerHTML, /private server diagnostic/);
  failSubmit = false;
  submit();
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, '/governance/complaints');
  assert.equal(calls[1].body.statement, '第三方投诉说明');
  assert.match(root.innerHTML, /receipt-123/);
  input('locator', 'transient-private-location');
  input('statement', 'transient-private-statement');
  let finish;
  window.CommonsAPI.post = () => new Promise(resolve => { finish = resolve; });
  submit();
  moduleView.destroy();
  finish({ data: { id: 'late-receipt', state: 'pending' } });
  await flush();
  assert.doesNotMatch(moduleView.routes.govern(), /transient-private|late-receipt/);
  assert.equal(listeners.size, 0);
  console.log('PASS: anonymous form, validation, escaped values, retry, receipt, draft cleanup, stale-response isolation, listener teardown');
})().catch(err => { console.error(err); process.exitCode = 1; });

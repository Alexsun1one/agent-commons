// 独立于 WebGL 装配加载，renderer 构造失败时仍有可操作的重试入口。
const loader = document.getElementById('x-loading');
const error = document.getElementById('x-error');
const progress = document.getElementById('x-progress');
const status = document.getElementById('x-load-status');
let timer;
function update() {
  const state = document.body.dataset.state;
  if (state === 'ready') {
    progress.value = 6; status.textContent = '已就绪'; loader.setAttribute('aria-hidden', 'true');
    clearInterval(timer); observer.disconnect(); return;
  }
  if (state === 'webgl-error' || state === 'error') {
    loader.hidden = true; error.hidden = false;
    document.getElementById('x-error-text').textContent = state === 'webgl-error' ? '此设备暂时无法打开三维空间，请重试或更换支持 WebGL 的浏览器。' : '空间加载失败，请重试。';
    clearInterval(timer); observer.disconnect(); return;
  }
  const count = Object.keys(window.__xgate?.places || {}).length;
  if (count) { progress.value = count; status.textContent = `装配空间 ${count}/5`; }
}
const observer = new MutationObserver(update); observer.observe(document.body, { attributes: true, attributeFilter: ['data-state'] });
document.getElementById('x-retry').addEventListener('click', () => location.reload());
window.addEventListener('error', event => {
  if (!window.__xgate?.ready && (event.target?.tagName === 'SCRIPT' || event.error)) { document.body.dataset.state ||= 'error'; update(); }
}, true);
timer = setInterval(update, 150); update();

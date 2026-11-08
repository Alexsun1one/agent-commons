export function el(tag, className = '', text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
export function button(label, action, className = 'x-btn') {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
export function tag(text, kind = 'local') { return el('span', `x-tag ${kind}`, text); }
// 空状态：熊猫插画 + 一句话；按钮由调用方追加。插画文件缺失时自行摘掉，不留破图。
export function empty(text, illus = 'empty-no-content') {
  const node = el('div', 'x-empty');
  const image = el('img', 'x-empty-illus'); image.src = `/assets/illus/${illus}.webp`; image.alt = ''; image.width = 160; image.loading = 'lazy';
  image.addEventListener('error', () => image.remove(), { once: true });
  node.append(image, el('p', '', text));
  return node;
}
export function dateLabel(at) {
  const date = new Date(at);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN') : '';
}
// 线性图标，24 格坐标；描边样式在 style.css 的 .x-icon。
const ICONS = {
  gate: '<path d="M4 21V11a8 8 0 0 1 16 0v10"/><path d="M9 21v-4.5a3 3 0 0 1 6 0V21"/><path d="M2.5 21h19"/>',
  network: '<circle cx="12" cy="5.5" r="2.5"/><circle cx="5.5" cy="18" r="2.5"/><circle cx="18.5" cy="18" r="2.5"/><path d="M10.9 7.7 6.6 15.8M13.1 7.7l4.3 8.1M8 18h8"/>',
  hub: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
  cocreation: '<circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/>',
  value: '<path d="M3.5 17.5 9 11.5l4 3.5 7.5-9"/><path d="M15 6h5.5v5.5"/>',
  messages: '<path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6.5L8 21v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>',
  spark: '<path d="M12 3.5l2.1 6.4 6.4 2.1-6.4 2.1L12 20.5l-2.1-6.4L3.5 12l6.4-2.1z"/>',
  pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6h5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.6 8.4-2 5.2-5.2 2 2-5.2z"/>',
  bolt: '<path d="M13 3 5 13.5h6l-1 7.5 8-10.5h-6z"/>',
  graph: '<circle cx="5.5" cy="12" r="2.5"/><circle cx="18.5" cy="5.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/><path d="m7.8 10.9 8.4-4.3M7.8 13.1l8.4 4.3"/>',
  folder: '<path d="M3.5 7a2 2 0 0 1 2-2H10l2 2.5h6.5a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  agent: '<rect x="4.5" y="8" width="15" height="11" rx="3"/><path d="M12 8V4.5M9.5 13v1.2M14.5 13v1.2"/>',
  flow: '<rect x="3.5" y="4" width="7" height="5.5" rx="1.4"/><rect x="13.5" y="14.5" width="7" height="5.5" rx="1.4"/><path d="M7 9.5V15a2 2 0 0 0 2 2h4.5"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.6 15.6 12 10 15.4z"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  frame: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="16" cy="9.5" r="1.2"/><path d="m3.5 16 4.7-4.7 4 4 2.8-2.8 5.5 5.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8.5 3v4M15.5 3v4"/>',
  trophy: '<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H4.5a3 3 0 0 0 3 4.5M16.5 6h3a3 3 0 0 1-3 4.5M12 13.5V18M8.5 20h7"/>',
  ripple: '<circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="5.8"/><circle cx="12" cy="12" r="9.5"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.4 2.8 2.8L16 9.4"/>',
};
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'x-icon'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

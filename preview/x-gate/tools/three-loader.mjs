// 与开发服务使用同一份锁定版本的 three。
const root = new URL('../../../tools/vendor/node_modules/three/', import.meta.url);
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: new URL('build/three.module.js', root).href, shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: new URL('examples/jsm/' + spec.slice(13), root).href, shortCircuit: true };
  return next(spec, ctx);
}

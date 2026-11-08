// 世界布局契约。单位米，Y 向上。
// 每座建筑在自己的局部坐标里建模：地面 y=0（岛面/平台顶），正门朝 +Z。
// main.js 把建筑放到 position，并自动绕 Y 旋转让 +Z 正门朝向总部（总部自身朝 +Z 不转）。
export const PLACES = {
  base:       { name: '中央总部',     en: 'X-GATE BASE',   position: [0, 0, 0],       island: 170, envelope: { halfWidth: 120, halfDepth: 110, height: 260 } },
  network:    { name: '智能体连接中心', en: 'AGENT NETWORK', position: [-300, 46, 30],   island: 78,  envelope: { radius: 55, height: 140 } },
  hub:        { name: '智能体管理中心', en: 'AGENT HUB',     position: [300, -6, 30],   island: 78,  envelope: { radius: 55, height: 120 } },
  cocreation: { name: '社区共创中心',   en: 'CO-CREATION',   position: [-210, 20, -250], island: 82,  envelope: { radius: 58, height: 130 } },
  value:      { name: '价值中心',      en: 'VALUE CITY',    position: [210, 64, -250],  island: 82,  envelope: { radius: 58, height: 170 } },
};

// 总部内部迎宾大厅，在总部局部坐标里：base-interior.js 建在这个盒子内，base.js 的外墙必须把它包住、正门洞口对准它。
export const BASE_INTERIOR = { min: [-44, 0.5, -70], max: [44, 46, 44] };
// 总部正门洞口（局部坐标）：门洞中心 x=0，底 y=0，宽 32、高 44，门洞外立面所在平面 z=PORTAL.z。
export const PORTAL = { width: 32, height: 44, z: 48 };

// 云海与环境高度。
export const ENV = { cloudTop: -55, cloudBottom: -140, skyRadius: 4000 };

// 渲染预算（quality=high）；low 档减半。check-module 会按这个表报超。
export const BUDGET = {
  base: { tris: 650_000, calls: 120 },          // 含内部大厅
  network: { tris: 240_000, calls: 45 },
  hub: { tris: 240_000, calls: 45 },
  cocreation: { tris: 240_000, calls: 45 },
  value: { tris: 240_000, calls: 45 },
  env: { tris: 500_000, calls: 90 },
};

export function facingRotation(id) {
  const [x, , z] = PLACES[id].position;
  if (id === 'base') return 0;
  return Math.atan2(-x, -z);
}

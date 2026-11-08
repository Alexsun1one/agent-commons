// 五个环境步道共用的 1.8 m 人形；全部零件合入已有材质批次。
export function addWalker(b, p, yaw, variant = 0) {
  b.push({ x:p.x, y:p.y, z:p.z, ry:yaw });
  const coat = variant % 3 === 0 ? 'shellCool' : 'ceramic';
  b.sphere(.16,{y:1.64},'graphite',8,5);
  b.cyl(.20,.16,.60,{y:1.18},coat,6);
  for (const side of [-1,1]) {
    b.cyl(.065,.08,.86,{x:side*.115,y:.43,rx:side*.10},'graphite',5);
    b.cyl(.055,.065,.62,{x:side*.26,y:1.14,rz:side*.13,rx:-side*.12},coat,5);
    b.box(.14,.10,.26,{x:side*.115,y:.05,z:.04},'graphite');
  }
  b.box(.09,.42,.025,{y:1.23,z:.18},'graphite');
  b.pop();
}
export function addServiceRobot(b, p, yaw) {
  b.push({x:p.x,y:p.y,z:p.z,ry:yaw});
  b.sphere(.42,{y:.68,sy:1.12,sz:.8},'ceramic',10,6);
  b.sphere(.32,{y:1.1,sy:.68,sz:.8},'ceramic',10,6);
  b.box(.40,.14,.05,{y:1.12,z:.25},'graphite');
  for(const side of [-1,1]) {
    b.sphere(.045,{x:side*.10,y:1.13,z:.285},'glowTeal',6,4);
    b.cyl(.16,.16,.14,{x:side*.32,y:.16,rz:Math.PI/2},'graphite',8);
  }
  b.pop();
}

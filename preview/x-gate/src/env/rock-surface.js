// 岩体静态程序表面：按岛局部坐标投影，避免大三角形上只有单色。
import * as THREE from 'three';

export function addRockCoordinates(geometry, island) {
  const p = geometry.attributes.position, coords = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    const depth = island.yT - p.getY(i);
    coords.set([p.getX(i) - island.cx, depth, p.getZ(i) - island.cz, Math.max(0, depth / island.depth)], i * 4);
  }
  geometry.setAttribute('rockLocal', new THREE.BufferAttribute(coords, 4));
}

export function createRockMaterial(base) {
  const material = base.clone();
  material.name = 'env:rock'; material.color.set(0xffffff); material.roughness = .97; material.metalness = 0; material.emissive.set(0x000000);
  material.userData.shared = false;
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 rockLocal; varying vec4 vRockLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRockLocal = rockLocal;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec4 vRockLocal;
      float rockHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float rockNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(rockHash(i),rockHash(i+vec2(1.,0.)),f.x),mix(rockHash(i+vec2(0.,1.)),rockHash(i+vec2(1.,1.)),f.x),f.y);}
    `).replace('#include <color_fragment>', `#include <color_fragment>
      float rockAngle=atan(vRockLocal.z,vRockLocal.x);
      vec2 rockQ=vec2(rockAngle*45.0,vRockLocal.y);
      float rockLong=rockNoise(rockQ*vec2(.48,.035));
      float rockFine=rockNoise(rockQ*vec2(2.2,.75));
      float jointWave=.5+.5*sin(rockAngle*111.0+rockLong*2.3+vRockLocal.y*.018);
      float rockJoint=smoothstep(.77,.96,jointWave);
      float faultWave=fract(vRockLocal.y*.065+rockNoise(vec2(rockAngle*9.0,2.0))*.8);
      float rockFault=smoothstep(.80,.96,faultWave);
      vec3 rockTint=mix(vec3(.26,.30,.38),vec3(.055,.08,.13),smoothstep(.01,.9,vRockLocal.w));
      float rockShade=.66+rockLong*.62+rockFine*.13-rockJoint*.48-rockFault*.34;
      diffuseColor.rgb*=rockTint*rockShade;
      float rockRelief=rockLong*.6+rockFine*.035-rockJoint*.24-rockFault*.20;
    `).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      // 世界米尺度的浅凹凸，保留原来岩锥和断层的几何法线。
      vec3 rockDX=dFdx(-vViewPosition),rockDY=dFdy(-vViewPosition);
      vec3 rockR1=cross(rockDY,normal),rockR2=cross(normal,rockDX);
      float rockDet=dot(rockDX,rockR1);
      vec3 rockGradient=sign(rockDet)*(dFdx(rockRelief)*rockR1+dFdy(rockRelief)*rockR2);
      float rockDetailFade=1.0-smoothstep(180.0,700.0,length(vViewPosition));
      vec3 rockBumpNormal=normalize(max(abs(rockDet),1e-8)*normal-rockGradient*1.2);
      normal=normalize(mix(normal,rockBumpNormal,rockDetailFade*.8));
    `);
  };
  material.customProgramCacheKey = () => 'env-rock-r8-v1';
  return material;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { rockTaper } from './islands.js';
import { build } from './index.js';
import { kit } from '../kit/kit.js';
import { createMaterials } from '../kit/materials.js';

test('Float32 岩尖越过 u=1 时仍有有限收缩值，非法输入明确抛错', () => {
  const height = 123.3, u = -Math.fround(-height) / height;
  assert(u > 1);
  assert(Number.isNaN(Math.pow(1-u,.7)), '复现未限幅的小数幂 NaN');
  for (const exponent of [.7,1.55]) {
    assert.equal(rockTaper(u,exponent),0);
    assert.equal(rockTaper(-1e-7,exponent),1);
    for(const t of [0,.16,.43,.73,1]) assert(Number.isFinite(rockTaper(t,exponent)));
  }
  assert.throws(()=>rockTaper(NaN,.7),RangeError);
});
for (const quality of ['high','low']) test(`${quality}: 实际环境岩体全属性与包围体有限`, () => {
  const env=build({kit,mats:createMaterials(),quality,reducedMotion:true,scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),renderer:null,pmrem:null});
  const rock=env.group.getObjectByName('env:rock');
  assert(rock?.geometry.attributes.rockLocal);
  for(const [name,attribute] of Object.entries(rock.geometry.attributes)) assert(attribute.array.every(Number.isFinite),name);
  rock.geometry.computeBoundingBox(); rock.geometry.computeBoundingSphere();
  assert(Number.isFinite(rock.geometry.boundingSphere.radius));
  assert([...rock.geometry.boundingBox.min.toArray(),...rock.geometry.boundingBox.max.toArray()].every(Number.isFinite));
  assert(env.islands.every(i=>i.rockLipDepth===4));
  env.dispose();
});

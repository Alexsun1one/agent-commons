import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {kit} from '../kit/kit.js';
import {createMaterials} from '../kit/materials.js';
import {blossomTrees,shrubs} from '../kit/flora.js';
import {build} from './index.js';
import {PLACES,facingRotation} from '../kit/world.js';

for(const quality of ['high','low']){
  test(`${quality}: shared flora accepts both point formats, deterministic crowns and finite transforms`,()=>{
    const ctx={kit,quality},points=[[0,0,0,1],{x:8,y:3,z:4,scale:1.4}];
    const tree=blossomTrees(ctx,points,{seed:19}),copy=blossomTrees(ctx,points,{seed:19}),bush=shrubs(ctx,points,{seed:5});
    assert(tree.isInstancedMesh&&bush.isInstancedMesh);
    assert(tree.userData.crownCounts.every(n=>n>=6&&n<=10));
    assert.deepEqual([...tree.instanceMatrix.array],[...copy.instanceMatrix.array]);
    for(const root of [tree,copy,bush]){root.traverse(o=>{if(o.isInstancedMesh)assert(o.instanceMatrix.array.every(Number.isFinite));});kit.disposeTree(root);}
    const empty=blossomTrees(ctx,[]);assert.equal(empty.count,0);kit.disposeTree(empty);
  });
  test(`${quality}: four camera decks, 32 distinct sky clouds, cloud relief and frozen motion`,()=>{
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),env=build({kit,mats:createMaterials(),quality,reducedMotion:true,scene,camera,renderer:null,pmrem:null});
    env.group.updateMatrixWorld(true);
    for(const [id,x,z] of [['network',-28,150],['hub',70,170],['cocreation',-30,150],['value',30,165]]){
      const p=new THREE.Vector3(x,30,z).applyAxisAngle(new THREE.Vector3(0,1,0),facingRotation(id)).add(new THREE.Vector3(...PLACES[id].position));
      const hit=new THREE.Raycaster(p,new THREE.Vector3(0,-1,0)).intersectObject(env.group,true).find(h=>h.object.name.startsWith('env:islands:'));
      assert(hit,id);assert(hit.point.y>=PLACES[id].position[1],id);if(id==='hub')assert(hit.point.y>7,'hub walkway clears HQ deck');
    }
    const clouds=env.group.getObjectByName('env:clouds'),sky=clouds.userData.skyClusters;
    assert.equal(sky.length,32);assert.equal(new Set(sky.map(c=>[c.width,c.height,c.lobes,c.seed].join(','))).size,32);
    assert.equal(clouds.userData.rootCloudLayers,3);
    const top=env.group.getObjectByName('env:cloud-layer-0');assert(top.geometry.attributes.position.count>1000);assert.equal(top.material.uniforms.uRelief.value,110);
    const crowns=env.group.getObjectByName('env:cloud-crowns'),matrix=new THREE.Matrix4(),scale=new THREE.Vector3();
    assert.equal(crowns.count,96);
    for(let i=0;i<crowns.count;i++){
      crowns.getMatrixAt(i,matrix);scale.setFromMatrixScale(matrix);
      assert(scale.y*2>=20&&scale.y*2<=60,'cloud crowns have 20–60 m vertical relief');
    }
    assert(env.forecourts.specs.every(s=>s.outsideLength>=60&&s.outsideLength<=90));
    env.update(83);assert.equal(crowns.material.uniforms.uTime.value,0);assert.equal(top.material.uniforms.uTime.value,0);assert.equal(env.flows.mesh.material.uniforms.uTime.value,0);
    env.dispose();
  });
}

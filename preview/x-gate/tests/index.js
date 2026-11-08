// Node 24 的显式目录入口；支持 node --test tests/ 目录入口。
import './shell.test.mjs';
import './data.test.mjs';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

// 几何检查独立运行，避免 DOM 夹具的假 canvas 进入材质创建；不创建浏览器。
for (const script of ['visible-bounds.mjs','r2-framing.mjs','r3-network-focus.mjs','split-framing.mjs','default-occlusion.mjs']) {
  test(`geometry: ${script}`, async () => {
    try {
      const {stdout}=await promisify(execFile)(process.execPath,['--import',new URL('../tools/register.mjs',import.meta.url).href,fileURLToPath(new URL(script,import.meta.url))],{timeout:60000});
      process.stdout.write(stdout);
    } catch (error) {
      process.stdout.write(error.stdout || '');process.stderr.write(error.stderr || '');
      throw error;
    }
  });
}

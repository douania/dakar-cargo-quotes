// Same gates as npm run ci, with envDir:false for Vite/Vitest and a live-network
// refusal guard for Vitest. Deno test has no --allow-net. No secret env file read.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const suffix=process.argv[2]||'';if(suffix&&!/^stage[0-9]+$/.test(suffix))throw Error('Invalid receipt suffix');
const tag=suffix?'-'+suffix:'';
const npm=process.platform==='win32'?'npm.cmd':'npm';
const steps=[
 ['function-config',process.execPath,['scripts/check-edge-function-config.mjs']],
 ['scenario-bundles',process.execPath,['scripts/check-scenario-bundles.mjs']],
 ['typecheck-app',process.execPath,['node_modules/typescript/bin/tsc','--noEmit','-p','tsconfig.app.json']],
 ['typecheck-node',process.execPath,['node_modules/typescript/bin/tsc','--noEmit','-p','tsconfig.node.json']],
 ['vitest',process.execPath,['node_modules/vitest/vitest.mjs','run','--config','scripts/railway-exit/ci-vitest.config.ts']],
 ['typecheck-deno',process.execPath,['scripts/check-deno-type-baseline.mjs']],
 ['test-deno',npm,['run','test:deno']],
 ['lint-baseline',process.execPath,['scripts/check-lint-baseline.mjs']],
 ['build',process.execPath,['node_modules/vite/bin/vite.js','build','--config','scripts/railway-exit/ci-vite.config.ts']],
];
const receipt={started_at:new Date().toISOString(),mode:'full local CI gates; env files disabled; live test transports refused',checks:[]};
for(const [name,cmd,args] of steps){
 const result=spawnSync(cmd,args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024,shell:cmd===npm});
 const output=(result.stdout||'')+(result.stderr||'');fs.writeFileSync(path.join(dir,'ci'+tag+'-'+name+'.log'),output);
 const check={name,exit_code:result.status,status:result.status===0?'PASS':'FAIL',log:'scripts/railway-exit/ci'+tag+'-'+name+'.log'};
 if(result.error)check.error=result.error.message;
 receipt.checks.push(check);console.log(JSON.stringify(check));
 if(result.status!==0){receipt.status='FAIL';break;}
}
receipt.status ||= 'PASS_WITH_BASELINE';receipt.finished_at=new Date().toISOString();fs.writeFileSync(path.join(dir,'verification-ci'+tag+'.json'),JSON.stringify(receipt,null,2)+'\n');
if(receipt.status==='FAIL')process.exitCode=1;

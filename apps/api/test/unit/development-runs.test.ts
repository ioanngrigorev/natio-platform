import {describe,it,expect} from 'vitest';
import {assertRunnable,requireRunManager,publicRun} from '../../src/modules/development/runs.js';
import {assertAllowedFiles,assertDeployable,deploymentState,runnerSettings} from '../../src/modules/development/runner-policy.js';
describe('agent delivery boundaries',()=>{
 it('rejects demo history, unreviewed tasks and missing acceptance criteria',()=>{
  const row={status:'todo',is_demo:false,data:{spec:{objective:'Build',acceptance:'Verify'},definition_of_done:'Tests pass'}};
  expect(()=>assertRunnable(row)).not.toThrow();
  for(const bad of [{...row,is_demo:true},{...row,status:'draft'},{...row,data:{}}])expect(()=>assertRunnable(bad)).toThrow();
 });
 it('never grants execution to a merchant or read-only staff',()=>{
  expect(()=>requireRunManager({kind:'merchant',manager:true,id:'a',mode:'test'})).toThrow();
  expect(()=>requireRunManager({kind:'admin',manager:false,id:'a',mode:'test'})).toThrow();
 });
 it('keeps snapshots and lease tokens out of browser responses',()=>expect(publicRun({id:'x',snapshot:{secret:'private'},lease_token:'secret'})).toEqual({id:'x'}));
 it('keeps infrastructure, credentials and controller code outside automatic delivery',()=>{
  for(const file of ['.env','.github/workflows/x.yml','deploy/self-update.sh','apps/api/src/modules/development/runner.ts','apps/api/src/db/migrations/x.sql','apps/web/app/../../bad','apps/web/app/.env.local','apps/web/app/AGENTS.md','package.json'])expect(()=>assertAllowedFiles([file])).toThrow();
  expect(()=>assertAllowedFiles(['apps/web/components/example.tsx','apps/api/test/unit/example.test.ts'])).not.toThrow();
  expect(()=>assertAllowedFiles([])).toThrow();
 });
 it('requires approval of the exact tested production commit',()=>{
  const r={target:'production',commit_sha:'a'.repeat(40),base_sha:'b'.repeat(40),approved_by:'admin',approved_sha:'a'.repeat(40)};
  expect(()=>assertDeployable(r)).not.toThrow();
  expect(()=>assertDeployable({...r,approved_sha:'c'.repeat(40)})).toThrow();
  expect(()=>assertDeployable({...r,approved_by:null})).toThrow();
  expect(deploymentState('production')).toBe('awaiting_approval');expect(deploymentState('test')).toBe('deploy_queued');
 });
 it('requires digest-pinned images and rejects configurable shell input',()=>{
  const cfg={repository:'https://github.com/example/project.git',ref:'main',root:'/srv/runs',image:'example/agent@sha256:'+'a'.repeat(64),model:'configured-model',testDeployHook:'/etc/natio/test-deploy'};
  expect(runnerSettings.safeParse(cfg).success).toBe(true);
  expect(runnerSettings.safeParse({...cfg,image:'agent:latest'}).success).toBe(false);
  expect(runnerSettings.safeParse({...cfg,command:'rm -rf /'}).success).toBe(false);
 });
});

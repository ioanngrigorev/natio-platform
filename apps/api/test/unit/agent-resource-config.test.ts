import {describe,it,expect} from 'vitest';
import {runnerSettings} from '../../src/modules/development/runner-policy.js';

const config={
 repository:'https://github.com/example/project.git',
 ref:'main',
 root:'/srv/runs',
 image:'sha256:'+'a'.repeat(64),
 testDeployHook:'/etc/natio/test-deploy',
 cpus:0.5,
 memory:'1100m',
 memorySwap:'3g',
 timeoutSeconds:7200,
};

describe('agent runner shared-host resource configuration',()=>{
 it('parses and preserves the shared-host resource limits',()=>{
  expect(runnerSettings.parse(config)).toMatchObject(config);
 });

 it.each([0.49,0,-1])('rejects cpus below 0.5: %s',(cpus)=>{
  expect(runnerSettings.safeParse({...config,cpus}).success).toBe(false);
 });

 it.each(['-1100m','-3g'])('rejects negative memory: %s',(memory)=>{
  expect(runnerSettings.safeParse({...config,memory}).success).toBe(false);
 });

 it.each(['invalid','3gb','-3g','1.5g',''])('rejects invalid memorySwap: %s',(memorySwap)=>{
  expect(runnerSettings.safeParse({...config,memorySwap}).success).toBe(false);
 });
});

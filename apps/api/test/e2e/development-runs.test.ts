import './env.js';
import {beforeAll,afterAll,beforeEach,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {startTestEnv,stopTestEnv,type TestEnv} from './setup.js';
import {getPool} from '../../src/db/client.js';
import {developmentData} from '../../src/modules/development/model.js';
import {claimRun,checkpoint,recordStage} from '../../src/modules/development/run-store.js';
let env:TestEnv,admin:any,readonly:any,technical:any,ip=1;
beforeEach(()=>{ip++});
const call=(s:any,method:any,url:string,payload?:any,mode='test',csrf=true)=>env.app.inject({method,url,payload,remoteAddress:'127.0.0.'+ip,cookies:{natio_admin_session:s.cookie},headers:{'x-csrf-token':csrf?s.csrf:'','x-natio-mode':mode}});
async function login(email:string){const r=await env.app.inject({method:'POST',url:'/admin/auth/login',payload:{email,password:env.seed.password}});expect(r.statusCode,r.body).toBe(200);return {csrf:r.json().csrf_token,cookie:r.cookies.find(c=>c.name==='natio_admin_session')!.value}}
async function task(mode='test'){
 const id=randomUUID(),data=developmentData.parse({spec:{objective:'Improve filter',acceptance:'Filter persists after refresh',users:'Staff',scope:'Filter',technical:'UI',risks:'None',questions:''},definition_of_done:'Regression tests pass'});
 const r=await call(admin,'POST','/admin/development',{id,title:'Agent test task',public_summary:'A test task',data},mode);expect(r.statusCode,r.body).toBe(200);
 for(const [i,status] of ['backlog','todo'].entries())expect((await call(admin,'POST',`/admin/development/${id}/status`,{version:i+1,status},mode)).statusCode).toBe(200);
 return {id,url:`/admin/development/${id}/runs`,body:{id:randomUUID(),version:3,target:'test'}};
}
beforeAll(async()=>{env=await startTestEnv();admin=await login(env.seed.adminEmail);for(const role of ['readonly','technical'])await getPool().query('INSERT INTO admin_users(id,email,name,password_hash,role) SELECT $1,$2,$1,password_hash,$3 FROM admin_users LIMIT 1',['agent-'+role,role+'@example.test',role]);readonly=await login('readonly@example.test');technical=await login('technical@example.test');process.env.NATIO_AGENT_RUNS_ENABLED='true';await getPool().query('INSERT INTO development_runner_status(id,heartbeat_at,production_enabled) VALUES(true,now(),true)')},120000);
afterAll(async()=>{delete process.env.NATIO_AGENT_RUNS_ENABLED;await stopTestEnv(env)});
it('requires manager access and CSRF, forbids production from test, isolates modes',async()=>{
 const t=await task();expect((await call(readonly,'POST',t.url,t.body)).statusCode).toBe(403);expect((await call(admin,'POST',t.url,t.body,'test',false)).statusCode).toBe(403);
 expect((await call(admin,'POST',t.url,{...t.body,target:'production'})).statusCode).toBe(403);expect((await call(admin,'GET',t.url,undefined,'live')).statusCode).toBe(404);
 expect((await call(admin,'POST',t.url,{...t.body,command:'touch /tmp/bad'})).statusCode).toBe(422);
});
it('deduplicates concurrent starts and snapshots the reviewed requirements',async()=>{
 const t=await task();const replies=await Promise.all([call(admin,'POST',t.url,t.body),call(admin,'POST',t.url,t.body)]);expect(replies.map(r=>r.statusCode)).toEqual([200,200]);
 expect(replies[0].json().snapshot).toBeUndefined();expect(replies[0].json().patch).toBeUndefined();
 const detail=(await call(admin,'GET',t.url.replace('/runs',''))).json().item;
 expect((await call(admin,'PUT',t.url.replace('/runs',''),{title:detail.title,public_summary:detail.public_summary,data:detail.data,version:detail.version})).statusCode).toBe(409);
 expect((await call(admin,'POST',t.url.replace('/runs','')+'/status',{version:detail.version,status:'review'})).statusCode).toBe(409);
 expect((await call(admin,'POST',t.url,{...t.body,id:randomUUID(),version:4})).statusCode).toBe(409);
 const run=(await getPool().query('SELECT * FROM development_runs WHERE id=$1',[t.body.id])).rows[0];expect(run.snapshot.spec.acceptance).toContain('refresh');
 expect((await call(admin,'POST',t.url+'/'+run.id+'/action',{action:'cancel'})).statusCode).toBe(200);
 expect((await getPool().query('SELECT state FROM development_runs WHERE id=$1',[run.id])).rows[0].state).toBe('cancelled');
});
it('fences stale workers and cancels running work before further stages',async()=>{
 const t=await task();await call(admin,'POST',t.url,t.body);const c=await getPool().connect();try{
  const r=await claimRun(c,'test-runner');expect(r.id).toBe(t.body.id);
  await expect(checkpoint(c,r.id,randomUUID())).rejects.toThrow('ownership');
  await expect(recordStage(c,{...r,lease_token:randomUUID()},'succeeded','fake')).rejects.toThrow('ownership');
  await call(admin,'POST',t.url+'/'+r.id+'/action',{action:'cancel'});await expect(checkpoint(c,r.id,r.lease_token)).rejects.toThrow('cancelled');
  await recordStage(c,r,'cancelled','Cancellation verified');
 }finally{c.release()}
});
it('gates production on exact SHA and superadmin; exposes bounded private events',async()=>{
 const t=await task('live');t.body.target='production';await call(admin,'POST',t.url,t.body,'live');const c=await getPool().connect();try{
  const r=await claimRun(c,'test-runner'),sha='a'.repeat(40);
  await recordStage(c,r,'testing','Checks started',{base:'b'.repeat(40),commit:sha,patch:'diff --git a/example b/example\n+tested change'});await recordStage(c,r,'awaiting_approval','Checks passed',{commit:sha});
  const patch=await call(admin,'GET',t.url+'/'+r.id+'/patch',undefined,'live');expect(patch.json().patch).toContain('tested change');
  expect((await call(readonly,'GET',t.url+'/'+r.id+'/patch',undefined,'live')).statusCode).toBe(403);
  const url=t.url+'/'+r.id+'/action';expect((await call(technical,'POST',url,{action:'approve',commit_sha:sha},'live')).statusCode).toBe(403);
  expect((await call(admin,'POST',url,{action:'approve',commit_sha:'c'.repeat(40)},'live')).statusCode).toBe(409);
  expect((await call(admin,'POST',url,{action:'approve',commit_sha:sha},'live')).statusCode).toBe(200);
  const deploy=await claimRun(c,'deploy-runner');expect(deploy.state).toBe('deploying');expect(deploy.approved_sha).toBe(sha);
  expect((await call(admin,'POST',url,{action:'cancel'},'live')).statusCode).toBe(409);
  await recordStage(c,deploy,'succeeded','Test deployment verified');
  const events=await call(admin,'GET',t.url+'/'+r.id+'/events',undefined,'live');expect(events.json().data).toHaveLength(4);
  expect((await call(readonly,'GET',t.url+'/'+r.id+'/events',undefined,'live')).statusCode).toBe(403);
  expect((await call(admin,'GET',t.url+'/'+r.id+'/events')).statusCode).toBe(404);
 }finally{c.release()}
});

it('rejects new work when the runner heartbeat is stale',async()=>{const t=await task();await getPool().query("UPDATE development_runner_status SET heartbeat_at=now()-interval '1 minute'");expect((await call(admin,'POST',t.url,t.body)).json().error.code).toBe('runner_offline');expect((await call(admin,'GET',t.url)).json().enabled).toBe(false)});

import './env.js';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {and,eq} from 'drizzle-orm';
import {startTestEnv,stopTestEnv,type TestEnv} from './setup.js';
import {getDb,getPool} from '../../src/db/client.js';
import {apiKeys,merchants,projects,providerAccounts,transactions} from '../../src/db/schema/index.js';
import {createApiKey} from '../../src/modules/api-keys/service.js';
let env:TestEnv,admin:{cookie:string;csrf:string},merchant:{cookie:string;csrf:string},redirectSecret='';
const session=(r:any)=>({cookie:r.cookies.map((c:any)=>c.name+'='+c.value).join('; '),csrf:r.json().csrf_token});
const call=(s:typeof admin,method:any,url:string,payload?:any,mode='test')=>env.app.inject({method,url,payload,headers:{cookie:s.cookie,'x-csrf-token':s.csrf,'x-natio-mode':mode}});
const publicCall=(secret:string,method:any,url:string,payload?:any)=>env.app.inject({method,url,payload,headers:{authorization:'Bearer '+secret,'idempotency-key':'integration-'+url}});
beforeAll(async()=>{
 env=await startTestEnv();
 admin=session(await env.app.inject({method:'POST',url:'/admin/auth/login',payload:{email:env.seed.adminEmail,password:env.seed.password}}));
 merchant=session(await env.app.inject({method:'POST',url:'/dashboard/auth/login',payload:{email:env.seed.merchantEmail,password:env.seed.password}}));
 await getDb().insert(merchants).values({id:'mer_other_integration',name:'Other tenant'});
 await getDb().insert(projects).values([{id:'prj_other_integration',merchantId:'mer_other_integration',name:'Other',slug:'other'},{id:'prj_same_merchant_other',merchantId:env.seed.merchantId,name:'Other project',slug:'other-project'}]);
 const common={mode:'test' as const,entityType:'payment',entityId:'fixture',type:'payment' as const,status:'successful' as const,currency:'EUR',paymentMethodType:'card' as const,occurredAt:new Date('2025-04-10T00:00:00Z')};
 await getDb().insert(transactions).values([{...common,id:'txn_own_integration',merchantId:env.seed.merchantId,projectId:env.seed.projectId,amount:1000,netAmount:1000},{...common,id:'txn_foreign_integration',merchantId:'mer_other_integration',projectId:'prj_other_integration',amount:99000,netAmount:99000}]);
});
afterAll(async()=>stopTestEnv(env));
describe('integration onboarding contracts',()=>{
 it('scopes merchant projects and key issuance to their organization',async()=>{
  const r=await call(merchant,'GET','/dashboard/integrations?merchant_id=mer_other_integration');expect(r.statusCode).toBe(200);expect(r.json().merchant_id).toBe(env.seed.merchantId);
  expect((await call(merchant,'POST','/dashboard/integrations/keys',{project_id:'prj_other_integration',name:'Not mine',integration_type:'api'})).statusCode).toBe(404);
 });
 it('saves an environment-specific preference and enforces new key types',async()=>{
  const path='/admin/integrations?merchant_id='+env.seed.merchantId;
  expect((await call(admin,'PATCH',path,{preferred_type:'redirect',allowed_types:['redirect']})).statusCode).toBe(200);
  expect((await call(merchant,'POST','/dashboard/integrations/keys',{project_id:env.seed.projectId,name:'Blocked API',integration_type:'api'})).statusCode).toBe(403);
  const r=await call(merchant,'POST','/dashboard/integrations/keys',{project_id:env.seed.projectId,name:'Hosted checkout',integration_type:'redirect'});expect(r.statusCode,r.body).toBe(201);redirectSecret=r.json().secret;
  expect(redirectSecret).toMatch(/^natio_sk_test_/);
  expect((await call(merchant,'GET','/dashboard/integrations')).body).not.toContain(redirectSecret);
  expect((await call(admin,'GET',path,undefined,'live')).json().profile.allowed_types).toEqual(['api','redirect']);
 });
 it('creates hosted checkout idempotently and restricts the redirect secret',async()=>{
  for(const [method,path] of [['POST','/v1/payments'],['POST','/v1/payouts'],['GET','/v1/transactions'],['GET','/v1/payments']])expect((await publicCall(redirectSecret,method,path,method==='POST'?{}:undefined)).statusCode).toBe(403);
  const body={amount:1000,currency:'EUR',payment_method:'card',country:'DE',return_url:'https://merchant.example/return'};
  const first=await publicCall(redirectSecret,'POST','/v1/checkout-sessions',body);expect(first.statusCode,first.body).toBe(201);expect(first.json().url).toContain('/sandbox/hosted/');
  const again=await publicCall(redirectSecret,'POST','/v1/checkout-sessions',body);expect(again.json().payment_id).toBe(first.json().payment_id);
  expect((await publicCall(redirectSecret,'GET','/v1/payments/'+first.json().payment_id)).statusCode).toBe(200);
  expect((await publicCall(redirectSecret,'POST','/v1/checkout-sessions',{...body,return_url:'http://merchant.example/return'})).statusCode).toBe(422);
 });
 it('denies status and timeline access across project boundaries',async()=>{
  const key=await createApiKey(getDb(),{merchantId:env.seed.merchantId,projectId:'prj_same_merchant_other',mode:'test',name:'Second project',integrationType:'redirect',actor:{type:'system'}});
  const payment=(await getPool().query('SELECT id FROM payments WHERE project_id=$1 LIMIT 1',[env.seed.projectId])).rows[0].id;
  for(const suffix of ['', '/timeline'])expect((await publicCall(key.secret,'GET','/v1/payments/'+payment+suffix)).statusCode).toBe(404);
 });
 it('creates disabled simulated connections without exposing credentials',async()=>{
  const c=(await call(admin,'GET','/admin/integrations/connectors')).json().data.find((x:any)=>x.adapter==='mock_acquirer');
  const body={provider_id:c.id,name:'Onboarding test',currency:'EUR',method:'card',confirmed:true,credentials:{}};
  const r=await call(admin,'POST','/admin/integrations/connections',body);expect(r.statusCode,r.body).toBe(201);expect(r.json().status).toBe('disabled');expect(r.json().credentials).toBeUndefined();
  expect((await getDb().select().from(providerAccounts).where(eq(providerAccounts.id,r.json().id)))[0]!.status).toBe('disabled');
  expect((await call(admin,'POST','/admin/integrations/connections',body,'live')).statusCode).toBe(403);
 });
 it('never lets query strings or saved board filters escape the tenant',async()=>{
  const q='?from=2025-04-10&to=2025-04-10&currency=EUR&merchant_id=mer_other_integration';
  const r=await call(merchant,'GET','/dashboard/bi'+q);expect(r.statusCode,r.body).toBe(200);expect(Number(r.json().summary.volume)).toBe(1000);expect(r.body).not.toContain('Other tenant');expect(r.json().coverage.merchants).toBe(1);
  const csv=await call(merchant,'GET','/dashboard/bi/export.csv'+q+'&kind=transactions');expect(csv.statusCode).toBe(200);expect(csv.body).toContain('txn_own_integration');expect(csv.body).not.toContain('txn_foreign_integration');
  const b={id:'tenant-board',spec:{name:'Tenant board',filters:{from:'2025-04-10',to:'2025-04-10',currency:'EUR',merchant_id:'mer_other_integration'},widgets:['volume']}};
  const saved=await call(merchant,'POST','/dashboard/boards',b);expect(saved.statusCode,saved.body).toBe(200);expect(saved.json().spec.filters.merchant_id).toBe(env.seed.merchantId);
  expect((await call(merchant,'GET','/dashboard/boards',undefined,'live')).json().data).toHaveLength(0);
 });
 it('keeps premium integration gates effective',async()=>{
  await getPool().query("INSERT INTO platform_demo_subscriptions(actor_kind,actor_id,plan) VALUES('merchant',$1,'light')",[env.seed.merchantId]);
  expect((await call(merchant,'GET','/dashboard/integrations')).statusCode).toBe(403);
  expect((await call(merchant,'GET','/dashboard/bi')).statusCode).toBe(403);
  expect((await call(merchant,'GET','/dashboard/assistant/status')).statusCode).toBe(200);
 });
});

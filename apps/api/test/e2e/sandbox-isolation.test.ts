import './env.js';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {startTestEnv,stopTestEnv,type TestEnv} from './setup.js';
import {getDb} from '../../src/db/client.js';
import {providerAccounts,providers} from '../../src/db/schema/index.js';
import {resetConfigForTests} from '../../src/config.js';
import {buildProviderContext} from '../../src/providers/context.js';
import {createApiKey} from '../../src/modules/api-keys/service.js';
import {createProviderAccount} from '../../src/modules/providers/service.js';
import {eq} from 'drizzle-orm';
let env:TestEnv;
beforeAll(async()=>{
 process.env.NATIO_SANDBOX_ONLY='true';process.env.COOKIE_DOMAIN='.example.test';
 env=await startTestEnv();
});
afterAll(async()=>{await stopTestEnv(env);delete process.env.NATIO_SANDBOX_ONLY;delete process.env.COOKIE_DOMAIN;resetConfigForTests();});
describe('isolated sandbox boundaries',()=>{
 it('sets a distinct host-only session and ignores a live mode override',async()=>{
  const login=await env.app.inject({method:'POST',url:'/admin/auth/login',payload:{email:env.seed.adminEmail,password:env.seed.password}});
  expect(login.statusCode).toBe(200);
  expect(login.cookies[0]!.name).toBe('natio_demo_admin_session');
  expect(login.cookies[0]!.domain).toBeUndefined();
  const cookie=login.cookies.map(c=>c.name+'='+c.value).join('; ');
  for(const locale of ['en','ru','es','ar','pt']){
   const me=await env.app.inject({url:'/admin/auth/me?mode=live',headers:{cookie:cookie+'; natio_locale='+locale,'x-natio-mode':'live'}});
   expect(me.statusCode).toBe(200);expect(me.json()).toMatchObject({sandbox:true,mode:'test'});
  }
  const wrong=await env.app.inject({url:'/admin/auth/me',headers:{cookie:cookie.replace('natio_demo_admin_session','natio_admin_session')}});
  expect(wrong.statusCode).toBe(401);
 });
 it('cannot create live API keys or provider accounts, even as a privileged caller',async()=>{
  const db=getDb(),actor={type:'system' as const};
  await expect(createApiKey(db,{merchantId:env.seed.merchantId,projectId:env.seed.projectId,mode:'live',name:'Forbidden',actor})).rejects.toMatchObject({status:403});
  const [p]=await db.select().from(providers).limit(1);
  await expect(createProviderAccount(db,{providerId:p!.id,mode:'live',name:'Forbidden'},actor)).rejects.toMatchObject({status:403});
 });
 it('blocks real adapters even when incorrectly registered as test',async()=>{
  const db=getDb();const [a]=await db.select().from(providerAccounts).where(eq(providerAccounts.mode,'test')).limit(1);
  const [p]=await db.select().from(providers).where(eq(providers.id,a!.providerId));
  expect(()=>buildProviderContext(a!,{...p!,adapterKey:'yookassa'})).toThrow('simulated test');
  expect(()=>buildProviderContext({...a!,mode:'live'},p!)).toThrow('simulated test');
  expect(buildProviderContext(a!,p!).mode).toBe('test');
 });
});

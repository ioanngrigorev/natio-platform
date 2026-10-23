import './env.js';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {getDb} from '../../src/db/client.js';
import {adminUsers} from '../../src/db/schema/index.js';
import {newId} from '../../src/lib/ids.js';
import {hashPassword} from '../../src/lib/crypto.js';
import {ADMIN_PERMISSIONS,ADMIN_ROLES,adminPermissions,hasAdminPermission} from '../../src/modules/auth/permissions.js';
import {startTestEnv,stopTestEnv,type TestEnv} from './setup.js';

let env:TestEnv;
const sessions=new Map<string,{cookie:string;csrf:string}>();
beforeAll(async()=>{
 env=await startTestEnv();
 const hash=await hashPassword(env.seed.password);
 for(const role of ['administrator','technical','finance','readonly'] as const){
  await getDb().insert(adminUsers).values({id:newId('adminUser'),name:role,email:role+'@roles.test',role,passwordHash:hash});
  const res=await env.app.inject({method:'POST',url:'/admin/auth/login',payload:{email:role+'@roles.test',password:env.seed.password}});
  expect(res.statusCode).toBe(200);
  sessions.set(role,{cookie:res.cookies.map(c=>c.name+'='+c.value).join('; '),csrf:res.json().csrf_token});
 }
});
afterAll(async()=>stopTestEnv(env));
async function call(role:string,path:string,method:'GET'|'POST'|'PATCH'='GET',payload?:object){
 const s=sessions.get(role)!;
 return env.app.inject({method,url:path,headers:{cookie:s.cookie,'x-csrf-token':s.csrf},...(payload?{payload}:{})});
}
describe('separation of internal duties',()=>{
 it('returns the actual effective permissions for each session',async()=>{
  for(const role of ['administrator','technical','finance','readonly'] as const){
   const r=await call(role,'/admin/auth/me');expect(r.statusCode).toBe(200);expect(r.json().permissions).toEqual(adminPermissions(role));
  }
 });
 it.each([
  ['technical','/admin/pricing'],['technical','/admin/settlements'],['technical','/admin/receipts'],['technical','/admin/users'],
  ['finance','/admin/routing/rules'],['finance','/admin/system-events'],['finance','/admin/lab'],['finance','/admin/users'],
 ])('blocks %s from reading %s even with a manually entered URL',async(role,path)=>{
  expect((await call(role,path)).statusCode).toBe(403);
 });
 it.each([
  ['technical','/admin/providers'],['technical','/admin/routing/rules'],['technical','/admin/system-events'],
  ['finance','/admin/pricing'],['finance','/admin/settlements'],['finance','/admin/reconciliation/batches'],
  ['administrator','/admin/users'],['administrator','/admin/risk/rules'],['administrator','/admin/merchants'],
 ])('allows %s to read %s',async(role,path)=>expect((await call(role,path)).statusCode).toBe(200));
 it.each([
  ['technical','/admin/pricing'],['finance','/admin/provider-accounts'],['finance','/admin/routing/rules'],
  ['administrator','/admin/provider-accounts'],['administrator','/admin/pricing'],['readonly','/admin/provider-accounts'],
 ])('rejects a forbidden %s mutation before payload processing (%s)',async(role,path)=>{
  expect((await call(role,path,'POST',{})).statusCode).toBe(403);
 });
 it('does not let any focused manager promote themselves or create an admin',async()=>{
  for(const role of sessions.keys())expect((await call(role,'/admin/users','POST',{email:'new@roles.test',password:env.seed.password,role:'superadmin',name:'Escalation'})).statusCode).toBe(403);
 });
 it('allows technical setup and finance pricing through to input validation',async()=>{
  expect((await call('technical','/admin/provider-accounts','POST',{})).statusCode).toBe(422);
  expect((await call('finance','/admin/pricing','POST',{})).statusCode).toBe(422);
 });
 it('retains superadmin control and does not grant access for an unknown role',()=>{
  for(const permission of ADMIN_PERMISSIONS)expect(hasAdminPermission('superadmin',permission)).toBe(true);
  expect(ADMIN_ROLES).toEqual(expect.arrayContaining(['administrator','technical','finance']));
  expect(adminPermissions('unexpected' as never)).toEqual([]);
 });
});

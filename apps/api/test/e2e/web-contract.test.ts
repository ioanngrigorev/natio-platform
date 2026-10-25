import './env.js';
import {spawn, type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {startTestEnv,stopTestEnv,type TestEnv} from './setup.js';
let env:TestEnv,web:ChildProcess,origin:string,cookie:string,csrf:string;
const productionWeb=process.env.NATIO_WEB_CONTRACT_PRODUCTION==='true';
let output='';
async function request(path:string,options:RequestInit={}) {return fetch(origin+path,{...options,headers:{cookie,...options.headers},signal:AbortSignal.timeout(90_000)});}
beforeAll(async()=>{
 env=await startTestEnv();
 const apiOrigin=await env.app.listen({host:'127.0.0.1',port:productionWeb?4000:0});
 const socket=createServer();await new Promise<void>(r=>socket.listen(0,'127.0.0.1',r));const port=(socket.address() as {port:number}).port;await new Promise<void>(r=>socket.close(()=>r()));
 origin=`http://127.0.0.1:${port}`;
 web=spawn(process.execPath,['node_modules/next/dist/bin/next',productionWeb?'start':'dev','--hostname','127.0.0.1','--port',String(port)],{cwd:fileURLToPath(new URL('../../../web/',import.meta.url)),env:{...process.env,NODE_ENV:productionWeb?'production':'development',API_INTERNAL_URL:apiOrigin,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 web.stdout?.on('data',c=>{output=(output+c).slice(-4000)});web.stderr?.on('data',c=>{output=(output+c).slice(-4000)});
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}if(i===99)throw Error('Next failed to start: '+output);await new Promise(r=>setTimeout(r,200));}
 const login=await request('/api/admin/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:env.seed.adminEmail,password:env.seed.password})});
 expect(login.status).toBe(200);csrf=((await login.json()) as {csrf_token:string}).csrf_token;cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 expect(cookie).toContain('natio_admin_session=');
},120_000);
afterAll(async()=>{
 if(web?.exitCode===null){const exited=once(web,'exit');web.kill('SIGTERM');await exited;}
 await stopTestEnv(env);
});
describe('Next.js to Fastify over real HTTP',()=>{
 it('proxies session cookies, correlation headers and explicit test/live mode',async()=>{
  for(const mode of ['test','live']){const response=await request('/api/admin/auth/me?mode=live',{headers:{'x-natio-mode':mode}});expect(response.status).toBe(200);expect(((await response.json()) as {mode:string}).mode).toBe(mode);expect(response.headers.get('x-request-id')).toBeTruthy();}
 });
 it('rejects a mutation without CSRF and accepts the same request with a token for validation',async()=>{
  const response=await request('/api/admin/boards',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});expect(response.status).toBe(403);
  const validated=await request('/api/admin/boards',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:'{}'});expect(validated.status).toBe(422);
 });
 it('preserves multipart boundaries and structured attachment validation errors',async()=>{
  const form=new FormData();form.append('request',JSON.stringify({question:'Analyze this synthetic fixture',page:'/admin',history:[],locale:'en'}));form.append('files',new Blob(['synthetic'],{type:'application/octet-stream'}),'unsafe.exe');
  const response=await request('/api/admin/assistant/chat-with-files',{method:'POST',headers:{'x-csrf-token':csrf},body:form});
  expect(response.status).toBe(422);expect(((await response.json()) as {error:{code:string}}).error.code).toBe('validation_failed');
 });
 it.each(['/admin','/admin/bi?days=7','/admin/boards','/admin/development','/admin/plans','/admin/risk-dashboard','/admin/receipts','/admin/routing/new','/admin/payments','/admin/transactions','/admin/payouts','/admin/webhooks','/admin/merchants','/admin/users','/admin/balances','/admin/pricing','/admin/settlements','/admin/reconciliation','/admin/providers','/admin/lab','/admin/catalog','/admin/routing/studio','/admin/routing','/admin/risk','/admin/system-events','/admin/audit','/admin/knowledge','/admin/support','/admin/market'])('renders authenticated SSR %s without an application error',async path=>{
  const response=await request(path);const html=await response.text();expect(response.status).toBe(200);expect(html).toContain('NATIO');expect(html).not.toContain('NEXT_REDIRECT');expect(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')).not.toContain('This page could not load.');expect(response.url).not.toContain('/login');
 },120_000);
 it('serves multilingual HTML and restricts microphone access to the dashboard',async()=>{
  const response=await request('/admin/plans',{headers:{cookie:cookie+'; natio_locale=ar'}});const html=await response.text();expect(html).toContain('lang="ar"');expect(html).toContain('dir="rtl"');expect(response.headers.get('permissions-policy')).toContain('microphone=(self)');
 });
 it('keeps the same authenticated session through language changes including Arabic and back',async()=>{
  for(const locale of ['en','ar','en','ru','es','pt','en']){
   const headers={cookie:cookie+'; natio_locale='+locale};
   const page=await request('/admin/plans',{headers});expect(page.status).toBe(200);expect(page.url).not.toContain('/login');
   const html=await page.text();expect(html).toContain(`lang="${locale}"`);
   const me=await request('/api/admin/auth/me',{headers});expect(me.status).toBe(200);expect((await me.json() as {csrf_token:string}).csrf_token).toBe(csrf);
   expect(page.headers.getSetCookie().some(c=>c.startsWith('natio_admin_session='))).toBe(false);
  }
 },120_000);
 it('renders merchant surfaces and applies paid-plan gates with the merchant session',async()=>{
  const login=await request('/api/dashboard/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:env.seed.merchantEmail,password:env.seed.password})});
  expect(login.status).toBe(200);const merchantCookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  for(const path of ['/dashboard','/dashboard/payments','/dashboard/transactions','/dashboard/payouts','/dashboard/receipts','/dashboard/settlements','/dashboard/wallets','/dashboard/reconciliation','/dashboard/analytics','/dashboard/developers','/dashboard/api-keys','/dashboard/webhooks','/dashboard/team','/dashboard/development','/dashboard/recommendations','/dashboard/plans','/dashboard/settings']){
   const response=await request(path,{headers:{cookie:merchantCookie}});const html=await response.text();expect(response.status,path).toBe(200);expect(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''),path).not.toContain('This page could not load.');expect(response.url,path).not.toContain('/login');
  }
 },120_000);
 it('renders public pages, the async API reference and its JSON document',async()=>{
  for(const path of ['/','/admin/login','/dashboard/login','/docs','/docs/api-reference']){
   const response=await request(path,{headers:{cookie:''}});const html=await response.text();expect(response.status,path).toBe(200);expect(html,path).not.toContain('The specification could not be fetched');
  }
  const response=await request('/openapi.json');expect(response.status).toBe(200);expect(await response.json()).toHaveProperty('paths');
 },120_000);
 it('protects logout against CSRF and invalidates the session after a legitimate logout',async()=>{
  expect((await request('/api/admin/auth/logout',{method:'POST'})).status).toBe(403);
  expect((await request('/api/admin/auth/me')).status).toBe(200);
  expect((await request('/api/admin/auth/logout',{method:'POST',headers:{'x-csrf-token':csrf}})).status).toBe(200);
  expect((await request('/api/admin/auth/me')).status).toBe(401);
 });
});

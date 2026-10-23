import { randomUUID } from 'node:crypto';
import { getPool } from '../../db/client.js';
import { getAdapter } from '../../providers/registry.js';
import type { ProviderContext } from '../../providers/types.js';
import { shouldRetry } from '../routing/cascade.js';
import { Errors } from '../../lib/errors.js';
import { connectionSpec, type ConnectionSpec } from './schemas.js';
export const labTemplates:ConnectionSpec[] = [
 {name:'Aster Pilot',adapter:'mock_acquirer',currencies:['EUR','USD'],countries:['DE','NL'],methods:['card'],timeout_ms:5000},
 {name:'Lumina QR',adapter:'mock_qr',currencies:['BRL','MXN'],countries:['BR','MX'],methods:['qr'],timeout_ms:7000},
 {name:'Vela Transfer',adapter:'mock_acquirer',currencies:['GBP','EUR'],countries:['GB','IE'],methods:['bank_transfer'],timeout_ms:10000},
];
export interface LabCheck {name:string; passed:boolean; observed:string; duration_ms:number}
export async function inspectConnection(config:ConnectionSpec):Promise<LabCheck[]> {
 const adapter=getAdapter(config.adapter), checks:LabCheck[]=[];
 const ctx:ProviderContext={providerAccountId:'isolated-lab',providerId:'isolated-lab',providerCode:config.adapter,mode:'test',credentials:{},config:{simulation:{latencyMs:5}},timeoutMs:config.timeout_ms};
 const check=async(name:string,fn:()=>Promise<{passed:boolean;observed:string}>)=>{const start=Date.now();try{checks.push({name,...await fn(),duration_ms:Date.now()-start});}catch{checks.push({name,passed:false,observed:'Check could not complete',duration_ms:Date.now()-start});}};
 await check('Sandbox health',async()=>{const r=await adapter.healthCheck!(ctx);return {passed:r.ok,observed:r.message??'Sandbox health response'};});
 await check('Outage detected',async()=>{const r=await adapter.healthCheck!({...ctx,config:{simulation:{forceOutcome:'provider_unavailable',latencyMs:5}}});return {passed:!r.ok,observed:r.message??'Outage detection'};});
 const policy={maxAttempts:3,retryOnSoftDecline:true,retryOnTimeout:true,maxElapsedMs:30000};
 for(const scenario of ['technical_error','hard_decline','issuer_unavailable'] as const){
   await check(scenario.replaceAll('_',' '),async()=>{
     const r=await adapter.createPayment(ctx,{paymentId:'lab-'+randomUUID(),amount:10000,currency:config.currencies[0]!,paymentMethodType:config.methods[0]!,captureMethod:'automatic',simulate:scenario});
     const retry=shouldRetry(r.outcome,policy,1,2,{chargeState:r.chargeState,failureCode:r.failureCode,paymentMethod:config.methods[0]});
     const expected=scenario==='technical_error'||(scenario==='issuer_unavailable'&&config.methods[0]==='card');
     return {passed:retry.retry===expected,observed:`${r.outcome}: ${retry.reason}`};
   });
 }
 await check('Unknown timeout stops cascade',async()=>{
   let timedOut=false;try{await adapter.createPayment(ctx,{paymentId:'lab-'+randomUUID(),amount:10000,currency:config.currencies[0]!,paymentMethodType:config.methods[0]!,captureMethod:'automatic',simulate:'timeout_unknown'});}catch(e){timedOut=e instanceof Error && e.name==='ProviderTimeoutError';}
   const r=shouldRetry('timeout',policy,1,2,{chargeState:'unknown'});return {passed:timedOut&&!r.retry,observed:r.reason};
 });
 await check('Methods match connector',async()=>{const ok=config.adapter!=='mock_qr'||config.methods.every(m=>m==='qr');return {passed:ok,observed:ok?'Configured methods match sandbox connector':'QR connector requires QR methods only'};});
 return checks;
}
export async function createLab(owner:string,raw:unknown,id:string){
 const cfg=connectionSpec.parse(raw), p=getPool();
 await p.query('INSERT INTO lab_connections(id,owner_id,name,config) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[id,owner,cfg.name,JSON.stringify(cfg)]);
 const old=(await p.query('SELECT *, config=$3::jsonb AS same_config FROM lab_connections WHERE id=$1 AND owner_id=$2',[id,owner,JSON.stringify(cfg)])).rows[0];
 if(!old||!old.same_config)throw Errors.conflict('request_reused','Use a new request identifier');return old;
}
export async function getLab(id:string,owner:string){const row=(await getPool().query('SELECT * FROM lab_connections WHERE id=$1 AND (owner_id=$2 OR owner_id IS NULL)',[id,owner])).rows[0];if(!row)throw Errors.notFound('Lab connection');return row;}
export async function runLab(id:string,owner:string,version:number){
 const row=await getLab(id,owner);if(row.version!==version)throw Errors.conflict('stale_version','Connection changed. Reload before testing.');
 const started=Date.now(),results=await inspectConnection(connectionSpec.parse(row.config)),status=results.every(c=>c.passed)?'passed':'failed';
 const client=await getPool().connect();
 try{await client.query('BEGIN');const updated=await client.query('UPDATE lab_connections SET status=$1,updated_at=now() WHERE id=$2 AND version=$3 RETURNING id',[status,id,version]);if(!updated.rowCount)throw Errors.conflict('stale_version','Connection changed while testing');
 const run=(await client.query('INSERT INTO lab_runs(id,connection_id,actor_id,config_version,config_snapshot,results,status,duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',['run_'+randomUUID(),id,owner,version,JSON.stringify(row.config),JSON.stringify(results),status,Date.now()-started])).rows[0];await client.query('COMMIT');return run;
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

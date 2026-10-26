import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool } from '../../db/client.js';
import { Errors } from '../../lib/errors.js';
import { developmentData,engineeringCost,iceScore,priority,transitions,hasCycle,type Stage } from './model.js';
export type Actor={kind:'admin'|'merchant';id:string;merchantId?:string;manager:boolean;mode:'test'|'live'};
export const owns=(r:any,a:Actor)=>r.owner_kind===a.kind&&r.owner_id===a.id;
export const scope=(a:Actor)=>({sql:'mode=$1 AND ($2::boolean OR visibility=\'shared\' OR (owner_kind=$3 AND owner_id=$4))',args:[a.mode,a.kind==='admin',a.kind,a.id]});
export function view(r:any,a:Actor){
 const privateAccess=a.kind==='admin'||owns(r,a), data={...r.data};
 if(!privateAccess){for(const k of ['request','source_path','spec','evidence','completion_evidence','realized_usd'])delete data[k];}
 return {...r,data,ice_score:iceScore(data),cost_estimate:engineeringCost(data.effort_hours ?? 8),owner_id:privateAccess?r.owner_id:undefined,merchant_id:undefined,can_edit:a.manager||(owns(r,a)&&['draft','idea','backlog','todo','rejected','archived'].includes(r.status)),private_access:privateAccess,can_manage:a.manager};
}
export async function atomic<T>(mode:string,fn:(c:PoolClient)=>Promise<T>){const c=await getPool().connect();try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('development:'||$1))",[mode]);const r=await fn(c);await c.query('COMMIT');return r}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
export async function item(c:PoolClient|ReturnType<typeof getPool>,id:string,a:Actor,lock=false){const s=scope(a),r=(await c.query(`SELECT * FROM development_items WHERE id=$5 AND ${s.sql} ${lock?'FOR UPDATE':''}`,[...s.args,id])).rows[0];if(!r)throw Errors.notFound('Development item');return r}
export async function event(c:PoolClient,id:string,a:Actor,name:string,detail:unknown={}){await c.query('INSERT INTO development_events(item_id,actor_kind,actor_id,event,detail) VALUES($1,$2,$3,$4,$5)',[id,a.kind,a.id,name,JSON.stringify(detail)])}
export function version(r:any,v:number){if(r.version!==v)throw Errors.conflict('version_conflict','This item changed. Refresh before saving.');}
export async function validateDependencies(c:PoolClient,id:string,deps:string[],a:Actor){
 if(new Set(deps).size!==deps.length)throw Errors.validation('Duplicate dependencies');
 const all=(await c.query('SELECT id,visibility,owner_kind,owner_id,data FROM development_items WHERE mode=$1',[a.mode])).rows;
 for(const dep of deps){const row=all.find(r=>r.id===dep);if(!row||(a.kind!=='admin'&&row.visibility!=='shared'&&!owns(row,a)))throw Errors.validation('Dependency is not accessible');}
 if(hasCycle(id,deps,new Map(all.map(r=>[r.id,r.data.dependencies||[]]))))throw Errors.validation('Dependencies must not form a cycle');
}
export async function createItem(a:Actor,b:any){return atomic(a.mode,async c=>{const id=b.id||randomUUID();const old=(await c.query('SELECT * FROM development_items WHERE id=$1',[id])).rows[0];
 if(old){if(!owns(old,a)||old.mode!==a.mode||old.title!==b.title||old.public_summary!==b.public_summary||!isDeepStrictEqual(old.data,b.data))throw Errors.conflict('request_reused','Use a new request identifier');return view(old,a)}
 await validateDependencies(c,id,b.data.dependencies,a);
 if(!a.manager&&b.data.realized_usd!==null)throw Errors.forbidden('Only delivery managers can record realized value');
 const r=(await c.query('INSERT INTO development_items(id,mode,owner_kind,owner_id,merchant_id,title,public_summary,data,priority_score) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[id,a.mode,a.kind,a.id,a.merchantId||null,b.title,b.public_summary,JSON.stringify(b.data),priority(b.data)])).rows[0];await event(c,id,a,'created');return view(r,a)})}
async function assertNoActiveRun(c:PoolClient,id:string){if((await c.query("SELECT 1 FROM development_runs WHERE item_id=$1 AND state IN ('queued','developing','testing','awaiting_approval','deploy_queued','deploying')",[id])).rowCount)throw Errors.conflict('agent_run_active','Cancel or finish the agent run before changing this task');}
export async function updateItem(a:Actor,id:string,b:any){return atomic(a.mode,async c=>{const r=await item(c,id,a,true);version(r,b.version);await assertNoActiveRun(c,id);if(!a.manager&&(!owns(r,a)||!['draft','idea','backlog','todo','rejected','archived'].includes(r.status)))throw Errors.forbidden('Only the author or a delivery manager can edit this specification');
 if(!a.manager&&b.data.realized_usd!==r.data.realized_usd)throw Errors.forbidden('Only delivery managers can record realized value');
 await validateDependencies(c,id,b.data.dependencies,a);
 const saved=(await c.query('UPDATE development_items SET title=$2,public_summary=$3,data=$4,priority_score=$5,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[id,b.title,b.public_summary,JSON.stringify(b.data),priority(b.data)])).rows[0];await event(c,id,a,'specification_updated',{version:saved.version});return view(saved,a)})}
export async function moveItem(a:Actor,id:string,b:{version:number;status:Stage;reason:string}){return atomic(a.mode,async c=>{const r=await item(c,id,a,true);version(r,b.version);await assertNoActiveRun(c,id);if(!transitions[r.status as Stage].includes(b.status))throw Errors.invalidTransition('Development item',r.status,b.status);
 if(!a.manager&&(!owns(r,a)||!['draft','idea','backlog','todo','rejected','archived'].includes(r.status)||!['draft','idea','backlog','todo','rejected','archived'].includes(b.status)))throw Errors.forbidden('Only delivery managers can start, test or release work');
 const d=developmentData.parse(r.data);
 if(['backlog','todo'].includes(b.status)&&(!d.spec.objective.trim()||!d.spec.acceptance.trim()))throw Errors.validation('Review the objective and acceptance criteria before adding to backlog');
 if(['rejected','archived'].includes(b.status)&&b.reason.trim().length<3)throw Errors.validation('Provide a decision reason');
 if(b.status==='in_progress'){
 const blocked=(await c.query("SELECT id FROM development_items WHERE id=ANY($1::uuid[]) AND status<>'done'",[d.dependencies])).rowCount;if(blocked)throw Errors.conflict('dependencies_incomplete','Complete dependencies before starting work');
 const n=(await c.query("SELECT count(*)::int n FROM development_items WHERE mode=$1 AND status='in_progress' AND NOT is_demo",[a.mode])).rows[0].n;if(n>=5&&!r.is_demo)throw Errors.conflict('wip_limit','The workspace WIP limit is 5. Finish or return work before starting another item');
 if(d.method==='scrum'){const sp=await c.query("SELECT 1 FROM development_sprints WHERE id=$1 AND mode=$2 AND status='active'",[r.sprint_id,a.mode]);if(!sp.rowCount)throw Errors.validation('Assign the task to an active sprint first');}
 }
 if(b.status==='done'&&(!d.completion_evidence.trim()||!d.definition_of_done.trim()))throw Errors.validation('Record test, review and release evidence before Done');
 const saved=(await c.query(`UPDATE development_items SET status=$2,version=version+1,updated_at=now(),started_at=CASE WHEN $2='in_progress' THEN COALESCE(started_at,now()) WHEN $2 IN ('draft','idea','backlog','todo') AND completed_at IS NOT NULL THEN NULL ELSE started_at END,completed_at=CASE WHEN $2='done' THEN now() WHEN $2 IN ('draft','idea','backlog','todo') THEN NULL ELSE completed_at END WHERE id=$1 RETURNING *`,[id,b.status])).rows[0];
 if(!['in_progress','review','test'].includes(b.status))await c.query("UPDATE development_work_sessions SET ended_at=now(),outcome='Stopped on status change' WHERE item_id=$1 AND ended_at IS NULL",[id]);
 if(b.status==='done'&&saved.visibility==='shared'&&!saved.is_demo)await c.query('INSERT INTO development_notices(id,mode,title,body,item_id) VALUES($1,$2,$3,$4,$5)',[randomUUID(),a.mode,'Released: '+saved.title,saved.public_summary,id]);
 await event(c,id,a,'status_changed',{from:r.status,to:b.status,reason:b.reason});return view(saved,a)})}
export async function timer(a:Actor,id:string,b:{action:'start'|'stop';worker:'ai'|'human';outcome:string}){return atomic(a.mode,async c=>{if(!a.manager)throw Errors.forbidden('Delivery manager required');const r=await item(c,id,a,true);if(b.action==='start'){
 if(!['in_progress','review','test'].includes(r.status)||r.is_demo)throw Errors.validation('Start timers only on real active development work');
 const running=await c.query('SELECT 1 FROM development_work_sessions WHERE actor_kind=$1 AND actor_id=$2 AND ended_at IS NULL',[a.kind,a.id]);if(running.rowCount)throw Errors.conflict('timer_running','Stop your existing timer first');
 await c.query("INSERT INTO development_work_sessions(id,item_id,actor_kind,actor_id,worker,source) VALUES($1,$2,$3,$4,$5,'manual_timer')",[randomUUID(),id,a.kind,a.id,b.worker]);
 }else{const stopped=await c.query('UPDATE development_work_sessions SET ended_at=now(),outcome=$4 WHERE item_id=$1 AND actor_kind=$2 AND actor_id=$3 AND ended_at IS NULL RETURNING id',[id,a.kind,a.id,b.outcome]);if(!stopped.rowCount)throw Errors.conflict('timer_not_running','No timer of yours is running on this item');}
 await event(c,id,a,'timer_'+b.action,{worker:b.worker});return {ok:true}})}

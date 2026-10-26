import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';

/** Runner-only operations. A dedicated PostgreSQL connection holds the singleton
 * advisory lock for the entire execution. Never replay an interrupted deployment. */
export async function claimRun(c:PoolClient,runner:string){
 await c.query('BEGIN');
 try{
  const r=(await c.query("SELECT * FROM development_runs WHERE state IN ('queued','deploy_queued') AND NOT cancel_requested ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
  if(!r){await c.query('COMMIT');return null}
  const token=randomUUID(),state=r.state==='queued'?'developing':'deploying';
  const next=(await c.query('UPDATE development_runs SET state=$2,lease_token=$3,runner_id=$4,heartbeat_at=now(),updated_at=now() WHERE id=$1 RETURNING *',[r.id,state,token,runner])).rows[0];
  await c.query('COMMIT');return next;
 }catch(e){await c.query('ROLLBACK');throw e}
}
export async function checkpoint(c:PoolClient,id:string,token:string){const r=(await c.query('UPDATE development_runs SET heartbeat_at=now() WHERE id=$1 AND lease_token=$2 AND state IN (\'developing\',\'testing\',\'deploying\') RETURNING cancel_requested',[id,token])).rows[0];if(!r)throw new Error('Run ownership lost');if(r.cancel_requested)throw new Error('Run cancelled')}
export async function recordStage(c:PoolClient,r:any,state:string,message:string,fields:{base?:string;commit?:string;patch?:string}={}){
 const from:Record<string,string[]>={developing:['developing'],testing:['developing'],awaiting_approval:['testing'],deploy_queued:['testing'],succeeded:['deploying'],failed:['developing','testing'],cancelled:['developing','testing'],interrupted:['developing','testing','deploying']};
 if(!from[state])throw new Error('Invalid run transition');
 await c.query('BEGIN');
 try{
  const result=await c.query("UPDATE development_runs SET state=$3,summary=$4,base_sha=COALESCE($5,base_sha),commit_sha=COALESCE($6,commit_sha),patch=COALESCE($8,patch),heartbeat_at=now(),updated_at=now(),finished_at=CASE WHEN $3 IN ('succeeded','failed','cancelled','interrupted') THEN now() ELSE NULL END WHERE id=$1 AND lease_token=$2 AND state=ANY($7::text[]) AND (NOT cancel_requested OR $3 IN ('cancelled','failed','interrupted'))",[r.id,r.lease_token,state,message,fields.base||null,fields.commit||null,from[state],fields.patch??null]);
  if(!result.rowCount)throw new Error('Run ownership lost');
  await c.query('INSERT INTO development_run_events(run_id,stage,message) VALUES($1,$2,$3)',[r.id,state,message]);
  await c.query("INSERT INTO development_events(item_id,actor_kind,actor_id,event,detail) VALUES($1,'admin',$2,'agent_run_progress',$3)",[r.item_id,r.requester_id,JSON.stringify({run_id:r.id,state,note:message,commit_sha:fields.commit||r.commit_sha})]);
  // The task remains in test: a successful deployment does not assert that all
  // business acceptance criteria have been verified by the owner.
  if(['awaiting_approval','deploy_queued','succeeded'].includes(state))await c.query("UPDATE development_items SET status='test',version=version+1,updated_at=now(),data=jsonb_set(data,'{completion_evidence}',to_jsonb($2::text)) WHERE id=$1 AND status IN ('in_progress','review','test')",[r.item_id,`Agent run ${r.id}: ${message}; commit ${fields.commit||r.commit_sha||''}`]);
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e}
}

import { loadConfig } from '../../config.js';
import { getPool } from '../../db/client.js';
import { Errors } from '../../lib/errors.js';
import { atomic, item, event, version, type Actor } from './service.js';

export const activeStates = ['queued','developing','testing','awaiting_approval','deploy_queued','deploying'];
export function requireRunManager(a:Actor) {
  if (a.kind !== 'admin' || !a.manager) throw Errors.forbidden('Only delivery managers can operate coding agents');
}
export function assertRunnable(r:any) {
  if (r.is_demo) throw Errors.validation('Demo history cannot run code');
  if (!['todo','in_progress'].includes(r.status)) throw Errors.conflict('not_queued','Queue the reviewed specification for development first');
  if (!r.data.spec?.objective?.trim() || !r.data.spec?.acceptance?.trim() || !r.data.definition_of_done?.trim()) throw Errors.validation('Objective, acceptance criteria and Definition of Done are required');
}
export async function startRun(a:Actor,id:string,b:{id:string;version:number;target:'test'|'production'}) {
  requireRunManager(a);
  if(loadConfig().NATIO_SANDBOX_ONLY)throw Errors.forbidden('The public demo cannot execute coding agents');
  if(process.env.NATIO_AGENT_RUNS_ENABLED!=='true') throw Errors.conflict('runner_disabled','Agent runner is not configured');
  if(b.target==='production'&&a.mode!=='live') throw Errors.forbidden('Test tasks cannot deploy to production');
  if(!(await runnerReady(b.target==='production')))throw Errors.conflict('runner_offline','No healthy runner is available for this target');
  return atomic(a.mode,async c=>{
    const r=await item(c,id,a,true);
    const previous=(await c.query('SELECT * FROM development_runs WHERE id=$1',[b.id])).rows[0];
    if(previous){if(previous.item_id!==id||previous.requester_id!==a.id||previous.item_version!==b.version||previous.target!==b.target)throw Errors.conflict('run_id_reused','Use a new run identifier');return publicRun(previous)}
    version(r,b.version);assertRunnable(r);
    if((await c.query('SELECT 1 FROM development_runs WHERE item_id=$1 AND state=ANY($2::text[])',[id,activeStates])).rowCount)throw Errors.conflict('run_active','This task already has an active run');
    if((await c.query("SELECT 1 FROM development_items WHERE id=ANY($1::uuid[]) AND status<>'done'",[r.data.dependencies||[]])).rowCount)throw Errors.conflict('dependencies_incomplete','Complete dependencies before running agents');
    if(r.data.method==='scrum'&&!(await c.query("SELECT 1 FROM development_sprints WHERE id=$1 AND mode=$2 AND status='active'",[r.sprint_id,a.mode])).rowCount)throw Errors.validation('Assign the task to an active sprint first');
    const count=(await c.query("SELECT count(*)::int n FROM development_items WHERE mode=$1 AND status='in_progress' AND NOT is_demo",[a.mode])).rows[0].n;
    if(r.status!=='in_progress'&&count>=5)throw Errors.conflict('wip_limit','Finish active work first');
    const run=(await c.query('INSERT INTO development_runs(id,item_id,mode,requester_id,item_version,snapshot,target) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[b.id,id,a.mode,a.id,b.version,JSON.stringify({title:r.title,spec:r.data.spec,definition_of_done:r.data.definition_of_done}),b.target])).rows[0];
    await c.query("UPDATE development_items SET status='in_progress',version=version+1,started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$1",[id]);
    await event(c,id,a,'agent_run_requested',{run_id:b.id,target:b.target});
    return publicRun(run);
  });
}
export function publicRun(r:any){const {snapshot,lease_token,patch,...rest}=r;return rest}
export async function runnerReady(production=false){const r=(await getPool().query("SELECT 1 FROM development_runner_status WHERE id AND heartbeat_at>now()-interval '20 seconds' AND (NOT $1 OR production_enabled)",[production])).rowCount;return !!r}
export async function listRuns(a:Actor,id:string){requireRunManager(a);await item(getPool(),id,a);return {enabled:process.env.NATIO_AGENT_RUNS_ENABLED==='true'&&!loadConfig().NATIO_SANDBOX_ONLY&&await runnerReady(),data:(await getPool().query('SELECT * FROM development_runs WHERE item_id=$1 ORDER BY created_at DESC LIMIT 20',[id])).rows.map(publicRun)}}
export async function changeRun(a:Actor,id:string,runId:string,action:'cancel'|'approve',sha?:string){
  requireRunManager(a);
  return atomic(a.mode,async c=>{await item(c,id,a,true);const r=(await c.query('SELECT * FROM development_runs WHERE id=$1 AND item_id=$2 FOR UPDATE',[runId,id])).rows[0];if(!r)throw Errors.notFound('Agent run');
    if(action==='approve'){
      if(r.state!=='awaiting_approval'||r.commit_sha!==sha||!r.patch?.trim()||r.cancel_requested)throw Errors.conflict('run_changed','Approve the current tested commit only');
      await c.query("UPDATE development_runs SET state='deploy_queued',approved_sha=commit_sha,approved_by=$2,updated_at=now() WHERE id=$1",[runId,a.id]);
    }else{
      if(r.state==='deploying')throw Errors.conflict('deploy_in_progress','Deployment is in progress; reconcile its result before rollback');
      if(!activeStates.includes(r.state))throw Errors.conflict('run_finished','Run is already finished');
      await c.query("UPDATE development_runs SET cancel_requested=true,state=CASE WHEN state IN ('queued','awaiting_approval','deploy_queued') THEN 'cancelled' ELSE state END,finished_at=CASE WHEN state IN ('queued','awaiting_approval','deploy_queued') THEN now() ELSE finished_at END,updated_at=now() WHERE id=$1",[runId]);
    }
    const updated=(await c.query('SELECT state FROM development_runs WHERE id=$1',[runId])).rows[0];
    await c.query('INSERT INTO development_run_events(run_id,stage,message) VALUES($1,$2,$3)',[runId,updated.state,action==='approve'?'Administrator approved deployment of the tested commit.':'Administrator requested cancellation.']);
    await event(c,id,a,'agent_run_'+action,{run_id:runId,commit_sha:sha});return {ok:true};
  });
}
export async function runEvents(a:Actor,id:string,runId:string,after:number){requireRunManager(a);await item(getPool(),id,a);if(!(await getPool().query('SELECT 1 FROM development_runs WHERE id=$1 AND item_id=$2',[runId,id])).rowCount)throw Errors.notFound('Agent run');return {data:(await getPool().query('SELECT id,stage,message,created_at FROM development_run_events WHERE run_id=$1 AND id>$2 ORDER BY id LIMIT 200',[runId,after])).rows}}

export async function runPatch(a:Actor,id:string,runId:string){requireRunManager(a);await item(getPool(),id,a);const r=(await getPool().query('SELECT base_sha,commit_sha,patch FROM development_runs WHERE id=$1 AND item_id=$2',[runId,id])).rows[0];if(!r)throw Errors.notFound('Agent run');return r}

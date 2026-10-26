import type {PoolClient} from 'pg';
import {z} from 'zod';
export const automationInput=z.object({name:z.string().trim().min(3).max(160),enabled:z.boolean().default(false),trigger_status:z.enum(['backlog','analysis','todo','in_progress','test','done']),issue_type:z.enum(['epic','story','task','bug','subtask']).nullable(),action_field:z.enum(['assignee','qa_owner']),action_value:z.string().trim().min(1).max(100)}).strict();
export function matchesRule(rule:any,item:any){return rule.enabled&&rule.trigger_status===item.status&&(!rule.issue_type||rule.issue_type===item.issue_type)&&!item.is_demo;}
// A bounded, non-recursive automation pass inside the originating status transaction.
// Rules may assign responsibility only; they never execute agents, publish or bypass status gates.
export async function applyStatusRules(c:PoolClient,item:any,eventId:number){
 const rules=(await c.query('SELECT * FROM development_automation_rules WHERE mode=$1 AND enabled ORDER BY created_at,id LIMIT 25',[item.mode])).rows;
 for(const rule of rules){if(!matchesRule(rule,item))continue;
  await c.query('SAVEPOINT development_rule');
  try{
   const changed=item.data[rule.action_field]!==rule.action_value;
   const logged=await c.query('INSERT INTO development_automation_executions(rule_id,item_id,event_id,outcome,detail) VALUES($1,$2,$3,$4,$5) ON CONFLICT(rule_id,event_id) DO NOTHING RETURNING id',[rule.id,item.id,eventId,changed?'applied':'unchanged',JSON.stringify({field:rule.action_field,value:rule.action_value,rule_version:rule.version})]);
   if(changed&&logged.rowCount){
    const saved=(await c.query('UPDATE development_items SET data=jsonb_set(data,ARRAY[$2]::text[],to_jsonb($3::text)),version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[item.id,rule.action_field,rule.action_value])).rows[0];
    await c.query("INSERT INTO development_events(item_id,actor_kind,actor_id,event,detail) VALUES($1,'admin',$2,'automation_applied',$3)",[item.id,rule.created_by,JSON.stringify({rule_id:rule.id,field:rule.action_field,value:rule.action_value})]);item=saved;
   }
   await c.query('RELEASE SAVEPOINT development_rule');
  }catch{
   await c.query('ROLLBACK TO SAVEPOINT development_rule');
   await c.query("INSERT INTO development_automation_executions(rule_id,item_id,event_id,outcome,detail) VALUES($1,$2,$3,'failed',$4) ON CONFLICT(rule_id,event_id) DO NOTHING",[rule.id,item.id,eventId,JSON.stringify({reason:'Assignment could not be applied',rule_version:rule.version})]);
   await c.query('RELEASE SAVEPOINT development_rule');
  }
 }
 return item;
}

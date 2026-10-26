import type {FastifyInstance} from 'fastify';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {getPool} from '../../db/client.js';
import {requireAdmin} from '../guards.js';
import {parse} from '../validate.js';
import {Errors} from '../../lib/errors.js';
import {hasAdminPermission} from '../../modules/auth/permissions.js';
import {atomic,item,version,type Actor} from '../../modules/development/service.js';
import {automationInput,matchesRule} from '../../modules/development/automation.js';
export function registerDevelopmentAutomation(app:FastifyInstance){
 const base='/admin/development/automations',guard=requireAdmin();
 const actor=(req:any):Actor=>{if(!hasAdminPermission(req.admin.admin.role,'development.manage'))throw Errors.forbidden('Delivery manager required');return {kind:'admin',id:req.admin.admin.id,manager:true,mode:req.dashboardMode}};
 app.get(base,{preHandler:guard},async req=>{const a=actor(req),p=getPool();return {rules:(await p.query('SELECT * FROM development_automation_rules WHERE mode=$1 ORDER BY created_at,id',[a.mode])).rows,executions:(await p.query('SELECT x.*,r.name,i.title FROM development_automation_executions x JOIN development_automation_rules r ON r.id=x.rule_id JOIN development_items i ON i.id=x.item_id WHERE r.mode=$1 ORDER BY x.id DESC LIMIT 100',[a.mode])).rows}});
 app.post(base,{preHandler:guard},async req=>{const a=actor(req),b=parse(automationInput,req.body);return atomic(a.mode,async c=>{if((await c.query('SELECT count(*)::int n FROM development_automation_rules WHERE mode=$1',[a.mode])).rows[0].n>=25)throw Errors.validation('Maximum 25 rules per workspace mode');return (await c.query('INSERT INTO development_automation_rules(id,mode,name,enabled,trigger_status,issue_type,action_field,action_value,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[randomUUID(),a.mode,b.name,b.enabled,b.trigger_status,b.issue_type,b.action_field,b.action_value,a.id])).rows[0]})});
 app.put(base+'/:id',{preHandler:guard},async req=>{const a=actor(req),{id}=parse(z.object({id:z.string().uuid()}),req.params),b=parse(automationInput.extend({version:z.number().int().positive()}),req.body);return atomic(a.mode,async c=>{const r=(await c.query('SELECT * FROM development_automation_rules WHERE id=$1 AND mode=$2 FOR UPDATE',[id,a.mode])).rows[0];if(!r)throw Errors.notFound('Automation rule');version(r,b.version);return (await c.query('UPDATE development_automation_rules SET name=$2,enabled=$3,trigger_status=$4,issue_type=$5,action_field=$6,action_value=$7,version=version+1 WHERE id=$1 RETURNING *',[id,b.name,b.enabled,b.trigger_status,b.issue_type,b.action_field,b.action_value])).rows[0]})});
 app.post(base+'/preview',{preHandler:guard},async req=>{const a=actor(req),b=parse(z.object({rule:automationInput,item_id:z.string().uuid(),status:z.enum(['backlog','analysis','todo','in_progress','test','done'])}).strict(),req.body),r=await item(getPool(),b.item_id,a);const matches=matchesRule({...b.rule,enabled:true},{...r,status:b.status});return {matches,enabled:b.rule.enabled,change:matches?{field:b.rule.action_field,from:r.data[b.rule.action_field],to:b.rule.action_value}:null,persisted:false}});
}

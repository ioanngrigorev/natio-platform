import {z} from 'zod';
import {Errors} from '../../lib/errors.js';
import {atomic,item,event,version,owns,view,assertNoActiveRun,type Actor} from './service.js';
export const issueTypes=['epic','story','task','bug','subtask'] as const;
export const hierarchyInput=z.object({version:z.number().int().positive(),issue_type:z.enum(issueTypes),parent_id:z.string().uuid().nullable()}).strict();
const accepts=(parent:string,child:string)=>parent==='epic'?['story','task','bug'].includes(child):['story','task','bug'].includes(parent)&&child==='subtask';
export async function setHierarchy(a:Actor,id:string,b:z.infer<typeof hierarchyInput>){return atomic(a.mode,async c=>{
 const r=await item(c,id,a,true);version(r,b.version);await assertNoActiveRun(c,id);
 if(!a.manager&&(!owns(r,a)||!view(r,a).can_edit))throw Errors.forbidden('Task edit permission required');
 if(b.issue_type==='epic'&&b.parent_id||b.issue_type==='subtask'&&!b.parent_id)throw Errors.validation('Epics have no parent; subtasks require a parent task');
 if(b.parent_id){const parent=await item(c,b.parent_id,a);if(id===parent.id||parent.is_demo!==r.is_demo||!accepts(parent.issue_type,b.issue_type))throw Errors.validation('Use epic → story/task/bug → subtask hierarchy within the same data scope');}
 const children=(await c.query('SELECT issue_type FROM development_items WHERE parent_id=$1',[id])).rows;
 if(children.some(child=>!accepts(b.issue_type,child.issue_type)))throw Errors.validation('Move child tasks before changing this issue type');
 const saved=(await c.query('UPDATE development_items SET issue_type=$2,parent_id=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[id,b.issue_type,b.parent_id])).rows[0];
 await event(c,id,a,'hierarchy_updated',{issue_type:b.issue_type,parent_id:b.parent_id});return view(saved,a);
})}
export const rankInput=z.object({version:z.number().int().positive(),before_id:z.string().uuid().nullable()}).strict();
export async function rankItem(a:Actor,id:string,b:z.infer<typeof rankInput>){return atomic(a.mode,async c=>{
 const r=await item(c,id,a,true);version(r,b.version);
 if(!a.manager)throw Errors.forbidden('Delivery manager required to rank the shared board');
 if(b.before_id===id)return view(r,a);
 const rows=(await c.query('SELECT id,board_rank FROM development_items WHERE mode=$1 AND status=$2 AND is_demo=$3 ORDER BY board_rank,id FOR UPDATE',[a.mode,r.status,r.is_demo])).rows;
 const ids=rows.map(x=>x.id).filter(x=>x!==id),pos=b.before_id?ids.indexOf(b.before_id):ids.length;
 if(pos<0)throw Errors.validation('Rank relative to a card in the same column');ids.splice(pos,0,id);
 // Serialize on the workspace lock and update only ordering. Concurrent specification writes remain version checked.
 await c.query('UPDATE development_items i SET board_rank=o.n*1024,version=i.version+1,updated_at=now() FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id,n) WHERE i.id=o.id AND i.board_rank<>o.n*1024',[ids]);
 await event(c,id,a,'rank_changed',{before_id:b.before_id});return view(await item(c,id,a),a);
})}
export const sprintAssignmentInput=z.object({version:z.number().int().positive(),sprint_id:z.string().uuid().nullable()}).strict();
export async function assignSprint(a:Actor,id:string,b:z.infer<typeof sprintAssignmentInput>){return atomic(a.mode,async c=>{
 if(!a.manager)throw Errors.forbidden('Delivery manager required');const r=await item(c,id,a,true);version(r,b.version);await assertNoActiveRun(c,id);
 if(!['backlog','analysis','todo'].includes(r.status))throw Errors.validation('Return work to planning before changing its sprint');
 if(b.sprint_id&&!(await c.query("SELECT 1 FROM development_sprints WHERE id=$1 AND mode=$2 AND status<>'completed'",[b.sprint_id,a.mode])).rowCount)throw Errors.validation('Choose an open sprint');
 const saved=(await c.query("UPDATE development_items SET sprint_id=$2,data=jsonb_set(data,'{method}',to_jsonb($3::text)),version=version+1,updated_at=now() WHERE id=$1 RETURNING *",[id,b.sprint_id,b.sprint_id?'scrum':'kanban'])).rows[0];
 await event(c,id,a,'sprint_assigned',{from:r.sprint_id,to:b.sprint_id});return view(saved,a);
})}

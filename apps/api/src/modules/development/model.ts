import { z } from 'zod';
export const stages=['draft','idea','backlog','todo','in_progress','review','test','done','rejected','archived'] as const;
export type Stage=typeof stages[number];
export const flowStages=['todo','in_progress','review','test','done'] as const;
export const specification=z.object({
 objective:z.string().max(4000),users:z.string().max(2000),scope:z.string().max(6000),
 acceptance:z.string().max(6000),technical:z.string().max(6000),risks:z.string().max(4000),questions:z.string().max(4000),
}).strict();
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const d=new Date(s);return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s},'Use a valid date');
export const phaseKinds=['analysis','development','testing','deployment','monitoring'] as const;
export const deliveryPhase=z.object({
 id:z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),kind:z.enum(phaseKinds),name:z.string().trim().min(1).max(100),
 start:date,end:date,owner:z.string().max(100).default(''),progress:z.number().int().min(0).max(100).default(0),
}).strict().refine(v=>v.end>=v.start,'Phase end must be on or after start');
export const scheduleInput=z.object({start:date,end:date,analyst:z.string().max(100).default(''),assignee:z.string().max(100).default(''),qa_owner:z.string().max(100).default(''),devops:z.string().max(100).default('')}).strict().refine(v=>v.end>=v.start,'End must be on or after start');
export function scheduleTemplate(input:z.infer<typeof scheduleInput>){
 const d=scheduleInput.parse(input),days=Math.round((Date.parse(d.end)-Date.parse(d.start))/86400000)+1;
 const at=(n:number)=>new Date(Date.parse(d.start)+Math.min(days-1,n)*86400000).toISOString().slice(0,10);
 const bounds=[0,.15,.55,.8,.9,1],names=['Analysis & specification','Development & review','Testing & acceptance','Deployment & verification','Post-release monitoring'];
 const owners=[d.analyst,d.assignee,d.qa_owner,d.devops,d.devops];
 return phaseKinds.map((kind,i)=>({id:kind,kind,name:names[i]!,start:at(Math.floor(days*bounds[i]!)),end:at(Math.max(Math.floor(days*bounds[i]!),Math.floor(days*bounds[i+1]!)-1)),owner:owners[i]!,progress:0}));
}
export const developmentData=z.object({
 request:z.string().trim().max(8000).default(''),source_path:z.string().max(200).regex(/^\/(admin|dashboard)(?:\/[a-zA-Z0-9_-]+)*$/).default('/admin'),
 spec:specification,
 monthly_revenue_usd:z.number().min(0).max(1e9).default(0),monthly_savings_usd:z.number().min(0).max(1e9).default(0),one_time_cost_usd:z.number().min(0).max(1e9).default(0),
 effort_hours:z.number().min(1/60).max(100000).default(8),complexity:z.number().int().min(1).max(5).default(3),confidence_pct:z.number().int().min(0).max(100).default(0),market_pct:z.number().int().min(0).max(100).default(0),
 evidence:z.string().max(4000).default(''),method:z.enum(['kanban','scrum','pmbok','hybrid']).default('kanban'),worker:z.enum(['ai','human','hybrid']).default('hybrid'),assignee:z.string().max(100).default(''),
 plan_start:date.nullable().default(null),plan_end:date.nullable().default(null),milestone:z.boolean().default(false),dependencies:z.array(z.string().uuid()).max(30).default([]),
 phases:z.array(deliveryPhase).max(40).default([]),
 process_type:z.enum(['delivery','payment']).default('delivery'),qa_owner:z.string().max(100).default(''),analyst:z.string().max(100).default(''),devops:z.string().max(100).default(''),
 story_points:z.number().int().min(0).max(100).default(0),definition_of_done:z.string().max(4000).default('Acceptance criteria passed; regression tests passed; reviewer approval; release verified.'),
 completion_evidence:z.string().max(4000).default(''),realized_usd:z.number().min(-1e9).max(1e9).nullable().default(null),
}).strict().refine(v=>(v.plan_start===null)===(v.plan_end===null)&&(!v.plan_start||v.plan_end!>=v.plan_start),'Provide both dates with end on or after start').refine(v=>!v.milestone||!v.plan_start||v.plan_start===v.plan_end,'Milestones have one date')
 .refine(v=>new Set(v.phases.map(p=>p.id)).size===v.phases.length,'Phase identifiers must be unique')
 .refine(v=>!v.phases.length||(!v.milestone&&!!v.plan_start&&!!v.plan_end&&v.phases.every(p=>p.start>=v.plan_start!&&p.end<=v.plan_end!)),'Phase dates must be inside the task schedule; milestones have no phases');
export type DevelopmentData=z.infer<typeof developmentData>;
export const itemInput=z.object({title:z.string().trim().min(3).max(160),public_summary:z.string().max(2000).default(''),data:developmentData}).strict();
export const sprintInput=z.object({name:z.string().trim().min(3).max(100),goal:z.string().trim().min(5).max(2000),start_date:date,end_date:date}).strict().refine(v=>v.end_date>=v.start_date&&(Date.parse(v.end_date)-Date.parse(v.start_date))/86400000<=31,'Sprint must be 1–31 days');
export function priority(d:Pick<DevelopmentData,'monthly_revenue_usd'|'monthly_savings_usd'|'one_time_cost_usd'|'effort_hours'|'complexity'|'confidence_pct'|'market_pct'>){
 const net=Math.max(0,3*(d.monthly_revenue_usd+d.monthly_savings_usd)-d.one_time_cost_usd),risk=1+.15*(d.complexity-1);
 return Math.round(net*(d.confidence_pct/100)*(.5+.5*d.market_pct/100)/(d.effort_hours*risk)*100)/100;
}
export const priorityFormula='max(0, 3 × (monthly revenue + monthly savings) − one-time cost) × confidence × (0.5 + 0.5 × market evidence) ÷ (engineering hours × (1 + 0.15 × (complexity − 1)))';
export const transitions:Record<Stage,Stage[]>={draft:['idea','backlog','rejected','archived'],idea:['draft','backlog','rejected','archived'],backlog:['idea','todo','rejected','archived'],todo:['backlog','in_progress','archived'],in_progress:['todo','review'],review:['in_progress','test'],test:['in_progress','done'],done:['backlog','archived'],rejected:['idea','archived'],archived:['idea']};
export function hasCycle(id:string,deps:string[],graph:Map<string,string[]>){const walk=(node:string,seen:Set<string>):boolean=>{if(node===id)return true;if(seen.has(node))return false;seen.add(node);return (graph.get(node)||[]).some(n=>walk(n,seen))};return deps.some(d=>walk(d,new Set()));}

// Planning cost is separate from expected business value and never initiates a charge.
export const ENGINEERING_RATE_USD = 30;
export function engineeringCost(hours: number) {
 return {currency:'USD' as const,hourly_rate:ENGINEERING_RATE_USD,estimated_hours:hours,estimated_cost:Math.round(hours*ENGINEERING_RATE_USD*100)/100};
}

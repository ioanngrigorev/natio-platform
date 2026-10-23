/** Merchant AI is scoped by the authenticated organization. Model output and
 * saved filters can never widen that scope, including for downloaded reports. */
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {requireMerchant} from '../guards.js';
import {parse} from '../validate.js';
import {getPool} from '../../db/client.js';
import {loadConfig} from '../../config.js';
import {Errors} from '../../lib/errors.js';
import {assistantInput,dashboardSpec} from '../../modules/assistant/schemas.js';
import {askAssistant,transcribeAudio} from '../../modules/assistant/client.js';
import {validateAttachment,type Attachment} from '../../modules/assistant/attachments.js';
import {billingActor,meteredAi} from '../../modules/plans/billing.js';
import {requirePlan} from '../../modules/plans/service.js';
import {biQuery,businessIntelligence} from '../../modules/analytics/bi.js';
import {trafficAnalytics} from '../../modules/analytics/traffic.js';
import {excelReport} from '../../modules/analytics/excel.js';
import {tabularReport} from '../../modules/analytics/reports.js';
import {searchKnowledge,knowledgeVersion} from '../../modules/assistant/knowledge.js';
import {localeOf} from '../../modules/localization/service.js';
const params=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)});
export async function registerMerchantWorkspaceRoutes(app:FastifyInstance){
 const guard=requireMerchant('merchant.read'),analytics=requireMerchant('analytics.read'),pool=getPool();
 const owner=(r:FastifyRequest)=>r.merchantUser!.user.id,merchant=(r:FastifyRequest)=>r.merchantUser!.merchant.id;
 const filters=(r:FastifyRequest)=>({...parse(biQuery,r.query),merchant_id:merchant(r)});
 const premiumReports=(r:FastifyRequest)=>requirePlan(merchant(r),'advanced_reports',r.dashboardMode);
 app.get('/dashboard/assistant/status',{preHandler:guard},async()=>({configured:!!loadConfig().OPENAI_API_KEY,knowledge_version:knowledgeVersion}));
 app.post('/dashboard/assistant/chat',{preHandler:guard,config:{rateLimit:{max:15,timeWindow:'1 minute'}}},async r=>meteredAi(billingActor(r),'text',()=>askAssistant(parse(assistantInput,r.body),r.dashboardMode,[],merchant(r))));
 app.post('/dashboard/assistant/chat-with-files',{preHandler:guard,bodyLimit:11*1024*1024,config:{rateLimit:{max:8,timeWindow:'1 minute'}}},async r=>{
  let metadata:unknown,total=0;const files:Attachment[]=[];
  for await(const part of r.parts({limits:{fileSize:5*1024*1024,files:4,fields:1,fieldSize:100000,parts:5}})){
   if(part.type==='file'){const bytes=await part.toBuffer();total+=bytes.length;if(total>10*1024*1024)throw Errors.validation('Maximum 10 MB of attachments per message');files.push(validateAttachment(part.filename,bytes));}
   else if(part.fieldname==='request'&&!metadata){try{metadata=JSON.parse(String(part.value))}catch{throw Errors.validation('Invalid message metadata')}}else throw Errors.validation('Unexpected attachment field');
  }
  const input=parse(assistantInput,metadata);if(!files.length)throw Errors.validation('Attach at least one file');
  return meteredAi(billingActor(r),'attachments',()=>askAssistant(input,r.dashboardMode,files,merchant(r)));
 });
 app.post('/dashboard/assistant/transcribe',{preHandler:guard,config:{rateLimit:{max:8,timeWindow:'1 minute'}}},async r=>{const f=await r.file({limits:{fileSize:5*1024*1024,files:1}});if(!f)throw Errors.validation('Audio file required');const bytes=await f.toBuffer();return meteredAi(billingActor(r),'voice',()=>transcribeAudio(bytes,f.mimetype))});
 app.get('/dashboard/knowledge',{preHandler:guard},async r=>{const q=parse(z.object({q:z.string().max(300).default(''),category:z.string().max(60).optional()}),r.query),data=searchKnowledge(q.q,q.category,localeOf(r.cookies.natio_locale)).map(a=>({...a,route:'/dashboard'}));return{data,categories:[...new Set(data.map(a=>a.category))],version:knowledgeVersion}});
 app.get('/dashboard/bi',{preHandler:analytics},async r=>{
  await premiumReports(r);const {coverage:_coverage,options:_options,...report}=await businessIntelligence(filters(r),r.dashboardMode);
  // Do not return global platform inventory/options to a tenant.
  return {...report,options:{methods:report.methods.map((x:any)=>x.label),currencies:report.balances.map((x:any)=>x.currency)},coverage:{merchants:1,users:null,providers:null,transactions:report.summary.transactions}};
 });
 app.get('/dashboard/bi/traffic',{preHandler:analytics},async r=>{await premiumReports(r);return trafficAnalytics(filters(r),r.dashboardMode)});
 for(const format of ['xlsx','csv'] as const)app.get('/dashboard/bi/export.'+format,{preHandler:analytics,config:{rateLimit:{max:4,timeWindow:'1 minute'}}},async(r,reply)=>{
  await premiumReports(r);const q=filters(r),report=format==='xlsx'&&q.kind==='summary'?excelReport(q,r.dashboardMode):tabularReport(q,r.dashboardMode,format);
  return reply.header('Content-Disposition','attachment; filename="natio-report.'+format+'"').type(format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/csv; charset=utf-8').send(report.stream);
 });
 app.get('/dashboard/boards',{preHandler:analytics},async r=>{await premiumReports(r);return {data:(await pool.query('SELECT * FROM merchant_dashboards WHERE owner_id=$1 AND merchant_id=$2 AND mode=$3 ORDER BY updated_at DESC LIMIT 100',[owner(r),merchant(r),r.dashboardMode])).rows}});
 app.post('/dashboard/boards',{preHandler:analytics},async r=>{
  await premiumReports(r);const body=parse(params.extend({spec:dashboardSpec}).strict(),r.body),spec={...body.spec,filters:{...body.spec.filters,merchant_id:merchant(r)}};
  await pool.query('INSERT INTO merchant_dashboards(id,owner_id,merchant_id,mode,name,spec) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',[body.id,owner(r),merchant(r),r.dashboardMode,spec.name,JSON.stringify(spec)]);
  const row=(await pool.query('SELECT *,spec=$5::jsonb AS same_spec FROM merchant_dashboards WHERE id=$1 AND owner_id=$2 AND merchant_id=$3 AND mode=$4',[body.id,owner(r),merchant(r),r.dashboardMode,JSON.stringify(spec)])).rows[0];
  if(!row||!row.same_spec)throw Errors.conflict('request_reused','Use a new request identifier');return row;
 });
 app.delete('/dashboard/boards/:id',{preHandler:analytics},async r=>{await premiumReports(r);const p=parse(params,r.params);if(!(await pool.query('DELETE FROM merchant_dashboards WHERE id=$1 AND owner_id=$2 AND merchant_id=$3 AND mode=$4 RETURNING id',[p.id,owner(r),merchant(r),r.dashboardMode])).rowCount)throw Errors.notFound('Dashboard');return {deleted:true}});
}

import {localeOf} from '../../modules/localization/service.js';
import {trafficAnalytics} from '../../modules/analytics/traffic.js';
import {biQuery} from '../../modules/analytics/bi.js';
import {greetingQuotes,searchQuotes} from '../../modules/quotes/service.js';
import {LocationLookup,validTimeZone} from '../../modules/quotes/location.js';
import {dateInZone,dailyPerspective} from '../../modules/quotes/daily.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../guards.js';
import { parse } from '../validate.js';
import { getPool } from '../../db/client.js';
import { Errors } from '../../lib/errors.js';
import { loadConfig } from '../../config.js';
import { knowledge, localizedKnowledge, knowledgeVersion, searchKnowledge } from '../../modules/assistant/knowledge.js';
import { assistantInput, dashboardSpec, connectionSpec } from '../../modules/assistant/schemas.js';
import {validateAttachment,type Attachment} from '../../modules/assistant/attachments.js';
import {billingActor,meteredAi} from '../../modules/plans/billing.js';
import { askAssistant, transcribeAudio } from '../../modules/assistant/client.js';
import { createLab, getLab, runLab, labTemplates } from '../../modules/assistant/lab.js';
import { riskDashboard, riskQuery, riskThresholds } from '../../modules/analytics/risk-dashboard.js';
import ExcelJS from 'exceljs';
import { SnapshotCache } from '../../modules/analytics/snapshot-cache.js';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), params=z.object({id});
export async function registerWorkspaceRoutes(app:FastifyInstance){
 const guard=requireAdmin(), pool=getPool(), snapshots=new SnapshotCache();
 const locations=new LocationLookup(fetch,()=>Date.now(),loadConfig().GEOLOCATION_API_KEY);
 app.get('/admin/daily-perspective',{preHandler:guard},async(req,reply)=>{
  const q=parse(z.object({time_zone:z.string().max(80).default('UTC').refine(validTimeZone,'Invalid time zone')}),req.query);
  const location=await locations.resolve(req.ip),timeZone=location?.time_zone??q.time_zone,date=dateInZone(new Date(),timeZone);
  return reply.header('Cache-Control','private, no-store').send({quote:dailyPerspective(date,req.admin!.admin.id),local_date:date,time_zone:timeZone,location,source:location?'ip':'device'});
 });
 app.post('/admin/risk-dashboard/scenario',{preHandler:guard},async(req)=>{
  if(req.dashboardMode!=='test')throw Errors.forbidden('Simulation requires Test data');
  const b=parse(z.object({settled:z.number().int().positive().max(10000000),disputes:z.number().int().nonnegative().max(10000000),average_amount:z.number().int().nonnegative().max(100000000),fee:z.number().int().nonnegative().max(1000000),currency:z.string().regex(/^[A-Z]{3}$/)}).strict().refine(v=>v.disputes<=v.settled,'Disputes cannot exceed settled payments in the same cohort'),req.body);
  return {synthetic:true,ratio_pct:b.disputes/b.settled*100,exposure_minor:b.disputes*(b.average_amount+b.fee),currency:b.currency,note:'Same-cohort scenario, not a card-network monitoring calculation. Actual losses depend on recoveries, dispute outcomes and contract terms.'};
 });
 app.get('/admin/risk-dashboard/export.xlsx',{preHandler:guard,config:{rateLimit:{max:4,timeWindow:'1 minute'}}},async(req,reply)=>{
  parse(riskQuery,req.query);parse(riskThresholds,req.query);const d=await riskDashboard(req.query,req.dashboardMode!);
  const wb=new ExcelJS.Workbook();wb.creator='NATIO';const info=wb.addWorksheet('Scope');info.addRows([['Mode',d.mode],['From',d.period.from],['To',d.period.to],['Currency',d.currency],['Generated',d.generated_at],['Amounts','Minor currency units; no FX conversion'],['Disputes',d.disputes.reason],['Thresholds',JSON.stringify(d.thresholds)]]);
  for(const [name,rows] of [['Signals',d.signals],['Daily',d.daily],['Merchants',d.merchants],['Providers',d.providers],['Large payments',d.large_payments]] as const){const sheet=wb.addWorksheet(name);if(rows.length){const keys=Object.keys(rows[0]);sheet.columns=keys.map(key=>({header:key,key,width:24}));rows.forEach((row:any)=>sheet.addRow(row));sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];}}
  return reply.header('content-disposition','attachment; filename="natio-risk.xlsx"').type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(await wb.xlsx.writeBuffer()));
 });
 app.get("/admin/risk-dashboard",{preHandler:guard},async(req)=>{parse(riskQuery,req.query);parse(riskThresholds,req.query);return snapshots.get(JSON.stringify([req.dashboardMode,req.query]),()=>riskDashboard(req.query,req.dashboardMode!));});
 app.get('/admin/knowledge',{preHandler:guard},async(req)=>{const q=parse(z.object({q:z.string().max(300).default(''),category:z.string().max(60).optional()}),req.query);const locale=localeOf(req.cookies.natio_locale);return {version:knowledgeVersion,locale,categories:[...new Set(localizedKnowledge(locale).map(a=>a.category))],data:searchKnowledge(q.q,q.category,locale)};});
 app.get('/admin/bi/traffic',{preHandler:guard},async req=>trafficAnalytics(parse(biQuery,req.query),req.dashboardMode));
 app.get('/admin/greeting-quotes',{preHandler:guard},async()=>({data:greetingQuotes}));
 app.get('/admin/quotes',{preHandler:guard},async req=>{const b=parse(z.object({q:z.string().max(200).default(''),topic:z.string().max(60).default(''),page:z.coerce.number().int().min(1).max(10000).default(1)}),req.query);return searchQuotes(b.q,b.topic,b.page)});
 app.get('/admin/assistant/status',{preHandler:guard},async()=>({configured:!!loadConfig().OPENAI_API_KEY,knowledge_version:knowledgeVersion}));
 app.post('/admin/assistant/chat',{preHandler:guard,config:{rateLimit:{max:15,timeWindow:'1 minute'}}},async(req)=>{const input=parse(assistantInput,req.body);return meteredAi(billingActor(req),'text',()=>askAssistant(input,req.dashboardMode!))});
 app.post('/admin/assistant/chat-with-files',{preHandler:guard,bodyLimit:11*1024*1024,config:{rateLimit:{max:8,timeWindow:'1 minute'}}},async req=>{
  let metadata:unknown,bytes=0;const files:Attachment[]=[];
  for await(const part of req.parts({limits:{fileSize:5*1024*1024,files:4,fields:1,fieldSize:20000,parts:5}})){
   if(part.type==='file'){const b=await part.toBuffer();bytes+=b.length;if(bytes>10*1024*1024)throw Errors.validation('Maximum 10 MB of attachments per message');files.push(validateAttachment(part.filename,b));}
   else if(part.fieldname==='request'&&!metadata){try{metadata=JSON.parse(String(part.value))}catch{throw Errors.validation('Invalid message metadata')}}else throw Errors.validation('Unexpected attachment field');
  }
  const input=parse(assistantInput,metadata);if(!files.length)throw Errors.validation('Attach at least one file');
  return meteredAi(billingActor(req),'attachments',()=>askAssistant(input,req.dashboardMode!,files));
 });
 app.post('/admin/assistant/transcribe',{preHandler:guard,config:{rateLimit:{max:8,timeWindow:'1 minute'}}},async(req)=>{const file=await req.file({limits:{fileSize:5*1024*1024,files:1}});if(!file)throw Errors.validation('Audio file required');const bytes=await file.toBuffer();return meteredAi(billingActor(req),'voice',()=>transcribeAudio(bytes,file.mimetype));});
 app.get('/admin/boards',{preHandler:guard},async(req)=>({data:(await pool.query('SELECT * FROM admin_dashboards WHERE owner_id=$1 AND mode=$2 ORDER BY updated_at DESC LIMIT 100',[req.admin!.admin.id,req.dashboardMode])).rows}));
 app.post('/admin/boards',{preHandler:guard},async(req)=>{
  const b=parse(z.object({id,spec:dashboardSpec}).strict(),req.body), owner=req.admin!.admin.id;
  // One row per client request; retrying cannot create duplicate boards.
  await pool.query('INSERT INTO admin_dashboards(id,owner_id,mode,name,spec) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[b.id,owner,req.dashboardMode,b.spec.name,JSON.stringify(b.spec)]);
  const row=(await pool.query('SELECT *,spec=$4::jsonb AS same_spec FROM admin_dashboards WHERE id=$1 AND owner_id=$2 AND mode=$3',[b.id,owner,req.dashboardMode,JSON.stringify(b.spec)])).rows[0];
  if(!row||!row.same_spec)throw Errors.conflict('request_reused','Use a new request identifier');return row;
 });
 app.delete('/admin/boards/:id',{preHandler:guard},async(req)=>{const p=parse(params,req.params);const r=await pool.query('DELETE FROM admin_dashboards WHERE id=$1 AND owner_id=$2 AND mode=$3 RETURNING id',[p.id,req.admin!.admin.id,req.dashboardMode]);if(!r.rowCount)throw Errors.notFound('Dashboard');return {deleted:true};});
 app.get('/admin/lab',{preHandler:guard},async(req)=>({mode:'test',templates:labTemplates,data:(await pool.query('SELECT c.*, (SELECT row_to_json(r) FROM lab_runs r WHERE r.connection_id=c.id ORDER BY created_at DESC LIMIT 1) latest_run FROM lab_connections c WHERE owner_id=$1 OR owner_id IS NULL ORDER BY updated_at DESC LIMIT 100',[req.admin!.admin.id])).rows}));
 app.post('/admin/lab',{preHandler:guard},async(req)=>{if(req.dashboardMode!=='test')throw Errors.forbidden('Lab connections are available only in Test data');const b=parse(z.object({id,config:connectionSpec,confirmed:z.literal(true)}).strict(),req.body);return createLab(req.admin!.admin.id,b.config,b.id);});
 app.get('/admin/lab/:id',{preHandler:guard},async(req)=>{const p=parse(params,req.params);return {...await getLab(p.id,req.admin!.admin.id),runs:(await pool.query('SELECT * FROM lab_runs WHERE connection_id=$1 ORDER BY created_at DESC LIMIT 20',[p.id])).rows};});
 app.post('/admin/lab/:id/run',{preHandler:guard,config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(req)=>{if(req.dashboardMode!=='test')throw Errors.forbidden('Switch to Test data');const p=parse(params,req.params), b=parse(z.object({version:z.number().int().positive()}).strict(),req.body);return runLab(p.id,req.admin!.admin.id,b.version);});
}

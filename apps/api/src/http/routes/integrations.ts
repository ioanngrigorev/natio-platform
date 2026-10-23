/** Integration onboarding keeps credential issuance separate from activation.
 * A redirect key can create hosted sessions and read their result only. Merchant
 * ownership and Test/Live scope are resolved here, never trusted from the browser.
 */
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {and,eq,inArray} from 'drizzle-orm';
import {getDb,getPool} from '../../db/client.js';
import {apiKeys,merchants,providers} from '../../db/schema/index.js';
import {createApiKey,listApiKeys,publicApiKey,revokeApiKey} from '../../modules/api-keys/service.js';
import {listProjects,serializeProject} from '../../modules/merchants/service.js';
import {createProviderAccount,serializeAccount} from '../../modules/providers/service.js';
import {recordAudit} from '../../modules/audit/service.js';
import {requirePlan} from '../../modules/plans/service.js';
import {Errors} from '../../lib/errors.js';
import {requireAdmin,requireMerchant} from '../guards.js';
import {actorFromRequest} from '../context.js';
import {parse} from '../validate.js';
import {loadConfig} from '../../config.js';
const type=z.enum(['api','redirect']),id=z.string().min(1).max(100);
const policy=z.object({preferred_type:type,allowed_types:z.array(type).min(1).max(2)}).strict().refine(v=>v.allowed_types.includes(v.preferred_type),'Preferred integration must be enabled');
const keyInput=z.object({project_id:id,name:z.string().trim().min(2).max(80),integration_type:type}).strict();
export async function registerIntegrationRoutes(app:FastifyInstance){
 const db=getDb(),pool=getPool();
 async function merchantId(req:FastifyRequest,admin:boolean){
  if(!admin){const merchant=req.merchantUser!.merchant.id;await requirePlan(merchant,'integrations',req.dashboardMode);return merchant;}
  const {merchant_id}=parse(z.object({merchant_id:id}),req.query);
  if(!(await db.select({id:merchants.id}).from(merchants).where(eq(merchants.id,merchant_id)).limit(1)).length)throw Errors.notFound('Merchant');
  return merchant_id;
 }
 for(const admin of [true,false]){
  const base=(admin?'/admin':'/dashboard')+'/integrations';
  const read=admin?requireAdmin('integrations.read'):requireMerchant('api_keys.read');
  const manage=admin?requireAdmin('integrations.manage'):requireMerchant('api_keys.manage');
  app.get(base,{preHandler:read},async req=>{
   const merchant=await merchantId(req,admin),mode=req.dashboardMode;
   const profile=(await pool.query('SELECT preferred_type,allowed_types,updated_at FROM merchant_integration_profiles WHERE merchant_id=$1 AND mode=$2',[merchant,mode])).rows[0]??{preferred_type:'api',allowed_types:['api','redirect']};
   return {merchant_id:merchant,mode,profile,projects:(await listProjects(db,merchant)).map(serializeProject),keys:(await listApiKeys(db,merchant)).filter(k=>k.mode===mode).map(publicApiKey)};
  });
  app.post(base+'/keys',{preHandler:manage},async(req,reply)=>{
   const merchant=await merchantId(req,admin),body=parse(keyInput,req.body);
   const result=await createApiKey(db,{merchantId:merchant,projectId:body.project_id,mode:req.dashboardMode,name:body.name,integrationType:body.integration_type,actor:actorFromRequest(req)});
   return reply.header('Cache-Control','no-store').status(201).send({...publicApiKey(result.key),secret:result.secret});
  });
  app.delete(base+'/keys/:id',{preHandler:manage},async req=>{
   const merchant=await merchantId(req,admin),keyId=parse(z.object({id}),req.params).id;
   if(!(await db.select({id:apiKeys.id}).from(apiKeys).where(and(eq(apiKeys.id,keyId),eq(apiKeys.merchantId,merchant),eq(apiKeys.mode,req.dashboardMode))).limit(1)).length)throw Errors.notFound('Key');
   await revokeApiKey(db,{merchantId:merchant,keyId,actor:actorFromRequest(req)});return {revoked:true};
  });
 }
 app.patch('/admin/integrations',{preHandler:requireAdmin('integrations.manage')},async req=>{
  const merchant=await merchantId(req,true),body=parse(policy,req.body);
  if(loadConfig().NATIO_SANDBOX_ONLY&&req.dashboardMode==='live')throw Errors.forbidden('Live setup is disabled in the demo');
  await pool.query('INSERT INTO merchant_integration_profiles(merchant_id,mode,preferred_type,allowed_types,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(merchant_id,mode) DO UPDATE SET preferred_type=excluded.preferred_type,allowed_types=excluded.allowed_types,updated_by=excluded.updated_by,updated_at=now()',[merchant,req.dashboardMode,body.preferred_type,JSON.stringify([...new Set(body.allowed_types)]),req.admin!.admin.id]);
  await recordAudit(db,{actor:actorFromRequest(req),merchantId:merchant,action:'merchant.integration_policy',entityType:'merchant',entityId:merchant,after:{mode:req.dashboardMode,...body}});
  return body;
 });
 app.get('/admin/integrations/connectors',{preHandler:requireAdmin('integrations.read')},async()=>({data:(await db.select().from(providers).where(and(eq(providers.status,'active'),inArray(providers.adapterKey,loadConfig().NATIO_SANDBOX_ONLY?['mock_acquirer','mock_qr']:['mock_acquirer','mock_qr','yookassa']))).limit(1000)).filter(p=>p.status==='active'&&['mock_acquirer','mock_qr','yookassa'].includes(p.adapterKey)&&(!loadConfig().NATIO_SANDBOX_ONLY||p.adapterKey.startsWith('mock_'))).map(p=>({id:p.id,name:p.name,adapter:p.adapterKey,methods:p.supportedMethods,currencies:p.supportedCurrencies,countries:p.supportedCountries}))}));
 app.post('/admin/integrations/connections',{preHandler:requireAdmin('providers.manage')},async(req,reply)=>{
  const body=parse(z.object({provider_id:id,name:z.string().trim().min(2).max(80),currency:z.string().regex(/^[A-Z]{3}$/),method:z.string().min(1).max(40),credentials:z.record(z.string().max(500)).default({}),confirmed:z.literal(true)}).strict(),req.body);
  const [provider]=await db.select().from(providers).where(eq(providers.id,body.provider_id)).limit(1);
  if(!provider||provider.status!=='active'||!['mock_acquirer','mock_qr','yookassa'].includes(provider.adapterKey))throw Errors.validation('Choose an implemented connector');
  if(!provider.supportedMethods.includes(body.method))throw Errors.validation('Payment method is not supported by this connector');
  if(provider.supportedCurrencies.length&&!provider.supportedCurrencies.includes(body.currency))throw Errors.validation('Currency is not supported by this connector');
  if(provider.adapterKey.startsWith('mock_')&&req.dashboardMode!=='test')throw Errors.forbidden('Simulated connectors are Test only');
  if(provider.adapterKey==='yookassa'&&(!body.credentials.shop_id||!body.credentials.secret_key))throw Errors.validation('Enter the shop ID and secret key issued by your PSP for this environment');
  // A newly supplied secret must never silently start taking real traffic.
  const account=await createProviderAccount(db,{providerId:provider.id,mode:req.dashboardMode,name:body.name,currencies:[body.currency],config:{paymentMethods:[body.method],method:body.method},credentials:provider.adapterKey.startsWith('mock_')?{}:body.credentials,status:'disabled'},actorFromRequest(req));
  return reply.status(201).send(serializeAccount(account,provider));
 });
}

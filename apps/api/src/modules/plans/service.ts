import { getPool } from '../../db/client.js';
import { ApiError } from '../../lib/errors.js';
export const planCodes=['light','optimal','premium'] as const;
export type Plan=typeof planCodes[number];
export const planFeatures={
 light:['dashboards','financial_read','shared_roadmap'],
 optimal:['dashboards','financial_read','shared_roadmap','advanced_reports','recommendations'],
 premium:['dashboards','financial_read','shared_roadmap','advanced_reports','recommendations','development','integrations','operations'],
} as const;
export async function merchantPlan(id:string):Promise<Plan>{return (await getPool().query('SELECT plan FROM merchant_plans WHERE merchant_id=$1',[id])).rows[0]?.plan||'premium'}
export async function requirePlan(id:string,feature:string){const plan=await merchantPlan(id);if(!(planFeatures[plan] as readonly string[]).includes(feature))throw new ApiError(403,'permission_error','upgrade_required',`Your ${plan} plan does not include ${feature}. Request an upgrade in Plans.`,{details:{plan,feature}})}
export function featureForPermission(permission?:string,method='GET',url=''){
 if(/\/(api-keys|webhooks|projects|developers)(?:[/?]|$)/.test(url))return 'integrations';
 if(!['GET','HEAD','OPTIONS'].includes(method))return 'operations';
 if(permission?.endsWith('.manage')||permission?.endsWith('.update')||permission?.endsWith('.write')||permission?.endsWith('.create'))return 'operations';
 if(/\/analytics\/(overview|timeseries|providers)(?:[/?]|$)/.test(url))return 'dashboards';
 if(/\/(analytics|reconciliation|settlements)(?:[/?]|$)/.test(url))return 'advanced_reports';
 return 'financial_read';
}

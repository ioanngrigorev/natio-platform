import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { merchants } from '../../db/schema/index.js';
import { Errors } from '../../lib/errors.js';
import {loadConfig} from '../../config.js';
/** Recheck at money-movement entry, not just when issuing a key: KYB can later change. */
export async function requireProcessingEligibility(db:DbOrTx,merchantId:string,mode:'test'|'live'){
 if(loadConfig().NATIO_SANDBOX_ONLY&&mode==='live')throw Errors.forbidden('Live money movement is disabled in this demo environment');
 const [merchant]=await db.select({status:merchants.status,kyb:merchants.kybStatus}).from(merchants).where(eq(merchants.id,merchantId)).limit(1);
 if(!merchant||merchant.status!=='active')throw Errors.forbidden('Merchant account is disabled');
 if(mode==='live'&&merchant.kyb!=='approved')throw Errors.forbidden('Live processing requires approved KYB. Test data remains available.');
}

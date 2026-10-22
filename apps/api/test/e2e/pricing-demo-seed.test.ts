import './env.js';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {eq,isNull,sql} from 'drizzle-orm';
import {startTestEnv,stopTestEnv,type TestEnv} from './setup.js';
import {getDb} from '../../src/db/client.js';
import {providerAccounts,payments,transactions,providers} from '../../src/db/schema/index.js';
import {seedPricingDemo} from '../../src/modules/pricing/seed.js';
let env:TestEnv;
beforeAll(async()=>{env=await startTestEnv();});
afterAll(async()=>{await stopTestEnv(env);});
it('supplies shared test routes for a merchant-owned mock catalog without creating financial records',async()=>{
 const db=getDb();
 await db.update(providerAccounts).set({merchantId:env.seed.merchantId});
 const original=await db.select({id:providerAccounts.id}).from(providerAccounts);
 const providerCount=(await db.select({n:sql<number>`count(*)`.mapWith(Number)}).from(providers))[0]!.n;
 const result=await seedPricingDemo(db);
 expect(result.accountsCreated).toBeGreaterThanOrEqual(2);
 expect(result.rulesCreated).toBe(6);
 const shared=await db.select().from(providerAccounts).where(isNull(providerAccounts.merchantId));
 expect(shared).toHaveLength(result.accountsCreated);
 expect(shared.every(a=>a.mode==='test'&&a.credentialsEnc===null&&a.currencies.includes('EUR'))).toBe(true);
 for(const a of original){expect((await db.select().from(providerAccounts).where(eq(providerAccounts.id,a.id)))[0]!.merchantId).toBe(env.seed.merchantId);}
 expect((await db.select({n:sql<number>`count(*)`.mapWith(Number)}).from(providers))[0]!.n).toBe(providerCount);
 expect(await db.select().from(payments)).toEqual([]);
 expect(await db.select().from(transactions)).toEqual([]);
 expect(await seedPricingDemo(db)).toMatchObject({tariffsCreated:0,rulesCreated:0,accountsCreated:0,financialRecordsCreated:0});
});

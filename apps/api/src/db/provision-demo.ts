/** Operator-only, one-time provisioning. Never run against the production DB.
 * The output is a 0600 file on a private host volume; secrets never enter logs.
 * Reruns refuse to rotate passwords or reset a tester's work silently.
 */
import {randomBytes} from 'node:crypto';
import {writeFile, unlink} from 'node:fs/promises';
import {eq} from 'drizzle-orm';
import {loadConfig} from '../config.js';
import {getDb, closeDb} from './client.js';
import {adminUsers, merchantUsers, merchants} from './schema/index.js';
import {runSeed} from './seed.js';
import {hashPassword} from '../lib/crypto.js';
import {newId} from '../lib/ids.js';
import {seedDevelopmentDemo, backfillDemoPhases, refineDemoSchedules} from '../modules/development/demo.js';

async function main() {
  const cfg=loadConfig();
  if (!cfg.NATIO_SANDBOX_ONLY || new URL(cfg.DATABASE_URL).pathname !== '/natio_demo') {
    throw new Error('Provisioning requires NATIO_SANDBOX_ONLY and the dedicated natio_demo database');
  }
  if (cfg.SEED_DEMO_PASSWORD.length < 24) throw new Error('Set a generated seed password with at least 24 characters');
  const db=getDb();
  const file='/run/natio-demo/access.json';
  const base=cfg.PUBLIC_WEB_URL.replace(/\/$/,'');
  const accounts=[
    {role:'superadmin', name:'Demo Superadmin'},
    {role:'administrator', name:'Demo Administrator'},
    {role:'technical', name:'Demo Technical Manager'},
    {role:'finance', name:'Demo Financial Manager'},
    {role:'readonly', name:'Demo Investor'},
    {role:'merchant', name:'Demo Merchant'},
  ].map(a=>({...a,email:`${a.role}@demo.natio.me`,password:randomBytes(24).toString('base64url'),url:base+(a.role==='merchant'?'/dashboard/login':'/admin/login')}));
  // Reserve the filename before changing identities. Existing credentials stay valid.
  await writeFile(file,JSON.stringify({environment:base,notice:'Synthetic sandbox only. Keep this file private.',accounts},null,2),{flag:'wx',mode:0o600});
  try {
    const seed=await runSeed();
    const demoMerchant=(await db.select().from(merchants).where(eq(merchants.id,'mer_d25_001')).limit(1))[0];
    const hashes=await Promise.all(accounts.map(a=>hashPassword(a.password)));
    await db.transaction(async tx=>{
      // Seed illustrations are not public logins. Only the issued accounts can log in.
      await tx.update(adminUsers).set({status:'disabled'});
      await tx.update(merchantUsers).set({status:'disabled'});
      for(const [i,a] of accounts.entries()){
        const common={email:a.email,name:a.name,passwordHash:hashes[i]!,status:'active' as const};
        if(a.role==='merchant') await tx.insert(merchantUsers).values({...common,id:newId('merchantUser'),merchantId:demoMerchant?.id??seed.merchantId,role:'owner'});
        else await tx.insert(adminUsers).values({...common,id:newId('adminUser'),role:a.role as 'superadmin'|'administrator'|'technical'|'finance'|'readonly'});
      }
    });
  } catch(error) { await unlink(file); throw error; }
  await seedDevelopmentDemo();
  await backfillDemoPhases();
  await refineDemoSchedules();
  console.info('Provisioned six isolated demo accounts. Credentials saved to the private access.json file.');
}
main().then(()=>closeDb()).catch(async()=>{console.error('Demo provisioning failed. Review configuration and database state; no credentials were logged.');await closeDb();process.exitCode=1;});

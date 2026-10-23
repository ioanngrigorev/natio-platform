import './env.js';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {startTestEnv,stopTestEnv,type TestEnv} from './setup.js';
import {getPool} from '../../src/db/client.js';
import {seedDevelopmentDemo,refineDemoSchedules} from '../../src/modules/development/demo.js';
import {developmentData,hasCycle} from '../../src/modules/development/model.js';
let env:TestEnv;
beforeAll(async()=>{env=await startTestEnv();await seedDevelopmentDemo()},120000);
afterAll(async()=>stopTestEnv(env));
it('keeps a multiweek synthetic calendar within 2025 and has finish-to-start-safe dependencies',async()=>{
 const before=(await getPool().query('SELECT count(*) n FROM transactions')).rows[0].n;
 expect((await refineDemoSchedules()).synthetic_schedules_refined).toBe(33);
 const rows=(await getPool().query("SELECT * FROM development_items WHERE is_demo AND NOT (data->>'milestone')::boolean")).rows;
 const byId=new Map(rows.map(r=>[r.id,r]));
 for(const row of rows){const d=developmentData.parse(row.data),days=(Date.parse(d.plan_end!)-Date.parse(d.plan_start!))/86400000+1;expect([28,35,42]).toContain(days);expect(d.plan_start!>='2025-01-01'&&d.plan_end!<='2025-12-31').toBe(true);expect(d.phases).toHaveLength(5);expect((Date.parse(d.phases[0].end)-Date.parse(d.phases[0].start))/86400000+1).toBeGreaterThanOrEqual(5);expect((Date.parse(d.phases[1].end)-Date.parse(d.phases[1].start))/86400000+1).toBeGreaterThanOrEqual(14);for(const id of d.dependencies)expect(byId.get(id).completed_at.toISOString().slice(0,10)<d.plan_start!).toBe(true);}
 expect((await refineDemoSchedules()).synthetic_schedules_refined).toBe(0);
 expect((await getPool().query('SELECT count(*) n FROM transactions')).rows[0].n).toBe(before);
});

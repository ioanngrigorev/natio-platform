import {describe,it,expect} from 'vitest';
import {developmentData,scheduleTemplate} from '../../src/modules/development/model.js';
import {DAY,timelineWindow,timelineTicks,intervalPosition} from '../../../web/lib/development-timeline.js';
const spec={objective:'Test',users:'',scope:'',acceptance:'',technical:'',risks:'',questions:''};
describe('lifecycle schedule integrity',()=>{
 it('creates bounded phases with distinct ownership and supports one-day work',()=>{for(const end of ['2025-01-01','2025-01-07','2025-02-28']){const phases=scheduleTemplate({start:'2025-01-01',end,analyst:'Analyst',assignee:'Dev',qa_owner:'QA',devops:'Ops'});expect(phases).toHaveLength(5);expect(phases[0].owner).toBe('Analyst');expect(phases[2].owner).toBe('QA');expect(developmentData.parse({spec,plan_start:'2025-01-01',plan_end:end,phases}).phases).toHaveLength(5)}});
 it('rejects out of range dates, duplicate IDs, invalid progress and phases on milestones',()=>{const phases=scheduleTemplate({start:'2025-01-01',end:'2025-01-07',analyst:'',assignee:'',qa_owner:'',devops:''}),base={spec,plan_start:'2025-01-01',plan_end:'2025-01-07',phases};for(const data of [{...base,plan_end:'2025-01-05'},{...base,phases:[phases[0],phases[0]]},{...base,phases:[{...phases[0],progress:101}]},{...base,plan_end:'2025-01-01',milestone:true}])expect(developmentData.safeParse(data).success).toBe(false)});
 it('preserves older items without a phase schedule',()=>expect(developmentData.parse({spec}).phases).toEqual([]));
});
describe('Gantt calendar geometry',()=>{
 it('uses full months including leap days and year rollover',()=>{const w=timelineWindow('2024-02-15','month','','');expect((w.end-w.start)/DAY).toBe(29);expect(new Date(timelineWindow('2025-12-01','quarter','','').end).toISOString().slice(0,10)).toBe('2026-01-01')});
 it('renders same-day tasks with a day width and clips dates without stretching them',()=>{const w=timelineWindow('2025-01-01','month','','');expect(intervalPosition('2025-01-01','2025-01-01',w)?.width).toBeCloseTo(100/31);expect(intervalPosition('2024-12-20','2025-01-02',w)).toMatchObject({left:0,clippedStart:true});expect(intervalPosition('2025-02-01','2025-02-05',w)).toBeNull()});
 it('uses weekly ticks and includes the final day in fit view',()=>{const w=timelineWindow('2025-01-01','all','2025-01-01','2025-01-01');expect(w.end-w.start).toBe(DAY);const m=timelineWindow('2025-01-01','month','','');const ticks=timelineTicks(m,'month');expect(ticks.at(-1)).toBe(m.end);for(const t of ticks.slice(1,-1))expect(new Date(t).getUTCDay()).toBe(1)});
});

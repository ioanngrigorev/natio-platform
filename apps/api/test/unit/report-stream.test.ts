import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { tabularReport } from "../../src/modules/analytics/reports.js";
import { biQuery } from "../../src/modules/analytics/bi.js";
const mock=vi.hoisted(()=>({fetches:0,fail:false,query:vi.fn(),release:vi.fn()}));
vi.mock("../../src/db/client.js",()=>({getPool:()=>({connect:async()=>({query:mock.query,release:mock.release})})}));
beforeEach(()=>{mock.fetches=0;mock.fail=false;mock.release.mockClear();mock.query.mockReset();mock.query.mockImplementation(async(sql:string)=>{
 if(sql.startsWith('FETCH')){if(mock.fail)throw new Error('Database read failed');return mock.fetches++===0?{rowCount:2,rows:[{id:'tx1',merchant:'Demo',account:'Klarna EUR',currency:'EUR',amount:12345,fees:45,net:12300,method:'Klarna',occurred_at:'2025-06-01T12:00:00Z'},{id:'tx2',merchant:'=SUM(A1)',currency:'JPY',amount:-12345,fees:0,net:-12345,method:'Swish',occurred_at:'2025-07-01T12:00:00Z'}]}:{rowCount:0,rows:[]};}
 return {rows:[]};
});});

describe('Complete report streams',()=>{
 for(const format of ['xlsx','csv'] as const)it(`exports all rows as ${format} despite preview pagination`,async()=>{
  const {stream,completed}=tabularReport(biQuery.parse({kind:'transactions',all_currencies:'1',page:3,limit:1}),'test',format);
  const chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));await completed;
  const bytes=Buffer.concat(chunks);
  if(format==='xlsx'){
   const book=new ExcelJS.Workbook();await book.xlsx.load(bytes as never);const sheet=book.getWorksheet('transactions 1')!;
   expect(sheet.rowCount).toBe(3);expect(sheet.getCell('J2').value).toBe(123.45);expect(sheet.getCell('J3').value).toBe(-12345);expect(sheet.getCell('G2').value).toMatch(/^NATIO /);expect(sheet.getCell('B3').value).toBe('=SUM(A1)');
   expect(sheet.views[0]).toMatchObject({state:'frozen',ySplit:1});
  }else {const csv=bytes.toString();expect(csv).not.toContain('Klarna');expect(csv).toContain('"\'=SUM(A1)"');expect(csv).toContain(',123.45,0.45,123,');expect(csv.split('\r\n').filter(Boolean)).toHaveLength(3);}
  const sql=mock.query.mock.calls.find(c=>c[0].startsWith('DECLARE'))![0];expect(sql).not.toContain('LIMIT');expect(sql).not.toContain('OFFSET');expect(mock.release).toHaveBeenCalledOnce();
 });
 it('fails a download on a database error and releases its connection',async()=>{
  mock.fail=true;const {stream,completed}=tabularReport(biQuery.parse({kind:'transactions'}),'test','csv');
  const result=completed.catch(e=>e.message);await expect((async()=>{for await(const chunk of stream){void chunk;}})()).rejects.toThrow('Database read failed');expect(await result).toBe('Database read failed');expect(mock.release).toHaveBeenCalledOnce();expect(mock.query).toHaveBeenCalledWith('ROLLBACK');
 });
});

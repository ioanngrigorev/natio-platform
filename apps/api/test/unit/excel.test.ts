import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { excelReport } from "../../src/modules/analytics/excel.js";
import { biQuery } from "../../src/modules/analytics/bi.js";

const sample={transactions:1,successful:1,failed:0,pending:0,volume:12345,fees:345,payouts:0,ledger_net:12000,settled:10000};
vi.mock("../../src/modules/analytics/bi.js", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/modules/analytics/bi.js")>(),
  businessIntelligence: async () => ({summary:sample,daily:[{...sample,day:"2025-06-01"}],methods:[],countries:[],merchants:[],balances:[{...sample,currency:"EUR"}]}),
}));

describe("Excel report download",()=>{
  it("finishes a valid streaming XLSX with frozen headers and numeric amounts",async()=>{
    const {stream,completed}=excelReport(biQuery.parse({}),"test");
    const chunks:Buffer[]=[];
    for await(const chunk of stream) chunks.push(Buffer.from(chunk));
    await completed;
    const workbook=new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.concat(chunks) as never);
    expect(workbook.worksheets).toHaveLength(7);
    const summary=workbook.getWorksheet("Summary")!;
    expect(summary.views[0]).toMatchObject({state:"frozen",ySplit:1});
    expect(summary.getCell("G2").value).toBe(123.45);
    expect(summary.getCell("H2").value).toBe(3.45);
    expect(summary.getCell("L2").value).toBe(20);
    expect(workbook.getWorksheet("Daily")!.getCell("A2").value).toBe("2025-06-01");
  });
});

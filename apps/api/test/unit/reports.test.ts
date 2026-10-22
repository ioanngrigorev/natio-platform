import { describe, it, expect } from "vitest";
import { biQuery, biWhere } from "../../src/modules/analytics/bi.js";
import { reportPlan, reportRow, csvCell } from "../../src/modules/analytics/reports.js";
import { demoDisplay, demoLabel, storedMethod } from "../../src/modules/demo/display.js";

describe("Report center",()=>{
  it("binds every filter and resolves synthetic method labels",()=>{
    const q=biQuery.parse({country:"SE",status:"successful",type:"payment",provider_account_id:"account'--",method:demoLabel("Klarna")});
    const p=reportPlan(q,"test");
    expect(p.values).toContain("account'--");expect(p.sql).not.toContain("account'--");expect(p.values).toContain("Klarna");
    expect(p.sql).toContain("t.country=$");expect(p.sql).toContain("t.status=$");expect(p.sql).toContain("t.type=$");
    expect(storedMethod(demoLabel("Klarna"))).toBe("Klarna");
  });
  it("keeps currencies separate for every aggregate template",()=>{
    for(const kind of ["summary","daily","merchants","providers","methods","countries","balances"]){
      const q=biQuery.parse({kind,all_currencies:"1"});const p=reportPlan(q,"test");
      expect(p.columns.some(c=>c.key==="currency")).toBe(true);expect(p.sql).toContain("t.currency");expect(p.sql).toContain("GROUP BY");
      expect(p.sql).not.toContain("LIMIT");expect(p.values).not.toContain("EUR");
      expect(p.sql).toContain("t.status='successful'");
    }
  });
  it("exports exact zero-, two- and three-decimal units without renaming IDs",()=>{
    const cols=reportPlan(biQuery.parse({kind:"transactions"}),"test").columns;
    for(const [currency,divisor] of [["JPY",1],["EUR",100],["KWD",1000]] as const){
      const r=reportRow({currency,amount:123456,fees:123,net:123333,method:"Klarna",id:"Klarna"},cols,"test");
      expect(r.amount).toBe(123456/divisor);expect(r.fees).toBe(123/divisor);expect(r.id).toBe("Klarna");expect(r.method).toMatch(/^NATIO /);
    }
    expect(reportRow({currency:"EUR",amount:100,method:"Klarna"},cols,"live").method).toBe("Klarna");
  });
  it("neutralizes spreadsheet formulas but keeps numbers numeric",()=>{
    expect(csvCell(-123.4)).toBe("-123.4");expect(csvCell('=SUM(A1)')).toBe('"\'=SUM(A1)"');expect(csvCell(' +1')).toBe('"\' +1"');
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');expect(csvCell(null)).toBe('""');
  });
  it("rejects arbitrary sorting, invalid pages and malformed filters",()=>{
    for(const q of [{sort:"amount;DROP TABLE transactions"},{page:0},{limit:10001},{status:"anything"},{country:"Sw"}])expect(biQuery.safeParse(q).success).toBe(false);
    expect(reportPlan(biQuery.parse({kind:"transactions",sort:"label"}),"test").order).toMatch(/^"occurred_at"/);
  });
  it("masks display fields recursively, preserving financial history and secrets",()=>{
    const source={id:"Klarna",amount:150,name:"Klarna EUR SE",config:{method:"Swish"},options:{methods:["Klarna"]},password:"Klarna",description:"Demo order · Klarna"};
    const r=demoDisplay(source);expect(r.name).not.toContain("Klarna");expect(r.config.method).not.toContain("Swish");expect(r.options.methods[0]).toMatch(/^NATIO /);expect(r.amount).toBe(150);expect(r.id).toBe("Klarna");expect(r.password).toBe("Klarna");expect(source.name).toBe("Klarna EUR SE");
  });
});

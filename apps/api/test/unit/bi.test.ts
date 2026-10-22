import { describe, expect, it } from "vitest";
import { biQuery, biWhere } from "../../src/modules/analytics/bi.js";
import { moneyDivisor } from "../../src/modules/analytics/excel.js";

describe("BI report boundaries", () => {
  it("uses the complete 2025 demo period and rejects invalid/reversed dates", () => {
    expect(biQuery.parse({}).from).toBe("2025-01-01");
    expect(biQuery.parse({}).to).toBe("2025-12-31");
    for (const q of [{from:"2025-02-30"},{from:"2025-12-31",to:"2025-01-01"},{currency:"EUR; DROP TABLE payments"}]) expect(biQuery.safeParse(q).success).toBe(false);
  });
  it("binds user filters and keeps mode and inclusive end-date bounds", () => {
    const q=biQuery.parse({merchant_id:"merchant' OR true--",method:"Wallet'--"});
    const f=biWhere(q,"test");
    expect(f.where).not.toContain(q.merchant_id);
    expect(f.where).not.toContain(q.method);
    expect(f.values).toEqual(["test","2025-01-01","2025-12-31","EUR",q.merchant_id,q.method]);
    expect(f.where).toContain("< $3::date + interval '1 day'");
    expect(biWhere(q,"live",false).values).toEqual(["live","2025-01-01","2025-12-31",q.merchant_id,q.method]);
  });
  it("exports zero-, two- and three-decimal currencies in major units", () => {
    expect(moneyDivisor("VND")).toBe(1);
    expect(moneyDivisor("JPY")).toBe(1);
    expect(moneyDivisor("EUR")).toBe(100);
    expect(moneyDivisor("KWD")).toBe(1000);
  });
});

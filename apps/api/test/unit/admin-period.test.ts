import { describe, expect, it } from "vitest";
import { adminPeriod } from "../../../web/lib/admin-period.js";

describe("admin reporting periods", () => {
  const now = new Date("2026-10-23T00:00:00Z");
  it("anchors 7-day demo shortcuts to the most recent day in the historical data", () => {
    expect(adminPeriod("test", "7", now, "2025-12-30T14:00:00Z")).toMatchObject({ from: "2025-12-24T00:00:00.000Z", to: "2025-12-30T23:59:59.999Z" });
  });
  it("uses one complete historical day for the 1d shortcut", () => {
    expect(adminPeriod("test", "1", now, "2025-12-30T14:00:00Z")).toMatchObject({ from: "2025-12-30T00:00:00.000Z", to: "2025-12-30T23:59:59.999Z" });
  });
  it("keeps live windows current and the full demo year available", () => {
    expect(adminPeriod("live", "7", now)).toMatchObject({ from: "2026-10-16T00:00:00.000Z", to: now.toISOString() });
    expect(adminPeriod("test", "2025", now)).toMatchObject({ from: "2025-01-01T00:00:00.000Z", to: "2025-12-31T23:59:59.999Z" });
  });
  it("rejects unsupported shortcuts and falls back safely for an empty demo", () => {
    expect(adminPeriod("test", "-10", now).days).toBe("2025");
    expect(adminPeriod("test", "7", now).from).toBe("2025-12-25T00:00:00.000Z");
    expect(adminPeriod("live", "Infinity", now).days).toBe("1");
  });
});

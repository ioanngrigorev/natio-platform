import { describe, expect, it } from "vitest";
import { adjustVolumeWindow, dailyVolume, groupVolume, volumeDomain, volumeWindow } from "../../../web/lib/volume-series.js";

function report(from: string, to: string, amounts: Array<[string, number]>) {
  return { period: { from, to }, daily: amounts.map(([day, volume]) => ({ day, volume, transactions: 2, successful: 1, failed: 1, pending: 0, fees: 0, payouts: 0, ledger_net: 0, settled: 0 })) };
}

describe("payment volume chart accounting", () => {
  it("fills calendar gaps with zeros and averages calendar days", () => {
    const days = dailyVolume(report("2025-01-01", "2025-01-04", [["2025-01-01", 600], ["2025-01-03", 300]]));
    expect(days.map(p => p.volume)).toEqual([600, 0, 300, 0]);
    expect(days.map(p => p.trend)).toEqual([600, 300, 300, 225]);
    expect(days.at(-1)?.trendDays).toBe(4);
  });
  it("uses only the last seven days and does not rewrite daily values", () => {
    const data = report("2025-01-01", "2025-01-08", [["2025-01-01", 700], ["2025-01-08", 1400]]);
    const before = JSON.stringify(data);
    const days = dailyVolume(data);
    expect(days[6].trend).toBe(100);
    expect(days[7].trend).toBe(200);
    expect(days[7].volume).toBe(1400);
    expect(JSON.stringify(data)).toBe(before);
    expect(groupVolume(days.slice(7), "day")[0].trend).toBe(200);
  });
  it("preserves amounts and counts in Monday-based weekly and monthly buckets", () => {
    const days = dailyVolume(report("2024-12-29", "2025-01-06", [["2024-12-29", 100], ["2024-12-30", 200], ["2025-01-01", 300], ["2025-01-06", 400]]));
    const weeks = groupVolume(days, "week");
    expect(weeks.map(p => [p.date, p.endDate, p.volume])).toEqual([
      ["2024-12-29", "2024-12-29", 100], ["2024-12-30", "2025-01-05", 500], ["2025-01-06", "2025-01-06", 400],
    ]);
    expect(groupVolume(days, "month").map(p => p.volume)).toEqual([300, 700]);
    for (const grain of ["day", "week", "month"] as const) {
      const result = groupVolume(days, grain);
      expect(result.reduce((sum, p) => sum + p.volume, 0)).toBe(1000);
      expect(result.reduce((sum, p) => sum + p.transactions, 0)).toBe(8);
    }
  });
  it("handles leap days, partial months and report boundaries in UTC", () => {
    const days = dailyVolume(report("2024-02-28", "2024-03-01", [["2024-02-27", 999], ["2024-02-29", 123], ["2024-03-01", 456]]));
    expect(days.map(p => p.date)).toEqual(["2024-02-28", "2024-02-29", "2024-03-01"]);
    expect(groupVolume(days, "month").map(p => p.volume)).toEqual([123, 456]);
  });
  it("keeps minor currency units intact, including zero-decimal currencies", () => {
    const days = dailyVolume(report("2025-01-01", "2025-01-02", [["2025-01-01", 101], ["2025-01-02", 102]]));
    expect(days[1].trend).toBe(101.5);
    expect(groupVolume(days, "month")[0].volume).toBe(203);
  });
  it("anchors zoom presets to the report, handles short ranges and empty data", () => {
    const days = dailyVolume(report("2025-01-01", "2025-12-31", [["2025-01-01", 1]]));
    expect(volumeWindow(days, 30)).toEqual({ startIndex: 335, endIndex: 364 });
    expect(days[335].date).toBe("2025-12-02");
    expect(volumeWindow(days, 90)).toEqual({ startIndex: 275, endIndex: 364 });
    expect(volumeWindow(days.slice(0, 1), 30)).toEqual({ startIndex: 0, endIndex: 0 });
    expect(dailyVolume(report("2025-01-01", "2025-12-31", []))).toEqual([]);
    expect(groupVolume([], "week")).toEqual([]);
  });
});


describe("chart value scale and navigation", () => {
  it("fits visible variation with padding and preserves zero and outlier values", () => {
    const [low, high] = volumeDomain([40000, 50000, 60000]);
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(40000);
    expect(high).toBeGreaterThan(60000);
    expect(volumeDomain([0, 50000])[0]).toBe(0);
    expect(volumeDomain([50000, 1000000])[1]).toBeGreaterThan(1000000);
    expect(volumeDomain([40000, 60000], true)[0]).toBe(0);
  });
  it("gives constant, tiny, empty and non-finite series a finite non-zero scale", () => {
    for (const values of [[], [0], [100], [0.01], [NaN, Infinity]]) {
      const [low, high] = volumeDomain(values);
      expect(Number.isFinite(low) && Number.isFinite(high)).toBe(true);
      expect(high).toBeGreaterThan(low);
    }
  });
  it("zooms around the center and pans without changing the selected count", () => {
    expect(adjustVolumeWindow(365, {startIndex:275,endIndex:364}, .5)).toEqual({startIndex:297,endIndex:341});
    expect(adjustVolumeWindow(365, {startIndex:275,endIndex:364}, 2)).toEqual({startIndex:185,endIndex:364});
    expect(adjustVolumeWindow(365, {startIndex:275,endIndex:364}, 1, -1)).toEqual({startIndex:230,endIndex:319});
    expect(adjustVolumeWindow(365, {startIndex:0,endIndex:89}, 1, -1)).toEqual({startIndex:0,endIndex:89});
  });
  it("clamps navigation at both boundaries and handles one or no dates", () => {
    expect(adjustVolumeWindow(7, {startIndex:4,endIndex:6}, .5)).toEqual({startIndex:4,endIndex:6});
    expect(adjustVolumeWindow(1, {startIndex:0,endIndex:0}, 2, 1)).toEqual({startIndex:0,endIndex:0});
    expect(adjustVolumeWindow(0, {startIndex:0,endIndex:0})).toEqual({startIndex:0,endIndex:0});
  });
});

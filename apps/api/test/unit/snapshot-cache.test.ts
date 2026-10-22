import { describe, expect, it, vi } from "vitest";
import { SnapshotCache } from "../../src/modules/analytics/snapshot-cache.js";

describe("analytics snapshots", () => {
  it("coalesces concurrent identical work and starts expiry after completion", async () => {
    let now = 0, finish!: (value: number) => void;
    const cache = new SnapshotCache(15, 2, () => now);
    const calculate = vi.fn(() => new Promise<number>(resolve => { finish = resolve; }));
    const a = cache.get("test:EUR", calculate), b = cache.get("test:EUR", calculate);
    await Promise.resolve(); now = 100; finish(42);
    expect(await a).toBe(42); expect(await b).toBe(42); expect(calculate).toHaveBeenCalledTimes(1);
    now = 114; expect(await cache.get("test:EUR", async () => 99)).toBe(42);
    now = 115; expect(await cache.get("test:EUR", async () => 99)).toBe(99);
  });
  it("isolates modes and filter keys", async () => {
    const cache = new SnapshotCache();
    await cache.get('["bi","test",{"currency":"EUR"}]', async () => 1);
    expect(await cache.get('["bi","live",{"currency":"EUR"}]', async () => 2)).toBe(2);
    expect(await cache.get('["bi","test",{"currency":"USD"}]', async () => 3)).toBe(3);
  });
  it("never caches rejected work", async () => {
    const cache = new SnapshotCache();
    await expect(cache.get("x", async () => { throw new Error("database unavailable"); })).rejects.toThrow("database unavailable");
    expect(await cache.get("x", async () => 10)).toBe(10);
  });
  it("evicts least recently used keys and keeps memory bounded", async () => {
    const cache = new SnapshotCache(1000, 2);
    await cache.get("a", async () => 1); await cache.get("b", async () => 2);
    expect(await cache.get("a", async () => 99)).toBe(1);
    await cache.get("c", async () => 3);
    expect(await cache.get("b", async () => 22)).toBe(22);
  });
  it("clear invalidates snapshots, including work started before a mutation", async () => {
    const cache = new SnapshotCache();
    let finish!: (value: number) => void;
    const pending = cache.get("a", () => new Promise<number>(resolve => { finish = resolve; }));
    await Promise.resolve(); cache.clear(); finish(1); await pending;
    expect(await cache.get("a", async () => 2)).toBe(2);
  });
});

/** Bounded process-local cache for authenticated, platform-wide read-only analytics.
 * Call only AFTER authorization. Never use for sessions, transactions or exports.
 */
export class SnapshotCache {
  private entries = new Map<string, { expires: number; promise: Promise<unknown> }>();
  constructor(private readonly ttlMs = 15_000, private readonly capacity = 64, private readonly now = Date.now) {}

  async get<T>(key: string, calculate: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing && existing.expires > this.now()) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing.promise as Promise<T>;
    }
    this.entries.delete(key);
    while (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!);
    // Infinity joins concurrent work; TTL starts when calculation completes.
    const entry = { expires: Infinity, promise: Promise.resolve().then(calculate) as Promise<unknown> };
    this.entries.set(key, entry);
    try {
      const result = await entry.promise as T;
      entry.expires = this.now() + this.ttlMs;
      return result;
    } catch (error) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    }
  }

  clear() { this.entries.clear(); }
}

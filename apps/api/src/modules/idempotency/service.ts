import { and, eq, lt } from "drizzle-orm";
import { loadConfig } from "../../config.js";
import type { Db } from "../../db/client.js";
import { idempotencyKeys } from "../../db/schema/index.js";
import { stableRequestHash } from "../../lib/crypto.js";
import { Errors } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";

export interface IdempotencyScope {
  merchantId: string;
  mode: "test" | "live";
  scope: string; // e.g. "payments.create"
}

export interface StoredResponse {
  status: number;
  body: unknown;
}

const LOCK_STALE_MS = 60_000;

/**
 * Idempotent execution of a mutating request.
 *
 * - First request with a key: a lock row is inserted (UNIQUE), the handler runs and the response is stored.
 * - Same key + same payload: the stored response is replayed (never re-executed).
 * - Same key + different payload: 422 idempotency_key_reused.
 * - Same key while the first request is still running: 409 idempotency_in_progress.
 */
export async function withIdempotency<T extends StoredResponse>(
  db: Db,
  scope: IdempotencyScope,
  key: string | undefined,
  body: unknown,
  handler: () => Promise<T>,
): Promise<T & { replayed: boolean }> {
  if (!key) {
    const result = await handler();
    return { ...result, replayed: false };
  }
  if (key.length > 255) throw Errors.badRequest("invalid_idempotency_key", "Idempotency-Key must be at most 255 characters");

  const cfg = loadConfig();
  const requestHash = stableRequestHash(body);
  const now = new Date();

  const inserted = await db
    .insert(idempotencyKeys)
    .values({
      id: newId("idempotency"),
      merchantId: scope.merchantId,
      mode: scope.mode,
      scope: scope.scope,
      key,
      requestHash,
      lockedAt: now,
      expiresAt: new Date(now.getTime() + cfg.IDEMPOTENCY_TTL_HOURS * 3600 * 1000),
    })
    .onConflictDoNothing()
    .returning({ id: idempotencyKeys.id });

  if (inserted.length === 0) {
    const [existing] = await db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.merchantId, scope.merchantId),
          eq(idempotencyKeys.mode, scope.mode),
          eq(idempotencyKeys.scope, scope.scope),
          eq(idempotencyKeys.key, key),
        ),
      )
      .limit(1);
    if (!existing) throw Errors.idempotencyInProgress();
    if (existing.requestHash !== requestHash) throw Errors.idempotencyMismatch();
    if (existing.responseStatus == null) {
      // Lock held by a concurrent request. If it is stale (crashed process), let the caller retry later.
      const lockedAt = existing.lockedAt?.getTime() ?? 0;
      if (Date.now() - lockedAt > LOCK_STALE_MS) {
        await db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, existing.id));
      }
      throw Errors.idempotencyInProgress();
    }
    return { status: existing.responseStatus, body: existing.responseBody, replayed: true } as T & { replayed: boolean };
  }

  const rowId = inserted[0]!.id;
  try {
    const result = await handler();
    await db
      .update(idempotencyKeys)
      .set({ responseStatus: result.status, responseBody: result.body as never, entityId: extractId(result.body) })
      .where(eq(idempotencyKeys.id, rowId));
    return { ...result, replayed: false };
  } catch (err) {
    // Release the lock so the client can retry after fixing the request.
    await db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, rowId));
    throw err;
  }
}

function extractId(body: unknown): string | null {
  if (body && typeof body === "object" && "id" in body && typeof (body as { id: unknown }).id === "string") {
    return (body as { id: string }).id;
  }
  return null;
}

export async function purgeExpiredIdempotencyKeys(db: Db): Promise<number> {
  const deleted = await db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, new Date())).returning({ id: idempotencyKeys.id });
  return deleted.length;
}

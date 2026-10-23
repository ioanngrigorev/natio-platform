import { and, eq, isNotNull, lt } from "drizzle-orm";
import { loadConfig } from "../../config.js";
import type { Db } from "../../db/client.js";
import { idempotencyKeys } from "../../db/schema/index.js";
import { stableRequestHash } from "../../lib/crypto.js";
import { ApiError, Errors } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
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
 * - Concurrent requests: 409. An abandoned lock requires reconciliation, never a new charge.
 * - Deterministic 4xx errors are replayed; unknown failures keep the reservation.
 *
 * A timeout is not proof of rollback: the PSP or our transaction may already have
 * committed. Deleting the lock on an exception would turn a retry into a second payment.
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
      // Age only changes the diagnostic. It is NEVER authority to repeat a monetary side effect.
      const lockedAt = existing.lockedAt?.getTime() ?? 0;
      if (Date.now() - lockedAt > LOCK_STALE_MS) {
        throw new ApiError(409, "idempotency_error", "idempotency_recovery_required", "The outcome of this request needs reconciliation. Check the operation status or contact support; do not submit it with a new key.");
      }
      throw Errors.idempotencyInProgress();
    }
    const storedError = (existing.responseBody as ReturnType<ApiError["toJSON"]> | null)?.error;
    if (existing.responseStatus >= 400 && storedError) {
      // Re-throw so the HTTP boundary attaches this request's correlation id.
      throw new ApiError(existing.responseStatus, storedError.type, storedError.code, storedError.message, storedError);
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
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      await db.update(idempotencyKeys)
        .set({ responseStatus: err.status, responseBody: err.toJSON() })
        .where(eq(idempotencyKeys.id, rowId));
    } else {
      // Log the reservation id, never the raw key, request payload or PSP credentials.
      logger.error({ reservationId: rowId, scope: scope.scope }, "idempotent operation requires reconciliation");
    }
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
  // Retention expiry only permits recycling completed requests. Unknown outcomes remain protected.
  const deleted = await db.delete(idempotencyKeys).where(and(lt(idempotencyKeys.expiresAt, new Date()), isNotNull(idempotencyKeys.responseStatus))).returning({ id: idempotencyKeys.id });
  return deleted.length;
}

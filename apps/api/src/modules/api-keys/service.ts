import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client.js";
import { apiKeys, merchants, projects } from "../../db/schema/index.js";
import { API_KEY_PATTERN, generateApiKey, sha256Hex } from "../../lib/crypto.js";
import { Errors } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { recordAudit, type Actor } from "../audit/service.js";
import {loadConfig} from '../../config.js';
import {logger} from '../../lib/logger.js';
import {getPool} from '../../db/client.js';

export interface ApiKeyPrincipal {
  apiKey: typeof apiKeys.$inferSelect;
  merchant: typeof merchants.$inferSelect;
  project: typeof projects.$inferSelect;
  mode: "test" | "live";
}

export function publicApiKey(k: typeof apiKeys.$inferSelect) {
  return {
    id: k.id,
    name: k.name,
    mode: k.mode,
    integration_type: k.integrationType,
    prefix: k.prefix,
    project_id: k.projectId,
    last_used_at: k.lastUsedAt,
    revoked_at: k.revokedAt,
    created_at: k.createdAt,
  };
}

export async function createApiKey(
  db: Db,
  input: { merchantId: string; projectId: string; mode: "test" | "live"; name: string; actor: Actor; integrationType?: 'api'|'redirect' },
): Promise<{ key: typeof apiKeys.$inferSelect; secret: string }> {
  if (loadConfig().NATIO_SANDBOX_ONLY && input.mode === 'live') throw Errors.forbidden('Live keys are disabled in the demo environment');
  const profile=(await getPool().query('SELECT allowed_types FROM merchant_integration_profiles WHERE merchant_id=$1 AND mode=$2',[input.merchantId,input.mode])).rows[0];
  if(profile&&!profile.allowed_types.includes(input.integrationType??'api')) throw Errors.forbidden('This integration type is not enabled for this merchant');
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, input.projectId), eq(projects.merchantId, input.merchantId)))
    .limit(1);
  if (!project) throw Errors.notFound("Project", input.projectId);
  if (input.mode === "live") {
    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, input.merchantId)).limit(1);
    if (merchant?.kybStatus !== "approved") {
      throw Errors.forbidden("Live API keys can be issued only after KYB approval. Use test keys in the meantime.");
    }
  }
  const generated = generateApiKey(input.mode);
  const [key] = await db
    .insert(apiKeys)
    .values({
      id: newId("apiKey"),
      merchantId: input.merchantId,
      projectId: input.projectId,
      mode: input.mode,
      integrationType: input.integrationType??'api',
      name: input.name.trim(),
      prefix: generated.prefix,
      keyHash: generated.hash,
      createdBy: input.actor.id ?? null,
    })
    .returning();
  await recordAudit(db, {
    actor: input.actor,
    merchantId: input.merchantId,
    action: "api_key.created",
    entityType: "api_key",
    entityId: key!.id,
    after: { name: key!.name, mode: key!.mode, prefix: key!.prefix, project_id: key!.projectId },
  });
  return { key: key!, secret: generated.secret };
}

export async function revokeApiKey(db: Db, input: { merchantId: string; keyId: string; actor: Actor }) {
  const [key] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, input.keyId), eq(apiKeys.merchantId, input.merchantId)))
    .limit(1);
  if (!key) throw Errors.notFound("API key", input.keyId);
  if (key.revokedAt) return key;
  const [updated] = await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, key.id)).returning();
  await recordAudit(db, {
    actor: input.actor,
    merchantId: input.merchantId,
    action: "api_key.revoked",
    entityType: "api_key",
    entityId: key.id,
    before: { prefix: key.prefix, mode: key.mode },
  });
  return updated!;
}

export async function listApiKeys(db: DbOrTx, merchantId: string) {
  return db.select().from(apiKeys).where(eq(apiKeys.merchantId, merchantId)).orderBy(desc(apiKeys.createdAt));
}

/** Resolve a bearer secret to a principal. Returns null on any failure (no enumeration). */
export async function authenticateApiKey(db: DbOrTx, secret: string): Promise<ApiKeyPrincipal | null> {
  if (!API_KEY_PATTERN.test(secret)) return null;
  const hash = sha256Hex(secret);
  const [row] = await db
    .select({ apiKey: apiKeys, merchant: merchants, project: projects })
    .from(apiKeys)
    .innerJoin(merchants, eq(merchants.id, apiKeys.merchantId))
    .innerJoin(projects, eq(projects.id, apiKeys.projectId))
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  if (row.merchant.status !== "active" || row.project.status !== "active") return null;
  // Best-effort last_used tracking (throttled to once per minute to avoid write amplification).
  const last = row.apiKey.lastUsedAt?.getTime() ?? 0;
  if (Date.now() - last > 60_000) {
    // Drizzle queries are lazy: execute the write and handle a best-effort
    // tracking failure without turning valid authentication into an outage.
    void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.apiKey.id)).then(()=>undefined).catch(()=>logger.warn({keyId:row.apiKey.id},'API key usage timestamp could not be updated'));
  }
  return { apiKey: row.apiKey, merchant: row.merchant, project: row.project, mode: row.apiKey.mode };
}

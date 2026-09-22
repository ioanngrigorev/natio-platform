import { and, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client.js";
import { merchantUsers, merchants, payments, projects, type ProjectSettings } from "../../db/schema/index.js";
import { Errors } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import { isIP } from "node:net";
import { recordAudit, type Actor } from "../audit/service.js";
import { revokeAllSessions, slugify } from "../auth/service.js";

export type MerchantRow = typeof merchants.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;

export function serializeMerchant(m: MerchantRow) {
  return {
    id: m.id,
    object: "merchant",
    name: m.name,
    legal_name: m.legalName,
    country: m.country,
    website: m.website,
    registration_number: m.registrationNumber,
    contact_email: m.contactEmail,
    kyb_status: m.kybStatus,
    status: m.status,
    settings: m.settings,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}

export function serializeProject(p: ProjectRow) {
  return {
    id: p.id,
    object: "project",
    merchant_id: p.merchantId,
    name: p.name,
    slug: p.slug,
    status: p.status,
    settings: {
      allowed_ips: p.settings.allowedIps ?? [],
      allowed_domains: p.settings.allowedDomains ?? [],
      default_currency: p.settings.defaultCurrency ?? null,
      capture_method: p.settings.captureMethod ?? "automatic",
      retry_policy: p.settings.retryPolicy ?? {},
      statement_descriptor: p.settings.statementDescriptor ?? null,
    },
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

export function serializeUser(u: typeof merchantUsers.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    mfa_enabled: u.mfaEnabled,
    last_login_at: u.lastLoginAt,
    created_at: u.createdAt,
  };
}

export async function updateMerchantProfile(
  db: Db,
  merchantId: string,
  input: { name?: string; legalName?: string; country?: string; website?: string; registrationNumber?: string; contactEmail?: string; settings?: Record<string, unknown> },
  actor: Actor,
) {
  const [before] = await db.select().from(merchants).where(eq(merchants.id, merchantId)).limit(1);
  if (!before) throw Errors.notFound("Merchant", merchantId);
  const [after] = await db
    .update(merchants)
    .set({
      ...(input.name ? { name: input.name } : {}),
      ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
      ...(input.country !== undefined ? { country: input.country?.toUpperCase() } : {}),
      ...(input.website !== undefined ? { website: input.website } : {}),
      ...(input.registrationNumber !== undefined ? { registrationNumber: input.registrationNumber } : {}),
      ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
      ...(input.settings ? { settings: { ...before.settings, ...input.settings } } : {}),
      updatedAt: new Date(),
    })
    .where(eq(merchants.id, merchantId))
    .returning();
  await recordAudit(db, { actor, merchantId, action: "merchant.updated", entityType: "merchant", entityId: merchantId, before: serializeMerchant(before), after: serializeMerchant(after!) });
  return after!;
}

export async function listProjects(db: DbOrTx, merchantId: string) {
  return db.select().from(projects).where(eq(projects.merchantId, merchantId)).orderBy(projects.createdAt);
}

export async function createProject(db: Db, merchantId: string, input: { name: string }, actor: Actor) {
  const base = slugify(input.name);
  const existing = await db.select({ slug: projects.slug }).from(projects).where(eq(projects.merchantId, merchantId));
  let slug = base;
  let n = 2;
  while (existing.some((e) => e.slug === slug)) slug = `${base}-${n++}`;
  const [project] = await db
    .insert(projects)
    .values({ id: newId("project"), merchantId, name: input.name.trim(), slug, settings: { captureMethod: "automatic" } })
    .returning();
  await recordAudit(db, { actor, merchantId, action: "project.created", entityType: "project", entityId: project!.id, after: { name: project!.name } });
  return project!;
}

function validateIps(ips: string[]) {
  for (const ip of ips) {
    const [addr, prefix] = ip.split("/");
    if (!addr || !isIP(addr)) throw Errors.badRequest("invalid_ip", `"${ip}" is not a valid IP or CIDR`, "allowed_ips");
    if (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > (isIP(addr) === 4 ? 32 : 128))) {
      throw Errors.badRequest("invalid_ip", `"${ip}" has an invalid prefix`, "allowed_ips");
    }
  }
}

export async function updateProject(
  db: Db,
  merchantId: string,
  projectId: string,
  input: { name?: string; status?: "active" | "disabled"; settings?: Partial<ProjectSettings> },
  actor: Actor,
) {
  const [before] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.merchantId, merchantId)))
    .limit(1);
  if (!before) throw Errors.notFound("Project", projectId);
  if (input.settings?.allowedIps) validateIps(input.settings.allowedIps);
  if (input.settings?.allowedDomains) {
    for (const d of input.settings.allowedDomains) {
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) throw Errors.badRequest("invalid_domain", `"${d}" is not a valid domain`, "allowed_domains");
    }
  }
  const [after] = await db
    .update(projects)
    .set({
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.settings ? { settings: { ...before.settings, ...input.settings } } : {}),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .returning();
  await recordAudit(db, { actor, merchantId, action: "project.updated", entityType: "project", entityId: projectId, before: serializeProject(before), after: serializeProject(after!) });
  return after!;
}

export async function listUsers(db: DbOrTx, merchantId: string) {
  return db.select().from(merchantUsers).where(eq(merchantUsers.merchantId, merchantId)).orderBy(merchantUsers.createdAt);
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
export async function adminListMerchants(db: DbOrTx, f: { search?: string; status?: string; kyb?: string; limit?: number }) {
  const conds: SQL[] = [];
  if (f.search) conds.push(or(ilike(merchants.name, `%${f.search}%`), ilike(merchants.id, `%${f.search}%`), ilike(merchants.contactEmail, `%${f.search}%`))!);
  if (f.status) conds.push(eq(merchants.status, f.status as never));
  if (f.kyb) conds.push(eq(merchants.kybStatus, f.kyb as never));
  const rows = await db
    .select({
      m: merchants,
      // Column refs must be table-qualified: drizzle renders `${merchants.id}` as a bare "id" in a
      // single-table select, which inside the correlated subquery resolves to the inner table's id.
      users: sql<number>`(select count(*) from merchant_users u where u.merchant_id = "merchants"."id")`.mapWith(Number),
      payments30d: sql<number>`(select count(*) from payments p where p.merchant_id = "merchants"."id" and p.created_at > now() - interval '30 days')`.mapWith(Number),
      volume30d: sql<number>`(select coalesce(sum(p.amount),0) from payments p where p.merchant_id = "merchants"."id" and p.status = 'successful' and p.mode = 'live' and p.created_at > now() - interval '30 days')`.mapWith(Number),
    })
    .from(merchants)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(merchants.createdAt))
    .limit(Math.min(f.limit ?? 100, 500));
  return rows.map((r) => ({ ...serializeMerchant(r.m), users: r.users, payments_30d: r.payments30d, live_volume_30d: r.volume30d }));
}

export async function adminSetMerchantStatus(db: Db, merchantId: string, status: "active" | "disabled", actor: Actor, reason?: string) {
  const [before] = await db.select().from(merchants).where(eq(merchants.id, merchantId)).limit(1);
  if (!before) throw Errors.notFound("Merchant", merchantId);
  await db.update(merchants).set({ status, updatedAt: new Date() }).where(eq(merchants.id, merchantId));
  if (status === "disabled") {
    const users = await db.select({ id: merchantUsers.id }).from(merchantUsers).where(eq(merchantUsers.merchantId, merchantId));
    for (const u of users) await revokeAllSessions(db, u.id);
  }
  await recordAudit(db, { actor, merchantId, action: status === "disabled" ? "merchant.disabled" : "merchant.enabled", entityType: "merchant", entityId: merchantId, before: { status: before.status }, after: { status, reason } });
}

export async function adminSetKyb(db: Db, merchantId: string, kybStatus: "not_started" | "pending" | "approved" | "rejected", actor: Actor, note?: string) {
  const [before] = await db.select().from(merchants).where(eq(merchants.id, merchantId)).limit(1);
  if (!before) throw Errors.notFound("Merchant", merchantId);
  await db.update(merchants).set({ kybStatus, updatedAt: new Date() }).where(eq(merchants.id, merchantId));
  await recordAudit(db, { actor, merchantId, action: "merchant.kyb_updated", entityType: "merchant", entityId: merchantId, before: { kyb_status: before.kybStatus }, after: { kyb_status: kybStatus, note } });
}

export async function merchantOverviewCounts(db: DbOrTx, merchantId: string) {
  const [row] = await db
    .select({ total: count() })
    .from(payments)
    .where(eq(payments.merchantId, merchantId));
  return row?.total ?? 0;
}

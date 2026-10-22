import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client.js";
import {
  merchants,
  pricingPlans,
  providerAccounts,
} from "../../db/schema/index.js";
import { Errors } from "../../lib/errors.js";
import { recordAudit, type Actor } from "../audit/service.js";
import { conflicts, validateTerms, type PriceTerms } from "./engine.js";

export async function loadPrices(db: DbOrTx, mode: "test" | "live") {
  return db
    .select()
    .from(pricingPlans)
    .where(and(eq(pricingPlans.mode, mode), eq(pricingPlans.status, "active")));
}
export async function listPrices(db: DbOrTx, mode: "test" | "live") {
  return db
    .select()
    .from(pricingPlans)
    .where(eq(pricingPlans.mode, mode))
    .orderBy(desc(pricingPlans.createdAt));
}
async function validateScope(
  db: DbOrTx,
  mode: "test" | "live",
  terms: PriceTerms,
) {
  try {
    validateTerms(terms);
  } catch (e) {
    throw Errors.validation((e as Error).message);
  }
  if (
    terms.merchantId &&
    !(
      await db
        .select({ id: merchants.id })
        .from(merchants)
        .where(eq(merchants.id, terms.merchantId))
    ).length
  )
    throw Errors.validation("Unknown merchant");
  if (
    terms.providerAccountId &&
    !(
      await db
        .select({ id: providerAccounts.id })
        .from(providerAccounts)
        .where(
          and(
            eq(providerAccounts.id, terms.providerAccountId),
            eq(providerAccounts.mode, mode),
          ),
        )
    ).length
  )
    throw Errors.validation("PSP account does not belong to this mode");
}
export async function createPrice(
  db: Db,
  mode: "test" | "live",
  terms: PriceTerms,
  actor: Actor,
  cloneId?: string,
) {
  await validateScope(db, mode, terms);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7240108)`);
    let familyId = `price_${randomUUID().replaceAll("-", "")}`,
      revision = 1;
    if (cloneId) {
      const [source] = await tx
        .select()
        .from(pricingPlans)
        .where(and(eq(pricingPlans.id, cloneId), eq(pricingPlans.mode, mode)));
      if (!source) throw Errors.notFound("Pricing version");
      familyId = source.familyId;
      const [latest] = await tx
        .select()
        .from(pricingPlans)
        .where(eq(pricingPlans.familyId, familyId))
        .orderBy(desc(pricingPlans.revision))
        .limit(1);
      revision = latest!.revision + 1;
    }
    const [row] = await tx
      .insert(pricingPlans)
      .values({
        id: `price_${randomUUID().replaceAll("-", "")}`,
        familyId,
        revision,
        mode,
        terms,
        createdBy: actor.id,
      })
      .returning();
    await recordAudit(tx, {
      actor,
      action: "pricing.draft_created",
      entityType: "pricing_plan",
      entityId: row!.id,
      after: row,
    });
    return row!;
  });
}
export async function changePrice(
  db: Db,
  mode: "test" | "live",
  id: string,
  version: number,
  input: {
    terms?: PriceTerms;
    action?: "publish" | "retire";
    replacePrevious?: boolean;
  },
  actor: Actor,
) {
  if (input.terms) await validateScope(db, mode, input.terms);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7240108)`);
    const [row] = await tx
      .select()
      .from(pricingPlans)
      .where(and(eq(pricingPlans.id, id), eq(pricingPlans.mode, mode)))
      .for("update");
    if (!row) throw Errors.notFound("Pricing version");
    if (row.version !== version)
      throw Errors.conflict(
        "stale_version",
        "This tariff changed. Reload before saving.",
      );
    let status = row.status;
    if (input.terms && row.status !== "draft")
      throw Errors.conflict(
        "immutable_pricing",
        "Published terms are immutable. Create a new version.",
      );
    if (input.action === "publish") {
      if (row.status !== "draft")
        throw Errors.conflict(
          "invalid_pricing_state",
          "Only drafts can be published",
        );
      const active = await loadPrices(tx, mode);
      const overlapping = active.filter((p) =>
        conflicts(input.terms ?? row.terms, p.terms),
      );
      if (overlapping.length) {
        if (
          !input.replacePrevious ||
          overlapping.some((p) => p.familyId !== row.familyId)
        )
          throw Errors.conflict(
            "pricing_overlap",
            "An active tariff overlaps this scope, priority and effective dates. Replace the previous family version or choose different dates/priority.",
          );
        if (Date.parse((input.terms ?? row.terms).validFrom) > Date.now())
          throw Errors.validation(
            "An atomic replacement must already be effective. For scheduled non-overlapping tariffs use explicit effective intervals.",
          );
        for (const previous of overlapping) {
          await tx
            .update(pricingPlans)
            .set({
              status: "retired",
              version: previous.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(pricingPlans.id, previous.id));
          await recordAudit(tx, {
            actor,
            action: "pricing.replaced",
            entityType: "pricing_plan",
            entityId: previous.id,
            before: previous,
            after: { status: "retired", replacementId: id },
          });
        }
      }
      status = "active";
    }
    if (input.action === "retire") {
      if (row.status !== "active")
        throw Errors.conflict(
          "invalid_pricing_state",
          "Only active tariffs can be retired",
        );
      status = "retired";
    }
    const [updated] = await tx
      .update(pricingPlans)
      .set({
        status,
        terms: input.terms ?? row.terms,
        version: version + 1,
        updatedAt: new Date(),
      })
      .where(eq(pricingPlans.id, id))
      .returning();
    await recordAudit(tx, {
      actor,
      action: `pricing.${input.action ?? "edited"}`,
      entityType: "pricing_plan",
      entityId: id,
      before: row,
      after: updated,
    });
    return updated!;
  });
}

import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { modeEnum } from "./enums.js";
import type { PriceTerms } from "../../modules/pricing/engine.js";
export const pricingPlans = pgTable(
  "pricing_plans",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id").notNull(),
    revision: integer("revision").notNull(),
    mode: modeEnum("mode").notNull(),
    status: text("status").notNull().default("draft"),
    terms: jsonb("terms").$type<PriceTerms>().notNull(),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("pricing_plan_revision_uq").on(t.familyId, t.revision),
    index("pricing_plans_mode_idx").on(t.mode, t.status),
  ],
);

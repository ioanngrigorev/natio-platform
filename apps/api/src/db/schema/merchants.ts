import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import {
  adminRoleEnum,
  kybStatusEnum,
  merchantRoleEnum,
  merchantStatusEnum,
  modeEnum,
  paymentMethodTypeEnum,
  sessionKindEnum,
  userStatusEnum,
} from "./enums.js";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const merchants = pgTable("merchants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  country: text("country"),
  website: text("website"),
  registrationNumber: text("registration_number"),
  contactEmail: text("contact_email"),
  kybStatus: kybStatusEnum("kyb_status").notNull().default("not_started"),
  status: merchantStatusEnum("status").notNull().default("active"),
  /** Free-form merchant level configuration (industry, default currency, etc.). */
  settings: jsonb("settings").$type<MerchantSettings>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export interface MerchantSettings {
  industry?: string;
  defaultCurrency?: string;
  timezone?: string;
}

export const merchantUsers = pgTable(
  "merchant_users",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    role: merchantRoleEnum("role").notNull().default("viewer"),
    status: userStatusEnum("status").notNull().default("active"),
    inviteTokenHash: text("invite_token_hash"),
    inviteExpiresAt: ts("invite_expires_at"),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    /** Encrypted TOTP secret (AES-GCM). MFA enrolment is architecture-ready; UI enrolment is phase 2. */
    mfaSecretEnc: text("mfa_secret_enc"),
    lastLoginAt: ts("last_login_at"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: ts("locked_until"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("merchant_users_email_uq").on(t.email), index("merchant_users_merchant_idx").on(t.merchantId)],
);

export const adminUsers = pgTable(
  "admin_users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: adminRoleEnum("role").notNull().default("readonly"),
    status: userStatusEnum("status").notNull().default("active"),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    mfaSecretEnc: text("mfa_secret_enc"),
    lastLoginAt: ts("last_login_at"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: ts("locked_until"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("admin_users_email_uq").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    kind: sessionKindEnum("kind").notNull(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    csrfToken: text("csrf_token").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sessions_token_hash_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export interface ProjectSettings {
  allowedIps?: string[];
  allowedDomains?: string[];
  defaultCurrency?: string;
  captureMethod?: "automatic" | "manual";
  retryPolicy?: {
    maxAttempts?: number;
    retryOnSoftDecline?: boolean;
    retryOnTimeout?: boolean;
  };
  statementDescriptor?: string;
}

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: merchantStatusEnum("status").notNull().default("active"),
    settings: jsonb("settings").$type<ProjectSettings>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("projects_merchant_slug_uq").on(t.merchantId, t.slug)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    mode: modeEnum("mode").notNull(),
    name: text("name").notNull(),
    /** First characters of the key (e.g. natio_sk_test_a1b2) — safe to display. */
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("api_keys_hash_uq").on(t.keyHash), index("api_keys_merchant_idx").on(t.merchantId)],
);

export const customers = pgTable(
  "customers",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    mode: modeEnum("mode").notNull(),
    externalId: text("external_id"),
    email: text("email"),
    name: text("name"),
    country: text("country"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("customers_merchant_idx").on(t.merchantId, t.mode), index("customers_external_idx").on(t.projectId, t.externalId)],
);

/**
 * Stored payment methods are *references* to tokens issued by PCI-compliant providers.
 * NATIO never stores PAN, CVV or full bank credentials.
 */
export const paymentMethods = pgTable(
  "payment_methods",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    mode: modeEnum("mode").notNull(),
    customerId: text("customer_id").references(() => customers.id),
    type: paymentMethodTypeEnum("type").notNull(),
    providerId: text("provider_id"),
    providerToken: text("provider_token"),
    /** Display-only data: brand, last4, bank name, wallet type. Never sensitive. */
    display: jsonb("display").$type<Record<string, string>>().notNull().default({}),
    status: text("status").notNull().default("active"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("payment_methods_merchant_idx").on(t.merchantId, t.mode)],
);

export const contactRequests = pgTable("contact_requests", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company"),
  message: text("message").notNull(),
  source: text("source").notNull().default("website"),
  ip: text("ip"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

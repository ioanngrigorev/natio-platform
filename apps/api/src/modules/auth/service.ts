import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { loadConfig } from "../../config.js";
import type { Db, DbOrTx } from "../../db/client.js";
import { adminUsers, merchantUsers, merchants, projects, sessions } from "../../db/schema/index.js";
import { generateSessionToken, hashPassword, randomStringToken, sha256Hex, verifyPassword } from "./tokens.js";
import { newId } from "../../lib/ids.js";
import { ApiError, Errors } from "../../lib/errors.js";
import { recordAudit, type Actor } from "../audit/service.js";
import type { MerchantRole } from "./permissions.js";

const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

export interface MerchantPrincipal {
  user: typeof merchantUsers.$inferSelect;
  merchant: typeof merchants.$inferSelect;
  session: typeof sessions.$inferSelect;
}

export interface AdminPrincipal {
  admin: typeof adminUsers.$inferSelect;
  session: typeof sessions.$inferSelect;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "default"
  );
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
export async function createSession(
  db: DbOrTx,
  input: { kind: "merchant" | "admin"; userId: string; ip?: string; userAgent?: string },
): Promise<{ token: string; session: typeof sessions.$inferSelect }> {
  const cfg = loadConfig();
  const token = generateSessionToken();
  const ttlHours = input.kind === "admin" ? cfg.ADMIN_SESSION_TTL_HOURS : cfg.SESSION_TTL_HOURS;
  const [session] = await db
    .insert(sessions)
    .values({
      id: newId("session"),
      kind: input.kind,
      userId: input.userId,
      tokenHash: sha256Hex(token),
      csrfToken: randomStringToken(32),
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
      expiresAt: new Date(Date.now() + ttlHours * 3600 * 1000),
    })
    .returning();
  return { token, session: session! };
}

export async function revokeSession(db: DbOrTx, sessionId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function revokeAllSessions(db: DbOrTx, userId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/** Revoke every live session of a user except the one making the request. */
export async function revokeOtherSessions(db: DbOrTx, userId: string, keepSessionId?: string): Promise<void> {
  const conds = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
  if (keepSessionId) conds.push(ne(sessions.id, keepSessionId));
  await db.update(sessions).set({ revokedAt: new Date() }).where(and(...conds));
}

async function findLiveSession(db: DbOrTx, token: string, kind: "merchant" | "admin") {
  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, sha256Hex(token)), eq(sessions.kind, kind), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return session ?? null;
}

export async function resolveMerchantSession(db: DbOrTx, token: string): Promise<MerchantPrincipal | null> {
  const session = await findLiveSession(db, token, "merchant");
  if (!session) return null;
  const [row] = await db
    .select({ user: merchantUsers, merchant: merchants })
    .from(merchantUsers)
    .innerJoin(merchants, eq(merchants.id, merchantUsers.merchantId))
    .where(eq(merchantUsers.id, session.userId))
    .limit(1);
  if (!row || row.user.status !== "active") return null;
  return { user: row.user, merchant: row.merchant, session };
}

export async function resolveAdminSession(db: DbOrTx, token: string): Promise<AdminPrincipal | null> {
  const session = await findLiveSession(db, token, "admin");
  if (!session) return null;
  const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.id, session.userId)).limit(1);
  if (!admin || admin.status !== "active") return null;
  return { admin, session };
}

// ---------------------------------------------------------------------------
// Merchant registration & login
// ---------------------------------------------------------------------------
export async function registerMerchant(
  db: Db,
  input: { companyName: string; country?: string; website?: string; name: string; email: string; password: string; actor: Actor },
) {
  const email = input.email.trim().toLowerCase();
  const existing = await db.select({ id: merchantUsers.id }).from(merchantUsers).where(eq(merchantUsers.email, email)).limit(1);
  if (existing.length) throw Errors.conflict("email_taken", "An account with this email already exists");
  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const merchantId = newId("merchant");
    const [merchant] = await tx
      .insert(merchants)
      .values({
        id: merchantId,
        name: input.companyName.trim(),
        legalName: input.companyName.trim(),
        country: input.country?.toUpperCase() ?? null,
        website: input.website ?? null,
        contactEmail: email,
        kybStatus: "not_started",
        status: "active",
        settings: {},
      })
      .returning();
    const [project] = await tx
      .insert(projects)
      .values({ id: newId("project"), merchantId, name: "Default", slug: "default", settings: { captureMethod: "automatic" } })
      .returning();
    const [user] = await tx
      .insert(merchantUsers)
      .values({
        id: newId("merchantUser"),
        merchantId,
        email,
        name: input.name.trim(),
        passwordHash,
        role: "owner",
        status: "active",
      })
      .returning();
    await recordAudit(tx, {
      actor: { ...input.actor, type: "merchant_user", id: user!.id, label: email },
      merchantId,
      action: "merchant.registered",
      entityType: "merchant",
      entityId: merchantId,
      after: { name: merchant!.name, country: merchant!.country },
    });
    return { merchant: merchant!, project: project!, user: user! };
  });
}

export async function loginMerchant(
  db: Db,
  input: { email: string; password: string; ip?: string; userAgent?: string },
): Promise<{ token: string; principal: MerchantPrincipal }> {
  const email = input.email.trim().toLowerCase();
  const [user] = await db.select().from(merchantUsers).where(eq(merchantUsers.email, email)).limit(1);
  const invalid = () => Errors.unauthorized("Invalid email or password");
  if (!user || !user.passwordHash) {
    // Constant-time-ish: still perform a hash verification to avoid user enumeration by timing.
    await verifyPassword(input.password, "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
    throw invalid();
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new ApiError(423, "authentication_error", "account_locked", "Account temporarily locked after repeated failed logins");
  }
  // Deliberately the same message as a wrong password: the account's existence and state must not leak.
  if (user.status !== "active") throw invalid();
  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await db
      .update(merchantUsers)
      .set({
        failedLoginCount: failed,
        lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null,
      })
      .where(eq(merchantUsers.id, user.id));
    await recordAudit(db, {
      actor: { type: "merchant_user", id: user.id, label: email, ip: input.ip, userAgent: input.userAgent },
      merchantId: user.merchantId,
      action: "auth.login_failed",
      entityType: "merchant_user",
      entityId: user.id,
    });
    throw invalid();
  }
  const [merchant] = await db.select().from(merchants).where(eq(merchants.id, user.merchantId)).limit(1);
  if (!merchant) throw invalid();
  if (merchant.status === "disabled") throw Errors.forbidden("This merchant account has been disabled. Contact support.");

  const { token, session } = await createSession(db, { kind: "merchant", userId: user.id, ip: input.ip, userAgent: input.userAgent });
  await db
    .update(merchantUsers)
    .set({ lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null })
    .where(eq(merchantUsers.id, user.id));
  await recordAudit(db, {
    actor: { type: "merchant_user", id: user.id, label: email, ip: input.ip, userAgent: input.userAgent },
    merchantId: user.merchantId,
    action: "auth.login",
    entityType: "merchant_user",
    entityId: user.id,
  });
  return { token, principal: { user, merchant, session } };
}

export async function loginAdmin(
  db: Db,
  input: { email: string; password: string; ip?: string; userAgent?: string },
): Promise<{ token: string; principal: AdminPrincipal }> {
  const email = input.email.trim().toLowerCase();
  const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
  const invalid = () => Errors.unauthorized("Invalid email or password");
  if (!admin) {
    await verifyPassword(input.password, "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
    throw invalid();
  }
  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    throw new ApiError(423, "authentication_error", "account_locked", "Account temporarily locked after repeated failed logins");
  }
  if (admin.status !== "active") throw Errors.unauthorized("Account is not active");
  const ok = await verifyPassword(input.password, admin.passwordHash);
  if (!ok) {
    const failed = admin.failedLoginCount + 1;
    await db
      .update(adminUsers)
      .set({ failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null })
      .where(eq(adminUsers.id, admin.id));
    await recordAudit(db, {
      actor: { type: "admin_user", id: admin.id, label: email, ip: input.ip, userAgent: input.userAgent },
      action: "admin.login_failed",
      entityType: "admin_user",
      entityId: admin.id,
    });
    throw invalid();
  }
  const { token, session } = await createSession(db, { kind: "admin", userId: admin.id, ip: input.ip, userAgent: input.userAgent });
  await db.update(adminUsers).set({ lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null }).where(eq(adminUsers.id, admin.id));
  await recordAudit(db, {
    actor: { type: "admin_user", id: admin.id, label: email, ip: input.ip, userAgent: input.userAgent },
    action: "admin.login",
    entityType: "admin_user",
    entityId: admin.id,
  });
  return { token, principal: { admin, session } };
}

// ---------------------------------------------------------------------------
// Team management
// ---------------------------------------------------------------------------
export async function inviteUser(
  db: Db,
  input: { merchantId: string; email: string; name: string; role: MerchantRole; actor: Actor },
): Promise<{ user: typeof merchantUsers.$inferSelect; inviteToken: string }> {
  const email = input.email.trim().toLowerCase();
  const existing = await db.select({ id: merchantUsers.id }).from(merchantUsers).where(eq(merchantUsers.email, email)).limit(1);
  if (existing.length) throw Errors.conflict("email_taken", "A user with this email already exists");
  const inviteToken = randomStringToken(40);
  const [user] = await db
    .insert(merchantUsers)
    .values({
      id: newId("merchantUser"),
      merchantId: input.merchantId,
      email,
      name: input.name.trim(),
      role: input.role,
      status: "invited",
      inviteTokenHash: sha256Hex(inviteToken),
      inviteExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    })
    .returning();
  await recordAudit(db, {
    actor: input.actor,
    merchantId: input.merchantId,
    action: "team.user_invited",
    entityType: "merchant_user",
    entityId: user!.id,
    after: { email, role: input.role },
  });
  return { user: user!, inviteToken };
}

export async function acceptInvite(db: Db, input: { token: string; password: string; ip?: string; userAgent?: string }) {
  const [user] = await db
    .select()
    .from(merchantUsers)
    .where(and(eq(merchantUsers.inviteTokenHash, sha256Hex(input.token)), eq(merchantUsers.status, "invited")))
    .limit(1);
  if (!user || !user.inviteExpiresAt || user.inviteExpiresAt < new Date()) throw Errors.badRequest("invalid_invite", "Invite is invalid or expired");
  const passwordHash = await hashPassword(input.password);
  await db
    .update(merchantUsers)
    .set({ passwordHash, status: "active", inviteTokenHash: null, inviteExpiresAt: null, updatedAt: new Date() })
    .where(eq(merchantUsers.id, user.id));
  await recordAudit(db, {
    actor: { type: "merchant_user", id: user.id, label: user.email, ip: input.ip, userAgent: input.userAgent },
    merchantId: user.merchantId,
    action: "team.invite_accepted",
    entityType: "merchant_user",
    entityId: user.id,
  });
  return user;
}

export async function updateUserRole(db: Db, input: { merchantId: string; userId: string; role: MerchantRole; actor: Actor }) {
  const [user] = await db
    .select()
    .from(merchantUsers)
    .where(and(eq(merchantUsers.id, input.userId), eq(merchantUsers.merchantId, input.merchantId)))
    .limit(1);
  if (!user) throw Errors.notFound("User", input.userId);
  if (user.role === "owner") throw Errors.forbidden("The owner role cannot be changed");
  await db.update(merchantUsers).set({ role: input.role, updatedAt: new Date() }).where(eq(merchantUsers.id, user.id));
  await recordAudit(db, {
    actor: input.actor,
    merchantId: input.merchantId,
    action: "team.role_changed",
    entityType: "merchant_user",
    entityId: user.id,
    before: { role: user.role },
    after: { role: input.role },
  });
}

export async function setUserStatus(db: Db, input: { merchantId: string; userId: string; status: "active" | "disabled"; actor: Actor }) {
  const [user] = await db
    .select()
    .from(merchantUsers)
    .where(and(eq(merchantUsers.id, input.userId), eq(merchantUsers.merchantId, input.merchantId)))
    .limit(1);
  if (!user) throw Errors.notFound("User", input.userId);
  if (user.role === "owner") throw Errors.forbidden("The owner cannot be disabled");
  await db.update(merchantUsers).set({ status: input.status, updatedAt: new Date() }).where(eq(merchantUsers.id, user.id));
  if (input.status === "disabled") await revokeAllSessions(db, user.id);
  await recordAudit(db, {
    actor: input.actor,
    merchantId: input.merchantId,
    action: input.status === "disabled" ? "team.user_disabled" : "team.user_enabled",
    entityType: "merchant_user",
    entityId: user.id,
  });
}

export async function changePassword(
  db: Db,
  input: { userId: string; currentPassword: string; newPassword: string; actor: Actor; keepSessionId?: string },
) {
  const [user] = await db.select().from(merchantUsers).where(eq(merchantUsers.id, input.userId)).limit(1);
  if (!user) throw Errors.notFound("User");
  const ok = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!ok) throw Errors.unauthorized("Current password is incorrect");
  await db.update(merchantUsers).set({ passwordHash: await hashPassword(input.newPassword), updatedAt: new Date() }).where(eq(merchantUsers.id, user.id));
  // A password change must end every other session: that is how a user evicts an attacker
  // who already holds a stolen session cookie.
  await revokeOtherSessions(db, user.id, input.keepSessionId);
  await recordAudit(db, { actor: input.actor, merchantId: user.merchantId, action: "auth.password_changed", entityType: "merchant_user", entityId: user.id });
}

export { slugify };

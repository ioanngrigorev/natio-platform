/**
 * Create (or re-password) a single NATIO admin user. This is the production
 * counterpart to the sandbox seed, which must never run against production
 * because it creates demo accounts with a known password.
 *
 *   NATIO_ADMIN_EMAIL=ops@natio.me NATIO_ADMIN_NAME="Ops" node dist/db/create-admin.js
 *
 * With no NATIO_ADMIN_PASSWORD the password is generated and printed once, to
 * stdout only. Nothing is written to the audit log that could reveal it.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "./client.js";
import { adminUsers } from "./schema/index.js";
import { hashPassword } from "../lib/crypto.js";
import { newId, randomString } from "../lib/ids.js";
import { ADMIN_ROLES, type AdminRole } from "../modules/auth/permissions.js";

export async function createAdmin(input: { email: string; name: string; role: AdminRole; password?: string }) {
  const db = getDb();
  const email = input.email.trim().toLowerCase();
  const password = input.password || `${randomString(10)}-${randomString(10)}`;
  const passwordHash = await hashPassword(password);

  const [existing] = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
  if (existing) {
    await db
      .update(adminUsers)
      .set({ passwordHash, status: "active", failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(adminUsers.id, existing.id));
    return { id: existing.id, email, password, created: false };
  }
  const id = newId("adminUser");
  await db.insert(adminUsers).values({ id, email, name: input.name.trim(), role: input.role, passwordHash, status: "active" });
  return { id, email, password, created: true };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const email = process.env.NATIO_ADMIN_EMAIL;
  if (!email) {
    console.error("NATIO_ADMIN_EMAIL is required");
    process.exit(1);
  }
  const roleRaw = (process.env.NATIO_ADMIN_ROLE ?? "superadmin") as AdminRole;
  const role: AdminRole = (ADMIN_ROLES as string[]).includes(roleRaw) ? roleRaw : "superadmin";
  createAdmin({ email, name: process.env.NATIO_ADMIN_NAME ?? "NATIO Admin", role, password: process.env.NATIO_ADMIN_PASSWORD })
    .then(async (r) => {
      console.log("");
      console.log(r.created ? "Admin user created." : "Admin user already existed — password reset.");
      console.log(`  email:    ${r.email}`);
      console.log(`  role:     ${role}`);
      if (!process.env.NATIO_ADMIN_PASSWORD) console.log(`  password: ${r.password}     <-- shown once, store it now`);
      console.log("");
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("failed to create admin:", err instanceof Error ? err.message : err);
      await closeDb();
      process.exit(1);
    });
}

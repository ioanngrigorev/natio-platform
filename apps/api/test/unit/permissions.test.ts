import { describe, expect, it } from "vitest";
import {
  ADMIN_PERMISSIONS,
  ADMIN_ROLES,
  assignableRoles,
  hasAdminPermission,
  hasPermission,
  MERCHANT_READ_PERMISSIONS,
  MERCHANT_ROLES,
  PERMISSIONS,
  permissionsForRole,
  type AdminRole,
  type MerchantRole,
} from "../../src/modules/auth/permissions.js";

describe("merchant permissions", () => {
  it("owner and admin have every permission", () => {
    for (const role of ["owner", "admin"] as const) {
      for (const p of PERMISSIONS) expect(hasPermission(role, p), `${role} ${p}`).toBe(true);
      expect(permissionsForRole(role)).toHaveLength(PERMISSIONS.length);
    }
  });

  it("viewer is read-only and cannot manage api keys", () => {
    expect(hasPermission("viewer", "api_keys.manage")).toBe(false);
    expect(hasPermission("viewer", "api_keys.read")).toBe(false);
    expect(hasPermission("viewer", "webhooks.manage")).toBe(false);
    expect(hasPermission("viewer", "refunds.create")).toBe(false);
    expect(hasPermission("viewer", "payouts.create")).toBe(false);
    expect(hasPermission("viewer", "team.manage")).toBe(false);
    expect(hasPermission("viewer", "payments.read")).toBe(true);
    expect(hasPermission("viewer", "transactions.read")).toBe(true);
    expect(hasPermission("viewer", "analytics.read")).toBe(true);
    expect(permissionsForRole("viewer").every((p) => p.endsWith(".read"))).toBe(true);
  });

  it("developer can manage api keys and webhooks but cannot create payouts or refunds", () => {
    expect(hasPermission("developer", "api_keys.manage")).toBe(true);
    expect(hasPermission("developer", "api_keys.read")).toBe(true);
    expect(hasPermission("developer", "webhooks.manage")).toBe(true);
    expect(hasPermission("developer", "webhooks.read")).toBe(true);
    expect(hasPermission("developer", "projects.manage")).toBe(true);
    expect(hasPermission("developer", "payments.write")).toBe(true);
    expect(hasPermission("developer", "payouts.create")).toBe(false);
    expect(hasPermission("developer", "refunds.create")).toBe(false);
    expect(hasPermission("developer", "team.manage")).toBe(false);
    expect(hasPermission("developer", "merchant.update")).toBe(false);
    expect(hasPermission("developer", "reconciliation.manage")).toBe(false);
  });

  it("finance can create refunds and payouts and manage reconciliation", () => {
    expect(hasPermission("finance", "refunds.create")).toBe(true);
    expect(hasPermission("finance", "payouts.create")).toBe(true);
    expect(hasPermission("finance", "payouts.read")).toBe(true);
    expect(hasPermission("finance", "settlements.read")).toBe(true);
    expect(hasPermission("finance", "reconciliation.manage")).toBe(true);
    expect(hasPermission("finance", "audit.read")).toBe(true);
    expect(hasPermission("finance", "api_keys.manage")).toBe(false);
    expect(hasPermission("finance", "webhooks.manage")).toBe(false);
    expect(hasPermission("finance", "team.manage")).toBe(false);
  });

  it("support can create refunds but not payouts; analyst is read-only", () => {
    expect(hasPermission("support", "refunds.create")).toBe(true);
    expect(hasPermission("support", "payouts.create")).toBe(false);
    expect(hasPermission("support", "webhooks.read")).toBe(true);
    expect(hasPermission("support", "webhooks.manage")).toBe(false);
    expect(hasPermission("analyst", "analytics.read")).toBe(true);
    expect(hasPermission("analyst", "reconciliation.read")).toBe(true);
    expect(hasPermission("analyst", "refunds.create")).toBe(false);
    expect(permissionsForRole("analyst").every((p) => p.endsWith(".read"))).toBe(true);
  });

  it("every role's permissions are valid permission strings, and every role can read the merchant", () => {
    for (const role of MERCHANT_ROLES) {
      const perms = permissionsForRole(role);
      expect(perms.length).toBeGreaterThan(0);
      for (const p of perms) expect(PERMISSIONS).toContain(p);
      expect(hasPermission(role, "merchant.read")).toBe(true);
      expect(hasPermission(role, "payments.read")).toBe(true);
    }
    for (const p of MERCHANT_READ_PERMISSIONS) expect(p.endsWith(".read")).toBe(true);
  });

  it("unknown roles / permissions are denied", () => {
    expect(hasPermission("ghost" as MerchantRole, "payments.read")).toBe(false);
    expect(hasPermission("owner", "nuclear.launch" as never)).toBe(false);
    expect(permissionsForRole("ghost" as MerchantRole)).toEqual([]);
  });
});

describe("assignableRoles", () => {
  it("owner can assign every role, including owner", () => {
    expect(assignableRoles("owner")).toEqual(MERCHANT_ROLES);
    expect(assignableRoles("owner")).toContain("owner");
  });

  it("admin can assign every role except owner", () => {
    const roles = assignableRoles("admin");
    expect(roles).not.toContain("owner");
    expect(roles).toEqual(MERCHANT_ROLES.filter((r) => r !== "owner"));
    expect(roles).toContain("admin");
    expect(roles).toContain("viewer");
  });

  it("other roles cannot assign anything", () => {
    for (const role of ["developer", "finance", "analyst", "support", "viewer"] as const) expect(assignableRoles(role)).toEqual([]);
  });

  it("returns a fresh array (callers cannot mutate the role list)", () => {
    const a = assignableRoles("owner");
    a.push("hacker" as MerchantRole);
    expect(assignableRoles("owner")).not.toContain("hacker");
    expect(MERCHANT_ROLES).not.toContain("hacker");
  });
});

describe("admin permissions", () => {
  it("superadmin has everything", () => {
    for (const p of ADMIN_PERMISSIONS) expect(hasAdminPermission("superadmin", p)).toBe(true);
  });

  it("readonly cannot manage providers (or anything else) but can read", () => {
    expect(hasAdminPermission("readonly", "providers.manage")).toBe(false);
    expect(hasAdminPermission("readonly", "routing.manage")).toBe(false);
    expect(hasAdminPermission("readonly", "merchants.manage")).toBe(false);
    expect(hasAdminPermission("readonly", "webhooks.resend")).toBe(false);
    expect(hasAdminPermission("readonly", "admin_users.manage")).toBe(false);
    expect(hasAdminPermission("readonly", "admin.read")).toBe(true);
    expect(hasAdminPermission("readonly", "audit.read")).toBe(true);
  });

  it("operations can manage providers, routing, risk and retries but not admin users", () => {
    expect(hasAdminPermission("operations", "providers.manage")).toBe(true);
    expect(hasAdminPermission("operations", "routing.manage")).toBe(true);
    expect(hasAdminPermission("operations", "risk.manage")).toBe(true);
    expect(hasAdminPermission("operations", "operations.retry")).toBe(true);
    expect(hasAdminPermission("operations", "merchants.manage")).toBe(true);
    expect(hasAdminPermission("operations", "reconciliation.manage")).toBe(true);
    expect(hasAdminPermission("operations", "settlements.manage")).toBe(true);
    expect(hasAdminPermission("operations", "admin_users.manage")).toBe(false);
  });

  it("support can resend webhooks and retry but cannot manage routing or providers", () => {
    expect(hasAdminPermission("support", "webhooks.resend")).toBe(true);
    expect(hasAdminPermission("support", "operations.retry")).toBe(true);
    expect(hasAdminPermission("support", "admin.read")).toBe(true);
    expect(hasAdminPermission("support", "routing.manage")).toBe(false);
    expect(hasAdminPermission("support", "providers.manage")).toBe(false);
    expect(hasAdminPermission("support", "risk.manage")).toBe(false);
    expect(hasAdminPermission("support", "merchants.manage")).toBe(false);
  });

  it("every admin role can at least read", () => {
    for (const role of ADMIN_ROLES) expect(hasAdminPermission(role, "admin.read")).toBe(true);
  });

  it("unknown roles are denied", () => {
    expect(hasAdminPermission("root" as AdminRole, "admin.read")).toBe(false);
  });
});

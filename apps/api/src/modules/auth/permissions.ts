/**
 * Role based access control for merchant dashboard users and internal admin users.
 * Permissions are coarse-grained resource.action strings; routes declare what they need.
 */
export type MerchantRole = "owner" | "admin" | "developer" | "finance" | "analyst" | "support" | "viewer";
export type AdminRole = "superadmin" | "operations" | "support" | "readonly";

export const MERCHANT_ROLES: MerchantRole[] = ["owner", "admin", "developer", "finance", "analyst", "support", "viewer"];
export const ADMIN_ROLES: AdminRole[] = ["superadmin", "operations", "support", "readonly"];

export const PERMISSIONS = [
  "merchant.read",
  "merchant.update",
  "team.read",
  "team.manage",
  "projects.read",
  "projects.manage",
  "api_keys.read",
  "api_keys.manage",
  "webhooks.read",
  "webhooks.manage",
  "payments.read",
  "payments.write",
  "refunds.create",
  "payouts.read",
  "payouts.create",
  "transactions.read",
  "settlements.read",
  "reconciliation.read",
  "reconciliation.manage",
  "analytics.read",
  "audit.read",
  "wallets.read",
  /**
   * Registering a settlement key decides where a merchant's money goes. It is
   * the most consequential setting on the account — more so than an API key,
   * which grants access but not a destination — so it stays with owners and
   * admins. A developer who could register one could point settlements at a
   * key of their own, and nothing downstream would look wrong.
   */
  "wallets.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ_ALL: Permission[] = [
  "merchant.read",
  "team.read",
  "projects.read",
  "api_keys.read",
  "webhooks.read",
  "payments.read",
  "payouts.read",
  "transactions.read",
  "settlements.read",
  "reconciliation.read",
  "analytics.read",
  "audit.read",
  "wallets.read",
];

const ROLE_PERMISSIONS: Record<MerchantRole, Permission[]> = {
  owner: [...PERMISSIONS],
  admin: [...PERMISSIONS],
  developer: [
    "merchant.read",
    "team.read",
    "projects.read",
    "projects.manage",
    "api_keys.read",
    "api_keys.manage",
    "webhooks.read",
    "webhooks.manage",
    "payments.read",
    "payments.write",
    "payouts.read",
    "transactions.read",
    "analytics.read",
    "wallets.read",
  ],
  finance: [
    "merchant.read",
    "team.read",
    "projects.read",
    "payments.read",
    "payments.write",
    "refunds.create",
    "payouts.read",
    "payouts.create",
    "transactions.read",
    "settlements.read",
    "reconciliation.read",
    "reconciliation.manage",
    "analytics.read",
    "audit.read",
    "wallets.read",
  ],
  analyst: ["merchant.read", "projects.read", "payments.read", "payouts.read", "transactions.read", "settlements.read", "reconciliation.read", "analytics.read", "wallets.read"],
  support: ["merchant.read", "projects.read", "payments.read", "payouts.read", "transactions.read", "webhooks.read", "refunds.create", "wallets.read"],
  viewer: ["merchant.read", "projects.read", "payments.read", "transactions.read", "analytics.read", "wallets.read"],
};

export function permissionsForRole(role: MerchantRole): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function hasPermission(role: MerchantRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** Roles a given role may assign to others. Owners can assign anything; admins cannot create owners. */
export function assignableRoles(actorRole: MerchantRole): MerchantRole[] {
  if (actorRole === "owner") return [...MERCHANT_ROLES];
  if (actorRole === "admin") return MERCHANT_ROLES.filter((r) => r !== "owner");
  return [];
}

export const ADMIN_PERMISSIONS = [
  "admin.read",
  "merchants.manage",
  "providers.manage",
  "routing.manage",
  "risk.manage",
  "operations.retry",
  "webhooks.resend",
  "reconciliation.manage",
  "settlements.manage",
  "admin_users.manage",
  "audit.read",
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

const ADMIN_ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  superadmin: [...ADMIN_PERMISSIONS],
  operations: [
    "admin.read",
    "merchants.manage",
    "providers.manage",
    "routing.manage",
    "risk.manage",
    "operations.retry",
    "webhooks.resend",
    "reconciliation.manage",
    "settlements.manage",
    "audit.read",
  ],
  support: ["admin.read", "webhooks.resend", "operations.retry", "audit.read"],
  readonly: ["admin.read", "audit.read"],
};

export function hasAdminPermission(role: AdminRole, permission: AdminPermission): boolean {
  return ADMIN_ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export { READ_ALL as MERCHANT_READ_PERMISSIONS };

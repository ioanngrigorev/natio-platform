/**
 * Role based access control for merchant dashboard users and internal admin users.
 * Permissions are coarse-grained resource.action strings; routes declare what they need.
 */
export type MerchantRole = "owner" | "admin" | "developer" | "finance" | "analyst" | "support" | "viewer";
export type AdminRole = "superadmin" | "administrator" | "technical" | "finance" | "operations" | "support" | "readonly";

export const MERCHANT_ROLES: MerchantRole[] = ["owner", "admin", "developer", "finance", "analyst", "support", "viewer"];
export const ADMIN_ROLES: AdminRole[] = ["superadmin", "administrator", "technical", "finance", "operations", "support", "readonly"];

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
  "finance.read",
  "integrations.read",
  "platform.read",
  "users.read",
  "pricing.manage",
  "integrations.manage",
  "development.manage",
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
  // Operational administration does not confer key custody, financial edits,
  // or the ability to grant its own privileges. Legacy operations is retained
  // for existing accounts; new accounts should use one of these focused roles.
  administrator: ["admin.read", "finance.read", "integrations.read", "platform.read", "users.read", "merchants.manage", "risk.manage", "operations.retry", "webhooks.resend", "audit.read"],
  technical: ["admin.read", "integrations.read", "platform.read", "providers.manage", "integrations.manage", "routing.manage", "webhooks.resend", "development.manage", "audit.read"],
  finance: ["admin.read", "finance.read", "pricing.manage", "reconciliation.manage", "settlements.manage", "audit.read"],
  operations: [
    "admin.read",
    "finance.read", "integrations.read", "platform.read", "users.read", "pricing.manage", "integrations.manage", "development.manage",
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
  support: ["admin.read", "platform.read", "webhooks.resend", "operations.retry", "audit.read"],
  readonly: ["admin.read", "finance.read", "integrations.read", "platform.read", "users.read", "audit.read"],
};

export function hasAdminPermission(role: AdminRole, permission: AdminPermission): boolean {
  return ADMIN_ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function adminPermissions(role: AdminRole): AdminPermission[] {
  return [...(ADMIN_ROLE_PERMISSIONS[role] ?? [])];
}

/** Coarse read boundaries complement each route's explicit mutation permission.
 * Keep auth and shared analytics accessible so every role has a useful landing
 * page. Provider lists are shared lookup data for reconciliation and BI; the
 * configuration screens and writes require integration permissions separately.
 */
export function adminReadPermission(path: string): AdminPermission {
  const p = path.split("?")[0]!;
  if (/^\/admin\/(pricing|balances|payouts|settlements|reconciliation|receipts)(?:\/|$)/.test(p) || /^\/admin\/payments\/[^/]+\/pricing$/.test(p)) return "finance.read";
  if (/^\/admin\/(routing|lab|integrations)(?:\/|$)/.test(p)) return "integrations.read";
  if (/^\/admin\/(system-events|chains|webhooks)(?:\/|$)/.test(p)) return "platform.read";
  if (/^\/admin\/users(?:\/|$)/.test(p)) return "users.read";
  return "admin.read";
}

export { READ_ALL as MERCHANT_READ_PERMISSIONS };

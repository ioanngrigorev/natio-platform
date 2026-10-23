// UI mirror only. API guards remain authoritative; parity is covered by regression tests.
import type {AdminRole} from "./admin-types";
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

const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
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

export function adminCan(role: string, permission: AdminPermission): boolean {
  return ROLE_PERMISSIONS[role as AdminRole]?.includes(permission) ?? false;
}

export function adminPermissions(role: AdminRole): AdminPermission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
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

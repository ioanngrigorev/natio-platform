/**
 * Client-side mirror of `apps/api/src/modules/auth/permissions.ts` (ADMIN_ROLE_PERMISSIONS).
 * Used only to hide controls a role cannot use; the API remains the source of truth.
 */
import type { AdminRole } from "./admin-types";

export type AdminPermission =
  | "admin.read"
  | "merchants.manage"
  | "providers.manage"
  | "routing.manage"
  | "risk.manage"
  | "operations.retry"
  | "webhooks.resend"
  | "reconciliation.manage"
  | "settlements.manage"
  | "admin_users.manage"
  | "audit.read";

const ALL: AdminPermission[] = ["admin.read", "merchants.manage", "providers.manage", "routing.manage", "risk.manage", "operations.retry", "webhooks.resend", "reconciliation.manage", "settlements.manage", "admin_users.manage", "audit.read"];

const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  superadmin: ALL,
  operations: ["admin.read", "merchants.manage", "providers.manage", "routing.manage", "risk.manage", "operations.retry", "webhooks.resend", "reconciliation.manage", "settlements.manage", "audit.read"],
  support: ["admin.read", "webhooks.resend", "operations.retry", "audit.read"],
  readonly: ["admin.read", "audit.read"],
};

export function adminCan(role: string, permission: AdminPermission): boolean {
  return ROLE_PERMISSIONS[role as AdminRole]?.includes(permission) ?? false;
}

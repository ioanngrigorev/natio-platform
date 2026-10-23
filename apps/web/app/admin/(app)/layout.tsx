import {adminCan,adminReadPermission,adminPermissions} from "@/lib/admin-permissions";
import type {AdminRole} from "@/lib/admin-types";
import { redirect } from "next/navigation";
import { SessionProvider } from "@/components/session-provider";
import { Shell, type NavItem } from "@/components/shell";
import { getAdminSession } from "@/lib/session";

const NAV: NavItem[] = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/bi", label: "BI & Reports" },
  { href: "/admin/boards", label: "My dashboards" },
  { href: "/admin/risk-dashboard", label: "Risk dashboard" },
  { href: "/admin/market", label: "Market intelligence" },
  { href: "/admin/payments", label: "Payments", section: "Operations" },
  { href: "/admin/transactions", label: "Transactions", section: "Operations" },
  { href: "/admin/payouts", label: "Payouts", section: "Operations" },
  { href: "/admin/webhooks", label: "Webhooks", section: "Operations" },
  { href: "/admin/merchants", label: "Merchants", section: "Customers" },
  { href: "/admin/users", label: "Users", section: "Customers" },
  { href: "/admin/balances", label: "Balances", section: "Finance" },
  { href: "/admin/pricing", label: "Pricing & margin", section: "Finance" },
  { href: "/admin/receipts", label: "Receipt review", section: "Finance" },
  { href: "/admin/settlements", label: "Settlements", section: "Finance" },
  { href: "/admin/reconciliation", label: "Reconciliation", section: "Finance" },
  { href: "/admin/providers", label: "Providers", section: "Payment setup" },
  { href: "/admin/lab", label: "Connection Lab", section: "Payment setup" },
  { href: "/admin/catalog", label: "Payment catalog", section: "Payment setup" },
  { href: "/admin/routing/studio", label: "Routing studio", section: "Payment setup" },
  { href: "/admin/routing", exact: true, label: "Routing rules", section: "Payment setup" },
  { href: "/admin/risk", label: "Risk rules", section: "Payment setup" },
  { href: "/admin/development", label: "Development Center", section: "Development" },
  { href: "/admin/plans", label: "Plans & monetisation", section: "Development" },
  { href: "/admin/system-events", label: "System events", section: "Platform" },
  { href: "/admin/access", label: "My access", section: "Platform" },
  { href: "/admin/audit", label: "Audit log", section: "Platform" },
  { href: "/admin/knowledge", label: "Knowledge base", section: "Support" },
  { href: "/admin/support", label: "Contact support", section: "Support" },
];

export const dynamic = "force-dynamic";

export default async function AdminAppLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  return (
    <SessionProvider session={{ kind: "admin", sandbox: session.sandbox, csrf: session.csrf_token, mode: session.mode, permissions: session.permissions ?? adminPermissions(session.admin.role as AdminRole), user: session.admin }}>
      <Shell nav={NAV.filter(item => adminCan(session.admin.role, /^\/admin\/(providers|catalog)(?:\/|$)/.test(item.href) ? "integrations.read" : item.href === "/admin/audit" ? "audit.read" : adminReadPermission(item.href)))} brand={{ title: "Admin", subtitle: session.mode === "test" ? "Investor demo · 2025" : "NATIO internal operations" }}>
        {children}
      </Shell>
    </SessionProvider>
  );
}

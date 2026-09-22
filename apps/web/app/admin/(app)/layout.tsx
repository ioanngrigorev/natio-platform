import { redirect } from "next/navigation";
import { SessionProvider } from "@/components/session-provider";
import { Shell, type NavItem } from "@/components/shell";
import { getAdminSession } from "@/lib/session";

const NAV: NavItem[] = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/merchants", label: "Merchants", section: "Customers" },
  { href: "/admin/users", label: "Users", section: "Customers" },
  { href: "/admin/payments", label: "Payments", section: "Operations" },
  { href: "/admin/transactions", label: "Transactions", section: "Operations" },
  { href: "/admin/payouts", label: "Payouts", section: "Operations" },
  { href: "/admin/webhooks", label: "Webhooks", section: "Operations" },
  { href: "/admin/providers", label: "Providers", section: "Infrastructure" },
  { href: "/admin/routing", label: "Routing rules", section: "Infrastructure" },
  { href: "/admin/risk", label: "Risk rules", section: "Infrastructure" },
  { href: "/admin/settlements", label: "Settlements", section: "Finance" },
  { href: "/admin/reconciliation", label: "Reconciliation", section: "Finance" },
  { href: "/admin/system-events", label: "System events", section: "Platform" },
  { href: "/admin/audit", label: "Audit log", section: "Platform" },
];

export const dynamic = "force-dynamic";

export default async function AdminAppLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  return (
    <SessionProvider session={{ kind: "admin", csrf: session.csrf_token, mode: session.mode, permissions: [], user: session.admin }}>
      <Shell nav={NAV} brand={{ title: "Admin", subtitle: "NATIO internal operations" }}>
        {children}
      </Shell>
    </SessionProvider>
  );
}

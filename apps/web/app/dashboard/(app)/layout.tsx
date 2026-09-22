import { redirect } from "next/navigation";
import { SessionProvider } from "@/components/session-provider";
import { Shell, type NavItem } from "@/components/shell";
import { getMerchantSession } from "@/lib/session";

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/payments", label: "Payments", section: "Payments" },
  { href: "/dashboard/transactions", label: "Transactions", section: "Payments" },
  { href: "/dashboard/payouts", label: "Payouts", section: "Payments" },
  { href: "/dashboard/settlements", label: "Settlements", section: "Finance" },
  { href: "/dashboard/wallets", label: "Settlement keys", section: "Finance" },
  { href: "/dashboard/reconciliation", label: "Reconciliation", section: "Finance" },
  { href: "/dashboard/analytics", label: "Analytics", section: "Finance" },
  { href: "/dashboard/developers", label: "Developers", section: "Integration" },
  { href: "/dashboard/api-keys", label: "API keys", section: "Integration" },
  { href: "/dashboard/webhooks", label: "Webhooks", section: "Integration" },
  { href: "/dashboard/team", label: "Team", section: "Account" },
  { href: "/dashboard/settings", label: "Settings", section: "Account" },
];

export const dynamic = "force-dynamic";

export default async function DashboardAppLayout({ children }: { children: React.ReactNode }) {
  const session = await getMerchantSession();
  if (!session) redirect("/dashboard/login");
  return (
    <SessionProvider
      session={{
        kind: "merchant",
        csrf: session.csrf_token,
        mode: session.mode,
        permissions: session.permissions,
        user: session.user,
        merchant: { id: session.merchant.id, name: session.merchant.name, kyb_status: session.merchant.kyb_status, status: session.merchant.status },
        projects: session.projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
      }}
    >
      <Shell nav={NAV} brand={{ title: "Merchant", subtitle: session.merchant.name }}>
        {children}
      </Shell>
    </SessionProvider>
  );
}

import { FilterBar } from "@/components/dashboard/filters";
import { PaymentsTable } from "@/components/dashboard/payments-table";
import { CreateTestPayment } from "@/components/dashboard/create-test-payment";
import { Card, PageHeader, Pagination } from "@/components/ui";
import { qs } from "@/lib/api";
import { serverApi } from "@/lib/session";
import type { Paginated, Payment } from "@/lib/types";

export const metadata = { title: "Payments" };

const STATUSES = ["created", "pending", "processing", "authorized", "successful", "failed", "cancelled", "refunded", "partially_refunded"];
const METHODS = ["card", "bank_transfer", "qr", "open_banking", "wallet", "instant", "local"];

export default async function PaymentsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const api = serverApi();
  const query = qs({ status: searchParams.status, currency: searchParams.currency, country: searchParams.country, payment_method: searchParams.payment_method, search: searchParams.search, from: searchParams.from ? new Date(searchParams.from).toISOString() : undefined, to: searchParams.to ? new Date(searchParams.to).toISOString() : undefined, cursor: searchParams.cursor, limit: 50 });
  const [page, scenarios] = await Promise.all([api.get<Paginated<Payment>>(`/dashboard/payments${query}`), api.get<{ data: Array<{ name: string; description: string }> }>("/dashboard/payments/scenarios")]);

  return (
    <>
      <PageHeader title="Payments" subtitle="Every payment routed through NATIO, with provider, route and outcome." actions={api.mode === "test" ? <CreateTestPayment scenarios={scenarios.data} /> : null} />
      <FilterBar
        filters={[
          { name: "search", label: "Search", type: "text", placeholder: "pay_…, reference, provider id" },
          { name: "status", label: "Status", type: "select", options: STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") })) },
          { name: "payment_method", label: "Method", type: "select", options: METHODS.map((m) => ({ value: m, label: m.replace(/_/g, " ") })) },
          { name: "currency", label: "Currency", type: "text", placeholder: "USD" },
          { name: "country", label: "Country", type: "text", placeholder: "US" },
          { name: "from", label: "From", type: "date" },
          { name: "to", label: "To", type: "date" },
        ]}
      />
      <Card padded={false}>
        <PaymentsTable payments={page.data} hrefBase="/dashboard/payments" />
        <Pagination hasMore={page.has_more} nextCursor={page.next_cursor} baseHref="/dashboard/payments" params={searchParams} />
      </Card>
    </>
  );
}

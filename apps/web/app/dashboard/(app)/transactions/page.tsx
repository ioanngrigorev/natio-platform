import { FilterBar } from "@/components/dashboard/filters";
import { TransactionsTable } from "@/components/dashboard/transactions-table";
import { Card, PageHeader, Pagination } from "@/components/ui";
import { qs } from "@/lib/api";
import { serverApi } from "@/lib/session";
import type { Paginated, Transaction } from "@/lib/types";

export const metadata = { title: "Transactions" };

const TYPES = ["payment", "refund", "payout", "fee", "adjustment"];
const STATUSES = ["pending", "successful", "failed", "cancelled"];
const METHODS = ["card", "bank_transfer", "qr", "open_banking", "wallet", "instant", "local", "bank_account", "card_token"];

export default async function TransactionsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const api = serverApi();
  const query = qs({
    search: searchParams.search,
    type: searchParams.type,
    status: searchParams.status,
    currency: searchParams.currency,
    country: searchParams.country,
    payment_method: searchParams.payment_method,
    from: searchParams.from ? new Date(searchParams.from).toISOString() : undefined,
    to: searchParams.to ? new Date(searchParams.to).toISOString() : undefined,
    cursor: searchParams.cursor,
    limit: 50,
  });
  const page = await api.get<Paginated<Transaction>>(`/dashboard/transactions${query}`);

  return (
    <>
      <PageHeader title="Transactions" subtitle="Ledger view of every payment, refund and payout processed through NATIO, with provider, fee and settlement state." />
      <FilterBar
        filters={[
          { name: "search", label: "Search", type: "text", placeholder: "txn_…, pay_…, provider ref" },
          { name: "type", label: "Type", type: "select", options: TYPES.map((t) => ({ value: t, label: t })) },
          { name: "status", label: "Status", type: "select", options: STATUSES.map((s) => ({ value: s, label: s })) },
          { name: "currency", label: "Currency", type: "text", placeholder: "USD" },
          { name: "country", label: "Country", type: "text", placeholder: "US" },
          { name: "payment_method", label: "Method", type: "select", options: METHODS.map((m) => ({ value: m, label: m.replace(/_/g, " ") })) },
          { name: "from", label: "From", type: "date" },
          { name: "to", label: "To", type: "date" },
        ]}
      />
      <Card padded={false}>
        <TransactionsTable transactions={page.data} />
        <Pagination hasMore={page.has_more} nextCursor={page.next_cursor} baseHref="/dashboard/transactions" params={searchParams} />
      </Card>
    </>
  );
}


import {getI18n} from '@/lib/i18n/server';
import { FilterBar } from "@/components/dashboard/filters";
import { PaymentsTable } from "@/components/dashboard/payments-table";
import { Card, PageHeader, Pagination } from "@/components/ui";
import { qs } from "@/lib/api";
import { serverApi } from "@/lib/session";
import type { AdminMerchant } from "@/lib/admin-types";
import type { Paginated, Payment } from "@/lib/types";

export const metadata = { title: "Payments" };

const STATUSES = ["created", "pending", "processing", "authorized", "successful", "failed", "cancelled", "refunded", "partially_refunded"];
const METHODS = ["card", "bank_transfer", "qr", "open_banking", "wallet", "instant", "local"];

export default async function AdminPaymentsPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  const searchParams = await props.searchParams;
  const {t:translateUi,locale:uiLocale}=(await getI18n());

  const api = (await serverApi());
  const query = qs({
    provider_account_id: searchParams.provider_account_id,
    merchant_id: searchParams.merchant_id,
    status: searchParams.status,
    currency: searchParams.currency,
    country: searchParams.country,
    payment_method: searchParams.payment_method,
    search: searchParams.search,
    from: searchParams.from ? new Date(searchParams.from).toISOString() : undefined,
    to: searchParams.to ? new Date(searchParams.to).toISOString() : undefined,
    cursor: searchParams.cursor,
    limit: 50,
  });
  const [page, merchants] = await Promise.all([api.get<Paginated<Payment>>(`/admin/payments${query}`), api.get<{ data: AdminMerchant[] }>("/admin/merchants?fields=options&limit=500")]);
  const merchantName = merchants.data.find((m) => m.id === searchParams.merchant_id)?.name;

  return (
    <>
      <PageHeader title={translateUi(searchParams.status === "pending" ? translateUi("Payments · review queue") : translateUi("Payments"))} subtitle={translateUi(merchantName ? `Payments of ${merchantName} in ${api.mode} mode.` : `All payments across merchants in ${api.mode} mode. Pending payments are waiting for a manual risk review.`)} />
      <FilterBar
        filters={[
          { name: "provider_account_id", label: "Provider account", type: "text", placeholder: "Account ID" },
          { name: "merchant_id", label: "Merchant", type: "select", options: merchants.data.map((m) => ({ value: m.id, label: m.name })) },
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
        <PaymentsTable payments={page.data} hrefBase="/admin/payments" />
        <Pagination hasMore={page.has_more} nextCursor={page.next_cursor} baseHref="/admin/payments" params={searchParams} />
      </Card>
    </>
  );
}

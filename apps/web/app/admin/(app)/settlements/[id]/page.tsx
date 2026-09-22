import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Card, DescriptionList, EmptyState, Mono, PageHeader, StatusBadge, Table } from "@/components/ui";
import { ApiRequestError } from "@/lib/api";
import { formatDate, formatDateTime, formatDateTimeFull, formatMoney, formatNumber, shortId, titleCase } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { Settlement } from "@/lib/types";

type Detail = Settlement & { items: NonNullable<Settlement["items"]> };

export default async function AdminSettlementDetailPage({ params }: { params: { id: string } }) {
  const api = serverApi();
  let s: Detail;
  try {
    s = await api.get<Detail>(`/admin/settlements/${params.id}`);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) notFound();
    throw err;
  }

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/admin/settlements" className="hover:underline">
            Settlements
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <Mono className="text-[18px]">{s.id}</Mono>
            <StatusBadge status={s.status} />
            {s.mode === "test" ? <StatusBadge status="test" label="Sandbox" /> : null}
          </span>
        }
        subtitle={`${formatMoney(s.net_amount, s.currency)} net · ${s.provider_name ?? "provider"} · period ${formatDate(s.period_start)} – ${formatDate(s.period_end)}`}
      />

      <div className="mb-4">
        <Alert tone="info">The settlement entity is the licensed provider company that pays the net amount to the merchant&apos;s bank account. NATIO records the provider&apos;s report and does not hold funds.</Alert>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Settlement" description="What the provider reported for this period">
            <DescriptionList
              cols={3}
              items={[
                { label: "Gross", value: formatMoney(s.gross_amount, s.currency) },
                { label: "Provider fees", value: formatMoney(-s.fee_amount, s.currency) },
                { label: "Net settled", value: <span className="font-medium">{formatMoney(s.net_amount, s.currency)}</span> },
                { label: "Transactions", value: formatNumber(s.transaction_count) },
                { label: "Currency", value: s.currency },
                { label: "Reference", value: s.settlement_reference ? <Mono>{s.settlement_reference}</Mono> : "—" },
                { label: "Period start", value: formatDateTimeFull(s.period_start) },
                { label: "Period end", value: formatDateTimeFull(s.period_end) },
                { label: "Settled at", value: formatDateTimeFull(s.settled_at) },
                { label: "Source", value: titleCase(s.source) },
                { label: "Created", value: formatDateTimeFull(s.created_at) },
                { label: "Mode", value: <StatusBadge status={s.mode} label={s.mode === "test" ? "Test" : "Live"} /> },
              ]}
            />
          </Card>

          <Card title="Settled transactions" description="Ledger entries the provider included in this settlement" padded={false}>
            {s.items.length ? (
              <Table>
                <thead>
                  <tr>
                    <th>Transaction</th>
                    <th>Type</th>
                    <th>Entity</th>
                    <th className="num">Amount</th>
                    <th className="num">Fee</th>
                    <th>Occurred</th>
                  </tr>
                </thead>
                <tbody>
                  {s.items.map((it) => (
                    <tr key={it.transaction_id}>
                      <td>
                        <Link href={`/admin/transactions?search=${encodeURIComponent(it.transaction_id)}`} className="text-brand-600 hover:underline">
                          <Mono>{shortId(it.transaction_id, 10)}</Mono>
                        </Link>
                      </td>
                      <td>{titleCase(it.type)}</td>
                      <td>
                        {it.type === "payment" ? (
                          <Link href={`/admin/payments/${it.entity_id}`} className="text-brand-600 hover:underline">
                            <Mono>{shortId(it.entity_id, 8)}</Mono>
                          </Link>
                        ) : it.type === "payout" ? (
                          <Link href={`/admin/payouts/${it.entity_id}`} className="text-brand-600 hover:underline">
                            <Mono>{shortId(it.entity_id, 8)}</Mono>
                          </Link>
                        ) : (
                          <Mono>{shortId(it.entity_id, 8)}</Mono>
                        )}
                      </td>
                      <td className="num">{formatMoney(it.amount, s.currency, { sign: true })}</td>
                      <td className="num text-ink-500">{formatMoney(it.fee_amount, s.currency)}</td>
                      <td className="text-ink-500">{formatDateTime(it.occurred_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="No items" description="The provider report did not include individual transactions." />
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Provider">
            <DescriptionList
              cols={1}
              items={[
                { label: "Provider", value: s.provider_name ?? "—" },
                { label: "Provider account", value: s.provider_account_name ?? "—" },
                { label: "Provider account id", value: <Mono>{s.provider_account_id}</Mono> },
                { label: "Settlement entity", value: s.settlement_entity ?? "—" },
              ]}
            />
            <div className="mt-4 text-[13px]">
              <Link href={`/admin/settlements?provider_account_id=${s.provider_account_id}`} className="text-brand-600 hover:underline">
                All settlements of this account
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

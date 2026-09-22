import Link from "next/link";
import { notFound } from "next/navigation";
import { PayoutActions } from "@/components/dashboard/create-payout";
import { Card, DescriptionList, Mono, PageHeader, StatusBadge } from "@/components/ui";
import { ApiRequestError } from "@/lib/api";
import { formatDateTime, formatDateTimeFull, formatMoney, titleCase } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { Payout } from "@/lib/types";

type Detail = Payout & { metadata?: Record<string, unknown>; updated_at?: string };

export default async function PayoutDetailPage({ params }: { params: { id: string } }) {
  const api = serverApi();
  let p: Detail;
  try {
    p = await api.get<Detail>(`/dashboard/payouts/${params.id}`);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) notFound();
    throw err;
  }

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/dashboard/payouts" className="hover:underline">
            Payouts
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <Mono className="text-[18px]">{p.id}</Mono>
            <StatusBadge status={p.status} />
            {p.mode === "test" ? <StatusBadge status="test" label="Sandbox" /> : null}
          </span>
        }
        subtitle={`${formatMoney(p.amount, p.currency)} · ${titleCase(p.destination.type)} · created ${formatDateTime(p.created_at)}`}
        actions={<PayoutActions payout={p} />}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Payout">
            <DescriptionList
              cols={3}
              items={[
                { label: "Amount", value: <span className="font-medium">{formatMoney(p.amount, p.currency)}</span> },
                { label: "Fee (provider)", value: formatMoney(p.fee.amount, p.fee.currency) },
                { label: "Status", value: <StatusBadge status={p.status} /> },
                { label: "Destination", value: p.destination.display },
                { label: "Destination type", value: titleCase(p.destination.type) },
                { label: "Holder name", value: p.destination.holder_name ?? "—" },
                { label: "Country", value: p.destination.country ?? "—" },
                { label: "Reference", value: p.reference ?? "—" },
                { label: "Description", value: p.description ?? "—" },
                { label: "Created", value: formatDateTimeFull(p.created_at) },
                { label: "Processed", value: formatDateTimeFull(p.processed_at) },
                { label: "Mode", value: p.mode === "test" ? "Sandbox" : "Live" },
              ]}
            />
            {p.failure ? (
              <div className="mt-4 rounded-md border border-bad/20 bg-bad-bg px-3 py-2 text-[13px] text-bad">
                <span className="font-medium">{p.failure.code}</span> · {p.failure.message} <span className="text-[11px] uppercase tracking-wide">({p.failure.category})</span>
              </div>
            ) : null}
          </Card>

          <Card title="Route" description="Provider account selected by routing to execute this transfer">
            <DescriptionList
              cols={3}
              items={[
                { label: "Provider", value: p.route.provider_name ?? "—" },
                { label: "Provider account", value: p.route.provider_account_name ?? "—" },
                { label: "Provider payout id", value: p.route.provider_payout_id ? <Mono>{p.route.provider_payout_id}</Mono> : "—" },
                { label: "Provider id", value: p.route.provider_id ? <Mono>{p.route.provider_id}</Mono> : "—" },
                { label: "Provider account id", value: p.route.provider_account_id ? <Mono>{p.route.provider_account_id}</Mono> : "—" },
                { label: "Routing decision", value: p.route.routing_decision_id ? <Mono>{p.route.routing_decision_id}</Mono> : "—" },
              ]}
            />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Ledger">
            <p className="text-[13px] text-ink-600">
              Successful and failed payouts are recorded as transactions of type <Mono>payout</Mono>.{" "}
              <Link href={`/dashboard/transactions?search=${encodeURIComponent(p.id)}`} className="font-medium text-brand-600 hover:underline">
                View ledger entries
              </Link>
            </p>
          </Card>
          {Object.keys(p.metadata ?? {}).length ? (
            <Card title="Metadata">
              <pre className="mono whitespace-pre-wrap text-ink-700">{JSON.stringify(p.metadata, null, 2)}</pre>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

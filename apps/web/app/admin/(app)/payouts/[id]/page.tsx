import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, DescriptionList, Mono, PageHeader, StatusBadge } from "@/components/ui";
import { ApiRequestError } from "@/lib/api";
import { formatDateTime, formatMoney, titleCase } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { Payout } from "@/lib/types";

type Detail = Payout & { metadata?: Record<string, unknown> };

export default async function AdminPayoutDetailPage({ params }: { params: { id: string } }) {
  const api = serverApi();
  let p: Detail;
  try {
    p = await api.get<Detail>(`/admin/payouts/${params.id}`);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) notFound();
    throw err;
  }

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/admin/payouts" className="hover:underline">
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
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Payout">
            <DescriptionList
              cols={3}
              items={[
                { label: "Amount", value: <span className="font-medium">{formatMoney(p.amount, p.currency)}</span> },
                { label: "Fee (provider)", value: formatMoney(p.fee.amount, p.currency) },
                { label: "Reference", value: p.reference ?? "—" },
                { label: "Description", value: p.description ?? "—" },
                { label: "Processed", value: formatDateTime(p.processed_at) },
                { label: "Created", value: formatDateTime(p.created_at) },
              ]}
            />
            {p.failure ? (
              <div className="mt-4 rounded-md border border-bad/20 bg-bad-bg px-3 py-2 text-[13px] text-bad">
                <span className="font-medium">{p.failure.code}</span> · {p.failure.message} <span className="text-[11px] uppercase tracking-wide">({p.failure.category})</span>
              </div>
            ) : null}
          </Card>
          <Card title="Destination" description="Beneficiary details are tokenised by the provider; only masked values are stored">
            <DescriptionList
              cols={3}
              items={[
                { label: "Type", value: titleCase(p.destination.type) },
                { label: "Display", value: p.destination.display },
                { label: "Holder", value: p.destination.holder_name ?? "—" },
                { label: "Country", value: p.destination.country ?? "—" },
              ]}
            />
          </Card>
          <Card title="Route">
            <DescriptionList
              cols={3}
              items={[
                { label: "Provider", value: p.route.provider_name ?? "—" },
                { label: "Provider account", value: p.route.provider_account_name ?? "—" },
                { label: "Provider payout id", value: p.route.provider_payout_id ? <Mono>{p.route.provider_payout_id}</Mono> : "—" },
                { label: "Routing decision", value: p.route.routing_decision_id ? <Mono>{p.route.routing_decision_id}</Mono> : "—" },
              ]}
            />
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Related">
            <ul className="space-y-1 text-[13px]">
              <li>
                <Link href={`/admin/transactions?search=${p.id}`} className="text-brand-600 hover:underline">Ledger transactions</Link>
              </li>
              <li>
                <Link href={`/admin/audit?entity_id=${p.id}`} className="text-brand-600 hover:underline">Audit entries</Link>
              </li>
            </ul>
          </Card>
          {p.metadata && Object.keys(p.metadata).length ? (
            <Card title="Metadata">
              <pre className="mono whitespace-pre-wrap text-ink-700">{JSON.stringify(p.metadata, null, 2)}</pre>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

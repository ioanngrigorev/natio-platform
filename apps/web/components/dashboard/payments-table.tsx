import Link from "next/link";
import { EmptyState, Mono, StatusBadge, Table } from "@/components/ui";
import { formatDateTime, formatMoney, formatMs, shortId, titleCase } from "@/lib/format";
import type { Payment } from "@/lib/types";

export function PaymentsTable({ payments, hrefBase, showMerchant }: { payments: Array<Payment & { merchant?: { id: string; name: string } | null }>; hrefBase: string; showMerchant?: boolean }) {
  if (!payments.length) return <EmptyState title="No payments" description="Payments created through the API or the sandbox will appear here." />;
  return (
    <Table>
      <thead>
        <tr>
          <th>Payment</th>
          <th>Status</th>
          <th className="num">Amount</th>
          <th>Method</th>
          <th>Country</th>
          <th>Provider</th>
          <th className="num">Attempts</th>
          <th className="num">Time</th>
          <th>Error</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {payments.map((p) => (
          <tr key={p.id}>
            <td>
              <Link href={`${hrefBase}/${p.id}`} className="font-medium text-brand-600 hover:underline">
                <Mono>{shortId(p.id, 10)}</Mono>
              </Link>
              {p.reference ? <div className="text-[11px] text-ink-500">{p.reference}</div> : null}
            </td>
            <td>
              <StatusBadge status={p.status} />
            </td>
            <td className="num font-medium">{formatMoney(p.amount, p.currency)}</td>
            <td>{titleCase(p.payment_method.type)}</td>
            <td>{p.country ?? "—"}</td>
            <td>
              {p.route.provider?.name ?? <span className="text-ink-400">—</span>}
              {p.route.provider_account_name ? <div className="text-[11px] text-ink-500">{p.route.provider_account_name}</div> : null}
            </td>
            <td className="num">{p.route.attempts}</td>
            <td className="num">{formatMs(p.processing_time_ms)}</td>
            <td>{p.failure ? <Mono className="text-bad">{p.failure.code}</Mono> : <span className="text-ink-400">—</span>}</td>
            <td className="text-ink-500">{formatDateTime(p.created_at)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

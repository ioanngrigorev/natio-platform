import Link from "next/link";
import { EmptyState, Mono, StatusBadge, Table } from "@/components/ui";
import { formatDateTime, formatMoney, formatMs, shortId, titleCase } from "@/lib/format";
import type { Transaction } from "@/lib/types";

export function TransactionsTable({ transactions, paymentHrefBase = "/dashboard/payments" }: { transactions: Transaction[]; paymentHrefBase?: string }) {
  if (!transactions.length) return <EmptyState title="No transactions" description="Ledger entries are recorded for every payment, refund and payout processed through NATIO." />;
  return (
    <Table>
      <thead>
        <tr>
          <th>Transaction</th>
          <th>Payment</th>
          <th>Date</th>
          <th>Type</th>
          <th className="num">Amount</th>
          <th>Currency</th>
          <th>Country</th>
          <th>Method</th>
          <th>Provider</th>
          <th>Status</th>
          <th className="num">Time</th>
          <th className="num">Fee</th>
          <th className="num">Net</th>
          <th>Error</th>
          <th>Settlement</th>
        </tr>
      </thead>
      <tbody>
        {transactions.map((t) => (
          <tr key={t.id}>
            <td>
              <Mono>{shortId(t.id, 10)}</Mono>
              {t.provider_reference ? <div className="text-[11px] text-ink-500">{t.provider_reference}</div> : null}
            </td>
            <td>
              {t.payment_id ? (
                <Link href={`${paymentHrefBase}/${t.payment_id}`} className="font-medium text-brand-600 hover:underline">
                  <Mono>{shortId(t.payment_id, 8)}</Mono>
                </Link>
              ) : (
                <Mono className="text-ink-500">{shortId(t.entity_id, 8)}</Mono>
              )}
            </td>
            <td className="text-ink-500">{formatDateTime(t.occurred_at)}</td>
            <td>{titleCase(t.type)}</td>
            <td className={"num font-medium " + (t.amount < 0 ? "text-ink-700" : "")}>{formatMoney(t.amount, t.currency, { sign: true })}</td>
            <td>{t.currency}</td>
            <td>{t.country ?? "—"}</td>
            <td>{t.payment_method ? titleCase(t.payment_method) : "—"}</td>
            <td>
              {t.provider_name ?? <span className="text-ink-400">—</span>}
              {t.provider_account_name ? <div className="text-[11px] text-ink-500">{t.provider_account_name}</div> : null}
            </td>
            <td>
              <StatusBadge status={t.status} />
            </td>
            <td className="num">{formatMs(t.processing_time_ms)}</td>
            <td className="num">{formatMoney(t.fee_amount, t.currency)}</td>
            <td className="num">{formatMoney(t.net_amount, t.currency, { sign: true })}</td>
            <td>{t.failure_code ? <Mono className="text-bad">{t.failure_code}</Mono> : <span className="text-ink-400">—</span>}</td>
            <td>
              {t.settlement_id ? (
                <Link href={`/dashboard/settlements/${t.settlement_id}`} className="text-brand-600 hover:underline">
                  <Mono>{shortId(t.settlement_id, 8)}</Mono>
                </Link>
              ) : (
                <span className="text-ink-400">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

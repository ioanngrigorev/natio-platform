"use client";
import {useI18n} from '@/lib/i18n/provider';

import Link from "next/link";
import { EmptyState, Mono, StatusBadge, Table } from "@/components/ui";
import { formatDateTime, formatMoney, formatMs, shortId, titleCase } from "@/lib/format";
import type { Transaction } from "@/lib/types";

export function TransactionsTable({ transactions, paymentHrefBase = "/dashboard/payments" }: { transactions: Transaction[]; paymentHrefBase?: string }) {
 const {t:translateUi,locale:uiLocale}=useI18n();

  if (!transactions.length) return <EmptyState title={translateUi("No transactions")} description={translateUi("Ledger entries are recorded for every payment, refund and payout processed through NATIO.")} />;
  return (
    <Table>
      <thead>
        <tr>
          <th>{translateUi("Transaction")}</th>
          <th>{translateUi("Payment")}</th>
          <th>{translateUi("Date")}</th>
          <th>{translateUi("Type")}</th>
          <th className="num">{translateUi("Amount")}</th>
          <th>{translateUi("Currency")}</th>
          <th>{translateUi("Country")}</th>
          <th>{translateUi("Method")}</th>
          <th>{translateUi("Provider")}</th>
          <th>{translateUi("Status")}</th>
          <th className="num">{translateUi("Time")}</th>
          <th className="num">{translateUi("Fee")}</th>
          <th className="num">{translateUi("Net")}</th>
          <th>{translateUi("Error")}</th>
          <th>{translateUi("Settlement")}</th>
        </tr>
      </thead>
      <tbody>
        {translateUi(transactions.map((t) => (
          <tr key={t.id}>
            <td>
              <Mono>{translateUi(shortId(t.id, 10))}</Mono>
              {translateUi(t.provider_reference ? <div className="text-[11px] text-ink-500">{translateUi(t.provider_reference)}</div> : null)}
            </td>
            <td>
              {translateUi(t.payment_id ? (
                <Link href={`${paymentHrefBase}/${t.payment_id}`} className="font-medium text-brand-600 hover:underline">
                  <Mono>{translateUi(shortId(t.payment_id, 8))}</Mono>
                </Link>
              ) : (
                <Mono className="text-ink-500">{translateUi(shortId(t.entity_id, 8))}</Mono>
              ))}
            </td>
            <td className="text-ink-500">{translateUi(formatDateTime(t.occurred_at))}</td>
            <td>{translateUi(titleCase(t.type))}</td>
            <td className={"num font-medium " + (t.amount < 0 ? "text-ink-700" : "")}>{translateUi(formatMoney(t.amount, t.currency, { sign: true }))}</td>
            <td>{translateUi(t.currency)}</td>
            <td>{translateUi(t.country ?? "—")}</td>
            <td>{translateUi(t.payment_method ? titleCase(t.payment_method) : "—")}</td>
            <td>
              {translateUi(t.provider_name ?? <span className="text-ink-400">—</span>)}
              {translateUi(t.provider_account_name ? <div className="text-[11px] text-ink-500">{translateUi(t.provider_account_name)}</div> : null)}
            </td>
            <td>
              <StatusBadge status={t.status} />
            </td>
            <td className="num">{translateUi(formatMs(t.processing_time_ms))}</td>
            <td className="num">{translateUi(formatMoney(t.fee_amount, t.currency))}</td>
            <td className="num">{translateUi(formatMoney(t.net_amount, t.currency, { sign: true }))}</td>
            <td>{translateUi(t.failure_code ? <Mono className="text-bad">{translateUi(t.failure_code)}</Mono> : <span className="text-ink-400">—</span>)}</td>
            <td>
              {translateUi(t.settlement_id ? (
                <Link href={`/dashboard/settlements/${t.settlement_id}`} className="text-brand-600 hover:underline">
                  <Mono>{translateUi(shortId(t.settlement_id, 8))}</Mono>
                </Link>
              ) : (
                <span className="text-ink-400">—</span>
              ))}
            </td>
          </tr>
        )))}
      </tbody>
    </Table>
  );
}

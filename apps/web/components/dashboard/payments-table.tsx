"use client";
import {useI18n} from '@/lib/i18n/provider';

import { EntityLink } from "@/components/admin/entity-link";
import Link from "next/link";
import { EmptyState, Mono, StatusBadge, Table } from "@/components/ui";
import { formatDateTime, formatMoney, formatMs, shortId, titleCase } from "@/lib/format";
import type { Payment } from "@/lib/types";

export function PaymentsTable({ payments, hrefBase, showMerchant }: { payments: Array<Payment & { merchant?: { id: string; name: string } | null }>; hrefBase: string; showMerchant?: boolean }) {
 const {t:translateUi,locale:uiLocale}=useI18n();

  if (!payments.length) return <EmptyState title={translateUi("No payments")} description={translateUi("Payments created through the API or the sandbox will appear here.")} />;
  return (
    <Table>
      <thead>
        <tr>
          <th>{translateUi("Payment")}</th>
          <th>{translateUi("Status")}</th>
          <th className="num">{translateUi("Amount")}</th>
          <th>{translateUi("Method")}</th>
          <th>{translateUi("Country")}</th>
          <th>{translateUi("Provider")}</th>
          <th className="num">{translateUi("Attempts")}</th>
          <th className="num">{translateUi("Time")}</th>
          <th>{translateUi("Error")}</th>
          <th>{translateUi("Created")}</th>
        </tr>
      </thead>
      <tbody>
        {translateUi(payments.map((p) => (
          <tr key={p.id}>
            <td>
              <Link href={`${hrefBase}/${p.id}`} className="font-medium text-brand-600 hover:underline">
                <Mono>{translateUi(shortId(p.id, 10))}</Mono>
              </Link>
              {translateUi(p.reference ? <div className="text-[11px] text-ink-500">{p.reference}</div> : null)}
            </td>
            <td>
              <StatusBadge status={p.status} />
            </td>
            <td className="num font-medium">{translateUi(formatMoney(p.amount, p.currency))}</td>
            <td>{translateUi(titleCase(p.payment_method.type))}</td>
            <td>{translateUi(p.country ?? "—")}</td>
            <td>
              {translateUi(hrefBase.startsWith("/admin") ? <EntityLink kind="providers" id={p.route.provider?.id}>{p.route.provider?.name}</EntityLink> : p.route.provider?.name ?? "—")}
              {translateUi(p.route.provider_account_name ? <div className="text-[11px] text-ink-500">{translateUi(hrefBase.startsWith("/admin") ? <EntityLink kind="provider-accounts" id={p.route.provider_account_id}>{translateUi(p.route.provider_account_name)}</EntityLink> : p.route.provider_account_name)}</div> : null)}
            </td>
            <td className="num">{translateUi(p.route.attempts)}</td>
            <td className="num">{translateUi(formatMs(p.processing_time_ms))}</td>
            <td>{translateUi(p.failure ? <Mono className="text-bad">{translateUi(p.failure.code)}</Mono> : <span className="text-ink-400">—</span>)}</td>
            <td className="text-ink-500">{translateUi(formatDateTime(p.created_at))}</td>
          </tr>
        )))}
      </tbody>
    </Table>
  );
}

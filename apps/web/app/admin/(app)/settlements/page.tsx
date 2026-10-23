
import {getI18n} from '@/lib/i18n/server';
import { EntityLink } from "@/components/admin/entity-link";
import Link from "next/link";
import { ImportSettlement, type AccountOption } from "@/components/admin/settlement-actions";
import { FilterBar } from "@/components/dashboard/filters";
import { Alert, Card, EmptyState, Mono, PageHeader, StatusBadge, Table } from "@/components/ui";
import { qs } from "@/lib/api";
import { formatDate, formatDateTime, formatMoney, formatNumber, shortId, titleCase } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { AdminMerchant } from "@/lib/admin-types";
import type { Provider, Settlement } from "@/lib/types";

export const metadata = { title: "Settlements" };

const STATUSES = ["pending", "settled", "failed"];

export default async function AdminSettlementsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
 const {t:translateUi,locale:uiLocale}=getI18n();

  const api = serverApi();
  const query = qs({ merchant_id: searchParams.merchant_id, provider_account_id: searchParams.provider_account_id, status: searchParams.status, limit: 200 });
  const [settlements, merchants, providers] = await Promise.all([
    api.get<{ data: Settlement[] }>(`/admin/settlements${query}`),
    api.get<{ data: AdminMerchant[] }>("/admin/merchants?fields=options&limit=500"),
    api.get<{ data: Provider[] }>("/admin/providers"),
  ]);
  const accounts: AccountOption[] = providers.data.flatMap((p) => p.accounts.map((a) => ({ id: a.id, name: a.name, provider: p.name, mode: a.mode })));
  const merchantList = merchants.data.map((m) => ({ id: m.id, name: m.name }));

  return (
    <>
      <PageHeader
        title={translateUi("Settlements")}
        subtitle={translateUi(`What providers reported as settled per merchant, account, currency and period · ${api.mode} mode.`)}
        actions={<ImportSettlement merchants={merchantList} accounts={accounts.filter((a) => a.mode === api.mode)} />}
      />

      <div className="mb-4">
        <Alert tone="info">{translateUi("Funds are held and settled by licensed providers. NATIO records the providers' settlement reports and never holds merchant funds.")}</Alert>
      </div>

      <FilterBar
        filters={[
          { name: "merchant_id", label: "Merchant", type: "select", options: merchantList.map((m) => ({ value: m.id, label: m.name })) },
          { name: "provider_account_id", label: "Provider account", type: "select", options: accounts.filter((a) => a.mode === api.mode).map((a) => ({ value: a.id, label: `${a.provider} — ${a.name}` })) },
          { name: "status", label: "Status", type: "select", options: STATUSES.map((s) => ({ value: s, label: s })) },
        ]}
      />

      <Card padded={false}>
        {translateUi(settlements.data.length ? (
          <Table>
            <thead>
              <tr>
                <th>{translateUi("Settlement")}</th>
                <th>{translateUi("Provider")}</th>
                <th>{translateUi("Settlement entity")}</th>
                <th>{translateUi("Reference")}</th>
                <th>{translateUi("Period")}</th>
                <th className="num">{translateUi("Gross")}</th>
                <th className="num">{translateUi("Fees")}</th>
                <th className="num">{translateUi("Net")}</th>
                <th className="num">{translateUi("Transactions")}</th>
                <th>{translateUi("Status")}</th>
                <th>{translateUi("Settled at")}</th>
              </tr>
            </thead>
            <tbody>
              {translateUi(settlements.data.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/admin/settlements/${s.id}`} className="font-medium text-brand-600 hover:underline">
                      <Mono>{translateUi(shortId(s.id, 10))}</Mono>
                    </Link>
                    <div className="text-[11px] text-ink-500">{translateUi(titleCase(s.source))}</div>
                  </td>
                  <td>
                    <EntityLink kind="provider-accounts" id={s.provider_account_id}>{translateUi(s.provider_name)}</EntityLink>
                    {translateUi(s.provider_account_name ? <div className="text-[11px] text-ink-500"><EntityLink kind="provider-accounts" id={s.provider_account_id}>{translateUi(s.provider_account_name)}</EntityLink></div> : null)}
                  </td>
                  <td className="max-w-[220px] truncate text-ink-600">{translateUi(s.settlement_entity ?? "—")}</td>
                  <td>{translateUi(s.settlement_reference ? <Mono>{translateUi(s.settlement_reference)}</Mono> : "—")}</td>
                  <td className="text-ink-600">
                    {translateUi(formatDate(s.period_start))} – {translateUi(formatDate(s.period_end))}
                  </td>
                  <td className="num">{translateUi(formatMoney(s.gross_amount, s.currency))}</td>
                  <td className="num text-ink-500">{translateUi(formatMoney(-s.fee_amount, s.currency))}</td>
                  <td className="num font-medium">{translateUi(formatMoney(s.net_amount, s.currency))}</td>
                  <td className="num">{translateUi(formatNumber(s.transaction_count))}</td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="text-ink-500">{translateUi(formatDateTime(s.settled_at))}</td>
                </tr>
              )))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={translateUi("No settlements")} description={translateUi("Import a provider settlement report to record what a provider paid out for a period, or adjust the filters.")} />
        ))}
      </Card>
    </>
  );
}

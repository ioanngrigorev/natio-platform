
import {getI18n} from '@/lib/i18n/server';
import Link from "next/link";
import { LevelTag } from "@/components/admin/condition-chips";
import { FilterBar } from "@/components/dashboard/filters";
import { Card, EmptyState, Mono, PageHeader, Table } from "@/components/ui";
import { qs } from "@/lib/api";
import { formatDateTime, shortId } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { SystemEvent } from "@/lib/admin-types";

export const metadata = { title: "System events" };

const LEVELS = ["info", "warning", "error"];
const SOURCES = ["admin", "orchestrator", "provider", "worker", "webhook", "csv"];

export default async function SystemEventsPage({ searchParams }: { searchParams: { level?: string; source?: string } }) {
 const {t:translateUi,locale:uiLocale}=getI18n();

  const api = serverApi();
  const { data } = await api.get<{ data: SystemEvent[] }>(`/admin/system-events${qs({ level: searchParams.level, source: searchParams.source, limit: 200 })}`);

  return (
    <>
      <PageHeader title={translateUi("System events")} subtitle={translateUi("Platform events emitted by providers, the orchestrator, background workers and admin actions. Merchant-visible activity lives in the audit log.")} />

      <FilterBar
        filters={[
          { name: "level", label: "Level", type: "select", options: LEVELS.map((l) => ({ value: l, label: l })) },
          { name: "source", label: "Source", type: "select", options: SOURCES.map((s) => ({ value: s, label: s })) },
        ]}
      />

      <Card padded={false}>
        {translateUi(data.length ? (
          <Table>
            <thead>
              <tr>
                <th>{translateUi("Time")}</th>
                <th>{translateUi("Level")}</th>
                <th>{translateUi("Source")}</th>
                <th>{translateUi("Type")}</th>
                <th>{translateUi("Message")}</th>
                <th>{translateUi("Provider account")}</th>
                <th>{translateUi("Merchant")}</th>
              </tr>
            </thead>
            <tbody>
              {translateUi(data.map((e) => (
                <tr key={e.id}>
                  <td className="text-ink-500">{translateUi(formatDateTime(e.createdAt))}</td>
                  <td>
                    <LevelTag level={e.level} />
                  </td>
                  <td>{translateUi(e.source)}</td>
                  <td>
                    <Mono>{translateUi(e.type)}</Mono>
                  </td>
                  <td className="max-w-[560px] truncate text-ink-700" title={translateUi(e.message)}>
                    {translateUi(e.message)}
                  </td>
                  <td>
                    {translateUi(e.providerAccountId ? (
                      <Link href="/admin/providers" className="text-brand-600 hover:underline">
                        <Mono>{translateUi(shortId(e.providerAccountId, 10))}</Mono>
                      </Link>
                    ) : (
                      <span className="text-ink-400">—</span>
                    ))}
                  </td>
                  <td>
                    {translateUi(e.merchantId ? (
                      <Link href={`/admin/merchants/${e.merchantId}`} className="text-brand-600 hover:underline">
                        <Mono>{translateUi(shortId(e.merchantId, 10))}</Mono>
                      </Link>
                    ) : (
                      <span className="text-ink-400">—</span>
                    ))}
                  </td>
                </tr>
              )))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={translateUi("No system events")} description={translateUi(searchParams.level || searchParams.source ? translateUi("No events match these filters.") : translateUi("Events appear as providers are called, health checks run and admins act."))} />
        ))}
      </Card>
      <p className="mt-2 text-[11px] text-ink-400">{translateUi("Showing the 200 most recent events.")}</p>
    </>
  );
}

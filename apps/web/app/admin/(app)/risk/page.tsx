
import {getI18n} from '@/lib/i18n/server';
import Link from "next/link";
import { ConditionChips } from "@/components/admin/condition-chips";
import { CreateRiskRule, RiskRuleControls } from "@/components/admin/risk-rule-actions";
import { QuerySelect } from "@/components/dashboard/filters";
import { Card, EmptyState, Mono, PageHeader, StatusBadge, Table, Tag } from "@/components/ui";
import { qs } from "@/lib/api";
import { formatDateTime, formatNumber, shortId } from "@/lib/format";
import { serverApi } from "@/lib/session";
import type { AdminMerchant, RiskDecision } from "@/lib/admin-types";
import type { RiskRule } from "@/lib/types";

export const metadata = { title: "Risk rules" };

export default async function RiskPage(props: { searchParams: Promise<{ decision?: string }> }) {
  const searchParams = await props.searchParams;
  const {t:translateUi,locale:uiLocale}=(await getI18n());

  const api = (await serverApi());
  const [rules, merchants, decisions] = await Promise.all([
    api.get<{ data: RiskRule[] }>(`/admin/risk/rules?mode=${api.mode}`),
    api.get<{ data: AdminMerchant[] }>("/admin/merchants?fields=options&limit=500"),
    api.get<{ data: RiskDecision[] }>(`/admin/risk/decisions${qs({ decision: searchParams.decision })}`),
  ]);
  const merchantList = merchants.data.map((m) => ({ id: m.id, name: m.name }));
  const merchantName = new Map(merchantList.map((m) => [m.id, m.name]));
  const sorted = [...rules.data].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title={translateUi("Risk rules")}
        subtitle={translateUi(`Pre-authorisation screening in ${api.mode} mode. Every payment is scored before routing; a blocking rule declines it, a review rule holds it for a manual decision.`)}
        actions={<CreateRiskRule merchants={merchantList} />}
      />

      <Card padded={false} title={translateUi("Rules")} description={translateUi("Evaluated lowest priority number first; matched scores add up")}>
        {translateUi(sorted.length ? (
          <Table>
            <thead>
              <tr>
                <th className="num">{translateUi("Priority")}</th>
                <th>{translateUi("Rule")}</th>
                <th>{translateUi("Scope")}</th>
                <th>{translateUi("Conditions")}</th>
                <th>{translateUi("Action")}</th>
                <th className="num">{translateUi("Score")}</th>
                <th>{translateUi("Enabled")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {translateUi(sorted.map((r) => (
                <tr key={r.id} className={r.enabled ? undefined : "opacity-60"}>
                  <td className="num">{translateUi(r.priority)}</td>
                  <td>
                    <div className="font-medium">{r.name}</div>
                    <div className="max-w-[320px] truncate text-[11px] text-ink-500" title={translateUi(r.description ?? undefined)}>
                      {translateUi(r.description ?? <Mono className="text-[11px]">{r.id}</Mono>)}
                    </div>
                  </td>
                  <td>{translateUi(r.merchantId ? <Tag tone="brand">{translateUi(merchantName.get(r.merchantId) ?? r.merchantId)}</Tag> : <span className="text-ink-500">{translateUi("Global")}</span>)}</td>
                  <td className="!whitespace-normal">
                    <ConditionChips conditions={r.conditions} className="max-w-[380px]" />
                  </td>
                  <td>
                    <StatusBadge status={r.action} />
                  </td>
                  <td className="num">{translateUi(r.score)}</td>
                  <RiskRuleControls rule={r} merchants={merchantList} />
                </tr>
              )))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={translateUi(`No risk rules in ${api.mode} mode`)} description={translateUi("Without rules every payment is allowed through with score 0.")} />
        ))}
      </Card>

      <Card
        title={translateUi("Recent risk decisions")}
        description={translateUi("The outcome the engine recorded for each screened payment")}
        className="mt-6"
        padded={false}
        actions={<QuerySelect name="decision" label={translateUi("Decision")} current={searchParams.decision} options={[{ value: "allow", label: "allow" }, { value: "review", label: "review" }, { value: "block", label: "block" }]} />}
      >
        {translateUi(decisions.data.length ? (
          <Table>
            <thead>
              <tr>
                <th>{translateUi("Time")}</th>
                <th>{translateUi("Payment")}</th>
                <th>{translateUi("Decision")}</th>
                <th className="num">{translateUi("Score")}</th>
                <th>{translateUi("Matched rules")}</th>
                <th>{translateUi("Reviewed")}</th>
              </tr>
            </thead>
            <tbody>
              {translateUi(decisions.data.map((d) => (
                <tr key={d.id}>
                  <td className="text-ink-500">{translateUi(formatDateTime(d.createdAt))}</td>
                  <td>
                    <Link href={`/admin/payments/${d.paymentId}`} className="text-brand-600 hover:underline">
                      <Mono>{translateUi(shortId(d.paymentId, 10))}</Mono>
                    </Link>
                  </td>
                  <td>
                    <StatusBadge status={d.decision} />
                  </td>
                  <td className="num">{translateUi(formatNumber(d.score))}</td>
                  <td className="!whitespace-normal">
                    {translateUi(d.matchedRules.length ? (
                      <span className="flex flex-wrap gap-1">
                        {translateUi(d.matchedRules.map((m) => (
                          <Tag key={m.id} tone={m.action === "block" ? "bad" : m.action === "review" ? "warn" : "neutral"}>
                            {m.name} +{translateUi(m.score)}
                          </Tag>
                        )))}
                      </span>
                    ) : (
                      <span className="text-ink-400">{translateUi("no rule matched")}</span>
                    ))}
                  </td>
                  <td className="text-ink-500">{translateUi(d.reviewedAt ? `${d.reviewOutcome ?? "reviewed"} · ${formatDateTime(d.reviewedAt)}` : "—")}</td>
                </tr>
              )))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={translateUi("No risk decisions")} description={translateUi(searchParams.decision ? `No payment was ${searchParams.decision}ed yet.` : translateUi("Decisions appear as soon as payments are screened."))} />
        ))}
      </Card>
    </>
  );
}

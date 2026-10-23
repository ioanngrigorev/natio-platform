"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { parsePolicyPreview } from "./strategy-types";
import { useState } from "react";
import { errorMessage, useSession } from "@/components/session-provider";
import { Alert, Button, Card, Field, Table, Tag } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { RoutingPolicyEditor } from "./routing-policy";
import { QuoteSummary } from "./pricing-center";
import type { Policy, Quote } from "./strategy-types";
type Result = {
  amount: number;
  currency: string;
  rule: { id: string; name: string } | null;
  strategy: string;
  reason: string;
  policy: Policy;
  preview_override: boolean;
  retry_policy: { maxAttempts: number; maxElapsedMs: number };
  cascade: { retry: boolean; reason: string; failure: string };
  total_candidates: number;
  eligible_candidates: number;
  exclusion_reasons: Record<string,number>;
  ordered: {
    provider_account_id: string;
    provider_id: string;
    provider: string;
    account: string;
    pricing?: Quote;
  }[];
  candidates: {
    providerAccountId: string;
    providerId: string;
    providerName: string;
    accountName: string;
    eligible: boolean;
    score: number;
    reasons: string[];
    factors?: Record<string, number>;
  }[];
};
export function RoutingStudio({
  merchants,
}: {
  merchants: { id: string; name: string }[];
}) {
  const s = useSession();
  const params=useSearchParams(), preview=parsePolicyPreview(params.get("preview"));
  const [form, setForm] = useState({
      merchant_id: merchants.find(m=>m.id===params.get("merchant_id"))?.id ?? merchants[0]?.id ?? "",
      amount: "10000",
      currency: "EUR",
      country: "DE",
      payment_method: "card",
      failure: "technical_error",
    }),
    [policy, setPolicy] = useState<Policy>(preview ?? {
      profile: "balanced",
      maxAttempts: 2,
      maxElapsedMs: 30000,
      minSamples: 20,
    }),
    [override, setOverride] = useState(!!preview),
    [result, setResult] = useState<Result | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const n = Number(form.amount);
      if (!Number.isSafeInteger(n) || n <= 0)
        throw new Error("Enter a positive amount in minor units");
      setResult(
        await s.api<Result>("/admin/routing/simulate", {
          body: {
            ...form,
            amount: n,
            country: form.country || undefined,
            mode: s.mode,
            policy: override ? policy : undefined,
            strategy: override ? "score" : undefined,
          },
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <Card
        title="Decision workspace"
        description="The same eligibility, tariff and ranking engines used by payment execution. This simulation creates no payment and calls no PSP."
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Merchant" htmlFor="studio-merchant">
            <select
              id="studio-merchant"
              className="input"
              value={form.merchant_id}
              onChange={(e) =>
                setForm({ ...form, merchant_id: e.target.value })
              }
            >
              {merchants.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          {(
            [
              ["amount", "Payment amount (minor)"],
              ["currency", "Currency"],
              ["country", "Country (optional)"],
            ] as const
          ).map(([k, l]) => (
            <Field key={k} label={l} htmlFor={`studio-${k}`}>
              <input
                id={`studio-${k}`}
                className="input"
                type={k === "amount" ? "number" : "text"}
                value={form[k]}
                onChange={(e) =>
                  setForm({
                    ...form,
                    [k]:
                      k === "amount"
                        ? e.target.value
                        : e.target.value.toUpperCase(),
                  })
                }
              />
            </Field>
          ))}
          <Field label="Method" htmlFor="studio-method">
            <select
              id="studio-method"
              className="input"
              value={form.payment_method}
              onChange={(e) =>
                setForm({ ...form, payment_method: e.target.value })
              }
            >
              {[
                "card",
                "bank_transfer",
                "qr",
                "wallet",
                "open_banking",
                "instant",
                "local",
                "crypto",
              ].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="First attempt outcome" htmlFor="studio-failure">
            <select
              id="studio-failure"
              className="input"
              value={form.failure}
              onChange={(e) => setForm({ ...form, failure: e.target.value })}
            >
              {Object.entries({
                technical_error: "Technical error · no charge",
                issuer_unavailable: "Issuer unavailable",
                insufficient_funds: "Insufficient funds",
                stolen_card: "Hard decline",
                authentication_required: "Customer authentication",
                timeout_unknown: "Timeout · unknown result",
                timeout_safe: "Timeout · confirmed no charge",
              }).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <label className="my-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={override}
            onChange={(e) => setOverride(e.target.checked)}
          />
          Preview score ranking & cascade policy (does not save a rule)
        </label>
        {override && (
          <RoutingPolicyEditor value={policy} onChange={setPolicy} />
        )}
        <div className="mt-4 flex gap-3">
          <Button
            variant="primary"
            loading={busy}
            onClick={() => void run()}
            disabled={!form.merchant_id}
          >
            Evaluate route & cascade
          </Button>
          <Link
            href="/admin/routing/new"
            className="self-center text-sm text-brand-600 hover:underline"
          >
            Create routing rule →
          </Link>
        </div>
      </Card>
      {error && <Alert tone="bad">{error}</Alert>}
      {result && (
        <>
          <Card
            title="Routing decision"
            description={`${formatMoney(result.amount, result.currency)} · ${result.reason}`}
          >
            <div className="flex flex-wrap gap-2">
              <Tag>{result.strategy}</Tag>
              <Tag>{result.policy.profile ?? "balanced"}</Tag>
              <Tag>
                {result.preview_override
                  ? "Unsaved preview"
                  : "Published rules"}
              </Tag>
              {result.rule && (
                <Link
                  className="text-brand-600 underline"
                  href={`/admin/routing/${result.rule.id}`}
                >
                  {result.rule.name}
                </Link>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              {result.ordered
                .slice(0, result.retry_policy.maxAttempts)
                .map((c, i) => (
                  <div
                    key={c.provider_account_id}
                    className="min-w-[220px] flex-1 rounded-xl border border-brand-200 p-4"
                  >
                    <p className="text-xs text-ink-500">
                      {i === 0
                        ? "PRIMARY · initial attempt"
                        : `FALLBACK ${i} · only after a safe failure`}
                    </p>
                    <Link
                      className="mt-2 block font-semibold text-brand-600 hover:underline"
                      href={`/admin/provider-accounts/${c.provider_account_id}`}
                    >
                      {c.account}
                    </Link>
                    <Link
                      className="text-xs text-ink-500 hover:underline"
                      href={`/admin/providers/${c.provider_id}`}
                    >
                      {c.provider}
                    </Link>
                    {c.pricing && (
                      <p className="mt-3 text-sm">
                        Cost{" "}
                        {formatMoney(
                          c.pricing.provider.amount,
                          c.pricing.currency,
                        )}{" "}
                        · margin{" "}
                        {formatMoney(c.pricing.margin, c.pricing.currency)}
                      </p>
                    )}
                  </div>
                ))}
            </div>
            {!result.ordered.length && (
              <Alert tone="warn">
                No eligible account. The payment would not be sent to a PSP.
              </Alert>
            )}
            <div className="mt-4 rounded-xl bg-ink-50 p-4">
              <div className="font-medium">
                {result.cascade.retry
                  ? "Continue to the next eligible PSP"
                  : "Stop this cascade"}
              </div>
              <p className="mt-1 text-sm text-ink-500">
                {result.cascade.reason.replaceAll("_", " ")} · up to{" "}
                {result.retry_policy.maxAttempts} attempts ·{" "}
                {result.retry_policy.maxElapsedMs / 1000}s budget
              </p>
              {result.ordered.length > 0 &&
                result.cascade.failure === "timeout_unknown" && (
                  <p className="mt-2 text-sm">
                    Payment remains processing. Reconcile the original operation
                    before considering another PSP.
                  </p>
                )}
            </div>
          </Card>
          {result.ordered[0]?.pricing && (
            <Card
              title="Economics of the first route"
              description="Applied tariff versions for this amount and currency"
            >
              <QuoteSummary quote={result.ordered[0].pricing} />
            </Card>
          )}
          <Card
            title="Eligibility & score evidence"
            description={`${result.total_candidates.toLocaleString()} accounts evaluated; ${result.eligible_candidates} eligible. Top ${result.candidates.length} shown. Scores never override eligibility or retry restrictions.`}
          >
            <div className="mb-3 flex flex-wrap gap-2">{Object.entries(result.exclusion_reasons??{}).map(([reason,count])=><Tag key={reason}>{reason.replaceAll("_"," ")}: {count.toLocaleString()}</Tag>)}</div>
            <Table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Eligibility</th>
                  <th>Score</th>
                  <th>PSP cost</th>
                  <th>Health sample</th>
                  <th>Reasons</th>
                </tr>
              </thead>
              <tbody>
                {result.candidates.map((c) => (
                  <tr key={c.providerAccountId}>
                    <td>
                      <Link
                        className="text-brand-600 hover:underline"
                        href={`/admin/provider-accounts/${c.providerAccountId}`}
                      >
                        {c.accountName}
                      </Link>
                    </td>
                    <td>
                      <Tag>{c.eligible ? "Eligible" : "Excluded"}</Tag>
                    </td>
                    <td>{c.score.toFixed(2)}</td>
                    <td>
                      {c.factors?.provider_cost != null
                        ? formatMoney(c.factors.provider_cost, result.currency)
                        : "—"}
                    </td>
                    <td>
                      {c.factors?.sample_size ?? 0}
                      {(c.factors?.sample_size ?? 0) < 5 ? " · prior" : ""}
                    </td>
                    <td className="!whitespace-normal">
                      {c.reasons.join(" · ") || "All requirements met"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
      <Card
        title="Cascade policy"
        description="Enforced by the backend for every payment attempt"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            [
              "Continue only with evidence",
              "Final no-charge technical failure or eligible issuer-unavailable response. Attempt and elapsed-time limits still apply.",
            ],
            [
              "Hold & reconcile",
              "An unknown timeout or transport failure keeps the payment processing. A temporary “not found” response is insufficient.",
            ],
            [
              "Stop or request action",
              "Fraud, hard declines, insufficient funds, authentication and do-not-retry advice are never silently routed around.",
            ],
          ].map(([t, b]) => (
            <div key={t}>
              <h3 className="font-medium text-brand-600">{t}</h3>
              <p className="mt-2 text-sm text-ink-500">{b}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { errorMessage, useSession } from "@/components/session-provider";
import { Alert, Button, Card, Field, Table, Tag } from "@/components/ui";
import { adminCan } from "@/lib/admin-permissions";
import { formatMoney } from "@/lib/format";
import type { PricePlan, Quote, Terms, Tier } from "./strategy-types";
type Account = {
  id: string;
  name: string;
  providerId: string;
  label: string;
  currencies: string[];
};
const fresh = (): Terms => ({
  name: "New amount tariff",
  side: "merchant",
  currency: "EUR",
  merchantId: null,
  providerAccountId: null,
  paymentMethod: null,
  country: null,
  priority: 100,
  validFrom: new Date().toISOString(),
  validUntil: null,
  tiers: [
    { from: 0, to: 10000, rateBps: 290, fixed: 20, minimum: 0, maximum: null },
    {
      from: 10000,
      to: null,
      rateBps: 240,
      fixed: 10,
      minimum: 0,
      maximum: null,
    },
  ],
});
export function QuoteSummary({ quote }: { quote: Quote }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Merchant fee", quote.merchant.amount],
          ["PSP cost", quote.provider.amount],
          ["Gross margin", quote.margin],
          ["Merchant net", quote.merchantNet],
        ].map(([label, amount]) => (
          <div
            key={label}
            className="rounded-xl border border-ink-200 bg-ink-50 p-4"
          >
            <p className="text-xs uppercase tracking-wider text-ink-500">
              {label}
            </p>
            <p className="mt-2 text-2xl font-semibold text-brand-600">
              {formatMoney(Number(amount), quote.currency)}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 text-xs text-ink-500 sm:grid-cols-2">
        {[quote.merchant, quote.provider].map((f, i) => (
          <p key={i}>
            {f.planId ? (
              <Link
                className="text-brand-600 underline"
                href={`/admin/pricing?plan=${f.planId}`}
              >
                {f.name} · v{f.revision}
              </Link>
            ) : (
              f.name
            )}{" "}
            · {f.tier.rateBps / 100}% +{" "}
            {formatMoney(f.tier.fixed, quote.currency)}
          </p>
        ))}
      </div>
      {quote.warnings.length > 0 && (
        <p className="mt-2 text-xs text-warn">
          {quote.warnings.map((s) => s.replaceAll("_", " ")).join(" · ")}
        </p>
      )}
    </>
  );
}
export function PricingCenter({
  initial,
  merchants,
  accounts: initialAccounts,
}: {
  initial: PricePlan[];
  merchants: { id: string; name: string }[];
  accounts: Account[];
}) {
  const session = useSession(),
    can = adminCan(session.user.role, "providers.manage");
  const [plans, setPlans] = useState(initial),
    [selected, setSelected] = useState<PricePlan | null>(null),
    [terms, setTerms] = useState<Terms>(initial[0]?.terms ?? fresh()),
    [editor, setEditor] = useState(false),
    [cloneId, setCloneId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("all"),
    [accounts, setAccounts] = useState(initialAccounts),
    [search, setSearch] = useState("");
  const [form, setForm] = useState({
    merchantId: merchants[0]?.id ?? "",
    providerAccountId: initialAccounts[0]?.id ?? "",
    amount: "10000",
    currency: "EUR",
    paymentMethod: "card",
    country: "",
    at: new Date().toISOString().slice(0, 10),
  });
  useEffect(() => {
    if (editor)
      document
        .getElementById("pricing-editor")
        ?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
          block: "start",
        });
  }, [editor, selected?.id, cloneId]);
  const [quote, setQuote] = useState<Quote | null>(null),
    [curve, setCurve] = useState<Quote[]>([]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("plan"),
      p = initial.find((x) => x.id === id);
    if (p) {
      setSelected(p);
      setTerms(p.terms);
      setEditor(true);
    }
  }, [initial]);
  function open(p: PricePlan) {
    setSelected(p);
    setTerms(structuredClone(p.terms));
    setCloneId(undefined);
    setEditor(true);
    setError("");
  }
  async function refresh() {
    const r = await session.api<{ data: PricePlan[] }>("/admin/pricing");
    setPlans(r.data);
    return r.data;
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const r = selected
        ? await session.api<PricePlan>(`/admin/pricing/${selected.id}`, {
            method: "PATCH",
            body: { version: selected.version, terms },
          })
        : await session.api<PricePlan>("/admin/pricing", {
            body: { terms, cloneId },
          });
      await refresh();
      open(r);
      session.toast("Draft saved", "ok");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function action(action: "publish" | "retire") {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const r = await session.api<PricePlan>(`/admin/pricing/${selected.id}`, {
        method: "PATCH",
        body: {
          version: selected.version,
          action,
          replacePrevious:
            action === "publish" &&
            plans.some(
              (p) =>
                p.familyId === selected.familyId &&
                p.status === "active" &&
                p.id !== selected.id,
            ),
        },
      });
      await refresh();
      open(r);
      session.toast(
        action === "publish" ? "Tariff published" : "Tariff retired",
        "ok",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function searchAccounts() {
    setBusy(true);
    setError("");
    try {
      const r = await session.api<{
        data: {
          id: string;
          name: string;
          accounts: { id: string; name: string; currencies: string[] }[];
        }[];
      }>(`/admin/providers?limit=50&search=${encodeURIComponent(search)}`);
      const matches = r.data.flatMap((p) =>
        p.accounts.map((a) => ({
          ...a,
          providerId: p.id,
          label: `${p.name} · ${a.name}`,
        })),
      );
      setAccounts(matches);
      setForm((f) => ({
        ...f,
        providerAccountId: matches.some((a) => a.id === f.providerAccountId)
          ? f.providerAccountId
          : (matches[0]?.id ?? ""),
      }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function calculate() {
    setBusy(true);
    setError("");
    setQuote(null);
    setCurve([]);
    try {
      const amount = Number(form.amount);
      if (!Number.isSafeInteger(amount) || amount <= 0)
        throw new Error("Enter a positive integer in minor units");
      const r = await session.api<Quote & { curve: Quote[] }>(
        "/admin/pricing/quote",
        {
          body: {
            ...form,
            amount,
            country: form.country || undefined,
            at: `${form.at}T12:00:00Z`,
            curve: [
              100, 500, 1000, 2500, 5000, 9999, 10000, 25000, 50000, 100000,
              250000, 500000,
            ],
          },
        },
      );
      setQuote(r);
      setCurve(r.curve);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function tier(i: number, k: keyof Tier, v: string) {
    setTerms((t) => ({
      ...t,
      tiers: t.tiers.map((x, j) =>
        j === i
          ? {
              ...x,
              [k]:
                v === "" && (k === "to" || k === "maximum") ? null : Number(v),
            }
          : x,
      ),
    }));
  }
  const locked = !can || (selected !== null && selected.status !== "draft");
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Active tariffs", plans.filter((p) => p.status === "active").length],
          ["Draft versions", plans.filter((p) => p.status === "draft").length],
          [
            "Currencies",
            new Set(
              plans
                .filter((p) => p.status === "active")
                .map((p) => p.terms.currency),
            ).size,
          ],
        ].map(([l, v]) => (
          <Card key={l}>
            <div className="text-xs text-ink-500">{l}</div>
            <div className="mt-1 text-3xl font-semibold text-brand-600">
              {v}
            </div>
          </Card>
        ))}
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      <Card
        title="Tariff library"
        description="The most specific scope wins, then the lowest priority. Dates use UTC; upper amount bounds are exclusive."
        actions={
          <Button
            disabled={!can || busy}
            onClick={() => {
              setSelected(null);
              setTerms(fresh());
              setCloneId(undefined);
              setEditor(true);
            }}
          >
            New tariff
          </Button>
        }
      >
        <div className="mb-3 flex flex-wrap gap-2">
          {["all", "merchant", "provider", "draft", "retired"].map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "primary" : "ghost"}
              onClick={() => setFilter(f)}
            >
              {f}
            </Button>
          ))}
        </div>
        <Table>
          <thead>
            <tr>
              <th>Tariff / version</th>
              <th>Side</th>
              <th>Currency</th>
              <th>Scope</th>
              <th>Brackets</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {plans
              .filter(
                (p) =>
                  filter === "all" ||
                  p.terms.side === filter ||
                  p.status === filter,
              )
              .map((p) => (
                <tr key={p.id}>
                  <td>
                    <button
                      className="text-left font-medium text-brand-600 hover:underline"
                      onClick={() => open(p)}
                    >
                      {p.terms.name} · v{p.revision}
                    </button>
                  </td>
                  <td>
                    {p.terms.side === "merchant" ? "Merchant fee" : "PSP cost"}
                  </td>
                  <td>{p.terms.currency}</td>
                  <td>
                    {p.terms.merchantId ? <Link className="text-brand-600 hover:underline" href={`/admin/merchants/${p.terms.merchantId}`}>{merchants.find(m=>m.id===p.terms.merchantId)?.name??p.terms.merchantId}</Link> : p.terms.providerAccountId ? <Link className="text-brand-600 hover:underline" href={`/admin/provider-accounts/${p.terms.providerAccountId}`}>{accounts.find(a=>a.id===p.terms.providerAccountId)?.label??p.terms.providerAccountId}</Link> : "Platform"}
                    <div className="text-xs text-ink-500">
                      {p.terms.paymentMethod ?? "All methods"} ·{" "}
                      {p.terms.country ?? "All countries"} · priority{" "}
                      {p.terms.priority}
                    </div>
                  </td>
                  <td>{p.terms.tiers.length}</td>
                  <td>
                    <Tag>{p.status}</Tag>
                  </td>
                </tr>
              ))}
          </tbody>
        </Table>
        {!plans.length && (
          <p className="py-5 text-sm text-ink-500">
            No tariffs in this mode. Legacy account pricing remains explicitly
            labelled in the calculator.
          </p>
        )}
      </Card>
      {editor && (
        <section id="pricing-editor" className="scroll-mt-6">
          <Card
            title={
              selected
                ? `${selected.terms.name} · v${selected.revision}`
                : cloneId
                  ? "New version draft"
                  : "New tariff draft"
            }
            description="Whole-payment bracket pricing: one selected percentage + fixed fee, then minimum/maximum. Fees are charged on successful capture."
          >
            <div className="mb-4 flex flex-wrap gap-2">
              {selected && (
                <>
                  <Tag>{selected.status}</Tag>
                  <Button
                    size="sm"
                    disabled={!can || busy}
                    onClick={() => {
                      setCloneId(selected.id);
                      setSelected(null);
                      setTerms({ ...terms, name: terms.name });
                    }}
                  >
                    Create new version
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditor(false)}
              >
                Close
              </Button>
            </div>
            {error && <Alert tone="bad">{error}</Alert>}
            <fieldset disabled={locked || busy} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Field label="Name" htmlFor="price-name">
                  <input
                    id="price-name"
                    className="input"
                    value={terms.name}
                    onChange={(e) =>
                      setTerms({ ...terms, name: e.target.value })
                    }
                  />
                </Field>
                <Field label="Side" htmlFor="price-side">
                  <select
                    id="price-side"
                    className="input"
                    value={terms.side}
                    onChange={(e) =>
                      setTerms({
                        ...terms,
                        side: e.target.value as Terms["side"],
                        merchantId: null,
                        providerAccountId: null,
                      })
                    }
                  >
                    <option value="merchant">Merchant commission</option>
                    <option value="provider">PSP cost</option>
                  </select>
                </Field>
                <Field label="Currency" htmlFor="price-currency">
                  <input
                    id="price-currency"
                    className="input"
                    maxLength={3}
                    value={terms.currency}
                    onChange={(e) =>
                      setTerms({
                        ...terms,
                        currency: e.target.value.toUpperCase(),
                      })
                    }
                  />
                </Field>
                <Field label="Priority" htmlFor="price-priority">
                  <input
                    id="price-priority"
                    className="input"
                    type="number"
                    value={terms.priority}
                    onChange={(e) =>
                      setTerms({ ...terms, priority: Number(e.target.value) })
                    }
                  />
                </Field>
                <Field
                  label={
                    terms.side === "merchant"
                      ? "Merchant scope"
                      : "PSP account ID (blank = all)"
                  }
                  htmlFor="price-scope"
                >
                  {terms.side === "merchant" ? (
                    <select
                      id="price-scope"
                      className="input"
                      value={terms.merchantId ?? ""}
                      onChange={(e) =>
                        setTerms({
                          ...terms,
                          merchantId: e.target.value || null,
                        })
                      }
                    >
                      <option value="">All merchants</option>
                      {merchants.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="price-scope"
                      className="input"
                      value={terms.providerAccountId ?? ""}
                      onChange={(e) =>
                        setTerms({
                          ...terms,
                          providerAccountId: e.target.value || null,
                        })
                      }
                    />
                  )}
                </Field>
                <Field label="Method" htmlFor="price-method">
                  <select
                    id="price-method"
                    className="input"
                    value={terms.paymentMethod ?? ""}
                    onChange={(e) =>
                      setTerms({
                        ...terms,
                        paymentMethod: e.target.value || null,
                      })
                    }
                  >
                    <option value="">All methods</option>
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
                <Field label="Country (blank = all)" htmlFor="price-country">
                  <input
                    id="price-country"
                    className="input"
                    maxLength={2}
                    value={terms.country ?? ""}
                    onChange={(e) =>
                      setTerms({
                        ...terms,
                        country: e.target.value.toUpperCase() || null,
                      })
                    }
                  />
                </Field>
                <Field label="Effective from UTC" htmlFor="price-start">
                  <input
                    id="price-start"
                    className="input"
                    type="datetime-local"
                    value={terms.validFrom.slice(0, 16)}
                    onChange={(e) =>
                      e.target.value &&
                      setTerms({
                        ...terms,
                        validFrom: new Date(e.target.value + "Z").toISOString(),
                      })
                    }
                  />
                </Field>
                <Field label="Until UTC (optional)" htmlFor="price-end">
                  <input
                    id="price-end"
                    className="input"
                    type="datetime-local"
                    value={terms.validUntil?.slice(0, 16) ?? ""}
                    onChange={(e) =>
                      setTerms({
                        ...terms,
                        validUntil: e.target.value
                          ? new Date(e.target.value + "Z").toISOString()
                          : null,
                      })
                    }
                  />
                </Field>
              </div>
              <Table>
                <thead>
                  <tr>
                    <th>From (minor)</th>
                    <th>To exclusive / ∞</th>
                    <th>Rate bps</th>
                    <th>Fixed minor</th>
                    <th>Min fee</th>
                    <th>Max fee / ∞</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {terms.tiers.map((t, i) => (
                    <tr key={i}>
                      {(
                        [
                          "from",
                          "to",
                          "rateBps",
                          "fixed",
                          "minimum",
                          "maximum",
                        ] as const
                      ).map((k) => (
                        <td key={k}>
                          <input
                            aria-label={`Bracket ${i + 1} ${k}`}
                            type="number"
                            min={0}
                            className="input min-w-[90px]"
                            value={t[k] ?? ""}
                            placeholder="∞"
                            onChange={(e) => tier(i, k, e.target.value)}
                          />
                        </td>
                      ))}
                      <td>
                        <Button
                          size="sm"
                          disabled={terms.tiers.length === 1}
                          onClick={() =>
                            setTerms({
                              ...terms,
                              tiers: terms.tiers.filter((_, j) => i !== j),
                            })
                          }
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Button
                size="sm"
                disabled={terms.tiers.length >= 20}
                onClick={() => {
                  const last = terms.tiers.at(-1)!;
                  const boundary = last.from + 10000;
                  setTerms({
                    ...terms,
                    tiers: [
                      ...terms.tiers.slice(0, -1),
                      { ...last, to: boundary },
                      { ...last, from: boundary, to: null },
                    ],
                  });
                }}
              >
                Add bracket
              </Button>
            </fieldset>
            <p className="mt-3 text-xs text-ink-500">
              100 bps = 1%. Amounts use the currency’s minor unit. Published
              terms cannot be edited; create a version to replace the active
              tariff atomically. Future schedules must have non-overlapping
              effective intervals.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={locked || busy}
                onClick={() => void save()}
              >
                Save draft
              </Button>
              {selected?.status === "draft" && (
                <Button
                  disabled={
                    !can ||
                    busy ||
                    JSON.stringify(terms) !== JSON.stringify(selected.terms)
                  }
                  onClick={() => void action("publish")}
                >
                  {plans.some(
                    (p) =>
                      p.familyId === selected.familyId &&
                      p.status === "active" &&
                      p.id !== selected.id,
                  )
                    ? "Publish & replace active version"
                    : "Publish saved draft"}
                </Button>
              )}
              {selected?.status === "active" && (
                <Button
                  variant="danger"
                  disabled={!can || busy}
                  onClick={() => void action("retire")}
                >
                  Retire tariff
                </Button>
              )}
              {!can && (
                <span className="text-xs text-ink-500">
                  Investor access is read-only. The calculator remains
                  available.
                </span>
              )}
            </div>
          </Card>
        </section>
      )}
      <Card
        title="Fee & margin calculator"
        description="Uses the backend pricing engine and published versions. No payment is created."
      >
        <div className="mb-3 flex gap-2">
          <input
            className="input"
            aria-label="Search PSP accounts"
            placeholder="Search any PSP by name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button disabled={busy} onClick={() => void searchAccounts()}>
            Find PSP
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Merchant" htmlFor="quote-merchant">
            <select
              id="quote-merchant"
              className="input"
              value={form.merchantId}
              onChange={(e) => setForm({ ...form, merchantId: e.target.value })}
            >
              {merchants.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="PSP account" htmlFor="quote-account">
            <select
              id="quote-account"
              className="input"
              value={form.providerAccountId}
              onChange={(e) =>
                setForm({ ...form, providerAccountId: e.target.value })
              }
            >
              <option value="">Choose account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
          {(
            [
              ["amount", "Amount (minor units)"],
              ["currency", "Currency"],
              ["country", "Country (optional)"],
              ["at", "Pricing date UTC"],
            ] as const
          ).map(([k, l]) => (
            <Field key={k} label={l} htmlFor={`quote-${k}`}>
              <input
                id={`quote-${k}`}
                className="input"
                type={k === "at" ? "date" : k === "amount" ? "number" : "text"}
                value={form[k]}
                onChange={(e) =>
                  setForm({
                    ...form,
                    [k]:
                      k === "currency" || k === "country"
                        ? e.target.value.toUpperCase()
                        : e.target.value,
                  })
                }
              />
            </Field>
          ))}
          <Field label="Payment method" htmlFor="quote-method">
            <select
              id="quote-method"
              className="input"
              value={form.paymentMethod}
              onChange={(e) =>
                setForm({ ...form, paymentMethod: e.target.value })
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
          <div className="flex items-end">
            <Button
              variant="primary"
              loading={busy}
              disabled={!form.providerAccountId || !form.merchantId}
              onClick={() => void calculate()}
            >
              Calculate fees
            </Button>
          </div>
        </div>
        {quote && (
          <div className="mt-5 space-y-4">
            <QuoteSummary quote={quote} />
            <FeeCurve rows={curve} />
            <p className="text-xs text-ink-500">
              Gross margin excludes tax, FX, refunds and fees for failed
              attempts. The quote is an estimate; capture records the selected
              tariff version.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
function FeeCurve({ rows }: { rows: Quote[] }) {
  if (!rows.length) return null;
  const max = Math.max(
    ...rows.flatMap((r) => [r.merchant.amount, r.provider.amount]),
    1,
  );
  const line = (key: "merchant" | "provider") =>
    rows
      .map(
        (r, i) =>
          `${40 + (i * 700) / (rows.length - 1)},${210 - (r[key].amount / max) * 180}`,
      )
      .join(" ");
  return (
    <div className="rounded-xl border border-ink-200 p-4">
      <h3 className="font-medium">Fee curve by payment amount</h3>
      <p className="text-xs text-ink-500">
        Solid: merchant fee · dashed: PSP cost · sample points, unequal amount
        intervals
      </p>
      <svg
        role="img"
        aria-label="Merchant fees and PSP costs across payment amounts"
        viewBox="0 0 780 250"
        className="mt-3 w-full"
      >
        <path
          d="M40 25V210H750"
          fill="none"
          stroke="currentColor"
          opacity=".2"
        />
        {(["merchant", "provider"] as const).map((k) => (
          <polyline
            key={k}
            points={line(k)}
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeDasharray={k === "provider" ? "6 5" : undefined}
            className="text-brand-600"
            opacity={k === "provider" ? 0.5 : 1}
          />
        ))}
        {rows.map((r, i) => (
          <circle
            key={i}
            cx={40 + (i * 700) / (rows.length - 1)}
            cy={210 - (r.merchant.amount / max) * 180}
            r={4}
            className="fill-brand-600"
          >
            <title>
              {formatMoney(r.amount, r.currency)}: fee{" "}
              {formatMoney(r.merchant.amount, r.currency)}, PSP{" "}
              {formatMoney(r.provider.amount, r.currency)}, margin{" "}
              {formatMoney(r.margin, r.currency)}
            </title>
          </circle>
        ))}
      </svg>
      <details>
        <summary className="cursor-pointer text-sm text-brand-600">
          View exact amounts
        </summary>
        <Table>
          <thead>
            <tr>
              <th>Payment</th>
              <th>Merchant fee</th>
              <th>PSP cost</th>
              <th>Margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.amount}>
                <td>{formatMoney(r.amount, r.currency)}</td>
                <td>{formatMoney(r.merchant.amount, r.currency)}</td>
                <td>{formatMoney(r.provider.amount, r.currency)}</td>
                <td>{formatMoney(r.margin, r.currency)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </details>
    </div>
  );
}

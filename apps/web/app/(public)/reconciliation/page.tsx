import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/ui";
import { Chip, CtaBand, Feature, FeatureGrid, PageIntro, Panel, PrimaryCta, SecondaryCta, Section, SpecList, Split } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Reconciliation & settlement",
  description: "Match provider reports against NATIO transactions, see every mismatch by category, and follow settlement batches reported by the licensed providers. NATIO holds no funds; providers settle directly with the merchant.",
};

const RESULTS: Array<{ status: string; tone: "ok" | "warn" | "bad" | "muted" | "neutral"; body: string; action: string }> = [
  { status: "MATCHED", tone: "ok", body: "The provider row and the NATIO transaction agree on reference, amount, currency and status.", action: "Nothing to do." },
  { status: "MISSING_PROVIDER", tone: "warn", body: "NATIO recorded a successful transaction that the provider file does not contain.", action: "Usually a cut-off or a file covering a different window; otherwise a case for the provider." },
  { status: "MISSING_NATIO", tone: "warn", body: "The provider reports a transaction NATIO has no record of.", action: "Check for traffic sent outside the platform, or a reference the file does not carry." },
  { status: "AMOUNT_MISMATCH", tone: "bad", body: "The references match but the amounts — or the currencies — differ.", action: "Partial capture, partial refund or a currency conversion applied by the provider." },
  { status: "STATUS_MISMATCH", tone: "bad", body: "The references and amounts match but the outcomes disagree, for example successful in NATIO and pending or failed at the provider.", action: "Usually a late provider notification; the transaction is re-checked against the provider." },
];

const CSV = `provider_reference,natio_reference,amount,currency,status,processed_at
dma_5f21c4,pay_7Kq2mN9xR4vL8wP1tY3z,10000,USD,settled,2026-09-21T14:02:11Z
dma_5f21c9,pay_2Vc8hT4pL1nQ6zR9mK0w,4500,USD,settled,2026-09-21T14:44:57Z
dma_5f2200,,25000,USD,settled,2026-09-21T15:10:02Z`;

const LAYERS: Array<{ term: string; detail: string }> = [
  { term: "Payment", detail: "What the customer was asked to pay: one amount, one currency, one lifecycle, possibly several provider attempts." },
  { term: "Provider transaction", detail: "What the provider actually processed: its own reference, its own fee, its own status, on its own clock." },
  { term: "Settlement", detail: "What the provider transferred and when: a batch covering a period, with gross, fees and net, and the transactions it covers." },
  { term: "Merchant account", detail: "What arrived in your bank account, from the licensed provider, under the provider's own settlement terms." },
];

export default function ReconciliationPage() {
  return (
    <>
      <PageIntro
        eyebrow="Reconciliation & settlement"
        title="Two records of the same money, compared line by line."
        lead="NATIO knows what it orchestrated. Each provider knows what it processed and what it settled. Reconciliation puts the two side by side, classifies every difference, and leaves an auditable record of the comparison — so finance stops rebuilding it in a spreadsheet each month."
        actions={
          <>
            <PrimaryCta />
            <SecondaryCta />
          </>
        }
      />

      <Section eyebrow="How a run works" title="Import a provider report, match it against NATIO transactions." lead="A reconciliation batch takes a provider file for a period, matches each row against the transactions NATIO recorded, and produces a result per row plus totals per category.">
        <Split
          panel={
            <div className="space-y-3">
              <Panel padded={false} title="Provider report · CSV">
                <CodeBlock variant="dark" className="!rounded-none !border-0" code={CSV} language="csv" />
              </Panel>
              <Panel padded={false} title="What a batch records">
                <ul className="divide-y divide-night-700 text-[13px] leading-6 text-mist-200">
                  <li className="px-5 py-3">The file, the provider account and the period it covers</li>
                  <li className="px-5 py-3">A count per result category, and the total rows compared</li>
                  <li className="px-5 py-3">Each row with both sides: NATIO amount and status, provider amount and status</li>
                  <li className="px-5 py-3">A link from every row back to the payment and its timeline</li>
                  <li className="px-5 py-3">Who imported it, and when</li>
                </ul>
              </Panel>
            </div>
          }
        >
          <SpecList
            items={[
              { term: "Matching keys", detail: "The provider reference first, then your NATIO reference where the file carries one. Column names are normalised, so provider_reference, reference or txn_id all map to the same field." },
              { term: "Amounts", detail: "Integer values are read as minor units, decimal values as major units and converted. Currency is compared as well as amount." },
              { term: "Statuses", detail: "Provider vocabularies are normalised — settled, captured, approved, paid all mean successful; declined, voided, rejected all mean failed — before the two sides are compared." },
              { term: "Scope", detail: "Only settled money is expected in a provider file: a NATIO transaction that never succeeded is not reported as missing." },
              { term: "Today and next", detail: "CSV import is available now in the dashboard. Direct provider API imports are the next step; the matching engine is unchanged by where the rows come from." },
            ]}
          />
        </Split>
      </Section>

      <Section tone="raised" eyebrow="Results" title="Five outcomes, and what each one usually means." lead="A reconciliation result is not just a flag. Each row keeps both sides of the comparison — the NATIO transaction and the provider row — so the difference can be investigated without opening two systems.">
        <div className="overflow-x-auto rounded-lg border border-night-700">
          <table className="data-table data-table-dark">
            <thead>
              <tr>
                <th>Result</th>
                <th>What it means</th>
                <th>Typical cause</th>
              </tr>
            </thead>
            <tbody>
              {RESULTS.map((r) => (
                <tr key={r.status}>
                  <td>
                    <Chip tone={r.tone}>{r.status}</Chip>
                  </td>
                  <td className="!whitespace-normal">{r.body}</td>
                  <td className="!whitespace-normal text-mist-400">{r.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[13px] leading-6 text-mist-400">
          Every batch keeps its file name, its period, who imported it and its totals. Results link back to the payment, so an exception ends at a timeline rather than at a dead end.
        </p>
      </Section>

      <Section eyebrow="Four layers" title="Payment, provider transaction, settlement, merchant account." lead="Most reconciliation pain comes from treating these as one number. NATIO keeps them apart and shows how they relate.">
        <SpecList items={LAYERS.map((l) => ({ term: l.term, detail: l.detail }))} />
        <FeatureGrid cols={3} className="mt-12">
          <Feature index={1} title="Processed vs settled">
            Per currency, what NATIO orchestrated against what providers report as settled, so the gap is visible instead of implied.
          </Feature>
          <Feature index={2} title="Settlement batches">
            Each batch reported by a provider, with its period, gross amount, fees, net amount, status and the transactions it covers.
          </Feature>
          <Feature index={3} title="Fees where they occur">
            Provider fees are stored per attempt and per settlement, so cost per provider is a fact from your own data rather than an estimate.
          </Feature>
        </FeatureGrid>
      </Section>

      <Section tone="raised" eyebrow="Custody" title="NATIO does not hold your money." lead="This is a design decision, not a temporary state, and it shapes everything on this page.">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          <div>
            <SpecList
              items={[
                { term: "Funds flow", detail: "Money moves between the merchant and the licensed providers connected to the platform. Those providers settle directly to the merchant's account under their own terms." },
                { term: "What balances show", detail: "The balances endpoint reports what providers have processed and settled for you. It is a view of provider-reported figures, not a NATIO-held balance; the payload states custodian: false." },
                { term: "What NATIO is", detail: "A payment orchestration and technology infrastructure layer. NATIO is not a bank, an acquirer, a payment institution or an e-money institution, and does not perform regulated payment services itself." },
                { term: "Why it matters here", detail: "Because the money is settled by the provider, the provider's report is the authority. Reconciliation exists to prove that NATIO's record and that authority agree." },
              ]}
            />
          </div>
          <Panel className="!p-7">
            <h3 className="text-[15px] font-medium text-mist-50">Who does what</h3>
            <ul className="mt-5 divide-y divide-night-700 border-t border-night-700 text-[13.5px] leading-[1.7]">
              <li className="py-3.5">
                <div className="font-medium text-mist-50">Merchant</div>
                <div className="mt-0.5 text-mist-400">Sells, sets routing policy, holds the commercial relationship with each provider.</div>
              </li>
              <li className="py-3.5">
                <div className="font-medium text-mist-50">NATIO</div>
                <div className="mt-0.5 text-mist-400">Orchestrates the request, records every decision, normalises provider data, reconciles and reports.</div>
              </li>
              <li className="py-3.5">
                <div className="font-medium text-mist-50">Licensed providers</div>
                <div className="mt-0.5 text-mist-400">Process, acquire, hold funds where applicable, and settle directly to the merchant.</div>
              </li>
            </ul>
            <div className="mt-5 border-t border-night-700 pt-5">
              <Link href="/product" className="text-[13px] font-medium text-iris hover:underline">
                Scope of the platform →
              </Link>
            </div>
          </Panel>
        </div>
      </Section>

      <CtaBand title="Reconcile a sandbox batch." lead="Run test payments, export the demo provider report, import it, and watch the matching engine classify every row." />
    </>
  );
}

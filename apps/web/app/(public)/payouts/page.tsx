
import {getI18n} from '@/lib/i18n/server';
import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock, StatusBadge } from "@/components/ui";
import { Chip, CtaBand, Feature, FeatureGrid, PageIntro, Panel, PrimaryCta, SecondaryCta, Section, SpecList, Split } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Payouts",
  description: "Send funds to beneficiaries through licensed providers: a separate payout module with its own lifecycle, its own routing rules, tokenised beneficiary references and the same provider-adapter architecture as payments.",
};

const STATUSES: Array<{ status: string; body: string }> = [
  { status: "created", body: "Accepted and persisted. Routing has not produced a provider attempt yet." },
  { status: "pending", body: "Waiting: a payout window, a provider queue or an internal approval. Cancellable." },
  { status: "processing", body: "Submitted to the selected provider; the provider has not confirmed the credit." },
  { status: "successful", body: "The provider confirmed the payout. Terminal." },
  { status: "failed", body: "Rejected by the provider or no eligible provider remained. Carries a failure object. Terminal." },
  { status: "cancelled", body: "Cancelled by the merchant while created or pending. Terminal." },
];

const CREATE_REQUEST = `curl -X POST https://api.natio.me/v1/payouts \\
  -H "Authorization: Bearer natio_sk_test_..." \\
  -H "Idempotency-Key: payout-2026-09-001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 250000,
    "currency": "EUR",
    "destination": {
      "type": "bank_account",
      "token": "benef_tok_8f3a",
      "display": "IBAN ****4321",
      "holder_name": "Acme GmbH",
      "country": "DE"
    },
    "reference": "PAYOUT-2026-09-001"
  }'`;

const CREATE_RESPONSE = `{
  "id": "po_4Bt8xC2nQ7hK",
  "object": "payout",
  "mode": "test",
  "status": "processing",
  "amount": 250000,
  "currency": "EUR",
  "destination": {
    "type": "bank_account",
    "display": "IBAN ****4321",
    "holder_name": "Acme GmbH",
    "country": "DE"
  },
  "route": {
    "provider_name": "NATIO Demo Bank",
    "provider_account_name": "Demo Bank · EUR",
    "rule": "EUR payouts → Demo Bank"
  },
  "failure": null,
  "created_at": "2026-09-22T09:14:02.118Z"
}`;

export default async function PayoutsPage() {
 const {t:translateUi,locale:uiLocale}=(await getI18n());

  return (
    <>
      <PageIntro
        eyebrow="Payouts"
        title={translateUi("Sending money is its own module, on the same architecture.")}
        lead="Payouts are not payments in reverse. They have their own object, their own lifecycle and their own routing rules — but they run through the same provider adapters, the same idempotency guarantees and the same timeline and reconciliation as everything else on the platform."
        actions={
          <>
            <PrimaryCta />
            <SecondaryCta href="/docs/api-reference">{translateUi("API reference")}</SecondaryCta>
          </>
        }
      />

      <Section eyebrow="Create a payout" title={translateUi("Amount, currency, and a tokenised destination.")} lead="Destinations are references, not account details. NATIO accepts a provider beneficiary token and a masked display value; requests carrying long digit sequences in the display field are rejected.">
        <Split
          panel={
            <div className="space-y-3">
              <Panel padded={false} title={translateUi("Request")}>
                <CodeBlock variant="dark" className="!rounded-none !border-0" code={CREATE_REQUEST} language="bash" />
              </Panel>
              <Panel padded={false} title={translateUi("Response · 201 Created")}>
                <CodeBlock variant="dark" className="!rounded-none !border-0" code={CREATE_RESPONSE} language="json" />
              </Panel>
            </div>
          }
        >
          <FeatureGrid cols={2}>
            <Feature index={1} title={translateUi("Three destination types")} mono="destination.type">
              <span className="font-mono text-[12.5px] text-mist-50">{translateUi("bank_account")}</span>, <span className="font-mono text-[12.5px] text-mist-50">{translateUi("wallet")}</span>{translateUi(" and ")}<span className="font-mono text-[12.5px] text-mist-50">{translateUi("card_token")}</span>{translateUi(", each identified by a provider token plus a masked display value.")}</Feature>
            <Feature index={2} title={translateUi("No raw account numbers")} mono="token">{translateUi("NATIO stores the token, the masked display, the holder name and the country. Account numbers and card numbers stay with the provider that issued the token.")}</Feature>
            <Feature index={3} title={translateUi("Idempotency")} mono="Idempotency-Key">{translateUi("A retried request with the same key replays the original response. A network failure on your side cannot become a second payout.")}</Feature>
            <Feature index={4} title={translateUi("Cancel while pending")} mono="POST /v1/payouts/{id}/cancel">{translateUi("Payouts can be cancelled while created or pending. After submission to the provider the outcome is whatever the provider reports.")}</Feature>
          </FeatureGrid>
        </Split>
      </Section>

      <Section tone="raised" eyebrow="Lifecycle" title={translateUi("Six states, one direction.")} lead="As with payments, transitions are validated and guarded; a provider notification that arrives twice cannot move a payout backwards.">
        <div className="overflow-x-auto rounded-lg border border-night-700">
          <table className="data-table data-table-dark">
            <thead>
              <tr>
                <th>{translateUi("Status")}</th>
                <th>{translateUi("Meaning")}</th>
              </tr>
            </thead>
            <tbody>
              {translateUi(STATUSES.map((s) => (
                <tr key={s.status}>
                  <td>
                    <StatusBadge variant="dark" status={s.status} label={translateUi(s.status)} />
                  </td>
                  <td className="!whitespace-normal">{s.body}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[13px] leading-6 text-mist-400">{translateUi("Events: ")}<span className="font-mono text-[12px]">{translateUi("payout.created")}</span>, <span className="font-mono text-[12px]">{translateUi("payout.successful")}</span>, <span className="font-mono text-[12px]">{translateUi("payout.failed")}</span>{translateUi(" — delivered to your endpoints with the same signature scheme as payment events.")}</p>
      </Section>

      <Section eyebrow="Routing" title={translateUi("Payout routing is separate from payment routing.")} lead="Rules carry a transaction type. A rule written for payouts never affects a payment, and the provider that acquires your card traffic is rarely the one you use to pay beneficiaries.">
        <Split
          panel={
            <Panel padded={false} title={translateUi("Rule chain · payouts")}>
              <ol className="divide-y divide-night-700 text-[13px] leading-6 text-mist-200">
                <li className="px-5 py-4">
                  <span className="font-mono text-[11px] text-mist-600">01</span>
                  <div className="mt-1">{translateUi("IF ")}<Chip>{translateUi("transaction_type = payout")}</Chip>{translateUi(" AND ")}<Chip>{translateUi("currency = EUR")}</Chip> → <span className="font-medium text-mist-50">{translateUi("Provider A")}</span>
                  </div>
                </li>
                <li className="px-5 py-4">
                  <span className="font-mono text-[11px] text-mist-600">02</span>
                  <div className="mt-1">{translateUi("IF ")}<Chip>{translateUi("currency = EUR")}</Chip>{translateUi(" AND ")}<Chip>{translateUi("amount > X")}</Chip> → <span className="font-medium text-mist-50">{translateUi("Provider B")}</span>
                  </div>
                </li>
                <li className="px-5 py-4">
                  <span className="font-mono text-[11px] text-mist-600">03</span>
                  <div className="mt-1">{translateUi("IF Provider A unavailable → ")}<span className="font-medium text-mist-50">{translateUi("Provider C")}</span>
                  </div>
                </li>
              </ol>
            </Panel>
          }
        >
          <SpecList
            items={[
              { term: "Same conditions", detail: "Country, currency, merchant, project, amount, transaction type, risk score, hour of day and day of week, with the same operators as payment rules." },
              { term: "Same strategies", detail: "Ordered, weighted or score-based selection among the eligible provider accounts." },
              { term: "Eligibility", detail: "A provider account is a candidate only if it supports payouts, the currency and the destination country, and the amount is inside its configured limits." },
              { term: "Failover", detail: "Technical errors and provider unavailability cascade to the next eligible provider. As with payments, a timeout is verified with the provider before anything is retried." },
            ]}
          />
          <div className="mt-6">
            <Link href="/routing" className="text-[13px] font-medium text-iris hover:underline">{translateUi("How routing rules work →")}</Link>
          </div>
        </Split>
      </Section>

      <Section tone="raised" eyebrow="Operations" title={translateUi("The same records, on the sending side.")} lead="Payouts appear in the transaction monitor, in reconciliation and in settlement reporting alongside incoming volume, so finance sees one picture rather than two.">
        <FeatureGrid cols={4}>
          <Feature index={1} title={translateUi("Timeline")}>{translateUi("Rule matched, provider selected, request sent, provider response, failover, terminal state — recorded per payout.")}</Feature>
          <Feature index={2} title={translateUi("Transactions")}>{translateUi("Each payout writes a transaction with its provider reference, fee and currency, which reconciliation matches against provider reports.")}</Feature>
          <Feature index={3} title={translateUi("Fees")}>{translateUi("The provider account's fee configuration is applied and stored with the payout, so outbound cost is comparable across providers.")}</Feature>
          <Feature index={4} title={translateUi("No custody")}>{translateUi("NATIO instructs licensed providers; it does not hold, pool or disburse customer funds itself. The funding relationship stays between you and the provider.")}</Feature>
        </FeatureGrid>
      </Section>

      <CtaBand title={translateUi("Try payouts in the sandbox.")} lead="Demo providers reproduce success, hard decline, technical error, provider unavailable and timeout so you can build the failure paths before you go live." />
    </>
  );
}

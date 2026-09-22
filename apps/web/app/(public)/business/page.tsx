import type { Metadata } from "next";
import { CodeBlock } from "@/components/ui";
import {
  Accent,
  Chip,
  Container,
  CtaBand,
  Eyebrow,
  Feature,
  FeatureGrid,
  GridBackdrop,
  Metric,
  Panel,
  PrimaryCta,
  SecondaryCta,
  Section,
  SpecList,
  Split,
} from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Natio Business",
  description:
    "Accept on-chain payments and settle straight to a wallet you control. One integration alongside cards and local methods, on a platform that never takes custody of the funds.",
};

/**
 * Natio Business — the merchant-facing half of the client layer.
 *
 * The wallet page argues non-custody from the payer's side; this page has to
 * make the same argument in the language a finance team cares about: who can
 * touch the money, what happens on a chargeback that cannot exist, and what
 * the books look like afterwards.
 */

const CREATE_INVOICE = `curl -X POST https://api.natio.me/v1/payments \\
  -H "Authorization: Bearer natio_sk_test_..." \\
  -H "Idempotency-Key: order-5512" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 149900,
    "currency": "EUR",
    "method": "crypto",
    "settlement": {
      "asset": "USDT",
      "network": "tron",
      "account": "wal_acct_7Kd2"
    },
    "reference": "ORDER-5512",
    "customer": { "reference": "cus_8812" }
  }'`;

const INVOICE_RESPONSE = `{
  "id": "pay_9Xq4mB7tLz",
  "object": "payment",
  "mode": "test",
  "status": "pending",
  "amount": 149900,
  "currency": "EUR",
  "method": "crypto",
  "settlement": {
    "asset": "USDT",
    "network": "tron",
    "address": "TW7k...derived-per-invoice",
    "derivation": "m/44'/195'/0'/0/418",
    "expected": "1631.204000",
    "confirmations_required": 19
  },
  "expires_at": "2026-09-22T10:14:02.118Z",
  "created_at": "2026-09-22T09:44:02.118Z"
}`;

const LEDGER: Array<{ term: string; detail: string }> = [
  { term: "One address per invoice", detail: "Derived from your own extended public key at a recorded path. Two customers never share an address, so attribution is exact rather than inferred from amounts." },
  { term: "Confirmations are a status, not a guess", detail: "The payment moves through pending → processing → successful as confirmations accumulate against the threshold set for that asset. Every transition is recorded and immutable." },
  { term: "Underpayment and overpayment are first-class", detail: "A short payment does not silently fail and a long one does not silently vanish. Both produce a recorded outcome you can act on, with the observed amount against the expected one." },
  { term: "Reconciliation is the same machinery", detail: "On-chain receipts land in the same reconciliation and settlement reports as card and bank transactions, so the month closes in one place." },
];

/**
 * Split deliberately into what the engine does today and what it does not.
 * A merchant choosing a payment platform partly on its compliance controls has
 * to be able to tell the two apart, and the only way to make that possible is
 * to name the gaps on the same page as the capabilities.
 */
const COMPLIANCE_TODAY: Array<{ term: string; detail: string }> = [
  {
    term: "Append-only audit trail",
    detail:
      "Every state change, routing decision and administrative action is written to a log the application's own database role cannot alter. The constraint is a database trigger, not a convention, so it holds even if the application is wrong.",
  },
  {
    term: "Provider eligibility by country",
    detail:
      "Routing will not hand a payment to a provider that does not support the country, currency or method involved; the attempt is refused with a recorded reason rather than sent and declined. This is provider capability, not a licensing control — it is listed here for what it is.",
  },
];

const COMPLIANCE_NOT_BUILT: Array<{ term: string; detail: string }> = [
  {
    term: "Sanctions and watchlist screening",
    detail:
      "Designed, not implemented. NATIO does not screen accounts or counterparties against published lists today, and nothing in the platform should be read as doing so. Said plainly because a screening claim is the kind a merchant would rely on without re-checking.",
  },
  {
    term: "Business verification (KYB)",
    detail:
      "A KYB decision can be recorded against an account today; the verification behind it cannot. It is intended to run through an identity provider, so the provider holds the evidence and NATIO holds only the outcome, its reference and its timestamp. No provider is integrated, so the record exists and the check does not.",
  },
];

export default function BusinessPage() {
  return (
    <>
      {/* --- hero ------------------------------------------------------- */}
      <div className="relative overflow-hidden border-b border-night-700 bg-night-950">
        <GridBackdrop />
        <Container className="relative py-16 md:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1fr_minmax(0,500px)]">
            <div className="max-w-[640px]">
              <Eyebrow className="mb-5">Natio Business</Eyebrow>
              <h1 className="text-[42px] font-medium leading-[1.0] tracking-[-0.034em] text-mist-50 md:text-[68px]">
                Get paid on-chain.
                <br />
                <Accent>Settle to your wallet.</Accent>
              </h1>
              <p className="mt-7 max-w-[560px] text-[16.5px] leading-[1.7] text-mist-400 md:text-[17.5px]">
                You give NATIO an extended public key. It derives a fresh address for every invoice, watches the chain and tells you
                the moment a payment confirms. The funds go from your customer to you. There is no intermediate balance, because there
                is no account for one to sit in.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <PrimaryCta href="/contact">Talk to us</PrimaryCta>
                <SecondaryCta href="/docs/api-reference">API reference</SecondaryCta>
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-2">
                <Chip tone="warn">In development</Chip>
                <span className="text-[13px] text-mist-600">Orchestration and on-chain settlement are built; identity and screening are not — see status below.</span>
              </div>
            </div>
            <Panel glow title="Create an invoice">
              <CodeBlock code={CREATE_INVOICE} language="bash" />
            </Panel>
          </div>
        </Container>
      </div>

      {/* --- the settlement argument ------------------------------------- */}
      <Section
        grid
        eyebrow={<span>Settlement</span>}
        title="The shortest path between your customer and your treasury."
        lead="Most crypto gateways take custody, net their fee and pay you out later. That turns a payment into a credit exposure: your money sits on someone else's balance sheet until they choose to release it."
        aside={<>Nothing to withdraw, no payout schedule, no counterparty risk on the settlement leg — because the settlement leg never existed.</>}
      >
        <div className="grid gap-5 md:grid-cols-3">
          <Metric value="0" label="Funds held by NATIO" tone="lime" sub="Structurally, not by policy" />
          <Metric value="1" label="Hop from payer to merchant" tone="mist" sub="Customer address → your address" />
          <Metric value="xpub" label="What you hand over" tone="aqua" sub="Watch-only; cannot sign" />
        </div>
        <div className="mt-10">
          <SpecList items={LEDGER} />
        </div>
      </Section>

      {/* --- one integration --------------------------------------------- */}
      <Section
        tone="raised"
        eyebrow={<span>Integration</span>}
        title="The same API you already have."
        lead="Crypto is a payment method on the existing endpoint, not a second platform bolted alongside. The object, the idempotency guarantees, the timeline and the webhooks are the ones your integration already handles."
      >
        <Split
          reverse
          panel={
            <Panel title="Response">
              <CodeBlock code={INVOICE_RESPONSE} language="json" />
            </Panel>
          }
        >
          <p className="text-[15.5px] leading-[1.75] text-mist-400">
            A merchant that has integrated cards through NATIO adds on-chain acceptance by sending a different <code className="font-mono text-[13.5px] text-mist-200">method</code> and a settlement account. The
            response carries the address to display, the exact expected amount and the confirmation threshold, so a checkout page can
            render a QR code without knowing anything about chains.
          </p>
          <p className="mt-5 text-[15.5px] leading-[1.75] text-mist-400">
            Everything downstream is unchanged. The payment appears in the same transaction monitor with the same timeline, the same
            signed webhook contract fires, and it reconciles in the same report as every other method.
          </p>
          <div className="mt-7">
            <SecondaryCta href="/docs/quickstart">Read the quickstart</SecondaryCta>
          </div>
        </Split>
      </Section>

      {/* --- compliance --------------------------------------------------- */}
      <Section
        eyebrow={<span>Compliance</span>}
        title="What the engine enforces, and what it does not yet."
        lead="Non-custodial does not mean unregulated. Two of these controls are in the engine today and a merchant cannot configure their way out of them. Two are not built, and are named here rather than left to be discovered during an audit."
      >
        <SpecList items={COMPLIANCE_TODAY} />

        <div className="mt-12 border-t border-night-700 pt-8">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <Chip tone="warn">Not built</Chip>
            <span className="text-[13px] text-mist-600">Described because it is planned, listed here because it does not exist yet.</span>
          </div>
          <SpecList items={COMPLIANCE_NOT_BUILT} />
        </div>
      </Section>

      {/* --- honest status ------------------------------------------------ */}
      <Section
        tone="raised"
        eyebrow={<span>Status</span>}
        title="What exists, and what does not."
        lead="A landing page is a promise. These are the parts of it we can currently keep."
      >
        <FeatureGrid cols={4}>
          <Feature index="01" title="Built" mono="orchestration">
            Payments, payouts, routing across providers, retry and failover, reconciliation, settlement reporting, signed webhooks, the
            merchant dashboard and the developer portal. Tested end to end.
          </Feature>
          <Feature index="02" title="Built" mono="crypto">
            Address derivation from a merchant xpub, a fresh address per invoice, chain watching on TRON and Bitcoin with confirmation
            handling, and the underpayment and overpayment outcomes described above. Ethereum, BSC and Polygon derive addresses but are
            not watched yet, so a payment on those is not noticed automatically.
          </Feature>
          <Feature index="03" title="Not built" mono="compliance">
            Sanctions screening and KYB, as set out above. The audit trail and provider eligibility checks are in place; the identity
            and screening controls are not.
          </Feature>
          <Feature index="04" title="Not yet decided" mono="scope">
            Supported assets and networks, and which jurisdictions can be served. Both follow from where the operating entity is
            incorporated and what its counsel advises. Published when settled.
          </Feature>
        </FeatureGrid>
        <p className="mt-10 max-w-[720px] text-[14.5px] leading-[1.75] text-mist-600">
          NATIO is a payment technology platform. It is not a bank, an acquirer, a payment institution or an electronic money
          institution, it holds no such licence, and it neither accepts nor holds customer funds. Payment processing and settlement in
          fiat are performed by licensed providers connected to the platform.
        </p>
      </Section>

      <CtaBand
        title="Tell us what you are selling and where."
        lead="Market, volume and method mix decide what gets built first. A short description is more useful to us than a signup, and more useful to you than a waitlist."
        primary={<PrimaryCta href="/contact" size="lg">Talk to us</PrimaryCta>}
        secondary={
          <SecondaryCta href="/wallet" size="lg">
            Natio Wallet
          </SecondaryCta>
        }
      />
    </>
  );
}

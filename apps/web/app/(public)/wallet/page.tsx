import type { Metadata } from "next";
import Link from "next/link";
import { CustodyVisual } from "@/components/marketing/custody-visual";
import {
  Accent,
  Chip,
  Container,
  CtaBand,
  Eyebrow,
  Feature,
  FeatureGrid,
  GridBackdrop,
  Panel,
  PrimaryCta,
  SecondaryCta,
  Section,
  SpecList,
  Split,
} from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Natio Wallet",
  description:
    "A non-custodial wallet for paying and being paid on-chain. Keys are generated on your device and never leave it; NATIO holds an extended public key for watching addresses and nothing else.",
};

/**
 * Natio Wallet — the payer-facing half of the client layer.
 *
 * Every claim here has to survive a hostile reading, because non-custody is
 * the whole product and a vague promise is worse than none. So the page says
 * what NATIO stores, what it can do with that, and what happens when NATIO is
 * gone — and it states plainly that the product is still being built rather
 * than implying a live service.
 */

const CAN: Array<{ term: string; detail: string }> = [
  { term: "Derive watch addresses", detail: "From the extended public key you share, NATIO can generate a fresh receiving address per invoice. Addresses only." },
  { term: "Read the chain", detail: "It watches those addresses for incoming transactions and counts confirmations against a public node." },
  { term: "Tell you what happened", detail: "It records the payment, matches it to an invoice and emits a signed webhook. This is bookkeeping, not control." },
];

const CANNOT: Array<{ term: string; detail: string }> = [
  { term: "Move your funds", detail: "Spending requires a private key. NATIO never receives one, so there is no request, court order or breach that produces a transfer." },
  { term: "Freeze a balance", detail: "Your balance lives on a public chain in addresses only you can spend from. NATIO can stop serving you; it cannot stop your money." },
  { term: "Lose your wallet for you", detail: "If NATIO shuts down, your seed phrase still opens the same wallet in any standard client. Nothing about recovery depends on us existing." },
];

const KEY_FACTS: Array<{ term: string; detail: string }> = [
  { term: "What is generated on your device", detail: "The seed phrase and every private key derived from it. They are produced in your browser or app and are never transmitted." },
  { term: "What NATIO receives", detail: "An extended public key (xpub). It allows address derivation and balance watching, and nothing else — it is mathematically incapable of signing." },
  { term: "What NATIO stores about you", detail: "Account identifier, the xpub, derived addresses, and observed on-chain transactions. No seed, no key, no document images." },
  { term: "Where verification data would go", detail: "To an identity provider, when a jurisdiction requires it, so NATIO keeps the decision and a reference rather than your passport scan. This is the intended design; no identity provider is connected yet." },
];

export default function WalletPage() {
  return (
    <>
      {/* --- hero ------------------------------------------------------- */}
      <div className="relative overflow-hidden border-b border-night-700 bg-night-950">
        <GridBackdrop />
        <Container className="relative py-16 md:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1fr_minmax(0,520px)]">
            <div className="max-w-[640px]">
              <Eyebrow className="mb-5" tone="lime">
                Natio Wallet
              </Eyebrow>
              <h1 className="text-[42px] font-medium leading-[1.0] tracking-[-0.034em] text-mist-50 md:text-[68px]">
                Your keys.
                <br />
                <Accent tone="lime">Your funds.</Accent>
              </h1>
              <p className="mt-7 max-w-[560px] text-[16.5px] leading-[1.7] text-mist-400 md:text-[17.5px]">
                A wallet you hold, used to pay merchants directly on-chain. The seed phrase is generated on your device and stays
                there. NATIO gets an extended public key so it can watch for incoming payments — which is enough to tell you a payment
                arrived, and not nearly enough to move it.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <PrimaryCta href="/contact">Request early access</PrimaryCta>
                <SecondaryCta href="#custody">How custody works</SecondaryCta>
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-2">
                <Chip tone="warn">In development</Chip>
                <span className="text-[13px] text-mist-600">Not yet accepting deposits — see status below.</span>
              </div>
            </div>
            <Panel glow padded={false} className="p-6 md:p-8">
              <CustodyVisual className="h-auto w-full" />
            </Panel>
          </div>
        </Container>
      </div>

      {/* --- what non-custodial means, concretely ------------------------ */}
      <Section
        id="custody"
        grid
        eyebrow={<span>Custody</span>}
        title="“Non-custodial” is a claim about what we cannot do."
        lead="Plenty of services call themselves non-custodial and still hold a key that can move your balance. The distinction that matters is not policy but capability, so here is exactly what changes hands."
        aside={
          <>
            An extended public key derives addresses and watches balances. Signing a transaction requires the private key it was
            derived from, and that derivation only runs one way.
          </>
        }
      >
        <div className="grid gap-5 md:grid-cols-2">
          <Panel title="What NATIO can do">
            <SpecList items={CAN} />
          </Panel>
          <Panel title="What NATIO cannot do">
            <SpecList items={CANNOT} />
          </Panel>
        </div>
      </Section>

      {/* --- data handling ---------------------------------------------- */}
      <Section
        tone="raised"
        eyebrow={<span>Data</span>}
        title="What actually leaves your device."
        lead="Non-custody is worth little if the surrounding service quietly collects everything else. These are the four answers that decide how much trust the product needs."
      >
        <SpecList items={KEY_FACTS} />
      </Section>

      {/* --- identity ---------------------------------------------------- */}
      <Section
        eyebrow={<span>Identity</span>}
        title="Verification only where the law asks for it."
        lead="Holding your own keys does not exempt anyone from the rules that apply to the service connecting you to a merchant. This is how verification is meant to work here — described in the future tense because none of it is connected yet."
      >
        <Split
          panel={
            <Panel title="How a check would run">
              <SpecList
                items={[
                  { term: "1 · Triggered by rule", detail: "A jurisdiction, an amount threshold or a merchant's own policy would ask for verification. Nothing requested speculatively." },
                  { term: "2 · Performed by the provider", detail: "You would complete the check with the identity provider directly. Documents and biometrics go to them, not to NATIO." },
                  { term: "3 · Recorded as a decision", detail: "NATIO would store the outcome, the provider's reference and the time — enough for a later audit to prove the check happened, without the platform holding the evidence." },
                ]}
              />
            </Panel>
          }
        >
          <p className="text-[15.5px] leading-[1.75] text-mist-400">
            Keeping identity documents is a liability, not an asset. Every copy is a breach waiting for an occasion, and once you hold
            one you inherit the obligations that come with it. The design here is deliberate: the platform learns whether you passed,
            when, and under which provider reference — enough to answer a regulator, and nothing that is worth stealing.
          </p>
          <p className="mt-5 text-[15.5px] leading-[1.75] text-mist-400">
            Sanctions and watchlist screening belongs on the platform side, against published lists, on the account and on
            counterparties — not optional and not dependent on which jurisdiction you are in. It is not implemented today. A screening
            claim is the kind nobody re-checks, so it is worth being exact about: NATIO does not screen anyone yet.
          </p>
        </Split>
      </Section>

      {/* --- honest status ------------------------------------------------ */}
      <Section
        tone="raised"
        eyebrow={<span>Status</span>}
        title="Where this is today."
        lead="The orchestration platform behind NATIO is built and running. The wallet layer described on this page is not — and we would rather say so than let a landing page imply otherwise."
      >
        <FeatureGrid cols={3}>
          <Feature index="01" title="Built and running" mono="platform">
            The payment orchestration core — routing, retries, failover across providers, reconciliation, settlement reporting and
            signed webhooks — exists, is tested and is what this site documents.
          </Feature>
          <Feature index="02" title="Designed, not shipped" mono="wallet">
            Address derivation from a merchant or payer xpub, per-invoice addresses, confirmation tracking and the custody model shown
            above. Specified in detail; implementation in progress.
          </Feature>
          <Feature index="03" title="Depends on decisions" mono="coverage">
            Which chains and assets are supported, and which jurisdictions can be served, follow from the operating entity and its
            legal advice. We will publish the list when it is real rather than guess at it now.
          </Feature>
        </FeatureGrid>
        <p className="mt-10 max-w-[720px] text-[14.5px] leading-[1.75] text-mist-600">
          NATIO is a payment technology platform. It is not a bank, an acquirer, a payment institution or an electronic money
          institution, it holds no such licence, and it does not accept or hold customer funds. Anything on this page describing the
          wallet layer is a description of what is being built.
        </p>
      </Section>

      <CtaBand
        title="Want to be told when it opens?"
        lead="Leave a line about what you are building and which markets you care about. That shapes what gets implemented first far more than a waitlist counter does."
        primary={<PrimaryCta href="/contact" size="lg">Get in touch</PrimaryCta>}
        secondary={
          <SecondaryCta href="/business" size="lg">
            Natio Business
          </SecondaryCta>
        }
      />
    </>
  );
}

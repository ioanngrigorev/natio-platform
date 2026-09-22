import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand, Feature, FeatureGrid, PageIntro, PrimaryCta, Prose, SecondaryCta, Section, SpecList, Split, Panel } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Company",
  description: "NATIO builds payment orchestration infrastructure: one integration for merchants, provider neutrality, no custody of funds, minimal PCI scope and an auditable record of every decision.",
};

const PRINCIPLES: Array<{ title: string; body: string }> = [
  {
    title: "Orchestration, not intermediation",
    body: "NATIO is a technology infrastructure layer. It decides where a payment goes and records what happened; the regulated act of processing stays with the licensed providers connected to the platform.",
  },
  {
    title: "Provider neutrality",
    body: "The platform is not a front end for one provider. Adapters normalise every connection to the same interface, and routing rules belong to the merchant — including the rule that moves volume away from a provider.",
  },
  {
    title: "No custody",
    body: "NATIO does not hold or take customer funds. Money moves between the merchant and licensed providers, which settle directly. That constraint shapes the product: balances and settlements are reported, not held.",
  },
  {
    title: "Minimal PCI scope",
    body: "Card data never touches NATIO. Entry and tokenisation happen at PCI-compliant providers through hosted pages, which keeps a merchant integration in the smallest assessment scope.",
  },
  {
    title: "Auditability",
    body: "Every routing decision, risk decision, provider attempt, retry and configuration change is written down and readable afterwards. A payment platform that cannot explain itself is not finished.",
  },
  {
    title: "Determinism before intelligence",
    body: "Rules first, transparent scoring second, learned ranking only when there is enough of a merchant's own data to justify it — and always with the inputs on the record.",
  },
];

const PHASES: Array<{ phase: string; title: string; status: string; body: string }> = [
  {
    phase: "Phase 1",
    title: "The orchestration technology layer",
    status: "What exists today",
    body: "One REST API for payments, refunds and payouts; the orchestration engine with risk evaluation, rule-based routing, retry and failover with double-charge protection; the provider adapter architecture; webhooks; reconciliation, settlement visibility and analytics; the merchant dashboard; and a sandbox with demo providers that reproduce real failure paths.",
  },
  {
    phase: "Phase 2",
    title: "Breadth of connectivity",
    status: "Next",
    body: "More provider integrations across acquirers, PSPs, banks and local payment methods, and direct provider report imports for reconciliation in place of file uploads. The architecture is prepared to connect global and local providers; each connection is a commercial and technical integration, and we describe one only once it exists.",
  },
  {
    phase: "Phase 3",
    title: "Deeper routing and operations",
    status: "Planned",
    body: "Richer routing inputs and a learned ranker on top of the existing scoring function, more operational tooling for finance and support teams, and deeper settlement reporting. The extension points are already in the engine: the ranking function takes candidates, statistics and context, and returns an ordered list.",
  },
  {
    phase: "Phase 4",
    title: "Regulated entities — a possibility, not a promise",
    status: "Conditional",
    body: "In the longer term NATIO may seek its own licences and operate regulated entities in selected markets. This would happen only if and when the relevant authorisations are obtained. Until then — and today — NATIO is not a bank, an acquirer, a payment institution or an e-money institution, and every regulated service is performed by the licensed providers connected to the platform.",
  },
];

export default function CompanyPage() {
  return (
    <>
      <PageIntro
        eyebrow="Company"
        title="We build the layer that makes payment providers interchangeable."
        lead="NATIO is a payment orchestration company. We build the infrastructure that lets a business integrate once and then change providers, add markets and add payment methods as configuration — without rewriting its checkout, its ledger or its reporting each time."
        actions={
          <>
            <PrimaryCta />
            <SecondaryCta />
          </>
        }
      />

      <Section eyebrow="Why" title="Payment infrastructure is fragmented, and the cost lands on the merchant." lead="Every provider has its own API, its own status vocabulary, its own failure codes, its own report format and its own settlement rhythm. A business operating in more than one market ends up maintaining all of them.">
        <Split
          panel={
            <Panel title="What that fragmentation costs">
              <SpecList
                className="border-y-0"
                items={[
                  { term: "Engineering", detail: "A new market or method means another integration, another set of edge cases, another retry policy to reason about." },
                  { term: "Approval rates", detail: "Without failover a single provider incident becomes lost revenue, and without comparable data there is no basis for moving traffic." },
                  { term: "Operations", detail: "Support reconstructs what happened from provider dashboards; finance reconciles incompatible reports by hand." },
                  { term: "Leverage", detail: "The harder a provider is to replace, the weaker the merchant's position in every conversation about pricing and terms." },
                ]}
              />
            </Panel>
          }
        >
          <Prose className="max-w-[560px]">
            <p>
              Orchestration is the answer to a structural problem, not a feature. When provider connectivity is a layer rather than a set of point integrations, adding a country is configuration, a provider outage is a fallback instead of an incident, and the question of which provider performs best is answered from your own data.
            </p>
            <p>
              We are building that layer deliberately narrowly. NATIO does not hold funds, does not touch card data and does not compete with the providers it connects to. It does one thing: decide, execute and record — for every payment, every payout and every provider, the same way.
            </p>
          </Prose>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link href="/product" className="text-[13px] font-medium text-iris hover:underline">
              What the platform does →
            </Link>
            <Link href="/orchestration" className="text-[13px] font-medium text-iris hover:underline">
              How the engine works →
            </Link>
          </div>
        </Split>
      </Section>

      <Section tone="raised" eyebrow="Principles" title="The constraints we chose." lead="These are design decisions, and they are the reason the product looks the way it does.">
        <div className="grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
          {PRINCIPLES.map((p, i) => (
            <div key={p.title} className="border-t border-night-700 pt-4">
              <span className="font-mono text-[11px] text-mist-600">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-2 text-[15px] font-medium text-mist-50">{p.title}</h3>
              <p className="mt-2 text-[14px] leading-6 text-mist-400">{p.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="Approach" title="A phased build, described honestly." lead="We say what exists today, what is being built next, and what would depend on conditions outside an engineering roadmap.">
        <div className="divide-y divide-night-700 border-y border-night-700">
          {PHASES.map((p) => (
            <div key={p.phase} className="grid grid-cols-1 gap-3 py-7 md:grid-cols-[200px_1fr] md:gap-10">
              <div>
                <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-mist-600">{p.phase}</div>
                <div className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-iris">{p.status}</div>
              </div>
              <div className="min-w-0">
                <h3 className="text-[17px] font-medium tracking-[-0.012em] text-mist-50">{p.title}</h3>
                <p className="mt-2.5 max-w-[680px] text-[14.5px] leading-[1.7] text-mist-400">{p.body}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="raised" eyebrow="How we describe ourselves" title="What NATIO is, in plain terms." lead="Payments attract loose language. We would rather be precise, including about what we are not.">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          <div>
            <h3 className="text-[14px] font-medium text-mist-50">NATIO is</h3>
            <SpecList
              className="mt-3"
              items={[
                { term: "A technology company", detail: "We build software: an API, an orchestration engine, provider adapters and the operational tooling around them." },
                { term: "A payment orchestration platform", detail: "One integration for the merchant, connectivity to multiple providers, and the routing policy that decides between them." },
                { term: "An infrastructure layer", detail: "Positioned between merchant systems and licensed payment providers, with no role in the commercial relationship between them beyond connecting it." },
              ]}
            />
          </div>
          <div>
            <h3 className="text-[14px] font-medium text-mist-50">NATIO is not</h3>
            <SpecList
              className="mt-3"
              items={[
                { term: "A bank or an acquirer", detail: "We do not acquire transactions, issue instruments or provide accounts." },
                { term: "A payment institution or EMI", detail: "We do not perform regulated payment services and do not hold client money. Providers connected to the platform do, under their own authorisations." },
                { term: "A custodian", detail: "Funds move between the merchant and licensed providers, which settle directly. NATIO reports settlement data; it does not hold it." },
              ]}
            />
          </div>
        </div>
      </Section>

      <Section eyebrow="Working with us" title="Who we build for." lead="Teams that have outgrown a single provider, or expect to.">
        <FeatureGrid cols={3}>
          <Feature index={1} title="Engineering teams">
            One contract to integrate, an OpenAPI specification, a sandbox that reproduces the failure paths, and no hidden behaviour between the request and the provider.
          </Feature>
          <Feature index={2} title="Finance and operations">
            Reconciliation against provider reports, settlement visibility per provider and currency, and a timeline that answers support questions without a second dashboard.
          </Feature>
          <Feature index={3} title="Decision makers">
            Provider-neutral infrastructure, comparable performance and cost data from your own traffic, and the ability to change providers without changing your systems.
          </Feature>
        </FeatureGrid>
        <div className="mt-10">
          <Link href="/contact" className="text-[13px] font-medium text-iris hover:underline">
            Talk to the team →
          </Link>
        </div>
      </Section>

      <CtaBand title="Tell us about your payment stack." lead="Markets, methods, providers and the parts that currently hurt. We will tell you plainly whether orchestration helps, and what it would take." />
    </>
  );
}

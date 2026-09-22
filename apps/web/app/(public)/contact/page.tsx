import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/marketing/contact-form";
import { Container, Eyebrow, GridBackdrop, Section, SpecList } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Contact",
  description: "Tell us about your markets, payment methods and providers. We will reply with a straight answer about whether payment orchestration helps and what an integration would involve.",
};

export default function ContactPage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-night-700 bg-night-950">
        <GridBackdrop />
        <div aria-hidden className="pointer-events-none absolute right-[-12%] top-[-24%] h-[520px] w-[520px] rounded-full bg-iris/10 blur-[130px]" />
        <Container className="relative py-16 md:py-24">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:gap-16">
            <div>
              <Eyebrow className="mb-5">Contact</Eyebrow>
              <h1 className="text-[36px] font-medium leading-[1.04] tracking-[-0.032em] text-mist-50 md:text-[48px]">Talk to us about your payment stack.</h1>
              <p className="mt-6 text-[16.5px] leading-[1.7] text-mist-400 md:text-[17px]">
                Whether you are evaluating orchestration, planning an integration, or want to see the routing and reconciliation tooling on your own scenarios — send a short note and a person will answer it.
              </p>

              <div className="mt-12">
                <Eyebrow className="mb-5" tone="mist">
                  What happens next
                </Eyebrow>
                <ol className="divide-y divide-night-700 border-t border-night-700">
                  {[
                    { step: "01", title: "We read it", body: "Your message is recorded with a reference and routed to the team; nothing is passed to a third party." },
                    { step: "02", title: "We reply by email", body: "To the address you provide, with a direct answer to what you asked rather than a brochure." },
                    { step: "03", title: "We go as deep as you want", body: "A technical walkthrough of the API and the orchestration engine, a look at the dashboard, or a sandbox account to try it yourself." },
                  ].map((s) => (
                    <li key={s.step} className="grid grid-cols-[32px_1fr] gap-3 py-4">
                      <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-mist-600">{s.step}</span>
                      <div>
                        <div className="text-[14.5px] font-medium text-mist-50">{s.title}</div>
                        <p className="mt-1.5 text-[13.5px] leading-[1.7] text-mist-400">{s.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <div className="lg:pt-1">
              <ContactForm />
              <p className="mt-5 text-[12.5px] leading-[1.7] text-mist-400">
                Already integrating? The{" "}
                <Link href="/docs" className="font-medium text-iris hover:underline">
                  documentation
                </Link>{" "}
                and a{" "}
                <Link href="/dashboard/register" className="font-medium text-iris hover:underline">
                  sandbox account
                </Link>{" "}
                are available without talking to anyone.
              </p>
            </div>
          </div>
        </Container>
      </section>

      <Section tone="raised" eyebrow="Useful before you write" title="Answers you may not need to ask for." lead="Most first questions are already covered in detail on the site.">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          <SpecList
            items={[
              {
                term: (
                  <Link href="/product" className="text-iris hover:underline">
                    What the platform does
                  </Link>
                ),
                detail: "Modules, scope, and an explicit list of what NATIO deliberately does not do.",
              },
              {
                term: (
                  <Link href="/routing" className="text-iris hover:underline">
                    How routing works
                  </Link>
                ),
                detail: "Rule conditions, strategies, scoring factors and the failover safety rules.",
              },
              {
                term: (
                  <Link href="/developers" className="text-iris hover:underline">
                    Integration
                  </Link>
                ),
                detail: "The API surface, keys, webhooks, the sandbox and the OpenAPI specification.",
              },
            ]}
          />
          <SpecList
            items={[
              {
                term: (
                  <Link href="/reconciliation" className="text-iris hover:underline">
                    Funds and settlement
                  </Link>
                ),
                detail: "How reconciliation works, and why NATIO holds no customer funds.",
              },
              {
                term: (
                  <Link href="/company" className="text-iris hover:underline">
                    The company
                  </Link>
                ),
                detail: "What we build, the principles behind it and the phased roadmap.",
              },
              {
                term: (
                  <Link href="/docs/quickstart" className="text-iris hover:underline">
                    Quickstart
                  </Link>
                ),
                detail: "From a test key to a first payment and its timeline.",
              },
            ]}
          />
        </div>
      </Section>
    </>
  );
}

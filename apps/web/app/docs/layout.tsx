import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/marketing/footer";
import { SiteHeader } from "@/components/marketing/header";
import { DocsPager, DocsSidebar } from "@/components/docs/sidebar";

export const metadata: Metadata = {
  title: { default: "Documentation", template: "%s · NATIO Docs" },
  description: "Developer documentation for the NATIO Universal Payment API: quickstart, authentication, sandbox scenarios, payments, webhooks, errors and the full API reference.",
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-night-950">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col px-5 md:px-8 lg:flex-row lg:gap-12">
        <DocsSidebar />
        <main className="min-w-0 flex-1 py-10 md:py-14">
          <div className="prose-natio prose-dark max-w-[760px]">{children}</div>
          <div className="max-w-[760px]">
            <DocsPager />
          </div>
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}

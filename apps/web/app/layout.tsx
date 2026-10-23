import type { Metadata } from "next";
import "./globals.css";
import {getI18n} from "@/lib/i18n/server";
import {LocaleProvider,LanguagePicker} from "@/lib/i18n/provider";

export const metadata: Metadata = {
  title: { default: "NATIO — Payments. Orchestrated.", template: "%s · NATIO" },
  description: "Connect once. Route payments across providers, countries and payment methods through one infrastructure layer.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://natio.me"),
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const {locale,dictionary}=(await getI18n());
  return (
    <html lang={locale} dir={locale==='ar'?'rtl':'ltr'}>
      <body><LocaleProvider locale={locale} dictionary={dictionary}>{children}<div className="global-language-picker"><LanguagePicker compact/></div></LocaleProvider></body>
    </html>
  );
}

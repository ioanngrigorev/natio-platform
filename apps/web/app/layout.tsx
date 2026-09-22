import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "NATIO — Payments. Orchestrated.", template: "%s · NATIO" },
  description: "Connect once. Route payments across providers, countries and payment methods through one infrastructure layer.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://natio.me"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

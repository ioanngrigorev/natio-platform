export interface SiteLink {
  href: string;
  label: string;
}

/**
 * Primary header navigation (order matters).
 *
 * Kept to six. The header is a single flat row at desktop width, and the
 * capability pages (payments, payouts, routing, reconciliation) overflow it
 * once the two client products are added. They are one click away from
 * /product and listed in full in the footer, which is where someone looking
 * for a specific capability actually goes.
 */
export const PRIMARY_NAV: SiteLink[] = [
  { href: "/product", label: "Product" },
  { href: "/orchestration", label: "Orchestration" },
  { href: "/wallet", label: "Wallet" },
  { href: "/business", label: "Business" },
  { href: "/developers", label: "Developers" },
  { href: "/company", label: "Company" },
];

export const DOCS_NAV: Array<{ section: string; items: SiteLink[] }> = [
  {
    section: "Getting started",
    items: [
      { href: "/docs", label: "Overview" },
      { href: "/docs/quickstart", label: "Quickstart" },
      { href: "/docs/authentication", label: "Authentication" },
      { href: "/docs/sandbox", label: "Sandbox & test scenarios" },
    ],
  },
  {
    section: "Guides",
    items: [
      { href: "/docs/payments", label: "Payments" },
      { href: "/docs/webhooks", label: "Webhooks" },
      { href: "/docs/errors", label: "Errors & failure codes" },
    ],
  },
  {
    section: "Reference",
    items: [
      { href: "/docs/api-reference", label: "API reference" },
      { href: "/docs/sdks", label: "SDKs & clients" },
    ],
  },
];

export const FOOTER_COLUMNS: Array<{ title: string; links: SiteLink[] }> = [
  {
    title: "Products",
    links: [
      { href: "/wallet", label: "Natio Wallet" },
      { href: "/business", label: "Natio Business" },
    ],
  },
  {
    title: "Platform",
    links: [
      { href: "/product", label: "Product overview" },
      { href: "/orchestration", label: "Orchestration engine" },
      { href: "/payments", label: "Payments" },
      { href: "/payouts", label: "Payouts" },
      { href: "/routing", label: "Routing" },
      { href: "/reconciliation", label: "Reconciliation & settlement" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/developers", label: "Developer overview" },
      { href: "/docs", label: "Documentation" },
      { href: "/docs/quickstart", label: "Quickstart" },
      { href: "/docs/api-reference", label: "API reference" },
      { href: "/docs/webhooks", label: "Webhooks" },
      { href: "/docs/sandbox", label: "Sandbox" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/company", label: "About NATIO" },
      { href: "/contact", label: "Contact" },
      { href: "/dashboard/login", label: "Sign in" },
      { href: "/dashboard/register", label: "Start Integration" },
    ],
  },
];

export const LEGAL_LINE = "NATIO is a payment orchestration technology platform. Payment processing and settlement are performed by licensed payment providers connected to the platform.";

/**
 * Every public URL, used by the sitemap.
 *
 * Derived from the footer rather than the header: the header is trimmed for
 * layout, and a page missing from the sitemap is a page search engines never
 * see. Deduplicated because the same link legitimately appears in more than
 * one footer column.
 */
export const PUBLIC_ROUTES: string[] = Array.from(
  new Set([
    "/",
    ...PRIMARY_NAV.map((l) => l.href),
    ...FOOTER_COLUMNS.flatMap((c) => c.links.map((l) => l.href)),
    "/contact",
    ...DOCS_NAV.flatMap((s) => s.items.map((i) => i.href)),
  ]),
).filter((href) => !href.startsWith("/dashboard"));

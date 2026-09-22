const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XAF", "XOF"]);
const THREE_DECIMAL = new Set(["BHD", "KWD", "OMR", "JOD", "TND"]);

export function currencyExponent(currency: string): number {
  const c = currency.toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

/** Format minor units as a localized amount, e.g. 10000 USD → "100.00 USD". */
export function formatMoney(minor: number | null | undefined, currency: string | null | undefined, opts: { compact?: boolean; sign?: boolean } = {}): string {
  if (minor === null || minor === undefined || !currency) return "—";
  const exp = currencyExponent(currency);
  const major = minor / 10 ** exp;
  const abs = Math.abs(major);
  const formatted = opts.compact && abs >= 10000 ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(abs) : new Intl.NumberFormat("en-US", { minimumFractionDigits: exp, maximumFractionDigits: exp }).format(abs);
  const sign = major < 0 ? "−" : opts.sign && major > 0 ? "+" : "";
  return `${sign}${formatted} ${currency.toUpperCase()}`;
}

export function formatPercent(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function formatNumber(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(v);
}

export function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(d).replace(",", "") + " UTC";
}

/** With seconds — for timelines and audit trails. */
export function formatDateTimeFull(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" }).format(d).replace(",", "") + " UTC";
}

export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  return new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" }).format(d);
}

export function formatRelative(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  const diff = Date.now() - d.getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function formatMs(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v} ms`;
}

export function shortId(id: string | null | undefined, keep = 8): string {
  if (!id) return "—";
  if (id.length <= keep + 6) return id;
  const [prefix, rest] = id.split("_", 2);
  return rest ? `${prefix}_${rest.slice(0, keep)}…` : `${id.slice(0, keep)}…`;
}

export function titleCase(s: string | null | undefined): string {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
}

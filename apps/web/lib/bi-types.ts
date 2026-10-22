export interface BiMetrics { transactions: number; successful: number; failed: number; pending: number; volume: number; fees: number; payouts: number; ledger_net: number; settled: number }
export interface BiReport {
  analytics_snapshot_at?: string;
  currency: string; mode: "test" | "live"; period: { from: string; to: string };
  summary: BiMetrics; daily: Array<BiMetrics & { day: string }>;
  methods: Array<BiMetrics & { label: string }>; countries: Array<BiMetrics & { label: string }>;
  merchants: Array<BiMetrics & { label: string; merchant_id: string }>;
  statuses: Array<{ label: string; transactions: number }>;
  balances: Array<BiMetrics & { currency: string }>;
  options: { currencies: string[]; methods: string[] };
  coverage: { merchants: number; users: number; providers: number; transactions: number };
}

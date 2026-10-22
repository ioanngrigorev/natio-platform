export interface Tier {
  from: number;
  to: number | null;
  rateBps: number;
  fixed: number;
  minimum: number;
  maximum: number | null;
}
export interface Terms {
  name: string;
  side: "merchant" | "provider";
  currency: string;
  merchantId: string | null;
  providerAccountId: string | null;
  paymentMethod: string | null;
  country: string | null;
  priority: number;
  validFrom: string;
  validUntil: string | null;
  tiers: Tier[];
}
export interface PricePlan {
  id: string;
  familyId: string;
  revision: number;
  mode: string;
  status: string;
  terms: Terms;
  version: number;
}
export interface Fee {
  amount: number;
  source: string;
  planId: string | null;
  revision: number | null;
  name: string;
  tier: Tier;
}
export interface Quote {
  amount: number;
  currency: string;
  merchant: Fee;
  provider: Fee;
  margin: number;
  merchantNet: number;
  warnings: string[];
}
export interface Policy {
  profile?: "balanced" | "conversion" | "cost" | "reliability";
  maxAttempts?: number;
  maxElapsedMs?: number;
  retryOnSoftDecline?: boolean;
  retryOnTimeout?: boolean;
  minApprovalRate?: number;
  minUptime?: number;
  maxLatencyMs?: number;
  minSamples?: number;
  requireHealthData?: boolean;
  blockNegativeMargin?: boolean;
}
export const PROFILES = [
  {
    id: "balanced",
    title: "Balanced",
    text: "Conversion, cost and operational health",
    weights: "40 approval · 30 cost · 20 uptime · 10 latency",
  },
  {
    id: "conversion",
    title: "Conversion first",
    text: "Prioritise successful authorisations",
    weights: "65 approval · 10 cost · 20 uptime · 5 latency",
  },
  {
    id: "cost",
    title: "Cost first",
    text: "Rank by the PSP tariff for this amount",
    weights: "15 approval · 65 cost · 15 uptime · 5 latency",
  },
  {
    id: "reliability",
    title: "Reliability first",
    text: "Prioritise availability and response time",
    weights: "25 approval · 5 cost · 55 uptime · 15 latency",
  },
] as const;

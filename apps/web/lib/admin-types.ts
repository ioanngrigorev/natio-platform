/**
 * Response types for the internal admin API (/admin/*). Base entity types come from `@/lib/types`;
 * admin-only shapes live here. Raw drizzle rows (system events, routing/risk decisions) are camelCase
 * exactly as the API returns them.
 */
import type { Mode, Payment, Provider, ProviderAccount, Refund, TimelineEvent } from "./types";

export type AdminRole = "superadmin" | "operations" | "support" | "readonly";

export interface AdminMerchant {
  id: string;
  name: string;
  legal_name: string | null;
  country: string | null;
  website: string | null;
  registration_number: string | null;
  contact_email: string | null;
  kyb_status: string;
  status: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  users: number;
  payments_30d: number;
  live_volume_30d: number;
}

export interface AdminMerchantUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  mfa_enabled: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface AdminProject {
  id: string;
  merchant_id: string;
  name: string;
  slug: string;
  status: string;
  settings: { allowed_ips: string[]; allowed_domains: string[]; default_currency: string | null; capture_method: string; retry_policy: Record<string, unknown>; statement_descriptor: string | null };
  created_at: string;
  updated_at: string;
}

export type AdminMerchantDetail = Omit<AdminMerchant, "users" | "payments_30d" | "live_volume_30d"> & {
  users: AdminMerchantUser[];
  projects: AdminProject[];
  recent_payments: Payment[];
};

export interface SystemEvent {
  id: string;
  level: "info" | "warning" | "error";
  source: string;
  type: string;
  message: string;
  providerAccountId: string | null;
  merchantId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface AdminOverview {
  period: { from: string; to: string };
  payments: {
    merchants: number;
    total: number;
    successful: number;
    failed: number;
    pending: number;
    processing: number;
    volumes: Array<{ currency: string; tpv: number; fees: number }>;
  };
  merchants: { total: number; active: number; kybPending: number };
  providers: Provider[];
  health: Array<ProviderAccount["health"]>;
  recent_events: SystemEvent[];
}

export interface RoutingCandidate {
  providerAccountId: string;
  providerId: string;
  providerName: string;
  accountName: string;
  score: number;
  eligible: boolean;
  reasons: string[];
  factors?: Record<string, number>;
}

export interface RoutingDecision {
  id: string;
  paymentId: string | null;
  payoutId: string | null;
  routingRuleId: string | null;
  ruleName: string | null;
  strategy: string;
  candidates: RoutingCandidate[];
  selectedProviderAccountId: string | null;
  context: Record<string, unknown>;
  evaluatedAt: string;
}

export interface RiskDecision {
  id: string;
  paymentId: string;
  decision: "allow" | "review" | "block";
  score: number;
  matchedRules: Array<{ id: string; name: string; action: string; score: number }>;
  signals: Record<string, unknown>;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewOutcome: string | null;
  createdAt: string;
}

export type AdminPaymentDetail = Payment & {
  merchant: { id: string; name: string } | null;
  timeline: TimelineEvent[];
  refunds: Refund[];
  routing_decision: RoutingDecision | null;
  risk_decision: RiskDecision | null;
};

export interface RoutingSimulation {
  rule: { id: string; name: string } | null;
  strategy: string;
  reason: string;
  ordered: Array<{ provider_account_id: string; provider: string; account: string }>;
  candidates: RoutingCandidate[];
}

export interface HealthCheckResult {
  ok: boolean;
  latencyMs: number;
  message?: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  status: string;
  last_login_at: string | null;
  created_at: string;
}

export interface AdminUsersResponse {
  admins: AdminUser[];
  merchant_users: Array<AdminMerchantUser & { merchant_id: string; merchant_name: string }>;
  roles: AdminRole[];
}

export interface SettlementImportResult {
  data: Array<{ id: string; currency: string; net_amount: number; transaction_count: number }>;
}

export type { Mode };

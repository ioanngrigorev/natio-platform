export type Mode = "test" | "live";

export interface Paginated<T> {
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface Payment {
  id: string;
  mode: Mode;
  status: string;
  amount: number;
  currency: string;
  captured_amount: number;
  refunded_amount: number;
  capture_method: string;
  payment_method: { type: string; id: string | null };
  country: string | null;
  description: string | null;
  reference: string | null;
  customer: { id: string; external_id?: string | null; email?: string | null; name?: string | null; country?: string | null } | null;
  metadata: Record<string, unknown>;
  route: {
    provider: { id: string; code?: string; name?: string } | null;
    provider_account_id: string | null;
    provider_account_name: string | null;
    provider_payment_id: string | null;
    attempts: number;
    routing_decision_id: string | null;
    rule: string | null;
  };
  risk: { decision_id: string | null; score: number | null };
  failure: { code: string; category: string; message: string } | null;
  next_action: { type: string; url?: string; qrPayload?: string; expiresAt?: string } | null;
  fee: { amount: number; currency: string };
  processing_time_ms: number | null;
  test_scenario?: string | null;
  attempts?: Attempt[];
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

export interface Attempt {
  id: string;
  attempt_number: number;
  status: string;
  outcome: string | null;
  provider_id: string;
  provider_name: string | null;
  provider_account_id: string;
  provider_account_name: string | null;
  provider_payment_id: string | null;
  provider_code: string | null;
  provider_message: string | null;
  failure: { code: string; category: string; message: string } | null;
  fee_amount: number;
  latency_ms: number | null;
  request_sent_at: string | null;
  responded_at: string | null;
  created_at: string;
}

export interface TimelineEvent {
  id: string;
  type: string;
  title: string;
  description: string | null;
  attempt_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export interface Refund {
  id: string;
  payment_id: string;
  amount: number;
  currency: string;
  status: string;
  reason: string | null;
  provider_refund_id: string | null;
  failure: { code: string; message: string } | null;
  created_at: string;
}

export interface Transaction {
  id: string;
  mode: Mode;
  type: string;
  status: string;
  entity_type: string;
  entity_id: string;
  payment_id: string | null;
  amount: number;
  currency: string;
  fee_amount: number;
  net_amount: number;
  provider_account_id: string | null;
  provider_id: string | null;
  provider_name: string | null;
  provider_account_name: string | null;
  provider_reference: string | null;
  payment_method: string | null;
  country: string | null;
  processing_time_ms: number | null;
  failure_code: string | null;
  settlement_id: string | null;
  occurred_at: string;
}

export interface Payout {
  id: string;
  mode: Mode;
  status: string;
  amount: number;
  currency: string;
  destination: { type: string; display: string; holder_name: string | null; country: string | null };
  description: string | null;
  reference: string | null;
  route: { provider_id: string | null; provider_name: string | null; provider_account_id: string | null; provider_account_name: string | null; provider_payout_id: string | null; routing_decision_id: string | null };
  fee: { amount: number; currency: string };
  failure: { code: string; category: string; message: string } | null;
  created_at: string;
  processed_at: string | null;
}

export interface Settlement {
  id: string;
  mode: Mode;
  provider_account_id: string;
  provider_name: string | null;
  provider_account_name: string | null;
  settlement_entity: string | null;
  settlement_reference: string | null;
  currency: string;
  gross_amount: number;
  fee_amount: number;
  net_amount: number;
  transaction_count: number;
  period_start: string;
  period_end: string;
  status: string;
  source: string;
  settled_at: string | null;
  created_at: string;
  items?: Array<{ transaction_id: string; type: string; entity_id: string; amount: number; fee_amount: number; occurred_at: string }>;
}

export interface Balance {
  currency: string;
  processed_gross: number;
  fees: number;
  processed_net: number;
  settled_by_providers: number;
  awaiting_provider_settlement: number;
  payouts_sent: number;
  note: string;
}

export interface ReconBatch {
  id: string;
  mode: Mode;
  merchant_id: string | null;
  provider_account_id: string;
  provider_name: string | null;
  provider_account_name: string | null;
  source: string;
  file_name: string | null;
  period_start: string | null;
  period_end: string | null;
  status: string;
  totals: { total: number; MATCHED: number; MISSING_PROVIDER: number; MISSING_NATIO: number; AMOUNT_MISMATCH: number; STATUS_MISMATCH: number };
  created_at: string;
  completed_at: string | null;
  items?: ReconItem[];
}

export interface ReconItem {
  id: string;
  status: string;
  transaction_id: string | null;
  payment_id: string | null;
  provider_reference: string | null;
  natio_amount: number | null;
  provider_amount: number | null;
  currency: string | null;
  natio_status: string | null;
  provider_status: string | null;
  notes: string | null;
  resolved_at: string | null;
}

export interface WebhookEndpoint {
  id: string;
  mode: Mode;
  project_id: string;
  url: string;
  description: string | null;
  events: string[];
  status: string;
  secret_prefix: string;
  created_at: string;
}

export interface WebhookDelivery {
  id: string;
  endpoint_id: string;
  endpoint_url: string | null;
  merchant_id: string;
  event_id: string;
  event_type: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_response_status: number | null;
  last_response_body: string | null;
  last_error: string | null;
  delivered_at: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  attempts?: Array<{ id: string; attempt_number: number; request_headers: Record<string, string>; response_status: number | null; response_body: string | null; error: string | null; duration_ms: number | null; manual: boolean; created_at: string }>;
}

export interface ApiKey {
  id: string;
  name: string;
  mode: Mode;
  prefix: string;
  project_id: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface ProviderAccount {
  id: string;
  provider_id: string;
  provider_name: string | null;
  provider_code: string | null;
  provider_type: string | null;
  merchant_id: string | null;
  mode: Mode;
  name: string;
  status: string;
  priority: number;
  has_credentials: boolean;
  config: { simulation?: { forceOutcome?: string | null; technicalErrorRate?: number; latencyMs?: number } };
  fee_percent: number;
  fee_fixed_minor: number;
  limits: { minAmount?: number; maxAmount?: number };
  currencies: string[];
  health: HealthStats | null;
}

export interface HealthStats {
  provider_account_id: string;
  window_hours: number;
  attempts: number;
  successes: number;
  declines: number;
  technical_failures: number;
  approval_rate: number | null;
  uptime: number | null;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  last_error_at: string | null;
}

export interface Provider {
  id: string;
  code: string;
  name: string;
  type: string;
  adapter_key: string;
  status: string;
  supported_methods: string[];
  supported_currencies: string[];
  supported_countries: string[];
  capabilities: Record<string, boolean>;
  settlement_entity: string | null;
  description: string | null;
  adapter_registered: boolean;
  accounts: ProviderAccount[];
}

export interface RoutingRule {
  id: string;
  merchantId: string | null;
  projectId: string | null;
  mode: Mode;
  name: string;
  description: string | null;
  priority: number;
  enabled: boolean;
  transactionType: string;
  conditions: Array<{ field: string; op: string; value: string | number | Array<string | number> }>;
  strategy: string;
  createdAt: string;
  routes: Array<{ id: string; provider_account_id: string; account_name: string; provider_id: string; provider_name: string; position: number; weight: number }>;
}

export interface RiskRule {
  id: string;
  merchantId: string | null;
  mode: Mode;
  name: string;
  description: string | null;
  priority: number;
  enabled: boolean;
  conditions: Array<{ field: string; op: string; value: string | number | Array<string | number> }>;
  action: string;
  score: number;
  createdAt: string;
}

export interface AnalyticsOverview {
  currency: string | null;
  period: { from: string; to: string };
  tpv: number;
  net_revenue: number;
  refunded: number;
  processing_cost: number;
  average_ticket: number;
  transactions: number;
  successful: number;
  failed: number;
  in_flight: number;
  success_rate: number | null;
  approval_rate: number | null;
  provider_uptime: number | null;
  avg_processing_ms: number | null;
}

export interface TimeseriesPoint {
  t: string;
  tpv: number;
  transactions: number;
  successful: number;
  failed: number;
  success_rate: number | null;
}

export interface BreakdownRow {
  key: string;
  transactions: number;
  successful: number;
  failed: number;
  tpv: number;
  success_rate: number | null;
}

export interface Breakdowns {
  by_country: { currency: string | null; rows: BreakdownRow[] };
  by_currency: { currency: string | null; rows: BreakdownRow[] };
  by_method: { currency: string | null; rows: BreakdownRow[] };
  by_provider: { currency: string | null; rows: BreakdownRow[] };
  decline_reasons: { rows: Array<{ key: string; transactions: number; category: string | null }> };
}

export interface ProviderComparisonRow {
  provider_account_id: string;
  provider: string;
  account: string;
  volume: number;
  transactions: number;
  success_rate: number | null;
  cost: number;
  avg_latency_ms: number | null;
  uptime: number | null;
}

export interface AuditEntry {
  id: string;
  actor_type: string;
  actor_id?: string | null;
  actor_label: string | null;
  merchant_id?: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  request_id?: string | null;
  created_at: string;
}

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  mfa_enabled: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface Merchant {
  id: string;
  name: string;
  legal_name: string | null;
  country: string | null;
  website: string | null;
  registration_number: string | null;
  contact_email: string | null;
  kyb_status: string;
  status: string;
  /** Stored as camelCase by the API; PATCH /dashboard/merchant accepts snake_case. */
  settings: { industry?: string | null; defaultCurrency?: string | null; timezone?: string | null };
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  merchant_id: string;
  name: string;
  slug: string;
  status: string;
  settings: {
    allowed_ips: string[];
    allowed_domains: string[];
    default_currency: string | null;
    capture_method: string;
    /** Stored as camelCase by the API; PATCH /dashboard/projects/{id} accepts snake_case. */
    retry_policy: { maxAttempts?: number; retryOnSoftDecline?: boolean; retryOnTimeout?: boolean };
    statement_descriptor: string | null;
  };
  created_at: string;
  updated_at: string;
}

export interface SystemStatus {
  api: string;
  queue_driver: string;
  providers: Array<{ provider: string; account: string; status: string; health_1h: HealthStats | null; health_24h: HealthStats | null }>;
}

export interface TestScenario {
  name: string;
  description: string;
}

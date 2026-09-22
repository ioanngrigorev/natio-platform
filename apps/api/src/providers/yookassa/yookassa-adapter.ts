/**
 * ЮKassa (YooKassa) connector — NATIO's first adapter against a real provider.
 *
 * The same adapter serves both ways NATIO can use ЮKassa, because the
 * difference is whose credentials sit on the provider account, not the code:
 * a shop that belongs to NATIO collects NATIO's own subscription revenue, and a
 * shop that belongs to a merchant (a provider account with `merchantId` set)
 * routes that merchant's own payments. Nothing here needs to know which.
 *
 * Three things about this provider shape the implementation more than the rest:
 *
 *  1. ЮKassa does not sign its webhooks. There is no HMAC, no shared secret —
 *     notifications are plain JSON from an IP range. Trusting that body would
 *     mean anyone who learns a payment id can post "succeeded" to us. So
 *     `verifyWebhook` treats the notification purely as a hint and re-fetches
 *     the object from the API over authenticated TLS. The fetched object is
 *     the truth; the body is only a nudge to go and look.
 *
 *  2. Amounts cross the boundary as decimal strings ("1499.00") while NATIO
 *     holds integer minor units. Every conversion here is integer arithmetic
 *     on digits. Nothing touches a float, for the same reason the ledger
 *     stores exact decimals: a payment system that rounds is a payment system
 *     that is wrong by an amount nobody can predict.
 *
 *  3. The Idempotence-Key header is mandatory on writes and ЮKassa honours it
 *     by returning the ORIGINAL object rather than creating a second one. That
 *     turns a network retry from a double-charge risk into a no-op, so the key
 *     is always derived from NATIO's own id for the operation, never random.
 */
import { randomUUID } from "node:crypto";
import type {
  CreatePaymentInput,
  CreatePayoutInput,
  NormalizedProviderEvent,
  ProviderAdapter,
  ProviderContext,
  ProviderLookupResult,
  ProviderOperationResult,
  ProviderPaymentResult,
  ProviderPaymentStatus,
  ProviderPayoutResult,
  WebhookVerification,
} from "../types.js";
import { ProviderTimeoutError, ProviderUnavailableError } from "../types.js";

const API_BASE = "https://api.yookassa.ru/v3";

/** Minor-unit exponent per currency. ЮKassa settles in RUB; the rest are for completeness. */
const CURRENCY_DECIMALS: Record<string, number> = { RUB: 2, USD: 2, EUR: 2, KZT: 2, BYN: 2, UZS: 2, CNY: 2 };

function decimalsFor(currency: string): number {
  return CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2;
}

// ---------------------------------------------------------------------------
// Money — integer arithmetic only, in both directions
// ---------------------------------------------------------------------------

/** 149900 minor units, RUB → "1499.00". No division, no Number rounding. */
export function toDecimalString(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor)) throw new Error(`amount is not an integer number of minor units: ${minor}`);
  const exp = decimalsFor(currency);
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exp + 1, "0");
  const whole = digits.slice(0, digits.length - exp);
  const frac = exp > 0 ? `.${digits.slice(digits.length - exp)}` : "";
  return `${negative ? "-" : ""}${whole}${frac}`;
}

/** "1499.00" → 149900. Rejects anything that is not an exact decimal for the currency. */
export function fromDecimalString(value: string, currency: string): number {
  const exp = decimalsFor(currency);
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new Error(`unparseable provider amount: ${JSON.stringify(value)}`);
  const [, sign, whole, frac = ""] = m;
  if (frac.length > exp) {
    // More precision than the currency has. Silently truncating would change
    // the amount, so refuse and let the caller surface it.
    throw new Error(`provider amount ${value} has more precision than ${currency} allows`);
  }
  const padded = frac.padEnd(exp, "0");
  const minor = Number(`${whole}${padded}`);
  if (!Number.isSafeInteger(minor)) throw new Error(`provider amount ${value} exceeds the safe integer range`);
  return sign === "-" ? -minor : minor;
}

// ---------------------------------------------------------------------------
// Decline mapping
//
// This table decides whether a failed payment is retried on another provider.
// Getting it wrong is not cosmetic in either direction: marking an expired card
// "soft" burns an attempt on something that cannot ever succeed, and marking a
// temporary issuer outage "hard" loses a payment that would have gone through
// on the second try.
// ---------------------------------------------------------------------------

const CANCELLATION_REASONS: Record<string, string> = {
  // Genuinely worth another attempt elsewhere.
  insufficient_funds: "insufficient_funds",
  issuer_unavailable: "issuer_unavailable",
  call_issuer: "do_not_honor",
  general_decline: "generic_decline",
  payment_method_limit_exceeded: "limit_exceeded",
  internal_timeout: "try_again_later",

  // Will fail identically everywhere. Never retry.
  card_expired: "expired_card",
  invalid_card_number: "invalid_card",
  invalid_csc: "invalid_card",
  fraud_suspected: "fraud_suspected",
  three_d_secure_failed: "authentication_failed",
  "3d_secure_failed": "authentication_failed",
  payment_method_restricted: "restricted_card",
  country_forbidden: "restricted_card",
  unsupported_mobile_operator: "invalid_account",
  identification_required: "invalid_account",
  permission_revoked: "provider_configuration_error",
  canceled_by_merchant: "cancelled_by_customer",
  expired_on_confirmation: "payment_expired",
  expired_on_capture: "payment_expired",
  deal_expired: "payment_expired",
};

export function mapCancellationReason(reason: string | undefined): string {
  if (!reason) return "generic_decline";
  return CANCELLATION_REASONS[reason] ?? "generic_decline";
}

/** Reasons that mean "do not try another provider with the same instrument". */
const HARD_REASONS = new Set([
  "expired_card",
  "invalid_card",
  "fraud_suspected",
  "authentication_failed",
  "restricted_card",
  "invalid_account",
  "cancelled_by_customer",
  "payment_expired",
]);

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

interface YooKassaCredentials {
  shopId: string;
  secretKey: string;
}

function credentialsOf(ctx: ProviderContext): YooKassaCredentials {
  const shopId = String(ctx.credentials.shop_id ?? ctx.credentials.shopId ?? "").trim();
  const secretKey = String(ctx.credentials.secret_key ?? ctx.credentials.secretKey ?? "").trim();
  if (!shopId || !secretKey) {
    throw new ProviderUnavailableError("ЮKassa credentials are missing shop_id or secret_key");
  }
  return { shopId, secretKey };
}

interface YooResponse<T> {
  status: number;
  body: T;
}

async function call<T>(
  ctx: ProviderContext,
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; idempotenceKey?: string } = {},
): Promise<YooResponse<T>> {
  const { shopId, secretKey } = credentialsOf(ctx);
  const auth = Buffer.from(`${shopId}:${secretKey}`).toString("base64");

  const headers: Record<string, string> = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
  };
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    // Required by ЮKassa on every write. Derived from our own id, so a retry
    // returns the original object instead of creating a second payment.
    headers["Idempotence-Key"] = opts.idempotenceKey ?? randomUUID();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch (err) {
    // An aborted request is a timeout, not a decline. The orchestrator treats
    // the two very differently, and conflating them is how double charges
    // happen — so the distinction is preserved all the way up.
    if (err instanceof Error && err.name === "AbortError") {
      throw new ProviderTimeoutError("ЮKassa did not respond within the configured timeout");
    }
    throw new ProviderUnavailableError(err instanceof Error ? err.message : "ЮKassa request failed");
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ProviderUnavailableError(`ЮKassa returned a non-JSON response (HTTP ${res.status})`);
    }
  }
  return { status: res.status, body: body as T };
}

// ---------------------------------------------------------------------------
// Response shapes (only the fields we rely on)
// ---------------------------------------------------------------------------

interface YooAmount {
  value: string;
  currency: string;
}

interface YooPayment {
  id: string;
  status: "pending" | "waiting_for_capture" | "succeeded" | "canceled";
  paid: boolean;
  amount: YooAmount;
  confirmation?: { type: string; confirmation_url?: string };
  cancellation_details?: { party: string; reason: string };
  metadata?: Record<string, string>;
  description?: string;
  created_at?: string;
}

interface YooRefund {
  id: string;
  status: "pending" | "succeeded" | "canceled";
  amount: YooAmount;
  payment_id: string;
  cancellation_details?: { party: string; reason: string };
}

interface YooError {
  type?: string;
  id?: string;
  code?: string;
  description?: string;
  parameter?: string;
}

interface YooList<T> {
  type: "list";
  items: T[];
  next_cursor?: string;
}

const NATIO_REFERENCE_KEY = "natio_payment_id";

function statusOf(p: YooPayment): ProviderPaymentStatus {
  switch (p.status) {
    case "succeeded":
      return "captured";
    case "waiting_for_capture":
      return "authorized";
    case "canceled":
      return "failed";
    case "pending":
    default:
      return "pending";
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class YooKassaAdapter implements ProviderAdapter {
  readonly key = "yookassa";
  readonly displayName = "ЮKassa";

  async createPayment(ctx: ProviderContext, input: CreatePaymentInput): Promise<ProviderPaymentResult> {
    const body: Record<string, unknown> = {
      amount: { value: toDecimalString(input.amount, input.currency), currency: input.currency.toUpperCase() },
      capture: input.captureMethod === "automatic",
      description: input.description?.slice(0, 128) ?? input.reference,
      // Carried so a timed-out attempt can still be located later.
      metadata: { ...(input.metadata ?? {}), [NATIO_REFERENCE_KEY]: input.paymentId },
    };

    if (input.paymentMethodToken) {
      // A saved method: charge it directly, no redirect.
      body.payment_method_id = input.paymentMethodToken;
    } else {
      body.confirmation = { type: "redirect", return_url: input.returnUrl };
    }

    const { status, body: res } = await call<YooPayment & YooError>(ctx, "POST", "/payments", {
      body,
      idempotenceKey: input.paymentId,
    });

    if (status >= 500) throw new ProviderUnavailableError(res.description ?? `ЮKassa HTTP ${status}`);
    if (status === 429) throw new ProviderUnavailableError("ЮKassa rate limit reached");
    if (status >= 400) {
      // A 4xx here is our request being wrong — bad credentials, a shop that
      // cannot take this amount, a malformed field. Retrying the same request
      // on another account will not fix our own payload, so this is technical
      // rather than a decline to cascade.
      return {
        outcome: "technical_error",
        providerCode: res.code,
        providerMessage: res.description ?? `ЮKassa rejected the request (HTTP ${status})`,
        failureCode: res.code === "invalid_credentials" ? "provider_configuration_error" : "technical_error",
        raw: res as unknown as Record<string, unknown>,
      };
    }

    return this.resultFromPayment(res);
  }

  private resultFromPayment(p: YooPayment): ProviderPaymentResult {
    const base = { providerPaymentId: p.id, status: statusOf(p), raw: p as unknown as Record<string, unknown> };

    if (p.status === "succeeded") return { ...base, outcome: "success" };
    if (p.status === "waiting_for_capture") return { ...base, outcome: "success" };

    if (p.status === "canceled") {
      const failureCode = mapCancellationReason(p.cancellation_details?.reason);
      return {
        ...base,
        outcome: HARD_REASONS.has(failureCode) ? "hard_decline" : "soft_decline",
        providerCode: p.cancellation_details?.reason,
        providerMessage: `ЮKassa cancelled the payment (${p.cancellation_details?.party ?? "unknown"}: ${p.cancellation_details?.reason ?? "no reason given"})`,
        failureCode,
      };
    }

    // pending: the customer still has to do something.
    const url = p.confirmation?.confirmation_url;
    if (url) {
      return { ...base, outcome: "requires_action", nextAction: { type: "redirect", url } };
    }
    return { ...base, outcome: "requires_action" };
  }

  async getPayment(ctx: ProviderContext, providerPaymentId: string): Promise<ProviderLookupResult> {
    const { status, body } = await call<YooPayment & YooError>(ctx, "GET", `/payments/${encodeURIComponent(providerPaymentId)}`);
    if (status === 404) return { found: false };
    if (status >= 400) throw new ProviderUnavailableError(body.description ?? `ЮKassa HTTP ${status}`);
    return {
      found: true,
      status: statusOf(body),
      amount: fromDecimalString(body.amount.value, body.amount.currency),
      capturedAmount: body.status === "succeeded" ? fromDecimalString(body.amount.value, body.amount.currency) : 0,
      providerPaymentId: body.id,
      raw: body as unknown as Record<string, unknown>,
    };
  }

  /**
   * Resolve a timed-out attempt.
   *
   * ЮKassa has no "search by merchant reference" endpoint, so this walks the
   * recent payment list and matches on the metadata we attached at creation.
   * The window is deliberately short: this is only ever called moments after a
   * timeout, and an unbounded scan would be both slow and wrong.
   *
   * Returning `found: false` tells the orchestrator a failover is safe. That
   * makes correctness here load-bearing — a false negative charges the
   * customer twice — so anything other than a clean, complete answer throws
   * instead, which parks the attempt as `unknown` and tries no one else.
   */
  async findPaymentByReference(ctx: ProviderContext, reference: string): Promise<ProviderLookupResult> {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { status, body } = await call<YooList<YooPayment> & YooError>(
      ctx,
      "GET",
      `/payments?limit=100&created_at.gte=${encodeURIComponent(since)}`,
    );
    if (status >= 400) throw new ProviderUnavailableError(body.description ?? `ЮKassa HTTP ${status}`);

    const match = (body.items ?? []).find((p) => p.metadata?.[NATIO_REFERENCE_KEY] === reference);
    if (!match) {
      // The list is capped at 100. If it was full we cannot distinguish "not
      // there" from "beyond the page", and guessing wrong means a double
      // charge — so refuse to answer rather than answer wrongly.
      if ((body.items ?? []).length >= 100) {
        throw new ProviderUnavailableError("ЮKassa payment list was truncated; cannot prove the payment is absent");
      }
      return { found: false };
    }
    return {
      found: true,
      status: statusOf(match),
      amount: fromDecimalString(match.amount.value, match.amount.currency),
      providerPaymentId: match.id,
      raw: match as unknown as Record<string, unknown>,
    };
  }

  async capturePayment(
    ctx: ProviderContext,
    input: { providerPaymentId: string; amount: number; currency: string },
  ): Promise<ProviderOperationResult> {
    const { status, body } = await call<YooPayment & YooError>(
      ctx,
      "POST",
      `/payments/${encodeURIComponent(input.providerPaymentId)}/capture`,
      {
        body: { amount: { value: toDecimalString(input.amount, input.currency), currency: input.currency.toUpperCase() } },
        idempotenceKey: `capture-${input.providerPaymentId}`,
      },
    );
    if (status >= 500) throw new ProviderUnavailableError(body.description ?? `ЮKassa HTTP ${status}`);
    if (status >= 400) {
      return { outcome: "technical_error", providerCode: body.code, providerMessage: body.description, failureCode: "technical_error", raw: body as unknown as Record<string, unknown> };
    }
    return body.status === "succeeded"
      ? { outcome: "success", providerReference: body.id, raw: body as unknown as Record<string, unknown> }
      : {
          outcome: "soft_decline",
          providerReference: body.id,
          providerCode: body.cancellation_details?.reason,
          failureCode: mapCancellationReason(body.cancellation_details?.reason),
          raw: body as unknown as Record<string, unknown>,
        };
  }

  async cancelPayment(ctx: ProviderContext, input: { providerPaymentId: string }): Promise<ProviderOperationResult> {
    const { status, body } = await call<YooPayment & YooError>(
      ctx,
      "POST",
      `/payments/${encodeURIComponent(input.providerPaymentId)}/cancel`,
      { idempotenceKey: `cancel-${input.providerPaymentId}` },
    );
    if (status >= 500) throw new ProviderUnavailableError(body.description ?? `ЮKassa HTTP ${status}`);
    if (status >= 400) {
      return { outcome: "technical_error", providerCode: body.code, providerMessage: body.description, failureCode: "technical_error", raw: body as unknown as Record<string, unknown> };
    }
    return { outcome: "success", providerReference: body.id, raw: body as unknown as Record<string, unknown> };
  }

  async refundPayment(
    ctx: ProviderContext,
    input: { providerPaymentId: string; refundId: string; amount: number; currency: string },
  ): Promise<ProviderOperationResult> {
    const { status, body } = await call<YooRefund & YooError>(ctx, "POST", "/refunds", {
      body: {
        payment_id: input.providerPaymentId,
        amount: { value: toDecimalString(input.amount, input.currency), currency: input.currency.toUpperCase() },
      },
      // NATIO's own refund id: a retried refund returns the first one rather
      // than refunding twice.
      idempotenceKey: input.refundId,
    });
    if (status >= 500) throw new ProviderUnavailableError(body.description ?? `ЮKassa HTTP ${status}`);
    if (status >= 400) {
      return { outcome: "technical_error", providerCode: body.code, providerMessage: body.description, failureCode: "technical_error", raw: body as unknown as Record<string, unknown> };
    }
    if (body.status === "canceled") {
      return {
        outcome: "hard_decline",
        providerReference: body.id,
        providerCode: body.cancellation_details?.reason,
        failureCode: mapCancellationReason(body.cancellation_details?.reason),
        raw: body as unknown as Record<string, unknown>,
      };
    }
    return { outcome: "success", providerReference: body.id, raw: body as unknown as Record<string, unknown> };
  }

  /**
   * Payouts through ЮKassa need a separate product and a separate agreement,
   * and they authenticate differently. Pretending to support them would let a
   * routing rule send real payouts into a method that cannot work, so this
   * fails loudly and specifically instead.
   */
  async createPayout(_ctx: ProviderContext, _input: CreatePayoutInput): Promise<ProviderPayoutResult> {
    return {
      outcome: "technical_error",
      failureCode: "provider_configuration_error",
      providerMessage: "ЮKassa payouts require a separate agreement and are not enabled on this connector.",
    };
  }

  async getPayout(_ctx: ProviderContext, _providerPayoutId: string): Promise<ProviderLookupResult> {
    return { found: false };
  }

  /**
   * ЮKassa does not sign its notifications — there is no HMAC and no shared
   * secret, only JSON arriving from a published IP range. Accepting the body
   * at face value would mean anyone who learns a payment id can tell us it
   * succeeded.
   *
   * So the body is treated as a hint and nothing more: we take the object id
   * from it and re-read that object from the API over authenticated TLS. What
   * comes back is what we act on. A forged notification for a real payment
   * then tells us only what was already true, and one for a payment that does
   * not exist is rejected.
   */
  async verifyWebhook(
    ctx: ProviderContext,
    input: { headers: Record<string, string | string[] | undefined>; rawBody: string },
  ): Promise<WebhookVerification> {
    let parsed: { type?: string; event?: string; object?: { id?: string } };
    try {
      parsed = JSON.parse(input.rawBody);
    } catch {
      return { valid: false, reason: "notification body is not JSON" };
    }

    const event = parsed.event ?? "";
    const objectId = parsed.object?.id;
    if (!objectId) return { valid: false, reason: "notification carries no object id" };

    const isRefund = event.startsWith("refund.");
    const path = isRefund ? `/refunds/${encodeURIComponent(objectId)}` : `/payments/${encodeURIComponent(objectId)}`;

    const { status, body } = await call<(YooPayment & YooRefund) & YooError>(ctx, "GET", path);
    if (status === 404) return { valid: false, reason: "notification references an object this shop does not have" };
    if (status >= 400) return { valid: false, reason: body.description ?? `could not verify against ЮKassa (HTTP ${status})` };

    const amount = fromDecimalString(body.amount.value, body.amount.currency);

    const normalized: NormalizedProviderEvent = isRefund
      ? {
          // ЮKassa notifications have no event id of their own, so dedupe on
          // the object and the state we just read — replaying the same
          // notification produces the same key and is absorbed upstream.
          eventId: `refund:${body.id}:${body.status}`,
          kind: "refund",
          providerReference: body.id,
          status: body.status === "succeeded" ? "successful" : body.status === "canceled" ? "failed" : "processing",
          amount,
          currency: body.amount.currency,
          failureCode: body.status === "canceled" ? mapCancellationReason(body.cancellation_details?.reason) : undefined,
          raw: body as unknown as Record<string, unknown>,
        }
      : {
          eventId: `payment:${body.id}:${body.status}`,
          kind: "payment",
          providerReference: body.id,
          status: statusOf(body as YooPayment),
          amount,
          currency: body.amount.currency,
          failureCode: body.status === "canceled" ? mapCancellationReason(body.cancellation_details?.reason) : undefined,
          providerMessage: body.cancellation_details?.reason,
          raw: body as unknown as Record<string, unknown>,
        };

    return { valid: true, event: normalized };
  }

  async healthCheck(ctx: ProviderContext): Promise<{ ok: boolean; latencyMs: number; message?: string }> {
    const started = Date.now();
    try {
      // Cheapest authenticated read: an empty page of the payment list.
      const { status } = await call<YooList<YooPayment>>(ctx, "GET", "/payments?limit=1");
      return { ok: status < 400, latencyMs: Date.now() - started, message: status >= 400 ? `HTTP ${status}` : undefined };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, message: err instanceof Error ? err.message : "unreachable" };
    }
  }
}

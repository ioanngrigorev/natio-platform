import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "../../lib/money.js";
import { TEST_SCENARIOS } from "./scenarios.js";

export const currencySchema = z
  .string()
  .length(3)
  .transform((s) => s.toUpperCase())
  .refine((c) => (SUPPORTED_CURRENCIES as readonly string[]).includes(c), { message: "unsupported currency" });

export const countrySchema = z
  .string()
  .length(2)
  .regex(/^[A-Za-z]{2}$/)
  .transform((s) => s.toUpperCase());

export const paymentMethodTypeSchema = z.enum(["card", "bank_transfer", "qr", "open_banking", "wallet", "instant", "local", "crypto"]);

// ---------------------------------------------------------------------------
// PCI guards. NATIO is never in scope for cardholder data: no endpoint may accept a PAN,
// a CVV or a raw account number, and "masked" display strings must really be masked.
// Separators are stripped first — "4111-1111-1111-1111" is just as much a PAN as the bare digits.
// ---------------------------------------------------------------------------
const SEPARATORS = /[\s._\-/\\]/g;

/** Digits and letters only, so grouping characters cannot hide an account number. */
export function stripSeparators(value: string): string {
  return value.replace(SEPARATORS, "");
}

/** 12–19 digits after separators are removed: the shape of a PAN / long account number. */
export function looksLikePan(value: string): boolean {
  return /^\d{12,19}$/.test(stripSeparators(value));
}

/** ISO 13616 IBAN shape (2 letters, 2 check digits, up to 30 alphanumerics). */
export function looksLikeIban(value: string): boolean {
  return /^[A-Za-z]{2}\d{2}[A-Za-z0-9]{10,30}$/.test(stripSeparators(value));
}

/** A value a merchant may only send tokenised: never a PAN, never a full IBAN. */
export function looksLikeAccountNumber(value: string): boolean {
  return looksLikePan(value) || looksLikeIban(value);
}

/** True when a supposedly masked string still carries a long run of digits. */
export function hasUnmaskedDigits(value: string, maxRun: number): boolean {
  return new RegExp(`\\d{${maxRun + 1},}`).test(stripSeparators(value));
}

export const metadataSchema = z
  .record(z.union([z.string().max(500), z.number(), z.boolean(), z.null()]))
  .refine((m) => Object.keys(m).length <= 50, { message: "at most 50 metadata keys" });

export const customerInputSchema = z.object({
  id: z.string().max(64).optional(),
  external_id: z.string().max(128).optional(),
  email: z.string().email().max(254).optional(),
  name: z.string().max(200).optional(),
  country: countrySchema.optional(),
});

export const createPaymentObject = z
  .object({
    amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    currency: currencySchema,
    payment_method: z.union([
      paymentMethodTypeSchema,
      z.object({
        type: paymentMethodTypeSchema,
        token: z
          .string()
          .max(255)
          .refine((t) => !looksLikeAccountNumber(t), { message: "payment_method.token must be a provider token, never a card or account number" })
          .optional(),
        id: z.string().max(64).optional(),
      }),
    ]),
    /**
     * Where an on-chain payment should settle. Required when the method is
     * "crypto" and meaningless otherwise — the refinement below enforces both
     * directions, because silently ignoring a settlement block on a card
     * payment would hide a merchant's mistake rather than correct it.
     */
    settlement: z
      .object({
        asset: z.string().min(2).max(12),
        network: z.enum(["bitcoin", "ethereum", "bsc", "polygon", "tron"]),
        /**
         * Exactly what the payer must send, in the asset's base units, as a
         * decimal string: "1499000000" is 1499 USDT.
         *
         * The merchant states this rather than NATIO deriving it from
         * `amount`, because deriving it needs an exchange rate and NATIO has
         * no price source. Inventing one — or quietly using a stale one — is
         * worse than not having it: the payer would be told to send an amount
         * nobody agreed to, and the discrepancy would surface as an
         * underpayment days later. The merchant has a rate; NATIO has a
         * ledger.
         */
        amount: z.string().regex(/^\d{1,40}$/, "settlement.amount must be a whole number of the asset's base units"),
        /** Optional: pick a specific registered wallet account. */
        account: z.string().max(64).optional(),
        /** How long the address stays reserved. Default 30 minutes. */
        expires_in_minutes: z.number().int().min(5).max(1440).optional(),
      })
      .optional(),
    capture_method: z.enum(["automatic", "manual"]).optional(),
    country: countrySchema.optional(),
    customer: customerInputSchema.optional(),
    description: z.string().max(500).optional(),
    reference: z.string().max(128).optional(),
    return_url: z.string().url().max(2000).optional(),
    metadata: metadataSchema.optional(),
    test_scenario: z
      .string()
      .refine((s) => s in TEST_SCENARIOS, { message: `must be one of: ${Object.keys(TEST_SCENARIOS).join(", ")}` })
      .optional(),
    device: z
      .object({
        ip: z.string().max(64).optional(),
        user_agent: z.string().max(500).optional(),
        fingerprint: z.string().max(128).optional(),
      })
      .optional(),
  })
  .strict();

/**
 * The rule that spans two fields, kept apart from the object itself so callers
 * that need to add a field (the dashboard adds project_id) can still extend
 * the object — `.superRefine` returns an effect, and effects cannot be
 * extended.
 */
function settlementRule(v: { payment_method: unknown; settlement?: unknown }, ctx: z.RefinementCtx) {
  {
    const pm = v.payment_method as string | { type: string };
    const type = typeof pm === "string" ? pm : pm.type;
    if (type === "crypto" && !v.settlement) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["settlement"],
        message: "settlement is required for crypto payments: name the asset and network the payer should send.",
      });
    }
    if (type !== "crypto" && v.settlement) {
      // Accepting and ignoring it would leave a merchant believing they had
      // configured something. Say so instead.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["settlement"],
        message: `settlement only applies to crypto payments; this one is "${type}".`,
      });
    }
  }
}

export const createPaymentSchema = createPaymentObject.superRefine(settlementRule);
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export { settlementRule };

export const captureSchema = z.object({ amount: z.number().int().positive().optional() }).strict();
export const cancelSchema = z.object({ reason: z.string().max(200).optional() }).strict();
export const refundSchema = z
  .object({
    amount: z.number().int().positive().optional(),
    reason: z.string().max(200).optional(),
    metadata: metadataSchema.optional(),
    test_scenario: z.enum(["success", "technical_error", "hard_decline"]).optional(),
  })
  .strict();

export const listPaymentsQuerySchema = z.object({
  status: z.string().optional(),
  currency: z.string().optional(),
  country: z.string().optional(),
  payment_method: z.string().optional(),
  provider_account_id: z.string().optional(),
  customer_id: z.string().optional(),
  reference: z.string().optional(),
  search: z.string().max(100).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

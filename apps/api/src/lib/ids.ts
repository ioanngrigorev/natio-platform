import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** URL-safe random string with ~5.95 bits of entropy per char. */
export function randomString(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

export const ID_PREFIXES = {
  merchant: "mer",
  merchantUser: "usr",
  adminUser: "adm",
  session: "ses",
  project: "prj",
  apiKey: "key",
  customer: "cus",
  paymentMethod: "pm",
  payment: "pay",
  attempt: "att",
  refund: "rf",
  payout: "po",
  transaction: "txn",
  provider: "prv",
  providerAccount: "pa",
  routingRule: "rr",
  providerRoute: "prt",
  routingDecision: "rd",
  riskRule: "rk",
  riskDecision: "rkd",
  walletAccount: "wa",
  walletAddress: "wad",
  chainObservation: "cob",
  settlement: "stl",
  settlementItem: "sti",
  reconBatch: "rcb",
  reconItem: "rci",
  webhookEndpoint: "whe",
  webhookDelivery: "whd",
  webhookAttempt: "wha",
  event: "evt",
  paymentEvent: "pev",
  transition: "trn",
  audit: "aud",
  systemEvent: "sev",
  idempotency: "idk",
  contact: "ctc",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

export function newId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_${randomString(20)}`;
}

export function newRequestId(): string {
  return `req_${randomString(16)}`;
}

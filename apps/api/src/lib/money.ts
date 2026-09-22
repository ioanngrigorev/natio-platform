/** ISO 4217 minor unit exponents for currencies that are not 2-decimal. */
const EXPONENTS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  UGX: 0,
  XAF: 0,
  XOF: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  JOD: 3,
  TND: 3,
};

export const SUPPORTED_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CHF",
  "PLN",
  "CZK",
  "SEK",
  "NOK",
  "DKK",
  "AED",
  "SGD",
  "HKD",
  "JPY",
  "AUD",
  "CAD",
  "BRL",
  "MXN",
  "INR",
  "IDR",
  "VND",
  "THB",
  "PHP",
  "MYR",
  "TRY",
  "ZAR",
  "NGN",
  "KES",
  "SAR",
  "KZT",
] as const;

export function currencyExponent(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

export function formatMinor(amount: number, currency: string): string {
  const exp = currencyExponent(currency);
  const major = amount / 10 ** exp;
  return `${major.toFixed(exp)} ${currency.toUpperCase()}`;
}

/** Percentage fee on minor units, rounded half-up to an integer minor unit. */
export function computeFee(amount: number, feePercent: number, feeFixedMinor: number): number {
  const pct = Math.round((amount * feePercent) / 100);
  return pct + feeFixedMinor;
}

export function isValidMinorAmount(amount: unknown): amount is number {
  return typeof amount === "number" && Number.isInteger(amount) && amount > 0 && amount <= Number.MAX_SAFE_INTEGER;
}

/**
 * What a chain has to be able to tell us.
 *
 * The interface is deliberately narrow: given an address we are watching, what
 * arrived at it and how settled is it. Everything a payment needs follows from
 * that, and nothing else about a chain leaks into the rest of the platform.
 *
 * Each implementation talks to a public endpoint with no account and no key —
 * the whole layer is non-custodial, so there is nothing to authenticate as.
 */
import type { ChainNetwork } from "../derivation.js";

export interface ObservedTransfer {
  /** Chain-native transaction identifier. */
  txHash: string;
  /**
   * Which part of that transaction paid us: the output index on a UTXO chain,
   * the log index for a token transfer. Two payments can share a hash.
   */
  outputIndex: number;
  /** Exact amount in the asset's base units, as a decimal string. Never a float. */
  amount: string;
  /** Confirmations counted at the moment of observation. */
  confirmations: number;
  /** Absent while the transaction is still unconfirmed. */
  blockNumber?: number;
  /** Provider payload, kept for audit. */
  raw?: Record<string, unknown>;
}

export interface AssetSpec {
  /** Display ticker, e.g. "USDT". Never used for matching — see `contract`. */
  symbol: string;
  /** Base-unit exponent: 6 for USDT on TRON, 8 for BTC. */
  decimals: number;
  /**
   * Token contract, for chains where assets are contracts.
   *
   * Matching on this rather than on the symbol is not pedantry. Anyone can
   * deploy a token that calls itself USDT and send a merchant a million of
   * them; a watcher that matched on the ticker would mark the invoice paid.
   * The contract address is the only thing that identifies the real asset.
   */
  contract?: string;
}

export interface ChainClient {
  readonly network: ChainNetwork;
  /** Everything that has arrived at this address for this asset. */
  getIncoming(address: string, asset: AssetSpec): Promise<ObservedTransfer[]>;
  /** Current chain tip, used for health checks and confirmation maths. */
  getTipHeight(): Promise<number>;
}

export class ChainUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainUnavailableError";
  }
}

/** Injected so tests can drive the clients from recorded responses. */
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export async function getJson<T>(fetchImpl: FetchLike, url: string, timeoutMs: number, label: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    const body = await res.text();
    if (!res.ok) throw new ChainUnavailableError(`${label} returned HTTP ${res.status}`);
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new ChainUnavailableError(`${label} returned a non-JSON response`);
    }
  } catch (err) {
    if (err instanceof ChainUnavailableError) throw err;
    if (err instanceof Error && err.name === "AbortError") throw new ChainUnavailableError(`${label} did not respond in time`);
    throw new ChainUnavailableError(err instanceof Error ? err.message : `${label} request failed`);
  } finally {
    clearTimeout(timer);
  }
}

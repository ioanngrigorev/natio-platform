/**
 * Which assets exist, on which chain, and who to ask about them.
 *
 * The contract addresses here are the load-bearing part of the file. They are
 * what distinguishes the real USDT from any of the identically-named tokens
 * anyone can deploy for a few dollars, so they are recorded explicitly rather
 * than looked up at runtime from something that could lie.
 */
import type { ChainNetwork } from "../derivation.js";
import { BitcoinChainClient } from "./bitcoin.js";
import { TronChainClient } from "./tron.js";
import type { AssetSpec, ChainClient, FetchLike } from "./types.js";

/** Key is `${network}:${symbol}`. */
const ASSETS: Record<string, AssetSpec> = {
  // Verified against TronGrid's own token_info for this contract.
  "tron:USDT": { symbol: "USDT", decimals: 6, contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" },
  "bitcoin:BTC": { symbol: "BTC", decimals: 8 },
};

export function assetSpec(network: ChainNetwork, symbol: string): AssetSpec | undefined {
  return ASSETS[`${network}:${symbol.toUpperCase()}`];
}

export function supportedAssets(): Array<{ network: ChainNetwork; asset: AssetSpec }> {
  return Object.entries(ASSETS).map(([key, asset]) => ({ network: key.split(":")[0] as ChainNetwork, asset }));
}

export interface ChainClientOptions {
  fetchImpl?: FetchLike;
  tronBaseUrl?: string;
  bitcoinBaseUrl?: string;
  timeoutMs?: number;
}

/**
 * Networks the watcher can actually observe today.
 *
 * The EVM chains derive addresses correctly and are rejected here on purpose:
 * watching an ERC-20 means filtering event logs by topic across block ranges,
 * which is a different and larger piece of work than either of these. A
 * merchant is better served by an explicit "not yet" than by a watcher that
 * quietly never notices their payment.
 */
export function chainClientFor(network: ChainNetwork, opts: ChainClientOptions = {}): ChainClient {
  const fetchImpl = (opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike));
  switch (network) {
    case "tron":
      return new TronChainClient(fetchImpl, { baseUrl: opts.tronBaseUrl, timeoutMs: opts.timeoutMs });
    case "bitcoin":
      return new BitcoinChainClient(fetchImpl, { baseUrl: opts.bitcoinBaseUrl, timeoutMs: opts.timeoutMs });
    default:
      throw new Error(`No chain client for "${network}" yet — address derivation works, observation does not.`);
  }
}

export function isObservable(network: ChainNetwork): boolean {
  return network === "tron" || network === "bitcoin";
}

export * from "./types.js";
export { TronChainClient } from "./tron.js";
export { BitcoinChainClient } from "./bitcoin.js";

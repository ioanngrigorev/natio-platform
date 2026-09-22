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
import { EvmChainClient } from "./evm.js";
import { TronChainClient } from "./tron.js";
import type { AssetSpec, ChainClient, FetchLike } from "./types.js";

/**
 * Key is `${network}:${symbol}`, where the symbol is what a *merchant* calls
 * the asset. It is deliberately not what the chain calls it.
 *
 * Every contract and decimal below was read off the chain with `eth_call`
 * rather than recalled, and two of them would have been wrong from memory:
 *
 *  · USDT on BNB Smart Chain has **18** decimals, not the 6 it has everywhere
 *    else here. Assuming 6 would make an invoice for 100 USDT settle for a
 *    ten-millionth of that, and nothing downstream would look unusual.
 *  · USDT on Polygon reports its symbol as **"USDT0"**. A merchant configures
 *    "USDT". Matching on symbol would have found nothing at all — which is the
 *    second reason, after counterfeits, that matching is on the contract.
 */
const ASSETS: Record<string, AssetSpec> = {
  // Verified against TronGrid's own token_info for this contract.
  "tron:USDT": { symbol: "USDT", decimals: 6, contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" },
  "bitcoin:BTC": { symbol: "BTC", decimals: 8 },
  // decimals() = 6, symbol() = "USDT".
  "ethereum:USDT": { symbol: "USDT", decimals: 6, contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
  // decimals() = 18. Not a typo, and not the same as the others.
  "bsc:USDT": { symbol: "USDT", decimals: 18, contract: "0x55d398326f99059fF775485246999027B3197955" },
  // decimals() = 6, symbol() = "USDT0".
  "polygon:USDT": { symbol: "USDT", decimals: 6, contract: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" },
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
  /** Per-network JSON-RPC override, keyed by network name. */
  evmRpcUrls?: Partial<Record<ChainNetwork, string>>;
  evmLookbackBlocks?: number;
  timeoutMs?: number;
}

const EVM_NETWORKS = ["ethereum", "bsc", "polygon"] as const;
const OBSERVABLE: ChainNetwork[] = ["tron", "bitcoin", ...EVM_NETWORKS];

function isEvm(network: ChainNetwork): boolean {
  return (EVM_NETWORKS as readonly string[]).includes(network);
}

/** Networks the watcher can actually observe. */
export function chainClientFor(network: ChainNetwork, opts: ChainClientOptions = {}): ChainClient {
  const fetchImpl = (opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike));
  if (isEvm(network)) {
    return new EvmChainClient(network, fetchImpl, {
      baseUrl: opts.evmRpcUrls?.[network],
      timeoutMs: opts.timeoutMs,
      lookbackBlocks: opts.evmLookbackBlocks,
    });
  }
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
  return OBSERVABLE.includes(network);
}

export * from "./types.js";
export { TronChainClient } from "./tron.js";
export { BitcoinChainClient } from "./bitcoin.js";
export { EvmChainClient, EVM_RPC_URLS } from "./evm.js";

/**
 * ERC-20 observation for the EVM chains: Ethereum, BNB Smart Chain, Polygon.
 *
 * Built against real `eth_getLogs` responses captured from public nodes rather
 * than from memory of the format, which is how the three things below were
 * found rather than assumed.
 *
 * A token transfer is an event log, so the question "what arrived at this
 * address" becomes "which Transfer logs name it as recipient". The node does
 * that filtering: `topics[2]` is the indexed recipient, so the query returns
 * only this address's transfers instead of every transfer of the token.
 */
import type { ChainNetwork } from "../derivation.js";
import { ChainUnavailableError, postRpc, type AssetSpec, type ChainClient, type FetchLike, type ObservedTransfer } from "./types.js";

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const EVM_RPC_URLS: Record<string, string> = {
  ethereum: "https://ethereum-rpc.publicnode.com",
  bsc: "https://bsc-rpc.publicnode.com",
  polygon: "https://polygon-bor.publicnode.com",
};

/**
 * How far back to look, per chain.
 *
 * Bounded in both directions and neither bound is cosmetic. Too short and a
 * payment made early in an invoice's life stops being visible before the
 * invoice closes — the watcher would report nothing arrived, which is the one
 * failure this system must not produce. Too long and the node refuses: a
 * public endpoint answered "Archive requests require a personal token" for a
 * range of 500k blocks while this was being written.
 *
 * These cover roughly two hours, against an invoice window of thirty minutes
 * plus an hour of grace. Re-scanning the same window every cycle costs
 * nothing, because recording an observation is idempotent on
 * (network, tx_hash, log_index).
 */
const LOOKBACK_BLOCKS: Record<string, number> = {
  ethereum: 1200,
  bsc: 6000,
  polygon: 6000,
};

export interface EvmClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  lookbackBlocks?: number;
}

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Left-pad an address to a 32-byte topic. Lower-cased because topics are compared as raw bytes. */
function addressTopic(address: string): string {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

function hexToNumber(hex: string | undefined, what: string): number {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]+$/.test(hex)) {
    throw new ChainUnavailableError(`node returned a malformed ${what}: ${String(hex)}`);
  }
  return Number.parseInt(hex, 16);
}

interface RpcLog {
  address?: string;
  topics?: string[];
  data?: string;
  blockNumber?: string;
  transactionHash?: string;
  logIndex?: string;
  removed?: boolean;
}

export class EvmChainClient implements ChainClient {
  readonly network: ChainNetwork;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly lookback: number;

  constructor(network: ChainNetwork, fetchImpl: FetchLike, opts: EvmClientOptions = {}) {
    this.network = network;
    this.fetchImpl = fetchImpl;
    this.baseUrl = opts.baseUrl ?? EVM_RPC_URLS[network] ?? "";
    this.timeoutMs = opts.timeoutMs ?? 12_000;
    this.lookback = opts.lookbackBlocks ?? LOOKBACK_BLOCKS[network] ?? 1200;
    if (!this.baseUrl) throw new ChainUnavailableError(`no RPC endpoint configured for ${network}`);
  }

  async getTipHeight(): Promise<number> {
    const result = await postRpc<string>(this.fetchImpl, this.baseUrl, "eth_blockNumber", [], this.timeoutMs, this.network);
    return hexToNumber(result, "block number");
  }

  async getIncoming(address: string, asset: AssetSpec): Promise<ObservedTransfer[]> {
    if (!asset.contract) {
      // Native coin balances would have to be watched a different way, and
      // guessing at one here would mean silently never noticing a payment.
      throw new ChainUnavailableError(`${asset.symbol} on ${this.network} has no contract configured; only tokens are observed`);
    }
    if (!HEX_ADDRESS.test(address)) throw new ChainUnavailableError(`"${address}" is not an ${this.network} address`);

    const tip = await this.getTipHeight();
    const fromBlock = Math.max(0, tip - this.lookback);

    const logs = await postRpc<RpcLog[]>(
      this.fetchImpl,
      this.baseUrl,
      "eth_getLogs",
      [
        {
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: "latest",
          address: asset.contract,
          // [event, from (any), to (us)] — the node filters, so the answer is
          // this address's transfers rather than the whole token's traffic.
          topics: [TRANSFER_TOPIC, null, addressTopic(address)],
        },
      ],
      this.timeoutMs,
      this.network,
    );

    if (!Array.isArray(logs)) throw new ChainUnavailableError(`${this.network} returned a malformed log list`);

    const out: ObservedTransfer[] = [];
    for (const log of logs) {
      const transfer = this.decode(log, address, asset);
      if (transfer) out.push({ ...transfer, confirmations: Math.max(0, tip - (transfer.blockNumber ?? tip) + 1) });
    }
    return out;
  }

  /**
   * Turn one log into a transfer, or reject it.
   *
   * Everything here is re-checked rather than trusted to the node's filter.
   * The node is an unauthenticated public endpoint: it is the right thing to
   * ask, and the wrong thing to believe without checking, since believing it
   * means crediting an invoice.
   */
  private decode(log: RpcLog, expectedRecipient: string, asset: AssetSpec): ObservedTransfer | null {
    if (!log.transactionHash || !log.topics || log.topics.length < 3) return null;
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) return null;

    // The contract is the asset's identity. Anyone can deploy a token calling
    // itself USDT; only this address is the real one. Compared case-insensitively
    // because nodes answer in lower case while the configured value is
    // checksummed — a case-sensitive compare would match nothing, and every
    // payment would go unnoticed with no error anywhere.
    if (log.address?.toLowerCase() !== asset.contract?.toLowerCase()) return null;

    // topics[2] is the indexed recipient, left-padded to 32 bytes.
    const recipient = `0x${log.topics[2]!.slice(-40)}`;
    if (recipient.toLowerCase() !== expectedRecipient.toLowerCase()) return null;

    const data = log.data ?? "0x";
    if (!/^0x[0-9a-fA-F]*$/.test(data)) return null;
    // uint256 through BigInt. A Number here would round every USDT amount
    // above about nine million, and silently.
    const amount = (data === "0x" ? 0n : BigInt(data)).toString();

    return {
      txHash: log.transactionHash,
      outputIndex: hexToNumber(log.logIndex, "log index"),
      amount,
      confirmations: 0,
      blockNumber: log.blockNumber ? hexToNumber(log.blockNumber, "block number") : undefined,
      removed: log.removed === true,
      raw: log as unknown as Record<string, unknown>,
    };
  }
}

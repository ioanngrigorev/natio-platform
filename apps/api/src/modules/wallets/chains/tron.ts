/**
 * TRON, via TronGrid's public API. No account, no key, no fee.
 *
 * Written against a real response rather than from memory. TronGrid returns
 * TRC20 transfers like this:
 *
 *   { "data": [ { "transaction_id": "dc4da8…",
 *                 "token_info": { "symbol": "USDT", "address": "TR7NH…",
 *                                 "decimals": 6, "name": "Tether USD" },
 *                 "block_timestamp": 1790061939000,
 *                 "from": "TFZqUn…", "to": "TR7NH…",
 *                 "type": "Transfer", "value": "558000000" } ],
 *     "success": true, "meta": { … } }
 *
 * Three things about that shape decide the implementation.
 *
 * `value` is a decimal STRING in base units, which is exactly how the ledger
 * stores it — so it passes through untouched, never parsed into a number.
 *
 * `token_info.address` is the contract, and matching on it instead of on
 * `symbol` is the difference between a payment system and a free-for-all.
 * Deploying a token called USDT costs almost nothing; a watcher that trusted
 * the ticker would mark invoices paid for worthless tokens all day.
 *
 * There is no block number and no confirmation count in the response, so
 * confirmations cannot be derived from it. TRON's own notion of finality is
 * exposed as `only_confirmed`, which is both simpler and more correct than
 * counting blocks ourselves: the chain tells us what it considers irreversible.
 */
import type { ChainNetwork } from "../derivation.js";
import { ChainUnavailableError, getJson, type AssetSpec, type ChainClient, type FetchLike, type ObservedTransfer } from "./types.js";

const DEFAULT_BASE = "https://api.trongrid.io";

interface TronTrc20Transfer {
  transaction_id: string;
  token_info: { symbol: string; address: string; decimals: number; name: string };
  block_timestamp: number;
  from: string;
  to: string;
  type: string;
  value: string;
}

interface TronTrc20Response {
  data?: TronTrc20Transfer[];
  success?: boolean;
  error?: string;
}

interface TronBlock {
  block_header?: { raw_data?: { number?: number } };
}

/**
 * Finality on TRON is Super Representative confirmation, which is what the API
 * means by "confirmed" and what everyone means by 19 blocks. We do not count
 * blocks; we ask twice — once for confirmed transfers and once for everything —
 * and report each transfer at the threshold or below it accordingly.
 */
const CONFIRMED = 19;

export class TronChainClient implements ChainClient {
  readonly network: ChainNetwork = "tron";

  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly opts: { baseUrl?: string; timeoutMs?: number; apiKey?: string } = {},
  ) {}

  private get base(): string {
    return this.opts.baseUrl ?? DEFAULT_BASE;
  }

  private get timeout(): number {
    return this.opts.timeoutMs ?? 15_000;
  }

  async getTipHeight(): Promise<number> {
    const body = await getJson<TronBlock>(this.fetchImpl, `${this.base}/wallet/getnowblock`, this.timeout, "TronGrid");
    const n = body.block_header?.raw_data?.number;
    if (typeof n !== "number") throw new ChainUnavailableError("TronGrid returned no block number");
    return n;
  }

  async getIncoming(address: string, asset: AssetSpec): Promise<ObservedTransfer[]> {
    if (!asset.contract) {
      throw new ChainUnavailableError(
        `Asset ${asset.symbol} has no contract address configured for TRON. Matching a token by ticker alone is not safe.`,
      );
    }

    // Ask for the settled view and the full view separately. The difference
    // between them is exactly the set of transfers still in flight, which is
    // what tells an invoice apart from "awaiting" and "paid".
    const [confirmed, all] = await Promise.all([
      this.fetchTransfers(address, true),
      this.fetchTransfers(address, false),
    ]);

    const confirmedIds = new Set(confirmed.map((t) => `${t.transaction_id}`));
    const seen = new Map<string, ObservedTransfer>();

    for (const t of all) {
      // Only credits, only this contract. `type` is "Transfer" for the ordinary
      // case; anything else is not a payment to us.
      if (t.type !== "Transfer") continue;
      if (t.to !== address) continue;
      if (t.token_info?.address !== asset.contract) continue;

      // A contract that reports different decimals than we expect is either a
      // misconfiguration or an impostor. Either way the amount would be wrong
      // by orders of magnitude, so refuse it rather than credit it.
      if (typeof t.token_info.decimals === "number" && t.token_info.decimals !== asset.decimals) {
        throw new ChainUnavailableError(
          `Contract ${t.token_info.address} reports ${t.token_info.decimals} decimals but ${asset.symbol} is configured with ${asset.decimals}`,
        );
      }
      if (!/^\d+$/.test(t.value)) continue;

      // TronGrid gives one TRC20 transfer per transaction in this view, so the
      // hash identifies it. outputIndex stays 0 and the unique constraint on
      // (network, tx_hash, output_index) still does its job.
      const key = t.transaction_id;
      if (seen.has(key)) continue;
      seen.set(key, {
        txHash: t.transaction_id,
        outputIndex: 0,
        amount: t.value,
        confirmations: confirmedIds.has(key) ? CONFIRMED : 0,
        raw: t as unknown as Record<string, unknown>,
      });
    }

    return [...seen.values()];
  }

  private async fetchTransfers(address: string, onlyConfirmed: boolean): Promise<TronTrc20Transfer[]> {
    const url =
      `${this.base}/v1/accounts/${encodeURIComponent(address)}/transactions/trc20` +
      `?limit=50&only_to=true${onlyConfirmed ? "&only_confirmed=true" : ""}`;
    const body = await getJson<TronTrc20Response>(this.fetchImpl, url, this.timeout, "TronGrid");
    if (body.success === false) throw new ChainUnavailableError(`TronGrid reported failure: ${body.error ?? "unknown"}`);
    return body.data ?? [];
  }
}

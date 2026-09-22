/**
 * Bitcoin, via a public Esplora instance (mempool.space by default; any
 * Esplora-compatible host works, including a self-hosted one). No account, no
 * key, no fee.
 *
 * Written against a real response. The unspent-output view returns:
 *
 *   [ { "txid": "8e4ac7b0…", "vout": 0,
 *       "status": { "confirmed": true, "block_height": 968113,
 *                   "block_hash": "000000…", "block_time": 1790059629 },
 *       "value": 15899 } ]
 *
 * and the tip height is a bare number in the body.
 *
 * Two consequences. `value` is satoshis as a JSON number, and although the
 * entire money supply fits inside a JS safe integer, it is converted to a
 * string immediately and never arithmetic'd as a float — the ledger's rule is
 * uniform, and an exception "because Bitcoin is small enough" is how the rule
 * stops being one. And confirmations are not in the response: they are the tip
 * height minus the including block, which means one extra call and a decision
 * about what an unconfirmed output counts as.
 *
 * Only unspent outputs are considered. A merchant who has already swept an
 * address has been paid; the invoice was settled at the moment we saw it.
 */
import type { ChainNetwork } from "../derivation.js";
import { ChainUnavailableError, getJson, type AssetSpec, type ChainClient, type FetchLike, type ObservedTransfer } from "./types.js";

const DEFAULT_BASE = "https://mempool.space/api";

interface EsploraUtxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number; block_hash?: string; block_time?: number };
}

export class BitcoinChainClient implements ChainClient {
  readonly network: ChainNetwork = "bitcoin";

  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly opts: { baseUrl?: string; timeoutMs?: number } = {},
  ) {}

  private get base(): string {
    return this.opts.baseUrl ?? DEFAULT_BASE;
  }

  private get timeout(): number {
    return this.opts.timeoutMs ?? 15_000;
  }

  async getTipHeight(): Promise<number> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await this.fetchImpl(`${this.base}/blocks/tip/height`, { signal: controller.signal });
      const text = (await res.text()).trim();
      if (!res.ok) throw new ChainUnavailableError(`Esplora returned HTTP ${res.status}`);
      // The tip endpoint answers with a bare integer, not JSON.
      if (!/^\d+$/.test(text)) throw new ChainUnavailableError("Esplora returned a malformed tip height");
      return Number(text);
    } catch (err) {
      if (err instanceof ChainUnavailableError) throw err;
      if (err instanceof Error && err.name === "AbortError") throw new ChainUnavailableError("Esplora did not respond in time");
      throw new ChainUnavailableError(err instanceof Error ? err.message : "Esplora request failed");
    } finally {
      clearTimeout(timer);
    }
  }

  async getIncoming(address: string, asset: AssetSpec): Promise<ObservedTransfer[]> {
    if (asset.symbol.toUpperCase() !== "BTC") {
      throw new ChainUnavailableError(`Bitcoin carries no token contracts; ${asset.symbol} cannot settle on this network.`);
    }

    // Tip first: an output's confirmation count is meaningless without it, and
    // reading it afterwards could count against a tip that has already moved.
    const tip = await this.getTipHeight();
    const utxos = await getJson<EsploraUtxo[]>(
      this.fetchImpl,
      `${this.base}/address/${encodeURIComponent(address)}/utxo`,
      this.timeout,
      "Esplora",
    );

    if (!Array.isArray(utxos)) throw new ChainUnavailableError("Esplora returned an unexpected shape for unspent outputs");

    return utxos.map((u) => {
      const height = u.status?.block_height;
      // An output in the mempool has no height and therefore no confirmations.
      // Reporting it as 0 rather than omitting it is what lets an invoice show
      // "seen, not yet final" instead of nothing at all.
      const confirmations = u.status?.confirmed && typeof height === "number" ? Math.max(0, tip - height + 1) : 0;
      return {
        txHash: u.txid,
        outputIndex: u.vout,
        amount: String(u.value),
        confirmations,
        blockNumber: typeof height === "number" ? height : undefined,
        raw: u as unknown as Record<string, unknown>,
      };
    });
  }
}

import { describe, expect, it } from "vitest";
import { EvmChainClient } from "../../src/modules/wallets/chains/evm.js";
import { ChainUnavailableError, type FetchLike } from "../../src/modules/wallets/chains/types.js";
import { assetSpec, chainClientFor, isObservable } from "../../src/modules/wallets/chains/index.js";

/**
 * Built on a log captured from a live Ethereum node, not on a remembered
 * shape. Everything asserted below about casing, padding and field names comes
 * from that payload.
 */

const USDT_ETH = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const RECIPIENT = "0xbdb3ba9ffe392549e1f8658dd2630c141fdf47b6";
const SENDER_TOPIC = "0x0000000000000000000000003470447f3cecffac709d3e783a307790b0208d60";
const toTopic = (a: string) => `0x${"0".repeat(24)}${a.slice(2).toLowerCase()}`;

/** Exactly as the node returned it — note the lower-cased `address`. */
const REAL_LOG = {
  address: "0xdac17f958d2ee523a2206206994597c13d831ec7",
  topics: [TRANSFER, SENDER_TOPIC, toTopic(RECIPIENT)],
  data: "0x000000000000000000000000000000000000000000000000000000034d568a91",
  blockNumber: "0x18d3bcb",
  transactionHash: "0x39b74850e3d24a7b742245cd6ad3bb0dd7fa6e20f725fda1d70e8ec9eb104001",
  transactionIndex: "0x1",
  blockHash: "0x7e915c8f35de40c567596d75a4f94ce05ee1f3d0041ad34c5f090112e113bd7d",
  logIndex: "0x3",
  removed: false,
  blockTimestamp: "0x6ab277bb",
};

const TIP = 0x18d3bcc;

function node(handler: (method: string, params: any[]) => unknown): FetchLike {
  return async (_url, init) => {
    const req = JSON.parse(init!.body!) as { method: string; params: any[] };
    const result = handler(req.method, req.params);
    return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result }) };
  };
}

const withLogs = (logs: unknown[]) =>
  node((method) => (method === "eth_blockNumber" ? `0x${TIP.toString(16)}` : logs));

const eth = (fetchImpl: FetchLike) => new EvmChainClient("ethereum", fetchImpl, { baseUrl: "https://node.invalid" });
const USDT = assetSpec("ethereum", "USDT")!;

describe("reading an ERC-20 transfer", () => {
  it("decodes the amount exactly, through BigInt", async () => {
    const [t] = await eth(withLogs([REAL_LOG])).getIncoming(RECIPIENT, USDT);
    // 0x34d568a91 — the value the node actually reported.
    expect(t!.amount).toBe(String(BigInt("0x000000000000000000000000000000000000000000000000000000034d568a91")));
    expect(t!.amount).toBe("14182419089");
    expect(t!.txHash).toBe(REAL_LOG.transactionHash);
    // The log index, so two transfers in one transaction stay distinct.
    expect(t!.outputIndex).toBe(3);
    expect(t!.blockNumber).toBe(0x18d3bcb);
    expect(t!.confirmations).toBe(2);
  });

  it("matches the contract case-insensitively", async () => {
    // The node answers lower case; the configured contract is checksummed. A
    // case-sensitive comparison would match nothing and report that no payment
    // ever arrived — with no error anywhere to notice.
    expect(USDT.contract).toBe(USDT_ETH);
    expect(REAL_LOG.address).toBe(USDT_ETH.toLowerCase());
    const transfers = await eth(withLogs([REAL_LOG])).getIncoming(RECIPIENT, USDT);
    expect(transfers).toHaveLength(1);
  });

  it("matches the recipient case-insensitively too", async () => {
    const transfers = await eth(withLogs([REAL_LOG])).getIncoming(RECIPIENT.toUpperCase().replace("0X", "0x"), USDT);
    expect(transfers).toHaveLength(1);
  });

  it("holds amounts far past what a double can represent", async () => {
    const huge = "0x" + (10n ** 30n).toString(16).padStart(64, "0");
    const [t] = await eth(withLogs([{ ...REAL_LOG, data: huge }])).getIncoming(RECIPIENT, USDT);
    expect(t!.amount).toBe("1000000000000000000000000000000");
    expect(BigInt(t!.amount)).toBe(10n ** 30n);
  });
});

describe("what it refuses to credit", () => {
  it("ignores a transfer from an impostor contract", async () => {
    // The whole reason matching is on the contract: anyone can deploy a token
    // that calls itself USDT and send a merchant a million of them.
    const fake = { ...REAL_LOG, address: "0x000000000000000000000000000000000000dead" };
    expect(await eth(withLogs([fake])).getIncoming(RECIPIENT, USDT)).toHaveLength(0);
  });

  it("ignores a transfer to somebody else", async () => {
    const other = { ...REAL_LOG, topics: [TRANSFER, SENDER_TOPIC, toTopic("0x1111111111111111111111111111111111111111")] };
    expect(await eth(withLogs([other])).getIncoming(RECIPIENT, USDT)).toHaveLength(0);
  });

  it("ignores a log that is not a Transfer", async () => {
    const approval = { ...REAL_LOG, topics: ["0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925", SENDER_TOPIC, toTopic(RECIPIENT)] };
    expect(await eth(withLogs([approval])).getIncoming(RECIPIENT, USDT)).toHaveLength(0);
  });

  it("ignores a malformed log rather than guessing at it", async () => {
    expect(await eth(withLogs([{ ...REAL_LOG, topics: [TRANSFER] }])).getIncoming(RECIPIENT, USDT)).toHaveLength(0);
    expect(await eth(withLogs([{ ...REAL_LOG, transactionHash: undefined }])).getIncoming(RECIPIENT, USDT)).toHaveLength(0);
  });

  it("refuses an asset with no contract instead of watching nothing", async () => {
    await expect(eth(withLogs([])).getIncoming(RECIPIENT, { symbol: "ETH", decimals: 18 })).rejects.toBeInstanceOf(ChainUnavailableError);
  });

  it("refuses an address that is not an EVM address", async () => {
    await expect(eth(withLogs([REAL_LOG])).getIncoming("TFZqUnWVGbV6JvXKaeqihjgYRgjkBTHjrv", USDT)).rejects.toBeInstanceOf(ChainUnavailableError);
  });
});

describe("a transfer the chain takes back", () => {
  it("is reported as removed rather than dropped", async () => {
    // Dropping it inside the client would leave an observation already
    // recorded standing, and the payment settled on money that is gone.
    const [t] = await eth(withLogs([{ ...REAL_LOG, removed: true }])).getIncoming(RECIPIENT, USDT);
    expect(t!.removed).toBe(true);
    expect(t!.txHash).toBe(REAL_LOG.transactionHash);
  });

  it("marks an ordinary transfer as not removed", async () => {
    const [t] = await eth(withLogs([REAL_LOG])).getIncoming(RECIPIENT, USDT);
    expect(t!.removed).toBe(false);
  });
});

describe("talking to a public node", () => {
  it("treats a JSON-RPC error as an outage, not as an empty answer", async () => {
    // A node answers HTTP 200 and puts the failure in the body. Reading the
    // status alone would report "nothing arrived" for "range too large" — the
    // exact message a live node returned while this was written.
    const failing: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Archive requests require a personal token" } }),
    });
    await expect(eth(failing).getIncoming(RECIPIENT, USDT)).rejects.toBeInstanceOf(ChainUnavailableError);
    await expect(eth(failing).getIncoming(RECIPIENT, USDT)).rejects.toThrow(/personal token/);
  });

  it("asks only for a bounded recent window", async () => {
    let asked: any = null;
    const spy = node((method, params) => {
      if (method === "eth_blockNumber") return `0x${TIP.toString(16)}`;
      asked = params[0];
      return [];
    });
    await new EvmChainClient("ethereum", spy, { baseUrl: "https://node.invalid", lookbackBlocks: 500 }).getIncoming(RECIPIENT, USDT);
    expect(Number.parseInt(asked.fromBlock, 16)).toBe(TIP - 500);
    expect(asked.toBlock).toBe("latest");
    expect(asked.address).toBe(USDT_ETH);
    // The node does the filtering: event, any sender, this recipient.
    expect(asked.topics[0]).toBe(TRANSFER);
    expect(asked.topics[1]).toBeNull();
    expect(asked.topics[2]).toBe(toTopic(RECIPIENT));
  });

  it("reports an unreachable node rather than an empty result", async () => {
    const dead: FetchLike = async () => ({ ok: false, status: 503, text: async () => "upstream down" });
    await expect(eth(dead).getTipHeight()).rejects.toBeInstanceOf(ChainUnavailableError);
  });
});

describe("the asset registry, read off the chains", () => {
  it("gives USDT eighteen decimals on BNB Smart Chain and six elsewhere", () => {
    // Verified with eth_call decimals() against each contract. Assuming six
    // everywhere would settle a 100 USDT invoice for a ten-millionth of it.
    expect(assetSpec("bsc", "USDT")!.decimals).toBe(18);
    expect(assetSpec("ethereum", "USDT")!.decimals).toBe(6);
    expect(assetSpec("polygon", "USDT")!.decimals).toBe(6);
    expect(assetSpec("tron", "USDT")!.decimals).toBe(6);
  });

  it("keys assets by what the merchant calls them, not by the on-chain symbol", () => {
    // Polygon's USDT reports symbol() as "USDT0". A merchant configures USDT.
    expect(assetSpec("polygon", "USDT")!.symbol).toBe("USDT");
    expect(assetSpec("polygon", "USDT")!.contract).toBe("0xc2132D05D31c914a87C6611C10748AEb04B58e8F");
  });

  it("now considers every supported network observable", () => {
    for (const n of ["tron", "bitcoin", "ethereum", "bsc", "polygon"] as const) {
      expect(isObservable(n)).toBe(true);
      expect(() => chainClientFor(n, { fetchImpl: withLogs([]) })).not.toThrow();
    }
  });
});

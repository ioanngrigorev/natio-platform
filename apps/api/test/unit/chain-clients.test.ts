import { describe, expect, it } from "vitest";
import { BitcoinChainClient } from "../../src/modules/wallets/chains/bitcoin.js";
import { TronChainClient } from "../../src/modules/wallets/chains/tron.js";
import { ChainUnavailableError, type FetchLike } from "../../src/modules/wallets/chains/types.js";
import { assetSpec } from "../../src/modules/wallets/chains/index.js";

/**
 * The fixtures below are real responses, captured from the public endpoints
 * these clients talk to, not written from memory of the documentation. That
 * distinction earned its keep immediately: the live TronGrid payload carries
 * `token_info.address`, which is what makes it possible to tell the real USDT
 * from any of the identically-named tokens anyone can deploy — a detail an
 * invented fixture would not have had, and whose absence would have produced a
 * watcher that credits worthless tokens.
 */

const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const OUR_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

/** Captured from api.trongrid.io, trimmed to two entries. */
const TRON_REAL = {
  data: [
    {
      transaction_id: "dc4da8187308f5bf717ea1df81e98c8621394dde21eeae0cbe5d92a07ea36694",
      token_info: { symbol: "USDT", address: USDT, decimals: 6, name: "Tether USD" },
      block_timestamp: 1790061939000,
      from: "TFZqUnWVGbV6JvXKaeqihjgYRgjkBTHjrv",
      to: OUR_ADDRESS,
      type: "Transfer",
      value: "558000000",
    },
    {
      transaction_id: "ecd042f6700b9294a340e22510301bbc5c4b7bf8de88b06ae012e6409465252b",
      token_info: { symbol: "USDT", address: USDT, decimals: 6, name: "Tether USD" },
      block_timestamp: 1790043621000,
      from: "TVJDXdgkgq348XGqwBCjfYJYQ6CNU21SCz",
      to: OUR_ADDRESS,
      type: "Transfer",
      value: "705642",
    },
  ],
  success: true,
  meta: { at: 1790062097133, page_size: 2 },
};

/** Captured from mempool.space. */
const BTC_UTXO_REAL = [
  {
    txid: "8e4ac7b068d7dbde3d929f6c08e6dc49a9d49b1bc6fc00267e71235d53eade11",
    vout: 0,
    status: {
      confirmed: true,
      block_height: 968113,
      block_hash: "00000000000000000001387a0ddccb27646d4009ab2524dcfcfe5602ff512691",
      block_time: 1790059629,
    },
    value: 15899,
  },
];
const BTC_TIP = "968116";

function fakeFetch(routes: Array<{ match: RegExp; body: string; ok?: boolean; status?: number }>): FetchLike {
  return async (url) => {
    const hit = routes.find((r) => r.match.test(url));
    if (!hit) throw new Error(`no fixture for ${url}`);
    return {
      ok: hit.ok ?? true,
      status: hit.status ?? 200,
      text: async () => hit.body,
    };
  };
}

const tronRoutes = (all: unknown, confirmed: unknown) => [
  { match: /only_confirmed=true/, body: JSON.stringify(confirmed) },
  { match: /transactions\/trc20/, body: JSON.stringify(all) },
];

describe("TRON client, against a real TronGrid payload", () => {
  const spec = assetSpec("tron", "USDT")!;

  it("knows the real USDT contract", () => {
    expect(spec.contract).toBe(USDT);
    expect(spec.decimals).toBe(6);
  });

  it("reads amounts as exact strings, never as numbers", async () => {
    const client = new TronChainClient(fakeFetch(tronRoutes(TRON_REAL, TRON_REAL)));
    const got = await client.getIncoming(OUR_ADDRESS, spec);
    expect(got.map((t) => t.amount).sort()).toEqual(["558000000", "705642"]);
    for (const t of got) expect(typeof t.amount).toBe("string");
  });

  it("treats a transfer as final only when TRON says it is confirmed", async () => {
    // Present in the full view, absent from the confirmed one: still in flight.
    const client = new TronChainClient(fakeFetch(tronRoutes(TRON_REAL, { data: [], success: true })));
    const got = await client.getIncoming(OUR_ADDRESS, spec);
    expect(got).toHaveLength(2);
    expect(got.every((t) => t.confirmations === 0)).toBe(true);

    const settled = new TronChainClient(fakeFetch(tronRoutes(TRON_REAL, TRON_REAL)));
    expect((await settled.getIncoming(OUR_ADDRESS, spec)).every((t) => t.confirmations >= 19)).toBe(true);
  });

  it("ignores a token that merely calls itself USDT", async () => {
    // The whole attack: deploying a token with this symbol is trivial, and a
    // watcher that matched on the ticker would mark the invoice paid.
    const impostor = {
      ...TRON_REAL,
      data: [
        {
          ...TRON_REAL.data[0],
          transaction_id: "fake0000000000000000000000000000000000000000000000000000000000",
          token_info: { symbol: "USDT", address: "TImpostorContract000000000000000000", decimals: 6, name: "Tether USD" },
          value: "1000000000000",
        },
      ],
    };
    const client = new TronChainClient(fakeFetch(tronRoutes(impostor, impostor)));
    expect(await client.getIncoming(OUR_ADDRESS, spec)).toEqual([]);
  });

  it("refuses a contract whose decimals disagree with the configured asset", async () => {
    const wrongDecimals = {
      ...TRON_REAL,
      data: [{ ...TRON_REAL.data[0], token_info: { ...TRON_REAL.data[0]!.token_info, decimals: 18 } }],
    };
    const client = new TronChainClient(fakeFetch(tronRoutes(wrongDecimals, wrongDecimals)));
    await expect(client.getIncoming(OUR_ADDRESS, spec)).rejects.toThrow(/decimals/i);
  });

  it("ignores transfers addressed to somebody else", async () => {
    const elsewhere = { ...TRON_REAL, data: [{ ...TRON_REAL.data[0], to: "TSomebodyElse0000000000000000000000" }] };
    const client = new TronChainClient(fakeFetch(tronRoutes(elsewhere, elsewhere)));
    expect(await client.getIncoming(OUR_ADDRESS, spec)).toEqual([]);
  });

  it("refuses to watch an asset with no contract configured", async () => {
    const client = new TronChainClient(fakeFetch([]));
    await expect(client.getIncoming(OUR_ADDRESS, { symbol: "MYSTERY", decimals: 6 })).rejects.toThrow(/contract/i);
  });

  it("surfaces an upstream failure instead of reporting no payments", async () => {
    // Reporting "nothing arrived" when the endpoint is down would silently
    // expire paid invoices, so an outage has to throw.
    const client = new TronChainClient(fakeFetch([{ match: /./, body: "rate limited", ok: false, status: 429 }]));
    await expect(client.getIncoming(OUR_ADDRESS, spec)).rejects.toThrow(ChainUnavailableError);
  });
});

describe("Bitcoin client, against a real Esplora payload", () => {
  const spec = assetSpec("bitcoin", "BTC")!;
  const routes = (utxos: unknown, tip = BTC_TIP) => [
    { match: /blocks\/tip\/height/, body: tip },
    { match: /\/utxo$/, body: JSON.stringify(utxos) },
  ];

  it("counts confirmations from the tip, inclusive of the including block", async () => {
    const client = new BitcoinChainClient(fakeFetch(routes(BTC_UTXO_REAL)));
    const [got] = await client.getIncoming("bc1qexample", spec);
    // 968116 - 968113 + 1
    expect(got!.confirmations).toBe(4);
    expect(got!.blockNumber).toBe(968113);
  });

  it("carries satoshis across as an exact string", async () => {
    const client = new BitcoinChainClient(fakeFetch(routes(BTC_UTXO_REAL)));
    const [got] = await client.getIncoming("bc1qexample", spec);
    expect(got!.amount).toBe("15899");
    expect(typeof got!.amount).toBe("string");
  });

  it("reports a mempool output as seen but unconfirmed", async () => {
    const pending = [{ ...BTC_UTXO_REAL[0], status: { confirmed: false } }];
    const client = new BitcoinChainClient(fakeFetch(routes(pending)));
    const [got] = await client.getIncoming("bc1qexample", spec);
    expect(got!.confirmations).toBe(0);
    expect(got!.blockNumber).toBeUndefined();
  });

  it("distinguishes two outputs of the same transaction", async () => {
    const two = [BTC_UTXO_REAL[0], { ...BTC_UTXO_REAL[0], vout: 1, value: 500 }];
    const client = new BitcoinChainClient(fakeFetch(routes(two)));
    const got = await client.getIncoming("bc1qexample", spec);
    expect(got.map((t) => t.outputIndex)).toEqual([0, 1]);
  });

  it("handles an address with nothing on it", async () => {
    const client = new BitcoinChainClient(fakeFetch(routes([])));
    expect(await client.getIncoming("bc1qempty", spec)).toEqual([]);
  });

  it("rejects a token symbol on a chain that has no tokens", async () => {
    const client = new BitcoinChainClient(fakeFetch(routes([])));
    await expect(client.getIncoming("bc1qexample", { symbol: "USDT", decimals: 6 })).rejects.toThrow(/no token contracts/i);
  });

  it("refuses a malformed tip rather than computing nonsense confirmations", async () => {
    const client = new BitcoinChainClient(fakeFetch(routes(BTC_UTXO_REAL, "<html>maintenance</html>")));
    await expect(client.getIncoming("bc1qexample", spec)).rejects.toThrow(/tip height/i);
  });
});

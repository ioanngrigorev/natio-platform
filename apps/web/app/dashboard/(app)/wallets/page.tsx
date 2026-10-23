
import {getI18n} from '@/lib/i18n/server';
import { AddWalletAccount, ArchiveWalletAccount } from "@/components/dashboard/wallet-accounts";
import { Card, EmptyState, Mono, PageHeader, StatusBadge, Table, Tag } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { serverApi } from "@/lib/session";

export const metadata = { title: "Settlement keys" };

interface WalletAccount {
  id: string;
  label: string;
  network: string;
  asset: string;
  script_type: string;
  status: string;
  next_index: number;
  key_fingerprint: string;
  verified_at: string | null;
  created_at: string;
  stats: { addresses: number; settled: number; awaiting: number; received_base_units: string };
}

interface WalletAddress {
  id: string;
  address: string;
  derivation_path: string;
  status: string;
  payment_id: string | null;
  expected_amount: string | null;
  observed_amount: string;
  confirmations_required: number;
  expires_at: string | null;
  settled_at: string | null;
  created_at: string;
}

/** Base units are exact integers; rendering them needs no arithmetic, only a decimal point. */
function formatBaseUnits(value: string, decimals: number): string {
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const frac = decimals > 0 ? padded.slice(padded.length - decimals).replace(/0+$/, "") : "";
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Base-unit exponents for display. Keyed by network as well as asset because
 * USDT is not one number: six decimals on Ethereum, Polygon and TRON, and
 * eighteen on BNB Smart Chain. Rendering a BSC amount with six would show a
 * merchant a balance a trillion times too large.
 */
const DECIMALS: Record<string, number> = { USDT: 6, BTC: 8, ETH: 18 };
const DECIMALS_BY_NETWORK: Record<string, number> = { "bsc:USDT": 18 };

function decimalsFor(network: string, asset: string): number {
  const key = `${network.toLowerCase()}:${asset.toUpperCase()}`;
  return DECIMALS_BY_NETWORK[key] ?? DECIMALS[asset.toUpperCase()] ?? 8;
}

export default async function WalletsPage() {
 const {t:translateUi,locale:uiLocale}=(await getI18n());

  const api = (await serverApi());
  const accounts = await api.get<{ data: WalletAccount[] }>("/dashboard/wallets");

  const addressLists = await Promise.all(
    accounts.data.map((a) => api.get<{ data: WalletAddress[] }>(`/dashboard/wallets/${a.id}/addresses`).catch(() => ({ data: [] as WalletAddress[] }))),
  );

  return (
    <>
      <PageHeader
        title={translateUi("Settlement keys")}
        subtitle={translateUi(`On-chain payments in ${api.mode} mode settle straight to these wallets. NATIO derives addresses from them and never holds a key that could spend.`)}
        actions={<AddWalletAccount />}
      />

      {translateUi(accounts.data.length === 0 ? (
        <Card>
          <EmptyState
            title={translateUi("No settlement key yet")}
            description={translateUi("Register an extended public key from your own wallet to start taking on-chain payments. NATIO derives a fresh address for each invoice and watches it; the money goes from your customer to you with nothing in between.")}
          />
        </Card>
      ) : null)}

      {translateUi(accounts.data.map((account, i) => {
        const decimals = decimalsFor(account.network, account.asset);
        const addresses = addressLists[i]!.data;
        return (
          <Card
            key={account.id}
            className="mb-6"
            padded={false}
            title={
              translateUi(<span className="flex items-center gap-2">
                {translateUi(account.label)}
                <Tag>{translateUi(account.asset)}</Tag>
                <Tag>{translateUi(account.network)}</Tag>
                {translateUi(account.status === "archived" ? <StatusBadge status="archived" /> : null)}
              </span>)
            }
            description={translateUi(`${account.stats.addresses} address${account.stats.addresses === 1 ? "" : "es"} derived · ${account.stats.settled} settled · ${formatBaseUnits(account.stats.received_base_units, decimals)} ${account.asset} received`)}
            actions={account.status === "active" ? <ArchiveWalletAccount id={account.id} label={translateUi(account.label)} /> : undefined}
          >
            <div className="border-b border-ink-200 px-5 py-3 text-[12.5px] text-ink-600">{translateUi("Key ")}<Mono>{translateUi(account.key_fingerprint)}…</Mono>{translateUi(" · script ")}<Mono>{translateUi(account.script_type)}</Mono>{translateUi(" · next index")}{translateUi(" ")}
              <Mono>{translateUi(account.next_index)}</Mono>{translateUi(" · added ")}{translateUi(formatDateTime(account.created_at))}
              {/*
                The key itself is deliberately absent. The merchant already has
                it, and returning it would only put another copy somewhere it
                could leak — an extended public key maps their whole balance
                history even though it cannot spend.
              */}
            </div>

            {translateUi(addresses.length ? (
              <Table>
                <thead>
                  <tr>
                    <th>{translateUi("Address")}</th>
                    <th>{translateUi("Path")}</th>
                    <th>{translateUi("Status")}</th>
                    <th className="text-right">{translateUi("Expected")}</th>
                    <th className="text-right">{translateUi("Received")}</th>
                    <th>{translateUi("Payment")}</th>
                    <th>{translateUi("Created")}</th>
                  </tr>
                </thead>
                <tbody>
                  {translateUi(addresses.map((a) => (
                    <tr key={a.id}>
                      <td className="max-w-[260px] truncate font-mono text-[12px]" title={translateUi(a.address)}>
                        {translateUi(a.address)}
                      </td>
                      <td>
                        <Mono>{translateUi(a.derivation_path)}</Mono>
                      </td>
                      <td>
                        <StatusBadge status={a.status} />
                      </td>
                      <td className="text-right tabular-nums">{translateUi(a.expected_amount ? formatBaseUnits(a.expected_amount, decimals) : "—")}</td>
                      <td className="text-right tabular-nums">{translateUi(formatBaseUnits(a.observed_amount, decimals))}</td>
                      <td>{translateUi(a.payment_id ? <Mono>{translateUi(a.payment_id)}</Mono> : "—")}</td>
                      <td className="whitespace-nowrap text-ink-600">{translateUi(formatDateTime(a.created_at))}</td>
                    </tr>
                  )))}
                </tbody>
              </Table>
            ) : (
              <div className="px-5 py-6 text-[13.5px] text-ink-600">{translateUi("No addresses derived yet. One is created for each on-chain payment, and never reused.")}</div>
            ))}
          </Card>
        );
      }))}
    </>
  );
}

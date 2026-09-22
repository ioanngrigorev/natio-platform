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

const DECIMALS: Record<string, number> = { USDT: 6, BTC: 8, ETH: 18 };

export default async function WalletsPage() {
  const api = serverApi();
  const accounts = await api.get<{ data: WalletAccount[] }>("/dashboard/wallets");

  const addressLists = await Promise.all(
    accounts.data.map((a) => api.get<{ data: WalletAddress[] }>(`/dashboard/wallets/${a.id}/addresses`).catch(() => ({ data: [] as WalletAddress[] }))),
  );

  return (
    <>
      <PageHeader
        title="Settlement keys"
        subtitle={`On-chain payments in ${api.mode} mode settle straight to these wallets. NATIO derives addresses from them and never holds a key that could spend.`}
        actions={<AddWalletAccount />}
      />

      {accounts.data.length === 0 ? (
        <Card>
          <EmptyState
            title="No settlement key yet"
            description="Register an extended public key from your own wallet to start taking on-chain payments. NATIO derives a fresh address for each invoice and watches it; the money goes from your customer to you with nothing in between."
          />
        </Card>
      ) : null}

      {accounts.data.map((account, i) => {
        const decimals = DECIMALS[account.asset.toUpperCase()] ?? 8;
        const addresses = addressLists[i]!.data;
        return (
          <Card
            key={account.id}
            className="mb-6"
            padded={false}
            title={
              <span className="flex items-center gap-2">
                {account.label}
                <Tag>{account.asset}</Tag>
                <Tag>{account.network}</Tag>
                {account.status === "archived" ? <StatusBadge status="archived" /> : null}
              </span>
            }
            description={`${account.stats.addresses} address${account.stats.addresses === 1 ? "" : "es"} derived · ${account.stats.settled} settled · ${formatBaseUnits(account.stats.received_base_units, decimals)} ${account.asset} received`}
            actions={account.status === "active" ? <ArchiveWalletAccount id={account.id} label={account.label} /> : undefined}
          >
            <div className="border-b border-ink-200 px-5 py-3 text-[12.5px] text-ink-600">
              Key <Mono>{account.key_fingerprint}…</Mono> · script <Mono>{account.script_type}</Mono> · next index{" "}
              <Mono>{account.next_index}</Mono> · added {formatDateTime(account.created_at)}
              {/*
                The key itself is deliberately absent. The merchant already has
                it, and returning it would only put another copy somewhere it
                could leak — an extended public key maps their whole balance
                history even though it cannot spend.
              */}
            </div>

            {addresses.length ? (
              <Table>
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>Path</th>
                    <th>Status</th>
                    <th className="text-right">Expected</th>
                    <th className="text-right">Received</th>
                    <th>Payment</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {addresses.map((a) => (
                    <tr key={a.id}>
                      <td className="max-w-[260px] truncate font-mono text-[12px]" title={a.address}>
                        {a.address}
                      </td>
                      <td>
                        <Mono>{a.derivation_path}</Mono>
                      </td>
                      <td>
                        <StatusBadge status={a.status} />
                      </td>
                      <td className="text-right tabular-nums">{a.expected_amount ? formatBaseUnits(a.expected_amount, decimals) : "—"}</td>
                      <td className="text-right tabular-nums">{formatBaseUnits(a.observed_amount, decimals)}</td>
                      <td>{a.payment_id ? <Mono>{a.payment_id}</Mono> : "—"}</td>
                      <td className="whitespace-nowrap text-ink-600">{formatDateTime(a.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <div className="px-5 py-6 text-[13.5px] text-ink-600">
                No addresses derived yet. One is created for each on-chain payment, and never reused.
              </div>
            )}
          </Card>
        );
      })}
    </>
  );
}

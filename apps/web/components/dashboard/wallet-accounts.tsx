"use client";
import {useI18n} from '@/lib/i18n/provider';


import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Modal } from "@/components/dashboard/modal";
import { errorMessage, useSession } from "@/components/session-provider";
import { Alert, Button, Field, Mono } from "@/components/ui";

const NETWORKS: Array<{ value: string; label: string; asset: string; hint: string; observable: boolean }> = [
  { value: "tron", label: "TRON", asset: "USDT", hint: "Account xpub from the m/44'/195'/0' path.", observable: true },
  { value: "bitcoin", label: "Bitcoin", asset: "BTC", hint: "zpub for native segwit, ypub for wrapped, xpub for legacy.", observable: true },
  { value: "ethereum", label: "Ethereum", asset: "USDT", hint: "Account xpub from m/44'/60'/0'. USDT, 6 decimals.", observable: true },
  { value: "bsc", label: "BNB Smart Chain", asset: "USDT", hint: "Account xpub from m/44'/60'/0'. USDT here has 18 decimals, unlike the other chains.", observable: true },
  { value: "polygon", label: "Polygon", asset: "USDT", hint: "Account xpub from m/44'/60'/0'. USDT, 6 decimals.", observable: true },
];

interface Registered {
  id: string;
  network: string;
  asset: string;
  scriptType: string;
  probe_address: string;
}

export function AddWalletAccount() {
 const {t:translateUi,locale:uiLocale}=useI18n();

  const session = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<Registered | null>(null);
  const [form, setForm] = useState({ label: "", network: "tron", asset: "USDT", extended_key: "" });

  // Registering a key decides where this merchant's money lands, so the
  // control is not rendered at all for roles that may not do it.
  if (!session.can("wallets.manage")) return null;

  const selected = NETWORKS.find((n) => n.value === form.network)!;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const created = await session.api<Registered>("/dashboard/wallets", {
        body: {
          label: form.label.trim(),
          network: form.network,
          asset: form.asset.trim().toUpperCase(),
          extended_key: form.extended_key.trim(),
        },
      });
      setOpen(false);
      setRegistered(created);
      setForm({ label: "", network: "tron", asset: "USDT", extended_key: "" });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>{translateUi("Add settlement key")}</Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={translateUi("Add a settlement key")}
        description={translateUi("Payments on this key settle straight to your wallet. NATIO never holds the funds and never holds a key that could move them.")}
        width="max-w-[560px]"
      >
        <form onSubmit={submit} className="space-y-4">
          {translateUi(error ? <Alert tone="bad">{translateUi(error)}</Alert> : null)}

          <Alert tone="warn">{translateUi("Paste an ")}<strong>{translateUi("extended public key")}</strong>{translateUi(" — one starting ")}<Mono>{translateUi("xpub")}</Mono>, <Mono>{translateUi("ypub")}</Mono>{translateUi(" or ")}<Mono>{translateUi("zpub")}</Mono>{translateUi(". Never a private key and never a recovery phrase. NATIO refuses those, but a key you have pasted anywhere should be treated as compromised regardless of who refused it.")}</Alert>

          <Field label={translateUi("Label")} htmlFor="wa-label" help={translateUi("How you will recognise this key in reports.")}>
            <input id="wa-label" className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required minLength={2} maxLength={80} placeholder={translateUi("Main USDT treasury")} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={translateUi("Network")} htmlFor="wa-network" help={translateUi(selected.hint)}>
              <select
                id="wa-network"
                className="input"
                value={form.network}
                onChange={(e) => {
                  const n = NETWORKS.find((x) => x.value === e.target.value)!;
                  setForm({ ...form, network: n.value, asset: n.asset });
                }}
              >
                {translateUi(NETWORKS.map((n) => (
                  <option key={n.value} value={n.value}>
                    {translateUi(n.label)}
                    {translateUi(n.observable ? "" : translateUi(" — addresses only, not yet watched"))}
                  </option>
                )))}
              </select>
            </Field>

            <Field label={translateUi("Asset")} htmlFor="wa-asset" help={translateUi("Ticker as it settles, e.g. USDT or BTC.")}>
              <input id="wa-asset" className="input" value={form.asset} onChange={(e) => setForm({ ...form, asset: e.target.value })} required maxLength={12} />
            </Field>
          </div>

          {translateUi(!selected.observable ? (
            <Alert tone="warn">{translateUi("Addresses on ")}{translateUi(selected.label)}{translateUi(" are derived correctly, but NATIO does not watch this chain yet — a payment to one would not be noticed automatically. Said plainly here rather than discovered later.")}</Alert>
          ) : null)}

          <Field label={translateUi("Extended public key")} htmlFor="wa-key" help={translateUi("Exported from your wallet as the account-level public key.")}>
            <textarea
              id="wa-key"
              className="input font-mono text-[12.5px]"
              rows={3}
              value={form.extended_key}
              onChange={(e) => setForm({ ...form, extended_key: e.target.value })}
              required
              minLength={20}
              maxLength={256}
              spellCheck={false}
              placeholder={translateUi("xpub6C…")}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{translateUi("Cancel")}</Button>
            <Button type="submit" loading={loading}>{translateUi("Register key")}</Button>
          </div>
        </form>
      </Modal>

      {/*
        The verification step, and the reason this is a modal of its own rather
        than a line of confirmation text: a mistyped key produces addresses that
        look completely normal and belong to nobody. Every payment would leave
        and never arrive. Checking one address against the wallet that owns it
        is the only thing that catches that, and it has to happen before the
        first payment, not after.
      */}
      <Modal
        open={!!registered}
        onClose={() => setRegistered(null)}
        title={translateUi("Check this address before taking payments")}
        description={translateUi("This is the first address NATIO derived from your key. Open your own wallet and confirm it appears there.")}
        width="max-w-[560px]"
      >
        {translateUi(registered ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-ink-200 bg-ink-50 p-4">
              <div className="text-[11px] uppercase tracking-[0.12em] text-ink-500">{translateUi("First derived address")}</div>
              <div className="mt-2 break-all font-mono text-[13.5px] text-ink-900">{translateUi(registered.probe_address)}</div>
            </div>

            <Alert tone="warn">{translateUi("If this address is not in your wallet, the key is wrong. Archive it and register the right one. Payments to addresses derived from a wrong key go somewhere nobody controls, and nothing downstream will look unusual until a merchant asks where their money is.")}</Alert>

            <div className="text-[13px] leading-[1.7] text-ink-600">{translateUi("Registered as ")}<Mono>{translateUi(registered.asset)}</Mono>{translateUi(" on ")}<Mono>{translateUi(registered.network)}</Mono>
              {translateUi(registered.scriptType ? (
                <>{translateUi(", script type ")}<Mono>{translateUi(registered.scriptType)}</Mono>
                </>
              ) : null)}{translateUi(". NATIO stores this key encrypted and can only ever read from it.")}</div>

            <div className="flex justify-end pt-1">
              <Button onClick={() => setRegistered(null)}>{translateUi("I have checked it")}</Button>
            </div>
          </div>
        ) : null)}
      </Modal>
    </>
  );
}

export function ArchiveWalletAccount({ id, label }: { id: string; label: string }) {
 const {t:translateUi,locale:uiLocale}=useI18n();

  const session = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  if (!session.can("wallets.manage")) return null;

  async function archive() {
    if (!confirm(`Archive "${label}"? Its history stays; no new addresses will be derived from it.`)) return;
    setLoading(true);
    try {
      await session.api(`/dashboard/wallets/${id}/archive`, { body: {} });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="secondary" onClick={archive} loading={loading}>{translateUi("Archive")}</Button>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession, errorMessage } from "@/components/session-provider";
import { adminCan } from "@/lib/admin-permissions";
import { Button, Card, Grid, Kpi, PageHeader } from "@/components/ui";

type Claim = { reference: string | null; amount: number | null; currency: string | null; date: string | null };
type Assessment = { outcome: string; claim: Claim; evidence: (Claim & { status: string; source: string }) | null; findings: { code: string; level: string; message: string }[]; checked_at: string };
type Receipt = { id: string; payment_id: string; merchant_name: string; amount: number; currency: string; state: string; decision: string | null; assessment: Assessment; created_at: string; updated_at: string; version: number; pages: number; sha256: string; assignee: string | null; events: { id: number; action: string; actor: string; note: string; created_at: string }[] };
type Sample = { slug: string; title: string; payment_id: string };
type Demo = { assessment: Assessment; previews: string[]; payment_id: string };
type Listing = { data: Receipt[]; total: number; page: number; stats: { total: number; open: number; suspicious: number; waiting: number; confirmed: number } };
const LABELS: Record<string, string> = { psp_matched: "PSP matched", suspicious: "Suspected alteration", needs_review: "Manual review", awaiting_psp: "Awaiting PSP", open: "Open", in_review: "In review", waiting_psp: "Waiting for PSP", needs_info: "More information needed", closed: "Closed", confirmed: "Confirmed", rejected: "Rejected", submitted: "Receipt received", take: "Review started", recheck: "PSP checked again", request_info: "Information requested", confirm: "Payment confirmed", reject: "Receipt rejected", reopen: "Case reopened" };
const date = (s: string) => new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
function money(amount: number | null | undefined, currency: string | null | undefined) {
  if (amount == null || !currency) return "Not extracted";
  const zero = ["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XAF", "XOF"];
  const three = ["BHD", "KWD", "OMR", "JOD", "TND"];
  const digits = zero.includes(currency) ? 0 : three.includes(currency) ? 3 : 2;
  return `${(amount / 10 ** digits).toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${currency}`;
}
function Badge({ value }: { value: string }) {
  const style = ["suspicious", "rejected"].includes(value) ? "bg-bad-bg text-bad" : ["psp_matched", "confirmed"].includes(value) ? "bg-ok-bg text-ok" : "bg-brand-50 text-brand-700";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${style}`}>{LABELS[value] || value}</span>;
}
function Message({ children }: { children: React.ReactNode }) { return <div role="alert" className="rounded-lg border border-bad/20 bg-bad-bg p-3 text-sm text-bad">{children}</div>; }
const inputClass = "w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-100";

function EvidencePanel({ assessment }: { assessment: Assessment }) {
  const a = assessment;
  const rows = [
    ["PSP reference", a.claim.reference, a.evidence?.reference],
    ["Amount", money(a.claim.amount, a.claim.currency), a.evidence ? money(a.evidence.amount, a.evidence.currency) : null],
    ["Currency", a.claim.currency, a.evidence?.currency],
    ["Paid date (UTC)", a.claim.date, a.evidence?.date],
  ];
  return <div className="space-y-4">
    <Card title="Verification result" actions={<Badge value={a.outcome} />}>
      <p className="text-sm text-ink-600">{a.outcome === "psp_matched" ? "Payment fields match a successful PSP record. A PSP match does not certify PDF authenticity." : a.outcome === "suspicious" ? "Discrepancies need an operator decision. This is a risk signal, not a conclusive forgery finding." : "The available evidence is not sufficient to confirm payment. Do not treat missing PSP data as proof of forgery."}</p>
      <p className="mt-3 text-xs text-ink-500">Checked {date(a.checked_at)} · Synthetic PSP evidence</p>
    </Card>
    <Card title="Receipt ↔ PSP" description={a.evidence?.source || "No independent PSP confirmation available"} padded={false}>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-ink-50 text-xs text-ink-500"><tr><th className="p-3">Field</th><th className="p-3">Uploaded receipt</th><th className="p-3">PSP record</th></tr></thead><tbody>{rows.map(([label, claim, psp]) => <tr key={label} className="border-t border-ink-100"><th className="p-3 font-medium">{label}</th><td className={`break-all p-3 ${psp && claim !== psp ? "text-bad" : ""}`}>{claim || "Not extracted"}</td><td className="break-all p-3">{psp || "Unavailable"}</td></tr>)}</tbody></table></div>
      <p className="border-t border-ink-100 p-3 text-xs text-ink-500">PSP status: <strong>{a.evidence?.status || "unavailable"}</strong> · Exact amount, currency, reference and UTC date comparison.</p>
    </Card>
    <Card title="Evidence & risk signals"><ul className="space-y-3">{a.findings.map(f => <li key={f.code} className="flex gap-3 text-sm"><span aria-hidden className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${f.level === "risk" ? "bg-bad-bg text-bad" : f.level === "pass" ? "bg-ok-bg text-ok" : "bg-brand-50 text-brand-700"}`}>{f.level === "pass" ? "✓" : "!"}</span><span>{f.message}</span></li>)}</ul></Card>
  </div>;
}

export function ReceiptReview({ id }: { id?: string }) {
  const session = useSession();
  const root = session.kind === "admin" ? "/admin" : "/dashboard";
  const base = `${root}/receipts`;
  const canManage = session.kind === "admin" && adminCan(session.user.role, "reconciliation.manage");
  const canSubmit = session.kind === "admin" ? canManage : session.can("payments.write");
  const [listing, setListing] = useState<Listing | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [payment, setPayment] = useState("");
  const [synthetic, setSynthetic] = useState(false);
  const [demo, setDemo] = useState<Demo | null>(null);
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"queue" | "upload">("queue");
  const [refresh, setRefresh] = useState(0);
  const { api, mode } = session;
  useEffect(() => {
    let current = true;
    if (mode !== "test") { setLoading(false); return; }
    setLoading(true); setError("");
    const load = async () => {
      if (id) { const r = await api<Receipt>(`${base}/${id}`); if (current) setReceipt(r); }
      else {
        const [l, s] = await Promise.all([api<Listing>(`${base}?${new URLSearchParams({ state: filter, q: query, page: String(page) })}`), api<{ data: Sample[] }>(`${base}/samples`)]);
        if (current) { setListing(l); setSamples(s.data); }
      }
    };
    load().catch(err => { if (current) setError(errorMessage(err)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, base, id, filter, query, page, mode, refresh]);

  const run = useCallback(async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError("");
    try { await fn(); } catch (err) { setError(errorMessage(err)); } finally { setBusy(""); }
  }, []);
  async function upload(save: boolean) {
    if (!file) return;
    await run(save ? "submit" : "analyze", async () => {
      const form = new FormData(); form.append("payment_id", payment); form.append("synthetic", String(synthetic)); form.append("file", file);
      if (save) { const r = await api<{ id: string }>(`${base}/submit`, { formData: form }); window.location.assign(`${base}/${r.id}`); }
      else { const r = await api<Demo>(`${base}/analyze`, { formData: form }); setDemo(r); }
    });
  }
  async function action(key: string) {
    if (!receipt) return;
    await run(key, async () => {
      await api(`${base}/${receipt.id}/actions`, { body: { action: key, version: receipt.version, note } });
      setReceipt(await api<Receipt>(`${base}/${receipt.id}`)); setNote(""); session.toast("Case updated", "ok");
    });
  }
  if (mode !== "test") return <><PageHeader title="Receipt review" breadcrumb="Finance" /><Card title="Switch to Test Data"><p className="text-sm text-ink-600">This release uses synthetic PDF receipts and a demo PSP. Live verification is not connected.</p><Button className="mt-4" onClick={() => session.setMode("test")}>Open demo</Button></Card></>;

  return <div className="space-y-6">
    <PageHeader title={id ? "Receipt investigation" : "Receipt review"} breadcrumb={<span>Finance {id ? <>/ <Link className="text-brand-600" href={base}>Receipt review</Link></> : "/ Проверка чеков"}</span>} subtitle="Synthetic documents · Independent demo PSP evidence · Operator decisions" actions={id ? <Link href={base} className="text-sm text-brand-600">← Back to queue</Link> : <Button variant="primary" onClick={() => setTab(tab === "upload" ? "queue" : "upload")}>{tab === "upload" ? "View queue" : "Check a PDF"}</Button>} />
    {error && <Message>{error} <button className="ml-2 underline" onClick={() => setRefresh(v => v + 1)}>Refresh</button></Message>}
    {loading && <p role="status" className="animate-pulse text-sm text-ink-500">Loading receipt cases…</p>}
    {!id && <>
      <div className="rounded-xl border border-brand-100 bg-brand-50 p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><span className="text-xs font-semibold uppercase tracking-widest text-brand-700">Document intelligence</span><h2 className="mt-2 text-2xl font-semibold tracking-tight">Evidence before confirmation.</h2><p className="mt-2 max-w-3xl text-sm text-ink-600">Compare the receipt with PSP records, inspect discrepancies and keep every decision traceable. The demo uses fictional data only.</p></div><span className="rounded-full border border-brand-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-700">TEST DATA ONLY</span></div><div className="mt-5 grid gap-3 sm:grid-cols-4">{["01 · Merchant uploads PDF", "02 · Extract & inspect", "03 · Compare with PSP", "04 · Operator resolves"].map(t => <div key={t} className="rounded-lg bg-white/70 px-3 py-3 text-sm font-medium">{t}</div>)}</div></div>
      {listing && <Grid><Kpi label="Receipt cases" value={listing.stats.total} hint="Synthetic demonstration" /><Kpi label="Open reviews" value={listing.stats.open} hint="Awaiting an operator decision" /><Kpi label="Risk signals" value={listing.stats.suspicious} tone="bad" hint="Discrepancies to investigate" /><Kpi label="Waiting for PSP" value={listing.stats.waiting} hint="No final confirmation" /></Grid>}
      <div className="flex gap-2 border-b border-ink-100 pb-3"><Button variant={tab === "queue" ? "primary" : "ghost"} onClick={() => setTab("queue")}>Review queue</Button><Button variant={tab === "upload" ? "primary" : "ghost"} onClick={() => setTab("upload")}>Upload & demo lab</Button></div>
      {tab === "queue" && <Card title="Review queue" description="Open any case to inspect the receipt, PSP comparison and decision history." padded={false}>
        <form className="flex flex-wrap gap-3 p-4" onSubmit={e => { e.preventDefault(); setPage(1); setQuery(search); }}><input aria-label="Search cases" className={`${inputClass} max-w-sm`} placeholder="Merchant, payment or case ID" value={search} onChange={e => setSearch(e.target.value)} /><select aria-label="Filter cases" className={`${inputClass} max-w-[210px]`} value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}>{[["", "All cases"], ["open", "Open"], ["in_review", "In review"], ["suspicious", "Suspected alteration"], ["waiting_psp", "Waiting for PSP"], ["needs_info", "More information needed"], ["closed", "Closed"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Button type="submit">Search</Button></form>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-ink-50 text-xs uppercase text-ink-500"><tr>{["Case / merchant", "Payment", "Amount", "Assessment", "Case status", "Received"].map(t => <th className="px-4 py-3" key={t}>{t}</th>)}</tr></thead><tbody>{listing?.data.map(r => <tr key={r.id} className="border-t border-ink-100 hover:bg-brand-50/40"><td className="px-4 py-4"><Link className="font-medium text-brand-600 underline-offset-4 hover:underline" href={`${base}/${r.id}`}>{r.merchant_name}</Link><Link href={`${base}/${r.id}`} className="mt-1 block font-mono text-xs text-ink-500">{r.id.slice(0, 17)}… ↗</Link></td><td className="px-4 py-4"><Link className="text-brand-600" href={`${root}/payments/${r.payment_id}`}>{r.payment_id}</Link></td><td className="whitespace-nowrap px-4 py-4 font-medium">{money(r.amount, r.currency)}</td><td className="px-4 py-4"><Link href={`${base}/${r.id}`}><Badge value={r.assessment.outcome} /></Link></td><td className="px-4 py-4"><Badge value={r.decision || r.state} /></td><td className="whitespace-nowrap px-4 py-4 text-xs text-ink-500">{date(r.created_at)}</td></tr>)}</tbody></table></div>
        {!loading && !listing?.data.length && <p className="p-8 text-center text-sm text-ink-500">No cases match these filters. Upload a synthetic PDF to start a review.</p>}
        <div className="flex items-center justify-between border-t border-ink-100 p-4 text-xs text-ink-500"><span>{listing?.total ?? 0} cases · Page {page}</span><div className="flex gap-2"><Button disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)}>Previous</Button><Button disabled={loading || page * 25 >= (listing?.total ?? 0)} onClick={() => setPage(p => p + 1)}>Next</Button></div></div>
      </Card>}
      {tab === "upload" && <>
        <div className="grid gap-5 xl:grid-cols-2"><Card title="Upload a synthetic receipt" description="PDF up to 5 MB, 1–3 pages. Text and scanned PDFs are checked locally."><div className="space-y-4"><label className="block text-xs font-medium">Test payment ID<input className={`${inputClass} mt-2`} placeholder="pay_…" value={payment} onChange={e => { setPayment(e.target.value); setDemo(null); }} /></label><label className="block rounded-lg border-2 border-dashed border-brand-200 bg-brand-50/40 p-5"><span className="mb-3 block text-sm font-medium">Choose PDF receipt</span><input type="file" accept="application/pdf,.pdf" className="w-full text-sm" onChange={e => { setFile(e.target.files?.[0] || null); setDemo(null); }} /><span className="mt-3 block text-xs text-ink-500">Must contain “SYNTHETIC DEMO”. No real customer or bank documents.</span></label><label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={synthetic} onChange={e => setSynthetic(e.target.checked)} />This PDF contains only synthetic demo data.</label><div className="flex flex-wrap gap-2"><Button variant="primary" loading={busy === "analyze"} disabled={!!busy || !file || !payment || !synthetic} onClick={() => upload(false)}>Analyze PDF</Button>{canSubmit && <Button loading={busy === "submit"} disabled={!!busy || !file || !payment || !synthetic} onClick={() => upload(true)}>Submit for review</Button>}</div><p className="text-xs text-ink-500">{canSubmit ? "Analyze previews the result. Submit saves a case for the operations team." : "Your read-only role can test analysis. Saving cases and operator decisions requires an authorized role."}</p></div></Card>
        <Card title="Try a synthetic scenario" description="Each sample has an independent demo PSP reference record."><div className="space-y-2">{samples.map(s => <div key={s.slug} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-100 p-3"><div><p className="text-sm font-medium">{s.title}</p><button className="mt-1 text-xs text-ink-500 underline" onClick={() => setPayment(s.payment_id)}>Use {s.payment_id}</button></div><div className="flex gap-3"><a href={`/api${base}/samples/${s.slug}?mode=test`} className="self-center text-xs text-brand-600">PDF ↓</a><Button size="sm" loading={busy === s.slug} disabled={!!busy} onClick={() => run(s.slug, async () => { setDemo(null); setPayment(s.payment_id); setDemo(await api<Demo>(`${base}/demo/${s.slug}`, { body: {} })); })}>Run check</Button></div></div>)}{!samples.length && <p className="text-sm text-ink-500">Use a synthetic receipt tied to one of your test payments. Without PSP evidence it will be routed to manual review.</p>}</div></Card></div>
        {!!busy && <div role="status" className="rounded-lg bg-brand-50 p-4 text-sm text-brand-700">Reading PDF, checking the rendered document and comparing PSP evidence…</div>}
        {demo && <><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Analysis preview</h2><span className="text-xs text-ink-500">Not saved · {demo.payment_id}</span></div><div className="grid items-start gap-5 xl:grid-cols-2"><Card title="Safe document preview" description="Rendered image; no active PDF content.">{demo.previews.map((src, i) => <img key={i} src={src} alt={`Synthetic receipt page ${i + 1}`} className="mb-3 h-auto w-full rounded border border-ink-100" />)}</Card><EvidencePanel assessment={demo.assessment} /></div></>}
      </>}
    </>}
    {id && receipt && <>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand-100 bg-brand-50 p-4"><Badge value={receipt.decision || receipt.state} /><span className="text-sm font-medium">{receipt.merchant_name}</span><span className="text-sm">{money(receipt.amount, receipt.currency)}</span><Link className="text-sm text-brand-600" href={`${root}/payments/${receipt.payment_id}`}>Open payment ↗</Link><a className="ml-auto text-sm text-brand-600" href={`/api${base}/${id}/pdf?mode=test`}>Download PDF ↓</a></div>
      <div className="grid items-start gap-5 xl:grid-cols-2"><div className="space-y-5"><Card title="Submitted document" description={`${receipt.pages} page(s) · Raster preview for safe inspection`}>{Array.from({ length: receipt.pages }, (_, i) => <img key={i} src={`/api${base}/${id}/preview/${i + 1}?mode=test`} alt={`Receipt page ${i + 1}`} className="mb-3 h-auto w-full rounded border border-ink-100" />)}<details className="mt-3 text-xs text-ink-500"><summary className="cursor-pointer">File integrity / SHA-256</summary><code className="mt-2 block break-all">{receipt.sha256}</code></details></Card>
      <Card title="Case history" description="Append-only event history with reasons and timestamps."><ol className="space-y-5 border-l border-brand-200 pl-4">{receipt.events.map(e => <li key={e.id}><div className="flex flex-wrap justify-between gap-2"><strong className="text-sm">{LABELS[e.action] || e.action}</strong><span className="text-xs text-ink-500">{date(e.created_at)}</span></div><p className="mt-1 whitespace-pre-wrap text-sm text-ink-600">{e.note}</p><p className="mt-1 break-all text-xs text-ink-400">{e.actor}</p></li>)}</ol></Card></div>
      <div className="space-y-5"><EvidencePanel assessment={receipt.assessment} /><Card title="Operator decision" description="Review decisions do not credit funds or change payment balances.">{canManage ? <div className="space-y-3"><label className="block text-xs font-medium">Decision reason / request to merchant<textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={2000} className={`${inputClass} mt-2`} placeholder="Describe the evidence and the next step…" /></label><div className="flex flex-wrap gap-2">{receipt.state === "closed" ? <Button disabled={!!busy || note.trim().length < 5} onClick={() => action("reopen")}>Reopen case</Button> : <><Button disabled={!!busy} onClick={() => action("take")}>Take for review</Button><Button disabled={!!busy} onClick={() => action("recheck")}>Recheck PSP</Button><Button disabled={!!busy || note.trim().length < 5} onClick={() => action("request_info")}>Request information</Button><Button variant="danger" disabled={!!busy || note.trim().length < 5} onClick={() => action("reject")}>Reject receipt</Button><Button variant="primary" disabled={!!busy || note.trim().length < 5 || receipt.assessment.outcome !== "psp_matched"} onClick={() => action("confirm")}>Confirm PSP match</Button></>}</div>{receipt.assessment.outcome !== "psp_matched" && receipt.state !== "closed" && <p className="text-xs text-ink-500">Confirmation is locked until all required fields match a successful PSP record and no unresolved signals remain.</p>}</div> : <p className="text-sm text-ink-600">{session.kind === "admin" ? "Read-only access. An operations user can take this case, request information, reject the receipt or confirm a complete PSP match." : receipt.state === "needs_info" ? "The operations team needs more information. Read the latest request in the case history and submit a corrected synthetic PDF from the upload tab." : "Your receipt is visible to the operations team. Review progress and decision reasons appear here."}</p>}</Card></div></div>
    </>}
  </div>;
}

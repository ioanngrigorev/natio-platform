import { randomUUID } from "node:crypto";
import { getPool } from "../../db/client.js";
import { Errors } from "../../lib/errors.js";
import { assessReceipt, receiptTransition, type Assessment } from "./analysis.js";
import { demoEvidence } from "./demo.js";
import type { ParsedPdf } from "./pdf.js";

export type Scope = { merchantId?: string };
const COLUMNS = `c.id,c.merchant_id,c.payment_id,c.filename,c.sha256,c.assessment,c.state,c.decision,c.assignee,c.version,c.created_at,c.updated_at,
  m.name AS merchant_name,p.amount,p.currency,array_length(c.previews,1) AS pages`;
const FROM = `FROM receipt_cases c JOIN merchants m ON m.id=c.merchant_id JOIN payments p ON p.id=c.payment_id`;

export async function receiptPayment(scope: Scope, id: string) {
  const { rows } = await getPool().query("SELECT id,merchant_id,amount,currency FROM payments WHERE id=$1 AND mode='test' AND ($2::text IS NULL OR merchant_id=$2)", [id, scope.merchantId ?? null]);
  if (!rows[0]) throw Errors.notFound("Test payment");
  return rows[0] as { id: string; merchant_id: string; amount: number; currency: string };
}
export async function listReceipts(scope: Scope, filter: { q: string; state: string; page: number }) {
  const args = [scope.merchantId ?? null, filter.state || null, `%${filter.q}%`];
  const where = `WHERE ($1::text IS NULL OR c.merchant_id=$1) AND ($2::text IS NULL OR c.state=$2 OR c.assessment->>'outcome'=$2) AND (c.id ILIKE $3 OR c.payment_id ILIKE $3 OR m.name ILIKE $3)`;
  const [list, counts, stats] = await Promise.all([
    getPool().query(`SELECT ${COLUMNS} ${FROM} ${where} ORDER BY c.created_at DESC,c.id LIMIT 25 OFFSET $4`, [...args, (filter.page - 1) * 25]),
    getPool().query(`SELECT count(*) ${FROM} ${where}`, args),
    getPool().query(`SELECT count(*) AS total,count(*) FILTER(WHERE state!='closed') AS open,count(*) FILTER(WHERE assessment->>'outcome'='suspicious' AND state!='closed') AS suspicious,count(*) FILTER(WHERE state='waiting_psp') AS waiting,count(*) FILTER(WHERE decision='confirmed') AS confirmed FROM receipt_cases WHERE ($1::text IS NULL OR merchant_id=$1)`, [scope.merchantId ?? null]),
  ]);
  return { data: list.rows, total: Number(counts.rows[0].count), page: filter.page, stats: stats.rows[0] };
}
export async function getReceipt(scope: Scope, id: string) {
  const { rows } = await getPool().query(`SELECT ${COLUMNS} ${FROM} WHERE c.id=$1 AND ($2::text IS NULL OR c.merchant_id=$2)`, [id, scope.merchantId ?? null]);
  if (!rows[0]) throw Errors.notFound("Receipt case");
  const events = await getPool().query("SELECT id,action,actor,note,snapshot,created_at FROM receipt_events WHERE case_id=$1 ORDER BY id", [id]);
  return { ...rows[0], events: events.rows };
}
export async function receiptFile(scope: Scope, id: string, page?: number): Promise<Buffer> {
  const { rows } = await getPool().query(`SELECT ${page === undefined ? "pdf" : "previews[$3]"} AS content FROM receipt_cases WHERE id=$1 AND ($2::text IS NULL OR merchant_id=$2)`, page === undefined ? [id, scope.merchantId ?? null] : [id, scope.merchantId ?? null, page]);
  if (!rows[0]?.content) throw Errors.notFound("Receipt file");
  return rows[0].content;
}
export async function previewAssessment(scope: Scope, paymentId: string, parsed: ParsedPdf) {
  const payment = await receiptPayment(scope, paymentId);
  const reused = await getPool().query("SELECT 1 FROM receipt_cases WHERE (sha256=$1 OR fingerprint=$2) AND payment_id!=$3 LIMIT 1", [parsed.sha256, parsed.fingerprint, paymentId]);
  return assessReceipt({ text: parsed.text, ocr: parsed.ocr, expected: payment, evidence: demoEvidence(paymentId), reused: reused.rowCount !== 0 });
}
export async function submitReceipt(scope: Scope, paymentId: string, pdf: Buffer, parsed: ParsedPdf, actor: string) {
  const payment = await receiptPayment(scope, paymentId);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // Serialise duplicate detection so simultaneous cross-payment uploads cannot both pass unnoticed.
    await client.query("SELECT pg_advisory_xact_lock(902154)");
    const existing = await client.query("SELECT id FROM receipt_cases WHERE merchant_id=$1 AND payment_id=$2 AND sha256=$3", [payment.merchant_id, paymentId, parsed.sha256]);
    if (existing.rows[0]) { await client.query("COMMIT"); return { id: existing.rows[0].id, duplicate: true }; }
    const reused = await client.query("SELECT 1 FROM receipt_cases WHERE (sha256=$1 OR fingerprint=$2) AND payment_id!=$3 LIMIT 1", [parsed.sha256, parsed.fingerprint, paymentId]);
    const assessment = assessReceipt({ text: parsed.text, ocr: parsed.ocr, expected: payment, evidence: demoEvidence(paymentId), reused: reused.rowCount !== 0 });
    const id = `rcpt_${randomUUID().replaceAll("-", "")}`;
    const state = assessment.outcome === "awaiting_psp" ? "waiting_psp" : "open";
    await client.query(`INSERT INTO receipt_cases(id,merchant_id,payment_id,filename,pdf,previews,sha256,fingerprint,extracted_text,ocr_text,assessment,state)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [id, payment.merchant_id, paymentId, `${id}.pdf`, pdf, parsed.previews, parsed.sha256, parsed.fingerprint, parsed.text, parsed.ocr, assessment, state]);
    await client.query("INSERT INTO receipt_events(case_id,action,actor,note,snapshot) VALUES($1,'submitted',$2,$3,$4)", [id, actor, "Synthetic receipt uploaded and compared with independent demo PSP evidence. No payment or balance was changed.", assessment]);
    await client.query("COMMIT");
    return { id, duplicate: false };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
}
export async function reviewReceipt(id: string, action: string, version: number, note: string, actor: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT c.*,p.amount,p.currency FROM receipt_cases c JOIN payments p ON p.id=c.payment_id WHERE c.id=$1 FOR UPDATE OF c", [id]);
    const row = rows[0];
    if (!row) throw Errors.notFound("Receipt case");
    if (row.version !== version) throw Errors.conflict("receipt_changed", "Another operator updated this case. Refresh before continuing.");
    const reused = await client.query("SELECT 1 FROM receipt_cases WHERE (sha256=$1 OR fingerprint=$2) AND payment_id!=$3 LIMIT 1", [row.sha256, row.fingerprint, row.payment_id]);
    // Always re-evaluate before a decision, including confirmation; never trust a client-supplied verdict.
    const assessment: Assessment = assessReceipt({ text: row.extracted_text, ocr: row.ocr_text, expected: row, evidence: demoEvidence(row.payment_id), reused: reused.rowCount !== 0 });
    let next;
    try { next = receiptTransition(action, row.state, assessment, note); } catch (err) { throw Errors.validation((err as Error).message); }
    await client.query("UPDATE receipt_cases SET assessment=$2,state=$3,decision=$4,assignee=$5,version=version+1,updated_at=now() WHERE id=$1", [id, assessment, next.state, next.decision, actor]);
    await client.query("INSERT INTO receipt_events(case_id,action,actor,note,snapshot) VALUES($1,$2,$3,$4,$5)", [id, action, actor, note || (action === "take" ? "Operator started review." : "Checked independent demo PSP evidence again."), { ...next, assessment }]);
    await client.query("COMMIT");
    return { id };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
}

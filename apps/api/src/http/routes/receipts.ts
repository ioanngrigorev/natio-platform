import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireAdmin, requireMerchant } from "../guards.js";
import { Errors } from "../../lib/errors.js";
import { parse, parseQuery } from "../validate.js";
import { getPool } from "../../db/client.js";
import { parseReceiptPdf } from "../../modules/receipts/pdf.js";
import { RECEIPT_SAMPLES, samplePdf } from "../../modules/receipts/demo.js";
import { getReceipt, listReceipts, previewAssessment, receiptFile, receiptPayment, reviewReceipt, submitReceipt, type Scope } from "../../modules/receipts/service.js";

async function demoOnly(req: FastifyRequest) {
  if (req.dashboardMode !== "test") throw Errors.forbidden("Receipt verification is available in Test Data only. Live PSP verification is not connected.");
}
const idSchema = z.object({ id: z.string().regex(/^rcpt_[a-f0-9]{32}$/) });
const paymentSchema = z.string().regex(/^pay_[a-zA-Z0-9_-]{1,100}$/);
const limit = { rateLimit: { max: 12, timeWindow: "1 minute" } };

export async function registerReceiptRoutes(app: FastifyInstance) {
  for (const kind of ["admin", "dashboard"] as const) {
    const base = `/${kind}/receipts`;
    const read = kind === "admin" ? requireAdmin() : requireMerchant("payments.read");
    const write = kind === "admin" ? requireAdmin("reconciliation.manage") : requireMerchant("payments.write");
    const scope = (req: FastifyRequest): Scope => kind === "admin" ? {} : { merchantId: req.merchantUser!.merchant.id };
    const actor = (req: FastifyRequest) => kind === "admin" ? req.admin!.admin.id : req.merchantUser!.user.id;
    app.get(base, { preHandler: [read, demoOnly] }, async req => {
      const q = parseQuery(z.object({ q: z.string().max(100).default(""), state: z.string().max(30).default(""), page: z.coerce.number().int().min(1).max(10000).default(1) }), req.query);
      return listReceipts(scope(req), q);
    });
    app.get(`${base}/samples`, { preHandler: [read, demoOnly] }, async req => {
      const { rows } = await getPool().query("SELECT id FROM payments WHERE id=ANY($1::text[]) AND mode='test' AND ($2::text IS NULL OR merchant_id=$2)", [RECEIPT_SAMPLES.map(s => s.payment_id), scope(req).merchantId ?? null]);
      return { data: RECEIPT_SAMPLES.filter(s => rows.some(r => r.id === s.payment_id)).map(({ slug, title, payment_id }) => ({ slug, title, payment_id })) };
    });
    app.get(`${base}/samples/:slug`, { preHandler: [read, demoOnly] }, async (req, reply) => {
      const { slug } = parse(z.object({ slug: z.string().max(40) }), req.params);
      const sample = RECEIPT_SAMPLES.find(s => s.slug === slug);
      if (!sample) throw Errors.notFound("Synthetic sample");
      await receiptPayment(scope(req), sample.payment_id);
      return reply.type("application/pdf").header("content-disposition", `attachment; filename="natio-demo-${slug}.pdf"`).header("cache-control", "private, no-store").header("x-content-type-options", "nosniff").send(await samplePdf(slug));
    });
    app.post(`${base}/demo/:slug`, { preHandler: [read, demoOnly], config: limit }, async req => {
      const { slug } = parse(z.object({ slug: z.string().max(40) }), req.params);
      const sample = RECEIPT_SAMPLES.find(s => s.slug === slug);
      if (!sample) throw Errors.notFound("Synthetic sample");
      await receiptPayment(scope(req), sample.payment_id);
      const pdf = (await samplePdf(slug))!;
      const parsed = await parseReceiptPdf(pdf);
      return { assessment: await previewAssessment(scope(req), sample.payment_id, parsed), previews: parsed.previews.map(p => `data:image/png;base64,${p.toString("base64")}`), payment_id: sample.payment_id, transient: true };
    });
    for (const operation of ["analyze", "submit"] as const) {
      app.post(`${base}/${operation}`, { preHandler: [operation === "submit" ? write : read, demoOnly], config: limit }, async req => {
        const file = await req.file({ limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2, parts: 3 } });
        if (!file || file.mimetype !== "application/pdf" || !file.filename.toLowerCase().endsWith(".pdf")) throw Errors.validation("Choose a PDF file.");
        const field = (name: string) => { const f = file.fields[name]; return f && !Array.isArray(f) && f.type === "field" ? f.value : undefined; };
        const paymentId = parse(paymentSchema, field("payment_id"));
        if (field("synthetic") !== "true") throw Errors.validation("Confirm that the document is synthetic demo data.");
        // Ownership is checked BEFORE reading/rendering the uploaded file.
        await receiptPayment(scope(req), paymentId);
        const pdf = await file.toBuffer();
        if (file.file.truncated) throw Errors.validation("PDF must be no larger than 5 MB.");
        const parsed = await parseReceiptPdf(pdf);
        if (operation === "submit") return submitReceipt(scope(req), paymentId, pdf, parsed, actor(req));
        return { assessment: await previewAssessment(scope(req), paymentId, parsed), previews: parsed.previews.map(p => `data:image/png;base64,${p.toString("base64")}`), payment_id: paymentId, transient: true };
      });
    }
    app.get(`${base}/:id`, { preHandler: [read, demoOnly] }, async req => getReceipt(scope(req), parse(idSchema, req.params).id));
    app.get(`${base}/:id/pdf`, { preHandler: [read, demoOnly] }, async (req, reply) => {
      const { id } = parse(idSchema, req.params);
      return reply.type("application/pdf").header("content-disposition", `attachment; filename="${id}.pdf"`).header("cache-control", "private, no-store").header("x-content-type-options", "nosniff").send(await receiptFile(scope(req), id));
    });
    app.get(`${base}/:id/preview/:page`, { preHandler: [read, demoOnly] }, async (req, reply) => {
      const p = parse(idSchema.extend({ page: z.coerce.number().int().min(1).max(3) }), req.params);
      return reply.type("image/png").header("cache-control", "private, no-store").header("x-content-type-options", "nosniff").send(await receiptFile(scope(req), p.id, p.page));
    });
  }
  app.post("/admin/receipts/:id/actions", { preHandler: [requireAdmin("reconciliation.manage"), demoOnly] }, async req => {
    const { id } = parse(idSchema, req.params);
    const body = parse(z.object({ action: z.enum(["take", "recheck", "request_info", "confirm", "reject", "reopen"]), version: z.number().int().positive(), note: z.string().max(2000).default("") }), req.body);
    return reviewReceipt(id, body.action, body.version, body.note, req.admin!.admin.id);
  });
}

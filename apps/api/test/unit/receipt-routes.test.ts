import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { Errors } from "../../src/lib/errors.js";

vi.mock("../../src/db/client.js", () => ({ getDb: () => ({}), getPool: () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }) }));
vi.mock("../../src/modules/auth/service.js", () => ({
  resolveAdminSession: (_db: unknown, token: string) => token === "expired" ? null : ({ admin: { id: "admin_test", role: token }, session: { csrfToken: "csrf-test" } }),
  resolveMerchantSession: (_db: unknown, token: string) => ({ user: { id: "user_test", role: token }, merchant: { id: "mer_owned", status: "active" }, session: { csrfToken: "csrf-test" } }),
}));
vi.mock("../../src/modules/receipts/pdf.js", () => ({ parseReceiptPdf: vi.fn().mockResolvedValue({ text: "", ocr: "", previews: [], sha256: "a", fingerprint: "b", pages: 1 }) }));
vi.mock("../../src/modules/receipts/service.js", () => ({
  listReceipts: vi.fn().mockResolvedValue({ data: [] }),
  getReceipt: vi.fn(async (scope: { merchantId?: string }) => { if (scope.merchantId) throw Errors.notFound("Receipt case"); return { id: "ok" }; }),
  receiptPayment: vi.fn(async (scope: { merchantId?: string }, id: string) => { if (scope.merchantId && id !== "pay_owned") throw Errors.notFound("Test payment"); return {}; }),
  previewAssessment: vi.fn().mockResolvedValue({ outcome: "needs_review" }),
  submitReceipt: vi.fn().mockResolvedValue({ id: "rcpt_test" }),
  reviewReceipt: vi.fn().mockResolvedValue({ id: "rcpt_test" }),
  receiptFile: vi.fn(async (scope: { merchantId?: string }) => { if (scope.merchantId) throw Errors.notFound("Receipt file"); return Buffer.from("x"); }),
}));
import { registerReceiptRoutes } from "../../src/http/routes/receipts.js";
import { parseReceiptPdf } from "../../src/modules/receipts/pdf.js";
import { listReceipts } from "../../src/modules/receipts/service.js";
let app: FastifyInstance;
const caseId = `rcpt_${"a".repeat(32)}`;
beforeEach(async () => {
  vi.clearAllMocks(); app = Fastify();
  await app.register(cookie); await app.register(multipart);
  app.setErrorHandler((error, _req, reply) => { const err = error as { status?: number; message?: string }; reply.code(err.status || 500).send({ message: err.message }); });
  await registerReceiptRoutes(app); await app.ready();
});
afterEach(async () => { await app.close(); });
describe("receipt route access boundaries", () => {
  it("requires authentication", async () => expect((await app.inject("/admin/receipts")).statusCode).toBe(401));
  it("rejects expired sessions", async () => expect((await app.inject({ url: "/admin/receipts", cookies: { natio_admin_session: "expired" } })).statusCode).toBe(401));
  it("rejects Live Data before accessing records", async () => {
    const r = await app.inject({ url: "/admin/receipts", cookies: { natio_admin_session: "readonly" }, headers: { "x-natio-mode": "live" } });
    expect(r.statusCode).toBe(403); expect(listReceipts).not.toHaveBeenCalled();
  });
  it("passes merchant scope into list queries", async () => {
    expect((await app.inject({ url: "/dashboard/receipts", cookies: { natio_session: "viewer" } })).statusCode).toBe(200);
    expect(listReceipts).toHaveBeenCalledWith({ merchantId: "mer_owned" }, expect.anything());
  });
  it.each(["", "/pdf", "/preview/1"])("does not expose another merchant case%s", async suffix => {
    expect((await app.inject({ url: `/dashboard/receipts/${caseId}${suffix}`, cookies: { natio_session: "owner" } })).statusCode).toBe(404);
  });
  it("requires CSRF on even transient analyses", async () => {
    expect((await app.inject({ method: "POST", url: "/admin/receipts/analyze", cookies: { natio_admin_session: "readonly" } })).statusCode).toBe(403);
  });
  it.each(["readonly", "support"])("blocks %s operator decisions", async role => {
    expect((await app.inject({ method: "POST", url: `/admin/receipts/${caseId}/actions`, cookies: { natio_admin_session: role }, headers: { "x-csrf-token": "csrf-test" }, payload: { action: "reject", version: 1, note: "Example reason" } })).statusCode).toBe(403);
  });
  it("allows authorized operations role with CSRF", async () => {
    expect((await app.inject({ method: "POST", url: `/admin/receipts/${caseId}/actions`, cookies: { natio_admin_session: "operations" }, headers: { "x-csrf-token": "csrf-test" }, payload: { action: "reject", version: 1, note: "Example reason" } })).statusCode).toBe(200);
  });
  it("rejects foreign payment uploads before parsing bytes", async () => {
    const payload = '--boundary\r\nContent-Disposition: form-data; name="payment_id"\r\n\r\npay_foreign\r\n--boundary\r\nContent-Disposition: form-data; name="synthetic"\r\n\r\ntrue\r\n--boundary\r\nContent-Disposition: form-data; name="file"; filename="receipt.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\r\n--boundary--\r\n';
    const r = await app.inject({ method: "POST", url: "/dashboard/receipts/submit", cookies: { natio_session: "owner" }, headers: { "x-csrf-token": "csrf-test", "content-type": "multipart/form-data; boundary=boundary" }, payload });
    expect(r.statusCode).toBe(404); expect(parseReceiptPdf).not.toHaveBeenCalled();
  });
});

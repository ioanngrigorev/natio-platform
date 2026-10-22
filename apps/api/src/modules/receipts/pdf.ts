import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Errors } from "../../lib/errors.js";

const exec = promisify(execFile);
let running = false;
export type ParsedPdf = { text: string; ocr: string; previews: Buffer[]; sha256: string; fingerprint: string; pages: number };
export async function parseReceiptPdf(pdf: Buffer): Promise<ParsedPdf> {
  if (pdf.length > 5 * 1024 * 1024 || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw Errors.validation("Upload a valid PDF of up to 5 MB.");
  if (running) throw Errors.conflict("receipt_parser_busy", "Another PDF is being checked. Please retry in a few seconds.");
  running = true;
  let dir: string | undefined;
  try {
    dir = await mkdtemp(join(tmpdir(), "natio-receipt-"));
    const file = join(dir, "receipt.pdf");
    await writeFile(file, pdf, { mode: 0o600 });
    const options = { timeout: 10000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, LANG: "C.UTF-8", OMP_THREAD_LIMIT: "1" } };
    const { stdout: info } = await exec("pdfinfo", [file], options);
    const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
    if (!pages || pages > 3 || /^Encrypted:\s+yes/m.test(info)) throw Errors.validation("Use an unencrypted PDF with 1–3 pages.");
    const { stdout: text } = await exec("pdftotext", ["-layout", "-enc", "UTF-8", file, "-"], options);
    if (text.length > 50000) throw Errors.validation("PDF contains too much text for a receipt.");
    const previews: Buffer[] = [];
    let ocr = "";
    for (let page = 1; page <= pages; page++) {
      const prefix = join(dir, `page-${page}`);
      await exec("pdftoppm", ["-f", String(page), "-l", String(page), "-singlefile", "-scale-to", "1800", "-png", file, prefix], options);
      const png = await readFile(`${prefix}.png`);
      if (png.length > 5 * 1024 * 1024) throw Errors.validation("PDF preview is too large.");
      previews.push(png);
      const { stdout } = await exec("tesseract", [`${prefix}.png`, "stdout", "-l", "eng", "--psm", "6"], options);
      ocr += `\n${stdout}`;
    }
    // This release is intentionally a synthetic demo. Never send documents to an external OCR service.
    if (!/SYNTHETIC DEMO/i.test(text + ocr)) throw Errors.validation("Demo only: use a synthetic PDF marked SYNTHETIC DEMO. Real receipts are not accepted in this demo.");
    return { text, ocr, previews, pages, sha256: createHash("sha256").update(pdf).digest("hex"), fingerprint: createHash("sha256").update((text || ocr).toUpperCase().replace(/\s+/g, " ").trim()).digest("hex") };
  } catch (err) {
    if (err && typeof err === "object" && "status" in err) throw err;
    throw Errors.validation("Could not safely read this PDF. Use an unencrypted 1–3 page PDF, or try again with a clearer synthetic sample.");
  } finally {
    running = false;
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

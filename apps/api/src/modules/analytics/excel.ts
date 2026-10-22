import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";
import { getPool } from "../../db/client.js";
import { biWhere, businessIntelligence, type BiQuery } from "./bi.js";

export function moneyDivisor(currency: string) {
  return 10 ** new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits!;
}

function header(sheet: ExcelJS.Worksheet, labels: string[]) {
  sheet.columns = labels.map(h => ({ header: h, width: Math.max(16, Math.min(h.length + 4, 38)) }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D17F3" } };
  sheet.getRow(1).height = 26;
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: labels.length } };
}

/** Stream row batches. No million-row JS array and no silent truncation. */
export function excelReport(q: BiQuery, mode: "test" | "live") {
  const stream = new PassThrough({ highWaterMark: 1024 * 1024 });
  const completed = (async () => {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
    workbook.creator = "NATIO";
    const info = workbook.addWorksheet("Report", { views: [{ state: "frozen", ySplit: 1 }] });
    header(info, ["NATIO report", "Value"]);
    [["Mode", mode], ["From (UTC)", q.from], ["To (UTC, inclusive)", q.to], ["Currency", q.kind === "transactions" && q.all_currencies === "1" ? "All currencies, separate rows" : q.currency], ["Merchant", q.merchant_id || "All"], ["Method", q.method || "All"], ["Data", mode === "test" ? "Synthetic demo transactions" : "Live transactions"], ["Amounts", "Major currency units; no FX conversion"]].forEach(r => info.addRow(r).commit());
    info.commit();
    if (q.kind === "transactions") {
      const client = await getPool().connect();
      try {
        const f = biWhere(q, mode, q.all_currencies !== "1");
        await client.query("BEGIN READ ONLY");
        await client.query(`DECLARE demo_export NO SCROLL CURSOR FOR SELECT t.*,m.name merchant,p.name channel FROM transactions t JOIN merchants m ON m.id=t.merchant_id JOIN projects p ON p.id=t.project_id WHERE ${f.where} ORDER BY t.occurred_at,t.id`,f.values);
        let sheet: ExcelJS.Worksheet, count=0, sheetNumber=0;
        const createSheet = () => { const s = workbook.addWorksheet(`Transactions ${++sheetNumber}`, { views: [{ state: "frozen", ySplit: 1 }] }); header(s,["ID","Merchant","Channel","Date UTC","Type","Status","Method","Country","Currency","Amount","Fee","Net","Gateway reference"]); for (let c=10;c<=12;c++) s.getColumn(c).numFmt='#,##0.00'; return s; };
        sheet=createSheet();
        while (true) {
          if (stream.destroyed) throw new Error("Download cancelled");
          const rows=await client.query("FETCH FORWARD 5000 FROM demo_export");
          if (!rows.rowCount) break;
          for (const r of rows.rows) {
            if (count && count%1000000===0) { sheet.commit(); sheet=createSheet(); }
            const divisor=moneyDivisor(r.currency);
            sheet.addRow([r.id,r.merchant,r.channel,new Date(r.occurred_at).toISOString(),r.type,r.status,r.payment_method_type,r.country,r.currency,r.amount/divisor,r.fee_amount/divisor,r.net_amount/divisor,r.provider_reference]).commit(); count++;
          }
        }
        sheet.commit(); await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    } else {
      const r=await businessIntelligence(q,mode);
      for (const [name,rows,key] of [["Summary",[r.summary],null],["Daily",r.daily,"day"],["Payment methods",r.methods,"label"],["Countries",r.countries,"label"],["Merchants",r.merchants,"label"],["Currency balances",r.balances,"currency"]] as const) {
        const sheet=workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
        header(sheet,[key || "Scope","Currency","Transactions","Successful","Failed","Pending","Pay-in volume","Fees","Payouts","Ledger net","Settled","Unsettled balance"]);
        for(let c=7;c<=12;c++) sheet.getColumn(c).numFmt='#,##0.00';
        for(const row of rows) {
          const currency=row.currency || q.currency, divisor=moneyDivisor(currency);
          sheet.addRow([key ? row[key] : "Selected filters",currency,Number(row.transactions),Number(row.successful),Number(row.failed),Number(row.pending),Number(row.volume)/divisor,Number(row.fees)/divisor,Number(row.payouts)/divisor,Number(row.ledger_net)/divisor,Number(row.settled)/divisor,(Number(row.ledger_net)-Number(row.settled))/divisor]).commit();
        }
        sheet.commit();
      }
    }
    await workbook.commit();
  })();
  completed.catch(error => stream.destroy(error instanceof Error ? error : new Error(String(error))));
  return { stream, completed };
}

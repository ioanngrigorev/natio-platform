import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";
import { getPool } from "../../db/client.js";
import { biWhere, measures, type BiQuery } from "./bi.js";
import { demoLabel } from "../demo/display.js";

export interface ReportColumn { key:string; label:string; type:"text"|"number"|"money"; link?:string }
const text=(key:string,label:string,link?:string):ReportColumn=>({key,label,type:"text",link});
const number=(key:string,label:string):ReportColumn=>({key,label,type:"number"});
const money=(key:string,label:string):ReportColumn=>({key,label,type:"money"});
const metrics=[number("transactions","Transactions"),number("successful","Successful"),number("failed","Failed"),number("pending","Pending"),money("volume","Pay-in volume"),money("fees","Fees"),money("payouts","Payouts"),money("ledger_net","Ledger net"),money("settled","Settled"),money("unsettled","Unsettled balance")];

/** A single bounded filter/sort plan drives the preview and both export formats. */
export function reportPlan(q:BiQuery, mode:"test"|"live") {
  const f=biWhere(q,mode,q.all_currencies!=="1");
  let sql:string, columns:ReportColumn[], fallback:string;
  if(q.kind==="transactions") {
    columns=[text("id","Transaction ID"),text("merchant","Merchant","/admin/merchants/"),text("account","Provider account","/admin/provider-accounts/"),text("occurred_at","Date UTC"),text("type","Type"),text("status","Status"),text("method","Payment method"),text("country","Country"),text("currency","Currency"),money("amount","Amount"),money("fees","Fee"),money("net","Net"),text("provider_reference","Gateway reference")];
    sql=`SELECT t.id,t.merchant_id,t.provider_account_id,m.name merchant,a.name account,to_char(t.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') occurred_at,t.type,t.status,t.payment_method_type method,t.country,t.currency,t.amount,t.fee_amount fees,t.net_amount net,t.provider_reference FROM transactions t JOIN merchants m ON m.id=t.merchant_id LEFT JOIN provider_accounts a ON a.id=t.provider_account_id WHERE ${f.where}`;
    fallback="occurred_at";
  } else {
    const definitions:Record<string,{label:string;id?:string;join?:string;title:string;link?:string}>={
      summary:{label:"'Selected filters'",title:"Scope"},
      daily:{label:"to_char(t.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD')",title:"Day UTC"},
      merchants:{label:"m.name",id:"t.merchant_id",join:"JOIN merchants m ON m.id=t.merchant_id",title:"Merchant",link:"/admin/merchants/"},
      providers:{label:"a.name",id:"t.provider_account_id",join:"LEFT JOIN provider_accounts a ON a.id=t.provider_account_id",title:"Provider account",link:"/admin/provider-accounts/"},
      methods:{label:"t.payment_method_type",title:"Payment method"},
      countries:{label:"t.country",title:"Country"},
      balances:{label:"t.currency",title:"Balance currency"},
    };
    const d=definitions[q.kind];
    columns=[text("label",d.title,d.link),text("currency","Currency"),...metrics];
    const qualified=measures.replace(/\b(status|amount|type|fee_amount|net_amount|settlement_id)\b/g,"t.$1");
    sql=`SELECT ${d.label} label,${d.id?`${d.id} entity_id,`:""}t.currency,${qualified},coalesce(sum(t.net_amount) FILTER(WHERE t.status='successful' AND t.settlement_id IS NULL),0)::bigint unsettled FROM transactions t ${d.join||""} WHERE ${f.where} GROUP BY ${d.id?"1,2,3":"1,2"}`;
    fallback=q.kind==="daily"?"label":"transactions";
  }
  const sort=columns.some(c=>c.key===q.sort)?q.sort:fallback;
  // Identifiers come solely from the above whitelist; values are always bound parameters.
  const order=`"${sort}" ${q.direction==="asc"?"ASC":"DESC"} NULLS LAST, ${q.kind==="transactions"?'"id"':'"currency", "label"'+(["providers","merchants"].includes(q.kind)?', "entity_id"':'')}`;
  return {sql,values:f.values,order,columns};
}

export function reportRow(row:Record<string,unknown>,columns:ReportColumn[],mode:"test"|"live") {
  const out={...row};
  const divisor=10**new Intl.NumberFormat("en",{style:"currency",currency:String(row.currency)}).resolvedOptions().maximumFractionDigits!;
  for(const c of columns) {
    if(c.type==="money")out[c.key]=Number(row[c.key])/divisor;
    else if(c.type==="number")out[c.key]=Number(row[c.key]);
    else if(mode==="test"&&["label","method","account"].includes(c.key)&&typeof row[c.key]==="string")out[c.key]=demoLabel(row[c.key] as string);
  }
  return out;
}

export async function reportPreview(q:BiQuery,mode:"test"|"live") {
  const p=reportPlan(q,mode);
  // One grouped plan, count and requested page, including an accurate total for empty pages.
  const result=await getPool().query(`WITH result AS MATERIALIZED (${p.sql}), page AS (SELECT * FROM result ORDER BY ${p.order} LIMIT $${p.values.length+1} OFFSET $${p.values.length+2}) SELECT (SELECT count(*) FROM result) total,coalesce((SELECT json_agg(page) FROM page),'[]') rows`,[...p.values,q.limit,(q.page-1)*q.limit]);
  return {kind:q.kind,columns:p.columns,rows:result.rows[0].rows.map((r:Record<string,unknown>)=>reportRow(r,p.columns,mode)),total:Number(result.rows[0].total),page:q.page,limit:q.limit,units:"Major currency units; no FX conversion"};
}

/** CSV strings are quoted and formula-neutralized; numeric negatives remain numeric. */
export function csvCell(value:unknown) {
  if(value==null)return '""';
  if(typeof value==="number")return String(value);
  let s=String(value); if(/^[\s]*[=+\-@]|^[\t\r\n]/.test(s))s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}

export function tabularReport(q:BiQuery,mode:"test"|"live",format:"xlsx"|"csv") {
  const stream=new PassThrough({highWaterMark:1024*1024});
  const completed=(async()=>{
    const p=reportPlan(q,mode),client=await getPool().connect();
    const workbook=format==="xlsx"?new ExcelJS.stream.xlsx.WorkbookWriter({stream,useStyles:true,useSharedStrings:false}):null;
    let sheet:ExcelJS.Worksheet|undefined, count=0,part=0;
    const makeSheet=()=>{
      const s=workbook!.addWorksheet(`${q.kind} ${++part}`,{views:[{state:"frozen",ySplit:1}]});
      s.columns=p.columns.map(c=>({header:c.label,width:c.type==="text"?28:20}));
      s.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};
      s.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF116B50"}};
      s.autoFilter={from:{row:1,column:1},to:{row:1,column:p.columns.length}};
      p.columns.forEach((c,i)=>{if(c.type==="money")s.getColumn(i+1).numFmt='#,##0.00###';});
      return s;
    };
    const write=async(s:string)=>{if(stream.destroyed)throw new Error("Download cancelled");if(!stream.write(s))await new Promise<void>((resolve,reject)=>{const clean=()=>{stream.off("drain",drained);stream.off("close",closed);stream.off("error",failed);};const drained=()=>{clean();resolve();};const closed=()=>{clean();reject(new Error("Download cancelled"));};const failed=(e:Error)=>{clean();reject(e);};stream.once("drain",drained);stream.once("close",closed);stream.once("error",failed);});};
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL statement_timeout='120s'");
      await client.query(`DECLARE report_export NO SCROLL CURSOR FOR ${p.sql} ORDER BY ${p.order}`,p.values);
      if(workbook){
        workbook.creator="NATIO";
        const info=workbook.addWorksheet("Filters");info.columns=[{header:"NATIO report",width:28},{header:"Value",width:60}];
        const filters={...q,mode,amounts:"Major currency units; no FX conversion",data:mode==="test"?"Synthetic demo data":"Live data",generated_utc:new Date().toISOString()};
        for(const [k,v] of Object.entries(filters))if(!["page","limit"].includes(k))info.addRow([k,k==="method"&&mode==="test"?demoLabel(String(v)):v]).commit();
        info.commit();sheet=makeSheet();
      }else await write('\uFEFF'+p.columns.map(c=>csvCell(c.label)).join(',')+'\r\n');
      while(true){
        if(stream.destroyed)throw new Error("Download cancelled");
        const batch=await client.query("FETCH FORWARD 2000 FROM report_export");if(!batch.rowCount)break;
        for(const raw of batch.rows){
          const row=reportRow(raw,p.columns,mode), values=p.columns.map(c=>row[c.key]??null);
          if(workbook){if(count&&count%1000000===0){sheet!.commit();sheet=makeSheet();}sheet!.addRow(values).commit();}
          else await write(values.map(csvCell).join(',')+'\r\n');
          count++;
        }
      }
      await client.query("COMMIT");
      if(workbook){sheet!.commit();await workbook.commit();}else stream.end();
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  })();
  completed.catch(error=>stream.destroy(error instanceof Error?error:new Error(String(error))));
  return {stream,completed};
}

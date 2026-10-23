"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
const ReportInsights=dynamic(()=>import("./report-insights").then(m=>m.ReportInsights),{ssr:false});
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";

const templates=[['summary','Executive summary','Headline totals and a multi-sheet Excel workbook.'],['transactions','Transaction ledger','Individual operations, amounts, fees and references.'],['daily','Daily activity','Daily transaction counts, volume and fees.'],['merchants','Merchant performance','Performance and unsettled funds for every merchant.'],['providers','Provider accounts','Account-level volume, outcomes and fees.'],['methods','Payment methods','Method usage and processing performance.'],['countries','Geography','Country-level activity and balances.'],['traffic','FTD / STD traffic','Merchant-declared first and returning deposits.'],['balances','Currency balances','Ledger, settled and unsettled funds by currency.']];
type Column={key:string;label:string;type:'text'|'number'|'money';link?:string};
type Preview={columns:Column[];rows:Record<string,string|number|null>[];total:number;page:number;limit:number;units:string};
type View={name:string;query:string;kind:string;all:boolean;sort:string;direction:string};
export function ReportCenter({query,mode,userId}:{query:string;mode:'test'|'live';userId:string}) {
  const router=useRouter();
  const initial=new URLSearchParams(query);
  const [kind,setKind]=useState(templates.some(t=>t[0]===initial.get('kind'))?initial.get('kind')!:'summary');
  const [all,setAll]=useState(initial.get('all_currencies')==='1');
  const [sort,setSort]=useState(initial.get('sort')||'transactions');
  const [direction,setDirection]=useState(initial.get('direction')||'desc');
  const [page,setPage]=useState(1),[preview,setPreview]=useState<Preview|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [busy,setBusy]=useState(false),[downloadStatus,setDownloadStatus]=useState('');
  const [name,setName]=useState(''),[views,setViews]=useState<View[]>([]),[notice,setNotice]=useState('');
  const abort=useRef<AbortController|null>(null);
  const key=`natio.report-views.${userId}.${mode}`;
  const params=new URLSearchParams(query);params.set('kind',kind);params.set('all_currencies',all?'1':'0');params.set('sort',sort);params.set('direction',direction);params.set('page',String(page));params.set('limit','25');
  const request=params.toString();
  const chartParams=new URLSearchParams(params);["page","limit","sort","direction"].forEach(k=>chartParams.delete(k));
  useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem(key)||'[]');setViews(Array.isArray(saved)?saved.filter(v=>typeof v.name==='string'&&typeof v.query==='string').slice(0,20):[]);}catch{setViews([]);}},[key]);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');setPreview(null);
    fetch(`/api/admin/bi/report?${request}`,{headers:{'x-natio-mode':mode},signal:controller.signal,cache:'no-store'}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error?.message||`Report failed (${r.status})`);return data;}).then(setPreview).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[request,mode]);
  useEffect(()=>()=>abort.current?.abort(),[]);
  function persist(next:View[]){try{localStorage.setItem(key,JSON.stringify(next));setViews(next);return true;}catch{setNotice('Browser storage is unavailable.');return false;}}
  function save(){const title=name.trim();if(!title)return;const next=[{name:title,query,kind,all,sort,direction},...views.filter(v=>v.name!==title)].slice(0,20);if(persist(next)){setName('');setNotice('View saved in this browser.');}}
  function load(v:View){setKind(v.kind);setAll(v.all);setSort(v.sort);setDirection(v.direction);setPage(1);const p=new URLSearchParams(v.query);p.set('kind',v.kind);p.set('all_currencies',v.all?'1':'0');p.set('sort',v.sort);p.set('direction',v.direction);router.push(`/admin/bi?${p}`);}
  async function download(format:'xlsx'|'csv'){
    const controller=new AbortController();abort.current=controller;setBusy(true);setDownloadStatus('Preparing all matching rows…');
    try{
      const r=await fetch(`/api/admin/bi/export.${format}?${request}`,{headers:{'x-natio-mode':mode},signal:controller.signal});
      if(!r.ok){const body=await r.json().catch(()=>null);throw new Error(body?.error?.message||`Download failed (${r.status}). Try again shortly.`);}
      const reader=r.body?.getReader();if(!reader)throw new Error('Download stream unavailable.');
      const chunks:ArrayBuffer[]=[];let size=0,last=0;
      while(true){const value=await reader.read();if(value.done)break;chunks.push(new Uint8Array(value.value).buffer);size+=value.value.byteLength;if(Date.now()-last>300){setDownloadStatus(`Receiving report · ${(size/1048576).toFixed(1)} MB`);last=Date.now();}}
      const blob=new Blob(chunks,{type:r.headers.get('content-type')||'application/octet-stream'}),url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;a.download=`NATIO-${kind}-${params.get('from')}-${params.get('to')}.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
      setDownloadStatus(`Report downloaded · ${(size/1048576).toFixed(1)} MB`);
    }catch(e){setDownloadStatus(e instanceof Error&&e.name==='AbortError'?'Download cancelled.':e instanceof Error?e.message:'Download failed.');}finally{setBusy(false);abort.current=null;}
  }
  const sortKeys=kind==='transactions'?['occurred_at','amount','fees','currency']:['transactions','volume','fees','label','currency'];
  return <section id="reports" className="mt-6 scroll-mt-5">
    <Card title="Report center" description="Choose a report, preview the results, then export all matching rows.">
      <div className="report-controls grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{templates.map(([id,title,description])=><button type="button" key={id} aria-pressed={kind===id} onClick={()=>{setKind(id);setPage(1);setSort(id==='transactions'?'occurred_at':id==='daily'?'label':'transactions');}} className={`rounded-xl border p-4 text-left ${kind===id?'border-brand-600 bg-ink-50':'border-ink-200'}`}><span className="block text-sm font-semibold text-brand-600">{title}</span><span className="mt-1 block text-xs text-ink-500">{description}</span></button>)}</div>
      <div className="report-controls my-5 flex flex-wrap items-end gap-3">
        <label className="text-xs text-ink-500">Report currencies<select aria-label="Report currencies" className="input mt-1" value={all?'all':'selected'} onChange={e=>{setAll(e.target.value==='all');setPage(1);}}><option value="selected">Selected currency ({params.get('currency')})</option><option value="all">All currencies · separate rows</option></select></label>
        <label className="text-xs text-ink-500">Sort by<select className="input mt-1" value={sortKeys.includes(sort)?sort:sortKeys[0]} onChange={e=>{setSort(e.target.value);setPage(1);}}>{sortKeys.map(s=><option key={s} value={s}>{s.replace('_',' ')}</option>)}</select></label>
        <label className="text-xs text-ink-500">Order<select className="input mt-1" value={direction} onChange={e=>{setDirection(e.target.value);setPage(1);}}><option value="desc">Descending</option><option value="asc">Ascending</option></select></label>
        <button disabled={busy||loading||!preview||preview.total===0} onClick={()=>download('xlsx')} className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-40">Excel ↓</button>
        <button disabled={busy||loading||!preview||preview.total===0} onClick={()=>download('csv')} className="rounded-lg border border-brand-600 px-4 py-2 text-sm text-brand-600 disabled:opacity-40">CSV ↓</button>
        <button onClick={()=>window.print()} className="rounded-lg border border-ink-200 px-4 py-2 text-sm">Print page / PDF</button>
        {busy&&<button onClick={()=>abort.current?.abort()} className="text-sm text-brand-600">Cancel download</button>}
      </div>
      <p className="mb-3 text-xs text-ink-500">{params.get('from')} — {params.get('to')} UTC · {mode==='test'?'Synthetic demo data':'Live data'} · {all?'All currencies, separate rows':params.get('currency')} · All page filters apply. No currency conversion.</p>
      <ReportInsights query={chartParams.toString()} mode={mode}/>
      {downloadStatus&&<p className="mb-3 text-sm text-brand-600" role="status">{downloadStatus}</p>}
      {loading?<p className="py-10 text-center text-ink-500" role="status">Building report preview…</p>:error?<p className="py-6 text-center text-bad" role="alert">{error}</p>:preview&&<>
        <p className="mb-3 text-sm text-ink-500">{preview.total.toLocaleString('en')} rows · Preview {preview.total?((page-1)*25+1).toLocaleString('en'):0}–{Math.min(page*25,preview.total).toLocaleString('en')}. Exports contain every matching row.</p>
        <div className="overflow-x-auto"><table className="data-table w-full"><thead><tr>{preview.columns.map(c=><th key={c.key} className="whitespace-nowrap">{c.label}</th>)}</tr></thead><tbody>{preview.rows.map((row,i)=><tr key={String(row.id||`${page}-${i}`)}>{preview.columns.map(c=>{const value=row[c.key],id=c.key==='merchant'?row.merchant_id:c.key==='account'?row.provider_account_id:row.entity_id;const display=value==null?'—':c.type==='money'?Number(value).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:5}):c.type==='number'?Number(value).toLocaleString('en'):String(value);return <td key={c.key} className={`whitespace-nowrap ${c.type==='text'?'':'num'}`}>{c.link&&id?<Link className="text-brand-600" href={c.link+encodeURIComponent(String(id))}>{display}</Link>:display}</td>;})}</tr>)}</tbody></table></div>
        {!preview.rows.length&&<p className="py-8 text-center text-ink-500">No rows match these filters.</p>}
        <div className="report-controls mt-4 flex items-center justify-end gap-3 text-sm"><button disabled={page===1} onClick={()=>setPage(p=>p-1)} className="rounded-lg border border-ink-200 px-3 py-1 disabled:opacity-40">Previous</button><span>Page {page} of {Math.max(1,Math.ceil(preview.total/25))}</span><button disabled={page*25>=preview.total} onClick={()=>setPage(p=>p+1)} className="rounded-lg border border-ink-200 px-3 py-1 disabled:opacity-40">Next</button></div>
      </>}
      <details className="report-controls mt-5 border-t border-ink-200 pt-4"><summary className="cursor-pointer text-sm font-semibold">Saved report views ({views.length})</summary><p className="mt-2 text-xs text-ink-500">Saved filters and templates stay in this browser for your admin account.</p><div className="my-3 flex gap-2"><input aria-label="Report view name" placeholder="Name this view" maxLength={80} className="input max-w-xs" value={name} onChange={e=>setName(e.target.value)}/><button disabled={!name.trim()} onClick={save} className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-40">Save view</button></div>{notice&&<p className="mb-2 text-xs" role="status">{notice}</p>}{views.map((v,i)=><div key={v.name+i} className="flex items-center gap-4 py-2 text-sm"><button onClick={()=>load(v)} className="text-brand-600">{v.name} →</button><button onClick={()=>persist(views.filter((_,n)=>n!==i))} className="text-ink-500" aria-label={`Remove saved view ${v.name}`}>Remove</button></div>)}</details>
    </Card>
  </section>;
}

'use client';
import {useI18n} from '@/lib/i18n/provider';

import {useEffect,useState} from 'react';
export const attachmentAccept='.pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.tsv,.md,.xlsx,.docx';
export function fileSelection(existing:File[],incoming:File[]){const files=[...existing,...incoming];if(files.length>4)throw Error("Up to 4 files in one request.");if(files.some(f=>f.size>5*1024*1024)||files.reduce((n,f)=>n+f.size,0)>10*1024*1024)throw Error("Up to 5 MB per file and 10 MB total.");if(files.some(f=>!attachmentAccept.split(',').some(ext=>f.name.toLowerCase().endsWith(ext))))throw Error("Supports PDF, PNG/JPEG/WebP photos, TXT, CSV, TSV, MD, XLSX and DOCX.");return files;}
function Preview({file}:{file:File}){
 const {t:translateUi,locale:uiLocale}=useI18n();
const [url,setUrl]=useState('');useEffect(()=>{if(!file.type.startsWith('image/'))return;const u=URL.createObjectURL(file);setUrl(u);return()=>URL.revokeObjectURL(u)},[file]);return url?<img src={url} alt={translateUi(file.name)} className="h-10 w-10 rounded-md object-cover"/>:<span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-md bg-ink-100 text-xs font-semibold">{translateUi(file.name.split('.').pop()?.toUpperCase())}</span>}
export function AttachmentList({files,onRemove,disabled}:{files:File[];onRemove:(i:number)=>void;disabled:boolean}){
 const {t:translateUi,locale:uiLocale}=useI18n();
return <div className="my-3 space-y-2">{translateUi(files.map((f,i)=><div key={f.name+'-'+i} className="flex items-center gap-3 rounded-lg border border-ink-200 p-2"><Preview file={f}/><div className="min-w-0 flex-1"><p className="truncate text-xs">{f.name}</p><p className="text-[10px] text-ink-500">{translateUi((f.size/1024).toFixed(0))}{translateUi(" KB · ready to send")}</p></div><button type="button" disabled={disabled} aria-label={translateUi(translateUi("Remove ")+f.name)} className="px-2" onClick={()=>onRemove(i)}>×</button></div>))}</div>}

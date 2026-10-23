'use client';
import {useI18n} from '@/lib/i18n/provider';

import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useSession} from '@/components/session-provider';
export function DevelopmentNotifications(){
 const {t:translateUi,locale:uiLocale}=useI18n();
const {api,kind}=useSession(),[unread,setUnread]=useState(0),base=kind==='admin'?'/admin':'/dashboard';useEffect(()=>{let active=true;async function load(){if(document.visibilityState==='hidden')return;try{const r=await api<{data:{action:string|null}[]}>(base+'/development/notices');if(active)setUnread(r.data.filter(n=>!n.action).length)}catch{}}void load();const t=setInterval(()=>void load(),60000);return()=>{active=false;clearInterval(t)}},[api,base]);return <Link className="relative text-xs text-ink-500" title={translateUi("Product releases and integration opportunities")} aria-label={translateUi(translateUi("Product updates: ")+unread+translateUi(" unread"))} href={base+'/development?view=opportunities'}><svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6"/></svg>{translateUi(unread?<span className="absolute -right-2 -top-2 rounded-full bg-brand-600 px-1 text-[8px] text-white">{translateUi(unread>9?'9+':unread)}</span>:null)}</Link>}

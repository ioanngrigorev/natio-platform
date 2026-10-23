'use client';
import {useI18n} from '@/lib/i18n/provider';

import Link from 'next/link';
import {useEffect,useState} from 'react';
import {useSession} from '@/components/session-provider';
import {intlLocales} from '@/lib/i18n/core';
import {timeOfDay,greetingLabels,dailyQuoteIndex} from '@/lib/greeting';
type Quote={id:string;text:string;author:string;source:string};
export function DayIcon({period}:{period:ReturnType<typeof timeOfDay>}){
 const {t:translateUi,locale:uiLocale}=useI18n();
return <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{translateUi(period==='night'?<><path d="M45 43a21 21 0 0 1-25-28 21 21 0 1 0 25 28Z"/><path d="m43 13 1.5 4.5L49 19l-4.5 1.5L43 25l-1.5-4.5L37 19l4.5-1.5L43 13ZM53 30v5m-2.5-2.5h5"/></>:period==='day'?<><circle cx="32" cy="32" r="12"/><circle cx="32" cy="32" r="18" opacity=".15"/>{translateUi([0,45,90,135,180,225,270,315].map(r=><path key={r} d="M32 5v6" transform={`rotate(${r} 32 32)`}/>))}</>:<><path d="M6 44h52M12 51h40M19 57h26M17 43a15 15 0 0 1 30 0M32 13v6M12 25l4 4M52 25l-4 4M5 36l5 1m49-1-5 1"/>{translateUi(period==='morning'?<path d="M32 37V25m-4 4 4-4 4 4"/>:<path d="M32 25v12m-4-4 4 4 4-4"/>)}</>)}</svg>}
export function AdminGreeting(){
 const {t:translateUi,locale:uiLocale}=useI18n();
const {api,user}=useSession(),[clock,setClock]=useState<Date|null>(null),[quotes,setQuotes]=useState<Quote[]>([]),[offset,setOffset]=useState(0);
 useEffect(()=>{const update=()=>setClock(new Date());update();const timer=setInterval(update,60000);window.addEventListener('focus',update);return()=>{clearInterval(timer);window.removeEventListener('focus',update)}},[]);
 useEffect(()=>{let active=true;api<{data:Quote[]}>('/admin/greeting-quotes').then(r=>{if(active)setQuotes(r.data)}).catch(()=>{});return()=>{active=false}},[api]);
 const period=clock?timeOfDay(clock.getHours()):'day',day=clock?`${clock.getFullYear()}-${clock.getMonth()}-${clock.getDate()}`:'',q=quotes[dailyQuoteIndex(day,user.id,quotes.length,offset)];
 return <section className="admin-greeting" aria-label={translateUi("Administrator greeting")}><div className="greeting-person"><div className={'greeting-orbit '+period}><DayIcon period={period}/></div><div><p className="greeting-kicker">{translateUi("NATIO · YOUR DAILY PERSPECTIVE")}</p><h2>{translateUi(clock?greetingLabels[period]:translateUi("Welcome"))}<span>, {translateUi(user.name.split(' ')[0])}</span></h2><p className="greeting-date">{translateUi(clock?clock.toLocaleDateString(intlLocales[uiLocale],{weekday:'long',day:'numeric',month:'long'}):translateUi("Your workspace"))}{translateUi(clock&&<span> · {translateUi(Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_',' '))}</span>)}</p></div></div><div className="greeting-thought">{translateUi(q?<><blockquote key={q.id} lang="en" dir="ltr"><p>«{q.text}»</p><footer><cite>{q.author}</cite><a href={q.source} target="_blank" rel="noreferrer" title="Attribution in James Wood's compendium, 1893">{translateUi("Source ↗")}</a></footer></blockquote><div className="greeting-tools"><button onClick={()=>setOffset(n=>n+1)} title={translateUi("Other quote")} aria-label={translateUi("Other quote")}>↻</button><Link href="/admin/perspectives">{translateUi("Library · 10,000 →")}</Link></div></>:<p className="text-sm text-ink-500">{translateUi("Calm focus. Considered decisions.")}</p>)}</div></section>;
}

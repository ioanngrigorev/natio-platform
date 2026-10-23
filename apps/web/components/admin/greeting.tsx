'use client';
import {useI18n} from '@/lib/i18n/provider';

import {useEffect,useState} from 'react';
import {useSession} from '@/components/session-provider';
import {intlLocales} from '@/lib/i18n/core';
import {timeOfDay,greetingLabels} from '@/lib/greeting';
type Quote={id:string;text:string;author:string;source:string};
export function DayIcon({period}:{period:ReturnType<typeof timeOfDay>}){
 const {t:translateUi,locale:uiLocale}=useI18n();
return <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{translateUi(period==='night'?<><path d="M45 43a21 21 0 0 1-25-28 21 21 0 1 0 25 28Z"/><path d="m43 13 1.5 4.5L49 19l-4.5 1.5L43 25l-1.5-4.5L37 19l4.5-1.5L43 13ZM53 30v5m-2.5-2.5h5"/></>:period==='day'?<><circle cx="32" cy="32" r="12"/><circle cx="32" cy="32" r="18" opacity=".15"/>{translateUi([0,45,90,135,180,225,270,315].map(r=><path key={r} d="M32 5v6" transform={`rotate(${r} 32 32)`}/>))}</>:<><path d="M6 44h52M12 51h40M19 57h26M17 43a15 15 0 0 1 30 0M32 13v6M12 25l4 4M52 25l-4 4M5 36l5 1m49-1-5 1"/>{translateUi(period==='morning'?<path d="M32 37V25m-4 4 4-4 4 4"/>:<path d="M32 25v12m-4-4 4 4 4-4"/>)}</>)}</svg>}
type Perspective={quote:Quote;local_date:string;time_zone:string;location:{city:string;country:string}|null;source:'ip'|'device'};
export function AdminGreeting(){
 const {t,locale}=useI18n(),{api,user}=useSession();
 const [clock,setClock]=useState<Date|null>(null),[perspective,setPerspective]=useState<Perspective|null>(null);
 const [deviceZone,setDeviceZone]=useState('');
 useEffect(()=>{setDeviceZone(Intl.DateTimeFormat().resolvedOptions().timeZone);const tick=()=>setClock(new Date());tick();const timer=setInterval(tick,60000);window.addEventListener('focus',tick);return()=>{clearInterval(timer);window.removeEventListener('focus',tick)}},[]);
 const zone=perspective?.time_zone||deviceZone||'UTC';
 const day=clock?new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(clock):'';
 useEffect(()=>{
  if(!deviceZone)return;
  let active=true,last=0;
  const update=()=>{if(Date.now()-last<30000)return;last=Date.now();api<Perspective>('/admin/daily-perspective?'+new URLSearchParams({time_zone:deviceZone})).then(r=>{if(active)setPerspective(r)}).catch(()=>{})};
  update();const timer=setInterval(()=>{if(!document.hidden)update()},600000);window.addEventListener('focus',update);
  return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',update)};
 },[api,deviceZone,day]);
 const hour=clock?Number(new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).format(clock)):12;
 const period=timeOfDay(hour),q=perspective?.quote;
 const location=perspective?.location;
 return <section className="admin-greeting" aria-label={t("Administrator greeting")}>
  <div className="greeting-person"><div className={'greeting-orbit '+period}><DayIcon period={period}/></div><div>
   <p className="greeting-kicker">{t("NATIO · YOUR DAILY PERSPECTIVE")}</p>
   <h2>{t(clock?greetingLabels[period]:"Welcome")}<span>, {user.name.split(' ')[0]}</span></h2>
   <p className="greeting-date">{clock?clock.toLocaleDateString(intlLocales[locale],{timeZone:zone,weekday:'long',day:'numeric',month:'long'}):t("Your workspace")}
    {clock&&<span className="greeting-location" title={t(location?"Approximate location from your connection IP. VPNs may show another city.":"Using your device time zone.")}> · {location?[location.city,location.country].filter(Boolean).join(', '):zone.replaceAll('_',' ')} · <time>{clock.toLocaleTimeString(intlLocales[locale],{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'})}</time></span>}
   </p>
  </div></div>
  <div className="greeting-thought">{q?<blockquote key={q.id} lang="en" dir="ltr"><p>“{q.text}”</p><footer><cite><a href={q.source} target="_blank" rel="noreferrer" title={t("View quote source")}>{q.author}<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M5 11 11 5M5 5h6v6"/></svg></a></cite></footer></blockquote>:<p className="text-sm text-ink-500">{t("Calm focus. Considered decisions.")}</p>}</div>
 </section>;
}

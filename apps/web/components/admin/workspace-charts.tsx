"use client";
import {OutcomeTooltip} from "@/components/charts/outcome-tooltip";
import {valueAxisPadding,horizontalValuePadding} from '@/lib/chart-layout';
import {useI18n} from '@/lib/i18n/provider';

import { useEffect,useState } from 'react';
import Link from 'next/link';
import { ResponsiveContainer,AreaChart,Area,CartesianGrid,XAxis,YAxis,Tooltip,PieChart,Pie,Cell,BarChart,Bar,Legend } from 'recharts';
import { useSession,errorMessage } from '@/components/session-provider';
import { qs } from '@/lib/api';
import { formatMoney,formatNumber } from '@/lib/format';
import {TrafficCharts} from './traffic-charts';
import {PaymentVolumeChart} from './payment-volume-chart';
import type {VolumeGrain} from '@/lib/volume-series';
import type { BiReport } from '@/lib/bi-types';
export type BoardSpec={name:string;filters:Record<string,string|number>;widgets:string[]};
const colors=['var(--chart-1)','var(--chart-2)','var(--chart-3)','var(--chart-4)'];
const tip={background:'var(--surface)',border:'1px solid var(--chart-grid)',borderRadius:10,color:'inherit',fontSize:12};
export function ReportWidgets({spec,compact=false}:{spec:BoardSpec;compact?:boolean}){
 const {t:translateUi,locale:uiLocale}=useI18n();

 const {api,mode,kind}=useSession(),base=kind==='admin'?'/admin':'/dashboard',[report,setReport]=useState<BiReport|null>(null),[error,setError]=useState(''),[grain,setGrain]=useState<VolumeGrain>('day'),[motion,setMotion]=useState(false);
 useEffect(()=>{const q=window.matchMedia('(prefers-reduced-motion: reduce)');setMotion(!q.matches);const update=()=>setMotion(!q.matches);q.addEventListener('change',update);return()=>q.removeEventListener('change',update)},[]);
 const query=qs({...spec.filters,mode});
 useEffect(()=>{let active=true;setReport(null);setError('');api<BiReport>(base+'/bi'+query).then(r=>{if(active)setReport(r)}).catch(e=>{if(active)setError(errorMessage(e))});return()=>{active=false}},[api,query]);
 if(error)return <p role="alert" className="text-sm text-bad">{translateUi(error)}</p>;
 if(!report)return <p role="status" className="animate-pulse py-8 text-sm text-ink-500">{translateUi("Loading chart data…")}</p>;
 const r=report,div=10**new Intl.NumberFormat('en',{style:'currency',currency:r.currency}).resolvedOptions().maximumFractionDigits!;
 const daily=r.daily.map(d=>({...d,amount:Number(d.volume)/div}));
 return <div className="space-y-4">
  <div className="text-xs text-ink-500">{translateUi(mode==='test'?translateUi("Synthetic demo"):translateUi("Live data"))} · {translateUi(r.period.from)} — {translateUi(r.period.to)} · {translateUi(r.currency)}</div>
  <div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-ink-50 p-3"><span className="text-xs text-ink-500">{translateUi("Successful pay-in volume")}</span><div className={compact?'text-lg font-semibold':'text-2xl font-semibold'}>{translateUi(formatMoney(r.summary.volume,r.currency))}</div></div><div className="rounded-xl bg-ink-50 p-3"><span className="text-xs text-ink-500">{translateUi("Operations")}</span><div className={compact?'text-lg font-semibold':'text-2xl font-semibold'}>{translateUi(formatNumber(r.summary.transactions))}</div></div></div>
  {translateUi(!r.summary.transactions?<p className="py-10 text-center text-sm text-ink-500">{translateUi("No operations match these filters. Adjust dates or currency.")}</p>:<div className={compact?'space-y-4':'grid items-start gap-5 lg:grid-cols-[minmax(0,1.8fr)_minmax(280px,1fr)]'}>{translateUi(spec.widgets.map(w=>w==='volume'?<PaymentVolumeChart key={w} report={r} motion={motion} grain={grain} onGrain={setGrain}/>:<section key={w} aria-label={translateUi(w+translateUi(" chart"))} className="min-w-0 rounded-xl border border-ink-100 p-3"><h3 className="mb-2 text-sm font-medium capitalize">{translateUi(w==='outcomes'?translateUi("Transaction outcomes"):w)}</h3><ResponsiveContainer width="100%" height={compact?180:260}>
  {translateUi(w==='outcomes'?<PieChart><Pie data={r.statuses} dataKey="transactions" nameKey="label" innerRadius={compact?42:64} outerRadius={compact?65:90} paddingAngle={3}>{translateUi(r.statuses.map(s=><Cell key={s.label} fill={s.label==='successful'?'var(--status-success)':s.label==='failed'?'var(--status-failure)':'var(--status-pending)'}/>))}</Pie><Tooltip content={<OutcomeTooltip/>} offset={16}/><Legend formatter={translateUi} wrapperStyle={{fontSize:11}}/></PieChart>:w==='methods'||w==='countries'?<BarChart data={(w==='methods'?r.methods:r.countries).slice(0,8)} layout="vertical" margin={{top:6,right:12,left:0,bottom:0}}><CartesianGrid horizontal={false} stroke="var(--chart-grid)"/><XAxis type="number" padding={horizontalValuePadding} tick={{fontSize:10,fill:"var(--chart-axis)"}} tickFormatter={v=>Intl.NumberFormat("en",{notation:"compact"}).format(v)}/><YAxis type="category" dataKey="label" width={w==='methods'?118:45} interval={0} tick={{fontSize:9,fill:"var(--chart-axis)"}}/><Tooltip contentStyle={tip}/><Bar dataKey="transactions" name={translateUi("Transactions")} fill="var(--chart-1)" barSize={compact?10:16} radius={[0,4,4,0]}>{translateUi((w==='methods'?r.methods:r.countries).slice(0,8).map((_,i)=><Cell key={i} fill={colors[i%4]}/>))}</Bar></BarChart>:<AreaChart data={daily}><CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4"/><XAxis dataKey="day" minTickGap={45} tickFormatter={v=>String(v).slice(5)} tick={{fontSize:10,fill:"var(--chart-axis)"}}/><YAxis padding={valueAxisPadding} width={50} tick={{fontSize:10,fill:"var(--chart-axis)"}} tickFormatter={v=>Intl.NumberFormat('en',{notation:'compact'}).format(v)}/><Tooltip contentStyle={tip}/><Area type="monotone" dataKey='transactions' dot={daily.length===1?{r:4}:false} name={translateUi("Operations")} stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={.12} strokeWidth={2} animationDuration={450}/></AreaChart>)}
  </ResponsiveContainer></section>))}</div>)}
  {translateUi(spec.filters.traffic_type&&!compact?<TrafficCharts query={new URLSearchParams(Object.fromEntries(Object.entries(spec.filters).map(([k,v])=>[k,String(v)]))).toString()}/>:null)}
  <div className="flex flex-wrap gap-3 text-xs">{kind==='admin'?<Link className="text-brand-600" href={'/admin/bi'+query}>{translateUi("Open full report →")}</Link>:null}<a className="text-brand-600" href={'/api'+base+'/bi/export.xlsx'+qs({...spec.filters,mode,kind:'summary'})}>{translateUi("Excel summary ↓")}</a><a className="text-brand-600" href={'/api'+base+'/bi/export.xlsx'+qs({...spec.filters,mode,kind:'transactions'})}>{translateUi("Excel transactions ↓")}</a><a className="text-brand-600" href={'/api'+base+'/bi/export.csv'+qs({...spec.filters,mode,kind:'transactions'})}>{translateUi("CSV ↓")}</a></div>
 </div>;
}

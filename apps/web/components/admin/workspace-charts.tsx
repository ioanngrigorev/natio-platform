"use client";
import { useEffect,useState } from 'react';
import Link from 'next/link';
import { ResponsiveContainer,AreaChart,Area,CartesianGrid,XAxis,YAxis,Tooltip,PieChart,Pie,Cell,BarChart,Bar,Legend } from 'recharts';
import { useSession,errorMessage } from '@/components/session-provider';
import { qs } from '@/lib/api';
import { formatMoney,formatNumber } from '@/lib/format';
import type { BiReport } from '@/lib/bi-types';
export type BoardSpec={name:string;filters:Record<string,string|number>;widgets:string[]};
const colors=['var(--chart-1)','var(--chart-2)','var(--chart-3)','var(--chart-4)'];
const tip={background:'var(--surface)',border:'1px solid var(--chart-grid)',borderRadius:10,color:'inherit',fontSize:12};
export function ReportWidgets({spec,compact=false}:{spec:BoardSpec;compact?:boolean}){
 const {api,mode}=useSession(),[report,setReport]=useState<BiReport|null>(null),[error,setError]=useState('');
 const query=qs({...spec.filters,mode});
 useEffect(()=>{let active=true;setReport(null);setError('');api<BiReport>('/admin/bi'+query).then(r=>{if(active)setReport(r)}).catch(e=>{if(active)setError(errorMessage(e))});return()=>{active=false}},[api,query]);
 if(error)return <p role="alert" className="text-sm text-bad">{error}</p>;
 if(!report)return <p role="status" className="animate-pulse py-8 text-sm text-ink-500">Loading chart data…</p>;
 const r=report,div=10**new Intl.NumberFormat('en',{style:'currency',currency:r.currency}).resolvedOptions().maximumFractionDigits!;
 const daily=r.daily.map(d=>({...d,amount:Number(d.volume)/div}));
 return <div className="space-y-4">
  <div className="text-xs text-ink-500">{mode==='test'?'Synthetic demo':'Live data'} · {r.period.from} — {r.period.to} · {r.currency}</div>
  <div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-ink-50 p-3"><span className="text-xs text-ink-500">Successful pay-in volume</span><div className={compact?'text-lg font-semibold':'text-2xl font-semibold'}>{formatMoney(r.summary.volume,r.currency)}</div></div><div className="rounded-xl bg-ink-50 p-3"><span className="text-xs text-ink-500">Operations</span><div className={compact?'text-lg font-semibold':'text-2xl font-semibold'}>{formatNumber(r.summary.transactions)}</div></div></div>
  {!r.summary.transactions?<p className="py-10 text-center text-sm text-ink-500">No operations match these filters. Adjust dates or currency.</p>:<div className={compact?'space-y-4':'grid gap-5 lg:grid-cols-2'}>{spec.widgets.map(w=><section key={w} aria-label={w+' chart'} className="min-w-0 rounded-xl border border-ink-100 p-3"><h3 className="mb-2 text-sm font-medium capitalize">{w==='volume'?'Payment volume · '+r.currency:w==='outcomes'?'Transaction outcomes':w}</h3><ResponsiveContainer width="100%" height={compact?180:260}>
  {w==='outcomes'?<PieChart><Pie data={r.statuses} dataKey="transactions" nameKey="label" innerRadius={compact?42:64} outerRadius={compact?65:90} paddingAngle={3}>{r.statuses.map(s=><Cell key={s.label} fill={s.label==='successful'?'var(--status-success)':s.label==='failed'?'var(--status-failure)':'var(--status-pending)'}/>)}</Pie><Tooltip contentStyle={tip}/><Legend wrapperStyle={{fontSize:11}}/></PieChart>:w==='methods'||w==='countries'?<BarChart data={(w==='methods'?r.methods:r.countries).slice(0,8)}><CartesianGrid vertical={false} stroke="var(--chart-grid)"/><XAxis dataKey="label" tick={{fontSize:9}} interval={0} height={40}/><YAxis tick={{fontSize:10}} width={45}/><Tooltip contentStyle={tip}/><Bar dataKey="transactions" fill="var(--chart-1)" radius={[4,4,0,0]}>{(w==='methods'?r.methods:r.countries).slice(0,8).map((_,i)=><Cell key={i} fill={colors[i%4]}/>)}</Bar></BarChart>:<AreaChart data={daily}><CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4"/><XAxis dataKey="day" minTickGap={45} tickFormatter={v=>String(v).slice(5)} tick={{fontSize:10}}/><YAxis width={50} tick={{fontSize:10}} tickFormatter={v=>Intl.NumberFormat('en',{notation:'compact'}).format(v)}/><Tooltip contentStyle={tip}/><Area type="monotone" dataKey={w==='volume'?'amount':'transactions'} name={w==='volume'?r.currency:'Operations'} stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={.12} strokeWidth={2} animationDuration={450}/></AreaChart>}
  </ResponsiveContainer></section>)}</div>}
  <div className="flex flex-wrap gap-3 text-xs"><Link className="text-brand-600" href={'/admin/bi'+query}>Open full report →</Link><a className="text-brand-600" href={'/api/admin/bi/export.xlsx'+qs({...spec.filters,mode,kind:'summary'})}>Excel summary ↓</a><a className="text-brand-600" href={'/api/admin/bi/export.xlsx'+qs({...spec.filters,mode,kind:'transactions'})}>Excel transactions ↓</a><a className="text-brand-600" href={'/api/admin/bi/export.csv'+qs({...spec.filters,mode,kind:'transactions'})}>CSV ↓</a></div>
 </div>;
}

"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { Card } from "@/components/ui";
import { formatNumber, formatPercent } from "@/lib/format";
import { PaymentVolumeChart } from "./payment-volume-chart";
import { dailyVolume, groupVolume, type VolumeGrain } from "@/lib/volume-series";
import type { BiReport } from "@/lib/bi-types";

const colors=["var(--chart-1)","var(--chart-2)","var(--chart-3)","var(--chart-4)"];
const grid="var(--chart-grid)", axis={fontSize:11,fill:"var(--chart-axis)"};
const compact=(n:number)=>new Intl.NumberFormat("en",{notation:"compact",maximumFractionDigits:1}).format(n);
const tipStyle={backgroundColor:"var(--surface)",color:"inherit",borderRadius:12,border:"1px solid #e9e6ff",fontSize:12,boxShadow:"0 8px 30px #1d17f310"};

export function BiCharts({ report:r, overview=false }: {report:BiReport; overview?:boolean}) {
  const [motion,setMotion]=useState(false);
  const [replay,setReplay]=useState(0);
  useEffect(()=>{const media=window.matchMedia("(prefers-reduced-motion: reduce)"); const change=()=>setMotion(!media.matches); change(); media.addEventListener("change",change); return()=>media.removeEventListener("change",change);},[]);
  const animated={isAnimationActive:motion,animationDuration:1100,animationEasing:"ease-out" as const};
  const [grain,setGrain]=useState<VolumeGrain>("day");
  const points=groupVolume(dailyVolume(r),grain).map(p=>({...p,approval:p.successful+p.failed?100*p.successful/(p.successful+p.failed):0}));
  const tick=(v:string)=>new Date(v+"T00:00Z").toLocaleDateString("en-GB",grain==="month"?{month:"short",timeZone:"UTC"}:{day:"numeric",month:"short",timeZone:"UTC"});
  return <>
    {r.analytics_snapshot_at && <p className="mb-2 text-xs text-ink-500">Analytics as of {new Date(r.analytics_snapshot_at).toLocaleTimeString("en-GB", {timeZone:"UTC"})} UTC · reload to refresh. Snapshots may be cached for 15 seconds; exports use current data.</p>}
    <div className="mb-3 flex justify-end gap-2 text-xs text-ink-500"><button type="button" aria-pressed={motion} onClick={()=>setMotion(!motion)} className="rounded-lg border border-ink-200 px-3 py-2">Animation: {motion?"On":"Off"}</button><button type="button" disabled={!motion} onClick={()=>setReplay(v=>v+1)} className="rounded-lg border border-ink-200 px-3 py-2 disabled:opacity-40">Replay ↻</button></div>
    <div key={`${replay}-${r.period.from}-${r.period.to}-${r.currency}`} className={motion?"bi-motion":""}>
    <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <PaymentVolumeChart report={r} motion={motion} grain={grain} onGrain={setGrain}/>
      <Card title="Transaction outcomes" description="All operations within the selected filters">
        {r.statuses.length ? <><ResponsiveContainer width="100%" height={250}><PieChart><Pie data={r.statuses} dataKey="transactions" nameKey="label" innerRadius={70} outerRadius={100} paddingAngle={3} stroke="none" {...animated}>{r.statuses.map((s,i)=><Cell key={s.label} fill={colors[i%colors.length]}/>)}</Pie><Tooltip contentStyle={tipStyle} formatter={(v:number)=>formatNumber(v)}/><Legend iconType="circle" wrapperStyle={{fontSize:12}}/></PieChart></ResponsiveContainer>
        <div className="text-center"><strong className="text-2xl text-brand-600">{formatPercent(r.summary.successful+r.summary.failed?r.summary.successful/(r.summary.successful+r.summary.failed):null)}</strong><span className="ml-2 text-xs text-ink-500">success among decided operations</span></div></> : <div className="py-16 text-center text-sm text-ink-500"><p>No operations in this period.</p><Link className="mt-2 inline-block text-brand-600" href="/admin/bi">Reset report filters →</Link></div>}
      </Card>
    </div>
    {!overview&&points.length>0&&<>
      <Card title="Processing activity" description="Transaction count and success rate over time" className="mt-5">
        <ResponsiveContainer width="100%" height={300}><ComposedChart data={points} margin={{top:18,right:0,left:0,bottom:0}}><CartesianGrid stroke={grid} vertical={false}/><XAxis dataKey="date" tickFormatter={tick} tick={axis} tickLine={false} axisLine={false} minTickGap={28}/><YAxis yAxisId="count" tickFormatter={compact} tick={axis} tickLine={false} axisLine={false}/><YAxis yAxisId="rate" orientation="right" domain={[0,100]} tickFormatter={v=>v+"%"} tick={axis} tickLine={false} axisLine={false}/><Tooltip contentStyle={tipStyle} labelFormatter={v=>tick(String(v))} formatter={(v:number,n:string)=>[n==="Success rate"?v.toFixed(1)+"%":formatNumber(v),n]}/><Bar yAxisId="count" dataKey="transactions" name="Transactions" fill="var(--chart-3)" radius={[4,4,0,0]} {...animated}/><Line yAxisId="rate" dataKey="approval" name="Success rate" type="monotone" stroke={colors[0]} strokeWidth={2.5} dot={false} {...animated}/><Legend wrapperStyle={{fontSize:12}}/></ComposedChart></ResponsiveContainer>
      </Card>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">{[{title:"Payment methods",rows:r.methods},{title:"Geographic distribution",rows:r.countries.map(c=>({...c,label:(()=>{try{return new Intl.DisplayNames(["en"],{type:"region"}).of(c.label)||c.label;}catch{return c.label;}})()}))}].map(g=><Card key={g.title} title={g.title} description="Top 8 by transaction count"><ResponsiveContainer width="100%" height={320}><BarChart data={g.rows.slice(0,8)} layout="vertical" margin={{top:8,right:18,left:0,bottom:0}}><CartesianGrid stroke={grid} horizontal={false}/><XAxis type="number" tick={axis} tickFormatter={compact} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="label" width={130} tick={axis} tickLine={false} axisLine={false}/><Tooltip contentStyle={tipStyle} formatter={(v:number)=>[formatNumber(v),"Transactions"]}/><Bar dataKey="transactions" radius={[0,5,5,0]} barSize={18} {...animated}>{g.rows.slice(0,8).map((row,i)=><Cell key={row.label} fill={i===0?colors[0]:colors[1]}/>)}</Bar></BarChart></ResponsiveContainer></Card>)}</div>
    </>}
    </div>
  </>;
}

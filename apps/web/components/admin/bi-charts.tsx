"use client";

import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { Card } from "@/components/ui";
import { currencyExponent, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import type { BiReport } from "@/lib/bi-types";

const colors=["#1d17f3","#8a87f9","#c6c3fd","#e7e5ff"];
const grid="var(--chart-grid)", axis={fontSize:11,fill:"var(--chart-axis)"};
const compact=(n:number)=>new Intl.NumberFormat("en",{notation:"compact",maximumFractionDigits:1}).format(n);
const tipStyle={backgroundColor:"var(--surface)",color:"inherit",borderRadius:12,border:"1px solid #e9e6ff",fontSize:12,boxShadow:"0 8px 30px #1d17f310"};

export function BiCharts({ report:r, overview=false }: {report:BiReport; overview?:boolean}) {
  const [grain,setGrain]=useState<"day"|"month">("month");
  const grouped=new Map<string,{date:string;volume:number;transactions:number;successful:number;failed:number}>();
  r.daily.forEach(p=>{const key=grain==="day"?p.day:p.day.slice(0,7);const a=grouped.get(key)??{date:key,volume:0,transactions:0,successful:0,failed:0};a.volume+=p.volume;a.transactions+=p.transactions;a.successful+=p.successful;a.failed+=p.failed;grouped.set(key,a);});
  const points=[...grouped.values()].map(p=>({...p,approval:p.successful+p.failed?100*p.successful/(p.successful+p.failed):0}));
  const tick=(v:string)=>new Date(v.length===7?v+"-01T00:00Z":v+"T00:00Z").toLocaleDateString("en-GB",grain==="month"?{month:"short",timeZone:"UTC"}:{day:"numeric",month:"short",timeZone:"UTC"});
  const toggle=<div className="flex gap-1">{(["month","day"] as const).map(v=><button key={v} onClick={()=>setGrain(v)} className={`rounded-md px-3 py-1 text-xs ${grain===v?"bg-brand-600 text-white":"bg-ink-50 text-ink-500"}`}>{v==="month"?"Monthly":"Daily"}</button>)}</div>;
  return <>
    <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
      <Card title={`Payment volume · ${r.currency}`} description={`${r.period.from} — ${r.period.to} · successful pay-ins`} actions={toggle}>
        {points.length?<ResponsiveContainer width="100%" height={300}><AreaChart data={points} margin={{top:20,right:10,left:0,bottom:0}}>
          <defs><linearGradient id={overview?"volumeOverview":"volumeBi"} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={colors[0]} stopOpacity={0.25}/><stop offset="100%" stopColor={colors[0]} stopOpacity={0}/></linearGradient></defs>
          <CartesianGrid stroke={grid} vertical={false}/><XAxis dataKey="date" tickFormatter={tick} tick={axis} tickLine={false} axisLine={false} minTickGap={28}/><YAxis tickFormatter={v=>compact(v/10**currencyExponent(r.currency))} tick={axis} tickLine={false} axisLine={false} width={60}/>
          <Tooltip contentStyle={tipStyle} labelFormatter={v=>tick(String(v))} formatter={(v:number)=>[formatMoney(v,r.currency),"Pay-in volume"]}/>
          <Area type="monotone" dataKey="volume" stroke={colors[0]} strokeWidth={3} fill={`url(#${overview?"volumeOverview":"volumeBi"})`} isAnimationActive={false}/>
        </AreaChart></ResponsiveContainer>:<p className="py-24 text-center text-ink-500">No transactions for these filters.</p>}
      </Card>
      <Card title="Transaction outcomes" description="All operations within the selected filters">
        <ResponsiveContainer width="100%" height={250}><PieChart><Pie data={r.statuses} dataKey="transactions" nameKey="label" innerRadius={70} outerRadius={100} paddingAngle={3} stroke="none" isAnimationActive={false}>{r.statuses.map((s,i)=><Cell key={s.label} fill={colors[i%colors.length]}/>)}</Pie><Tooltip contentStyle={tipStyle} formatter={(v:number)=>formatNumber(v)}/><Legend iconType="circle" wrapperStyle={{fontSize:12}}/></PieChart></ResponsiveContainer>
        <div className="text-center"><strong className="text-2xl text-brand-600">{formatPercent(r.summary.successful+r.summary.failed?r.summary.successful/(r.summary.successful+r.summary.failed):null)}</strong><span className="ml-2 text-xs text-ink-500">success among decided operations</span></div>
      </Card>
    </div>
    {!overview&&<>
      <Card title="Processing activity" description="Transaction count and success rate over time" className="mt-5">
        <ResponsiveContainer width="100%" height={300}><ComposedChart data={points} margin={{top:18,right:0,left:0,bottom:0}}><CartesianGrid stroke={grid} vertical={false}/><XAxis dataKey="date" tickFormatter={tick} tick={axis} tickLine={false} axisLine={false} minTickGap={28}/><YAxis yAxisId="count" tickFormatter={compact} tick={axis} tickLine={false} axisLine={false}/><YAxis yAxisId="rate" orientation="right" domain={[0,100]} tickFormatter={v=>v+"%"} tick={axis} tickLine={false} axisLine={false}/><Tooltip contentStyle={tipStyle} labelFormatter={v=>tick(String(v))} formatter={(v:number,n:string)=>[n==="Success rate"?v.toFixed(1)+"%":formatNumber(v),n]}/><Bar yAxisId="count" dataKey="transactions" name="Transactions" fill="#c6c3fd" radius={[4,4,0,0]} isAnimationActive={false}/><Line yAxisId="rate" dataKey="approval" name="Success rate" type="monotone" stroke={colors[0]} strokeWidth={2.5} dot={false} isAnimationActive={false}/><Legend wrapperStyle={{fontSize:12}}/></ComposedChart></ResponsiveContainer>
      </Card>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">{[{title:"Payment methods",rows:r.methods},{title:"Geographic distribution",rows:r.countries.map(c=>({...c,label:(()=>{try{return new Intl.DisplayNames(["en"],{type:"region"}).of(c.label)||c.label;}catch{return c.label;}})()}))}].map(g=><Card key={g.title} title={g.title} description="Top 8 by transaction count"><ResponsiveContainer width="100%" height={320}><BarChart data={g.rows.slice(0,8)} layout="vertical" margin={{top:8,right:18,left:0,bottom:0}}><CartesianGrid stroke={grid} horizontal={false}/><XAxis type="number" tick={axis} tickFormatter={compact} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="label" width={130} tick={axis} tickLine={false} axisLine={false}/><Tooltip contentStyle={tipStyle} formatter={(v:number)=>[formatNumber(v),"Transactions"]}/><Bar dataKey="transactions" radius={[0,5,5,0]} barSize={18} isAnimationActive={false}>{g.rows.slice(0,8).map((row,i)=><Cell key={row.label} fill={i===0?colors[0]:colors[1]}/>)}</Bar></BarChart></ResponsiveContainer></Card>)}</div>
    </>}
  </>;
}

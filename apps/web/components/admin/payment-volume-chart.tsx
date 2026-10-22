"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { Area, AreaChart, Brush, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui";
import { currencyExponent, formatMoney } from "@/lib/format";
import { dailyVolume, groupVolume, volumeWindow, type VolumeGrain, type VolumePoint } from "@/lib/volume-series";
import type { BiReport } from "@/lib/bi-types";

const dateLabel = (value: string, monthOnly = false) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
  timeZone: "UTC", month: "short", ...(monthOnly ? {} : { day: "numeric" }),
});
const fullDate = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const compact = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const axis = { fontSize: 11, fill: "var(--chart-axis)" };
const button = (selected: boolean) => `rounded-md px-3 py-1.5 text-xs transition-colors ${selected ? "bg-brand-600 text-white" : "text-ink-500 hover:bg-ink-100"}`;

function VolumeTooltip({ active, payload, currency, smooth }: { active?: boolean; payload?: Array<{ payload?: VolumePoint }>; currency: string; smooth: boolean }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return <div className="volume-tooltip">
    <p className="mb-3 text-xs text-ink-500">{fullDate(point.date)}{point.endDate !== point.date ? ` — ${fullDate(point.endDate)}` : ""}</p>
    <div className="flex justify-between gap-6 text-xs"><span>Actual volume</span><strong>{formatMoney(point.volume, currency)}</strong></div>
    {smooth && <div className="mt-2 flex justify-between gap-6 text-xs text-brand-600"><span>{point.trendDays}-day average</span><strong>{formatMoney(point.trend, currency)}</strong></div>}
  </div>;
}

export function PaymentVolumeChart({ report, motion, grain, onGrain }: { report: BiReport; motion: boolean; grain: VolumeGrain; onGrain: (grain: VolumeGrain) => void }) {
  const days = useMemo(() => dailyVolume(report), [report]);
  const [selection, setSelection] = useState(() => volumeWindow(days));
  const [smoothing, setSmoothing] = useState(true);
  const [preset, setPreset] = useState<string>("All");
  const gradientId = `volume-${useId().replace(/:/g, "")}`;
  useEffect(() => { setSelection(volumeWindow(days)); setPreset("All"); }, [days]);
  const start = Math.min(selection.startIndex, Math.max(0, days.length - 1));
  const end = Math.max(start, Math.min(selection.endIndex, days.length - 1));
  // Calculate the trend before zooming: moving the navigator must not change historical averages.
  const visible = days.slice(start, end + 1);
  const points = useMemo(() => groupVolume(days.slice(start, end + 1), grain), [days, start, end, grain]);
  const smooth = grain === "day" && smoothing;
  const total = visible.reduce((sum, point) => sum + point.volume, 0);
  const first = visible[0], last = visible[visible.length - 1];
  const months = [...new Set(days.map(point => point.date.slice(0, 7)))];
  const ticks = grain === "day" && visible.length > 90
    ? points.filter((point, index) => index === 0 || point.date.slice(8) === "01").map(point => point.date)
    : undefined;
  const animate = { isAnimationActive: motion, animationDuration: 650, animationEasing: "ease-out" as const };
  return <Card title={`Payment volume · ${report.currency}`} description="Successful pay-ins · explore the timeline" className="payment-volume-card min-w-0">
    {days.length ? <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-widest text-ink-500">Volume in view</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-ink-900" data-volume-total>{formatMoney(total, report.currency)}</p>
          <p className="mt-1 text-xs text-ink-500" aria-live="polite">{fullDate(first.date)} — {fullDate(last.endDate)}</p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg bg-ink-50 p-1" aria-label="Chart interval">
          {(["day", "week", "month"] as const).map(value => <button type="button" key={value} className={button(grain === value)} aria-pressed={grain === value} onClick={() => onGrain(value)}>{({ day: "Daily", week: "Weekly", month: "Monthly" })[value]}</button>)}
        </div>
      </div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
        <span className="inline-flex items-center gap-2"><span className="h-0.5 w-5 rounded-full" style={{ background: "var(--chart-1)" }}/>{smooth ? "7-day moving average" : `${grain === "day" ? "Daily" : grain === "week" ? "Weekly" : "Monthly"} totals`}</span>
        {grain === "day" && <button type="button" aria-pressed={smoothing} onClick={() => setSmoothing(value => !value)} className="rounded-md border border-ink-200 px-2.5 py-1.5">Smoothing: {smoothing ? "7 days" : "Off"}</button>}
      </div>
      <div role="img" aria-label={`${smooth ? "7-day average" : grain + " totals"} of successful payments. Exact values are available in chart tooltips and Excel reports.`}>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={points} margin={{ top: 18, right: 12, left: 0, bottom: 0 }} accessibilityLayer>
            <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.18}/><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.015}/></linearGradient></defs>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} strokeDasharray="3 5"/>
            <XAxis dataKey="date" ticks={ticks} tickFormatter={value => dateLabel(value, grain === "month" || (grain === "day" && visible.length > 90))} tick={axis} axisLine={false} tickLine={false} minTickGap={32} tickMargin={12} height={38}/>
            <YAxis tickFormatter={value => compact(value / 10 ** currencyExponent(report.currency))} tick={axis} axisLine={false} tickLine={false} width={52} tickCount={5} domain={[0, "auto"]}/>
            <Tooltip content={<VolumeTooltip currency={report.currency} smooth={smooth}/>} cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1, strokeDasharray: "3 4" }} />
            <Area key={`${grain}-${smooth}`} type="monotoneX" dataKey={smooth ? "trend" : "volume"} stroke="var(--chart-1)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill={`url(#${gradientId})`} dot={points.length === 1 ? { r: 4 } : false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 3 }} {...animate}/>
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 border-t border-ink-100 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-medium uppercase tracking-widest text-ink-500">Timeline navigator</span>
          <div className="flex gap-1" aria-label="Chart range">{[["30D", 30], ["90D", 90], ["180D", 180], ["All", undefined]].map(([label, count]) => <button type="button" key={label} aria-pressed={preset === label} className={button(preset === label)} onClick={() => { setSelection(volumeWindow(days, count as number | undefined)); setPreset(String(label)); }}>{label}</button>)}</div>
        </div>
        {days.length > 1 && <div aria-label="Drag the timeline handles to zoom" className="volume-navigator">
          <ResponsiveContainer width="100%" height={78}>
            <AreaChart data={days} margin={{ top: 6, right: 8, left: 8, bottom: 20 }}>
              <Brush ariaLabel={`Timeline from ${fullDate(first.date)} to ${fullDate(last.endDate)}. Use left and right arrow keys to adjust.`} dataKey="date" height={42} stroke="var(--chart-1)" fill="var(--surface)" travellerWidth={9} startIndex={start} endIndex={end} tickFormatter={value => dateLabel(value)} onChange={range => {
                if (range.startIndex != null && range.endIndex != null) { setSelection({ startIndex: range.startIndex, endIndex: range.endIndex }); setPreset("Custom"); }
              }}>
                <AreaChart><Area dataKey="trend" type="monotoneX" stroke="var(--chart-3)" strokeWidth={1} fill="var(--chart-3)" fillOpacity={0.14} isAnimationActive={false}/></AreaChart>
              </Brush>
            </AreaChart>
          </ResponsiveContainer>
          <div className="volume-month-scale flex justify-between px-2 text-[10px] text-ink-500" aria-hidden="true">{months.filter((_, index) => months.length <= 12 || index % Math.ceil(months.length / 12) === 0).map(month => <span key={month}>{dateLabel(`${month}-01`, true)}</span>)}</div>
          <p className="mt-2 text-[11px] text-ink-500">Drag handles or use arrow keys to zoom. Range affects this chart only.</p>
        </div>}
      </div>
      {smooth && <p className="mt-3 text-[11px] leading-relaxed text-ink-500">Line: trailing 7-day average; the first days use available history. Hover for exact daily amounts. Totals and exports use original values.</p>}
      {grain !== "day" && <p className="mt-3 text-[11px] leading-relaxed text-ink-500">Edge periods may be partial. Hover to see the exact dates included in each total.</p>}
    </> : <div className="py-20 text-center text-sm text-ink-500"><p>No transactions match this period and these filters.</p><p className="mt-2 text-xs">{report.period.from} — {report.period.to} · {report.currency}</p><Link className="mt-4 inline-block text-brand-600" href="/admin/bi">Reset report filters →</Link></div>}
  </Card>;
}

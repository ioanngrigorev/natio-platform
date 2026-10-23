"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { Area, AreaChart, Brush, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui";
import { currencyExponent, formatMoney } from "@/lib/format";
import { adjustVolumeWindow, dailyVolume, groupVolume, volumeDomain, volumeWindow, type VolumeGrain, type VolumePoint } from "@/lib/volume-series";
import type { BiReport } from "@/lib/bi-types";

const dateLabel = (value: string, monthOnly = false) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
  timeZone: "UTC", month: "short", ...(monthOnly ? {} : { day: "numeric" }),
});
const fullDate = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const compact = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(value);
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
  const [selection, setSelection] = useState(() => volumeWindow(days, 90));
  const [smoothing, setSmoothing] = useState(false);
  const [fromZero, setFromZero] = useState(false);
  const [preset, setPreset] = useState<string>(days.length > 90 ? "90D" : "All");
  const gradientId = `volume-${useId().replace(/:/g, "")}`;
  useEffect(() => { setSelection(volumeWindow(days, 90)); setPreset(days.length > 90 ? "90D" : "All"); }, [days]);
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
  const domain = volumeDomain(points.flatMap(point => smooth ? [point.volume, point.trend] : [point.volume]), fromZero);
  const high = points.length ? Math.max(...points.map(point => point.volume)) : 0;
  const low = points.length ? Math.min(...points.map(point => point.volume)) : 0;
  const adjust = (factor: number, direction = 0) => { setSelection(adjustVolumeWindow(days.length, { startIndex: start, endIndex: end }, factor, direction)); setPreset("Custom"); };
  const animate = { isAnimationActive: motion, animationDuration: 650, animationEasing: "ease-out" as const };
  return <Card title={`Payment volume · ${report.currency}`} description="Successful pay-ins · actual amounts · UTC" className="payment-volume-card min-w-0">
    {days.length ? <>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-widest text-ink-500">Volume in view</p>
          <p className="mt-1 text-xl font-semibold tracking-tight text-ink-900" data-volume-total>{formatMoney(total, report.currency)}</p>
          <p className="mt-1 text-xs text-ink-500" aria-live="polite">{fullDate(first.date)} — {fullDate(last.endDate)}</p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg bg-ink-50 p-1" aria-label="Chart interval">
          {(["day", "week", "month"] as const).map(value => <button type="button" key={value} className={button(grain === value)} aria-pressed={grain === value} onClick={() => onGrain(value)}>{({ day: "Daily", week: "Weekly", month: "Monthly" })[value]}</button>)}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-ink-500">
        <span>High <strong className="ml-1 font-medium text-ink-900">{formatMoney(high, report.currency)}</strong></span>
        <span>Low <strong className="ml-1 font-medium text-ink-900">{formatMoney(low, report.currency)}</strong></span>
        <span>Per {grain} · visible range</span>
      </div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-y border-ink-100 py-2 text-xs text-ink-500">
        <span className="inline-flex items-center gap-2"><span className="h-0.5 w-5 rounded-full" style={{ background: "var(--chart-1)" }}/>Actual totals</span>
        <div className="flex flex-wrap items-center gap-1">
          {grain === "day" && <button type="button" aria-pressed={smoothing} title="Overlay a trailing 7-day average. Actual values stay visible." onClick={() => setSmoothing(value => !value)} className={button(smoothing)}>MA 7: {smoothing ? "On" : "Off"}</button>}
          <div className="flex gap-1 border-l border-ink-200 pl-1" aria-label="Value scale">
            <button type="button" aria-pressed={!fromZero} className={button(!fromZero)} onClick={() => setFromZero(false)}>Auto</button>
            <button type="button" aria-pressed={fromZero} className={button(fromZero)} onClick={() => setFromZero(true)}>From zero</button>
          </div>
        </div>
      </div>
      <div role="img" aria-label={`Actual ${grain} totals of successful payments${smooth ? " with a 7-day average overlay" : ""}. ${fromZero ? "Zero-based" : "Auto-fitted"} value scale. Exact values are available in tooltips and Excel reports.`}>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={points} margin={{ top: 16, right: 0, left: 4, bottom: 0 }} accessibilityLayer>
            <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.18}/><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.015}/></linearGradient></defs>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} strokeDasharray="3 5"/>
            <XAxis dataKey="date" ticks={ticks} tickFormatter={value => dateLabel(value, grain === "month" || (grain === "day" && visible.length > 90))} tick={axis} axisLine={false} tickLine={false} minTickGap={32} tickMargin={12} height={38}/>
            <YAxis orientation="right" tickFormatter={value => compact(value / 10 ** currencyExponent(report.currency))} tick={axis} axisLine={false} tickLine={false} width={58} tickCount={6} domain={domain} allowDataOverflow/>
            <Tooltip content={<VolumeTooltip currency={report.currency} smooth={smooth}/>} cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1, strokeDasharray: "3 4" }} />
            <Area key={grain} type="monotoneX" dataKey="volume" stroke="var(--chart-1)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill={`url(#${gradientId})`} dot={points.length === 1 ? { r: 4 } : false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 3 }} {...animate}/>
            {smooth && <Line type="monotoneX" dataKey="trend" name="7-day average" stroke="var(--chart-axis)" strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} {...animate}/>}
            {points.length > 0 && <ReferenceLine y={points[points.length - 1].volume} stroke="var(--chart-1)" strokeOpacity={0.35} strokeDasharray="2 4"/>}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[10px] text-ink-500">{fromZero ? "Zero-based scale" : "Auto scale fits visible values; the baseline may be above zero"} · {smooth ? "Solid: actual totals · Dashed: 7-day average" : "Line follows actual values; no averaging"}</p>
      <div className="mt-3 border-t border-ink-100 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-ink-500" aria-label="Zoom and pan">
            <button type="button" className="volume-tool" aria-label="Pan to earlier dates" disabled={start === 0} onClick={() => adjust(1, -1)}>←</button>
            <button type="button" className="volume-tool" aria-label="Zoom in" disabled={visible.length <= 3} onClick={() => adjust(0.5)}>+</button>
            <button type="button" className="volume-tool" aria-label="Zoom out" disabled={visible.length === days.length} onClick={() => adjust(2)}>−</button>
            <button type="button" className="volume-tool" aria-label="Pan to later dates" disabled={end === days.length - 1} onClick={() => adjust(1, 1)}>→</button>
          </div>
          <div className="flex gap-1" aria-label="Chart range">{[["7D", 7], ["30D", 30], ["90D", 90], ["180D", 180], ["All", undefined]].map(([label, count]) => <button type="button" key={label} aria-pressed={preset === label} className={button(preset === label)} onClick={() => { setSelection(volumeWindow(days, count as number | undefined)); setPreset(String(label)); }}>{label}</button>)}</div>
        </div>
        {days.length > 1 && <div aria-label="Drag the timeline handles to zoom" className="volume-navigator">
          <ResponsiveContainer width="100%" height={78}>
            <AreaChart data={days} margin={{ top: 6, right: 8, left: 8, bottom: 20 }}>
              <Brush ariaLabel={`Timeline from ${fullDate(first.date)} to ${fullDate(last.endDate)}. Use left and right arrow keys to adjust.`} dataKey="date" height={42} stroke="var(--chart-1)" fill="var(--surface)" travellerWidth={9} startIndex={start} endIndex={end} tickFormatter={value => dateLabel(value)} onChange={range => {
                if (range.startIndex != null && range.endIndex != null) { setSelection({ startIndex: range.startIndex, endIndex: range.endIndex }); setPreset("Custom"); }
              }}>
                <AreaChart><Area dataKey="volume" type="monotoneX" stroke="var(--chart-3)" strokeWidth={1} fill="var(--chart-3)" fillOpacity={0.14} isAnimationActive={false}/></AreaChart>
              </Brush>
            </AreaChart>
          </ResponsiveContainer>
          <div className="volume-month-scale flex justify-between px-2 text-[10px] text-ink-500" aria-hidden="true">{months.filter((_, index) => months.length <= 12 || index % Math.ceil(months.length / 12) === 0).map(month => <span key={month}>{dateLabel(`${month}-01`, true)}</span>)}</div>
          <p className="mt-2 text-[11px] text-ink-500">Drag handles or use arrow keys to zoom. Range affects this chart only.</p>
        </div>}
      </div>
      {smooth && <p className="mt-3 text-[11px] leading-relaxed text-ink-500">MA 7 is a trailing average; the first days use available history. The solid line, totals and exports always use actual amounts.</p>}
      {grain !== "day" && <p className="mt-3 text-[11px] leading-relaxed text-ink-500">Edge periods may be partial. Hover to see the exact dates included in each total.</p>}
    </> : <div className="py-20 text-center text-sm text-ink-500"><p>No transactions match this period and these filters.</p><p className="mt-2 text-xs">{report.period.from} — {report.period.to} · {report.currency}</p><Link className="mt-4 inline-block text-brand-600" href="/admin/bi">Reset report filters →</Link></div>}
  </Card>;
}

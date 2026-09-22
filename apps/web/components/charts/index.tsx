"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import type { BreakdownRow, TimeseriesPoint } from "@/lib/types";

export const CATEGORICAL = ["#2b4ba8", "#0e8c7a", "#c2620f", "#8a4bdb"];
const OTHER = "#7c8798";
const GRID = "#e8ebf0";
const AXIS = "#7c8798";

function tickDate(t: string, bucket: "hour" | "day") {
  const d = new Date(t);
  if (bucket === "hour") return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}

function TooltipBox({ rows, title }: { rows: Array<{ label: string; value: string }>; title: string }) {
  return (
    <div className="rounded-md border border-ink-200 bg-white px-3 py-2 text-[12px] shadow-lg">
      <div className="mb-1 font-medium text-ink-800">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between gap-4 text-ink-600">
          <span>{r.label}</span>
          <span className="tabular text-ink-900">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function VolumeChart({ points, currency, bucket = "day", height = 220 }: { points: TimeseriesPoint[]; currency: string | null; bucket?: "hour" | "day"; height?: number }) {
  if (!points.length) return <div className="flex h-[220px] items-center justify-center text-[13px] text-ink-400">No payments in this period</div>;
  const exp = currency ? (["JPY", "KRW", "VND"].includes(currency) ? 0 : 2) : 2;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="tpvFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CATEGORICAL[0]} stopOpacity={0.18} />
            <stop offset="100%" stopColor={CATEGORICAL[0]} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="t" tickFormatter={(t) => tickDate(t, bucket)} tick={{ fontSize: 11, fill: AXIS }} axisLine={{ stroke: GRID }} tickLine={false} minTickGap={24} />
        <YAxis tickFormatter={(v) => (currency ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v / 10 ** exp) : String(v))} tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} width={48} />
        <Tooltip
          cursor={{ stroke: AXIS, strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]!.payload as TimeseriesPoint;
            return <TooltipBox title={tickDate(p.t, bucket)} rows={[{ label: "Volume", value: formatMoney(p.tpv, currency ?? "") }, { label: "Transactions", value: formatNumber(p.transactions) }, { label: "Success rate", value: formatPercent(p.success_rate) }]} />;
          }}
        />
        <Area type="monotone" dataKey="tpv" stroke={CATEGORICAL[0]} strokeWidth={2} fill="url(#tpvFill)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SuccessRateChart({ points, bucket = "day", height = 200 }: { points: TimeseriesPoint[]; bucket?: "hour" | "day"; height?: number }) {
  const data = points.filter((p) => p.success_rate !== null);
  if (!data.length) return <div className="flex h-[200px] items-center justify-center text-[13px] text-ink-400">No decided payments in this period</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="t" tickFormatter={(t) => tickDate(t, bucket)} tick={{ fontSize: 11, fill: AXIS }} axisLine={{ stroke: GRID }} tickLine={false} minTickGap={24} />
        <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} width={40} />
        <Tooltip
          cursor={{ stroke: AXIS, strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]!.payload as TimeseriesPoint;
            return <TooltipBox title={tickDate(p.t, bucket)} rows={[{ label: "Success rate", value: formatPercent(p.success_rate) }, { label: "Successful", value: formatNumber(p.successful) }, { label: "Failed", value: formatNumber(p.failed) }]} />;
          }}
        />
        <Line type="monotone" dataKey="success_rate" stroke={CATEGORICAL[1]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bar breakdown; top 4 keep fixed categorical hues, the rest are neutral. */
export function BreakdownChart({ rows, metric = "transactions", currency, height }: { rows: BreakdownRow[]; metric?: "transactions" | "tpv"; currency?: string | null; height?: number }) {
  if (!rows.length) return <div className="flex h-[160px] items-center justify-center text-[13px] text-ink-400">No data</div>;
  const data = rows.slice(0, 8).map((r, i) => ({ ...r, fill: i < 4 ? CATEGORICAL[i] : OTHER }));
  const h = height ?? Math.max(120, data.length * 28 + 16);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 4 }} barCategoryGap={6}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="key" width={96} tick={{ fontSize: 11, fill: "#3f4a5f" }} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={{ fill: "#f4f6f9" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]!.payload as BreakdownRow;
            return <TooltipBox title={p.key} rows={[{ label: "Transactions", value: formatNumber(p.transactions) }, { label: "Volume", value: currency ? formatMoney(p.tpv, currency) : "—" }, { label: "Success rate", value: formatPercent(p.success_rate) }]} />;
          }}
        />
        <Bar dataKey={metric} radius={[0, 4, 4, 0]} maxBarSize={18}>
          {data.map((d) => (
            <Cell key={d.key} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Sparkbar({ values, color = CATEGORICAL[0] }: { values: number[]; color?: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-6 items-end gap-[2px]">
      {values.map((v, i) => (
        <div key={i} className="w-[4px] rounded-t-[2px]" style={{ height: `${Math.max(8, (v / max) * 100)}%`, background: color, opacity: v ? 1 : 0.25 }} />
      ))}
    </div>
  );
}

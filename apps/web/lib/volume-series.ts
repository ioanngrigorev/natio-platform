import type { BiReport } from "./bi-types";

export type VolumeGrain = "day" | "week" | "month";
export type VolumePoint = {
  date: string;
  endDate: string;
  volume: number;
  transactions: number;
  successful: number;
  failed: number;
  trend: number;
  trendDays: number;
};
const DAY = 86_400_000;
const time = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (value: number) => new Date(value).toISOString().slice(0, 10);

/** Missing rows in this aggregate API mean no operations, not missing observations. */
export function dailyVolume(report: Pick<BiReport, "daily" | "period">): VolumePoint[] {
  if (!report.daily.length) return [];
  const rows = new Map(report.daily.map(row => [row.day, row]));
  const points: VolumePoint[] = [];
  let rolling = 0;
  for (let cursor = time(report.period.from); cursor <= time(report.period.to); cursor += DAY) {
    const date = iso(cursor), row = rows.get(date);
    const volume = Number(row?.volume ?? 0);
    rolling += volume;
    if (points.length >= 7) rolling -= points[points.length - 7].volume;
    const trendDays = Math.min(points.length + 1, 7);
    points.push({ date, endDate: date, volume, trend: rolling / trendDays, trendDays,
      transactions: Number(row?.transactions ?? 0), successful: Number(row?.successful ?? 0), failed: Number(row?.failed ?? 0) });
  }
  return points;
}

/** Weekly buckets start on Monday in UTC; edge buckets contain only selected days. */
export function groupVolume(days: VolumePoint[], grain: VolumeGrain): VolumePoint[] {
  if (grain === "day") return days;
  const groups = new Map<string, VolumePoint>();
  for (const day of days) {
    const weekday = new Date(time(day.date)).getUTCDay();
    const key = grain === "month" ? day.date.slice(0, 7) : iso(time(day.date) - ((weekday + 6) % 7) * DAY);
    const point = groups.get(key);
    if (!point) groups.set(key, { ...day, trend: day.volume, trendDays: 1 });
    else {
      point.endDate = day.date;
      point.volume += day.volume;
      point.trend = point.volume;
      point.trendDays++;
      point.transactions += day.transactions;
      point.successful += day.successful;
      point.failed += day.failed;
    }
  }
  return [...groups.values()];
}

/** Presets are relative to the report's end, so historical reports remain navigable. */
export function volumeWindow(days: VolumePoint[], count?: number): { startIndex: number; endIndex: number } {
  return { startIndex: count ? Math.max(0, days.length - count) : 0, endIndex: Math.max(0, days.length - 1) };
}

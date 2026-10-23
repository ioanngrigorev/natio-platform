export type TrafficCohort = 'all' | 'ftd' | 'std';
export type TrafficMetric = 'method_success_rate' | 'approval_rate' | 'payment_success_rate';
export type TrafficInterval = 'day' | 'week' | 'month';
export type DailyTrafficRow = {
  day: string;
  label: string;
  selected: number;
  selection_known: number;
  approved: number;
  declined: number;
  completed: number;
  submitted: number;
};
const DAY = 86_400_000;
const time = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (value: number) => new Date(value).toISOString().slice(0, 10);

/** Aggregate source counts, never average percentages across cohorts or days. */
export function conversionSeries(rows: DailyTrafficRow[], metric: TrafficMetric, cohort: TrafficCohort, interval: TrafficInterval = 'day', period?: {from: string; to: string}) {
  const days = new Map<string, {numerator: number; denominator: number}>();
  for (const row of rows) {
    const day = days.get(row.day) ?? {numerator: 0, denominator: 0};
    days.set(row.day, day);
    // Overall includes unclassified traffic; absent cohorts retain a denominator of zero.
    if (cohort !== 'all' && row.label !== cohort) continue;
    if (metric === 'method_success_rate') {
      day.numerator += row.selected;
      day.denominator += row.selection_known;
    } else if (metric === 'approval_rate') {
      day.numerator += row.approved;
      day.denominator += row.approved + row.declined;
    } else {
      day.numerator += row.completed;
      day.denominator += row.submitted;
    }
  }
  const dates = [...days.keys()].sort();
  if (!dates.length) return [];
  const buckets = new Map<string, {day: string; end: string; numerator: number; denominator: number}>();
  // UTC calendar intervals, with exact partial-period dates in the tooltip. Empty
  // intervals remain gaps rather than joining observations across missing results.
  for (let cursor = time(period?.from ?? dates[0]); cursor <= time(period?.to ?? dates[dates.length - 1]); cursor += DAY) {
    const date = iso(cursor);
    const key = interval === 'month' ? date.slice(0, 7) : interval === 'week'
      ? iso(cursor - ((new Date(cursor).getUTCDay() + 6) % 7) * DAY) : date;
    const bucket = buckets.get(key) ?? {day: date, end: date, numerator: 0, denominator: 0};
    const counts = days.get(date);
    bucket.end = date;
    bucket.numerator += counts?.numerator ?? 0;
    bucket.denominator += counts?.denominator ?? 0;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].map(bucket => ({...bucket,
    value: bucket.denominator > 0 ? 100 * bucket.numerator / bucket.denominator : null,
  }));
}

/** A readable percentage window with at least 10 points of context, bounded by 0–100. */
export function conversionDomain(values: Array<number | null>, fullScale = false): [number, number] {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (fullScale || !finite.length) return [0, 100];
  const low = Math.min(...finite), high = Math.max(...finite);
  const padding = Math.max(2, (high - low) * 0.15);
  let lower = Math.max(0, Math.floor((low - padding) / 5) * 5);
  let upper = Math.min(100, Math.ceil((high + padding) / 5) * 5);
  if (upper - lower < 10) {
    lower = Math.max(0, upper - 10);
    upper = Math.min(100, lower + 10);
  }
  return [lower, upper];
}

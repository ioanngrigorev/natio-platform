export type TrafficCohort = 'all' | 'ftd' | 'std';
export type TrafficMetric = 'method_success_rate' | 'approval_rate' | 'payment_success_rate';
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

/** Aggregate source counts, never average cohort percentages: their sample sizes differ. */
export function conversionSeries(rows: DailyTrafficRow[], metric: TrafficMetric, cohort: TrafficCohort) {
  const days = new Map<string, {numerator: number; denominator: number}>();
  for (const row of rows) {
    const day = days.get(row.day) ?? {numerator: 0, denominator: 0};
    days.set(row.day, day);
    // Keep days belonging to other cohorts as gaps, not fabricated zero conversions.
    // The overall view includes unclassified traffic within the report's filters.
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
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, counts]) => ({
    day,
    value: counts.denominator > 0 ? 100 * counts.numerator / counts.denominator : null,
  }));
}

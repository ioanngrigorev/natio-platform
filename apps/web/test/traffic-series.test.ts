import {describe, expect, it} from 'vitest';
import {conversionSeries, type DailyTrafficRow} from '../lib/traffic-series';

const row = (values: Partial<DailyTrafficRow>): DailyTrafficRow => ({
  day: '2025-01-01', label: 'ftd', selected: 0, selection_known: 0,
  approved: 0, declined: 0, completed: 0, submitted: 0, ...values,
});

describe('conversion chart cohorts', () => {
  const rows = [
    row({label: 'ftd', completed: 1, submitted: 2}),
    row({label: 'std', completed: 90, submitted: 100}),
    row({label: 'unknown', completed: 9, submitted: 10}),
  ];
  it('weights overall conversion by submitted operations, including unclassified traffic', () => {
    expect(conversionSeries(rows, 'payment_success_rate', 'all')[0].value).toBeCloseTo(10000 / 112);
  });
  it('isolates first and returning deposits', () => {
    expect(conversionSeries(rows, 'payment_success_rate', 'ftd')[0].value).toBe(50);
    expect(conversionSeries(rows, 'payment_success_rate', 'std')[0].value).toBe(90);
  });
  it('uses recorded method-selection results as its denominator', () => {
    expect(conversionSeries([row({selected: 3, selection_known: 4, submitted: 2})], 'method_success_rate', 'all')[0].value).toBe(75);
  });
  it('excludes pending submissions from approval, but includes them in completion', () => {
    const pending = [row({approved: 8, declined: 2, submitted: 20, completed: 8})];
    expect(conversionSeries(pending, 'approval_rate', 'all')[0].value).toBe(80);
    expect(conversionSeries(pending, 'payment_success_rate', 'all')[0].value).toBe(40);
  });
  it('preserves absent-cohort and zero-denominator gaps while retaining genuine zeroes', () => {
    const gaps = [row({day:'2025-01-03'}),row({day:'2025-01-01',label:'std',submitted:2}),row({day:'2025-01-02',submitted:2})];
    expect(conversionSeries(gaps, 'payment_success_rate', 'ftd')).toEqual([
      {day:'2025-01-01',value:null},{day:'2025-01-02',value:0},{day:'2025-01-03',value:null},
    ]);
  });
  it('handles empty and single-day datasets without mutating the source', () => {
    expect(conversionSeries([], 'payment_success_rate', 'all')).toEqual([]);
    const source = Object.freeze([Object.freeze(row({submitted:1,completed:1}))]);
    expect(conversionSeries([...source], 'payment_success_rate', 'all')).toEqual([{day:'2025-01-01',value:100}]);
  });
});

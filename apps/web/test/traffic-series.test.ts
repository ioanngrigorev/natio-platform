import {describe, expect, it} from 'vitest';
import {conversionSeries, conversionDomain, type DailyTrafficRow} from '../lib/traffic-series';

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
    expect(conversionSeries(gaps, 'payment_success_rate', 'ftd').map(({day,value})=>({day,value}))).toEqual([
      {day:'2025-01-01',value:null},{day:'2025-01-02',value:0},{day:'2025-01-03',value:null},
    ]);
  });
  it('handles empty and single-day datasets without mutating the source', () => {
    expect(conversionSeries([], 'payment_success_rate', 'all')).toEqual([]);
    const source = Object.freeze([Object.freeze(row({submitted:1,completed:1}))]);
    expect(conversionSeries([...source], 'payment_success_rate', 'all')[0]).toMatchObject({day:'2025-01-01',end:'2025-01-01',value:100});
  });
});


describe('conversion intervals and scale', () => {
  it('uses Monday UTC weeks and weights outcomes across days', () => {
    const points = conversionSeries([row({day:'2025-01-05',completed:1,submitted:2}),row({day:'2025-01-06',completed:90,submitted:100}),row({day:'2025-01-07',completed:1,submitted:2})], 'payment_success_rate', 'all', 'week', {from:'2025-01-01',to:'2025-01-08'});
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({day:'2025-01-01',end:'2025-01-05',value:50});
    expect(points[1]).toMatchObject({day:'2025-01-06',end:'2025-01-08',numerator:91,denominator:102});
    expect(points[1].value).toBeCloseTo(9100/102);
  });
  it('keeps empty months as gaps and clips edge months to selected dates', () => {
    const points = conversionSeries([row({day:'2025-01-31',completed:1,submitted:1}),row({day:'2025-03-01',completed:1,submitted:2})], 'payment_success_rate', 'all', 'month', {from:'2025-01-30',to:'2025-03-02'});
    expect(points.map(({day,end,value})=>({day,end,value}))).toEqual([{day:'2025-01-30',end:'2025-01-31',value:100},{day:'2025-02-01',end:'2025-02-28',value:null},{day:'2025-03-01',end:'2025-03-02',value:50}]);
  });
  it('retains modest context, the full-scale option and valid percentage bounds', () => {
    expect(conversionDomain([88,92,null])).toEqual([85,95]);
    expect(conversionDomain([100])).toEqual([90,100]);
    expect(conversionDomain([0])).toEqual([0,10]);
    expect(conversionDomain([90,90.01])).toEqual([85,95]);
    expect(conversionDomain([88,92],true)).toEqual([0,100]);
    expect(conversionDomain([null])).toEqual([0,100]);
  });
});

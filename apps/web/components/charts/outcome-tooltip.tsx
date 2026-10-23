"use client";

import {useI18n} from '@/lib/i18n/provider';
import {intlLocales} from '@/lib/i18n/core';

type Entry = {name?: string | number; value?: string | number; payload?: {label?: string; name?: string}};

/** Keep labels and counts on separate lines so the tooltip fits small donut cards. */
export function OutcomeTooltip({active,payload}: {active?: boolean;payload?: Entry[]}) {
  const {t,locale}=useI18n();
  const entry=payload?.[0];
  if(!active || !entry || entry.value == null) return null;
  const status=String(entry.payload?.label ?? entry.payload?.name ?? entry.name ?? 'Transactions');
  const color=status==='successful'?'var(--status-success)':status==='failed'?'var(--status-failure)':status==='pending'?'var(--status-pending)':'var(--chart-1)';
  return <div className="outcome-tooltip" role="status">
    <div className="outcome-tooltip-label"><span aria-hidden="true" style={{background:color}}/>{t(status)}</div>
    <strong>{Number(entry.value).toLocaleString(intlLocales[locale])}</strong>
  </div>;
}

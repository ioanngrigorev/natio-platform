'use client';
import {useI18n} from '@/lib/i18n/provider';
import {ENGINEERING_RATE_USD, engineeringCost, money} from './model';

export function EngineeringEstimate({hours,rate=ENGINEERING_RATE_USD}:{hours:number;rate?:number}) {
  const {t}=useI18n();
  return <section aria-label={t('Development cost estimate')} className="mb-4 grid gap-4 rounded-2xl border border-ink-200 p-5 sm:grid-cols-2">
    <div><p className="text-xs text-ink-500">{t('Engineering hourly rate')}</p><strong className="mt-1 block text-2xl">{money(rate)}<small className="text-sm font-normal">{t(' / h')}</small></strong></div>
    <div><p className="text-xs text-ink-500">{t('Estimated development cost')}</p><strong className="mt-1 block text-2xl">{money(engineeringCost(hours,rate))}</strong><p className="mt-1 text-xs text-ink-500">{hours}{t(' h')} × {money(rate)}{t(' / h')}</p></div>
    <p className="text-xs text-ink-500 sm:col-span-2">{t('Planning estimate based on engineering effort. No automatic charge.')}</p>
  </section>;
}

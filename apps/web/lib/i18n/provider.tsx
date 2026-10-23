'use client';

import {createContext, useContext, useMemo, useState, useTransition, type ReactNode} from 'react';
import {useRouter} from 'next/navigation';
import {translator, languageNames, locales, validLocale, type Dictionary, type Locale} from './core';

const Context = createContext({locale: 'en' as Locale, t: translator({})});

export function LocaleProvider({locale, dictionary, children}: {locale: Locale; dictionary: Dictionary; children: ReactNode}) {
  const value = useMemo(() => ({locale, t: translator(dictionary)}), [locale, dictionary]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useI18n = () => useContext(Context);

export function LanguagePicker({compact = false}: {compact?: boolean}) {
  const {locale, t} = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [requestedLocale, setRequestedLocale] = useState(locale);

  function changeLanguage(value: string) {
    const nextLocale = validLocale(value);
    if (nextLocale === locale) return;
    setRequestedLocale(nextLocale);
    // Only the language preference changes. Refresh server translations in place
    // so sessions, the current URL, loaded chart bundles and client drafts survive.
    document.cookie = `natio_locale=${nextLocale}; path=/; max-age=31536000; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`;
    startTransition(() => router.refresh());
  }

  return <label className={'language-picker ' + (compact ? 'compact' : '')} aria-busy={pending}>
    {pending
      ? <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" aria-hidden="true"/>
      : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z"/></svg>}
    <span className="sr-only">{t('Language')}</span>
    <select aria-label={t('Language')} value={pending ? requestedLocale : locale} disabled={pending} onChange={e => changeLanguage(e.target.value)}>
      {locales.map(l => <option key={l} value={l} lang={l}>{languageNames[l]}</option>)}
    </select>
    <span className="sr-only" role="status">{pending ? t('Switching language…') : ''}</span>
  </label>;
}

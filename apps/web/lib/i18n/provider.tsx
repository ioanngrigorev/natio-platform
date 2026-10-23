'use client';

import {createContext, useContext, useEffect, useMemo, useState, useTransition, type ReactNode} from 'react';
import {translator, languageNames, locales, validLocale, type Dictionary, type Locale} from './core';
import {setLocalePreference} from './actions';

const Context = createContext({locale: 'en' as Locale, t: translator({})});

export function LocaleProvider({locale, dictionary, children}: {locale: Locale; dictionary: Dictionary; children: ReactNode}) {
  const value = useMemo(() => ({locale, t: translator(dictionary)}), [locale, dictionary]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useI18n = () => useContext(Context);

export function LanguagePicker({compact = false}: {compact?: boolean}) {
  const {locale, t} = useI18n();
  const [, startTransition] = useTransition();
  const [requestedLocale, setRequestedLocale] = useState<Locale | null>(null);
  const [error, setError] = useState(false);
  const [delayed, setDelayed] = useState(false);
  // Completion means the requested dictionary reached this component, not that
  // every unrelated transition in the dashboard has finished.
  const pending = requestedLocale !== null && requestedLocale !== locale;

  useEffect(() => {
    if (!pending) {
      setDelayed(false);
      if (requestedLocale === locale) setRequestedLocale(null);
      return;
    }
    const timeout = setTimeout(() => setDelayed(true), 8000);
    return () => clearTimeout(timeout);
  }, [pending, requestedLocale, locale]);

  function changeLanguage(value: string) {
    const nextLocale = validLocale(value);
    if (pending || nextLocale === locale) return;
    setError(false);
    setDelayed(false);
    setRequestedLocale(nextLocale);
    startTransition(async () => {
      try {
        await setLocalePreference(nextLocale);
      } catch {
        setRequestedLocale(null);
        setError(true);
      }
    });
  }

  return <div className="language-control">
    <label className={'language-picker ' + (compact ? 'compact' : '')} aria-busy={pending && !delayed}>
    {pending && !delayed
      ? <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" aria-hidden="true"/>
      : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z"/></svg>}
    <span className="sr-only">{t('Language')}</span>
    <select aria-label={t('Language')} value={pending ? requestedLocale! : locale} disabled={pending} onChange={e => changeLanguage(e.target.value)}>
      {locales.map(l => <option key={l} value={l} lang={l}>{languageNames[l]}</option>)}
    </select>
    <span className="sr-only" role="status">{pending && !delayed ? t('Switching language…') : ''}</span>
    </label>
    {error && <p role="alert" className="language-feedback">{t('Could not change language. Please try again.')}</p>}
    {pending && delayed && <div role="alert" className="language-feedback">
      <p>{t('Language change is taking longer than expected.')}</p>
      {/* An explicit recovery action preserves unsaved drafts until the user
          chooses to reload. Reloading keeps the same URL, filters and session. */}
      <button type="button" onClick={() => window.location.reload()}>{t('Reload this page')}</button>
    </div>}
  </div>;
}

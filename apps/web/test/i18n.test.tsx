import {describe, expect, it, vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {LanguagePicker, LocaleProvider} from '../lib/i18n/provider';
import {locales, translator, validLocale} from '../lib/i18n/core';
import en from '../lib/i18n/catalogs/en.json';
import ru from '../lib/i18n/catalogs/ru.json';
import es from '../lib/i18n/catalogs/es.json';
import ar from '../lib/i18n/catalogs/ar.json';
import pt from '../lib/i18n/catalogs/pt.json';

vi.mock('next/navigation', () => ({useRouter: () => ({refresh: vi.fn()})}));
const dictionaries = {en, ru, es, ar, pt};

describe('language selection', () => {
  it.each(locales)('renders all five language choices with %s selected and a translated label', locale => {
    const dictionary = dictionaries[locale];
    const html = renderToStaticMarkup(<LocaleProvider locale={locale} dictionary={dictionary}><LanguagePicker/></LocaleProvider>);
    expect(html.match(/<option /g)).toHaveLength(5);
    expect(html).toMatch(new RegExp(`<option[^>]*value="${locale}"[^>]*selected=""`));
    expect(html).toContain(`aria-label="${translator(dictionary)('Language')}"`);
    expect(html).toContain('role="status"');
    for (const text of ['Sign in to NATIO', 'Switching language…']) {
      if (locale !== 'en') expect(translator(dictionary)(text)).not.toBe(text);
    }
  });
  it('falls back to English for missing, unknown or malformed preferences', () => {
    for (const value of [undefined, null, 'fr', 'AR', 'ar; path=/admin']) expect(validLocale(value)).toBe('en');
  });
  it('preserves unknown text and surrounding whitespace and never reads prototype properties', () => {
    const t = translator({'Overview': 'Обзор'});
    expect(t('  Overview\n')).toBe('  Обзор\n');
    expect(t('Customer supplied text')).toBe('Customer supplied text');
    expect(t('constructor')).toBe('constructor');
  });
});

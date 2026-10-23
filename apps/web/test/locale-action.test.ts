import {beforeEach, describe, expect, it, vi} from 'vitest';
import {setLocalePreference} from '../lib/i18n/actions';
import {locales} from '../lib/i18n/core';

const cookieStore = vi.hoisted(() => ({set: vi.fn()}));
vi.mock('next/headers', () => ({cookies: async () => cookieStore}));

beforeEach(() => { cookieStore.set.mockClear(); vi.unstubAllEnvs(); });

describe('locale preference action', () => {
  it.each(locales)('sets only the shared language preference for %s', async locale => {
    vi.stubEnv('NODE_ENV', 'production');
    await setLocalePreference(locale);
    expect(cookieStore.set).toHaveBeenCalledExactlyOnceWith('natio_locale', locale, {
      path: '/', maxAge: 31536000, sameSite: 'lax', secure: true,
    });
  });
  it.each(['fr', 'RU', '', 'en; path=/admin', 'https://outside.example'])('rejects unsupported input %s without changing cookies', async value => {
    await expect(setLocalePreference(value)).rejects.toThrow('Unsupported language');
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
  it('supports local HTTP development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await setLocalePreference('es');
    expect(cookieStore.set).toHaveBeenCalledWith('natio_locale', 'es', expect.objectContaining({secure: false}));
  });
});

'use server';

import {cookies} from 'next/headers';
import {locales, type Locale} from './core';

/** A Server Action updates the preference and re-renders the current page/layouts
 * in the same response. Client cookie writes + router.refresh can leave the
 * root dictionary stale while an unrelated router transition remains pending.
 * This action never modifies authentication, data mode or the current URL. */
export async function setLocalePreference(value: string): Promise<void> {
  if (!locales.includes(value as Locale)) throw new Error('Unsupported language');
  (await cookies()).set('natio_locale', value, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

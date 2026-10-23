'use client';
import {useI18n} from '@/lib/i18n/provider';
import {Alert, Button} from '@/components/ui';

/** Error boundaries must not render arbitrary backend/SSR exception messages.
 * The correlation digest is enough for support to locate server-side diagnostics.
 */
export function ServiceError({error, reset}: {error: Error & {digest?: string}; reset: () => void}) {
  const {t} = useI18n();
  return <section className="mx-auto max-w-lg px-6 py-12" aria-label={t('Page unavailable')}>
    <Alert tone="bad" title={t('Page unavailable')}>
      {t('This page could not load. Please try again in a moment.')}
    </Alert>
    <p className="mt-4 text-sm text-ink-500">{t('If you submitted an operation, check its status before repeating it.')}</p>
    {error.digest && <p className="mt-3 text-xs text-ink-500">{t('Reference')}: <code>{error.digest}</code></p>}
    <div className="mt-5"><Button onClick={reset}>{t('Try again')}</Button></div>
  </section>;
}

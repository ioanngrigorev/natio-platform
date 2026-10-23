// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {LanguagePicker, LocaleProvider} from '../lib/i18n/provider';
import {type Locale} from '../lib/i18n/core';
import en from '../lib/i18n/catalogs/en.json';
import ru from '../lib/i18n/catalogs/ru.json';
import ar from '../lib/i18n/catalogs/ar.json';

const save = vi.hoisted(() => vi.fn());
vi.mock('../lib/i18n/actions', () => ({setLocalePreference: save}));
const dictionaries = {en, ru, ar};
let root: Root;
let host: HTMLDivElement;
let complete: () => void;
let fail: (error: Error) => void;

function render(locale: keyof typeof dictionaries) {
  root.render(<LocaleProvider locale={locale} dictionary={dictionaries[locale]}>
    <LanguagePicker/><input aria-label="Unsent task" defaultValue="Keep this draft"/>
  </LocaleProvider>);
}
function select(locale: Locale) {
  const field = host.querySelector('select')!;
  field.value = locale;
  field.dispatchEvent(new Event('change', {bubbles: true}));
}

beforeEach(() => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
  vi.useFakeTimers();
  save.mockReset();
  save.mockImplementation(() => new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => render('en'));
});
afterEach(async () => {
  await act(async () => complete?.());
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('language switch lifecycle', () => {
  it('finishes when the new dictionary commits, preserving the client draft even if other work remains pending', async () => {
    act(() => select('ru'));
    expect(host.querySelector('select')!.disabled).toBe(true);
    expect(save).toHaveBeenCalledWith('ru');
    act(() => render('ru'));
    expect(host.querySelector('select')!.disabled).toBe(false);
    expect(host.querySelector('select')!.value).toBe('ru');
    expect(host.querySelector('label')!.getAttribute('aria-busy')).toBe('false');
    expect(host.querySelector('input')!.value).toBe('Keep this draft');
    expect(host.querySelector('[role="status"]')!.textContent).toBe('');
    await act(async () => complete());
    act(() => render('ar'));
    expect(host.querySelector('select')!.disabled).toBe(false);
    expect(host.querySelector('select')!.value).toBe('ar');
  });
  it('does not treat an action acknowledgement as completion before translated UI arrives', async () => {
    act(() => select('ar'));
    await act(async () => complete());
    expect(host.querySelector('select')!.disabled).toBe(true);
    act(() => render('ar'));
    expect(host.querySelector('select')!.disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it('shows a recoverable error and allows a retry after a failed request', async () => {
    act(() => select('ru'));
    await act(async () => fail(new Error('network failure')));
    expect(host.querySelector('select')!.disabled).toBe(false);
    expect(host.querySelector('select')!.value).toBe('en');
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Could not change language');
    act(() => select('ru'));
    expect(save).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await act(async () => complete());
  });
  it('replaces endless spinning with explicit recovery without reloading or discarding a draft', () => {
    act(() => select('ru'));
    act(() => vi.advanceTimersByTime(8000));
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('taking longer');
    expect(host.querySelector('button')!.textContent).toBe('Reload this page');
    expect(host.querySelector('label')!.getAttribute('aria-busy')).toBe('false');
    expect(host.querySelector('input')!.value).toBe('Keep this draft');
    act(() => render('ru'));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('select')!.disabled).toBe(false);
  });
  it('cancels the recovery timer after successful switching and ignores the current language', () => {
    act(() => select('en'));
    expect(save).not.toHaveBeenCalled();
    act(() => select('ru'));
    act(() => render('ru'));
    act(() => vi.advanceTimersByTime(10000));
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

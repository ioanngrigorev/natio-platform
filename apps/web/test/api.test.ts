import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient, apiServer, ApiRequestError, qs } from '../lib/api';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const respond = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

describe('browser / API contract', () => {
  it('forwards CSRF, selected data mode and cookies on a JSON mutation', async () => {
    const request = vi.fn().mockResolvedValue(respond({ id: 'draft' })); vi.stubGlobal('fetch', request);
    expect(await apiClient('/admin/boards', { body: { name: 'Demo' }, csrf: 'csrf', mode: 'test' })).toEqual({ id: 'draft' });
    const [url, opts] = request.mock.calls[0];
    expect(url).toBe('/api/admin/boards'); expect(opts).toMatchObject({ method: 'POST', credentials: 'same-origin', body: '{"name":"Demo"}', headers: { 'x-csrf-token': 'csrf', 'x-natio-mode': 'test', 'content-type': 'application/json' } });
  });
  it('keeps multipart boundaries under the browser’s control', async () => {
    const request = vi.fn().mockResolvedValue(respond({ ok: true })); vi.stubGlobal('fetch', request);
    const formData = new FormData(); formData.append('file', new Blob(['synthetic']), 'test.txt');
    await apiClient('/admin/assistant/chat-with-files', { formData, csrf: 'csrf' });
    expect(request.mock.calls[0][1].body).toBe(formData);
    expect(request.mock.calls[0][1].headers).not.toHaveProperty('content-type');
  });
  it('preserves structured errors and the proxy request ID', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ error: { code: 'forbidden', type: 'permission_error', message: 'Read only' } }, { status: 403, headers: { 'x-request-id': 'req-contract' } })));
    await expect(apiClient('/admin/routing')).rejects.toMatchObject({ status: 403, code: 'forbidden', message: 'Read only', requestId: 'req-contract' });
  });
  it('rejects an HTML success response instead of silently returning null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Proxy login</html>', { status: 200 })));
    await expect(apiClient('/admin/boards')).rejects.toMatchObject({ code: 'invalid_response', status: 502 });
  });
  it('accepts an intentional empty 204 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    expect(await apiClient('/admin/boards/draft', { method: 'DELETE' })).toBeUndefined();
  });
  it('normalizes connection failure without retrying a mutation', async () => {
    const request = vi.fn().mockRejectedValue(new TypeError('fetch failed')); vi.stubGlobal('fetch', request);
    await expect(apiClient('/admin/payments/p/review', { method: 'POST', body: {} })).rejects.toMatchObject({ code: 'network_error', status: 503 });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('bounds waiting even when an upstream sends headers but stalls the body', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, opts: RequestInit) => Promise.resolve({ ok: true, status: 200, headers: new Headers(), text: () => new Promise((_resolve, reject) => opts.signal!.addEventListener('abort', () => reject(opts.signal!.reason))) })));
    const request = apiClient('/admin/boards', { timeoutMs: 100 });
    const assertion = expect(request).rejects.toMatchObject({ code: 'request_timeout', status: 504 });
    await vi.advanceTimersByTimeAsync(101); await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves caller cancellation as AbortError, not a server failure', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn((_url, opts: RequestInit) => new Promise((_resolve, reject) => opts.signal!.addEventListener('abort', () => reject(opts.signal!.reason)))));
    const request = apiClient('/admin/boards', { signal: controller.signal });
    const assertion = expect(request).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await assertion;
  });
  it('does not start a request when the caller has already cancelled', async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request); const controller = new AbortController(); controller.abort();
    await expect(apiClient('/admin/boards', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).not.toHaveBeenCalled();
  });
  it('forwards request-local session data without Next shared caching', async () => {
    const request = vi.fn().mockResolvedValue(respond({ id: 'session' })); vi.stubGlobal('fetch', request);
    await apiServer('/admin/auth/me', { cookie: 'natio_admin_session=test', mode: 'live' });
    expect(request.mock.calls[0][1]).toMatchObject({ cache: 'no-store', headers: { cookie: 'natio_admin_session=test', 'x-natio-mode': 'live' } });
  });
  it('exposes Retry-After without silently repeating requests', async () => {
    const request = vi.fn().mockResolvedValue(respond({ error: { code: 'rate_limited' } }, { status: 429, headers: { 'retry-after': '12' } })); vi.stubGlobal('fetch', request);
    await expect(apiClient('/admin/bi')).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 12000 }); expect(request).toHaveBeenCalledTimes(1);
  });
  it('does not reflect HTML error pages into a user-facing error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<secret>upstream trace</secret>', { status: 502 })));
    await expect(apiClient('/admin/bi')).rejects.toMatchObject({ status: 502, message: 'Request failed with status 502' });
  });
  it('encodes filters and preserves false and zero', () => expect(qs({ q: 'FTD & STD', empty: '', zero: 0, enabled: false, nil: null })).toBe('?q=FTD+%26+STD&zero=0&enabled=false'));
});

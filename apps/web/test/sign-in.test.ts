import {afterEach, describe, expect, it, vi} from 'vitest';
import {signInToWorkspace} from '../lib/sign-in';

const credentials = {email: ' person@example.test ', password: ' exact password '};
const success = () => new Response(JSON.stringify({csrf_token: 'test-session'}), {status: 200});
const rejected = (status = 401, code = 'unauthorized', message = 'Invalid email or password') => new Response(JSON.stringify({error: {code, message}}), {status});
afterEach(() => vi.unstubAllGlobals());

describe('workspace sign-in', () => {
  it.each(['admin', 'merchant'] as const)('keeps a successful %s login in its workspace without a second request', async preferred => {
    const request = vi.fn().mockResolvedValue(success());
    vi.stubGlobal('fetch', request);
    expect(await signInToWorkspace(preferred, credentials)).toBe(preferred);
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({email: 'person@example.test', password: ' exact password '});
    expect(request.mock.calls[0][1].credentials).toBe('same-origin');
  });
  it.each([
    ['merchant', 'admin', '/api/dashboard/auth/login', '/api/admin/auth/login'],
    ['admin', 'merchant', '/api/admin/auth/login', '/api/dashboard/auth/login'],
  ] as const)('opens %s entry credentials in %s after authentication there', async (preferred, actual, first, second) => {
    const request = vi.fn().mockResolvedValueOnce(rejected()).mockResolvedValueOnce(success());
    vi.stubGlobal('fetch', request);
    expect(await signInToWorkspace(preferred, credentials)).toBe(actual);
    expect(request.mock.calls.map(call => call[0])).toEqual([first, second]);
    expect(request.mock.calls[0][1].body).toBe(request.mock.calls[1][1].body);
  });
  it('rejects a wrong password without looping or identifying an account', async () => {
    const request = vi.fn().mockImplementation(() => Promise.resolve(rejected()));
    vi.stubGlobal('fetch', request);
    await expect(signInToWorkspace('merchant', credentials)).rejects.toMatchObject({status: 401, message: 'Invalid email or password'});
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each([
    [423, 'account_locked', 'Account temporarily locked'],
    [429, 'rate_limited', 'Too many requests'],
    [403, 'forbidden', 'Account disabled'],
    [401, 'unauthorized', 'Account is not active'],
    [502, 'invalid_response', 'Invalid response'],
  ])('does not switch workspaces after %s %s', async (status, code, message) => {
    const request = vi.fn().mockImplementation(() => Promise.resolve(rejected(Number(status), String(code), String(message))));
    vi.stubGlobal('fetch', request);
    await expect(signInToWorkspace('admin', credentials)).rejects.toMatchObject({status});
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('does not retry an uncertain network failure', async () => {
    const request = vi.fn().mockRejectedValue(new TypeError('connection lost'));
    vi.stubGlobal('fetch', request);
    await expect(signInToWorkspace('admin', credentials)).rejects.toMatchObject({status: 503, code: 'network_error'});
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('preserves a lock returned by the alternate workspace and stops', async () => {
    const request = vi.fn().mockResolvedValueOnce(rejected()).mockResolvedValueOnce(rejected(423, 'account_locked', 'Account temporarily locked'));
    vi.stubGlobal('fetch', request);
    await expect(signInToWorkspace('admin', credentials)).rejects.toMatchObject({status: 423, code: 'account_locked'});
    expect(request).toHaveBeenCalledTimes(2);
  });
});

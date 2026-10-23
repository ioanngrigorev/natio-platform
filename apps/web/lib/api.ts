/**
 * API access helpers.
 *  - `apiServer` runs in Server Components / route handlers: talks to the API service directly
 *    (API_INTERNAL_URL) and forwards the browser's cookies + selected mode.
 *  - `apiClient` runs in the browser: calls the same-origin `/api/*` rewrite (see next.config.mjs)
 *    with credentials, CSRF token and mode header.
 */

export class ApiRequestError extends Error {
  status: number;
  code: string;
  type: string;
  details?: unknown;
  requestId?: string;
  /** Server-supplied backoff hint. Callers decide whether an operation is safe to repeat. */
  retryAfterMs?: number;
  constructor(status: number, body: { error?: { code?: string; message?: string; type?: string; details?: unknown }; request_id?: string } | null) {
    super(body?.error?.message ?? `Request failed with status ${status}`);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = body?.error?.code ?? "unknown";
    this.type = body?.error?.type ?? "unknown";
    this.details = body?.error?.details;
    this.requestId = body?.request_id;
  }
}

export type Mode = "test" | "live";

const INTERNAL_URL = process.env.API_INTERNAL_URL || "http://localhost:4000";

async function parseResponse<T>(res: Response): Promise<T> {
  if (res.status === 204 || res.status === 205) return undefined as T;
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const error = new ApiRequestError(res.status, body as never);
    error.requestId ??= res.headers.get('x-request-id') ?? undefined;
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter) {
      const milliseconds = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
      if (Number.isFinite(milliseconds)) error.retryAfterMs = Math.max(0, milliseconds);
    }
    throw error;
  }
  // A proxy can return a login/error HTML page with HTTP 200. Treating that as
  // null makes the next render fail far away from the actual integration fault.
  if (body === null) throw new ApiRequestError(502, { error: { code: 'invalid_response', type: 'transport_error', message: 'The server returned an invalid response. Please try again.' }, request_id: res.headers.get('x-request-id') ?? undefined });
  return body as T;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** One deadline covers connection, headers AND body consumption. There are no
 * automatic retries: a lost response does not mean a payment mutation failed.
 * Explicit cancellation stays AbortError so abandoned views do not show an alert.
 */
async function fetchJson<T>(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const caller = init.signal;
  if (caller?.aborted) throw caller.reason ?? new DOMException('Request cancelled', 'AbortError');
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(caller?.reason);
  caller?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return await parseResponse<T>(response);
  } catch (error) {
    if (caller?.aborted) throw caller.reason ?? new DOMException('Request cancelled', 'AbortError');
    if (timedOut) throw new ApiRequestError(504, { error: { code: 'request_timeout', type: 'transport_error', message: 'The request timed out. Check the operation status before trying again.' } });
    if (error instanceof ApiRequestError) throw error;
    throw new ApiRequestError(503, { error: { code: 'network_error', type: 'transport_error', message: 'Unable to reach the server. Check your connection and try again.' } });
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener('abort', cancel);
  }
}

export interface ServerFetchOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
  mode?: Mode;
  revalidate?: number | false;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Server-side fetch to the API. Pass the request cookie header (from next/headers). */
export async function apiServer<T>(path: string, opts: ServerFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.mode) headers["x-natio-mode"] = opts.mode;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return fetchJson<T>(`${INTERNAL_URL}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
    signal: opts.signal,
  }, opts.timeoutMs);
}

export interface ClientFetchOptions {
  method?: string;
  body?: unknown;
  csrf?: string;
  mode?: Mode;
  formData?: FormData;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Browser-side fetch through the /api rewrite. */
export async function apiClient<T>(path: string, opts: ClientFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.csrf) headers["x-csrf-token"] = opts.csrf;
  if (opts.mode) headers["x-natio-mode"] = opts.mode;
  let body: BodyInit | undefined;
  if (opts.formData) body = opts.formData;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  return fetchJson<T>(`/api${path}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, signal: opts.signal, credentials: "same-origin" }, opts.timeoutMs);
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

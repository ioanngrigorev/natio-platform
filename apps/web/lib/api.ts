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
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) throw new ApiRequestError(res.status, body as never);
  return body as T;
}

export interface ServerFetchOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
  mode?: Mode;
  revalidate?: number | false;
}

/** Server-side fetch to the API. Pass the request cookie header (from next/headers). */
export async function apiServer<T>(path: string, opts: ServerFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.mode) headers["x-natio-mode"] = opts.mode;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${INTERNAL_URL}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  return parseResponse<T>(res);
}

export interface ClientFetchOptions {
  method?: string;
  body?: unknown;
  csrf?: string;
  mode?: Mode;
  formData?: FormData;
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
  const res = await fetch(`/api${path}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, credentials: "same-origin" });
  return parseResponse<T>(res);
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

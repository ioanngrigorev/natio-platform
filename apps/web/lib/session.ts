import { cookies, headers } from "next/headers";
import { apiServer, ApiRequestError, type Mode } from "./api";

export interface MerchantSession {
  user: { id: string; email: string; name: string; role: string; status: string; mfa_enabled: boolean; last_login_at: string | null };
  merchant: { id: string; name: string; legal_name: string | null; country: string | null; kyb_status: string; status: string; settings: Record<string, unknown> };
  projects: Array<{ id: string; name: string; slug: string; status: string; settings: Record<string, unknown> }>;
  permissions: string[];
  csrf_token: string;
  mode: Mode;
}

export interface AdminSession {
  admin: { id: string; email: string; name: string; role: string };
  csrf_token: string;
  mode: Mode;
}

export function cookieHeader(): string {
  return headers().get("cookie") ?? "";
}

export function currentMode(): Mode {
  return cookies().get("natio_mode")?.value === "live" ? "live" : "test";
}

export async function getMerchantSession(): Promise<MerchantSession | null> {
  try {
    return await apiServer<MerchantSession>("/dashboard/auth/me", { cookie: cookieHeader(), mode: currentMode() });
  } catch (err) {
    if (err instanceof ApiRequestError && (err.status === 401 || err.status === 403)) return null;
    throw err;
  }
}

export async function getAdminSession(): Promise<AdminSession | null> {
  try {
    return await apiServer<AdminSession>("/admin/auth/me", { cookie: cookieHeader(), mode: currentMode() });
  } catch (err) {
    if (err instanceof ApiRequestError && (err.status === 401 || err.status === 403)) return null;
    throw err;
  }
}

/** Fetch helper bound to the current request's cookies and mode. */
export function serverApi() {
  const cookie = cookieHeader();
  const mode = currentMode();
  return {
    mode,
    get: <T>(path: string) => apiServer<T>(path, { cookie, mode }),
    post: <T>(path: string, body?: unknown) => apiServer<T>(path, { cookie, mode, method: "POST", body }),
  };
}

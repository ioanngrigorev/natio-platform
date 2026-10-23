import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { apiServer, ApiRequestError, type Mode } from "./api";

export interface MerchantSession {
  sandbox?: boolean;
  plan: "light" | "optimal" | "premium";
  user: { id: string; email: string; name: string; role: string; status: string; mfa_enabled: boolean; last_login_at: string | null };
  merchant: { id: string; name: string; legal_name: string | null; country: string | null; kyb_status: string; status: string; settings: Record<string, unknown> };
  projects: Array<{ id: string; name: string; slug: string; status: string; settings: Record<string, unknown> }>;
  permissions: string[];
  csrf_token: string;
  mode: Mode;
}

export interface AdminSession {
  sandbox?: boolean;
  permissions?: string[];
  admin: { id: string; email: string; name: string; role: string };
  csrf_token: string;
  mode: Mode;
}

export async function cookieHeader(): Promise<string> {
  return (await headers()).get("cookie") ?? "";
}

export async function currentMode(): Promise<Mode> {
  return (await cookies()).get("natio_mode")?.value === "live" ? "live" : "test";
}

export const getMerchantSession = cache(async (): Promise<MerchantSession | null> => {
  try {
    return await apiServer<MerchantSession>("/dashboard/auth/me", { cookie: (await cookieHeader()), mode: (await currentMode()) });
  } catch (err) {
    if (err instanceof ApiRequestError && (err.status === 401 || err.status === 403)) return null;
    throw err;
  }
});

export const getAdminSession = cache(async (): Promise<AdminSession | null> => {
  try {
    return await apiServer<AdminSession>("/admin/auth/me", { cookie: (await cookieHeader()), mode: (await currentMode()) });
  } catch (err) {
    if (err instanceof ApiRequestError && (err.status === 401 || err.status === 403)) return null;
    throw err;
  }
});

/** Fetch helper bound to the current request's cookies and mode. */
export async function serverApi() {
  const cookie = (await cookieHeader());
  const mode = (await currentMode());
  return {
    mode,
    get: async <T>(path: string) => { try { return await apiServer<T>(path, { cookie, mode }); } catch (e) { if (e instanceof ApiRequestError && e.code === "upgrade_required") redirect("/dashboard/plans"); if (e instanceof ApiRequestError && e.status === 403 && path.startsWith("/admin/")) redirect("/admin/access"); throw e; } },
    post: <T>(path: string, body?: unknown) => apiServer<T>(path, { cookie, mode, method: "POST", body }),
  };
}

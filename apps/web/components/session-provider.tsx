"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { apiClient, ApiRequestError, type ClientFetchOptions, type Mode } from "@/lib/api";

export interface SessionInfo {
  kind: "merchant" | "admin";
  csrf: string;
  mode: Mode;
  permissions: string[];
  user: { id: string; email: string; name: string; role: string };
  merchant?: { id: string; name: string; kyb_status: string; status: string };
  projects?: Array<{ id: string; name: string; slug: string }>;
}

interface Ctx extends SessionInfo {
  api: <T>(path: string, opts?: ClientFetchOptions) => Promise<T>;
  can: (permission: string) => boolean;
  setMode: (mode: Mode) => void;
  toast: (msg: string, tone?: "ok" | "bad" | "info") => void;
}

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ session, children }: { session: SessionInfo; children: ReactNode }) {
  const router = useRouter();
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string; tone: "ok" | "bad" | "info" }>>([]);

  const toast = useCallback((msg: string, tone: "ok" | "bad" | "info" = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const api = useCallback(
    async <T,>(path: string, opts: ClientFetchOptions = {}) => {
      try {
        return await apiClient<T>(path, { csrf: session.csrf, mode: session.mode, ...opts });
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) {
          router.push(session.kind === "admin" ? "/admin/login" : "/dashboard/login");
        }
        throw err;
      }
    },
    [session.csrf, session.mode, session.kind, router],
  );

  const setMode = useCallback(
    (mode: Mode) => {
      document.cookie = `natio_mode=${mode}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
    },
    [router],
  );

  const value = useMemo<Ctx>(
    () => ({ ...session, api, can: (p) => session.permissions.includes(p), setMode, toast }),
    [session, api, setMode, toast],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      {toasts.length ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
          {toasts.map((t) => (
            <div key={t.id} className={"pointer-events-auto rounded-md px-3 py-2 text-[13px] shadow-lg " + (t.tone === "ok" ? "bg-ok text-white" : t.tone === "bad" ? "bg-bad text-white" : "bg-ink-900 text-white")}>
              {t.msg}
            </div>
          ))}
        </div>
      ) : null}
    </SessionContext.Provider>
  );
}

export function useSession(): Ctx {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

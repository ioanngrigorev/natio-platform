import type { FastifyReply, FastifyRequest } from "fastify";
import { loadConfig } from "../config.js";
import { COOKIES } from "./context.js";

export function setSessionCookie(reply: FastifyReply, kind: "merchant" | "admin", token: string, ttlHours: number) {
  const cfg = loadConfig();
  reply.setCookie(COOKIES[kind], token, {
    path: "/",
    httpOnly: true,
    secure: cfg.COOKIE_SECURE,
    sameSite: "lax",
    maxAge: ttlHours * 3600,
    ...(cfg.COOKIE_DOMAIN ? { domain: cfg.COOKIE_DOMAIN } : {}),
  });
}

export function clearSessionCookie(reply: FastifyReply, kind: "merchant" | "admin") {
  const cfg = loadConfig();
  reply.clearCookie(COOKIES[kind], { path: "/", ...(cfg.COOKIE_DOMAIN ? { domain: cfg.COOKIE_DOMAIN } : {}) });
}

export function idempotencyKeyOf(req: FastifyRequest): string | undefined {
  const v = req.headers["idempotency-key"];
  const key = Array.isArray(v) ? v[0] : v;
  return key?.trim() || undefined;
}

export function dateOrUndefined(v: unknown): Date | undefined {
  if (typeof v !== "string" || !v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function periodFromQuery(q: Record<string, unknown>, defaultDays = 7): { from: Date; to: Date } {
  const to = dateOrUndefined(q.to) ?? new Date();
  const from = dateOrUndefined(q.from) ?? new Date(to.getTime() - defaultDays * 24 * 3600 * 1000);
  return { from, to };
}

import type { FastifyReply, FastifyRequest } from "fastify";
import { getDb } from "../db/client.js";
import { Errors } from "../lib/errors.js";
import { safeEqual } from "../lib/crypto.js";
import { authenticateApiKey } from "../modules/api-keys/service.js";
import { resolveAdminSession, resolveMerchantSession } from "../modules/auth/service.js";
import { hasAdminPermission, hasPermission, type AdminPermission, type Permission } from "../modules/auth/permissions.js";
import { COOKIES } from "./context.js";
import { isIpAllowed } from "../lib/net.js";

/** Public API: Authorization: Bearer natio_sk_test_... */
export async function requireApiKey(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) throw Errors.unauthorized("Provide your API key as `Authorization: Bearer natio_sk_test_...`");
  const secret = header.slice(7).trim();
  const principal = await authenticateApiKey(getDb(), secret);
  if (!principal) throw Errors.invalidApiKey();
  const allowed = principal.project.settings.allowedIps ?? [];
  if (allowed.length && !isIpAllowed(req.ip, allowed)) throw Errors.ipNotAllowed();
  req.apiKey = principal;
}

function readMode(req: FastifyRequest): "test" | "live" {
  const h = String(req.headers["x-natio-mode"] ?? "").toLowerCase();
  if (h === "live") return "live";
  const q = (req.query as Record<string, unknown> | undefined)?.mode;
  return q === "live" ? "live" : "test";
}

function checkCsrf(req: FastifyRequest, csrfToken: string) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  const header = String(req.headers["x-csrf-token"] ?? "");
  if (!header || !safeEqual(header, csrfToken)) throw Errors.forbidden("Missing or invalid CSRF token");
}

export function requireMerchant(permission?: Permission) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const token = req.cookies?.[COOKIES.merchant];
    if (!token) throw Errors.unauthorized();
    const principal = await resolveMerchantSession(getDb(), token);
    if (!principal) throw Errors.unauthorized("Session expired. Please sign in again.");
    if (principal.merchant.status === "disabled") throw Errors.forbidden("This merchant account has been disabled");
    checkCsrf(req, principal.session.csrfToken);
    if (permission && !hasPermission(principal.user.role, permission)) throw Errors.forbidden(`Requires permission ${permission}`);
    req.merchantUser = principal;
    req.dashboardMode = readMode(req);
  };
}

export function requireAdmin(permission: AdminPermission = "admin.read") {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const token = req.cookies?.[COOKIES.admin];
    if (!token) throw Errors.unauthorized();
    const principal = await resolveAdminSession(getDb(), token);
    if (!principal) throw Errors.unauthorized("Session expired. Please sign in again.");
    checkCsrf(req, principal.session.csrfToken);
    if (!hasAdminPermission(principal.admin.role, permission)) throw Errors.forbidden(`Requires admin permission ${permission}`);
    req.admin = principal;
    req.dashboardMode = readMode(req);
  };
}

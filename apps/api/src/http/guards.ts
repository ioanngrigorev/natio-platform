import { requirePlan, featureForPermission } from '../modules/plans/service.js';
import {loadConfig} from '../config.js';
import type { FastifyReply, FastifyRequest } from "fastify";
import { getDb } from "../db/client.js";
import { Errors } from "../lib/errors.js";
import { safeEqual } from "../lib/crypto.js";
import { authenticateApiKey } from "../modules/api-keys/service.js";
import { resolveAdminSession, resolveMerchantSession } from "../modules/auth/service.js";
import { adminReadPermission, hasAdminPermission, hasPermission, type AdminPermission, type Permission } from "../modules/auth/permissions.js";
import { COOKIES } from "./context.js";
import { isIpAllowed } from "../lib/net.js";

/** Public API: Authorization: Bearer natio_sk_test_... */
export async function requireApiKey(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) throw Errors.unauthorized("Provide your API key as `Authorization: Bearer natio_sk_test_...`");
  const secret = header.slice(7).trim();
  const principal = await authenticateApiKey(getDb(), secret);
  if (!principal) throw Errors.invalidApiKey();
  if (loadConfig().NATIO_SANDBOX_ONLY && principal.mode === 'live') throw Errors.forbidden('Live payments are disabled in this demo environment');
  // Redirect keys cannot refund, pay out, enumerate ledger data or store methods.
  const path=req.url.split('?')[0]!;
  if(principal.apiKey.integrationType==='redirect' && !(
    (req.method==='POST'&&path==='/v1/checkout-sessions') ||
    (req.method==='GET'&&/^\/v1\/payments\/[^/]+(?:\/timeline)?$/.test(path))
  )) throw Errors.forbidden('This redirect key can only create checkout sessions and read their payment status');
  const allowed = principal.project.settings.allowedIps ?? [];
  if (allowed.length && !isIpAllowed(req.ip, allowed)) throw Errors.ipNotAllowed();
  await requirePlan(principal.merchant.id, 'integrations',principal.mode);
  req.apiKey = principal;
}

function readMode(req: FastifyRequest): "test" | "live" {
  if (loadConfig().NATIO_SANDBOX_ONLY) return 'test';
  const h = String(req.headers["x-natio-mode"] ?? "").toLowerCase();
  if (h === "live" || h === "test") return h;
  const q = (req.query as Record<string, unknown> | undefined)?.mode;
  return q === "live" ? "live" : "test";
}

export function checkCsrf(req: FastifyRequest, csrfToken: string) {
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
    if (!/^\/dashboard\/(auth|development|plans|recommendations|assistant|knowledge|boards|bi)(?:[/?]|$)/.test(req.url)) await requirePlan(principal.merchant.id, featureForPermission(permission, req.method, req.url),readMode(req));
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
    if (!hasAdminPermission(principal.admin.role, adminReadPermission(req.url))) throw Errors.forbidden("This section is not available to your role");
    if (!hasAdminPermission(principal.admin.role, permission)) throw Errors.forbidden(`Requires admin permission ${permission}`);
    req.admin = principal;
    req.dashboardMode = readMode(req);
  };
}

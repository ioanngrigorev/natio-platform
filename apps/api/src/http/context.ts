import "@fastify/cookie";
import type { ApiKeyPrincipal } from "../modules/api-keys/service.js";
import type { AdminPrincipal, MerchantPrincipal } from "../modules/auth/service.js";
import type { Actor } from "../modules/audit/service.js";

declare module "fastify" {
  interface FastifyRequest {
    requestId: string;
    apiKey?: ApiKeyPrincipal;
    merchantUser?: MerchantPrincipal;
    admin?: AdminPrincipal;
    /** Mode selected for dashboard requests (X-Natio-Mode header or ?mode=), defaults to test. */
    dashboardMode: "test" | "live";
  }
  interface FastifyContextConfig {
    /** Public routes skip authentication. */
    public?: boolean;
  }
}

export function actorFromRequest(req: {
  requestId: string;
  ip: string;
  headers: Record<string, unknown>;
  apiKey?: ApiKeyPrincipal;
  merchantUser?: MerchantPrincipal;
  admin?: AdminPrincipal;
}): Actor {
  const base = { ip: req.ip, userAgent: String(req.headers["user-agent"] ?? ""), requestId: req.requestId };
  if (req.admin) return { ...base, type: "admin_user", id: req.admin.admin.id, label: req.admin.admin.email };
  if (req.merchantUser) {
    return {
      ...base,
      type: "merchant_user",
      id: req.merchantUser.user.id,
      label: req.merchantUser.user.email,
      merchantId: req.merchantUser.merchant.id,
    };
  }
  if (req.apiKey) return { ...base, type: "api_key", id: req.apiKey.apiKey.id, label: req.apiKey.apiKey.prefix, merchantId: req.apiKey.merchant.id };
  return { ...base, type: "system" };
}

export const COOKIES = {
  merchant: "natio_session",
  admin: "natio_admin_session",
} as const;

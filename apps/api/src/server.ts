import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { loadConfig } from "./config.js";
import { ApiError, Errors } from "./lib/errors.js";
import { newRequestId } from "./lib/ids.js";
import { logger } from "./lib/logger.js";
import "./http/context.js";
import { registerV1Routes } from "./http/routes/v1.js";
import { registerDashboardRoutes } from "./http/routes/dashboard.js";
import { registerAdminRoutes } from "./http/routes/admin.js";
import { registerPublicRoutes } from "./http/routes/public.js";

export async function buildServer(): Promise<FastifyInstance> {
  const cfg = loadConfig();
  const app = Fastify({
    loggerInstance: logger,
    // Only peers listed in TRUST_PROXY may set X-Forwarded-For. Trusting every peer would let
    // any client forge req.ip and defeat the project IP allow-list, rate limiting and audit trails.
    trustProxy: cfg.trustProxy,
    bodyLimit: 1024 * 1024,
    genReqId: () => newRequestId(),
    disableRequestLogging: cfg.isTest,
  }) as unknown as FastifyInstance;

  app.decorateRequest("requestId", "");
  app.decorateRequest("dashboardMode", "test");
  app.addHook("onRequest", async (req, reply) => {
    req.requestId = String(req.id);
    reply.header("x-request-id", req.requestId);
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    hsts: cfg.isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  });
  await app.register(cors, {
    origin: (origin, cb) => {
      // Public API (/v1) is server-to-server; dashboards are served from configured origins.
      if (!origin || cfg.corsOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-CSRF-Token", "X-Natio-Mode", "X-Request-Id"],
    exposedHeaders: ["x-request-id"],
  });
  await app.register(cookie, { secret: cfg.NATIO_SESSION_SECRET });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  let redis: Redis | undefined;
  if (cfg.QUEUE_DRIVER === "redis" && cfg.REDIS_URL && !cfg.isTest) {
    redis = new Redis(cfg.REDIS_URL, { connectTimeout: 500, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    redis.on("error", () => undefined);
  }
  // The limiter runs on onRequest, before any authentication has happened, so the bucket can only
  // be the peer address. /v1 and the browser surfaces get their own budget so server-to-server API
  // traffic cannot exhaust the quota a merchant's staff need for the dashboard.
  const isPublicApi = (url: string) => url === "/v1" || url.startsWith("/v1/");
  await app.register(rateLimit, {
    global: true,
    max: (req) => (isPublicApi(req.url) ? cfg.RATE_LIMIT_API_PER_MINUTE : cfg.RATE_LIMIT_DASHBOARD_PER_MINUTE),
    timeWindow: "1 minute",
    redis,
    nameSpace: "natio-rl:",
    keyGenerator: (req) => `${isPublicApi(req.url) ? "api" : "app"}:${req.ip}`,
    // The plugin throws whatever this returns, so it must be an Error the error handler understands.
    errorResponseBuilder: () => Errors.rateLimited(),
    addHeadersOnExceeding: { "x-ratelimit-limit": true, "x-ratelimit-remaining": true, "x-ratelimit-reset": true },
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.status).send({ ...err.toJSON(), request_id: req.requestId });
    }
    const fastifyErr = err as { statusCode?: number; validation?: unknown; code?: string; message?: string };
    if (fastifyErr.statusCode === 429) return reply.status(429).send({ ...Errors.rateLimited().toJSON(), request_id: req.requestId });
    if (fastifyErr.statusCode === 413) return reply.status(413).send({ error: { type: "invalid_request_error", code: "payload_too_large", message: "Request body is too large" }, request_id: req.requestId });
    if (fastifyErr.statusCode === 400 && fastifyErr.code === "FST_ERR_CTP_INVALID_JSON_BODY") {
      return reply.status(400).send({ error: { type: "invalid_request_error", code: "invalid_json", message: "Request body is not valid JSON" }, request_id: req.requestId });
    }
    if (fastifyErr.statusCode === 415) return reply.status(415).send({ error: { type: "invalid_request_error", code: "unsupported_media_type", message: "Use application/json" }, request_id: req.requestId });
    req.log.error({ err, requestId: req.requestId }, "unhandled error");
    return reply.status(500).send({ ...Errors.internal().toJSON(), request_id: req.requestId });
  });
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { type: "not_found_error", code: "route_not_found", message: `No route for ${req.method} ${req.url}` }, request_id: req.requestId });
  });

  await registerPublicRoutes(app);
  await registerV1Routes(app);
  await registerDashboardRoutes(app);
  await registerAdminRoutes(app);

  app.addHook("onClose", async () => {
    await redis?.quit().catch(() => undefined);
  });
  return app;
}

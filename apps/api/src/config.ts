import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number.parseInt(v, 10)))
    .pipe(z.number().int().nonnegative());

const hexKey = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, "must be 64 hex characters (openssl rand -hex 32)");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NATIO_PROCESS_ROLE: z.enum(["api", "worker", "all"]).default("all"),
  API_PORT: int(4000),
  API_HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  PUBLIC_WEB_URL: z.string().url().default("http://localhost:3000"),
  PUBLIC_API_URL: z.string().url().default("http://localhost:4000"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  DATABASE_URL: z.string().default("postgres://natio:natio@localhost:5432/natio"),
  DATABASE_POOL_MAX: int(10),
  DATABASE_SSL: z.enum(["disable", "require"]).default("disable"),

  REDIS_URL: z.string().optional(),
  QUEUE_DRIVER: z.enum(["redis", "memory"]).default("redis"),

  NATIO_ENCRYPTION_KEY: hexKey,
  NATIO_SESSION_SECRET: hexKey,

  SESSION_TTL_HOURS: int(12),
  ADMIN_SESSION_TTL_HOURS: int(8),
  COOKIE_SECURE: bool,
  COOKIE_DOMAIN: z.string().optional(),

  /**
   * Which peers may set X-Forwarded-For. Passed straight to Fastify's `trustProxy`.
   * "loopback" (default) trusts only 127.0.0.1/::1, so a direct client cannot forge its own IP.
   * Behind a load balancer or a reverse proxy, set this to that proxy's address/CIDR
   * (e.g. "10.0.0.0/8") — otherwise req.ip is the proxy and IP allow-lists / rate limits
   * collapse onto it. "false" disables XFF parsing entirely.
   */
  TRUST_PROXY: z.string().default("loopback"),

  RATE_LIMIT_API_PER_MINUTE: int(600),
  RATE_LIMIT_DASHBOARD_PER_MINUTE: int(300),
  RATE_LIMIT_AUTH_PER_MINUTE: int(10),

  DEFAULT_RETRY_MAX_ATTEMPTS: int(3),
  DEFAULT_RETRY_ON_SOFT_DECLINE: z
    .string()
    .optional()
    .transform((v) => v === undefined || v === "" || v === "true" || v === "1"),
  PROVIDER_TIMEOUT_MS: int(15000),
  IDEMPOTENCY_TTL_HOURS: int(24),

  WEBHOOK_TIMEOUT_MS: int(10000),
  WEBHOOK_MAX_ATTEMPTS: int(6),
  WEBHOOK_ALLOW_PRIVATE_URLS: bool,

  /**
   * Whether the worker polls public chain endpoints for incoming payments.
   *
   * Off unless asked for. The watcher reaches out to third-party hosts on a
   * timer, and a deployment that has no crypto merchants should not be making
   * those requests at all — nor should a test run, which would otherwise hit
   * the real TronGrid.
   */
  CHAIN_WATCH_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),

  SEED_DEMO_PASSWORD: z.string().default("Natio-demo-2026"),
  SEED_ADMIN_EMAIL: z.string().default("admin@natio.local"),
  SEED_MERCHANT_EMAIL: z.string().default("owner@demo-merchant.local"),
});

export type Config = z.infer<typeof schema> & {
  isProduction: boolean;
  isTest: boolean;
  corsOrigins: string[];
  /** Normalised TRUST_PROXY value in the shape Fastify expects. */
  trustProxy: boolean | string | string[];
};

function parseTrustProxy(raw: string): boolean | string | string[] {
  const v = raw.trim();
  if (v === "" || v === "false" || v === "0") return false;
  if (v === "true" || v === "1") return true;
  return v.includes(",") ? v.split(",").map((s) => s.trim()).filter(Boolean) : v;
}


/**
 * True when DATABASE_URL points at a host that cannot be reached from outside
 * this machine or its container network: a bare service name (no dot), a
 * loopback address, a private IPv4 range, or a unix socket.
 */
export function isLocalDatabaseHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (!host) return true; // unix socket
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return true;
  if (!host.includes(".")) return true; // docker/compose service name
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
  }
  return false;
}

let cached: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid environment configuration:\n  ${issues}`);
  }
  const c = parsed.data;
  const corsOrigins = c.CORS_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (c.NODE_ENV === "production") {
    if (!c.COOKIE_SECURE) throw new Error("COOKIE_SECURE must be true in production");
    if (c.QUEUE_DRIVER === "memory") throw new Error("QUEUE_DRIVER=memory is not allowed in production");
    if (c.WEBHOOK_ALLOW_PRIVATE_URLS) throw new Error("WEBHOOK_ALLOW_PRIVATE_URLS must be false in production");
    if (c.NATIO_ENCRYPTION_KEY.toLowerCase() === c.NATIO_SESSION_SECRET.toLowerCase()) {
      throw new Error("NATIO_ENCRYPTION_KEY and NATIO_SESSION_SECRET must be different keys");
    }
    if (corsOrigins.includes("*")) throw new Error("CORS_ORIGINS must not contain '*' in production");
    if (corsOrigins.some((o) => o.startsWith("http://"))) {
      throw new Error("CORS_ORIGINS must use https in production");
    }
    // TLS to the database is required whenever the database is reached over a
    // network we do not control. A container/service name or a private address
    // (the compose network, or a socket on the same host) is exempt: there is no
    // TLS terminator in front of Postgres there, and forcing 'require' would
    // only mean trusting an unverifiable self-signed certificate.
    if (c.DATABASE_SSL !== "require" && !isLocalDatabaseHost(c.DATABASE_URL)) {
      throw new Error("DATABASE_SSL must be 'require' when the database is reached over a routed network");
    }
    if (c.TRUST_PROXY === "true") throw new Error("TRUST_PROXY=true trusts X-Forwarded-For from any peer; set the proxy's address or CIDR");
  }
  cached = {
    ...c,
    isProduction: c.NODE_ENV === "production",
    isTest: c.NODE_ENV === "test",
    corsOrigins,
    trustProxy: parseTrustProxy(c.TRUST_PROXY),
  };
  return cached;
}

export function resetConfigForTests() {
  cached = null;
}

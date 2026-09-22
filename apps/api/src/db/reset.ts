/**
 * Development helper: drops the public schema and re-applies migrations + seed.
 * Refuses to run in production.
 */
import { sql } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { closeDb, getDb } from "./client.js";
import { runMigrations } from "./migrate.js";
import { runSeed } from "./seed.js";
import { logger } from "../lib/logger.js";

async function main() {
  const cfg = loadConfig();
  if (cfg.isProduction) throw new Error("db:reset is disabled in production");
  const db = getDb();
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await runMigrations();
  await runSeed();
  logger.info("database reset complete");
  await closeDb();
}

main().catch(async (err) => {
  logger.error({ err }, "reset failed");
  await closeDb();
  process.exit(1);
});

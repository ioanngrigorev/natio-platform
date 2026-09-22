import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { loadConfig } from "../config.js";
import * as schema from "./schema/index.js";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

let pool: pg.Pool | null = null;
let db: Db | null = null;

// pg returns bigint columns as strings by default; NATIO amounts fit in JS safe integers.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));
// numeric → number (fee percentages)
pg.types.setTypeParser(1700, (v) => Number.parseFloat(v));

export function getPool(): pg.Pool {
  if (pool) return pool;
  const cfg = loadConfig();
  pool = new pg.Pool({
    connectionString: cfg.DATABASE_URL,
    max: cfg.DATABASE_POOL_MAX,
    ssl: cfg.DATABASE_SSL === "require" ? { rejectUnauthorized: true } : undefined,
    application_name: `natio-${cfg.NATIO_PROCESS_ROLE}`,
  });
  return pool;
}

export function getDb(): Db {
  if (db) return db;
  db = drizzle(getPool(), { schema });
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}

export { schema };

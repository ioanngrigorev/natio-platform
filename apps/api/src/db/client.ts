import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { loadConfig } from "../config.js";
import * as schema from "./schema/index.js";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

let pool: pg.Pool | null = null;
let db: Db | null = null;

// pg returns bigint columns as strings by default; fiat amounts in minor units
// fit in JS safe integers with room to spare (2^53 minor units is ~90 trillion
// in a two-decimal currency), so parsing them to numbers is safe.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));

// `numeric` is deliberately NOT parsed. It stays the exact decimal string pg
// sends, and each call site converts when it wants a number — every reader of
// fee_percent already does.
//
// There used to be a global numeric → parseFloat parser here, added for that
// one fee column. It silently destroyed precision for every other numeric
// value: an on-chain amount of 1000000000000000000000 base units came back as
// 1e+21, which is a different number and cannot even be converted to a BigInt.
// The database was storing the right value and the driver was throwing it away
// on the way out. A global "make exact decimals into floats" rule is a
// landmine in a ledger; there is no safe amount of it.

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

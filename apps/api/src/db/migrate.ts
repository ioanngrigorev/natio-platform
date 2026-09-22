import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getDb } from "./client.js";
import { logger } from "../lib/logger.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(): Promise<void> {
  const db = getDb();
  await migrate(db, { migrationsFolder: path.join(here, "migrations") });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  runMigrations()
    .then(async () => {
      logger.info("migrations applied");
      await closeDb();
    })
    .catch(async (err) => {
      logger.error({ err }, "migration failed");
      await closeDb();
      process.exit(1);
    });
}

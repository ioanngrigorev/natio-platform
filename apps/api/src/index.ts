import { loadConfig } from "./config.js";
import { closeDb, getDb } from "./db/client.js";
import { assertEncryptionKeyMatches } from "./lib/encryption-guard.js";
import { logger } from "./lib/logger.js";
import { closeQueues } from "./lib/queue.js";
import { buildServer } from "./server.js";
import { startWorkers, stopWorkers } from "./workers/index.js";

async function main() {
  const cfg = loadConfig();
  const role = cfg.NATIO_PROCESS_ROLE;
  let app: Awaited<ReturnType<typeof buildServer>> | null = null;

  // Before anything is served or any job is picked up. A process that starts
  // under the wrong key does damage quietly; one that refuses to start is a
  // five-minute operational problem with an obvious cause in the log.
  await assertEncryptionKeyMatches(getDb(), cfg.NATIO_ENCRYPTION_KEY);

  if (role === "api" || role === "all") {
    app = await buildServer();
    await app.listen({ port: cfg.API_PORT, host: cfg.API_HOST });
    logger.info({ port: cfg.API_PORT, env: cfg.NODE_ENV, role }, "NATIO API listening");
  }
  if (role === "worker" || role === "all") {
    await startWorkers();
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    try {
      await app?.close();
      await stopWorkers();
      await closeQueues();
      await closeDb();
    } catch (err) {
      logger.error({ err }, "error during shutdown");
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (err) => logger.error({ err }, "unhandled rejection"));
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});

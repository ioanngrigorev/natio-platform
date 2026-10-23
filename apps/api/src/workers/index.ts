/**
 * Background workers: webhook delivery and provider status sync.
 * Run in-process (NATIO_PROCESS_ROLE=all) or as a dedicated process (NATIO_PROCESS_ROLE=worker).
 */
import { getDb } from "../db/client.js";
import { logger } from "../lib/logger.js";
import { getQueue, QUEUE_NAMES } from "../lib/queue.js";
import type { WebhookJob } from "../modules/events/service.js";
import { syncAttempt, type ProviderSyncJob } from "../modules/payments/orchestrator.js";
import { deliverWebhook, recoverWebhookOutbox } from "../modules/webhooks/service.js";
import { purgeExpiredIdempotencyKeys } from "../modules/idempotency/service.js";
import { runWatchCycle, WATCH_INTERVAL_MS } from "../modules/wallets/watcher.js";
import { loadConfig } from "../config.js";

let outboxRecovery: NodeJS.Timeout | null = null;
let recoveryInFlight: Promise<void> | null = null;
let maintenance: NodeJS.Timeout | null = null;
let chainWatch: NodeJS.Timeout | null = null;
let watchInFlight: Promise<void> | null = null;
let maintenanceInFlight: Promise<unknown> | null = null;

export async function startWorkers(): Promise<void> {
  const db = getDb();
  await getQueue<WebhookJob & { manual?: boolean }>(QUEUE_NAMES.webhooks).process(async (job) => {
    await deliverWebhook(db, job);
  }, 8);
  await getQueue<ProviderSyncJob>(QUEUE_NAMES.providerSync).process(async (job) => {
    await syncAttempt(db, job);
  }, 4);
  if (!outboxRecovery && !loadConfig().isTest) {
    const recover = () => {
      if (recoveryInFlight) return;
      recoveryInFlight = recoverWebhookOutbox(db)
        .then((count) => { if (count) logger.info({ count }, "outbox deliveries recovered"); })
        .catch((err) => logger.error({ err }, "outbox recovery failed; will retry"))
        .finally(() => { recoveryInFlight = null; });
    };
    recover();
    outboxRecovery = setInterval(recover, 30_000);
    outboxRecovery.unref();
  }
  if (!maintenance) {
    maintenance = setInterval(
      () => {
        if (maintenanceInFlight) return;
        maintenanceInFlight = purgeExpiredIdempotencyKeys(db)
          .then((n) => n && logger.info({ purged: n }, "idempotency keys purged"))
          .catch((err) => logger.error({ err }, "maintenance failed"))
          .finally(() => { maintenanceInFlight = null; });
      },
      15 * 60 * 1000,
    );
    maintenance.unref();
  }
  // Chain watch. A cycle can outlast its interval on a slow public endpoint, so
  // it guards against overlapping itself rather than relying on the timer — two
  // concurrent cycles would be harmless thanks to the idempotent observation
  // write, but they would double the load on endpoints that rate-limit.
  if (!chainWatch && loadConfig().CHAIN_WATCH_ENABLED) {
    chainWatch = setInterval(() => {
      if (watchInFlight) return;
      watchInFlight = runWatchCycle(db)
        .then((r) => {
          if (r.transfersSeen > 0 || r.settled > 0 || r.expired > 0) {
            logger.info({ watch: r }, "chain watch cycle");
          }
        })
        .catch((err) => logger.error({ err }, "chain watch cycle failed"))
        .finally(() => {
          watchInFlight = null;
        });
    }, WATCH_INTERVAL_MS);
    chainWatch.unref();
  }

  logger.info("workers started");
}

export async function stopWorkers(): Promise<void> {
  if (outboxRecovery) clearInterval(outboxRecovery);
  outboxRecovery = null;
  if (maintenance) clearInterval(maintenance);
  maintenance = null;
  if (chainWatch) clearInterval(chainWatch);
  chainWatch = null;
  await Promise.allSettled([recoveryInFlight, maintenanceInFlight, watchInFlight]);
}

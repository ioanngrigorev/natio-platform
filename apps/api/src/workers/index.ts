/**
 * Background workers: webhook delivery and provider status sync.
 * Run in-process (NATIO_PROCESS_ROLE=all) or as a dedicated process (NATIO_PROCESS_ROLE=worker).
 */
import { getDb } from "../db/client.js";
import { logger } from "../lib/logger.js";
import { getQueue, QUEUE_NAMES } from "../lib/queue.js";
import type { WebhookJob } from "../modules/events/service.js";
import { syncAttempt, type ProviderSyncJob } from "../modules/payments/orchestrator.js";
import { deliverWebhook } from "../modules/webhooks/service.js";
import { purgeExpiredIdempotencyKeys } from "../modules/idempotency/service.js";

let maintenance: NodeJS.Timeout | null = null;

export async function startWorkers(): Promise<void> {
  const db = getDb();
  await getQueue<WebhookJob & { manual?: boolean }>(QUEUE_NAMES.webhooks).process(async (job) => {
    await deliverWebhook(db, job);
  }, 8);
  await getQueue<ProviderSyncJob>(QUEUE_NAMES.providerSync).process(async (job) => {
    await syncAttempt(db, job);
  }, 4);
  if (!maintenance) {
    maintenance = setInterval(
      () => {
        purgeExpiredIdempotencyKeys(db)
          .then((n) => n && logger.info({ purged: n }, "idempotency keys purged"))
          .catch((err) => logger.error({ err }, "maintenance failed"));
      },
      15 * 60 * 1000,
    );
    maintenance.unref();
  }
  logger.info("workers started");
}

export async function stopWorkers(): Promise<void> {
  if (maintenance) clearInterval(maintenance);
  maintenance = null;
}

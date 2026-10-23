import { loadConfig } from "../config.js";
import type { providerAccounts, providers } from "../db/schema/index.js";
import { decryptJson } from "../lib/crypto.js";
import {Errors} from '../lib/errors.js';
import type { ProviderContext } from "./types.js";

export type ProviderAccountRow = typeof providerAccounts.$inferSelect;
export type ProviderRow = typeof providers.$inferSelect;

export function buildProviderContext(account: ProviderAccountRow, provider: ProviderRow): ProviderContext {
  const cfg = loadConfig();
  if (cfg.NATIO_SANDBOX_ONLY && (account.mode !== 'test' || !['mock_acquirer','mock_qr'].includes(provider.adapterKey))) {
    throw Errors.forbidden('This demo environment can only execute simulated test connectors');
  }
  let credentials: Record<string, unknown> = {};
  if (account.credentialsEnc) {
    try {
      credentials = decryptJson<Record<string, unknown>>(account.credentialsEnc, cfg.NATIO_ENCRYPTION_KEY);
    } catch {
      credentials = {};
    }
  }
  return {
    providerAccountId: account.id,
    providerId: provider.id,
    providerCode: provider.code,
    mode: account.mode,
    credentials,
    config: account.config ?? {},
    timeoutMs: cfg.PROVIDER_TIMEOUT_MS,
  };
}

/**
 * Adapter registry. A provider row in the database references an adapter by `adapterKey`.
 * Adding a real provider = implement ProviderAdapter + register it here + create provider/account rows.
 * No changes to the orchestration engine are required.
 */
import { MockProviderAdapter } from "./mock/mock-adapter.js";
import type { ProviderAdapter } from "./types.js";

const adapters = new Map<string, ProviderAdapter>();

export function registerAdapter(adapter: ProviderAdapter): void {
  adapters.set(adapter.key, adapter);
}

export function getAdapter(key: string): ProviderAdapter {
  const adapter = adapters.get(key);
  if (!adapter) throw new Error(`No provider adapter registered for key "${key}"`);
  return adapter;
}

export function listAdapters(): ProviderAdapter[] {
  return [...adapters.values()];
}

// Built-in sandbox adapters.
registerAdapter(new MockProviderAdapter("mock_acquirer", "NATIO Demo Acquirer", "acquirer"));
registerAdapter(new MockProviderAdapter("mock_qr", "NATIO Demo QR Provider", "qr"));

// Placeholders for future real connectors (documented in docs/ADDING_A_PROVIDER.md):
//   registerAdapter(new StripeAdapter());        // adapterKey: "stripe"
//   registerAdapter(new AdyenAdapter());         // adapterKey: "adyen"
//   registerAdapter(new CheckoutComAdapter());   // adapterKey: "checkout"
//   registerAdapter(new NuveiAdapter());         // adapterKey: "nuvei"
//   registerAdapter(new LocalBankAdapter(...));  // adapterKey: "bank_<code>"

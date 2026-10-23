import { serverApi } from "./session";
import { adminPeriod, DEMO_END } from "./admin-period";

export async function getAdminPeriod(requested?: string) {
  const api = (await serverApi());
  const latest = api.mode === "test" && requested && requested !== "2025"
    ? await api.get<{ data: Array<{ occurred_at: string }> }>(`/admin/transactions?limit=1&to=${DEMO_END}`)
    : null;
  return adminPeriod(api.mode, requested, new Date(), latest?.data[0]?.occurred_at);
}

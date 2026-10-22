export const DEMO_END = "2025-12-31T23:59:59.999Z";

/** Demo shortcuts navigate the historical dataset; live shortcuts follow the clock. */
export function adminPeriod(mode: "test" | "live", requested?: string, now = new Date(), latestDemoTransaction?: string) {
  const choices = ["1", "7", "30", "90", "2025"];
  const days = requested && choices.includes(requested) ? requested : mode === "test" ? "2025" : "1";
  if (days === "2025") return { days, from: "2025-01-01T00:00:00.000Z", to: DEMO_END, label: "Full year 2025" };
  const demoDay = latestDemoTransaction?.slice(0, 10);
  const anchor = demoDay && /^2025-\d{2}-\d{2}$/.test(demoDay) ? `${demoDay}T23:59:59.999Z` : DEMO_END;
  const to = mode === "test" ? new Date(anchor) : now;
  const from = new Date(to.getTime() - Number(days) * 86400_000 + (mode === "test" ? 1 : 0));
  return { days, from: from.toISOString(), to: to.toISOString(), label: mode === "test" ? `Latest ${days} ${days === "1" ? "day" : "days"} in demo history` : days === "1" ? "Last 24 hours" : `Last ${days} days` };
}

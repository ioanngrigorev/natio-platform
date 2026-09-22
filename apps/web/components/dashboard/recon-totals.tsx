import { cx } from "@/components/ui";
import type { ReconBatch } from "@/lib/types";

export const RECON_STATUSES = ["MATCHED", "MISSING_PROVIDER", "MISSING_NATIO", "AMOUNT_MISMATCH", "STATUS_MISMATCH"] as const;
export type ReconStatus = (typeof RECON_STATUSES)[number];

export const RECON_LABELS: Record<ReconStatus, string> = {
  MATCHED: "Matched",
  MISSING_PROVIDER: "Missing at provider",
  MISSING_NATIO: "Missing at NATIO",
  AMOUNT_MISMATCH: "Amount mismatch",
  STATUS_MISMATCH: "Status mismatch",
};

const TONES: Record<ReconStatus, string> = {
  MATCHED: "text-ok",
  MISSING_PROVIDER: "text-bad",
  MISSING_NATIO: "text-bad",
  AMOUNT_MISMATCH: "text-warn",
  STATUS_MISMATCH: "text-warn",
};

/** Compact inline counts for the batches table. Zero counts are muted. */
export function ReconTotals({ totals }: { totals: ReconBatch["totals"] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
      {RECON_STATUSES.map((s) => (
        <span key={s} className={cx("tabular", totals[s] ? TONES[s] : "text-ink-300")} title={RECON_LABELS[s]}>
          <span className="font-semibold">{totals[s]}</span> {s.toLowerCase().replace(/_/g, " ")}
        </span>
      ))}
    </div>
  );
}

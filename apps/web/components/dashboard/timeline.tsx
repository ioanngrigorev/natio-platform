import { formatDateTimeFull } from "@/lib/format";
import type { TimelineEvent } from "@/lib/types";
import { cx } from "@/components/ui";

const TONES: Record<string, string> = {
  "payment.successful": "bg-ok",
  "payment.captured": "bg-ok",
  "payment.authorized": "bg-info",
  "refund.successful": "bg-ok",
  "payment.failed": "bg-bad",
  "refund.failed": "bg-bad",
  "provider.error": "bg-bad",
  "provider.timeout": "bg-warn",
  "provider.unavailable": "bg-bad",
  "provider.declined": "bg-bad",
  "failover.initiated": "bg-warn",
  "risk.review": "bg-warn",
  "sync.scheduled": "bg-warn",
  "payment.cancelled": "bg-ink-400",
  "retry.stopped": "bg-ink-400",
};

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <div className="text-[13px] text-ink-500">No events yet.</div>;
  const start = new Date(events[0]!.created_at).getTime();
  return (
    <ol className="relative ml-2 border-l border-ink-200">
      {events.map((e) => {
        const tone = TONES[e.type] ?? (e.type.startsWith("webhook") ? "bg-brand-500" : "bg-ink-300");
        const offset = new Date(e.created_at).getTime() - start;
        return (
          <li key={e.id} className="relative mb-4 pl-5 last:mb-0">
            <span className={cx("absolute -left-[5px] top-[6px] h-[9px] w-[9px] rounded-full ring-2 ring-white", tone)} />
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-[13px] font-medium text-ink-900">{e.title}</span>
              <span className="mono text-ink-400">+{offset < 1000 ? `${offset} ms` : `${(offset / 1000).toFixed(2)} s`}</span>
            </div>
            {e.description ? <div className="mt-0.5 text-[12.5px] text-ink-600">{e.description}</div> : null}
            <div className="mt-0.5 text-[11px] text-ink-400">
              {formatDateTimeFull(e.created_at)} · <span className="mono">{e.type}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

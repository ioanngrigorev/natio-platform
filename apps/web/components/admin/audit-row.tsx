"use client";

import { useState } from "react";
import { Mono, Tag, cx } from "@/components/ui";
import { formatDateTimeFull, shortId, titleCase } from "@/lib/format";
import type { AuditEntry } from "@/lib/types";

const ACTOR_TONE: Record<string, "brand" | "ok" | "warn" | "neutral"> = { admin_user: "brand", merchant_user: "neutral", api_key: "ok", system: "warn" };

function json(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value, null, 2);
}

/** One audit row; clicking it reveals the before/after snapshots side by side. */
export function AuditRow({ entry, merchantName }: { entry: AuditEntry; merchantName?: string }) {
  const [open, setOpen] = useState(false);
  const hasDetail = entry.before !== null || entry.after !== null;

  return (
    <>
      <tr className={cx("cursor-pointer", open && "bg-ink-50")} onClick={() => setOpen((o) => !o)}>
        <td className="text-ink-500">{formatDateTimeFull(entry.created_at)}</td>
        <td>
          <Tag tone={ACTOR_TONE[entry.actor_type] ?? "neutral"}>{entry.actor_type.replace(/_/g, " ")}</Tag>
          <div className="text-[11px] text-ink-500">{entry.actor_label ?? (entry.actor_id ? shortId(entry.actor_id, 10) : "—")}</div>
        </td>
        <td>
          <Mono>{entry.action}</Mono>
          {entry.merchant_id ? <div className="text-[11px] text-ink-500">{merchantName ?? shortId(entry.merchant_id, 10)}</div> : null}
        </td>
        <td>
          {entry.entity_type ? titleCase(entry.entity_type) : <span className="text-ink-400">—</span>}
          {entry.entity_id ? (
            <div className="text-[11px] text-ink-500">
              <Mono className="text-[11px]">{shortId(entry.entity_id, 12)}</Mono>
            </div>
          ) : null}
        </td>
        <td className="text-ink-600">{entry.ip ?? "—"}</td>
        <td className="text-ink-500">{entry.request_id ? <Mono className="text-[11px]">{entry.request_id}</Mono> : "—"}</td>
        <td className="text-right text-[11px] text-ink-400">{hasDetail ? (open ? "Hide" : "Details") : ""}</td>
      </tr>
      {open ? (
        <tr className="bg-ink-50">
          <td colSpan={7} className="!whitespace-normal">
            <div className="grid grid-cols-1 gap-3 py-1 lg:grid-cols-2">
              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">Before</div>
                <pre className="mono max-h-[320px] overflow-auto whitespace-pre-wrap break-all rounded border border-ink-200 bg-white p-2 text-ink-700">{json(entry.before)}</pre>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">After</div>
                <pre className="mono max-h-[320px] overflow-auto whitespace-pre-wrap break-all rounded border border-ink-200 bg-white p-2 text-ink-700">{json(entry.after)}</pre>
              </div>
            </div>
            <div className="pb-1 text-[11px] text-ink-400">
              Entry <Mono className="text-[11px]">{entry.id}</Mono>
              {entry.entity_id ? (
                <>
                  {" · "}entity <Mono className="text-[11px]">{entry.entity_id}</Mono>
                </>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

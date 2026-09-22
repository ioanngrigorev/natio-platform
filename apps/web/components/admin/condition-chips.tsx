import { Mono, Tag, cx } from "@/components/ui";

export interface Condition {
  field: string;
  op: string;
  value: string | number | Array<string | number>;
}

const OP_LABEL: Record<string, string> = { eq: "=", neq: "≠", in: "in", not_in: "not in", gt: ">", gte: "≥", lt: "<", lte: "≤", between: "between" };

export function conditionText(c: Condition): string {
  const v = Array.isArray(c.value) ? (c.op === "between" ? c.value.join(" and ") : `[${c.value.join(", ")}]`) : String(c.value);
  return `${c.field} ${OP_LABEL[c.op] ?? c.op} ${v}`;
}

/** Renders rule conditions as compact chips like `country = VN`, `amount > 500000`. */
export function ConditionChips({ conditions, emptyLabel = "always", className }: { conditions: Condition[]; emptyLabel?: string; className?: string }) {
  if (!conditions.length) return <span className="text-[12px] text-ink-400">{emptyLabel}</span>;
  return (
    <span className={cx("flex flex-wrap gap-1", className)}>
      {conditions.map((c, i) => (
        <Tag key={`${c.field}-${i}`}>
          <Mono className="text-[11px]">{conditionText(c)}</Mono>
        </Tag>
      ))}
    </span>
  );
}

const LEVEL_TONE: Record<string, "ok" | "warn" | "bad" | "neutral"> = { info: "neutral", warning: "warn", error: "bad" };

export function LevelTag({ level }: { level: string }) {
  return <Tag tone={LEVEL_TONE[level] ?? "neutral"}>{level}</Tag>;
}

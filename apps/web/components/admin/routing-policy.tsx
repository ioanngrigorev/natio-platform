"use client";
import { Field } from "@/components/ui";
import { PROFILES, type Policy } from "./strategy-types";
export function RoutingPolicyEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: Policy;
  onChange: (p: Policy) => void;
  disabled?: boolean;
}) {
  const set = (key: keyof Policy, v: unknown) =>
    onChange({ ...value, [key]: v });
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {PROFILES.map((p) => (
          <button
            type="button"
            key={p.id}
            aria-pressed={(value.profile ?? "balanced") === p.id}
            className={`rounded-xl border p-4 text-left transition-colors ${(value.profile ?? "balanced") === p.id ? "border-brand-500 bg-brand-50" : "border-ink-200"}`}
            onClick={() => set("profile", p.id)}
          >
            <div className="font-medium text-brand-600">{p.title}</div>
            <p className="mt-1 text-xs text-ink-500">{p.text}</p>
            <p className="mt-2 text-[10px] text-ink-400">{p.weights}</p>
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["maxAttempts", "Maximum attempts", 2, 1, 5],
            ["maxElapsedMs", "Cascade time budget (ms)", 30000, 1000, 120000],
            ["minSamples", "Minimum health sample", 20, 5, 10000],
          ] as const
        ).map(([k, l, d, min, max]) => (
          <Field key={k} label={l} htmlFor={`policy-${k}`}>
            <input
              id={`policy-${k}`}
              className="input"
              type="number"
              min={min}
              max={max}
              value={value[k] ?? d}
              onChange={(e) => set(k, Number(e.target.value))}
            />
          </Field>
        ))}
        {(
          [
            ["minApprovalRate", "Minimum approval %"],
            ["minUptime", "Minimum uptime %"],
            ["maxLatencyMs", "Maximum latency ms"],
          ] as const
        ).map(([k, l]) => (
          <Field key={k} label={l} htmlFor={`policy-${k}`}>
            <input
              id={`policy-${k}`}
              className="input"
              type="number"
              min={0}
              max={k === "maxLatencyMs" ? 120000 : 100}
              step={k === "maxLatencyMs" ? 1 : 0.1}
              placeholder="No threshold"
              value={
                value[k] == null
                  ? ""
                  : (value[k]! * (k === "maxLatencyMs" ? 1 : 100)).toFixed(
                      k === "maxLatencyMs" ? 0 : 1,
                    )
              }
              onChange={(e) =>
                set(
                  k,
                  e.target.value === ""
                    ? undefined
                    : Number(e.target.value) / (k === "maxLatencyMs" ? 1 : 100),
                )
              }
            />
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        {(
          [
            [
              "retryOnSoftDecline",
              "Allow eligible issuer-unavailable cascade",
              true,
            ],
            [
              "retryOnTimeout",
              "Allow confirmed no-charge timeout cascade",
              true,
            ],
            [
              "requireHealthData",
              "Exclude PSPs without sufficient recent data",
              false,
            ],
            ["blockNegativeMargin", "Exclude negative-margin routes", false],
          ] as const
        ).map(([k, l, d]) => (
          <label key={k} className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={value[k] ?? d}
              onChange={(e) => set(k, e.target.checked)}
            />
            {l}
          </label>
        ))}
      </div>
      <p className="text-xs text-ink-500">
        Profile weights apply to score strategy. Ordered and weighted routes
        still enforce health, price and cascade limits. Recent health uses
        completed/indeterminate attempts from the last 24 hours in the selected
        mode; sparse data uses labelled priors unless excluded.
      </p>
    </fieldset>
  );
}

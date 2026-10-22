"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui";

export interface FilterDef {
  name: string;
  label: string;
  type: "text" | "select" | "date";
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
}

/** URL-driven filter bar: submits to the same route with query params (server components re-render). */
export function FilterBar({ filters }: { filters: FilterDef[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(filters.map((f) => [f.name, params.get(f.name) ?? ""])));
  const query = params.toString();
  const filterNames = filters.map(f => f.name).join(",");
  useEffect(() => {
    const current = new URLSearchParams(query);
    setValues(Object.fromEntries(filterNames.split(",").map(name => [name, current.get(name) ?? ""])));
  }, [query, filterNames]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(values)) if (v) u.set(k, v);
    router.push(`${pathname}${u.toString() ? `?${u.toString()}` : ""}`);
  }

  function reset() {
    setValues(Object.fromEntries(filters.map((f) => [f.name, ""])));
    router.push(pathname);
  }

  return (
    <form onSubmit={submit} className="mb-4 flex flex-wrap items-end gap-2">
      {filters.map((f) => (
        <div key={f.name} className="min-w-[140px]">
          <label className="label" htmlFor={`f-${f.name}`}>
            {f.label}
          </label>
          {f.type === "select" ? (
            <select id={`f-${f.name}`} className="input" value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
              <option value="">All</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input id={`f-${f.name}`} type={f.type === "date" ? "datetime-local" : "text"} className="input" placeholder={f.placeholder} value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
          )}
        </div>
      ))}
      <Button type="submit" variant="primary">
        Apply
      </Button>
      <Button type="button" variant="ghost" onClick={reset}>
        Reset
      </Button>
    </form>
  );
}

/** Single query-param select that preserves the other params (e.g. currency next to a PeriodPicker). */
export function QuerySelect({ name, label, current, options, allLabel = "All" }: { name: string; label: string; current?: string; options: Array<{ value: string; label: string }>; allLabel?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <label className="flex items-center gap-2 text-[12px] text-ink-500">
      <span>{label}</span>
      <select
        className="input !w-auto !py-[3px] text-[12px]"
        value={current ?? ""}
        onChange={(e) => {
          const u = new URLSearchParams(params.toString());
          if (e.target.value) u.set(name, e.target.value);
          else u.delete(name);
          router.push(`${pathname}${u.toString() ? `?${u.toString()}` : ""}`);
        }}
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PeriodPicker({ current, demo = false }: { current: string; demo?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const options = [
    ...(demo ? [{ value: "2025", label: "2025" }] : []),
    { value: "1", label: demo ? "1d" : "24h" },
    { value: "7", label: "7d" },
    { value: "30", label: "30d" },
    { value: "90", label: "90d" },
  ];
  return (
    <div className="flex items-center rounded-md border border-ink-200 p-[2px] text-[12px]" role="group" aria-label={demo ? "Period within demo year 2025" : "Reporting period"}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={current === o.value}
          onClick={() => {
            const u = new URLSearchParams(params.toString());
            u.set("days", o.value);
            u.delete("page");
            router.push(`${pathname}?${u.toString()}`);
          }}
          className={"rounded px-2.5 py-[3px] font-medium " + (current === o.value ? "bg-brand-600 text-white" : "text-ink-500 hover:text-ink-900")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

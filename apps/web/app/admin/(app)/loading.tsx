export default function Loading() {
  return <div role="status" aria-live="polite" className="space-y-5 py-4"><div className="flex items-center gap-3 text-brand-600"><span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-r-transparent"/>Loading…</div><div className="h-24 animate-pulse rounded-lg bg-ink-100"/><div className="h-72 animate-pulse rounded-lg bg-ink-50"/></div>;
}

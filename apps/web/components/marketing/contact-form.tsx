"use client";

import { useState, type ReactNode, type FormEvent } from "react";
import { ApiRequestError, apiClient } from "@/lib/api";
import { cx } from "@/components/ui";

/**
 * Dark-surface field wrapper. The shared `Field` / `.label` / `.help` in the UI kit
 * are light-theme and belong to the dashboard; the public site uses `.input-dark`.
 */
function DarkField({ label, help, error, htmlFor, children }: { label: string; help?: ReactNode; error?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div>
      <label className="label-dark" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-5 text-rose-300">
          <span aria-hidden className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-rose-300" />
          <span>{error}</span>
        </p>
      ) : help ? (
        <p className="help-dark">{help}</p>
      ) : null}
    </div>
  );
}

const FIELD_INVALID = "!border-rose-400/60 focus:!border-rose-300 focus:!ring-rose-400/25";

interface ContactPayload {
  name: string;
  email: string;
  company: string;
  message: string;
  source: "website";
}

type FieldErrors = Partial<Record<"name" | "email" | "company" | "message", string>>;

const EMPTY: ContactPayload = { name: "", email: "", company: "", message: "", source: "website" };

export function ContactForm({ topic }: { topic?: string }) {
  const [values, setValues] = useState<ContactPayload>(() => ({ ...EMPTY, message: topic ? `${topic}\n\n` : "" }));
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function set<K extends keyof ContactPayload>(key: K, value: ContactPayload[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    if (key in fieldErrors) setFieldErrors((f) => ({ ...f, [key]: undefined }));
  }

  function validate(): FieldErrors {
    const errs: FieldErrors = {};
    if (values.name.trim().length < 2) errs.name = "Please enter your name (at least 2 characters).";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) errs.email = "Please enter a valid email address.";
    if (values.message.trim().length < 10) errs.message = "Please tell us a little more (at least 10 characters).";
    if (values.company.length > 120) errs.company = "Company name is too long (max 120 characters).";
    return errs;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    setSubmitting(true);
    try {
      const body: Record<string, string> = { name: values.name.trim(), email: values.email.trim(), message: values.message.trim(), source: "website" };
      if (values.company.trim()) body.company = values.company.trim();
      const res = await apiClient<{ id: string; ok: boolean }>("/public/contact", { method: "POST", body });
      setDone({ id: res.id });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.status === 422 && Array.isArray(err.details)) {
          const next: FieldErrors = {};
          for (const d of err.details as Array<{ path?: string; message?: string }>) {
            const key = String(d.path ?? "").split(".").pop() as keyof FieldErrors;
            if (key && ["name", "email", "company", "message"].includes(key)) next[key] = d.message ?? "Invalid value";
          }
          setFieldErrors(next);
          setError(Object.keys(next).length ? "Please correct the highlighted fields." : err.message);
        } else if (err.status === 429) {
          setError("Too many requests from this network. Please wait a minute and try again.");
        } else {
          setError(`${err.message}${err.requestId ? ` (request ${err.requestId})` : ""}`);
        }
      } else {
        setError("We could not reach the server. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-night-700 bg-night-900 p-7">
        <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-lime">
          <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-lime" aria-hidden />
          <span>Message received</span>
        </div>
        <h2 className="mt-4 text-[24px] font-medium leading-[1.15] tracking-[-0.022em] text-mist-50">Thank you, {values.name.trim()}.</h2>
        <p className="mt-3 text-[15px] leading-[1.7] text-mist-400">
          Your request has been recorded and a member of the NATIO team will reply to <span className="font-medium text-mist-50">{values.email.trim()}</span>.
        </p>
        <p className="mt-5 border-t border-night-700 pt-4 font-mono text-[11.5px] text-mist-400">
          <span className="text-mist-600">reference</span> {done.id}
        </p>
        <div className="mt-6">
          <button
            type="button"
            onClick={() => {
              setDone(null);
              setValues({ ...EMPTY });
            }}
            className="inline-flex h-10 items-center rounded-full border border-night-600 px-5 text-[14px] font-medium text-mist-200 transition-colors hover:border-mist-400 hover:text-mist-50"
          >
            Send another message
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="rounded-2xl border border-night-700 bg-night-900 p-6 md:p-7">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <DarkField label="Name" htmlFor="contact-name" error={fieldErrors.name}>
          <input
            id="contact-name"
            name="name"
            className={cx("input-dark", fieldErrors.name && FIELD_INVALID)}
            autoComplete="name"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            maxLength={120}
            required
            aria-invalid={Boolean(fieldErrors.name)}
          />
        </DarkField>
        <DarkField label="Work email" htmlFor="contact-email" error={fieldErrors.email}>
          <input
            id="contact-email"
            name="email"
            type="email"
            className={cx("input-dark", fieldErrors.email && FIELD_INVALID)}
            autoComplete="email"
            value={values.email}
            onChange={(e) => set("email", e.target.value)}
            maxLength={254}
            required
            aria-invalid={Boolean(fieldErrors.email)}
          />
        </DarkField>
      </div>
      <div className="mt-5">
        <DarkField label="Company (optional)" htmlFor="contact-company" error={fieldErrors.company}>
          <input
            id="contact-company"
            name="company"
            className={cx("input-dark", fieldErrors.company && FIELD_INVALID)}
            autoComplete="organization"
            value={values.company}
            onChange={(e) => set("company", e.target.value)}
            maxLength={120}
            aria-invalid={Boolean(fieldErrors.company)}
          />
        </DarkField>
      </div>
      <div className="mt-5">
        <DarkField
          label="Message"
          htmlFor="contact-message"
          error={fieldErrors.message}
          help="Markets, payment methods, volumes and providers you already work with help us prepare a useful answer."
        >
          <textarea
            id="contact-message"
            name="message"
            className={cx("input-dark min-h-[150px] resize-y", fieldErrors.message && FIELD_INVALID)}
            value={values.message}
            onChange={(e) => set("message", e.target.value)}
            maxLength={4000}
            required
            aria-invalid={Boolean(fieldErrors.message)}
          />
        </DarkField>
      </div>
      {error ? (
        <div role="alert" className="mt-5 rounded-lg border border-l-2 border-night-700 border-l-rose-300 bg-night-850 px-4 py-3">
          <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-rose-300">
            <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-rose-300" aria-hidden />
            <span>Not sent</span>
          </div>
          <p className="mt-1.5 text-[13.5px] leading-6 text-mist-200">{error}</p>
        </div>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-night-700 pt-5">
        <p className="text-[12.5px] leading-5 text-mist-400">We use your details only to reply to this request.</p>
        <button
          type="submit"
          disabled={submitting}
          className="group inline-flex h-10 items-center gap-2 rounded-full bg-mist-50 pl-5 pr-4 text-[14px] font-medium text-night-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-night-950/40 border-t-night-950" aria-hidden /> : null}
          {submitting ? "Sending…" : "Send message"}
          {submitting ? null : (
            <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
              →
            </span>
          )}
        </button>
      </div>
    </form>
  );
}

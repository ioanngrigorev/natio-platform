"use client";
import {LanguagePicker,useI18n} from '@/lib/i18n/provider';


import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiClient, ApiRequestError } from "@/lib/api";
import { Alert, Button, Field } from "@/components/ui";

export function LoginForm({ kind }: { kind: "merchant" | "admin" }) {
 const {t:translateUi,locale:uiLocale}=useI18n();

  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const base = kind === "admin" ? "/admin" : "/dashboard";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiClient(`${base}/auth/login`, { body: { email, password } });
      if (kind === "admin") document.cookie = "natio_mode=test; path=/; max-age=31536000; samesite=lax";
      router.push(base);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not sign in");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-[18px] font-semibold tracking-tight">{translateUi(kind === "admin" ? translateUi("NATIO internal admin") : translateUi("Sign in to your dashboard"))}</h1>
        <p className="mt-1 text-[13px] text-ink-500">{translateUi(kind === "admin" ? translateUi("Restricted to NATIO operations staff.") : translateUi("Payment operations, routing insight and developer tools."))}</p>
      </div>
      <div className="flex justify-end"><LanguagePicker compact/></div>
      {translateUi(error ? <Alert tone="bad">{translateUi(error)}</Alert> : null)}
      <Field label={translateUi("Email")} htmlFor="email">
        <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label={translateUi("Password")} htmlFor="password">
        <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={loading}>{translateUi("Sign in")}</Button>
      {translateUi(kind === "merchant" ? (
        <p className="text-center text-[12.5px] text-ink-500">{translateUi("New to NATIO?")}{translateUi(" ")}
          <Link href="/dashboard/register" className="font-medium text-brand-600 hover:underline">{translateUi("Create a merchant account")}</Link>
        </p>
      ) : null)}
    </form>
  );
}

export function RegisterForm() {
 const {t:translateUi,locale:uiLocale}=useI18n();

  const router = useRouter();
  const [form, setForm] = useState({ company_name: "", country: "", website: "", name: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, string> = { company_name: form.company_name, name: form.name, email: form.email, password: form.password };
      if (form.country) body.country = form.country.toUpperCase();
      if (form.website) body.website = form.website;
      await apiClient("/dashboard/auth/register", { body });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-[18px] font-semibold tracking-tight">{translateUi("Create a merchant account")}</h1>
        <p className="mt-1 text-[13px] text-ink-500">{translateUi("Start in the sandbox immediately. Live processing is enabled after KYB review.")}</p>
      </div>
      {translateUi(error ? <Alert tone="bad">{translateUi(error)}</Alert> : null)}
      <Field label={translateUi("Company name")} htmlFor="company">
        <input id="company" className="input" required minLength={2} value={form.company_name} onChange={set("company_name")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={translateUi("Country (ISO-2)")} htmlFor="country">
          <input id="country" className="input" maxLength={2} placeholder={translateUi("GB")} value={form.country} onChange={set("country")} />
        </Field>
        <Field label={translateUi("Website")} htmlFor="website">
          <input id="website" className="input" type="url" placeholder={translateUi("https://")} value={form.website} onChange={set("website")} />
        </Field>
      </div>
      <Field label={translateUi("Your name")} htmlFor="name">
        <input id="name" className="input" required minLength={2} value={form.name} onChange={set("name")} />
      </Field>
      <Field label={translateUi("Work email")} htmlFor="email">
        <input id="email" className="input" type="email" required value={form.email} onChange={set("email")} />
      </Field>
      <Field label={translateUi("Password")} htmlFor="password" help={translateUi("At least 10 characters with mixed case or digits.")}>
        <input id="password" className="input" type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={set("password")} />
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={loading}>{translateUi("Create account")}</Button>
      <p className="text-center text-[12.5px] text-ink-500">{translateUi("Already registered?")}{translateUi(" ")}
        <Link href="/dashboard/login" className="font-medium text-brand-600 hover:underline">{translateUi("Sign in")}</Link>
      </p>
    </form>
  );
}

export function AcceptInviteForm() {
 const {t:translateUi,locale:uiLocale}=useI18n();

  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiClient("/dashboard/auth/accept-invite", { body: { token, password } });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not accept invite");
    } finally {
      setLoading(false);
    }
  }

  if (!token) return <Alert tone="bad">{translateUi("This invite link is missing its token.")}</Alert>;
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-[18px] font-semibold tracking-tight">{translateUi("Join your team on NATIO")}</h1>
        <p className="mt-1 text-[13px] text-ink-500">{translateUi("Choose a password to activate your account.")}</p>
      </div>
      {translateUi(error ? <Alert tone="bad">{translateUi(error)}</Alert> : null)}
      <Field label={translateUi("Password")} htmlFor="password" help={translateUi("At least 10 characters with mixed case or digits.")}>
        <input id="password" className="input" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={loading}>{translateUi("Activate account")}</Button>
    </form>
  );
}

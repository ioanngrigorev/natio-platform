"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiClient, ApiRequestError } from "@/lib/api";
import { Alert, Button, Field } from "@/components/ui";

export function LoginForm({ kind }: { kind: "merchant" | "admin" }) {
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
        <h1 className="text-[18px] font-semibold tracking-tight">{kind === "admin" ? "NATIO internal admin" : "Sign in to your dashboard"}</h1>
        <p className="mt-1 text-[13px] text-ink-500">{kind === "admin" ? "Restricted to NATIO operations staff." : "Payment operations, routing insight and developer tools."}</p>
      </div>
      {error ? <Alert tone="bad">{error}</Alert> : null}
      <Field label="Email" htmlFor="email">
        <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" htmlFor="password">
        <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={loading}>
        Sign in
      </Button>
      {kind === "merchant" ? (
        <p className="text-center text-[12.5px] text-ink-500">
          New to NATIO?{" "}
          <Link href="/dashboard/register" className="font-medium text-brand-600 hover:underline">
            Create a merchant account
          </Link>
        </p>
      ) : null}
    </form>
  );
}

export function RegisterForm() {
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
        <h1 className="text-[18px] font-semibold tracking-tight">Create a merchant account</h1>
        <p className="mt-1 text-[13px] text-ink-500">Start in the sandbox immediately. Live processing is enabled after KYB review.</p>
      </div>
      {error ? <Alert tone="bad">{error}</Alert> : null}
      <Field label="Company name" htmlFor="company">
        <input id="company" className="input" required minLength={2} value={form.company_name} onChange={set("company_name")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Country (ISO-2)" htmlFor="country">
          <input id="country" className="input" maxLength={2} placeholder="GB" value={form.country} onChange={set("country")} />
        </Field>
        <Field label="Website" htmlFor="website">
          <input id="website" className="input" type="url" placeholder="https://" value={form.website} onChange={set("website")} />
        </Field>
      </div>
      <Field label="Your name" htmlFor="name">
        <input id="name" className="input" required minLength={2} value={form.name} onChange={set("name")} />
      </Field>
      <Field label="Work email" htmlFor="email">
        <input id="email" className="input" type="email" required value={form.email} onChange={set("email")} />
      </Field>
      <Field label="Password" htmlFor="password" help="At least 10 characters with mixed case or digits.">
        <input id="password" className="input" type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={set("password")} />
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={loading}>
        Create account
      </Button>
      <p className="text-center text-[12.5px] text-ink-500">
        Already registered?{" "}
        <Link href="/dashboard/login" className="font-medium text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function AcceptInviteForm() {
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

  if (!token) return <Alert tone="bad">This invite link is missing its token.</Alert>;
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-[18px] font-semibold tracking-tight">Join your team on NATIO</h1>
        <p className="mt-1 text-[13px] text-ink-500">Choose a password to activate your account.</p>
      </div>
      {error ? <Alert tone="bad">{error}</Alert> : null}
      <Field label="Password" htmlFor="password" help="At least 10 characters with mixed case or digits.">
        <input id="password" className="input" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={loading}>
        Activate account
      </Button>
    </form>
  );
}

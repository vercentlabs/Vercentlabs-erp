"use client";

// Sign in (MVP 44): work email, then the 6-digit code from that email — the same code rules as signup. "Sign in with password instead"
// keeps passwords (and Google / Microsoft, for people who linked them) working for those who have them.
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Button, PasswordField, TextField } from "@vercentlabs/design-system";

import { CodeInput } from "@/shared/ui/CodeInput";
import { SocialSignInButtons } from "@/shared/ui/SocialSignInButtons";

// What a Google / Microsoft sign-in that came back says (the callback's ?error= code).
const SOCIAL_ERRORS: Record<string, string> = {
  AUTH_SOCIAL_NOT_LINKED: "No account is linked to that Google or Microsoft account. Sign in with your email, then connect it in your profile.",
  AUTH_SOCIAL_CANCELLED: "The sign-in was cancelled.",
  AUTH_SOCIAL_STATE_INVALID: "That sign-in link expired. Try again.",
  AUTH_ACCOUNT_INACTIVE: "This account is not active.",
};

async function post(path: string, body: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string; next?: string; retryAfterSeconds?: number };
  if (!response.ok || payload.ok === false) throw Object.assign(new Error(payload.message || "Sign in failed. Try again."), { retryAfterSeconds: payload.retryAfterSeconds });
  return payload;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const socialError = params.get("error");
  const [mode, setMode] = useState<"email" | "code" | "password">(socialError ? "password" : "email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendIn, setResendIn] = useState(30);
  useEffect(() => {
    if (mode !== "code" || resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [mode, resendIn]);

  const done = (next = "/start") => { router.push(next); router.refresh(); };
  async function requestCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setError("Enter a valid email, like ravi@sharmatextiles.in"); return; }
    setError(null);
    setSubmitting(true);
    try {
      await post("/api/auth/code/request", { email });
      setResendIn(30);
      setMode("code");
    } catch (caught) {
      setError((caught as Error).message);
      const wait = (caught as { retryAfterSeconds?: number }).retryAfterSeconds;
      if (wait) setResendIn(wait);
    } finally {
      setSubmitting(false);
    }
  }
  async function verify(code: string) {
    setError(null);
    setSubmitting(true);
    try {
      done((await post("/api/auth/code/verify", { email, code })).next);
    } catch (caught) {
      setError((caught as Error).message);
      setSubmitting(false);
    }
  }
  async function signInWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await post("/api/auth/login", { email, password });
      done();
    } catch (caught) {
      setError((caught as Error).message);
      setSubmitting(false);
    }
  }

  if (mode === "code") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">{`If ${email.trim().toLowerCase()} has a workspace, we've sent a 6-digit code to it. Enter it below.`}</p>
        <CodeInput disabled={submitting} onComplete={verify} resetKey={error} />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <p className="text-center text-sm text-text-secondary">
          Didn&apos;t get it?{" "}
          {resendIn > 0 ? <span className="text-text-muted">{`Resend code in ${resendIn}s`}</span> : <button type="button" className="font-medium text-brand hover:underline" onClick={() => void requestCode()}>Resend code</button>}
          {" · "}<button type="button" className="font-medium text-brand hover:underline" onClick={() => { setError(null); setMode("email"); }}>Use another email</button>
        </p>
      </div>
    );
  }
  if (mode === "password") {
    return (
      <form className="flex flex-col gap-4" onSubmit={signInWithPassword} noValidate>
        <SocialSignInButtons />
        {socialError && !error ? <p role="alert" className="text-sm text-danger">{SOCIAL_ERRORS[socialError] ?? "Signing in with that account did not work. Try again or use your email."}</p> : null}
        <TextField label="Work email" type="email" autoComplete="email" isRequired value={email} onChange={setEmail} />
        <PasswordField label="Password" autoComplete="current-password" isRequired value={password} onChange={setPassword} />
        <Link href="/forgot-password" className="self-end text-sm font-medium text-brand hover:underline">Forgot password?</Link>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" variant="primary" size="standard" isLoading={submitting} className="mt-2">Sign in</Button>
        <button type="button" className="text-center text-sm font-medium text-brand hover:underline" onClick={() => { setError(null); setMode("email"); }}>Sign in with an email code instead</button>
      </form>
    );
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={requestCode} noValidate>
      <TextField label="Work email" type="email" autoComplete="email" isRequired value={email} onChange={setEmail} isInvalid={Boolean(error)} errorMessage={error ?? undefined} />
      <Button type="submit" variant="primary" size="standard" isLoading={submitting}>Continue</Button>
      <button type="button" className="text-center text-sm font-medium text-brand hover:underline" onClick={() => { setError(null); setMode("password"); }}>Sign in with password instead</button>
      <p className="text-center text-sm text-text-secondary">New to Vercentlabs? <Link href="/register" className="font-medium text-brand hover:underline">Set up your workspace</Link></p>
    </form>
  );
}

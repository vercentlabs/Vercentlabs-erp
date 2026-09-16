"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@vercentlabs/design-system";

type Status = "checking" | "verified" | "error" | "pending";

export function VerifyEmailClient({ token, email }: { token?: string; email?: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(token ? "checking" : "pending");
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
        if (cancelled) return;
        if (!response.ok || payload.ok === false) {
          setStatus("error");
          setError(payload.message || "This verification link may be invalid or expired.");
          return;
        }
        setStatus("verified");
        setTimeout(() => {
          router.push("/");
          router.refresh();
        }, 1500);
      } catch {
        if (!cancelled) {
          setStatus("error");
          setError("Something went wrong. Check your connection and try again.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  async function handleResend() {
    setResending(true);
    setResendError(null);
    try {
      const response = await fetch("/api/auth/resend-verification", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!response.ok || payload.ok === false) {
        setResendError(payload.message || "Could not resend the verification email. Try again shortly.");
        return;
      }
      setResent(true);
    } catch {
      setResendError("Something went wrong. Check your connection and try again.");
    } finally {
      setResending(false);
    }
  }

  if (status === "checking") {
    return <p className="text-sm text-text-secondary">Verifying your email…</p>;
  }

  if (status === "verified") {
    return <p className="text-sm text-text">Your email is verified. Taking you to your workspace…</p>;
  }

  if (status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
        <Button type="button" variant="primary" size="standard" isLoading={resending} onPress={handleResend}>
          Send a new verification email
        </Button>
        {resendError ? (
          <p role="alert" className="text-sm text-danger">
            {resendError}
          </p>
        ) : null}
        {resent ? <p className="text-sm text-success">A new verification email is on its way.</p> : null}
        <Link href="/login" className="text-center text-sm font-medium text-brand hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text">
        We sent a verification link to {email ? <strong>{email}</strong> : "your email address"}. Click it to activate your
        account.
      </p>
      <Button type="button" variant="secondary" size="standard" isLoading={resending} onPress={handleResend}>
        Resend verification email
      </Button>
      {resendError ? (
        <p role="alert" className="text-sm text-danger">
          {resendError}
        </p>
      ) : null}
      {resent ? <p className="text-sm text-success">A new verification email is on its way.</p> : null}
      <Link href="/login" className="text-center text-sm font-medium text-brand hover:underline">
        Sign in with a different account
      </Link>
    </div>
  );
}

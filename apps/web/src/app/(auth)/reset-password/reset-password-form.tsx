"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button, TextField } from "@vercentlabs/design-system";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!response.ok || payload.ok === false) {
        setError(payload.message || "This link may be invalid or expired. Request a new one.");
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch {
      setError("Something went wrong. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <p className="text-sm text-text">
        Your password has been reset, and any other signed-in sessions have been signed out. Redirecting you to sign in…
      </p>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <TextField label="New password" type="password" autoComplete="new-password" isRequired value={password} onChange={setPassword} />
      <TextField
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        isRequired
        value={confirmPassword}
        onChange={setConfirmPassword}
      />
      <p className="text-xs text-text-muted">At least 12 characters, including a letter and a number.</p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="standard" isLoading={submitting} className="mt-2">
        Reset password
      </Button>
      <Link href="/login" className="text-center text-sm font-medium text-brand hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}

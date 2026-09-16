"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

import { Button, TextField } from "@vercentlabs/design-system";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!response.ok || payload.ok === false) {
        setError(payload.message || "Something went wrong. Try again.");
        return;
      }
      // Same success message whether or not the email is registered —
      // the API deliberately never discloses that, and the UI must not
      // undo that by branching on a "not found" case of its own.
      setSent(true);
    } catch {
      setError("Something went wrong. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text">
          If an account exists for <strong>{email}</strong>, a password reset link is on its way. The link expires in 2 hours.
        </p>
        <Link href="/login" className="text-sm font-medium text-brand hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <TextField label="Email" type="email" autoComplete="email" isRequired value={email} onChange={setEmail} />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="standard" isLoading={submitting} className="mt-2">
        Send reset link
      </Button>
      <Link href="/login" className="text-center text-sm font-medium text-brand hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}

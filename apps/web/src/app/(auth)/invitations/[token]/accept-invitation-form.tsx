"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button, TextField } from "@vercentlabs/design-system";

export function AcceptInvitationForm({ token, requiresPassword }: { token: string; requiresPassword: boolean }) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (requiresPassword) {
      if (!fullName.trim()) {
        setError("Enter your name.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
    }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/auth/invitations/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requiresPassword ? { fullName, password } : {}),
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!response.ok || payload.ok === false) {
        setError(payload.message || "This invitation could not be accepted.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Something went wrong. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      {requiresPassword ? (
        <>
          <TextField label="Full name" autoComplete="name" isRequired value={fullName} onChange={setFullName} />
          <TextField label="Password" type="password" autoComplete="new-password" isRequired value={password} onChange={setPassword} />
          <TextField
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            isRequired
            value={confirmPassword}
            onChange={setConfirmPassword}
          />
          <p className="text-xs text-text-muted">At least 12 characters, including a letter and a number.</p>
        </>
      ) : (
        <p className="text-sm text-text-secondary">You already have an account — accept with your existing sign-in.</p>
      )}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="standard" isLoading={submitting} className="mt-2">
        Accept invitation
      </Button>
    </form>
  );
}

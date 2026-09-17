"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button, TextField } from "@vercentlabs/design-system";

export function AcceptInvitationForm({
  token,
  hasExistingAccount,
  alreadySignedInAsInvitee,
}: {
  token: string;
  hasExistingAccount: boolean;
  alreadySignedInAsInvitee: boolean;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const requiresPassword = !hasExistingAccount;

  async function submitAcceptance(body: Record<string, unknown>) {
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch(`/api/auth/invitations/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    await submitAcceptance(requiresPassword ? { fullName, password } : {});
  }

  // An invitation link is proof someone can read this mailbox — it is not
  // proof they control this existing account's password. Accepting here
  // is only ever wired to the caller's own already-authenticated session,
  // never to anything typed into this form for an existing account.
  if (hasExistingAccount && !alreadySignedInAsInvitee) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          An account already exists for this email. Sign in to accept this invitation, then return to this page.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Link href="/login">
          <Button type="button" variant="primary" size="standard" className="w-full">
            Sign in
          </Button>
        </Link>
      </div>
    );
  }

  if (hasExistingAccount && alreadySignedInAsInvitee) {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submitAcceptance({});
        }}
      >
        <p className="text-sm text-text-secondary">You&apos;re signed in as this account. Accept to join this organisation.</p>
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

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
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

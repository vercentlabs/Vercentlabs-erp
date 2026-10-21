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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isNewAccount = !hasExistingAccount; // a new account: only the name is asked

  async function submitAcceptance(body: Record<string, unknown>) {
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/auth/invitations/${encodeURIComponent(token)}/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || payload.ok === false) {
        setError(payload.message || "This invitation could not be accepted.");
        return;
      }
      router.push("/start");
      router.refresh();
    } catch {
      setError("Something went wrong. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isNewAccount) {
      if (!fullName.trim()) {
        setError("Enter your name.");
        return;
      }
    }
    await submitAcceptance(isNewAccount ? { fullName } : {});
  }

  // An invitation link is proof someone can read this mailbox — it is not
  // proof they control this existing account's password. Accepting here
  // is only ever wired to the caller's own already-authenticated session,
  // never to anything typed into this form for an existing account.
  if (hasExistingAccount && !alreadySignedInAsInvitee) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          An account already exists for this email. Sign in to accept this
          invitation, then return to this page.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Link href="/login">
          <Button
            type="button"
            variant="primary"
            size="standard"
            className="w-full"
          >
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
        <p className="text-sm text-text-secondary">
          You&apos;re signed in as this account. Accept to join this
          organisation.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          size="standard"
          isLoading={submitting}
          className="mt-2"
        >
          Accept invitation
        </Button>
      </form>
    );
  }

  // A new account: the link already proves the email is theirs, so only a name is asked (no code, no password).
  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <TextField label="Your name" autoComplete="name" isRequired value={fullName} onChange={setFullName} />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="standard" isLoading={submitting} className="mt-2">
        Continue
      </Button>
    </form>
  );
}

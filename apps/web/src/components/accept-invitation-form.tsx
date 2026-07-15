"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import PasswordField from "@/components/password-field";

export default function AcceptInvitationForm({
  token,
  email,
  existingUser,
}: {
  token: string;
  email: string;
  existingUser: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const body = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    );
    body.token = token;
    const response = await fetch("/api/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as {
      ok: boolean;
      message?: string;
      next?: string;
    };
    setMessage(result.message || "Request completed.");
    setPending(false);
    if (result.ok && result.next) {
      router.push(result.next);
      router.refresh();
    }
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      <label>
        Invited email
        <input value={email} disabled />
      </label>
      <label>
        Full name
        <input name="fullName" required minLength={2} maxLength={100} />
      </label>
      <PasswordField
        name="password"
        label={existingUser ? "Existing account password" : "Create password"}
        autoComplete={existingUser ? "current-password" : "new-password"}
        minLength={existingUser ? undefined : 15}
      />
      {!existingUser ? (
        <PasswordField
          name="confirmPassword"
          label="Confirm password"
          autoComplete="new-password"
          minLength={15}
        />
      ) : (
        <input type="hidden" name="confirmPassword" value="existing-account" />
      )}
      {existingUser ? (
        <p className="field-help">
          Use the password for the existing account. The confirmation field is
          not required.
        </p>
      ) : null}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Joining…" : "Accept invitation"}
      </button>
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
    </form>
  );
}

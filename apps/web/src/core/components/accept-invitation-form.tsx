"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import PasswordField from "@/core/components/password-field";
import { requestJson } from "@/shared/http/client-request";
import { MIN_PASSWORD_LENGTH } from "@/core/password-policy";

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
    if (pending) return;

    setPending(true);
    setMessage("");
    const body = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    );
    body.token = token;

    const result = await requestJson<{
      next?: string;
    }>("/api/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setMessage(result.message || "Request completed.");
    setPending(false);
    if (result.ok && result.next) {
      router.replace(result.next);
      router.refresh();
    }
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      <label>
        Invited email
        <input value={email} disabled />
      </label>
      {!existingUser ? (
        <label>
          Full name
          <input
            name="fullName"
            autoComplete="name"
            required
            minLength={2}
            maxLength={100}
          />
        </label>
      ) : null}
      <PasswordField
        name="password"
        label={existingUser ? "Existing account password" : "Create password"}
        autoComplete={existingUser ? "current-password" : "new-password"}
        minLength={existingUser ? undefined : MIN_PASSWORD_LENGTH}
      />
      {!existingUser ? (
        <PasswordField
          name="confirmPassword"
          label="Confirm password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
        />
      ) : (
        <input type="hidden" name="confirmPassword" value="existing-account" />
      )}
      {existingUser ? (
        <p className="field-help">
          Use the password for the existing account. Your saved profile name
          will be kept.
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

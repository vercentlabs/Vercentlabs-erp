"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import PasswordField from "@/core/components/password-field";
import { requestJson } from "@/shared/http/client-request";
import { MIN_PASSWORD_LENGTH } from "@/core/password-policy";

export default function ChangePasswordForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setMessage("");
    const result = await requestJson<{ next?: string }>(
      "/api/auth/change-password",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          Object.fromEntries(new FormData(event.currentTarget).entries()),
        ),
      },
    );

    setMessage(result.message || "Request completed.");
    setPending(false);
    if (result.ok && result.next) {
      router.replace(result.next);
      router.refresh();
    }
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      <PasswordField
        name="currentPassword"
        label="Current password"
        autoComplete="current-password"
      />
      <PasswordField
        name="password"
        label="New password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
      />
      <PasswordField
        name="confirmPassword"
        label="Confirm new password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
      />
      <p className="field-help">
        Changing your password revokes all other sessions.
      </p>
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Changing…" : "Change password"}
      </button>
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
    </form>
  );
}

"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import PasswordField from "@/components/password-field";

export default function ChangePasswordForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const response = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        Object.fromEntries(new FormData(event.currentTarget).entries()),
      ),
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
      <PasswordField
        name="currentPassword"
        label="Current password"
        autoComplete="current-password"
      />
      <PasswordField
        name="password"
        label="New password"
        autoComplete="new-password"
        minLength={15}
      />
      <PasswordField
        name="confirmPassword"
        label="Confirm new password"
        autoComplete="new-password"
        minLength={15}
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

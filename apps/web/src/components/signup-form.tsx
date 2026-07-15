"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import PasswordField from "@/components/password-field";

export default function SignupForm() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [developmentUrl, setDevelopmentUrl] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPending(true);
    setMessage("");
    setDevelopmentUrl("");
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const result = (await response.json()) as {
        ok: boolean;
        message?: string;
        developmentUrl?: string;
      };
      setMessage(result.message || "Request completed.");
      setDevelopmentUrl(result.developmentUrl || "");
      if (result.ok) formElement.reset();
    } catch {
      setMessage("The server could not be reached.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={submit}>
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
      <label>
        Work email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
        />
      </label>
      <PasswordField
        name="password"
        label="Password"
        autoComplete="new-password"
        minLength={15}
      />
      <PasswordField
        name="confirmPassword"
        label="Confirm password"
        autoComplete="new-password"
        minLength={15}
      />
      <p className="field-help">
        Use a unique passphrase of at least 15 characters. Spaces are allowed.
      </p>
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </button>
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
      {developmentUrl ? (
        <a className="development-link" href={developmentUrl}>
          Open the local verification link
        </a>
      ) : null}
      {message ? (
        <Link href="/verify-email">Resend or verify another email</Link>
      ) : null}
    </form>
  );
}

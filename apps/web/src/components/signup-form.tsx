"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import PasswordField from "@/components/password-field";
import { requestJson } from "@/lib/client-request";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

export default function SignupForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPending(true);
    setMessage("");
    const form = new FormData(formElement);
    const result = await requestJson<{
      developmentUrl?: string;
      next?: string;
    }>("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    setMessage(result.message || "Request completed.");
    setPending(false);
    if (result.ok) {
      formElement.reset();
      if (result.next && !result.developmentUrl) {
        router.replace(result.next);
        router.refresh();
      }
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
        minLength={MIN_PASSWORD_LENGTH}
      />
      <PasswordField
        name="confirmPassword"
        label="Confirm password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
      />
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </button>
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
      {message ? (
        <Link href="/verify-email">Resend or verify another email</Link>
      ) : null}
    </form>
  );
}

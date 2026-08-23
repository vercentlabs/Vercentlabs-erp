"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import PasswordField from "@/core/components/password-field";
import { requestJson } from "@/shared/http/client-request";
import { MIN_PASSWORD_LENGTH } from "@/core/password-policy";

type Mode = "login" | "forgot" | "reset" | "verify";

export default function AuthForm({
  mode,
  token = "",
}: {
  mode: Mode;
  token?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [developmentUrl, setDevelopmentUrl] = useState("");

  const endpoint =
    mode === "login"
      ? "/api/auth/login"
      : mode === "forgot"
        ? "/api/auth/forgot-password"
        : mode === "reset"
          ? "/api/auth/reset-password"
          : "/api/auth/verify-email";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setDevelopmentUrl("");
    const body = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    );
    if (token) body.token = token;
    const result = await requestJson<{
      next?: string;
      developmentUrl?: string;
    }>(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setMessage(result.message || "Request completed.");
    setDevelopmentUrl(result.developmentUrl || "");
    setPending(false);
    if (result.ok && result.next) {
      router.replace(result.next);
      router.refresh();
    }
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      {mode === "login" || mode === "forgot" ? (
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
      ) : null}
      {mode === "login" ? (
        <PasswordField
          name="password"
          label="Password"
          autoComplete="current-password"
        />
      ) : null}
      {mode === "reset" ? (
        <>
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
        </>
      ) : null}
      {mode === "login" ? (
        <div className="form-row between">
          <span className="field-help">Secure database-backed session</span>
          <Link href="/forgot-password">Forgot password?</Link>
        </div>
      ) : null}
      <button
        className="primary-button"
        type="submit"
        disabled={pending || (mode === "verify" && !token)}
      >
        {pending
          ? "Please wait…"
          : mode === "login"
            ? "Sign in"
            : mode === "forgot"
              ? "Send reset instructions"
              : mode === "reset"
                ? "Change password"
                : "Verify email"}
      </button>
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
      {developmentUrl ? (
        <a className="development-link" href={developmentUrl}>
          Open the local continuation link
        </a>
      ) : null}
    </form>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import PasswordField from "@/components/password-field";

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
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as {
        ok: boolean;
        message?: string;
        next?: string;
        developmentUrl?: string;
      };
      setMessage(result.message || "Request completed.");
      setDevelopmentUrl(result.developmentUrl || "");
      if (result.ok && result.next) {
        router.push(result.next);
        router.refresh();
      }
    } catch {
      setMessage("The server could not be reached.");
    } finally {
      setPending(false);
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
            minLength={15}
          />
          <PasswordField
            name="confirmPassword"
            label="Confirm new password"
            autoComplete="new-password"
            minLength={15}
          />
          <p className="field-help">
            Use a unique passphrase of at least 15 characters.
          </p>
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

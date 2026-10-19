"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Button, PasswordField } from "@vercentlabs/design-system";
import { TextField } from "@vercentlabs/design-system";

import { SocialSignInButtons } from "@/shared/ui/SocialSignInButtons";

// What a Google / Microsoft sign-in that came back says (the callback's ?error= code).
const SOCIAL_ERRORS: Record<string, string> = {
  AUTH_SOCIAL_NOT_LINKED: "No account is linked to that Google or Microsoft account. Sign in with your password, then connect it in your profile.",
  AUTH_SOCIAL_CANCELLED: "The sign-in was cancelled.",
  AUTH_SOCIAL_STATE_INVALID: "That sign-in link expired. Try again.",
  AUTH_ACCOUNT_INACTIVE: "This account is not active.",
};

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const socialError = params.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || payload.ok === false) {
        setError(payload.message || "Sign in failed. Try again.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Sign in failed. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <SocialSignInButtons />
      {socialError && !error ? (
        <p role="alert" className="text-sm text-danger">
          {SOCIAL_ERRORS[socialError] ?? "Signing in with that account did not work. Try again or use your password."}
        </p>
      ) : null}
      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        isRequired
        value={email}
        onChange={setEmail}
      />
      <PasswordField
        label="Password"
                autoComplete="current-password"
        isRequired
        value={password}
        onChange={setPassword}
      />
      <Link
        href="/forgot-password"
        className="self-end text-sm font-medium text-brand hover:underline"
      >
        Forgot password?
      </Link>
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
        Sign in
      </Button>
      <p className="text-center text-sm text-text-secondary">
        New to Vercentlabs ERP?{" "}
        <Link
          href="/register"
          className="font-medium text-brand hover:underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}

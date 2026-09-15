"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@vercentlabs/design-system";
import { TextField } from "@vercentlabs/design-system";

export function LoginForm() {
  const router = useRouter();
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
      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        isRequired
        value={email}
        onChange={setEmail}
      />
      <TextField
        label="Password"
        type="password"
        autoComplete="current-password"
        isRequired
        value={password}
        onChange={setPassword}
      />
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
    </form>
  );
}

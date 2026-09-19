"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button, TextField } from "@vercentlabs/design-system";

export function RegisterForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [countryCode, setCountryCode] = useState("IN");
  const [baseCurrency, setBaseCurrency] = useState("INR");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email, password, organizationName, countryCode, baseCurrency, timezone }),
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!response.ok || payload.ok === false) {
        setError(payload.message || "We couldn't create your account. Try again.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("We couldn't create your account. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <TextField label="Your name" autoComplete="name" isRequired value={fullName} onChange={setFullName} />
      <TextField label="Email" type="email" autoComplete="email" isRequired value={email} onChange={setEmail} />
      <TextField
        label="Password"
        type="password"
        autoComplete="new-password"
        isRequired
        value={password}
        onChange={setPassword}
        description="At least 12 characters, including a letter and a number."
      />
      <TextField label="Organization name" autoComplete="organization" isRequired value={organizationName} onChange={setOrganizationName} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Country code" isRequired value={countryCode} onChange={(v) => setCountryCode(v.toUpperCase())} />
        <TextField label="Base currency" isRequired value={baseCurrency} onChange={(v) => setBaseCurrency(v.toUpperCase())} />
      </div>
      <TextField label="Timezone" isRequired value={timezone} onChange={setTimezone} description="IANA timezone name, e.g. Asia/Kolkata." />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="standard" isLoading={submitting} className="mt-2">
        Create account
      </Button>
      <p className="text-center text-sm text-text-secondary">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

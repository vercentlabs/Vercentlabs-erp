"use client";

// "Your password" before a sensitive change — or, for someone without a password (signed up with an email code), a 6-digit code to
// their email instead. value / onChange carry the password; once a code is confirmed, onChange("confirmed") so the action can go ahead
// (the server checks this session was confirmed in the last 10 minutes).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, PasswordField } from "@vercentlabs/design-system";

import { CodeInput } from "./CodeInput";

async function reauth(body?: Record<string, unknown>) {
  const response = await fetch("/api/auth/reauth", { method: body ? "POST" : "GET", credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message ?? "That did not work.");
  return payload;
}

export function IdentityField({ value, onChange, label = "Your password", errorMessage }: { value: string; onChange: (value: string) => void; label?: string; errorMessage?: string }) {
  const query = useQuery({ queryKey: ["auth", "has-password"], queryFn: () => reauth() as Promise<{ hasPassword: boolean }>, staleTime: 300_000 });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!query.data) return null;
  if (query.data.hasPassword) return <PasswordField label={label} value={value} onChange={onChange} isInvalid={Boolean(errorMessage)} errorMessage={errorMessage} />;
  if (value === "confirmed") return <p className="text-sm text-success">Confirmed it&apos;s you.</p>;
  const send = async () => {
    setBusy(true);
    setError(null);
    try { await reauth({ action: "request" }); setSent(true); } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  };
  const verify = async (code: string) => {
    setBusy(true);
    setError(null);
    try { await reauth({ action: "verify", code }); onChange("confirmed"); } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-text-secondary">{sent ? "Enter the 6-digit code we emailed you." : "To confirm it's you, we'll email you a 6-digit code."}</p>
      {sent ? <CodeInput disabled={busy} onComplete={(code) => void verify(code)} resetKey={error} /> : <Button size="compact" variant="secondary" isLoading={busy} onPress={() => void send()}>Email me a code</Button>}
      {(error || errorMessage) && <p role="alert" className="text-danger">{error ?? errorMessage}</p>}
    </div>
  );
}

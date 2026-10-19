"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// The link from the new address of an email change (Shared Platform plan 3): confirms it once.
export function ConfirmEmailClient({ token }: { token?: string }) {
  const [state, setState] = useState<{ status: "checking" | "done" | "error"; message: string }>(
    token ? { status: "checking", message: "Confirming your new email…" } : { status: "error", message: "This link is incomplete." },
  );
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (!token || sent.current === token) return;
    sent.current = token;
    (async () => {
      const response = await fetch("/api/auth/confirm-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string; email?: string };
      if (!response.ok || payload.ok === false) setState({ status: "error", message: payload.message ?? "This link is invalid or has expired." });
      else setState({ status: "done", message: `Your email is now ${payload.email}. Sign in with it from now on.` });
    })();
  }, [token]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-text">{state.status === "done" ? "Email changed" : state.status === "error" ? "Could not confirm" : "Confirming"}</h1>
      <p role={state.status === "error" ? "alert" : undefined} className={state.status === "error" ? "text-sm text-danger" : "text-sm text-text-secondary"}>{state.message}</p>
      <Link className="text-sm font-medium text-brand hover:underline" href="/login">Go to sign in</Link>
    </div>
  );
}

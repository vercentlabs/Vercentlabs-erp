"use client";

// Signing in to the customer portal (Sales report Phase 3): the email, then the 6-digit code sent to it. Plain controls: this page is
// for customers, outside the workspace.
import { useState } from "react";
import { useRouter } from "next/navigation";

const field = "h-11 w-full rounded-[var(--radius-control)] border border-border bg-surface px-3 text-sm text-text";
const primary = "inline-flex h-11 items-center justify-center rounded-[var(--radius-control)] bg-brand px-4 text-sm font-medium text-text-inverse hover:bg-brand-hover disabled:opacity-60";

async function send(path: string, body: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = (await response.json().catch(() => ({ ok: false }))) as { ok: boolean; message?: string };
  if (!result.ok) throw new Error(result.message ?? "Something went wrong. Try again.");
}

export function PortalSignIn({ portalKey }: { portalKey: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const base = `/api/sales/public/portal/${encodeURIComponent(portalKey)}`;
  async function run(work: () => Promise<void>) {
    setWorking(true);
    setMessage(null);
    try { await work(); } catch (error) { setMessage((error as Error).message); } finally { setWorking(false); }
  }
  if (step === "email") {
    return (
      <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void run(async () => { await send(`${base}/code`, { email }); setStep("code"); }); }}>
        <label className="flex flex-col gap-1 text-sm font-medium text-text">
          Your email
          <input className={field} type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <button type="submit" className={primary} disabled={working || !email.trim()}>{working ? "Sending…" : "Email me a code"}</button>
        {message && <p role="alert" className="text-sm text-danger">{message}</p>}
      </form>
    );
  }
  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void run(async () => { await send(`${base}/verify`, { email, code }); router.refresh(); }); }}>
      <p className="text-sm text-text-secondary">If {email} is on our records, a 6-digit code is on its way. It works for 10 minutes.</p>
      <label className="flex flex-col gap-1 text-sm font-medium text-text">
        Code
        <input className={`${field} tracking-[0.3em] tabular-nums`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
      </label>
      <button type="submit" className={primary} disabled={working || code.length !== 6}>{working ? "Signing in…" : "Sign in"}</button>
      <button type="button" className="text-sm text-text-secondary underline-offset-2 hover:underline" onClick={() => { setStep("email"); setCode(""); setMessage(null); }}>
        Use another email
      </button>
      {message && <p role="alert" className="text-sm text-danger">{message}</p>}
    </form>
  );
}

export function PortalSignOut({ portalKey }: { portalKey: string }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  return (
    <button type="button" disabled={working}
      className="inline-flex h-10 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-surface-muted"
      onClick={() => { setWorking(true); void send(`/api/sales/public/portal/${encodeURIComponent(portalKey)}/signout`, {}).finally(() => router.refresh()); }}>
      Sign out
    </button>
  );
}

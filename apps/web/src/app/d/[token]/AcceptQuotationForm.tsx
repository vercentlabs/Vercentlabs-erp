"use client";

// The customer accepts the quotation: their name (and a note) is recorded on the quotation as accepted online.
import { useState } from "react";

export function AcceptQuotationForm({ token }: { token: string }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  async function accept() {
    setState("sending");
    setError(null);
    const response = await fetch(`/api/sales/public/documents/${token}/accept`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, note }) });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    if (response.ok && body.ok) setState("done");
    else { setState("idle"); setError(body.message ?? "The acceptance could not be recorded."); }
  }
  if (state === "done") return <p className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">Thank you: your acceptance is recorded. We will send the order confirmation.</p>;
  return (
    <form className="flex flex-col gap-3 border-t border-border pt-4" onSubmit={(event) => { event.preventDefault(); void accept(); }}>
      <p className="text-sm font-medium">Accept this quotation</p>
      <label className="flex flex-col gap-1 text-sm">Your name
        <input className="h-10 rounded-[var(--radius-control)] border border-border bg-surface px-3" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} />
      </label>
      <label className="flex flex-col gap-1 text-sm">Note (optional): your PO number, delivery wishes
        <textarea className="min-h-16 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2" value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={state === "sending" || name.trim().length < 2}
        className="inline-flex h-11 items-center justify-center rounded-[var(--radius-control)] bg-brand px-4 text-sm font-medium text-text-inverse hover:bg-brand-hover disabled:opacity-60">
        {state === "sending" ? "Recording…" : "Accept quotation"}
      </button>
    </form>
  );
}

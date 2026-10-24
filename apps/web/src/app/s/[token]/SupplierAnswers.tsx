"use client";

// The supplier's answers on their page (Procurement report H5): confirm the order or propose another date, send the invoice, or type the
// prices for a price request. Each answer is recorded on the order or the price request, and the buyer is told.
import { useState } from "react";

const input = "h-11 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-base sm:h-10 sm:text-sm";
const area = "min-h-20 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-base sm:text-sm";
const primary = "inline-flex h-11 items-center justify-center rounded-[var(--radius-control)] bg-brand px-4 text-sm font-medium text-text-inverse hover:bg-brand-hover disabled:opacity-60";
const secondary = "inline-flex h-11 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-surface-muted disabled:opacity-60";
const done = "rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm";
const problem = "text-sm text-danger-emphasis";

async function answer(token: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/procurement/public/supplier/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
  if (!response.ok || !result.ok) throw new Error(result.message ?? "Your answer could not be recorded. Try again.");
}

export function OrderAnswer({ token, canConfirm, expectedDate }: { token: string; canConfirm: boolean; expectedDate: string | null }) {
  const [choice, setChoice] = useState<"confirm" | "propose">(canConfirm ? "confirm" : "propose");
  const [name, setName] = useState("");
  const [date, setDate] = useState(expectedDate ?? "");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setState("sending"); setError(null);
    try { await answer(token, { action: choice, name, note, ...(choice === "propose" ? { date } : {}) }); setState("done"); }
    catch (failure) { setState("idle"); setError(failure instanceof Error ? failure.message : "Try again."); }
  };
  if (state === "done") return <p className={done}>{choice === "confirm" ? "Thank you: your confirmation is recorded." : "Thank you: the buyer is told about your date."}</p>;
  const ready = name.trim().length >= 2 && (choice === "confirm" || /^\d{4}-\d{2}-\d{2}$/.test(date));
  return (
    <form className="flex flex-col gap-4 border-t border-border pt-4" onSubmit={(event) => { event.preventDefault(); if (ready) void send(); }}>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-text">Your answer</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {([["confirm", "Confirm the order"], ["propose", "Propose another date"]] as const).filter(([value]) => value !== "confirm" || canConfirm).map(([value, label]) => (
            <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border px-3 text-sm ${choice === value ? "border-brand bg-brand-soft font-medium" : "border-border"}`}>
              <input type="radio" name="answer" value={value} checked={choice === value} onChange={() => { setChoice(value); setError(null); }} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm">Your name
        <input className={input} value={name} onChange={(event) => setName(event.target.value)} required minLength={2} autoComplete="name" />
      </label>
      {choice === "propose" && (
        <label className="flex flex-col gap-1 text-sm">The date you can deliver
          <input className={input} type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">Note (optional)
        <textarea className={area} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} />
      </label>
      {error && <p className={problem}>{error}</p>}
      <button type="submit" className={primary} disabled={!ready || state === "sending"}>{state === "sending" ? "Sending…" : "Send"}</button>
    </form>
  );
}

export function InvoiceUpload({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ invoiceNumber: "", invoiceDate: "", total: "", name: "" });
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const send = async () => {
    setState("sending"); setError(null);
    const form = new FormData();
    form.set("file", file!);
    for (const [key, value] of Object.entries(values)) form.set(key, value);
    const response = await fetch(`/api/procurement/public/supplier/${token}/invoice`, { method: "POST", body: form });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    if (response.ok && result.ok) setState("done");
    else { setState("idle"); setError(result.message ?? "Your invoice could not be sent. Try again."); }
  };
  if (state === "done") return <p className={done}>Thank you: your invoice is received.</p>;
  if (!open) return <button type="button" className={secondary} onClick={() => setOpen(true)}>Send your invoice</button>;
  const ready = file && values.invoiceNumber.trim() && /^\d{4}-\d{2}-\d{2}$/.test(values.invoiceDate) && values.name.trim().length >= 2;
  return (
    <form className="flex flex-col gap-3 border-t border-border pt-4" onSubmit={(event) => { event.preventDefault(); if (ready) void send(); }}>
      <p className="text-sm font-medium text-text">Your invoice</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">Invoice number<input className={input} value={values.invoiceNumber} onChange={set("invoiceNumber")} required /></label>
        <label className="flex flex-col gap-1 text-sm">Invoice date<input className={input} type="date" value={values.invoiceDate} onChange={set("invoiceDate")} required /></label>
        <label className="flex flex-col gap-1 text-sm">Total (optional)<input className={input} inputMode="decimal" value={values.total} onChange={set("total")} /></label>
        <label className="flex flex-col gap-1 text-sm">Your name<input className={input} value={values.name} onChange={set("name")} required autoComplete="name" /></label>
      </div>
      <label className="flex flex-col gap-1 text-sm">The invoice (PDF or a photo)
        <input className="text-sm" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required />
      </label>
      {error && <p className={problem}>{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primary} disabled={!ready || state === "sending"}>{state === "sending" ? "Sending…" : "Send invoice"}</button>
        <button type="button" className={secondary} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

type RfqLine = { id: string; number: number; name: string; description: string | null; quantityText: string; requiredByText: string | null };

export function RfqPrices({ token, currencyCode, lines }: { token: string; currencyCode: string; lines: RfqLine[] }) {
  const [prices, setPrices] = useState<Record<string, { unitPrice: string; discountPercent: string }>>({});
  const [values, setValues] = useState({ validUntil: "", leadDays: "", freight: "", reference: "", note: "", name: "" });
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const setPrice = (id: string, key: "unitPrice" | "discountPercent", value: string) =>
    setPrices((current) => ({ ...current, [id]: { unitPrice: current[id]?.unitPrice ?? "", discountPercent: current[id]?.discountPercent ?? "", [key]: value.replace(/[^0-9.]/g, "") } }));
  const priced = lines.filter((line) => prices[line.id]?.unitPrice);
  const send = async () => {
    setState("sending"); setError(null);
    try {
      await answer(token, { action: "quote", ...values, lines: priced.map((line) => ({ rfqLineId: line.id, unitPrice: prices[line.id].unitPrice, discountPercent: prices[line.id].discountPercent || undefined })) });
      setState("done");
    } catch (failure) { setState("idle"); setError(failure instanceof Error ? failure.message : "Try again."); }
  };
  if (state === "done") return <p className={done}>Thank you: your prices are received.</p>;
  const ready = priced.length > 0 && values.name.trim().length >= 2;
  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (ready) void send(); }}>
      <p className="text-sm text-text-secondary">Your price per unit in {currencyCode}, before GST. Leave an item empty if you do not supply it.</p>
      <ul className="flex flex-col divide-y divide-border">
        {lines.map((line) => (
          <li key={line.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-end sm:justify-between">
            <span className="text-sm"><span className="font-medium text-text">{line.name}</span>
              <span className="block text-xs text-text-muted">{line.quantityText}{line.requiredByText ? ` · by ${line.requiredByText}` : ""}{line.description ? ` · ${line.description}` : ""}</span></span>
            <span className="grid grid-cols-2 gap-2 sm:w-64">
              <label className="flex flex-col gap-1 text-xs">Price per unit<input className={input} inputMode="decimal" value={prices[line.id]?.unitPrice ?? ""} onChange={(event) => setPrice(line.id, "unitPrice", event.target.value)} /></label>
              <label className="flex flex-col gap-1 text-xs">Discount %<input className={input} inputMode="decimal" value={prices[line.id]?.discountPercent ?? ""} onChange={(event) => setPrice(line.id, "discountPercent", event.target.value)} /></label>
            </span>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">Prices valid until<input className={input} type="date" value={values.validUntil} onChange={set("validUntil")} /></label>
        <label className="flex flex-col gap-1 text-sm">Delivery in (days)<input className={input} inputMode="numeric" value={values.leadDays} onChange={set("leadDays")} /></label>
        <label className="flex flex-col gap-1 text-sm">Freight, if charged<input className={input} inputMode="decimal" value={values.freight} onChange={set("freight")} /></label>
        <label className="flex flex-col gap-1 text-sm">Your quotation number<input className={input} value={values.reference} onChange={set("reference")} /></label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">Your name<input className={input} value={values.name} onChange={set("name")} required autoComplete="name" /></label>
      </div>
      <label className="flex flex-col gap-1 text-sm">Note (optional)<textarea className={area} value={values.note} onChange={set("note")} maxLength={1000} /></label>
      {error && <p className={problem}>{error}</p>}
      <button type="submit" className={primary} disabled={!ready || state === "sending"}>{state === "sending" ? "Sending…" : "Send prices"}</button>
    </form>
  );
}

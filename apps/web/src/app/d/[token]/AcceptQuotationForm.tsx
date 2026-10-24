"use client";

// The customer answers the quotation from the link (Sales report Phase 2): accept with their name and a drawn signature, ask for changes,
// or decline with a reason. Each answer is recorded on the quotation and the salesperson is told.
import { useEffect, useRef, useState } from "react";

type Choice = "accept" | "changes" | "decline";
const input = "h-11 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-base sm:h-10 sm:text-sm";
const area = "min-h-20 rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-base sm:text-sm";
const primary = "inline-flex h-11 items-center justify-center rounded-[var(--radius-control)] bg-brand px-4 text-sm font-medium text-text-inverse hover:bg-brand-hover disabled:opacity-60";
const secondary = "inline-flex h-11 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-surface-muted disabled:opacity-60";

const DONE: Record<Choice, string> = {
  accept: "Thank you: your acceptance and signature are recorded. We will send the order confirmation.",
  changes: "Thank you: your request was sent. We will send you a revised quotation.",
  decline: "Thank you for letting us know. Your answer is recorded.",
};

// Optional extras the customer may add when accepting (Sales report Phase 3): their label and their amount with tax.
type Extra = { index: number; label: string; amount: string };

export function AcceptQuotationForm({ token, extras = [] }: { token: string; extras?: Extra[] }) {
  const [chosen, setChosen] = useState<number[]>([]);
  const [choice, setChoice] = useState<Choice>("accept");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setState("sending");
    setError(null);
    const body = choice === "accept" ? { name, note, signature, optionalChosen: chosen } : choice === "decline" ? { name, reason: note } : { name, note };
    const path = choice === "accept" ? "accept" : choice === "decline" ? "decline" : "changes";
    const response = await fetch(`/api/sales/public/documents/${token}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    if (response.ok && result.ok) setState("done");
    else { setState("idle"); setError(result.message ?? "Your answer could not be recorded. Try again."); }
  }

  if (state === "done") return <p className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">{DONE[choice]}</p>;
  const ready = name.trim().length >= 2 && (choice === "accept" ? Boolean(signature) : note.trim().length >= 3);
  return (
    <form className="flex flex-col gap-4 border-t border-border pt-4" onSubmit={(event) => { event.preventDefault(); if (ready) void send(); }}>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-text">Your answer</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {([["accept", "Accept"], ["changes", "Ask for changes"], ["decline", "Decline"]] as const).map(([value, label]) => (
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
      {choice === "accept" && extras.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-text">Add optional extras</legend>
          {extras.map((extra) => (
            <label key={extra.index} className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <input type="checkbox" checked={chosen.includes(extra.index)}
                  onChange={(event) => setChosen((current) => (event.target.checked ? [...current, extra.index] : current.filter((index) => index !== extra.index)))} />
                {extra.label}
              </span>
              <span className="tabular-nums text-text-secondary">{extra.amount}</span>
            </label>
          ))}
        </fieldset>
      )}
      {choice === "accept" && <SignaturePad onChange={setSignature} />}
      <label className="flex flex-col gap-1 text-sm">
        {choice === "accept" ? "Note (optional): your PO number, delivery wishes" : choice === "decline" ? "Why are you declining?" : "What would you like changed?"}
        <textarea className={area} value={note} onChange={(event) => setNote(event.target.value)} required={choice !== "accept"} />
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={state === "sending" || !ready} className={choice === "decline" ? secondary : primary}>
        {state === "sending" ? "Sending…" : choice === "accept" ? "Accept and sign" : choice === "decline" ? "Decline quotation" : "Send request"}
      </button>
    </form>
  );
}

// A box to sign in with a finger, pen or mouse. Gives a PNG data URL once something is drawn.
function SignaturePad({ onChange }: { onChange: (value: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const scale = window.devicePixelRatio || 1;
    element.width = element.offsetWidth * scale;
    element.height = element.offsetHeight * scale;
    const context = element.getContext("2d");
    if (!context) return;
    context.scale(scale, scale);
    context.lineWidth = 2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#0f172a";
  }, []);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const clear = () => {
    const element = canvas.current;
    element?.getContext("2d")?.clearRect(0, 0, element.width, element.height);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div className="flex flex-col gap-1 text-sm">
      <span id="signature-label">Sign here</span>
      <canvas ref={canvas} aria-labelledby="signature-label" role="img"
        className="h-36 w-full touch-none rounded-[var(--radius-control)] border border-border bg-white"
        onPointerDown={(event) => {
          drawing.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          const context = event.currentTarget.getContext("2d");
          const { x, y } = point(event);
          context?.beginPath();
          context?.moveTo(x, y);
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const context = event.currentTarget.getContext("2d");
          const { x, y } = point(event);
          context?.lineTo(x, y);
          context?.stroke();
        }}
        onPointerUp={(event) => {
          drawing.current = false;
          setEmpty(false);
          onChange(event.currentTarget.toDataURL("image/png"));
        }} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-text-muted">{empty ? "Draw your signature in the box." : "Signed."}</span>
        <button type="button" className="text-sm font-medium text-brand underline-offset-2 hover:underline" onClick={clear}>Clear signature</button>
      </div>
    </div>
  );
}

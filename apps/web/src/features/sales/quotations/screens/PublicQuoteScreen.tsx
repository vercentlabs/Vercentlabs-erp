"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { Button, ErrorState, TextArea, TextField } from "@vercentlabs/design-system";

import { calendarDate, dateTime, money } from "@/features/sales/shared/format";
import { SalesAlert, SalesFacts, SalesPanel } from "@/features/sales/shared/SalesUi";
import type { SalesQuotationDetail } from "@/features/sales/quotations/api/quotations-api";

type PublicQuote = Pick<SalesQuotationDetail, "quotation" | "lines" | "charges">;

async function fetchQuote(token: string): Promise<{ quotation: PublicQuote; expiresAt: string }> {
  const response = await fetch(`/api/sales/public/quotes/${token}`, { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message || "This quotation link is not available.");
  return payload;
}

// F036 -- what the customer sees. Read-only quotation, then a single decision:
// accept or decline, with a typed name as the acknowledgement. Margin, cost and
// internal notes are stripped server-side (publicView), so nothing sensitive is
// ever sent to this page, not merely hidden by it.
// The public page sits outside the workspace shell, so it has no shared
// QueryClientProvider; it owns a private one.
export function PublicQuoteScreen({ token }: { token: string }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <PublicQuote token={token} />
    </QueryClientProvider>
  );
}

function PublicQuote({ token }: { token: string }) {
  const query = useQuery({ queryKey: ["public-quote", token], queryFn: () => fetchQuote(token), retry: false });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"accepted" | "rejected" | null>(null);

  const decide = useMutation({
    mutationFn: async (decision: "accepted" | "rejected") => {
      const response = await fetch(`/api/sales/public/quotes/${token}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ decision, customerName: name, customerEmail: email || undefined, customerTitle: title || undefined, typedSignature: name, note: note || undefined }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.message || "Your response could not be recorded.");
      return decision;
    },
    onSuccess: (decision) => {
      setError(null);
      setDone(decision);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Your response could not be recorded."),
  });

  if (query.isLoading) return <p className="text-sm text-text-secondary">Loading your quotation…</p>;
  if (query.isError || !query.data) return <ErrorState title="This quotation link is not available" description={query.error instanceof Error ? query.error.message : "It may have expired or been replaced by a newer version. Please contact the sender."} />;

  const { quotation: q, lines, charges } = query.data.quotation;
  const currency = q.currency_code;

  if (done) {
    return (
      <SalesPanel title={done === "accepted" ? "Thank you — quotation accepted" : "Your response has been recorded"}>
        <p className="text-sm text-text-secondary">
          {done === "accepted" ? `You accepted ${q.quotation_number}. The sender has been notified and will be in touch.` : `You declined ${q.quotation_number}. The sender has been notified.`}
        </p>
      </SalesPanel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-text">Quotation {q.quotation_number}</h1>
        <p className="text-sm text-text-secondary">
          Prepared for {q.customer_snapshot?.displayName ?? "you"} · valid until {calendarDate(q.valid_until)} · link expires {dateTime(query.data.expiresAt)}
        </p>
      </header>

      <SalesPanel title="Items">
        <ul className="flex flex-col divide-y divide-border" aria-label="Quotation items">
          {lines.map((line) => (
            <li key={line.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 py-2 text-sm">
              <span className="font-medium text-text">{line.item_name_snapshot}</span>
              <span className="text-right font-medium tabular-nums text-text">{money(currency, line.line_total)}</span>
              <span className="text-text-secondary tabular-nums">
                {Number(line.quantity)} × {money(currency, line.unit_price)}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-1 border-t border-border pt-3 sm:ml-auto sm:w-72">
          <SalesFacts columns={2} items={[{ label: "Subtotal", value: money(currency, q.subtotal) }, { label: "Tax", value: money(currency, q.tax_total) }, ...charges.map((charge) => ({ label: charge.label, value: money(currency, charge.amount) }))]} />
          <div className="flex items-center justify-between pt-2 text-lg font-semibold text-text">
            <span>Total</span>
            <span className="tabular-nums">{money(currency, q.grand_total)}</span>
          </div>
        </div>
      </SalesPanel>

      {(q.customer_notes || q.terms_and_conditions) && (
        <SalesPanel title="Notes & terms">
          {q.customer_notes && <p className="whitespace-pre-wrap text-sm text-text">{q.customer_notes}</p>}
          {q.terms_and_conditions && <p className="whitespace-pre-wrap text-sm text-text-secondary">{q.terms_and_conditions}</p>}
        </SalesPanel>
      )}

      <SalesPanel title="Your response" description="Typing your name below is your acknowledgement. You can only respond once.">
        {error && <SalesAlert>{error}</SalesAlert>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Your name" isRequired value={name} onChange={setName} />
          <TextField label="Your email" type="email" value={email} onChange={setEmail} />
          <TextField label="Your title (optional)" value={title} onChange={setTitle} />
        </div>
        <TextArea label="Comments (optional)" value={note} onChange={setNote} />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="large" isDisabled={!name.trim()} isLoading={decide.isPending} onPress={() => decide.mutate("accepted")}>
            Accept quotation
          </Button>
          <Button variant="secondary" size="large" isDisabled={!name.trim() || decide.isPending} onPress={() => decide.mutate("rejected")}>
            Decline
          </Button>
        </div>
      </SalesPanel>
    </div>
  );
}

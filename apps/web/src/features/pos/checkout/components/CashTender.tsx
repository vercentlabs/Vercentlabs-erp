"use client";

// Cash at checkout: the amount to pay, large; the cash received (typed, keypad or a quick amount); the change, larger still; then one
// confirmation that the cash is physically in hand. The server works out what the cash settles and the change, records it against the
// session and finalises the sale — the screen shows "completed" only when the server says so. If the sale cannot be finalised after the
// cash was taken, the cash stays on record: the cashier can try again, hand the cash back (and confirm it), or flag it for a supervisor.
// After a refresh or a lost connection the authoritative state is fetched, never guessed.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Banknote, Delete } from "lucide-react";
import { Button, Checkbox, TextField } from "@vercentlabs/design-system";
import type { PosCart } from "@vercentlabs/api";

import { money } from "@/features/pos/shared/format";
import { PosApiError } from "@/features/pos/shared/http";

import {
  confirmPosCash, finalizePosCash, flagPosCash, getPosCheckoutPayments, getPosPaymentMethods, previewPosCash, returnPosCash, type PosCashOutcome,
} from "../api/checkout-api";

export type CashCompleted = { saleId: string; receiptNumber: string; grandTotal: string; changeTotal: string; cashReceived: string | null };
const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "back"] as const;

export function CashTender({ cart, currency, disabled, onCompleted, onCart }: {
  cart: PosCart; currency: string; disabled?: boolean; onCompleted: (sale: CashCompleted) => void; onCart: () => void;
}) {
  const queryClient = useQueryClient();
  const methods = useQuery({ queryKey: ["pos-payment-methods", cart.id, cart.version], queryFn: () => getPosPaymentMethods(cart.id) });
  const [received, setReceived] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PosCashOutcome | null>(null);
  const [returning, setReturning] = useState(false);
  const [returnConfirmed, setReturnConfirmed] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  // One request key per attempt: a double tap or a retried request is applied once.
  const attemptKey = useRef<string>(crypto.randomUUID());
  useEffect(() => { attemptKey.current = crypto.randomUUID(); }, [received]);

  const due = methods.data?.amountDue ?? cart.grand_total;
  const dueNumber = Number(due);
  const receivedNumber = Number(received || 0);
  const change = received && receivedNumber >= dueNumber ? Math.round((receivedNumber - dueNumber) * 100) / 100 : null;
  const short = received && receivedNumber < dueNumber ? Math.round((dueNumber - receivedNumber) * 100) / 100 : null;
  const valid = /^\d{1,12}(\.\d{1,2})?$/.test(received) && receivedNumber > 0;
  const preview = useQuery({
    queryKey: ["pos-cash-preview", cart.id, cart.version, received],
    queryFn: () => previewPosCash(cart.id, received),
    enabled: valid,
    retry: false,
  });
  const held = pending ?? (methods.data?.cash.pending ? ({ payment: methods.data.cash.pending, status: methods.data.cash.pending.status } as PosCashOutcome) : null);

  const press = (key: (typeof KEYS)[number]) => setReceived((text) => {
    if (key === "back") return text.slice(0, -1);
    if (key === "." && text.includes(".")) return text;
    const next = text === "0" && key !== "." ? key : `${text}${key}`;
    return /^\d{0,12}(\.\d{0,2})?$/.test(next) ? next : text;
  });

  const settle = (result: PosCashOutcome) => {
    if (result.status === "COMPLETED" && result.saleId) {
      const sale = (result.sale ?? {}) as { receipt_number?: string; grand_total?: string };
      onCompleted({ saleId: result.saleId, receiptNumber: sale.receipt_number ?? "", grandTotal: sale.grand_total ?? cart.grand_total,
        changeTotal: result.changeGivenAmount ?? "0", cashReceived: result.cashReceivedAmount });
      return;
    }
    setPending(result);
    void queryClient.invalidateQueries({ queryKey: ["pos-payment-methods", cart.id] });
    onCart();
  };
  // After a lost connection: what really happened, from the server.
  async function recover() {
    try {
      const state = await getPosCheckoutPayments(cart.id);
      if (state.status === "COMPLETED" && state.saleId) {
        const cashPayment = state.payments.find((payment) => payment.cash?.saleId);
        onCompleted({ saleId: state.saleId, receiptNumber: "", grandTotal: state.grandTotal, changeTotal: cashPayment?.cash?.changeGivenAmount ?? "0",
          cashReceived: cashPayment?.cash?.cashReceivedAmount ?? null });
      } else if (state.pendingCash) {
        setPending({ payment: state.pendingCash, status: state.pendingCash.status } as PosCashOutcome);
      }
      setError("The connection dropped. This is the bill's current state.");
    } catch {
      setError("Could not reach the server. Check the connection, then check the bill's status again — do not take the cash twice.");
    }
  }
  async function act(work: () => Promise<PosCashOutcome>) {
    setBusy(true);
    setError(null);
    try { settle(await work()); }
    catch (failure) {
      if (failure instanceof PosApiError) {
        setError(failure.message);
        if (["POS_CASH_PAYMENT_ALREADY_COMPLETED", "POS_CASH_PAYMENT_PENDING", "POS_CASH_PAYMENT_RECONCILIATION_REQUIRED"].includes(failure.code ?? "")) await recover();
        if (["POS_CASH_VERSION_CONFLICT", "POS_CASH_CHECKOUT_CHANGED"].includes(failure.code ?? "")) onCart();
      } else await recover();
    } finally { setBusy(false); }
  }

  if (methods.data && !methods.data.cash.enabled && !held) {
    return <p className="text-sm text-text-muted">{methods.data.methods.find((entry) => entry.method === "cash")?.reason ?? "Cash payments are not available at this counter."}</p>;
  }

  if (held && held.payment && held.payment.status !== "COMPLETED") {
    const tender = held.payment;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2 rounded-[var(--radius-control)] border border-warning-emphasis/40 bg-warning-soft px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">{tender.status === "RECONCILIATION_REQUIRED" ? "Cash is waiting for a supervisor." : "Cash received — the sale is not finalised yet."}</p>
            <p>Received {money(currency, tender.cashReceivedAmount)}, change given {money(currency, tender.changeGivenAmount)}, cash held {money(currency, tender.retainedAmount)}.</p>
            {(held.error?.message || tender.finalizationError) && <p className="text-xs">{held.error?.message ?? tender.finalizationError}</p>}
            {Number(held.remainingAmount ?? 0) > 0 && <p className="text-xs">{money(currency, held.remainingAmount)} is still due by card or UPI.</p>}
          </div>
        </div>
        {error && <p className="text-sm text-danger-emphasis">{error}</p>}
        {tender.status !== "RECONCILIATION_REQUIRED" && !returning && (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" isLoading={busy} onPress={() => act(() => finalizePosCash(cart.id))}>Try completing the sale again</Button>
            <Button variant="secondary" onPress={() => setReturning(true)}>Return the cash</Button>
            <Button variant="ghost" onPress={() => { const note = window.prompt("What needs a supervisor's attention?"); if (note?.trim()) void act(() => flagPosCash(cart.id, note.trim())); }}>
              Ask a supervisor
            </Button>
          </div>
        )}
        {returning && (
          <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border px-3 py-2">
            <p className="text-sm">Give the customer back <span className="font-semibold tabular-nums">{money(currency, tender.retainedAmount)}</span> (the cash received less the change already given).</p>
            <TextField label="Reason" value={returnReason} onChange={setReturnReason} maxLength={200} />
            <Checkbox isSelected={returnConfirmed} onChange={setReturnConfirmed}>I have handed the cash back</Checkbox>
            <div className="flex gap-2">
              <Button variant="primary" isDisabled={!returnConfirmed || busy} isLoading={busy}
                onPress={() => act(() => returnPosCash(cart.id, { cashReturned: true, returnedAmount: tender.retainedAmount ?? undefined, reason: returnReason || "Cash handed back" }))}>
                Record cash returned
              </Button>
              <Button variant="ghost" onPress={() => setReturning(false)}>Back</Button>
            </div>
          </div>
        )}
        {held.status === "CANCELLED_RETURNED" && <p className="text-sm text-text-muted">Cash returned and recorded. Take another payment or go back to the bill.</p>}
      </div>
    );
  }

  const quick = methods.data?.cash.quickAmounts ?? [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-text-secondary">Amount to pay</span>
        <span className="text-3xl font-semibold tabular-nums text-text">{money(currency, due)}</span>
      </div>
      <TextField label="Cash received" inputMode="decimal" value={received} isDisabled={disabled || busy} autoFocus
        onChange={(text) => /^\d{0,12}(\.\d{0,2})?$/.test(text) && setReceived(text)}
        errorMessage={received && !valid ? "Enter a valid cash amount." : undefined} isInvalid={Boolean(received) && !valid} />
      {quick.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Quick amounts">
          {quick.map((amount, index) => (
            <Button key={amount} variant={received === String(Number(amount)) ? "primary" : "secondary"} size="compact" isDisabled={disabled || busy}
              onPress={() => setReceived(String(Number(amount)))}>
              {index === 0 ? "Exact" : money(currency, amount)}
            </Button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1.5 sm:max-w-xs" aria-label="Keypad">
        {KEYS.map((key) => (
          <Button key={key} variant="secondary" isDisabled={disabled || busy} onPress={() => press(key)} aria-label={key === "back" ? "Delete last digit" : key}>
            {key === "back" ? <Delete className="size-4" aria-hidden="true" /> : key}
          </Button>
        ))}
      </div>
      {change !== null && (
        <div className="flex items-baseline justify-between gap-3 rounded-[var(--radius-control)] bg-success-soft px-3 py-2">
          <span className="text-sm font-medium">Change to give</span>
          <span className="text-4xl font-bold tabular-nums">{money(currency, change)}</span>
        </div>
      )}
      {short !== null && <p className="text-sm text-danger-emphasis">{money(currency, short)} more is needed to complete this bill.</p>}
      {change !== null && <p className="text-xs text-text-muted">Cash kept for this sale: {money(currency, due)}.</p>}
      {preview.data?.warnings?.map((warning) => <p key={warning.code} className="text-sm text-warning-emphasis">{warning.message}</p>)}
      {preview.data?.status === "INVALID" && <p className="text-sm text-danger-emphasis">{preview.data.issues[0]?.message}</p>}
      {error && <p className="text-sm text-danger-emphasis">{error}</p>}
      <p className="text-xs text-text-muted">Confirm only after physically receiving the cash.</p>
      <Button variant="primary" size="large" isDisabled={disabled || busy || !valid || short !== null || preview.data?.status === "INVALID"} isLoading={busy}
        onPress={() => act(() => confirmPosCash(cart.id, { cashReceived: received, changeGiven: change === null ? undefined : change.toFixed(2), idempotencyKey: attemptKey.current }))}>
        <Banknote className="size-4" aria-hidden="true" />
        Confirm cash &amp; complete sale
      </Button>
    </div>
  );
}

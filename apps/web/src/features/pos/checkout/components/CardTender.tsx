"use client";

// Card at checkout. The cashier picks a terminal and sends the amount; the customer pays on the certified terminal (card number, PIN and
// card data never touch this screen). The screen then shows what the provider says — waiting for the card, checking, paid, declined — and
// asks the server again while the result is not final. "Paid" appears only when the provider confirmed the capture and the sale was
// finalised. An unknown result shows "Checking payment status", never a retry that could charge twice. A captured card whose sale could
// not be finalised offers "try again" or "refund the card". Where the outlet allows it, a payment taken on a standalone bank machine can be
// recorded with its approval reference — attested, not bank verified.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Loader2 } from "lucide-react";
import { Button, Checkbox, Select, StatusBadge, TextField } from "@vercentlabs/design-system";
import type { PosCart } from "@vercentlabs/api";

import { money } from "@/features/pos/shared/format";
import { PosApiError } from "@/features/pos/shared/http";

import {
  cancelPosCard, finalizePosCard, getPosCardAttempt, getPosCardOptions, recordStandaloneCard, refundUnfinalizedCard, startPosCard, type PosCardAttempt,
} from "../api/checkout-api";

export type CardCompleted = { saleId: string; receiptNumber: string; grandTotal: string; changeTotal: string; cashReceived: null };
const LIVE = ["CREATED", "AWAITING_CUSTOMER", "PROCESSING", "AUTHORIZED", "CAPTURE_PENDING", "UNKNOWN", "CANCEL_PENDING"];
const HEADLINE: Record<string, { tone: "info" | "warning" | "success" | "danger" | "neutral"; label: string }> = {
  CREATED: { tone: "info", label: "Sending" }, AWAITING_CUSTOMER: { tone: "info", label: "Waiting" }, PROCESSING: { tone: "warning", label: "Processing" },
  AUTHORIZED: { tone: "warning", label: "Authorised" }, CAPTURE_PENDING: { tone: "warning", label: "Processing" }, UNKNOWN: { tone: "warning", label: "Checking payment status" },
  CAPTURED: { tone: "success", label: "Paid" }, DECLINED: { tone: "danger", label: "Declined" }, FAILED: { tone: "danger", label: "Not completed" },
  CANCEL_PENDING: { tone: "warning", label: "Cancelling" }, CANCELLED: { tone: "neutral", label: "Cancelled" }, RECONCILIATION_REQUIRED: { tone: "danger", label: "Needs checking" },
  EXTERNALLY_ATTESTED: { tone: "warning", label: "Recorded — awaiting settlement" },
};
const SANDBOX_OUTCOMES = [
  { value: "immediate_success", label: "Simulate: paid" }, { value: "immediate_decline", label: "Simulate: declined" },
  { value: "awaiting_customer", label: "Simulate: waiting for the card" }, { value: "timeout", label: "Simulate: no answer (unknown)" },
];

export function CardTender({ cart, currency, disabled, onCompleted, onCart }: {
  cart: PosCart; currency: string; disabled?: boolean; onCompleted: (sale: CardCompleted) => void; onCart: () => void;
}) {
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: ["pos-card-options", cart.id, cart.version], queryFn: () => getPosCardOptions(cart.id) });
  const [attempt, setAttempt] = useState<PosCardAttempt | null>(null);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [outcome, setOutcome] = useState("immediate_success");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [standalone, setStandalone] = useState({ terminalId: null as string | null, reference: "", lastFour: "", attested: false });
  const startKey = useRef<string>(crypto.randomUUID());
  const current = attempt ?? options.data?.attempt ?? null;

  // While the result is not final, ask the server (which asks the provider) every two seconds.
  const live = useQuery({
    queryKey: ["pos-card-attempt", current?.attemptId],
    queryFn: () => getPosCardAttempt(current!.attemptId),
    enabled: Boolean(current && (LIVE.includes(current.status) || (current.status === "CAPTURED" && current.checkoutStatus !== "COMPLETED" && !current.finalizationError))),
    refetchInterval: 2000,
  });
  const shown = live.data && current && live.data.attemptId === current.attemptId ? live.data : current;
  const completedSale = shown?.checkoutStatus === "COMPLETED" && shown.saleId ? shown.saleId : null;
  // Report the finished sale once, whatever the parent passes on each render.
  const completedRef = useRef(onCompleted);
  useEffect(() => { completedRef.current = onCompleted; });
  useEffect(() => {
    if (completedSale) completedRef.current({ saleId: completedSale, receiptNumber: "", grandTotal: cart.grand_total, changeTotal: "0", cashReceived: null });
  }, [completedSale, cart.grand_total]);

  async function act(work: () => Promise<PosCardAttempt>) {
    setBusy(true);
    setError(null);
    try {
      const next = await work();
      setAttempt(next);
      startKey.current = crypto.randomUUID();
      void queryClient.invalidateQueries({ queryKey: ["pos-card-options", cart.id] });
      if (next.checkoutStatus !== "COMPLETED") onCart();
    } catch (failure) {
      setError(failure instanceof PosApiError ? failure.message : "The request did not get an answer. The payment's status is being checked — do not send it again.");
      void queryClient.invalidateQueries({ queryKey: ["pos-card-options", cart.id] });
    } finally { setBusy(false); }
  }

  const data = options.data;
  if (data && !data.enabled) return <p className="text-sm text-text-muted">Card payments are not available at this counter.</p>;
  const integrated = (data?.terminals ?? []).filter((terminal) => terminal.integrationMode === "integrated");
  const machines = (data?.terminals ?? []).filter((terminal) => terminal.integrationMode === "standalone");
  const chosen = integrated.find((terminal) => terminal.id === (terminalId ?? integrated.find((entry) => !entry.busy)?.id));
  const due = data?.amountDue ?? cart.grand_total;
  const sendAmount = amount.trim() || due;

  if (shown && shown.status !== "CANCELLED" && shown.status !== "DECLINED" && shown.status !== "FAILED") {
    const headline = HEADLINE[shown.status] ?? { tone: "neutral" as const, label: shown.status };
    const waiting = LIVE.includes(shown.status);
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-text-secondary">{shown.terminalLabel ?? "Card"} · {money(currency, shown.amount)}</span>
          <StatusBadge tone={headline.tone}>{headline.label}</StatusBadge>
        </div>
        <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border px-3 py-3 text-sm">
          {waiting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          <span>{shown.message}</span>
        </div>
        {shown.card?.masked && <p className="text-xs text-text-muted">{[shown.card.network, shown.card.type, shown.card.masked].filter(Boolean).join(" · ")}</p>}
        {shown.status === "CAPTURED" && Number(shown.remainingAmount ?? 0) > 0 && (
          <p className="text-sm">Card paid {money(currency, shown.amount)}. {money(currency, shown.remainingAmount)} is still due — take it in cash or another method.</p>
        )}
        {shown.finalizationError && (
          <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-warning-emphasis/40 bg-warning-soft px-3 py-2 text-sm">
            <p className="font-medium">The card was charged, but the sale could not be finalised.</p>
            <p className="text-xs">{shown.finalizationError.message}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="compact" isLoading={busy} onPress={() => act(() => finalizePosCard(cart.id))}>Try completing the sale again</Button>
              <Button variant="secondary" size="compact" isDisabled={busy}
                onPress={() => { if (window.confirm(`Refund ${money(currency, shown.amount)} to the customer's card?`)) void act(() => refundUnfinalizedCard(shown.attemptId, "Sale could not be finalised")); }}>
                Refund the card
              </Button>
            </div>
          </div>
        )}
        {shown.status === "EXTERNALLY_ATTESTED" && <p className="text-xs text-text-muted">Recorded from the card machine. The sale completes when the settlement confirms this payment.</p>}
        {shown.recoveryStatus === "refunded" && <p className="text-sm text-text-muted">The card was refunded. Go back to the bill.</p>}
        {error && <p className="text-sm text-danger-emphasis">{error}</p>}
        {waiting && shown.status !== "CANCEL_PENDING" && (
          <Button variant="ghost" isDisabled={busy} onPress={() => act(() => cancelPosCard(shown.attemptId, "Cancelled at the counter"))}>Cancel on the terminal</Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-text-secondary">Amount to pay</span>
        <span className="text-3xl font-semibold tabular-nums text-text">{money(currency, due)}</span>
      </div>
      {shown && (shown.status === "DECLINED" || shown.status === "FAILED") && (
        <p className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger-emphasis">{shown.message}</p>
      )}
      {data?.integratedReady && integrated.length > 0 ? (
        <>
          <Select label="Payment terminal" selectedKey={chosen?.id ?? null} onSelectionChange={(key) => setTerminalId(key ? String(key) : null)}
            options={integrated.map((terminal) => ({ value: terminal.id, label: `${terminal.name}${terminal.busy ? " — busy" : ""}` }))} />
          <TextField label="Card amount" description="Leave as it is to pay the whole amount, or enter the card part of a split payment." inputMode="decimal"
            value={amount} placeholder={due} onChange={(text) => /^\d{0,12}(\.\d{0,2})?$/.test(text) && setAmount(text)} />
          {chosen?.providerKey === "sandbox" && (
            <Select label="Sandbox outcome (testing only)" selectedKey={outcome} onSelectionChange={(key) => setOutcome(String(key))} options={SANDBOX_OUTCOMES} />
          )}
          {error && <p className="text-sm text-danger-emphasis">{error}</p>}
          <p className="text-xs text-text-muted">The customer pays on the card terminal. Card PIN and card details are never entered here.</p>
          <Button variant="primary" size="large" isDisabled={disabled || busy || !chosen || chosen.busy} isLoading={busy}
            onPress={() => act(() => startPosCard(cart.id, { terminalId: chosen!.id, amount: amount.trim() || null, idempotencyKey: startKey.current,
              outcome: chosen?.providerKey === "sandbox" ? outcome : undefined }))}>
            <CreditCard className="size-4" aria-hidden="true" />
            Send {money(currency, sendAmount)} to terminal
          </Button>
        </>
      ) : (
        <p className="text-sm text-text-muted">No card terminal is connected at this outlet.</p>
      )}
      {data?.standaloneEnabled && machines.length > 0 && (
        <details className="rounded-[var(--radius-control)] border border-border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">Standalone card machine</summary>
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-xs text-text-muted">Collect {money(currency, sendAmount)} on the external machine, then record its approval. A printed slip is not bank verification; it is checked against the settlement.</p>
            <Select label="Card machine" selectedKey={standalone.terminalId ?? machines[0].id} onSelectionChange={(key) => setStandalone((value) => ({ ...value, terminalId: key ? String(key) : null }))}
              options={machines.map((terminal) => ({ value: terminal.id, label: terminal.name }))} />
            <TextField label="Approval reference" value={standalone.reference} onChange={(reference) => setStandalone((value) => ({ ...value, reference }))} maxLength={40} />
            <TextField label="Card last four (optional)" inputMode="numeric" value={standalone.lastFour} maxLength={4}
              onChange={(lastFour) => /^\d{0,4}$/.test(lastFour) && setStandalone((value) => ({ ...value, lastFour }))} />
            <Checkbox isSelected={standalone.attested} onChange={(attested) => setStandalone((value) => ({ ...value, attested }))}>
              The machine showed this payment as approved for {money(currency, sendAmount)}
            </Checkbox>
            <Button variant="secondary" isDisabled={busy || disabled || !standalone.attested || standalone.reference.trim().length < 4}
              onPress={() => act(() => recordStandaloneCard(cart.id, { terminalId: standalone.terminalId ?? machines[0].id, amount: amount.trim() || null, reference: standalone.reference.trim(),
                attested: true, cardLastFour: standalone.lastFour.length === 4 ? standalone.lastFour : null, idempotencyKey: startKey.current }))}>
              Record approved terminal payment
            </Button>
          </div>
        </details>
      )}
    </div>
  );
}

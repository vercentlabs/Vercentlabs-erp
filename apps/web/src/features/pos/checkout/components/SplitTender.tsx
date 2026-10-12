"use client";

// Split payment: one bill, up to three tenders (cash, card, UPI — one of each), one sale. The cashier plans the parts (the remaining amount
// in one tap), then collects them one at a time — electronic first, cash last — each through its own method. The screen shows what is
// confirmed, what is pending and what is still to confirm, straight from the server, and asks again while a part is in progress. A part that
// has started is locked; a failed part can be replaced; "Paid" appears only when the sale is finalised. Cancelling compensates every part
// already collected (refunds through the provider, cash handed back and confirmed) before the bill is free again.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button, Checkbox, IconButton, Select, StatusBadge, TextField } from "@vercentlabs/design-system";
import type { PosCart } from "@vercentlabs/api";

import { money } from "@/features/pos/shared/format";
import { PosApiError } from "@/features/pos/shared/http";

import {
  cancelPosCard, cancelPosSplit, collectPosSplitPart, finalizePosSplit, getPosCardOptions, getPosSplit, getPosUpiAttempt, savePosSplit, type PosSplitComponent,
} from "../api/checkout-api";

export type SplitCompleted = { saleId: string; receiptNumber: string; grandTotal: string; changeTotal: string; cashReceived: null };
type Row = { method: "cash" | "card" | "upi"; amount: string };
const LABEL: Record<string, string> = { cash: "Cash", card: "Card", upi: "UPI" };
const STATUS: Record<PosSplitComponent["status"], { tone: "neutral" | "info" | "warning" | "success" | "danger"; label: string }> = {
  PROPOSED: { tone: "neutral", label: "Planned" }, AWAITING_PAYMENT: { tone: "info", label: "Waiting for payment" }, PROCESSING: { tone: "warning", label: "Processing" },
  CONFIRMED: { tone: "success", label: "Received" }, FAILED: { tone: "danger", label: "Failed" }, UNKNOWN: { tone: "warning", label: "Checking status" },
  CANCEL_PENDING: { tone: "warning", label: "Cancelling" }, CANCELLED: { tone: "neutral", label: "Cancelled" }, REVERSAL_REQUIRED: { tone: "danger", label: "Refund pending" },
  REVERSED: { tone: "neutral", label: "Reversed" }, RECONCILIATION_REQUIRED: { tone: "danger", label: "Needs checking" },
};
const LIVE = ["AWAITING_PAYMENT", "PROCESSING", "UNKNOWN", "CANCEL_PENDING"];

export function SplitTender({ cart, currency, disabled, onCompleted, onCart }: {
  cart: PosCart; currency: string; disabled?: boolean; onCompleted: (sale: SplitCompleted) => void; onCart: () => void;
}) {
  const queryClient = useQueryClient();
  const split = useQuery({
    queryKey: ["pos-split", cart.id], queryFn: () => getPosSplit(cart.id),
    refetchInterval: (query) => (query.state.data?.activeMethod ? 2000 : false),
  });
  const card = useQuery({ queryKey: ["pos-card-options", cart.id, "split"], queryFn: () => getPosCardOptions(cart.id) });
  const data = split.data;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [cashReceived, setCashReceived] = useState("");
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<{ cashOwed: string | null } | null>(null);
  const [cashBack, setCashBack] = useState(false);
  const key = useRef<string>(crypto.randomUUID());

  const active = data?.components.find((component) => component.method === data.activeMethod) ?? null;
  // While a part is being paid, its own state (the UPI QR, the card message) comes from that attempt, asked again by the server.
  const attempt = useQuery({
    queryKey: ["pos-split-attempt", active?.paymentId],
    queryFn: () => getPosUpiAttempt(active!.paymentId!),
    enabled: Boolean(active?.paymentId),
    refetchInterval: 2000,
  });
  useEffect(() => {
    if (attempt.data && !LIVE.includes(attempt.data.status === "EXPIRED" ? "AWAITING_PAYMENT" : attempt.data.status)) void split.refetch();
  }, [attempt.data, split]);
  const completedRef = useRef(onCompleted);
  useEffect(() => { completedRef.current = onCompleted; });
  useEffect(() => {
    if (data?.checkoutStatus === "COMPLETED" && data.saleId) completedRef.current({ saleId: data.saleId, receiptNumber: "", grandTotal: data.payableAmount, changeTotal: "0", cashReceived: null });
  }, [data?.checkoutStatus, data?.saleId, data?.payableAmount]);

  if (!data) return <p className="text-sm text-text-muted">Loading the split…</p>;
  if (!data.splitEnabled) return <p className="text-sm text-text-muted">Split Payments are not enabled.</p>;
  const methods = (["card", "upi", "cash"] as const).filter((method) => data.availableMethods[method]);
  const planned: Row[] = rows ?? (data.components.length
    ? data.components.map((component) => ({ method: component.method, amount: String(Number(component.plannedAmount)) }))
    : methods.slice(0, 2).map((method, index) => ({ method, amount: index === 0 ? "" : "" })));
  const locked = (method: string) => data.components.find((component) => component.method === method)?.locked ?? false;
  const allocated = planned.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const left = Math.round((Number(data.payableAmount) - allocated) * 100) / 100;
  const next = data.components.find((component) => component.method === data.nextMethod) ?? null;
  const owedOnNext = next ? Math.min(Number(next.plannedAmount), Number(data.remainingPayableAmount)) : 0;
  const pending = data.components.filter((component) => LIVE.includes(component.status)).reduce((sum, component) => sum + Number(component.plannedAmount), 0);

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      key.current = crypto.randomUUID();
      setRows(null);
      await queryClient.invalidateQueries({ queryKey: ["pos-split", cart.id] });
      onCart();
    } catch (failure) {
      setError(failure instanceof PosApiError ? failure.message : "No answer from the server. Check the payments' status before doing anything else.");
      void queryClient.invalidateQueries({ queryKey: ["pos-split", cart.id] });
    } finally { setBusy(false); }
  }
  const setRow = (index: number, patch: Partial<Row>) => setRows(planned.map((row, position) => (position === index ? { ...row, ...patch } : row)));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-text-secondary">Total amount to pay</span>
        <span className="text-3xl font-semibold tabular-nums text-text">{money(currency, data.payableAmount)}</span>
      </div>

      <div className="flex flex-col gap-2">
        {planned.map((row, index) => {
          const component = data.components.find((entry) => entry.method === row.method);
          const isLocked = locked(row.method);
          return (
            <div key={`${row.method}-${index}`} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-2">
              <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <Select label="Method" selectedKey={row.method} isDisabled={isLocked || disabled}
                  options={methods.filter((method) => method === row.method || !planned.some((other) => other.method === method)).map((method) => ({ value: method, label: LABEL[method] }))}
                  onSelectionChange={(value) => setRow(index, { method: String(value) as Row["method"] })} />
                <TextField label="Amount" inputMode="decimal" value={row.amount} isDisabled={isLocked || disabled}
                  onChange={(text) => /^\d{0,12}(\.\d{0,2})?$/.test(text) && setRow(index, { amount: text })} />
                <IconButton variant="ghost" aria-label="Remove this part" isDisabled={isLocked || disabled || planned.length <= 1}
                  onPress={() => setRows(planned.filter((_, position) => position !== index))}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                {component ? <StatusBadge tone={STATUS[component.status].tone}>{STATUS[component.status].label}</StatusBadge> : <span className="text-text-muted">Not saved yet</span>}
                {component?.cash && <span className="text-text-muted">Received {money(currency, component.cash.received)} · change {money(currency, component.cash.change)}</span>}
                {!isLocked && left > 0 && (
                  <button type="button" className="underline" onClick={() => setRow(index, { amount: String(Math.round(((Number(row.amount) || 0) + left) * 100) / 100) })}>
                    Use remaining {money(currency, left)}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {planned.length < methods.length && (
          <div>
            <Button variant="ghost" size="compact" isDisabled={disabled}
              onPress={() => setRows([...planned, { method: methods.find((method) => !planned.some((row) => row.method === method))!, amount: left > 0 ? String(left) : "" }])}>
              <Plus className="size-3.5" aria-hidden="true" /> Add a payment method
            </Button>
          </div>
        )}
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary">Planned {money(currency, allocated)} · not yet assigned</span>
          <span className={`font-medium tabular-nums ${left === 0 ? "text-success-emphasis" : left < 0 ? "text-danger-emphasis" : ""}`}>{money(currency, left)}</span>
        </div>
        {rows && (
          <Button variant="secondary" isDisabled={busy || disabled || left < 0 || planned.some((row) => !(Number(row.amount) > 0))}
            onPress={() => act(() => savePosSplit(cart.id, planned.map((row) => ({ method: row.method, amount: row.amount })), data.planVersion))}>
            Save the split
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-[var(--radius-control)] bg-surface-muted p-3 text-sm">
        <div><p className="text-xs text-text-muted">Received</p><p className="font-semibold tabular-nums">{money(currency, data.confirmedAppliedAmount)}</p></div>
        <div><p className="text-xs text-text-muted">Pending</p><p className="font-semibold tabular-nums">{money(currency, pending)}</p></div>
        <div><p className="text-xs text-text-muted">Still to confirm</p><p className="text-lg font-bold tabular-nums">{money(currency, data.remainingPayableAmount)}</p></div>
      </div>
      <p className="text-xs text-text-muted">The bill completes after every part is confirmed.</p>

      {active && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border px-3 py-3 text-sm">
          <div className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" aria-hidden="true" /><span className="font-medium">{LABEL[active.method]} {money(currency, active.plannedAmount)}</span></div>
          <p>{attempt.data?.message ?? "Checking payment status. Do not charge again."}</p>
          {attempt.data?.qr?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- the provider's own QR image, shown as given
            <img src={attempt.data.qr.imageUrl} alt="UPI QR" className="size-48 self-center" />
          ) : attempt.data?.qr?.payload ? (
            <p className="break-all font-mono text-[11px] text-text-muted">{attempt.data.qr.payload} (sandbox: the live provider supplies the QR image)</p>
          ) : null}
          {active.status !== "CANCEL_PENDING" && active.paymentId && (
            <Button variant="ghost" size="compact" isDisabled={busy} onPress={() => act(() => cancelPosCard(active.paymentId!, "Cancelled at the counter"))}>Cancel this payment</Button>
          )}
        </div>
      )}

      {!active && next && !rows && data.checkoutStatus !== "COMPLETED" && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border px-3 py-3">
          <p className="text-sm font-medium">Next: {LABEL[next.method]} {money(currency, owedOnNext)}</p>
          {next.method === "card" && (
            <>
              <Select label="Card terminal" selectedKey={terminalId ?? card.data?.terminals.find((entry) => entry.integrationMode === "integrated" && !entry.busy)?.id ?? null}
                onSelectionChange={(value) => setTerminalId(value ? String(value) : null)}
                options={(card.data?.terminals ?? []).filter((entry) => entry.integrationMode === "integrated").map((entry) => ({ value: entry.id, label: `${entry.name}${entry.busy ? " — busy" : ""}` }))} />
              <Button variant="primary" isDisabled={busy || disabled} isLoading={busy}
                onPress={() => act(() => collectPosSplitPart(cart.id, "card", { terminalId: terminalId ?? card.data?.terminals.find((entry) => entry.integrationMode === "integrated" && !entry.busy)?.id,
                  idempotencyKey: key.current }))}>
                Send {money(currency, owedOnNext)} to terminal
              </Button>
            </>
          )}
          {next.method === "upi" && (
            <Button variant="primary" isDisabled={busy || disabled} isLoading={busy} onPress={() => act(() => collectPosSplitPart(cart.id, "upi", { idempotencyKey: key.current }))}>
              Show UPI QR for {money(currency, owedOnNext)}
            </Button>
          )}
          {next.method === "cash" && (
            <>
              <TextField label="Cash received" inputMode="decimal" value={cashReceived} onChange={(text) => /^\d{0,12}(\.\d{0,2})?$/.test(text) && setCashReceived(text)} />
              {Number(cashReceived) > owedOnNext && <p className="text-lg font-bold">Change to give {money(currency, Number(cashReceived) - owedOnNext)}</p>}
              <Button variant="primary" isDisabled={busy || disabled || !(Number(cashReceived) >= owedOnNext)} isLoading={busy}
                onPress={() => act(() => collectPosSplitPart(cart.id, "cash", { cashReceived, idempotencyKey: key.current }))}>
                Confirm cash received
              </Button>
            </>
          )}
        </div>
      )}

      {data.canFinalize && <Button variant="primary" size="large" isLoading={busy} onPress={() => act(() => finalizePosSplit(cart.id))}>Complete sale</Button>}
      {error && <p className="text-sm text-danger-emphasis">{error}</p>}

      {data.components.some((component) => component.locked) && data.checkoutStatus !== "COMPLETED" && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          {!cancelling ? (
            <Button variant="ghost" isDisabled={busy} onPress={() => setCancelling({ cashOwed: data.components.find((component) => component.method === "cash" && component.status === "CONFIRMED")?.appliedAmount ?? null })}>
              Cancel this payment and give the money back
            </Button>
          ) : (
            <>
              <p className="text-sm">Card and UPI parts are refunded to the customer through the provider.{cancelling.cashOwed ? ` Hand back ${money(currency, cancelling.cashOwed)} in cash.` : ""}</p>
              {cancelling.cashOwed && <Checkbox isSelected={cashBack} onChange={setCashBack}>I have handed the cash back</Checkbox>}
              <div className="flex gap-2">
                <Button variant="secondary" isDisabled={busy || (Boolean(cancelling.cashOwed) && !cashBack)} isLoading={busy}
                  onPress={() => act(async () => {
                    const result = await cancelPosSplit(cart.id, { reason: "Customer did not complete the payment", cashReturned: cashBack });
                    if (result.status !== "CANCELLED") setError(result.message ?? "Some payments still need to be reversed.");
                    else setCancelling(null);
                  })}>
                  Reverse the payments
                </Button>
                <Button variant="ghost" onPress={() => setCancelling(null)}>Back</Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

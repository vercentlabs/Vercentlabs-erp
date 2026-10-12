"use client";

// UPI at checkout. The provider's dynamic QR for exactly what is due, with the merchant name and amount, until it expires; the screen asks
// the server (which asks the provider) every two seconds and shows the sale as paid only when the provider confirmed the payment and the
// sale was finalised. There is no "mark as paid": a screenshot, an app's success screen or a payment speaker is not proof. An expired QR is
// checked before a new one can be made (cancel it first), so a customer is never asked to pay twice. Where enabled: a payment link (sent
// with the customer's consent) and the shop's verified static QR, recorded with the UTR as an attested payment.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, QrCode } from "lucide-react";
import { Button, Checkbox, Select, StatusBadge, TextField } from "@vercentlabs/design-system";
import type { PosCart } from "@vercentlabs/api";

import { money } from "@/features/pos/shared/format";
import { PosApiError } from "@/features/pos/shared/http";

import {
  cancelPosUpi, createPosPaymentLink, getPosUpiAttempt, getPosUpiOptions, recordStaticUpi, startPosUpiQr, type PosDigitalAttempt,
} from "../api/checkout-api";

export type UpiCompleted = { saleId: string; receiptNumber: string; grandTotal: string; changeTotal: string; cashReceived: null };
const LIVE = ["CREATED", "AWAITING_CUSTOMER", "PROCESSING", "AUTHORIZED", "CAPTURE_PENDING", "UNKNOWN", "CANCEL_PENDING", "EXPIRED"];
const HEADLINE: Record<string, { tone: "info" | "warning" | "success" | "danger" | "neutral"; label: string }> = {
  CREATED: { tone: "info", label: "Creating the QR" }, AWAITING_CUSTOMER: { tone: "info", label: "Waiting for payment confirmation" },
  PROCESSING: { tone: "warning", label: "Processing" }, UNKNOWN: { tone: "warning", label: "Checking payment status" }, EXPIRED: { tone: "warning", label: "QR expired — checking" },
  CAPTURED: { tone: "success", label: "Payment confirmed" }, FAILED: { tone: "danger", label: "Not completed" }, DECLINED: { tone: "danger", label: "Not approved" },
  CANCEL_PENDING: { tone: "warning", label: "Cancelling" }, CANCELLED: { tone: "neutral", label: "Cancelled" }, RECONCILIATION_REQUIRED: { tone: "danger", label: "Needs checking" },
  EXTERNALLY_ATTESTED: { tone: "warning", label: "Recorded — awaiting settlement" },
};
const SANDBOX_OUTCOMES = [{ value: "", label: "Simulate: normal (wait for the customer)" }, { value: "timeout", label: "Simulate: no answer (unknown)" }];

function useCountdown(expiresAt: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const left = Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

export function UpiTender({ cart, currency, disabled, onCompleted, onCart }: {
  cart: PosCart; currency: string; disabled?: boolean; onCompleted: (sale: UpiCompleted) => void; onCart: () => void;
}) {
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: ["pos-upi-options", cart.id, cart.version], queryFn: () => getPosUpiOptions(cart.id) });
  const [attempt, setAttempt] = useState<PosDigitalAttempt | null>(null);
  const [amount, setAmount] = useState("");
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState({ contact: "", consent: false });
  const [staticForm, setStaticForm] = useState({ utr: "", attested: false });
  const key = useRef<string>(crypto.randomUUID());
  const current = attempt ?? options.data?.attempt ?? null;
  const live = useQuery({
    queryKey: ["pos-upi-attempt", current?.attemptId],
    queryFn: () => getPosUpiAttempt(current!.attemptId),
    enabled: Boolean(current && (LIVE.includes(current.status) || (current.status === "CAPTURED" && current.checkoutStatus !== "COMPLETED" && !current.finalizationError))),
    refetchInterval: 2000,
  });
  const shown = live.data && current && live.data.attemptId === current.attemptId ? live.data : current;
  const countdown = useCountdown(shown && LIVE.includes(shown.status) ? shown.expiresAt : null);
  const completedSale = shown?.checkoutStatus === "COMPLETED" && shown.saleId ? shown.saleId : null;
  const completedRef = useRef(onCompleted);
  useEffect(() => { completedRef.current = onCompleted; });
  useEffect(() => {
    if (completedSale) completedRef.current({ saleId: completedSale, receiptNumber: "", grandTotal: cart.grand_total, changeTotal: "0", cashReceived: null });
  }, [completedSale, cart.grand_total]);

  async function act(work: () => Promise<PosDigitalAttempt>) {
    setBusy(true);
    setError(null);
    try {
      setAttempt(await work());
      key.current = crypto.randomUUID();
      void queryClient.invalidateQueries({ queryKey: ["pos-upi-options", cart.id] });
      onCart();
    } catch (failure) {
      setError(failure instanceof PosApiError ? failure.message : "No answer from the server. The payment's status is being checked — do not create another QR.");
      void queryClient.invalidateQueries({ queryKey: ["pos-upi-options", cart.id] });
    } finally { setBusy(false); }
  }

  const data = options.data;
  if (data && !data.enabled) return <p className="text-sm text-text-muted">UPI payments are not available at this counter.</p>;
  const due = data?.amountDue ?? cart.grand_total;
  const askAmount = amount.trim() || due;

  if (shown && !["CANCELLED", "FAILED", "DECLINED"].includes(shown.status)) {
    const headline = HEADLINE[shown.status] ?? { tone: "neutral" as const, label: shown.status };
    const waiting = LIVE.includes(shown.status);
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-text-secondary">{shown.merchantName ?? data?.merchantName ?? "Merchant"} · {money(currency, shown.amount)} · INR</span>
          <StatusBadge tone={headline.tone}>{headline.label}</StatusBadge>
        </div>
        {shown.qr && waiting && shown.status !== "EXPIRED" && (
          <div className="flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-border p-4">
            <p className="text-sm font-medium">Scan to pay {money(currency, shown.amount)}</p>
            {shown.qr.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- the provider's own QR image, shown as given
              <img src={shown.qr.imageUrl} alt={`UPI QR for ${money(currency, shown.amount)}`} className="size-56" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-center">
                <QrCode className="size-16 text-text-muted" aria-hidden="true" />
                <p className="max-w-xs break-all font-mono text-[11px] text-text-muted">{shown.qr.payload}</p>
                <p className="text-xs text-warning-emphasis">The payment provider did not send a QR image (sandbox). A live provider supplies the scannable QR.</p>
              </div>
            )}
            {countdown && <p className="text-xs text-text-muted">Valid for {countdown}</p>}
          </div>
        )}
        {shown.paymentLinkUrl && waiting && <p className="break-all text-sm">Payment link: <span className="font-mono">{shown.paymentLinkUrl}</span></p>}
        <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border px-3 py-3 text-sm">
          {waiting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          <span>{shown.message}</span>
        </div>
        <p className="text-xs text-text-muted">The bill completes only after the payment provider confirms it. A screenshot or a payment sound is not proof.</p>
        {shown.status === "CAPTURED" && Number(shown.remainingAmount ?? 0) > 0 && (
          <p className="text-sm">UPI paid {money(currency, shown.amount)}. {money(currency, shown.remainingAmount)} is still due — take it another way.</p>
        )}
        {shown.status === "RECONCILIATION_REQUIRED" && (
          <p className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger-emphasis">
            The payment does not match this bill (amount, merchant or reference). It has been passed to Finance; the bill stays open until they resolve it.
          </p>
        )}
        {shown.status === "EXTERNALLY_ATTESTED" && <p className="text-xs text-text-muted">Recorded against the shop&apos;s QR. The sale completes when the settlement confirms the UTR.</p>}
        {shown.finalizationError && <p className="text-sm text-danger-emphasis">Paid, but the sale could not be finalised: {shown.finalizationError.message}</p>}
        {error && <p className="text-sm text-danger-emphasis">{error}</p>}
        {waiting && shown.status !== "CANCEL_PENDING" && (
          <div className="flex flex-wrap gap-2">
            {shown.status === "EXPIRED" && <Button variant="secondary" isDisabled={busy} onPress={() => void live.refetch()}>Check status again</Button>}
            <Button variant="ghost" isDisabled={busy} onPress={() => act(() => cancelPosUpi(shown.attemptId, shown.status === "EXPIRED" ? "QR expired" : "Cancelled at the counter"))}>
              {shown.status === "EXPIRED" ? "Cancel it to make a new QR" : "Cancel this request"}
            </Button>
          </div>
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
      {shown && ["FAILED", "DECLINED"].includes(shown.status) && (
        <p className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger-emphasis">{shown.message}</p>
      )}
      <TextField label="UPI amount" description="Leave as it is to pay the whole amount, or enter the UPI part of a split payment." inputMode="decimal"
        value={amount} placeholder={due} onChange={(text) => /^\d{0,12}(\.\d{0,2})?$/.test(text) && setAmount(text)} />
      {data?.modes.dynamicQr ? (
        <>
          <Select label="Sandbox outcome (testing only)" selectedKey={outcome} onSelectionChange={(value) => setOutcome(String(value ?? ""))} options={SANDBOX_OUTCOMES} />
          <Button variant="primary" size="large" isDisabled={disabled || busy} isLoading={busy}
            onPress={() => act(() => startPosUpiQr(cart.id, { amount: amount.trim() || null, idempotencyKey: key.current, outcome: outcome || undefined }))}>
            <QrCode className="size-4" aria-hidden="true" />
            Show UPI QR for {money(currency, askAmount)}
          </Button>
        </>
      ) : (
        <p className="text-sm text-text-muted">The dynamic UPI QR is not set up for this outlet.</p>
      )}
      {error && <p className="text-sm text-danger-emphasis">{error}</p>}
      {data?.modes.paymentLink && (
        <details className="rounded-[var(--radius-control)] border border-border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">Payment link</summary>
          <div className="mt-2 flex flex-col gap-2">
            <TextField label="Customer phone or email (optional)" value={link.contact} onChange={(contact) => setLink((value) => ({ ...value, contact }))} />
            {link.contact.trim() && (
              <Checkbox isSelected={link.consent} onChange={(consent) => setLink((value) => ({ ...value, consent }))}>The customer agreed to receive the link</Checkbox>
            )}
            <Button variant="secondary" isDisabled={busy || disabled || (Boolean(link.contact.trim()) && !link.consent)}
              onPress={() => act(() => createPosPaymentLink(cart.id, { amount: amount.trim() || null, contact: link.contact.trim() || null, consent: link.consent, idempotencyKey: key.current }))}>
              Create payment link for {money(currency, askAmount)}
            </Button>
          </div>
        </details>
      )}
      {data?.modes.staticQr && data.staticQr && (
        <details className="rounded-[var(--radius-control)] border border-border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">Shop&apos;s UPI QR ({data.staticQr.vpa})</summary>
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-xs text-text-muted">The customer pays {money(currency, askAmount)} to {data.staticQr.vpa}. Check the payment reached the shop&apos;s account (not just the customer&apos;s
              screen), then record the UTR. It is checked against the settlement{data.staticQr.provisionalAcceptance ? "; the sale completes now (provisional acceptance)." : " before the sale completes."}</p>
            <TextField label="UTR / transaction reference" value={staticForm.utr} onChange={(utr) => setStaticForm((value) => ({ ...value, utr: utr.toUpperCase() }))} maxLength={35} />
            <Checkbox isSelected={staticForm.attested} onChange={(attested) => setStaticForm((value) => ({ ...value, attested }))}>
              {money(currency, askAmount)} reached the shop&apos;s account
            </Checkbox>
            <Button variant="secondary" isDisabled={busy || disabled || !staticForm.attested || staticForm.utr.trim().length < 6}
              onPress={() => act(() => recordStaticUpi(cart.id, { utr: staticForm.utr.trim(), amount: amount.trim() || null, attested: true, idempotencyKey: key.current }))}>
              Record payment to shop QR
            </Button>
          </div>
        </details>
      )}
    </div>
  );
}

"use client";

// One refund: what is authorized, paid, processing, waiting and still outstanding; each original tender's refund with its own status; and the
// actions its state allows — approve (a supervisor, not the requester), pay (cash when handed over), confirm a cash payout, retry a failed
// provider refund, check a processing one, record a refund made outside the provider, cancel before any money moved, print the
// acknowledgement. The server decides who may do each.
import { useState } from "react";
import { Button, Checkbox, StatusBadge, TextField } from "@vercentlabs/design-system";

import {
  COMPONENT_TONE, REFUND_STATUS_LABEL, REFUND_STATUS_TONE, approveRefund, cancelRefund, confirmRefundCash, executeRefund, recordManualRefund, refreshRefund, refundDocument, retryRefundComponent,
  type PosRefund,
} from "@/features/pos/refunds/api/refunds-api";
import { printHtml } from "@/features/pos/receipts/api/printing-api";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime, money } from "@/features/pos/shared/format";

export function RefundPanel({ refund, onChange }: { refund: PosRefund; onChange: (refund: PosRefund) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [cashHandedOver, setCashHandedOver] = useState(true);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const currency = refund.currency;
  async function run(work: () => Promise<PosRefund | void>, done?: string) {
    setBusy(true);
    setMessage(null);
    try { const next = await work(); if (next) onChange(next); if (done) setMessage({ error: false, text: done }); }
    catch (failure) { setMessage({ error: true, text: failure instanceof PosApiError ? failure.message : "Something went wrong." }); }
    finally { setBusy(false); }
  }
  const pendingCash = refund.components.some((component) => component.route === "cash" && component.status === "PENDING");
  const manualWaiting = refund.components.filter((component) => component.route !== "cash" && ["PENDING", "UNKNOWN"].includes(component.status) && (component.route === "manual" || component.status === "UNKNOWN"));
  const notExecuted = refund.status === "AUTHORIZED";
  const print = () => run(async () => {
    const document = await refundDocument(refund.id);
    const outcome = await printHtml(document.html);
    setMessage({ error: outcome !== "dialog_opened", text: outcome === "dialog_opened" ? "Acknowledgement sent to the print dialog." : "The print dialog did not open." });
  });

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Refund {refund.refundNumber} · {dateTime(refund.createdAt)}{refund.createdBy ? ` · ${refund.createdBy}` : ""}</p>
        <StatusBadge tone={REFUND_STATUS_TONE[refund.status] ?? "neutral"}>{REFUND_STATUS_LABEL[refund.status] ?? refund.status}</StatusBadge>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
        {[["Authorized", refund.authorizedAmount], ["Refunded", refund.paid], ["Processing", refund.processing], ["Waiting", refund.waiting], ["Outstanding", refund.outstanding]].map(([label, value]) => (
          <div key={label}><dt className="text-xs text-text-muted">{label}</dt><dd className="tabular-nums">{money(currency, value)}</dd></div>
        ))}
      </dl>
      <ul className="flex flex-col gap-1 text-sm">{refund.components.map((component) => (
        <li key={component.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-1">
          <span>{component.method} {money(currency, component.amount)} · {component.customerStatus}{component.providerReference ? ` · ${component.providerReference}` : ""}{component.error ? ` — ${component.error}` : ""}</span>
          <span className="flex items-center gap-2">
            {component.status === "FAILED" && component.route === "provider" && (
              <Button size="compact" variant="secondary" isDisabled={busy} onPress={() => run(() => retryRefundComponent(refund.id, component.id), "Sent again.")}>Retry</Button>
            )}
            <StatusBadge tone={COMPONENT_TONE[component.status] ?? "neutral"}>{component.status.replace(/_/g, " ").toLowerCase()}</StatusBadge>
          </span>
        </li>
      ))}</ul>
      {refund.status === "AWAITING_APPROVAL" && (
        <div className="flex flex-wrap items-end gap-2">
          <p className="w-full text-sm text-warning-emphasis">Above the requester&apos;s refund limit: a supervisor (not the requester) must approve.</p>
          <Button variant="primary" isLoading={busy} onPress={() => run(() => approveRefund(refund.id, refund.version), "Approved.")}>Approve refund</Button>
        </div>
      )}
      {notExecuted && (
        <div className="flex flex-col gap-2">
          {refund.components.some((component) => component.route === "cash") && <Checkbox isSelected={cashHandedOver} onChange={setCashHandedOver}>I am handing the cash to the customer now</Checkbox>}
          <div><Button variant="primary" isLoading={busy} onPress={() => run(() => executeRefund(refund.id, cashHandedOver), "Refund started.")}>Refund now</Button></div>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        {!notExecuted && pendingCash && <Button variant="primary" isLoading={busy} onPress={() => run(() => confirmRefundCash(refund.id), "Cash refund recorded.")}>Cash handed to the customer</Button>}
        {["PROCESSING", "PARTIALLY_REFUNDED", "RECONCILIATION_REQUIRED"].includes(refund.status) && (
          <Button variant="secondary" isLoading={busy} onPress={() => run(() => refreshRefund(refund.id), "Status checked.")}>Check status</Button>
        )}
        {manualWaiting.length > 0 && !notExecuted && (
          <>
            <TextField label="Reference of the refund made outside the provider (reconciliation)" value={reference} onChange={setReference} maxLength={80} className="sm:max-w-sm" />
            <Button variant="secondary" isLoading={busy} isDisabled={!reference.trim()} onPress={() => run(() => recordManualRefund(refund.id, manualWaiting[0].id, reference.trim()), "Refund recorded.")}>Record refund</Button>
          </>
        )}
        <Button variant="ghost" isDisabled={busy} onPress={print}>Print acknowledgement</Button>
      </div>
      {["AUTHORIZED", "AWAITING_APPROVAL"].includes(refund.status) && (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-2">
          <TextField label="Cancel reason" value={reason} onChange={setReason} maxLength={300} className="sm:max-w-sm" />
          <Button variant="ghost" size="compact" isDisabled={busy || !reason.trim()} onPress={() => run(() => cancelRefund(refund.id, reason.trim(), refund.version), "Refund cancelled.")}>Cancel refund</Button>
        </div>
      )}
      {refund.exceptions.filter((entry) => entry.status !== "RESOLVED").map((entry) => (
        <p key={entry.id} className="text-sm text-warning-emphasis">{entry.type.replace(/_/g, " ").toLowerCase()}: {entry.detail}</p>
      ))}
      {message && <p role="status" className={`text-sm ${message.error ? "text-danger-emphasis" : "text-text-muted"}`}>{message.text}</p>}
    </div>
  );
}

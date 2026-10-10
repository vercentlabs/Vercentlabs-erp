"use client";

// After a sale: the digital receipts the customer agreed to are sent once, and each one's real outcome is shown — sent, failed, or not
// configured (no mail transport / no SMS provider). A receipt can also be sent to an address given now, with the customer's agreement.
// Nothing here changes the sale.
import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, StatusBadge, TextField } from "@vercentlabs/design-system";

import { PosApiError } from "@/features/pos/shared/http";

import { sendPosReceipts, type PosReceiptDelivery } from "../api/checkout-api";

const STATUS = { sent: ["Sent", "success"], failed: ["Failed", "danger"], not_configured: ["Not configured", "warning"], pending: ["Waiting", "neutral"] } as const;

export function DigitalReceipts({ saleId }: { saleId: string }) {
  const [deliveries, setDeliveries] = useState<PosReceiptDelivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [consent, setConsent] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    sendPosReceipts(saleId).then(setDeliveries).catch((failure) => setError(failure instanceof PosApiError ? failure.message : "Receipts could not be sent."));
  }, [saleId]);

  async function sendExtra() {
    const value = destination.trim();
    try {
      setDeliveries(await sendPosReceipts(saleId, { channel: value.includes("@") ? "email" : "sms", destination: value, consent }));
      setDestination("");
      setConsent(false);
      setError(null);
    } catch (failure) {
      setError(failure instanceof PosApiError ? failure.message : "The receipt could not be sent.");
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3 text-left">
      <p className="text-sm font-medium text-text">Digital receipt</p>
      {deliveries && deliveries.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {deliveries.map((delivery) => (
            <li key={delivery.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{delivery.channel === "sms" ? "SMS" : "Email"} to {delivery.destination}</span>
              <StatusBadge tone={STATUS[delivery.status][1]}>{STATUS[delivery.status][0]}</StatusBadge>
            </li>
          ))}
        </ul>
      ) : deliveries ? (
        <p className="text-xs text-text-muted">No digital receipt was requested. The printed receipt needs no customer details.</p>
      ) : null}
      {deliveries?.some((delivery) => delivery.status === "not_configured") && (
        <p className="text-xs text-warning">Not sent: no delivery channel is set up for this workspace. Print the receipt instead.</p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <TextField label="Send to (email or mobile)" value={destination} onChange={setDestination} className="min-w-48 flex-1" />
        <Button variant="secondary" size="compact" isDisabled={!destination.trim() || !consent} onPress={() => void sendExtra()}>Send</Button>
      </div>
      <Checkbox isSelected={consent} onChange={setConsent} isDisabled={!destination.trim()}>The customer agreed to receive the receipt there</Checkbox>
    </div>
  );
}

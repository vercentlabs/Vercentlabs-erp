"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, Surface } from "@/shared/design";

export default function SalesDocumentActions({
  type,
  id,
  status,
}: {
  type: "quotation" | "order";
  id: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setPending(true);
    setMessage("");
    try {
      const endpoint =
        type === "quotation"
          ? `/api/sales/quotations/${id}/actions`
          : `/api/sales/orders/${id}/actions`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.message);
      if (action === "send" && data.result?.token)
        setMessage(`Customer link: ${location.origin}/quote/${data.result.token}`);
      else setMessage("Action completed.");
      if (action === "convert" && data.result?.orderId)
        router.push(`/sales/orders/${data.result.orderId}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Surface as="section" className="sales-command-bar">
      <div>
        <p className="eyebrow">Document actions</p>
        {message ? (
          <p className="sales-action-message">{message}</p>
        ) : (
          <p>Every action is permission checked and added to the document history.</p>
        )}
      </div>
      <div className="sales-actions">
        {type === "quotation" && status === "draft" ? (
          <ActionButton tone="primary" busy={pending} onClick={() => act("submit")}>
            Submit
          </ActionButton>
        ) : null}
        {type === "quotation" && status === "approved" ? (
          <ActionButton
            tone="primary"
            busy={pending}
            onClick={() => act("send", { expiresInDays: 30 })}
          >
            Send securely
          </ActionButton>
        ) : null}
        {type === "quotation" && status === "accepted" ? (
          <ActionButton tone="primary" busy={pending} onClick={() => act("convert")}>
            Create sales order
          </ActionButton>
        ) : null}
        {type === "order" && status === "draft" ? (
          <ActionButton tone="primary" busy={pending} onClick={() => act("confirm")}>
            Confirm order
          </ActionButton>
        ) : null}
        {type === "order" && status === "confirmed" ? (
          <>
            <ActionButton
              busy={pending}
              onClick={() => act("request_fulfillment", { idempotencyKey: crypto.randomUUID() })}
            >
              Request fulfilment
            </ActionButton>
            <ActionButton
              busy={pending}
              onClick={() =>
                act("request_invoice", {
                  idempotencyKey: crypto.randomUUID(),
                  quantityBasis: "ordered",
                })
              }
            >
              Request invoice
            </ActionButton>
            <ActionButton
              busy={pending}
              onClick={() =>
                act("hold", { holdType: "commercial", reason: "Manual commercial review" })
              }
            >
              Place hold
            </ActionButton>
          </>
        ) : null}
        {type === "order" && status === "on_hold" ? (
          <ActionButton disabled>Release from the active hold record</ActionButton>
        ) : null}
        {type === "order" && (status === "confirmed" || status === "on_hold") ? (
          <ActionButton busy={pending} onClick={() => act("close")}>
            Close order
          </ActionButton>
        ) : null}
      </div>
    </Surface>
  );
}

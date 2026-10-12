"use client";

// A posted return's refunds: each refund with its tenders and actions, and — while the return still owes money — "Refund customer": the
// preview of the split across the original payment methods, then the refund (paid now within your limit, cash when you hand it over).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox } from "@vercentlabs/design-system";
import type { PosReturn } from "@vercentlabs/api";

import { getRefund, previewReturnRefund, refundReturn } from "@/features/pos/refunds/api/refunds-api";
import { RefundPanel } from "@/features/pos/refunds/components/RefundPanel";
import { PosApiError } from "@/features/pos/shared/http";
import { money } from "@/features/pos/shared/format";
import { PosPanel } from "@/features/pos/shared/PosUi";

export function ReturnRefunds({ posReturn, onReturn }: { posReturn: PosReturn; onReturn: () => void }) {
  const queryClient = useQueryClient();
  const refunds = useQuery({ queryKey: ["pos-return-refunds", posReturn.id, posReturn.refundIds.join(","), posReturn.refundStatus], queryFn: () => Promise.all(posReturn.refundIds.map(getRefund)) });
  const owes = Number(posReturn.refundRemaining ?? 0) > 0;
  const preview = useQuery({ queryKey: ["pos-return-refund-preview", posReturn.id, posReturn.refundRemaining], queryFn: () => previewReturnRefund(posReturn.id), enabled: owes, retry: false });
  const [cashHandedOver, setCashHandedOver] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const currency = posReturn.currency;
  async function start() {
    setBusy(true);
    setError(null);
    try { await refundReturn(posReturn.id, { cashRefundConfirmed: cashHandedOver, idempotencyKey }); onReturn(); }
    catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Could not refund."); } finally { setBusy(false); }
  }
  return (
    <PosPanel title="Refunds" description="Each original payment method is refunded through its own route; a refund still processing is never sent again.">
      {(refunds.data ?? []).map((refund) => (
        <RefundPanel key={refund.id} refund={refund} onChange={(next) => { queryClient.setQueryData(["pos-return-refunds", posReturn.id, posReturn.refundIds.join(","), posReturn.refundStatus],
          (refunds.data ?? []).map((row) => (row.id === next.id ? next : row))); onReturn(); }} />
      ))}
      {owes && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-dashed border-border p-3">
          <p className="text-sm font-medium">Refund customer · {money(currency, posReturn.refundRemaining)} still owed</p>
          {preview.data && (
            <p className="text-sm">To the original payment methods: {preview.data.components.map((component) => `${component.method} ${money(currency, component.amount)}`).join(" · ")}
              {preview.data.approvalRequired ? " — above your refund limit: a supervisor will approve it." : ""}</p>
          )}
          {preview.error && <p className="text-sm text-danger-emphasis">{preview.error instanceof PosApiError ? preview.error.message : "Could not prepare the refund."}</p>}
          {preview.data?.components.some((component) => component.method === "CASH") && <Checkbox isSelected={cashHandedOver} onChange={setCashHandedOver}>I am handing the cash to the customer now</Checkbox>}
          <div><Button variant="primary" isLoading={busy} isDisabled={!preview.data} onPress={start}>Confirm &amp; refund</Button></div>
          {error && <p className="text-sm text-danger-emphasis">{error}</p>}
        </div>
      )}
      {!owes && !(refunds.data ?? []).length && <p className="text-sm text-text-muted">No refund is owed on this return.</p>}
    </PosPanel>
  );
}

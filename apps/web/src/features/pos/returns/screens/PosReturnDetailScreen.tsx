"use client";

// One return: what comes back (reason, condition, where the goods go, the original price, discounts and tax given back), its exceptions and
// approval, and — once posted — each refund with its own status. The actions offered follow the return's state; the server decides who may
// do each (approving needs a supervisor who did not start it; inspection and releasing held stock need a supervisor).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ErrorState, PageHeader, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import {
  CONDITION_LABEL, DISPOSITION_LABEL, REASON_LABEL, REFUND_LABEL, REFUND_TONE, STATUS_LABEL, STATUS_TONE, approveReturn, cancelReturn, getReturn, inspectReturn, postReturn,
  rejectReturn, releaseStock, requestApproval, type PosReturn,
} from "@/features/pos/returns/api/returns-api";
import { ReceiptPrintActions } from "@/features/pos/receipts/components/ReceiptPrintActions";
import { ReturnRefunds } from "@/features/pos/refunds/components/ReturnRefunds";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosBackLink, PosLoading, PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function PosReturnDetailScreen({ returnId }: { returnId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "pos", "return", returnId);
  const query = useQuery({ queryKey: key, queryFn: () => getReturn(returnId) });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [cashHandedOver, setCashHandedOver] = useState(true);
  const [note, setNote] = useState("");
  const [inspection, setInspection] = useState<Record<string, string>>({});
  const [postKey] = useState(() => crypto.randomUUID());

  async function run(work: () => Promise<PosReturn>, done?: string) {
    setBusy(true);
    setMessage(null);
    try {
      const next = await work();
      queryClient.setQueryData(key, next);
      if (done) setMessage({ error: false, text: done });
    } catch (failure) {
      setMessage({ error: true, text: failure instanceof PosApiError ? failure.message : "Something went wrong." });
      void query.refetch();
    } finally { setBusy(false); }
  }

  if (query.isLoading) return <PosLoading label="Loading return…" />;
  if (query.isError || !query.data) return <ErrorState title="Could not load this return" description={query.error instanceof PosApiError ? query.error.message : undefined} />;
  const r = query.data;
  const currency = r.currency;
  const open = ["DRAFT", "AWAITING_APPROVAL", "AWAITING_INSPECTION", "APPROVED"].includes(r.status);
  const hasCash = (r.refundAllocation ?? []).some((entry) => entry.method === "cash");
  const heldLines = r.lines.filter((line) => line.dispositionCode === "return_hold" || (r.status === "AWAITING_INSPECTION" && line.dispositionCode !== "not_applicable"));

  return (
    <div className="flex flex-col gap-4">
      <PosBackLink href="/pos/returns">Back to returns</PosBackLink>
      <PageHeader
        title={`Return ${r.returnNumber}`}
        description={`Against ${r.invoiceNumber ?? r.receiptNumber} of ${dateTime(r.saleDate)} · started ${dateTime(r.createdAt)} by ${r.requestedBy ?? "—"}${r.crossOutlet ? " · another outlet's sale" : ""}`}
        secondaryActions={
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={STATUS_TONE[r.status] ?? "neutral"}>{STATUS_LABEL[r.status] ?? r.status}</StatusBadge>
            {r.status === "POSTED" && <StatusBadge tone={REFUND_TONE[r.refundStatus] ?? "neutral"}>{`Refund: ${REFUND_LABEL[r.refundStatus] ?? r.refundStatus}`}</StatusBadge>}
            {!r.receiptPresent && <StatusBadge tone="warning">No receipt</StatusBadge>}
            {r.returnType === "full" && <StatusBadge tone="neutral">Full return</StatusBadge>}
          </div>
        }
      />
      {message && <p role="status" className={`text-sm ${message.error ? "text-danger-emphasis" : "text-text-muted"}`}>{message.text}</p>}

      <PosPanel title="Returned items">
        <table className="w-full text-sm">
          <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Item</th><th className="pb-1 text-left">Reason</th><th className="pb-1 text-left">Condition</th>
            <th className="pb-1 text-left">Goods go to</th><th className="pb-1 text-right">Discount back</th><th className="pb-1 text-right">Taxable</th><th className="pb-1 text-right">Tax</th>
            <th className="pb-1 text-right">Refund</th></tr></thead>
          <tbody>{r.lines.map((line) => (
            <tr key={line.id} className="border-t border-border align-top">
              <td className="py-1.5">{line.description} × {line.quantity}{line.uom ? ` ${line.uom}` : ""}{line.serial ? ` · S/N ${line.serial}` : ""}{line.batch ? ` · batch ${line.batch}` : ""}</td>
              <td>{REASON_LABEL[line.reasonCode ?? ""] ?? "—"}{line.reasonNote ? ` — ${line.reasonNote}` : ""}</td>
              <td>{CONDITION_LABEL[line.conditionCode ?? ""] ?? "—"}</td>
              <td>
                {DISPOSITION_LABEL[line.dispositionCode ?? ""] ?? "—"}
                {line.releasedDisposition && <span className="block text-xs text-text-muted">Released: {DISPOSITION_LABEL[line.releasedDisposition]}</span>}
                {r.status === "POSTED" && line.dispositionCode === "return_hold" && !line.releasedDisposition && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    <Button size="compact" variant="secondary" isDisabled={busy} onPress={() => run(() => releaseStock(r.id, line.id, "restock_approved"), "Released to sellable stock.")}>Restock</Button>
                    <Button size="compact" variant="ghost" isDisabled={busy} onPress={() => run(() => releaseStock(r.id, line.id, "damaged"), "Moved to damaged stock.")}>Damaged</Button>
                  </span>
                )}
              </td>
              <td className="text-right tabular-nums">{money(currency, line.discount)}</td>
              <td className="text-right tabular-nums">{money(currency, line.taxableAmount)}</td>
              <td className="text-right tabular-nums">{money(currency, line.taxAmount)}</td>
              <td className="text-right tabular-nums">{money(currency, line.refundAmount)}</td>
            </tr>
          ))}</tbody>
        </table>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div><dt className="text-xs text-text-muted">Value before tax</dt><dd className="tabular-nums">{money(currency, r.returnValue)}</dd></div>
          <div><dt className="text-xs text-text-muted">Tax reversed</dt><dd className="tabular-nums">{money(currency, r.taxAdjustment)}</dd></div>
          <div><dt className="text-xs text-text-muted">Refund due</dt><dd className="text-base font-semibold tabular-nums">{money(currency, r.refundDue)}</dd></div>
        </dl>
        {r.creditNoteNumber && <p className="text-sm">Credit note <span className="font-medium">{r.creditNoteNumber}</span> issued against the original invoice.</p>}
      </PosPanel>

      {r.exceptions.length > 0 && (
        <PosPanel title="Exceptions">
          <ul className="text-sm">{r.exceptions.map((entry) => (
            <li key={entry.code}>{entry.label}{entry.overridden ? ` — overridden: ${r.overrideReason}` : r.approvalRequired ? " — needs a supervisor's approval" : r.approvedBy ? ` — approved by ${r.approvedBy}` : ""}</li>
          ))}</ul>
        </PosPanel>
      )}

      {open && (
        <PosPanel title="Next step">
          {r.status === "AWAITING_INSPECTION" && (
            <div className="flex flex-col gap-2">
              <p className="text-sm">Inspect the goods on hold and decide where they go before the refund.</p>
              {heldLines.map((line) => (
                <Select key={line.id} label={line.description} className="sm:max-w-sm" selectedKey={inspection[line.id] ?? undefined} onSelectionChange={(value) => setInspection((all) => ({ ...all, [line.id]: String(value) }))}
                  options={["restock_approved", "damaged", "quarantined", "rejected_not_received"].map((code) => ({ value: code, label: DISPOSITION_LABEL[code] }))} />
              ))}
              <div><Button variant="primary" isLoading={busy} isDisabled={heldLines.some((line) => !inspection[line.id])}
                onPress={() => run(() => inspectReturn(r.id, heldLines.map((line) => ({ lineId: line.id, dispositionCode: inspection[line.id] })), r.version), "Inspection recorded.")}>Record inspection</Button></div>
            </div>
          )}
          {r.approvalRequired && r.status === "DRAFT" && (
            <div><Button variant="secondary" isLoading={busy} onPress={() => run(() => requestApproval(r.id, r.version), "Sent for approval.")}>Ask a supervisor to approve</Button></div>
          )}
          {r.approvalRequired && (
            <div className="flex flex-wrap items-end gap-2">
              <TextField label="Approval note (supervisor)" value={note} onChange={setNote} maxLength={300} className="sm:max-w-sm" />
              <Button variant="primary" isLoading={busy} onPress={() => run(() => approveReturn(r.id, r.version, note || undefined), "Approved.")}>Approve</Button>
              <Button variant="ghost" isLoading={busy} isDisabled={!note.trim()} onPress={() => run(() => rejectReturn(r.id, note.trim(), r.version), "Rejected.")}>Reject (note is the reason)</Button>
            </div>
          )}
          {!r.approvalRequired && ["DRAFT", "APPROVED"].includes(r.status) && (
            <div className="flex flex-col gap-2">
              {(r.refundAllocation ?? []).length > 0 && (
                <p className="text-sm">Refund to the original payment methods: {r.refundAllocation!.map((entry) => `${entry.method.toUpperCase()} ${money(currency, entry.amount)}`).join(" · ")}</p>
              )}
              {hasCash && <Checkbox isSelected={cashHandedOver} onChange={setCashHandedOver}>I am handing the cash refund to the customer now</Checkbox>}
              <div><Button variant="primary" isLoading={busy} onPress={() => run(() => postReturn(r.id, r.version, hasCash && cashHandedOver, postKey), "Return posted.")}>Post return</Button></div>
            </div>
          )}
          <div className="border-t border-border pt-2">
            <Button variant="ghost" size="compact" isDisabled={busy} onPress={() => run(() => cancelReturn(r.id, undefined, r.version), "Return cancelled; its items can be returned again.")}>Cancel return</Button>
          </div>
        </PosPanel>
      )}

      {r.status === "POSTED" && <ReturnRefunds posReturn={r} onReturn={() => { void query.refetch(); }} />}

      {r.status === "POSTED" && (
        <PosPanel title={r.creditNoteNumber ? "Credit note & return receipt" : "Return receipt"}>
          <ReceiptPrintActions source="pos_return" sourceId={r.id} />
        </PosPanel>
      )}
      {r.status === "REJECTED" && <p className="text-sm text-text-muted">Rejected: {r.rejectionReason}</p>}
    </div>
  );
}

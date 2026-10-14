"use client";

// One finished-goods receipt: its order and product, where the goods come from and go, each production entry received from (with its lot or
// serial units), the cost it carries out of work in progress, the approval of another warehouse, the posting (Inventory movements, Finance),
// corrections and the timeline. The toolbar offers only what the receipt's state and the person's permissions allow. Posting asks first and
// re-checks everything on the server; a retry finds the posted receipt. A posted receipt is never edited: a correction is requested and
// someone else approves it, which reverses the whole receipt.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PermissionState, RecordDetailsPage, StatusBadge } from "@vercentlabs/design-system";

import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, inr, qty } from "@/features/manufacturing/orders/api/mo-api";
import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import {
  FGR_BASE, RECEIPT_TONE, getReceipt, previewReceipt, receiptAction, receiptPostingStatus, type FinishedGoodsReceipt, type ReceiptPostingCheck, type ReceiptPreview,
} from "../api/fgr-api";

export function FinishedGoodsReceiptDetailScreen({ receiptId }: { receiptId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const key = scopedQueryKey(workspace, "manufacturing", "finished-goods-receipt", receiptId);
  const query = useQuery({ queryKey: key, queryFn: () => getReceipt(receiptId), retry: false });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [preview, setPreview] = useState<ReceiptPreview | null>(null);
  const [check, setCheck] = useState<ReceiptPostingCheck | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (query.isLoading) return <LoadingState label="Loading the receipt" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to finished-goods receipts" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the receipt" description={errorMessage(query.error)} />;
  }
  const receipt = query.data;
  const can = receipt.can;
  const refresh = async (next?: FinishedGoodsReceipt) => {
    if (next) queryClient.setQueryData(key, next);
    await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
  };
  // Every action: the receipt it returns refreshes the page; a refusal shows its reason.
  const perform = async (work: () => Promise<unknown>, text: string) => {
    setBusy(true);
    try {
      const result = await work() as { receipt?: FinishedGoodsReceipt };
      await refresh(result?.receipt);
      setMessage({ tone: "success", text });
      setPreview(null);
    } catch (failure) {
      setMessage({ tone: "danger", text: errorMessage(failure) });
      throw failure;
    } finally { setBusy(false); }
  };
  const quiet = (work: () => Promise<unknown>, text: string) => perform(work, text).catch(() => undefined);
  const runPreview = async () => {
    setBusy(true);
    try { setPreview(await previewReceipt(receipt.id)); setMessage(null); } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
  };
  const runCheck = async () => {
    setBusy(true);
    try { setCheck(await receiptPostingStatus(receipt.id)); } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
  };
  const place = (where: FinishedGoodsReceipt["destination"]) => `${where.warehouse?.code ?? "—"}${where.location ? ` / ${where.location.code}` : ""}`;
  const post = () => setAsk({
    title: `Post ${receipt.number}`, confirm: "Receive into stock",
    description: `${qty(receipt.totals.quantity)} ${receipt.totals.uom} of ${receipt.item.code} from ${receipt.order.number} go into ${place(receipt.destination)}. `
      + "Inventory receives them and their material value moves from work in progress to finished goods. Every line posts or none does; a posted receipt is never edited — a mistake is corrected by an approved reversal.",
    fields: [], run: () => perform(() => receiptAction(receipt.id, "post", { expectedVersion: receipt.rowVersion, expectedMoVersion: receipt.order.version }), "Posted: the goods are in stock."),
  });
  const open = receipt.corrections.find((row) => row.status === "REQUESTED") ?? null;

  const toolbar = (
    <div className="flex flex-wrap gap-2">
      {can.edit && <Button size="compact" variant="secondary" onPress={() => router.push(`${FGR_BASE}/${receipt.id}/edit`)}>Edit draft</Button>}
      {(can.post || can.edit) && <Button size="compact" variant="secondary" isLoading={busy} onPress={runPreview}>Review</Button>}
      {can.requestApproval && <Button size="compact" variant="primary" onPress={() => setAsk({ title: "Ask for approval of another warehouse", confirm: "Ask for approval",
        description: `${receipt.order.number}'s finished goods normally go to its own finished-goods warehouse; this receipt sends them to ${place(receipt.destination)}. The approval covers exactly this receipt; any edit withdraws it.`,
        fields: [{ name: "reason", label: "Why", kind: "textarea", required: true }],
        run: (values) => perform(() => receiptAction(receipt.id, "request-approval", { ...values, expectedVersion: receipt.rowVersion }), "Approval requested.") })}>Ask for approval</Button>}
      {can.decideApproval && <Button size="compact" variant="primary" isLoading={busy} onPress={() => quiet(() => receiptAction(receipt.id, "decide-approval", { decision: "APPROVE", expectedVersion: receipt.rowVersion }), "Approved: the receipt can be posted.")}>Approve</Button>}
      {can.decideApproval && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Reject the other warehouse", confirm: "Reject", tone: "danger",
        fields: [{ name: "note", label: "Why", kind: "textarea", required: true }],
        run: (values) => perform(() => receiptAction(receipt.id, "decide-approval", { decision: "REJECT", note: values.note, expectedVersion: receipt.rowVersion }), "Rejected: the receipt is a draft again.") })}>Reject</Button>}
      {can.post && <Button size="compact" variant="primary" isLoading={busy} onPress={post}>Post</Button>}
      {can.requestCorrection && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: `Request a correction of ${receipt.number}`, confirm: "Request correction", tone: "danger",
        description: "For a posting error — the goods were not handed over, or the wrong quantity, warehouse, lot or serial was booked. Someone else approves it; approval reverses the whole receipt (the exact stock out, its value back to work in progress) and the correct quantity is received on a new receipt. Goods already sold, moved or used cannot be reversed this way.",
        fields: [{ name: "reason", label: "What went wrong", kind: "textarea", required: true }, { name: "evidence", label: "Evidence (gate log, count sheet)", kind: "text" }],
        run: (values, requestKey) => perform(() => receiptAction(receipt.id, "request-correction", { ...values, idempotencyKey: requestKey }), "Correction requested: it waits for approval.") })}>Request correction</Button>}
      {can.decideCorrection && open && <Button size="compact" variant="primary" onPress={() => setAsk({ title: `Approve ${open.number}`, confirm: "Approve and reverse", tone: "danger",
        description: `Reverses ${receipt.number}: ${qty(open.quantity)} ${receipt.totals.uom} leave ${place(receipt.destination)} and its value returns to work in progress. Reason given: ${open.reason}`,
        fields: [{ name: "note", label: "Note", kind: "textarea" }],
        run: (values) => perform(() => receiptAction(receipt.id, "decide-correction", { decision: "APPROVE", note: values.note || undefined }), "Reversed: the output can be received again.") })}>Approve correction</Button>}
      {can.decideCorrection && open && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: `Reject ${open.number}`, confirm: "Reject", fields: [{ name: "note", label: "Why", kind: "textarea", required: true }],
        run: (values) => perform(() => receiptAction(receipt.id, "decide-correction", { decision: "REJECT", note: values.note }), "Correction rejected: the receipt stands.") })}>Reject correction</Button>}
      {can.print && <Button size="compact" variant="ghost" onPress={() => window.open(`${FGR_BASE}/${receipt.id}/print`, "_blank")}>{receipt.print.count ? "Reprint" : "Print"}</Button>}
      {receipt.posting && <Button size="compact" variant="ghost" isLoading={busy} onPress={runCheck}>Check posting</Button>}
      {can.recover && receipt.status === "RECOVERY_REQUIRED" && <Button size="compact" variant="secondary" isLoading={busy} onPress={() => quiet(() => receiptAction(receipt.id, "recover"), "Re-checked against Inventory and Finance.")}>Re-check</Button>}
      {can.cancel && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Cancel the receipt", confirm: "Cancel receipt", tone: "danger", fields: [{ name: "reason", label: "Why", kind: "textarea", required: true }],
        run: (values) => perform(() => receiptAction(receipt.id, "cancel", { reason: values.reason, expectedVersion: receipt.rowVersion }), "Cancelled.") })}>Cancel</Button>}
    </div>
  );

  return (
    <RecordDetailsPage
      header={{
        breadcrumbs: <Link className="text-sm text-brand underline" href={FGR_BASE}>Finished-Goods Receipts</Link>,
        title: `${receipt.number} · ${receipt.order.number}`,
        status: (
          <span className="flex flex-wrap gap-1">
            <StatusBadge tone={RECEIPT_TONE[receipt.status] ?? "neutral"}>{receipt.statusLabel}</StatusBadge>
            {receipt.correctionStatus === "REVERSED" && <StatusBadge tone="neutral">Reversed</StatusBadge>}
            {receipt.correctionStatus === "REQUESTED" && <StatusBadge tone="warning">Correction requested</StatusBadge>}
          </span>
        ),
        fields: [
          { label: "Product", value: `${receipt.item.code} · ${receipt.item.name}` },
          { label: "Quantity", value: `${qty(receipt.totals.quantity)} ${receipt.totals.uom}` },
          { label: "Into", value: place(receipt.destination) },
          { label: receipt.postedAt ? "Received" : "Created", value: formatDateTime(receipt.postedAt ?? receipt.createdAt) },
        ],
        primaryAction: toolbar,
      }}
    >
      <div className="flex flex-col gap-4">
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        {receipt.status === "RECOVERY_REQUIRED" && <Notice tone="danger">This receipt disagrees with Inventory or Finance. Do not receive it again: check the posting and re-check once corrected.</Notice>}
        {receipt.correctionStatus === "REVERSED" && <Notice tone="neutral">This receipt was reversed: its goods left stock and its output can be received again on a new receipt.</Notice>}
        {receipt.salesAllocation === "FAILED" && <Notice tone="warning">The goods are in stock but could not be handed to the order&apos;s sales demand. Allocate them from the Sales Demand screen.</Notice>}
        {receipt.cancelReason && <Notice tone="neutral">Cancelled by {receipt.cancelledBy}: {receipt.cancelReason}</Notice>}
        {receipt.approval.required && !receipt.approval.valid && !["POSTED", "CANCELLED", "RECOVERY_REQUIRED"].includes(receipt.status) && (
          <Notice tone="warning">{receipt.approval.message ?? "A receipt into another warehouse needs an approval before it can post."}</Notice>
        )}
        <FactList items={[
          ["Manufacturing order", <Link key="order" className="text-brand underline" href={`${MO_BASE}/${receipt.order.id}?tab=production`}>{receipt.order.number}</Link>],
          ["Order status", receipt.order.statusLabel],
          ["BOM revision", receipt.order.revisionNumber ? `Revision ${receipt.order.revisionNumber}` : "—"],
          ["From", `Production · ${place(receipt.source)}`],
          ["Into", place(receipt.destination)],
          ["Receipt date", receipt.receiptDate ? formatDate(receipt.receiptDate) : "—"],
          ["Prepared by", receipt.createdBy ?? "—"],
          ["Received by", receipt.postedBy ?? "—"],
          ["Order output", `${qty(receipt.order.accepted)} accepted · ${qty(receipt.order.received)} received · ${qty(receipt.order.receivable)} receivable`],
        ]} />
        {receipt.notes && <p className="text-sm">{receipt.notes}</p>}
        <Panel title="Output received" description={receipt.status === "POSTED" ? "What Inventory received, entry by entry." : "Receivable is as of now; posting checks it again."}>
          <LinesTable columns={["#", "Production entry", { label: "Receive", numeric: true }, ...(receipt.status === "POSTED" ? [] : [{ label: "Receivable now", numeric: true }]),
            ...(receipt.item.trackingType === "batch" ? ["Lot"] : receipt.item.trackingType === "serial" ? ["Serial numbers"] : []), "Quality", ...(can.viewCost ? [{ label: "Value", numeric: true }] : [])]}>
            {receipt.lines.map((line) => (
              <tr key={line.id}>
                <Cell>{line.lineNumber}</Cell>
                <Cell><span className="flex flex-col"><span>{line.entryNumber}{line.productionBatch ? ` · ${line.productionBatch}` : ""}</span>
                  <span className="text-xs text-text-muted">{line.producedAt ? `Made ${formatDate(line.producedAt)}` : ""}{line.uom !== receipt.item.uom ? ` · ${qty(line.baseQuantity)} ${receipt.item.uom}` : ""}</span></span></Cell>
                <Cell numeric>{qty(line.quantity)} {line.uom}</Cell>
                {receipt.status !== "POSTED" && <Cell numeric>{line.receivable === null ? "" : qty(line.receivable)}</Cell>}
                {receipt.item.trackingType === "batch" && <Cell><span className="flex flex-col text-xs"><span>{line.lot?.number ?? line.lotNumber ?? "—"}</span>
                  <span className="text-text-muted">{[line.lot?.manufacturedOn ?? line.manufacturedOn, line.lot?.expiresOn ?? line.expiresOn].map((value, index) => (value ? `${index ? "exp" : "made"} ${formatDate(value)}` : "")).filter(Boolean).join(" · ")}</span></span></Cell>}
                {receipt.item.trackingType === "serial" && <Cell><span className="text-xs">{(line.serials.length ? line.serials.map((serial) => serial.number) : line.serialNumbers).join(", ")}</span></Cell>}
                <Cell><span className="text-xs">{line.qualityDecisionId ? "Inspected and accepted" : "Accepted as reported"}</span></Cell>
                {can.viewCost && <Cell numeric>{line.totalCost ? inr(line.totalCost) : ""}</Cell>}
              </tr>
            ))}
          </LinesTable>
        </Panel>
        {preview && <PreviewPanel preview={preview} canPost={can.post} onPost={post} />}
        {can.viewCost && receipt.totals.cost && (
          <Panel title="Cost" description={receipt.totals.costBasis?.policy ?? "The recipe's material per unit at its actual average issue cost."}>
            <FactList items={[["Unit cost", receipt.totals.unitCost ? inr(receipt.totals.unitCost) : "—"], ["Moved from work in progress to finished goods", inr(receipt.totals.cost)]]} />
            {receipt.totals.costBasis?.lines?.length ? <p className="text-xs text-text-muted">{receipt.totals.costBasis.lines.map((row) => `${row.code} ${qty(row.perUnit)} × ${inr(row.rate)} (${row.source.toLowerCase()})`).join(" · ")}</p> : null}
          </Panel>
        )}
        {receipt.approval.status !== "NOT_REQUIRED" && (
          <Panel title="Another warehouse">
            <FactList items={[
              ["Approval", receipt.approval.status.toLowerCase().replace(/_/g, " ")], ["Why", receipt.approval.reason ?? "—"],
              ["Asked by", receipt.approval.requestedBy ? `${receipt.approval.requestedBy}, ${formatDateTime(receipt.approval.requestedAt!)}` : "—"],
              ["Decided by", receipt.approval.decidedBy ? `${receipt.approval.decidedBy}, ${formatDateTime(receipt.approval.decidedAt!)}` : "—"], ["Note", receipt.approval.note ?? "—"],
            ]} />
          </Panel>
        )}
        {receipt.posting && (
          <Panel title="Posting" description="Inventory received the stock and Finance moved its value from work in progress, in one transaction under one posting identity.">
            <FactList items={[
              ["Posting identity", receipt.posting.key], ["Inventory", `${receipt.posting.inventoryStatus.toLowerCase()} · ${receipt.posting.stockMovementIds.length} movement(s)`],
              ["Finance", receipt.posting.financeStatus.toLowerCase().replace(/_/g, " ")], ["Posted", formatDateTime(receipt.posting.at)],
              ["Sales demand", receipt.salesAllocation === "DONE" ? "Handed to the order's sales demand" : receipt.salesAllocation === "FAILED" ? "Allocation failed" : "—"],
            ]} />
            {check && (
              <Notice tone={check.consistent ? "success" : "danger"}>
                {check.consistent ? `Checked ${formatDateTime(check.checkedAt)}: Inventory (${check.inventory.movements} movements, ${qty(check.inventory.quantity)}) and Finance (${check.finance.status.toLowerCase()}) agree with the receipt.`
                  : check.problems.join(" ")}
              </Notice>
            )}
          </Panel>
        )}
        {receipt.corrections.length > 0 && (
          <Panel title="Corrections">
            <LinesTable columns={["Correction", "Status", { label: "Quantity", numeric: true }, "Why", "Asked by", "Decided by", "Note", ...(can.viewCost ? [{ label: "Value", numeric: true }] : [])]}>
              {receipt.corrections.map((row) => (
                <tr key={row.id}><Cell>{row.number}</Cell><Cell>{row.status.toLowerCase()}</Cell><Cell numeric>{qty(row.quantity)}</Cell><Cell>{row.reason}{row.evidence ? ` (${row.evidence})` : ""}</Cell>
                  <Cell>{row.requestedBy}, {formatDateTime(row.requestedAt)}</Cell><Cell>{row.decidedBy ? `${row.decidedBy}, ${formatDateTime(row.decidedAt!)}` : "—"}</Cell><Cell>{row.note ?? ""}</Cell>
                  {can.viewCost && <Cell numeric>{row.cost ? inr(row.cost) : ""}</Cell>}</tr>
              ))}
            </LinesTable>
          </Panel>
        )}
        <HistoryList title="Timeline" entries={receipt.history.map((row) => ({ summary: row.label, at: row.at, actor: row.actor, detail: row.summary ?? undefined }))} />
      </div>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </RecordDetailsPage>
  );
}

function PreviewPanel({ preview, canPost, onPost }: { preview: ReceiptPreview; canPost: boolean; onPost: () => void }) {
  return (
    <Panel title="Review" description={`Checked ${formatDateTime(preview.checkedAt)}. Nothing has moved; posting checks it all again.`}>
      {preview.ok ? <Notice tone="success">The whole receipt can be received now.</Notice> : <Notice tone="danger"><ul className="list-disc pl-4">{preview.problems.map((row) => <li key={row.message}>{row.message}</li>)}</ul></Notice>}
      <LinesTable columns={["Production entry", { label: "Receive", numeric: true }, { label: "Accepted", numeric: true }, { label: "Received", numeric: true }, { label: "Receivable", numeric: true }, ""]}>
        {preview.lines.map((line) => (
          <tr key={line.lineId}><Cell>{line.entryNumber}</Cell><Cell numeric>{qty(line.quantity)} {preview.uom}</Cell><Cell numeric>{qty(line.accepted)}</Cell><Cell numeric>{qty(line.received)}</Cell>
            <Cell numeric>{qty(line.receivable)}</Cell><Cell>{line.ok ? "" : <StatusBadge tone="danger">Too much</StatusBadge>}</Cell></tr>
        ))}
      </LinesTable>
      {preview.cost && (preview.cost.total !== null || preview.cost.status !== "READY") && (
        <p className="text-sm">{preview.cost.status === "READY" ? `Value ${inr(preview.cost.total!)} (${inr(preview.cost.unitCost!)} a unit); work in progress ${inr(preview.cost.wipBefore!)} → ${inr(preview.cost.wipAfter!)}.`
          : "The cost of these goods cannot be used yet (see above)."}</p>
      )}
      {preview.ok && canPost && <div className="flex justify-end"><Button variant="primary" onPress={onPost}>Post</Button></div>}
    </Panel>
  );
}

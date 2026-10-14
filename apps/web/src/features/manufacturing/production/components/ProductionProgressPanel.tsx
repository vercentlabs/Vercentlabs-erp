"use client";

// An order's production in parts: planned, the authorized target, reported, awaiting inspection, accepted, rejected, received and accepted
// but not yet received — overall and batch by batch (with each batch's material use against the BOM) — the entries, drafts still to post,
// overproduction requests and a short close waiting for approval. A material check previews a next batch without recording anything.
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, LinkButton, StatusBadge, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, LinesTable } from "@/shared/ui/record";
import { formatDateTime } from "@/shared/format/human";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, qty } from "@/features/manufacturing/orders/api/mo-api";
import type { Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import { DISPOSITIONS, ENTRY_TONE, INSPECTION_LABEL, PE_BASE, RECEIPT_LABEL, closeBatch, decideOverproduction, entryAction, openBatch, productionProgress, readiness, requestOverproduction, shortClose,
  type Readiness } from "../api/pp-api";

type Perform = (work: () => Promise<unknown>, text: string) => Promise<void>;

export function ProductionProgressPanel({ orderId, onAsk, perform }: { orderId: string; onAsk: (ask: Ask) => void; perform: Perform }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "production", orderId), queryFn: () => productionProgress(orderId), retry: false });
  const [check, setCheck] = useState("");
  const [preview, setPreview] = useState<Readiness | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  if (query.isLoading) return <LoadingState label="Loading production" rows={4} />;
  if (!query.data) return null;
  const view = query.data;
  const can = view.can;
  const q = view.quantities;
  const quiet = (work: () => Promise<unknown>, text: string) => perform(work, text).catch(() => undefined);
  const runCheck = async () => {
    setPreviewError(null);
    try { setPreview(await readiness(orderId, check)); } catch (failure) { setPreview(null); setPreviewError(errorMessage(failure)); }
  };
  const decide = (entryId: string, pending: string) => onAsk({ title: "Quality decision", confirm: "Record decision",
    description: `${qty(pending)} awaits inspection on this entry. Each unit is decided once; rejected output never becomes sellable stock.`,
    fields: [{ name: "acceptedQuantity", label: "Accepted", kind: "quantity" }, { name: "rejectedQuantity", label: "Rejected", kind: "quantity" },
      { name: "rejectionReason", label: "Rejection reason", kind: "text" }, { name: "reasonCode", label: "Reason code (e.g. ASSEMBLY_DEFECT)", kind: "text" },
      { name: "disposition", label: "Rejected output goes to", kind: "select", options: DISPOSITIONS }, { name: "inspectionReference", label: "Inspection reference", kind: "text" }],
    run: (values, requestKey) => perform(() => entryAction(entryId, "quality-decisions", { idempotencyKey: requestKey, ...Object.fromEntries(Object.entries(values).filter(([, value]) => String(value).trim())) }),
      "Quality decision recorded.") });
  return (
    <div className="flex flex-col gap-4">
      {!view.reconciled && <Notice tone="danger">The order&rsquo;s output figures disagree with its posted entries; nothing more should be recorded until this is checked.</Notice>}
      {view.shortClose?.pending && (
        <Notice tone="warning">
          Short close requested by {view.shortClose.requestedBy} ({formatDateTime(view.shortClose.requestedAt)}): {view.shortClose.reason}
          {view.shortClose.mayDecide && (
            <span className="ml-2 inline-flex gap-2">
              <Button size="compact" variant="primary" onPress={() => onAsk({ title: "Approve the short close", confirm: "Approve and complete",
                description: `${qty(q.accepted)} of ${qty(q.planned)} accepted; the target stays ${qty(q.planned)} and the shortfall is recorded. Reservations are released and work in progress left goes to variance.`,
                fields: [{ name: "note", label: "Note (optional)", kind: "textarea" }, { name: "consumeRemaining", label: "Declare material still in production used", kind: "checkbox" }],
                run: (values) => perform(() => shortClose(orderId, "decide-short-close", { decision: "APPROVE", note: values.note || undefined, consumeRemaining: Boolean(values.consumeRemaining) }), "Closed short.") })}>Approve</Button>
              <Button size="compact" variant="secondary" onPress={() => onAsk({ title: "Reject the short close", confirm: "Reject", fields: [{ name: "note", label: "Why production continues", kind: "textarea", required: true }],
                run: (values) => perform(() => shortClose(orderId, "decide-short-close", { decision: "REJECT", note: values.note }), "Production continues.") })}>Reject</Button>
            </span>
          )}
        </Notice>
      )}
      <FactList items={[
        ["Planned", qty(q.planned)], ["Authorized target", `${qty(q.authorizedTarget)}${Number(q.overproductionAllowance) ? ` (+${qty(q.overproductionAllowance)} approved)` : ""}`], ["Reported", qty(q.reported)],
        ["Awaiting inspection", qty(q.pending)], ["Accepted", `${qty(q.accepted)}${q.progressPct ? ` (${q.progressPct}%)` : ""}`], ["Rejected", qty(q.rejected)], ["Received", qty(q.received)],
        ["Accepted, not received", qty(q.acceptedNotReceived)], ["Remaining", qty(q.remaining)], ["Yield", q.yieldPct ? `${q.yieldPct}%` : "—"],
        ...(q.shortfall && Number(q.shortfall) ? [["Shortfall", qty(q.shortfall)] as [string, string]] : []),
      ]} />
      <div className="flex flex-wrap gap-2">
        {can.draft && <LinkButton size="compact" variant="primary" href={`${PE_BASE}/new?orderId=${orderId}`}>New production entry</LinkButton>}
        {can.openBatch && <Button size="compact" variant="secondary" onPress={() => onAsk({ title: "Open a production batch", confirm: "Open batch",
          fields: [{ name: "batchReference", label: "Batch reference", kind: "text", required: true, initial: `${view.orderNumber}-B${String(view.batches.length + 1).padStart(2, "0")}` },
            { name: "plannedQuantity", label: "Planned size (optional)", kind: "quantity" }, { name: "notes", label: "Notes", kind: "textarea" }],
          run: (values) => perform(() => openBatch(orderId, { batchReference: values.batchReference, plannedQuantity: values.plannedQuantity || undefined, notes: values.notes || undefined }), "Batch opened.") })}>Open batch</Button>}
        {can.requestOverproduction && Number(q.remaining) === 0 && <Button size="compact" variant="ghost" onPress={() => onAsk({ title: "Ask for more good output than planned", confirm: "Ask",
          description: "The plan stays; an approved allowance raises the most good output this order may accept. Someone else approves it.",
          fields: [{ name: "quantity", label: "Additional good output", kind: "quantity", required: true }, { name: "reason", label: "Why", kind: "textarea", required: true }],
          run: (values) => perform(() => requestOverproduction(orderId, values), "Overproduction requested.") })}>Request overproduction</Button>}
        {can.requestShortClose && <Button size="compact" variant="ghost" onPress={() => onAsk({ title: "Request a short close", confirm: "Request",
          description: `${qty(q.accepted)} of ${qty(q.planned)} accepted. Everything else must be settled first (inspection, receipts, material, open requests). Someone else approves it; the plan is never rewritten.`,
          fields: [{ name: "reason", label: "Why the order closes short", kind: "textarea", required: true }, { name: "consumeRemaining", label: "Material still in production will be declared used", kind: "checkbox" }],
          run: (values) => perform(() => shortClose(orderId, "request-short-close", { reason: values.reason, consumeRemaining: Boolean(values.consumeRemaining) }), "Short close requested.") })}>Request short close</Button>}
      </div>
      <Panel title="Material check for a next batch" description="A preview only: what is issued or reserved now for everything reported so far plus the batch. It records no production.">
        <div className="flex flex-wrap items-end gap-2">
          <TextField label="Batch quantity" inputMode="decimal" className="w-40" value={check} onChange={setCheck} />
          <Button size="compact" variant="secondary" isDisabled={!(Number(check) > 0)} onPress={runCheck}>Check</Button>
          {preview && <StatusBadge tone={preview.ready ? "success" : "warning"}>{preview.ready ? (preview.staged ? "Issued" : "Reserved or issued") : "Materials short"}</StatusBadge>}
        </div>
        {previewError && <Notice tone="danger">{previewError}</Notice>}
        {preview && (
          <LinesTable columns={["Material", { label: "For this batch", numeric: true }, { label: "For all output", numeric: true }, { label: "Issued", numeric: true }, { label: "Reserved", numeric: true }, { label: "Short", numeric: true }]}>
            {preview.lines.map((row) => <tr key={row.materialId}><Cell>{row.code}</Cell><Cell numeric>{qty(row.batchExpected)}</Cell><Cell numeric>{qty(row.requiredForCumulative)}</Cell><Cell numeric>{qty(row.issued)}</Cell>
              <Cell numeric>{qty(row.reserved)}</Cell><Cell numeric>{Number(row.short) ? qty(row.short) : ""}</Cell></tr>)}
          </LinesTable>
        )}
      </Panel>
      <Panel title="Batches">
        {view.batches.length ? (
          <LinesTable columns={["Batch", "Status", { label: "Planned", numeric: true }, { label: "Reported", numeric: true }, { label: "Accepted", numeric: true }, { label: "Rejected", numeric: true },
            { label: "Awaiting", numeric: true }, { label: "Received", numeric: true }, "Material against the BOM", ""]}>
            {view.batches.map((row) => (
              <tr key={row.id}><Cell>{row.reference}{row.location ? ` · ${row.location}` : ""}</Cell><Cell>{row.status.toLowerCase()}</Cell><Cell numeric>{row.planned ? qty(row.planned) : "—"}</Cell>
                <Cell numeric>{qty(row.reported)}</Cell><Cell numeric>{qty(row.accepted)}</Cell><Cell numeric>{qty(row.rejected)}</Cell><Cell numeric>{qty(row.pending)}</Cell><Cell numeric>{qty(row.received)}</Cell>
                <Cell>{row.consumptionRecorded ? <span className="text-xs">{row.materials.filter((part) => Number(part.consumed) > 0).map((part) => `${part.code} ${qty(part.consumed)}/${qty(part.expected)}`).join(", ")}</span>
                  : <span className="text-xs text-text-muted">{Number(row.reported) ? "No consumption recorded for this batch" : ""}</span>}</Cell>
                <Cell>{row.status === "OPEN" && can.openBatch && <Button size="compact" variant="ghost" onPress={() => quiet(() => closeBatch(orderId, row.id), "Batch closed.")}>Close</Button>}</Cell></tr>
            ))}
          </LinesTable>
        ) : <p className="text-sm text-text-muted">No batches yet.</p>}
      </Panel>
      {view.drafts.length > 0 && (
        <Panel title="Drafts not yet posted" description="Drafts count nowhere until they are posted.">
          <LinesTable columns={["Entry", "Batch", { label: "Reported", numeric: true }, "Created"]}>
            {view.drafts.map((row) => <tr key={row.id}><Cell><Link className="text-brand underline" href={`${PE_BASE}/${row.id}`}>{row.number}</Link></Cell><Cell>{row.batch}</Cell><Cell numeric>{qty(row.reported)}</Cell><Cell>{row.producedAt ? formatDateTime(row.producedAt) : ""}</Cell></tr>)}
          </LinesTable>
        </Panel>
      )}
      <Panel title="Production entries">
        {view.entries.length ? (
          <LinesTable columns={["Entry", "Batch", { label: "Reported", numeric: true }, { label: "Accepted", numeric: true }, { label: "Rejected", numeric: true }, { label: "Awaiting", numeric: true },
            { label: "Received", numeric: true }, "Inspection", "Receipt", "Produced", ""]}>
            {view.entries.map((row) => (
              <tr key={row.id}><Cell><span className="flex items-center gap-1"><Link className="text-brand underline" href={`${PE_BASE}/${row.id}`}>{row.number}</Link>
                {row.status !== "REPORTED" && <StatusBadge tone={ENTRY_TONE[row.status]}>{row.statusLabel}</StatusBadge>}</span></Cell>
                <Cell>{row.batch}</Cell><Cell numeric>{qty(row.reported)}</Cell><Cell numeric>{qty(row.accepted)}</Cell><Cell numeric>{qty(row.rejected)}</Cell><Cell numeric>{qty(row.pending)}</Cell><Cell numeric>{qty(row.received)}</Cell>
                <Cell>{INSPECTION_LABEL[row.inspection] ?? row.inspection}</Cell><Cell>{RECEIPT_LABEL[row.receipt] ?? row.receipt}</Cell><Cell>{row.producedAt ? formatDateTime(row.producedAt) : ""}</Cell>
                <Cell>{can.decideQuality && Number(row.pending) > 0 && <Button size="compact" variant="ghost" onPress={() => decide(row.id, row.pending)}>Inspect</Button>}</Cell></tr>
            ))}
          </LinesTable>
        ) : <p className="text-sm text-text-muted">No output reported yet.</p>}
      </Panel>
      {view.overproduction.length > 0 && (
        <Panel title="Overproduction requests">
          <LinesTable columns={[{ label: "Quantity", numeric: true }, "Why", "Status", "Asked by", "Decided by", ""]}>
            {view.overproduction.map((row) => (
              <tr key={row.id}><Cell numeric>+{qty(row.quantity)}</Cell><Cell>{row.reason}</Cell><Cell>{row.status.toLowerCase()}{row.note ? `: ${row.note}` : ""}</Cell><Cell>{row.requestedBy}</Cell><Cell>{row.decidedBy ?? ""}</Cell>
                <Cell>{row.mayDecide && (
                  <span className="flex gap-2">
                    <Button size="compact" variant="primary" onPress={() => quiet(() => decideOverproduction(orderId, row.id, { decision: "APPROVE" }), "Overproduction approved.")}>Approve</Button>
                    <Button size="compact" variant="ghost" onPress={() => onAsk({ title: "Reject the request", confirm: "Reject", fields: [{ name: "note", label: "Why", kind: "textarea", required: true }],
                      run: (values) => perform(() => decideOverproduction(orderId, row.id, { decision: "REJECT", note: values.note }), "Request rejected.") })}>Reject</Button>
                  </span>
                )}</Cell></tr>
            ))}
          </LinesTable>
        </Panel>
      )}
    </div>
  );
}

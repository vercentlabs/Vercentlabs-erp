"use client";

// One production entry: its output and how it splits (accepted, rejected, awaiting inspection, received), the batch, what the BOM expects
// the output to have used and the consumption notes recorded against it, quality decisions, receipts, corrections and the timeline. Posting
// asks first and returns to the order's Production tab.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PermissionState, RecordDetailsPage, StatusBadge } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MC_BASE } from "@/features/manufacturing/consumption/api/mc-api";
import { MO_BASE, errorMessage, errorStatus, getOrder, inr, orderAction, qty } from "@/features/manufacturing/orders/api/mo-api";
import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import { DISPOSITIONS, ENTRY_TONE, INSPECTION_LABEL, PE_BASE, RECEIPT_LABEL, entryAction, getEntry, type Entry } from "../api/pp-api";

const LABEL: Record<string, string> = { CREATED: "Draft created", EDITED: "Draft edited", CANCELLED: "Cancelled", POSTED: "Posted: output reported", QUALITY_DECIDED: "Quality decision",
  RECEIVED: "Received into stock", CORRECTED: "Corrected", PRINTED: "Printed", REPRINTED: "Reprinted" };

export function ProductionEntryDetailScreen({ entryId }: { entryId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const key = scopedQueryKey(workspace, "manufacturing", "production-entry", entryId);
  const query = useQuery({ queryKey: key, queryFn: () => getEntry(entryId), retry: false });
  const order = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "order", query.data?.order.id ?? ""), queryFn: () => getOrder(query.data!.order.id), enabled: Boolean(query.data) });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (query.isLoading) return <LoadingState label="Loading the production entry" rows={6} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to production" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the production entry" description={errorMessage(query.error)} />;
  }
  const entry = query.data;
  const can = entry.can;
  const perform = async (work: () => Promise<unknown>, text: string) => {
    setBusy(true);
    try {
      const result = await work() as Entry | { entry?: Entry };
      const next = result && "can" in result ? result as Entry : (result as { entry?: Entry })?.entry;
      if (next) queryClient.setQueryData(key, next);
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
      setMessage({ tone: "success", text });
    } catch (failure) {
      setMessage({ tone: "danger", text: errorMessage(failure) });
      throw failure;
    } finally { setBusy(false); }
  };
  const tracking = order.data?.finishedItem.trackingType ?? "none";
  const posted = entry.history.find((row) => row.action === "POSTED");
  const toolbar = (
    <div className="flex flex-wrap gap-2">
      {can.edit && <Button size="compact" variant="secondary" onPress={() => router.push(`${PE_BASE}/${entry.id}/edit`)}>Edit draft</Button>}
      {can.post && <Button size="compact" variant="primary" isLoading={busy} onPress={() => setAsk({ title: `Post ${entry.number}`, confirm: "Post output",
        description: `${qty(entry.reported)} reported in batch ${entry.batch}. Posting moves the order's output figures once; it receives no stock and consumes no material. A posted entry is corrected, never edited.`,
        fields: [{ name: "materialOverrideReason", label: "If materials are not issued and the company requires them: why production went ahead (managers only)", kind: "textarea" }],
        run: async (values) => {
          await perform(() => entryAction(entry.id, "post", { expectedVersion: entry.rowVersion, expectedMoVersion: entry.order.version, materialOverrideReason: values.materialOverrideReason || undefined }), "Output posted.");
          router.push(`${MO_BASE}/${entry.order.id}?tab=production`);
        } })}>Post</Button>}
      {can.decideQuality && <Button size="compact" variant="primary" onPress={() => setAsk({ title: "Quality decision", confirm: "Record decision",
        description: `${qty(entry.pending)} awaits inspection. Each unit is decided once.`,
        fields: [{ name: "acceptedQuantity", label: "Accepted", kind: "quantity" }, { name: "rejectedQuantity", label: "Rejected", kind: "quantity" }, { name: "rejectionReason", label: "Rejection reason", kind: "text" },
          { name: "reasonCode", label: "Reason code", kind: "text" }, { name: "disposition", label: "Rejected output goes to", kind: "select", options: DISPOSITIONS }, { name: "inspectionReference", label: "Inspection reference", kind: "text" }],
        run: (values, requestKey) => perform(() => entryAction(entry.id, "quality-decisions", { idempotencyKey: requestKey, expectedEntryVersion: entry.rowVersion,
          ...Object.fromEntries(Object.entries(values).filter(([, value]) => String(value).trim())) }), "Quality decision recorded.") })}>Inspect</Button>}
      {can.receive && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Receive finished goods", confirm: "Receive",
        description: `${qty(entry.receivable)} accepted output of this entry waits. Into ${order.data?.warehouses.finishedGoods.code ?? "the finished-goods warehouse"} at the recipe's material cost.`,
        fields: [{ name: "quantity", label: "Quantity", kind: "quantity", required: true, initial: entry.receivable },
          ...(tracking === "batch" ? [{ name: "batchNumber", label: "Finished-goods batch", kind: "text" as const, required: true, initial: entry.batch ?? "" }, { name: "expiresOn", label: "Expiry (YYYY-MM-DD, optional)", kind: "text" as const }] : []),
          ...(tracking === "serial" ? [{ name: "serialNumbers", label: "Serial numbers (one per unit)", kind: "textarea" as const, required: true }] : [])],
        run: (values, requestKey) => perform(() => orderAction(entry.order.id, "finished-goods-receipts", { ...values, productionEntryId: entry.id, idempotencyKey: requestKey }).then(() => getEntry(entry.id)), "Received into stock.") })}>Receive</Button>}
      {can.correct && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Correct reported output", confirm: "Correct", tone: "danger",
        description: "Only output that did not exist: what still awaits inspection, or accepted output not yet in stock (managers). Output already received needs an Inventory receipt reversal first. The entry stays, with the correction beside it.",
        fields: [{ name: "kind", label: "What is withdrawn", kind: "select", required: true, initial: Number(entry.pending) > 0 ? "PENDING" : "ACCEPTED",
          options: [{ value: "PENDING", label: `Awaiting inspection (${qty(entry.pending)})` }, { value: "ACCEPTED", label: `Accepted, not received (${qty(entry.receivable)})` }] },
          { name: "quantity", label: "Quantity", kind: "quantity", required: true }, { name: "reason", label: "What was reported wrongly", kind: "textarea", required: true }, { name: "evidence", label: "Evidence", kind: "text" }],
        run: (values, requestKey) => perform(() => entryAction(entry.id, "request-correction", { ...values, idempotencyKey: requestKey }), "Corrected.") })}>Correct</Button>}
      {can.print && <Button size="compact" variant="ghost" onPress={() => window.open(`${PE_BASE}/${entry.id}/print`, "_blank")}>{entry.print.count ? "Reprint" : "Print"}</Button>}
      {can.cancel && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Cancel the draft", confirm: "Cancel draft", tone: "danger", fields: [{ name: "reason", label: "Why", kind: "textarea", required: true }],
        run: (values) => perform(() => entryAction(entry.id, "cancel", { reason: values.reason, expectedVersion: entry.rowVersion }), "Cancelled.") })}>Cancel</Button>}
    </div>
  );
  return (
    <RecordDetailsPage
      header={{
        breadcrumbs: <Link className="text-sm text-brand underline" href={`${MO_BASE}/${entry.order.id}?tab=production`}>{entry.order.number}</Link>,
        title: `${entry.number} · ${entry.batch ?? ""}`,
        status: <StatusBadge tone={ENTRY_TONE[entry.status]}>{entry.statusLabel}</StatusBadge>,
        fields: [
          { label: "Reported", value: `${entry.entered ? `${qty(entry.entered)} ${entry.uom ?? ""}` : qty(entry.reported)}` },
          { label: "Inspection", value: INSPECTION_LABEL[entry.inspection] ?? entry.inspection },
          { label: "Receipt", value: RECEIPT_LABEL[entry.receipt] ?? entry.receipt },
          { label: "Produced", value: entry.producedAt ? formatDateTime(entry.producedAt) : "—" },
        ],
        primaryAction: toolbar,
      }}
    >
      <div className="flex flex-col gap-4">
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        {posted?.summary && /not yet issued/.test(posted.summary) && <Notice tone="warning">{posted.summary}</Notice>}
        {entry.materialOverride && <Notice tone="warning">Posted without the materials issued: {entry.materialOverride}</Notice>}
        {entry.cancelReason && <Notice tone="neutral">Cancelled by {entry.cancelledBy}: {entry.cancelReason}</Notice>}
        <FactList items={[
          ["Product", `${entry.order.finishedItem.code} · ${entry.order.finishedItem.name}`], ["Order", entry.order.number], ["Batch", entry.batch ? `${entry.batch}${entry.batch && entry.location ? ` · ${entry.location.code}` : ""}` : "—"],
          ["Reported", qty(entry.reported)], ["Accepted", qty(entry.accepted)], ["Rejected", qty(entry.rejected)], ["Awaiting inspection", qty(entry.pending)], ["Received", qty(entry.received)],
          ["Accepted, not received", qty(entry.receivable)], ["Recorded by", entry.recordedBy ?? "—"], ["Posted by", entry.postedBy ?? "—"],
          ...(Number(entry.correctedPending) || Number(entry.correctedAccepted) ? [["Corrected", `${qty(String(Number(entry.correctedPending) + Number(entry.correctedAccepted)))}`] as [string, string]] : []),
        ]} />
        {entry.notes && <p className="text-sm">{entry.notes}</p>}
        {entry.expectedMaterials.length > 0 && (
          <Panel title="Materials for this output" description="What the BOM expects this output to have used. Consumption is recorded separately — reporting output consumes nothing.">
            <LinesTable columns={["Material", { label: "BOM expects", numeric: true }, "Unit"]}>
              {entry.expectedMaterials.map((row) => <tr key={row.code}><Cell>{row.code}</Cell><Cell numeric>{qty(row.expected)}</Cell><Cell>{row.uom}</Cell></tr>)}
            </LinesTable>
            <p className="text-xs text-text-muted">{entry.consumptionNotes.length ? <>Consumption recorded for this entry or batch: {entry.consumptionNotes.map((row, index) => <span key={row.id}>{index ? ", " : ""}<Link className="text-brand underline" href={`${MC_BASE}/${row.id}`}>{row.number}</Link> ({row.status.toLowerCase()})</span>)}</>
              : "No consumption recorded against this entry or its batch yet."}</p>
          </Panel>
        )}
        {entry.decisions.length > 0 && (
          <Panel title="Quality decisions">
            <LinesTable columns={[{ label: "Accepted", numeric: true }, { label: "Rejected", numeric: true }, "Reason", "Disposition", "Inspection", "By"]}>
              {entry.decisions.map((row) => <tr key={row.id}><Cell numeric>{qty(row.accepted)}</Cell><Cell numeric>{qty(row.rejected)}</Cell><Cell>{[row.reasonCode, row.reason].filter(Boolean).join(" · ")}</Cell>
                <Cell>{row.disposition?.toLowerCase() ?? ""}</Cell><Cell>{row.inspectionReference ?? ""}</Cell><Cell>{row.by}, {formatDateTime(row.at)}</Cell></tr>)}
            </LinesTable>
          </Panel>
        )}
        {entry.receipts.length > 0 && (
          <Panel title="Received into stock">
            <LinesTable columns={["Receipt", { label: "From this entry", numeric: true }, "Warehouse", "Batch", ...(entry.receipts[0].unitCost !== null ? [{ label: "Unit cost", numeric: true }] : []), "When"]}>
              {entry.receipts.map((row) => <tr key={`${row.id}-${row.quantity}`}><Cell>{row.number}</Cell><Cell numeric>{qty(row.quantity)}</Cell><Cell>{row.warehouse}</Cell><Cell>{row.batch ?? ""}</Cell>
                {row.unitCost !== null && <Cell numeric>{inr(row.unitCost)}</Cell>}<Cell>{formatDateTime(row.at)}</Cell></tr>)}
            </LinesTable>
          </Panel>
        )}
        {entry.corrections.length > 0 && (
          <Panel title="Corrections">
            <LinesTable columns={["Correction", "Withdrawn", { label: "Quantity", numeric: true }, "Why", "Evidence", "By"]}>
              {entry.corrections.map((row) => <tr key={row.id}><Cell>{row.number}</Cell><Cell>{row.kind === "PENDING" ? "awaiting inspection" : "accepted"}</Cell><Cell numeric>{qty(row.quantity)}</Cell><Cell>{row.reason}</Cell>
                <Cell>{row.evidence ?? ""}</Cell><Cell>{row.by}, {formatDateTime(row.at)}</Cell></tr>)}
            </LinesTable>
          </Panel>
        )}
        <HistoryList title="Timeline" entries={entry.history.map((row) => ({ summary: LABEL[row.action] ?? row.action, at: row.at, actor: row.actor, detail: row.summary ?? undefined }))} />
      </div>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </RecordDetailsPage>
  );
}

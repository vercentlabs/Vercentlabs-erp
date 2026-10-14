"use client";

// One consumption note: the order and what it was recorded against, each material with the BOM's expectation and the variance, the issued
// stock it used (issue note, batch, serial unit), the approval of usage variance, the posting, corrections and the timeline. Posting asks
// first, re-checks custody on the server, and returns to the order's Materials tab with the updated balances.
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
import { MI_BASE } from "@/features/manufacturing/issues/api/mi-api";
import { BAND_TONE, CONSUMPTION_TONE, MC_BASE, consumptionAction, getConsumption, previewConsumption, type Consumption, type ConsumptionPreview } from "../api/mc-api";

export function MaterialConsumptionDetailScreen({ consumptionId }: { consumptionId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const key = scopedQueryKey(workspace, "manufacturing", "material-consumption", consumptionId);
  const query = useQuery({ queryKey: key, queryFn: () => getConsumption(consumptionId), retry: false });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [preview, setPreview] = useState<ConsumptionPreview | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (query.isLoading) return <LoadingState label="Loading the consumption note" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to material consumption" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the consumption note" description={errorMessage(query.error)} />;
  }
  const note = query.data;
  const can = note.can;
  const refresh = async (next?: Consumption) => {
    if (next) queryClient.setQueryData(key, next);
    await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
  };
  const perform = async (work: () => Promise<unknown>, text: string) => {
    setBusy(true);
    try {
      const result = await work() as { consumption?: Consumption };
      await refresh(result?.consumption);
      setMessage({ tone: "success", text });
      setPreview(null);
    } catch (failure) {
      setMessage({ tone: "danger", text: errorMessage(failure) });
      throw failure;
    } finally { setBusy(false); }
  };
  const quiet = (work: () => Promise<unknown>, text: string) => perform(work, text).catch(() => undefined);
  const review = async () => {
    setBusy(true);
    try { setPreview(await previewConsumption(note.id)); setMessage(null); } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
  };
  const post = () => setAsk({
    title: `Post ${note.number}`, confirm: "Confirm usage",
    description: `${note.lines.map((line) => `${line.code} ${qty(line.quantity)} ${line.uom}`).join(", ")} were actually used on ${note.order.number}. Every line posts or none does, from the issued stock still in production. A posted note is never edited — a mistake is corrected.`,
    fields: [], run: async () => {
      await perform(() => consumptionAction(note.id, "post", { expectedVersion: note.rowVersion, expectedMoVersion: note.order.version }), "Posted: usage confirmed.");
      router.push(`${MO_BASE}/${note.order.id}?tab=materials`);
    },
  });
  const open = note.lines.filter((line) => Number(line.corrected) < Number(line.baseQuantity));

  const toolbar = (
    <div className="flex flex-wrap gap-2">
      {can.edit && <Button size="compact" variant="secondary" onPress={() => router.push(`${MC_BASE}/${note.id}/edit`)}>Edit draft</Button>}
      {can.preview && <Button size="compact" variant="secondary" isLoading={busy} onPress={review}>Review</Button>}
      {can.requestApproval && <Button size="compact" variant="primary" onPress={() => setAsk({ title: "Ask for approval of the usage variance", confirm: "Ask for approval",
        description: "More was used than the BOM expects for this output. The approval covers exactly this note and the custody it saw; any change withdraws it. The BOM itself does not change.",
        fields: [{ name: "reason", label: "Why more was used", kind: "textarea", required: true }],
        run: (values) => perform(() => consumptionAction(note.id, "request-approval", { reason: values.reason, expectedVersion: note.rowVersion }), "Approval requested.") })}>Ask for approval</Button>}
      {can.decideApproval && <Button size="compact" variant="primary" isLoading={busy} onPress={() => quiet(() => consumptionAction(note.id, "decide-approval", { decision: "APPROVE", expectedVersion: note.rowVersion }), "Usage variance approved.")}>Approve</Button>}
      {can.decideApproval && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Reject the usage variance", confirm: "Reject", tone: "danger", fields: [{ name: "note", label: "Why", kind: "textarea", required: true }],
        run: (values) => perform(() => consumptionAction(note.id, "decide-approval", { decision: "REJECT", note: values.note, expectedVersion: note.rowVersion }), "Rejected: the note is a draft again.") })}>Reject</Button>}
      {can.post && <Button size="compact" variant="primary" isLoading={busy} onPress={post}>Post</Button>}
      {can.correct && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Correct posted consumption", confirm: "Correct", tone: "danger",
        description: "Only for usage recorded but never physically used — the material must still be in production. It goes back to custody from the very stock it was allocated to; the original stays with the correction beside it. Usage that did happen is a variance, not a correction.",
        fields: [{ name: "lineId", label: "Line", kind: "select", required: true, options: open.map((line) => ({ value: line.id, label: `${line.code} · ${qty(String(Number(line.baseQuantity) - Number(line.corrected)))} ${line.baseUom}` })) },
          { name: "quantity", label: "Quantity not used", kind: "quantity", required: true }, { name: "reason", label: "What was recorded wrongly", kind: "textarea", required: true },
          { name: "evidence", label: "Evidence (count sheet, supervisor)", kind: "text" }],
        run: (values, requestKey) => perform(() => consumptionAction(note.id, "request-correction", { ...values, idempotencyKey: requestKey }), "Corrected: the material is back in production custody.") })}>Correct</Button>}
      {can.print && <Button size="compact" variant="ghost" onPress={() => window.open(`${MC_BASE}/${note.id}/print`, "_blank")}>{note.print.count ? "Reprint" : "Print"}</Button>}
      {can.recover && note.status === "RECOVERY_REQUIRED" && <Button size="compact" variant="secondary" isLoading={busy} onPress={() => quiet(() => consumptionAction(note.id, "recover"), "Re-checked against custody.")}>Re-check</Button>}
      {can.cancel && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Cancel the note", confirm: "Cancel note", tone: "danger", fields: [{ name: "reason", label: "Why", kind: "textarea", required: true }],
        run: (values) => perform(() => consumptionAction(note.id, "cancel", { reason: values.reason, expectedVersion: note.rowVersion }), "Cancelled.") })}>Cancel</Button>}
    </div>
  );

  return (
    <RecordDetailsPage
      header={{
        breadcrumbs: <Link className="text-sm text-brand underline" href={MC_BASE}>Material Consumption</Link>,
        title: `${note.number} · ${note.order.number}`,
        status: <StatusBadge tone={CONSUMPTION_TONE[note.status] ?? "neutral"}>{note.statusLabel}</StatusBadge>,
        fields: [
          { label: "Production", value: `${note.production.warehouse.code}${note.production.location ? ` / ${note.production.location.code}` : ""}` },
          { label: "Batch", value: note.production.batchReference ?? "—" },
          { label: "Output basis", value: note.production.outputBasis ? qty(note.production.outputBasis) : "None" },
          { label: note.postedAt ? "Posted" : "Created", value: formatDateTime(note.postedAt ?? note.createdAt) },
        ],
        primaryAction: toolbar,
      }}
    >
      <div className="flex flex-col gap-4">
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        {note.kind === "CLOSING" && <Notice tone="neutral">Closing disposition: what was still in production when the order completed, declared used.</Notice>}
        {note.status === "RECOVERY_REQUIRED" && <Notice tone="danger">This note disagrees with the order&rsquo;s custody records. Do not record it again; re-check once corrected.</Notice>}
        {note.cancelReason && <Notice tone="neutral">Cancelled by {note.cancelledBy}: {note.cancelReason}</Notice>}
        {note.approval.required && !note.approval.valid && !["POSTED", "CANCELLED"].includes(note.status) && <Notice tone="warning">{note.approval.message}</Notice>}
        <FactList items={[
          ["Manufacturing order", <Link key="order" className="text-brand underline" href={`${MO_BASE}/${note.order.id}?tab=materials`}>{note.order.number}</Link>],
          ["Product", `${note.order.finishedItem.code} · ${note.order.finishedItem.name}${note.order.revisionNumber ? ` · BOM rev ${note.order.revisionNumber}` : ""}`],
          ["Production entry", note.production.entry ? `${note.production.entry.number} · ${qty(note.production.entry.reported)} reported` : "—"],
          ["Recorded by", note.createdBy ?? "—"], ["Posted by", note.postedBy ?? "—"], ["Used on", note.consumedAt ? formatDateTime(note.consumedAt) : formatDate(note.consumptionDate)],
          ["Tolerance", `warning above ${qty(note.policy.warningPct)}% · approval above ${qty(note.policy.approvalPct)}%`],
          ["Value", note.totals.cost === null ? "—" : note.totals.costStatus === "MISSING" ? "Cost missing" : inr(note.totals.cost)],
        ]} />
        {note.notes && <p className="text-sm">{note.notes}</p>}
        <Panel title="Materials used" description={note.status === "POSTED" ? "The issued stock each line used." : "In production is as of now; posting checks it again."}>
          <LinesTable columns={["#", "Material", { label: "Used", numeric: true }, { label: "BOM expects", numeric: true }, { label: "Variance", numeric: true }, "", { label: "In production", numeric: true },
            "From", ...(can.viewCost ? [{ label: "Value", numeric: true }] : [])]}>
            {note.lines.map((line) => (
              <tr key={line.id}>
                <Cell>{line.lineNumber}</Cell>
                <Cell><span className="flex flex-col"><span>{line.code} · {line.name}</span>
                  <span className="text-xs text-text-muted">{line.uom !== line.baseUom ? `${qty(line.baseQuantity)} ${line.baseUom}` : line.baseUom}{Number(line.corrected) ? ` · ${qty(line.corrected)} corrected` : ""}</span></span></Cell>
                <Cell numeric>{qty(line.quantity)} {line.uom}</Cell><Cell numeric>{line.expected === null ? "—" : qty(line.expected)}</Cell>
                <Cell numeric>{line.variance === null ? "" : `${Number(line.variance) > 0 ? "+" : ""}${qty(line.variance)}${line.variancePct === null ? "" : ` (${line.variancePct}%)`}`}</Cell>
                <Cell>{line.band !== "NO_BASIS" && <StatusBadge tone={BAND_TONE[line.band]}>{line.bandLabel}</StatusBadge>}</Cell>
                <Cell numeric>{line.custodyNow === null ? qty(line.inCustody) : qty(line.custodyNow)}</Cell>
                <Cell>{line.allocations.length ? (
                  <span className="flex flex-col text-xs">{line.allocations.map((part) => (
                    <span key={part.id}>{qty(part.quantity)} · {part.issueId ? <Link className="text-brand underline" href={`${MI_BASE}/${part.issueId}`}>{part.issueNumber}</Link> : part.issueNumber}{part.batch ? ` · ${part.batch}` : ""}{part.serial ? ` · ${part.serial}` : ""}</span>
                  ))}</span>
                ) : <span className="text-xs text-text-muted">{line.batch ? `Batch ${line.batch.number}` : line.serials.length ? line.serials.map((serial) => serial.number).join(", ") : "Oldest issued first"}</span>}</Cell>
                {can.viewCost && <Cell numeric>{line.totalCost ? inr(line.totalCost) : ""}</Cell>}
              </tr>
            ))}
          </LinesTable>
        </Panel>
        {preview && (
          <Panel title="Review" description={`Checked ${formatDateTime(preview.checkedAt)}. Nothing has changed; posting checks it all again.`}>
            {preview.ok ? <Notice tone="success">Every line can be posted now.</Notice> : <Notice tone="danger"><ul className="list-disc pl-4">{preview.problems.map((row) => <li key={row.message}>{row.message}</li>)}</ul></Notice>}
            <LinesTable columns={["Material", { label: "Used", numeric: true }, { label: "In production now", numeric: true }, { label: "After", numeric: true }, "Against the BOM", "Stock to use"]}>
              {preview.lines.map((line) => (
                <tr key={line.lineId}><Cell>{line.code}</Cell><Cell numeric>{qty(line.baseQuantity)} {line.uom}</Cell><Cell numeric>{qty(line.custodyBefore)}</Cell><Cell numeric>{qty(line.custodyAfter)}</Cell>
                  <Cell><StatusBadge tone={BAND_TONE[line.band]}>{line.bandLabel}</StatusBadge></Cell>
                  <Cell><span className="text-xs">{line.plan.map((part) => `${qty(part.quantity)} · ${part.issueNumber}`).join("; ")}</span></Cell></tr>
              ))}
            </LinesTable>
            {preview.ok && can.post && <div className="flex justify-end"><Button variant="primary" onPress={post}>Post</Button></div>}
          </Panel>
        )}
        {note.approval.status !== "NOT_REQUIRED" && (
          <Panel title="Usage variance approval">
            <FactList items={[
              ["Approval", note.approval.status.toLowerCase()], ["Why", note.approval.reason ?? "—"],
              ["Asked by", note.approval.requestedBy ? `${note.approval.requestedBy}, ${formatDateTime(note.approval.requestedAt!)}` : "—"],
              ["Decided by", note.approval.decidedBy ? `${note.approval.decidedBy}, ${formatDateTime(note.approval.decidedAt!)}` : "—"], ["Note", note.approval.note ?? "—"],
            ]} />
          </Panel>
        )}
        {note.posting && <Panel title="Posting"><FactList items={[["Posting identity", note.posting.key], ["Custody", note.posting.custodyStatus.toLowerCase()], ["Finance", note.posting.financeNote], ["Posted", formatDateTime(note.posting.at)]]} /></Panel>}
        {note.corrections.length > 0 && (
          <Panel title="Corrections">
            <LinesTable columns={["Correction", "Material", { label: "Back to custody", numeric: true }, "Why", "Evidence", "By"]}>
              {note.corrections.map((row) => <tr key={row.id}><Cell>{row.number}</Cell><Cell>{row.code}</Cell><Cell numeric>{qty(row.quantity)}</Cell><Cell>{row.reason}</Cell><Cell>{row.evidence ?? ""}</Cell><Cell>{row.by}, {formatDateTime(row.at)}</Cell></tr>)}
            </LinesTable>
          </Panel>
        )}
        <HistoryList title="Timeline" entries={note.history.map((row) => ({ summary: row.label, at: row.at, actor: row.actor, detail: row.summary ?? undefined }))} />
      </div>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </RecordDetailsPage>
  );
}

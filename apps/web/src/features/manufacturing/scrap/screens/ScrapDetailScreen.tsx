"use client";

// One scrap note: its order, what was scrapped (material with its batch or serial units, or rejected output by production entry), why, the
// disposition and the loss treatment, its value, the approval the company's policy asks for, the posting, corrections and the timeline. The
// toolbar offers only what the note's state and the person's permissions allow; posting asks first and re-checks on the server.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Breadcrumb, Button, ErrorState, PermissionState, RecordDetailsPage, StatusBadge } from "@vercentlabs/design-system";

import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, inr, qty } from "@/features/manufacturing/orders/api/mo-api";
import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import { SCRAP_BASE, SCRAP_TONE, TYPE_LABEL, getScrap, previewScrap, scrapAction, scrapPostingStatus, type ManufacturingScrap, type ScrapPostingCheck, type ScrapPreview } from "../api/scrap-api";

export function ScrapDetailScreen({ scrapId }: { scrapId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const key = scopedQueryKey(workspace, "manufacturing", "scrap", scrapId);
  const query = useQuery({ queryKey: key, queryFn: () => getScrap(scrapId), retry: false });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [preview, setPreview] = useState<ScrapPreview | null>(null);
  const [check, setCheck] = useState<ScrapPostingCheck | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (query.isLoading) return <LoadingState label="Loading the scrap note" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to scrap" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the scrap note" description={errorMessage(query.error)} />;
  }
  const scrap = query.data;
  const can = scrap.can;
  const refresh = async (next?: ManufacturingScrap) => {
    if (next) queryClient.setQueryData(key, next);
    await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
  };
  const perform = async (work: () => Promise<unknown>, text: string) => {
    setBusy(true);
    try {
      const result = await work() as { scrap?: ManufacturingScrap };
      await refresh(result?.scrap);
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
    try { setPreview(await previewScrap(scrap.id)); setMessage(null); } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
  };
  const runCheck = async () => {
    setBusy(true);
    try { setCheck(await scrapPostingStatus(scrap.id)); } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
  };
  const treatment = scrap.disposition === "RECOVERABLE" ? `goes to ${scrap.destination?.warehouse?.code ?? ""}/${scrap.destination?.location?.code ?? ""} (damaged stock, never usable) at its source value`
    : scrap.lossClass === "ABNORMAL" ? "is disposed of; its value is written off from work in progress to manufacturing variance" : "is disposed of; its value stays in the order's cost (a normal loss)";
  const post = () => setAsk({
    title: `Post ${scrap.number}`, confirm: "Post scrap", tone: "danger",
    description: `${scrap.lines.map((line) => `${line.code} ${qty(line.baseQuantity)} ${line.baseUom}`).join(", ")} from ${scrap.order.number} ${treatment}. Every line posts or none does; a posted note is never edited.`,
    fields: [], run: () => perform(() => scrapAction(scrap.id, "post", { expectedVersion: scrap.rowVersion, expectedMoVersion: scrap.order.version }), "Posted: the scrap is recorded."),
  });
  const open = scrap.corrections.find((row) => row.status === "REQUESTED") ?? null;

  const toolbar = (
    <div className="flex flex-wrap gap-2">
      {can.edit && <Button size="compact" variant="secondary" onPress={() => router.push(`${SCRAP_BASE}/${scrap.id}/edit`)}>Edit draft</Button>}
      {(can.edit || can.post) && <Button size="compact" variant="secondary" isLoading={busy} onPress={runPreview}>Review</Button>}
      {can.submit && <Button size="compact" variant="primary" isLoading={busy} onPress={() => quiet(() => scrapAction(scrap.id, "submit", { expectedVersion: scrap.rowVersion }), "Submitted for approval.")}>Submit for approval</Button>}
      {can.decide && <Button size="compact" variant="primary" isLoading={busy} onPress={() => quiet(() => scrapAction(scrap.id, "approve", { decision: "APPROVE", expectedVersion: scrap.rowVersion }), "Approved: it can be posted.")}>Approve</Button>}
      {can.decide && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Reject the scrap", confirm: "Reject", tone: "danger", fields: [{ name: "note", label: "Why", kind: "textarea", required: true }],
        run: (values) => perform(() => scrapAction(scrap.id, "approve", { decision: "REJECT", note: values.note, expectedVersion: scrap.rowVersion }), "Rejected: the note is a draft again.") })}>Reject</Button>}
      {can.post && <Button size="compact" variant="primary" isLoading={busy} onPress={post}>Post</Button>}
      {can.requestCorrection && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: `Request a correction of ${scrap.number}`, confirm: "Request correction", tone: "danger",
        description: scrap.disposition === "IRRECOVERABLE"
          ? "Only for a recording error: the units were not actually scrapped and still physically exist. Destroyed stock is never restored. Someone else approves it; approval reverses the whole note."
          : "Someone else approves it; approval takes the stock back out of the scrap bin and reverses the whole note. Scrap sold or moved since cannot be reversed this way.",
        fields: [{ name: "reason", label: "What was recorded wrongly", kind: "textarea", required: true }, { name: "evidence", label: "Evidence", kind: "text" },
          ...(scrap.disposition === "IRRECOVERABLE" ? [{ name: "physicallyPresent", label: "Type YES to confirm the units still physically exist", kind: "text" as const, required: true }] : [])],
        run: (values, requestKey) => perform(() => scrapAction(scrap.id, "request-correction", { reason: values.reason, evidence: values.evidence || undefined, idempotencyKey: requestKey,
          physicallyPresent: String(values.physicallyPresent ?? "").trim().toUpperCase() === "YES" }), "Correction requested: it waits for approval.") })}>Request correction</Button>}
      {can.decideCorrection && open && <Button size="compact" variant="primary" onPress={() => setAsk({ title: `Approve ${open.number}`, confirm: "Approve and reverse", tone: "danger",
        description: `Reverses ${scrap.number}: ${scrap.scrapType === "ISSUED_MATERIAL" ? "the material returns to production custody" : "the output returns to rejected, undisposed"}${scrap.disposition === "RECOVERABLE" ? ", the stock leaves the scrap bin" : ""}${scrap.disposition === "RECOVERABLE" || scrap.lossClass === "ABNORMAL" ? " and its value returns to work in progress" : ""}. Reason: ${open.reason}`,
        fields: [{ name: "note", label: "Note", kind: "textarea" }],
        run: (values) => perform(() => scrapAction(scrap.id, "decide-correction", { decision: "APPROVE", note: values.note || undefined }), "Reversed.") })}>Approve correction</Button>}
      {can.decideCorrection && open && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: `Reject ${open.number}`, confirm: "Reject", fields: [{ name: "note", label: "Why", kind: "textarea", required: true }],
        run: (values) => perform(() => scrapAction(scrap.id, "decide-correction", { decision: "REJECT", note: values.note }), "Correction rejected: the scrap stands.") })}>Reject correction</Button>}
      {can.print && <Button size="compact" variant="ghost" onPress={() => window.open(`${SCRAP_BASE}/${scrap.id}/print`, "_blank")}>{scrap.print.count ? "Reprint" : "Print"}</Button>}
      {scrap.posting && <Button size="compact" variant="ghost" isLoading={busy} onPress={runCheck}>Check posting</Button>}
      {can.recover && scrap.status === "RECOVERY_REQUIRED" && <Button size="compact" variant="secondary" isLoading={busy} onPress={() => quiet(() => scrapAction(scrap.id, "recover"), "Re-checked.")}>Re-check</Button>}
      {can.cancel && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Cancel the scrap note", confirm: "Cancel note", tone: "danger", fields: [{ name: "reason", label: "Why", kind: "textarea", required: true }],
        run: (values) => perform(() => scrapAction(scrap.id, "cancel", { reason: values.reason, expectedVersion: scrap.rowVersion }), "Cancelled.") })}>Cancel</Button>}
    </div>
  );

  return (
    <RecordDetailsPage
      header={{
        breadcrumbs: <Breadcrumb href={SCRAP_BASE}>Scrap</Breadcrumb>,
        title: `${scrap.number} · ${scrap.order.number}`,
        status: (
          <span className="flex flex-wrap gap-1"><StatusBadge tone={SCRAP_TONE[scrap.status] ?? "neutral"}>{scrap.statusLabel}</StatusBadge>
            {scrap.correctionStatus === "REVERSED" && <StatusBadge tone="neutral">Reversed</StatusBadge>}{scrap.correctionStatus === "REQUESTED" && <StatusBadge tone="warning">Correction requested</StatusBadge>}</span>
        ),
        fields: [
          { label: "What", value: TYPE_LABEL[scrap.scrapType] }, { label: "Reason", value: scrap.reasonLabel },
          { label: "Disposition", value: scrap.disposition === "RECOVERABLE" ? "Recoverable" : "Irrecoverable" }, { label: "Loss", value: scrap.lossClass === "ABNORMAL" ? "Abnormal" : "Normal" },
        ],
        primaryAction: toolbar,
      }}
    >
      <div className="flex flex-col gap-4">
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        {scrap.status === "RECOVERY_REQUIRED" && <Notice tone="danger">This note disagrees with Inventory or Finance. Do not record it again: check the posting and re-check once corrected.</Notice>}
        {scrap.correctionStatus === "REVERSED" && <Notice tone="neutral">This note was reversed: {scrap.scrapType === "ISSUED_MATERIAL" ? "the material is back in production custody" : "the output is back to rejected, undisposed"}.</Notice>}
        {scrap.cancelReason && <Notice tone="neutral">Cancelled by {scrap.cancelledBy}: {scrap.cancelReason}</Notice>}
        {scrap.approval.required && !scrap.approval.valid && !["POSTED", "CANCELLED"].includes(scrap.status) && (
          <Notice tone="warning">{scrap.approval.stale ? "The note changed after it was approved: submit it again." : `Needs approval: ${scrap.approval.reasons.join(", ")}.`}</Notice>
        )}
        <FactList items={[
          ["Manufacturing order", <Link key="order" className="text-brand underline" href={`${MO_BASE}/${scrap.order.id}?tab=${scrap.scrapType === "ISSUED_MATERIAL" ? "materials" : "production"}`}>{scrap.order.number}</Link>],
          ["Product", `${scrap.order.finishedItem.code} · ${scrap.order.finishedItem.name}`],
          ["Where it was", `Production · ${scrap.source.warehouse?.code ?? "—"}`],
          ["Where it goes", scrap.disposition === "RECOVERABLE" ? `${scrap.destination?.warehouse?.code ?? ""} / ${scrap.destination?.location?.code ?? ""} (damaged stock)` : "Disposed of"],
          ["Recovery value", scrap.recoveryValue ? inr(scrap.recoveryValue) : "—"],
          ["Scrap date", scrap.scrapDate ? formatDate(scrap.scrapDate) : "—"],
          ["Recorded by", scrap.createdBy ?? "—"], ["Posted by", scrap.postedBy ?? "—"],
          ["Value", scrap.totals.cost ? inr(scrap.totals.cost) : "—"],
        ]} />
        {scrap.description && <p className="text-sm">{scrap.description}</p>}
        <Panel title={scrap.scrapType === "ISSUED_MATERIAL" ? "Material scrapped" : "Rejected output scrapped"}
          description={scrap.status === "POSTED" ? undefined : "The source figures are as of now; posting checks them again."}>
          <LinesTable columns={["#", scrap.scrapType === "ISSUED_MATERIAL" ? "Material" : "Production entry", { label: "Quantity", numeric: true }, "Batch / serial",
            ...(scrap.status === "POSTED" ? [] : [{ label: scrap.scrapType === "ISSUED_MATERIAL" ? "In custody now" : "Undisposed now", numeric: true }]), ...(can.viewCost ? [{ label: "Value", numeric: true }] : [])]}>
            {scrap.lines.map((line) => (
              <tr key={line.id}>
                <Cell>{line.lineNumber}</Cell>
                <Cell>{scrap.scrapType === "ISSUED_MATERIAL" ? `${line.code} · ${line.name}` : `${line.entryNumber}${line.productionBatch ? ` · ${line.productionBatch}` : ""} · ${line.code}`}</Cell>
                <Cell numeric>{qty(line.quantity)} {line.uom}</Cell>
                <Cell><span className="text-xs">{line.batch?.number ?? (line.serials.map((serial) => serial.number).join(", ") || "—")}</span></Cell>
                {scrap.status !== "POSTED" && <Cell numeric>{line.now ? qty(line.now.custody ?? line.now.undisposed ?? null) : ""}</Cell>}
                {can.viewCost && <Cell numeric>{line.totalCost ? inr(line.totalCost) : ""}</Cell>}
              </tr>
            ))}
          </LinesTable>
        </Panel>
        {preview && (
          <Panel title="Review" description={`Checked ${formatDateTime(preview.checkedAt)}. Nothing has moved; posting checks it all again.`}>
            {preview.ok ? <Notice tone="success">This scrap can be posted now.</Notice> : <Notice tone={preview.readiness === "PENDING_APPROVAL" ? "warning" : "danger"}><ul className="list-disc pl-4">{preview.problems.map((row) => <li key={row.message}>{row.message}</li>)}</ul></Notice>}
            {preview.cost && <p className="text-sm">{preview.cost.total ? `Value ${inr(preview.cost.total)}. ` : ""}{preview.cost.treatment}.</p>}
            {preview.ok && can.post && <div className="flex justify-end"><Button variant="primary" onPress={post}>Post</Button></div>}
          </Panel>
        )}
        {(scrap.approval.required || scrap.approval.status !== "NOT_REQUIRED") && (
          <Panel title="Approval">
            <FactList items={[
              ["Why it is needed", scrap.approval.reasons.join(", ") || "—"], ["Status", scrap.approval.status.toLowerCase().replace(/_/g, " ")],
              ["Submitted by", scrap.approval.requestedBy ? `${scrap.approval.requestedBy}, ${formatDateTime(scrap.approval.requestedAt!)}` : "—"],
              ["Decided by", scrap.approval.decidedBy ? `${scrap.approval.decidedBy}, ${formatDateTime(scrap.approval.decidedAt!)}` : "—"], ["Note", scrap.approval.note ?? "—"],
            ]} />
          </Panel>
        )}
        {scrap.posting && (
          <Panel title="Posting" description="Recorded once, in one transaction under one posting identity.">
            <FactList items={[["Posting identity", scrap.posting.key], ["Inventory", scrap.posting.inventoryStatus === "NOT_REQUIRED" ? "No stock movement (already out of the warehouse)" : `${scrap.posting.stockMovementIds.length} movement(s) into the scrap bin`],
              ["Finance", scrap.posting.financeStatus === "NOT_REQUIRED" ? "No journal (normal loss stays in the order's cost)" : scrap.posting.financeStatus.toLowerCase()], ["Posted", formatDateTime(scrap.posting.at)]]} />
            {check && <Notice tone={check.consistent ? "success" : "danger"}>{check.consistent ? `Checked ${formatDateTime(check.checkedAt)}: custody, Inventory and Finance agree with the note.` : check.problems.join(" ")}</Notice>}
          </Panel>
        )}
        {scrap.corrections.length > 0 && (
          <Panel title="Corrections">
            <LinesTable columns={["Correction", "Status", "Why", "Still physically there", "Asked by", "Decided by", "Note"]}>
              {scrap.corrections.map((row) => (
                <tr key={row.id}><Cell>{row.number}</Cell><Cell>{row.status.toLowerCase()}</Cell><Cell>{row.reason}{row.evidence ? ` (${row.evidence})` : ""}</Cell><Cell>{row.physicallyPresent ? "Yes" : "—"}</Cell>
                  <Cell>{row.requestedBy}, {formatDateTime(row.requestedAt)}</Cell><Cell>{row.decidedBy ? `${row.decidedBy}, ${formatDateTime(row.decidedAt!)}` : "—"}</Cell><Cell>{row.note ?? ""}</Cell></tr>
              ))}
            </LinesTable>
          </Panel>
        )}
        <HistoryList title="Timeline" entries={scrap.history.map((row) => ({ summary: row.label, at: row.at, actor: row.actor, detail: row.summary ?? undefined }))} />
      </div>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </RecordDetailsPage>
  );
}

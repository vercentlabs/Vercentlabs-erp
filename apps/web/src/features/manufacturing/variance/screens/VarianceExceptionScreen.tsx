"use client";

// One material variance exception: the line as it stands now, the figures it opened with and was submitted with (an approval covers only those),
// the investigation (reason, explanation, evidence), the review and the resolution, follow-ups (extra material, a hold, a BOM review) and
// the history. Approving never changes the BOM, moves stock or posts to Finance; rejecting leaves the posted consumption as it is.
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Breadcrumb, Button, ErrorState, PermissionState, RecordDetailsPage, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, inr, qty } from "@/features/manufacturing/orders/api/mo-api";
import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import {
  BAND_TONE, REASON_OPTIONS, RESOLUTION_OPTIONS, STATUS_TONE, VARIANCE_BASE, exceptionAction, getException, signed, updateException, type Snapshot, type VarianceException,
} from "../api/variance-api";

const NONE = "none";

export function VarianceExceptionScreen({ exceptionId }: { exceptionId: string }) {
  const workspace = useWorkspaceContext();
  const key = scopedQueryKey(workspace, "manufacturing", "variance-exception", exceptionId);
  const query = useQuery({ queryKey: key, queryFn: () => getException(exceptionId), retry: false });
  if (query.isLoading) return <LoadingState label="Loading the exception" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to material variance" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the exception" description={errorMessage(query.error)} />;
  }
  return <ExceptionView key={`${query.data.id}:${query.data.rowVersion}:${query.data.status}`} exception={query.data} />;
}

function ExceptionView({ exception }: { exception: VarianceException }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = exception.can;
  const line = exception.material;
  const [reason, setReason] = useState(exception.reasonCode ?? NONE);
  const [explanation, setExplanation] = useState(exception.explanation ?? "");
  const [evidence, setEvidence] = useState(exception.evidence ?? "");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = async (text: string) => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") }); setMessage({ tone: "success", text }); };
  const run = async (work: () => Promise<unknown>, text: string) => {
    setBusy(true);
    try { await work(); await refresh(text); } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
  };
  const investigation = { reasonCode: reason === NONE ? null : reason, explanation: explanation.trim() || null, evidence: evidence.trim() || null };
  const dirty = (investigation.reasonCode ?? null) !== (exception.reasonCode ?? null) || (investigation.explanation ?? "") !== (exception.explanation ?? "") || (investigation.evidence ?? "") !== (exception.evidence ?? "");
  const toolbar = (
    <div className="flex flex-wrap gap-2">
      {can.edit && <Button size="compact" variant="secondary" isLoading={busy} isDisabled={!dirty} onPress={() => run(() => updateException(exception.id, { ...investigation, expectedVersion: exception.rowVersion }), "Investigation saved.")}>Save</Button>}
      {can.submit && <Button size="compact" variant="primary" isLoading={busy} onPress={() => run(async () => {
        if (dirty && exception.status === "OPEN") await updateException(exception.id, { ...investigation, expectedVersion: exception.rowVersion });
        await exceptionAction(exception.id, "submit", {});
      }, "Submitted for approval.")}>{exception.status === "SUBMITTED" ? "Submit again" : "Submit for approval"}</Button>}
      {can.decide && <Button size="compact" variant="primary" onPress={() => setAsk({ title: "Approve the variance", confirm: "Approve", tone: "danger",
        description: "Approval covers exactly the figures submitted. It does not change the BOM, issue material or post anything.", fields: [{ name: "note", label: "Note", kind: "textarea" }],
        run: async (values) => { await exceptionAction(exception.id, "decide", { decision: "APPROVE", note: values.note || undefined }); await refresh("Approved."); } })}>Approve</Button>}
      {can.decide && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Ask for more evidence", confirm: "Send back", fields: [{ name: "note", label: "What is missing", kind: "textarea", required: true }],
        run: async (values) => { await exceptionAction(exception.id, "decide", { decision: "MORE_EVIDENCE", note: values.note }); await refresh("Sent back for more evidence."); } })}>More evidence</Button>}
      {can.decide && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Reject the variance", confirm: "Reject", tone: "danger",
        description: "The posted consumption stays as it is; the variance stays unauthorized until it is corrected or approved.", fields: [{ name: "note", label: "Why", kind: "textarea", required: true }],
        run: async (values) => { await exceptionAction(exception.id, "decide", { decision: "REJECT", note: values.note }); await refresh("Rejected."); } })}>Reject</Button>}
      {can.resolve && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Resolve the exception", confirm: "Resolve",
        fields: [{ name: "resolutionType", label: "How", kind: "select", required: true, initial: exception.status === "APPROVED" ? "AUTHORIZED_VARIANCE" : "SOURCE_CORRECTED", options: RESOLUTION_OPTIONS },
          { name: "note", label: "What was done", kind: "textarea", required: true }],
        run: async (values, requestKey) => { await exceptionAction(exception.id, "resolve", { resolutionType: values.resolutionType, note: values.note, idempotencyKey: requestKey }); await refresh("Resolved."); } })}>Resolve</Button>}
      {can.requestMaterial && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Request extra material", confirm: "Request",
        description: "Creates an extra-material request on the order, approved on its own. Approving this variance never approves an issue.",
        fields: [{ name: "quantity", label: `Quantity (${line?.uom ?? ""})`, kind: "quantity", required: true }, { name: "reason", label: "Why", kind: "textarea", required: true }],
        run: async (values) => { await exceptionAction(exception.id, "request-material", { quantity: values.quantity, reason: values.reason }); await refresh("Extra material requested."); } })}>Request material</Button>}
      {can.recommendHold && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: can.placeHold ? "Hold production" : "Recommend a hold", confirm: can.placeHold ? "Put on hold" : "Recommend", tone: "danger",
        fields: [{ name: "note", label: "Why production should stop", kind: "textarea", required: true }, ...(can.placeHold ? [{ name: "placeHold", label: "Put the order on hold now", kind: "checkbox" as const, initial: true }] : [])],
        run: async (values) => { await exceptionAction(exception.id, "recommend-hold", { note: values.note, placeHold: Boolean(values.placeHold) }); await refresh(values.placeHold ? "The order is on hold." : "Hold recommended."); } })}>Hold</Button>}
      {can.bomReview && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Request a BOM review", confirm: "Request",
        description: "Engineering reviews the standard. Released orders and past variances keep the revision they used; a new revision follows the BOM workflow.",
        fields: [{ name: "reason", label: "What looks wrong in the BOM", kind: "textarea", required: true }],
        run: async (values) => { await exceptionAction(exception.id, "bom-review", { reason: values.reason }); await refresh("BOM review requested."); } })}>BOM review</Button>}
    </div>
  );
  const snapRow = (label: string, snap: Snapshot | null) => snap ? (
    <tr key={label}><Cell>{label}</Cell><Cell numeric>{snap.expected === null ? "—" : qty(snap.expected)}</Cell><Cell numeric>{qty(snap.consumed)}</Cell><Cell numeric>{qty(snap.scrapped)}</Cell>
      <Cell numeric>{signed(snap.variance)}{snap.pct ? ` (${signed(snap.pct)}%)` : ""}</Cell><Cell>{snap.bandLabel}</Cell><Cell>{snap.usageCost ? inr(snap.usageCost) : ""}</Cell><Cell>{formatDateTime(snap.at)}</Cell></tr>
  ) : null;
  return (
    <RecordDetailsPage
      header={{
        breadcrumbs: <Breadcrumb href={VARIANCE_BASE}>Variance Exceptions</Breadcrumb>,
        title: `${exception.number} · ${line?.code ?? ""}`,
        status: <span className="flex flex-wrap gap-1"><StatusBadge tone={STATUS_TONE[exception.status] ?? "neutral"}>{exception.statusLabel}</StatusBadge>
          {line && <StatusBadge tone={BAND_TONE[line.band]}>{line.bandLabel}</StatusBadge>}{exception.stale && exception.status !== "RESOLVED" && <StatusBadge tone="danger">Figures changed</StatusBadge>}</span>,
        fields: [{ label: "Order", value: exception.order.number }, { label: "Material", value: line ? `${line.code} · ${line.name}` : "—" },
          { label: "Variance now", value: line?.variance ? `${signed(line.variance)} ${line.uom}${line.variancePct ? ` (${signed(line.variancePct)}%)` : ""}` : "—" }, { label: "Owner", value: exception.assignedTo ?? "—" }],
        primaryAction: toolbar,
      }}
    >
      <div className="flex flex-col gap-4">
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        {exception.stale && exception.status !== "RESOLVED" && <Notice tone="warning">Usage changed after this was submitted: an approval covers only the submitted figures. Review and submit again.</Notice>}
        {line && <Notice tone={line.needsApproval ? "warning" : "neutral"}>{line.explanation}</Notice>}
        <FactList items={[
          ["Manufacturing order", <Link key="order" className="text-brand underline" href={`${MO_BASE}/${exception.order.id}?tab=materials`}>{exception.order.number} · {exception.order.statusLabel}</Link>],
          ["Issued / returned / in production", line ? `${qty(line.issued)} / ${qty(line.returned)} / ${qty(line.inCustody)} ${line.uom}` : "—"],
          ["Tolerance", line ? `${line.policy.source.toLowerCase()} · review above ${line.policy.warningPct}%, approval above ${line.policy.approvalPct}%${line.policy.critical ? " · critical material" : ""}` : "—"],
          ["Opened", `${exception.createdBy ?? "—"}, ${formatDateTime(exception.createdAt)}`],
          ...(line?.cost ? [["Usage cost now", line.cost.usage ? inr(line.cost.usage) : "—"] as [string, string], ["Actual vs expected cost", line.cost.total ? inr(line.cost.total) : "—"] as [string, string]] : []),
        ]} />
        <Panel title="Figures" description="What the exception saw when it opened and when it was submitted, against the line now.">
          <LinesTable columns={["When", { label: "Expected", numeric: true }, { label: "Consumed", numeric: true }, { label: "Scrapped", numeric: true }, { label: "Variance", numeric: true }, "Status", "Usage cost", "At"]}>
            {snapRow("Opened", exception.opened)}{snapRow("Submitted", exception.submitted)}
            {line && <tr><Cell>Now</Cell><Cell numeric>{line.expected === null ? "—" : qty(line.expected)}</Cell><Cell numeric>{qty(line.consumed)}</Cell><Cell numeric>{qty(line.scrapped)}</Cell>
              <Cell numeric>{signed(line.variance)}{line.variancePct ? ` (${signed(line.variancePct)}%)` : ""}</Cell><Cell>{line.bandLabel}</Cell><Cell>{line.cost?.usage ? inr(line.cost.usage) : ""}</Cell><Cell>—</Cell></tr>}
          </LinesTable>
        </Panel>
        <Panel title="Investigation">
          {can.edit ? (
            <div className="flex flex-col gap-3">
              <Select label="Reason" selectedKey={reason} onSelectionChange={(value) => setReason(String(value))} options={[{ value: NONE, label: "Choose…" }, ...REASON_OPTIONS]} />
              <TextArea label="Explanation" value={explanation} onChange={setExplanation} maxLength={2000} description="What happened, in plain words. Required before submitting." />
              <TextField label="Evidence (consumption note, scrap note, photo, count sheet)" value={evidence} onChange={setEvidence} />
            </div>
          ) : (
            <FactList items={[["Reason", exception.reasonLabel ?? "—"], ["Explanation", exception.explanation ?? "—"], ["Evidence", exception.evidence ?? "—"]]} />
          )}
        </Panel>
        {(exception.review.submittedAt || exception.review.decidedAt) && (
          <Panel title="Review">
            <FactList items={[["Submitted", exception.review.submittedBy ? `${exception.review.submittedBy}, ${formatDateTime(exception.review.submittedAt!)}` : "—"],
              ["Decided", exception.review.decidedBy ? `${exception.review.decidedBy}, ${formatDateTime(exception.review.decidedAt!)}` : "—"], ["Note", exception.review.note ?? "—"]]} />
          </Panel>
        )}
        {exception.resolution && (
          <Panel title="Resolution">
            <FactList items={[["How", RESOLUTION_OPTIONS.find((row) => row.value === exception.resolution?.type)?.label ?? exception.resolution.type], ["What was done", exception.resolution.note ?? "—"],
              ["By", `${exception.resolution.by ?? "—"}, ${formatDateTime(exception.resolution.at)}`]]} />
          </Panel>
        )}
        {(exception.bomReviews.length > 0 || exception.holdRecommended) && (
          <Panel title="Follow-ups">
            {exception.holdRecommended && <p className="text-sm">A production hold was recommended.</p>}
            {exception.bomReviews.map((row) => <p key={row.id} className="text-sm">BOM review ({row.status.toLowerCase()}): {row.reason}{row.closeNote ? ` — ${row.closeNote}` : ""}</p>)}
          </Panel>
        )}
        <HistoryList title="History" entries={exception.history.map((row) => ({ summary: row.label, at: row.at, actor: row.actor, detail: row.summary ?? undefined }))} />
      </div>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </RecordDetailsPage>
  );
}

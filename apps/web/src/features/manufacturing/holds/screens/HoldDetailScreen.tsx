"use client";

// One production hold: the order and its progress (kept as it was), why production stopped — each reason with its severity, what it is linked
// to, the corrective action and who must clear it — the resume readiness checked on the server, the resume request and its approval, the
// customer demand and orders it affects, evidence and the timeline. The toolbar offers only what the hold's state and the person allow.
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PermissionState, RecordDetailsPage, StatusBadge } from "@vercentlabs/design-system";

import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, qty } from "@/features/manufacturing/orders/api/mo-api";
import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import {
  HOLDS_BASE, SEVERITY_TONE, STATUS_TONE, duration, getHold, holdAction, holdFiles, reasonAction, removeHoldFile, uploadHoldFile, type ProductionHold,
} from "../api/hold-api";
import { holdAsk } from "../components/holdDialog";

const RISK_LABEL = { NONE: "Covered", ON_TRACK: "On track", AT_RISK: "At risk", LATE: "Late" } as const;
const RISK_TONE = { NONE: "success", ON_TRACK: "success", AT_RISK: "warning", LATE: "danger" } as const;

export function HoldDetailScreen({ holdId }: { holdId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "manufacturing", "production-hold", holdId);
  const query = useQuery({ queryKey: key, queryFn: () => getHold(holdId), retry: false });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (query.isLoading) return <LoadingState label="Loading the hold" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to production holds" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the hold" description={errorMessage(query.error)} />;
  }
  const hold = query.data;
  const can = hold.can;
  const active = hold.status === "ACTIVE";
  const refresh = async (text: string) => {
    await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
    setMessage({ tone: "success", text });
  };
  const readiness = hold.readiness;
  const blocked = readiness ? readiness.checks.filter((row) => row.blocking) : [];
  const shortageOnly = blocked.length > 0 && blocked.every((row) => row.code === "MFG_HOLD_MATERIAL_NOT_READY");
  const resumeFields = [{ name: "note", label: "How it was resolved", kind: "textarea" as const, required: true,
    description: "For example: missing wheels received and reserved; availability verified for the remaining chairs." },
    ...(shortageOnly && hold.policy.releaseWithShortages ? [{ name: "proceed", label: "Resume knowing materials are still short (the company allows it)", kind: "checkbox" as const }] : [])];
  const resume = () => setAsk({
    title: `Resume ${hold.order.number}`, confirm: "Resume production", tone: "danger",
    description: `Back to ${hold.previousStatusLabel.toLowerCase()}. Everything is checked again on the server. Quality holds on produced output stay until Quality releases them.`,
    fields: resumeFields,
    run: async (values, requestKey) => {
      await holdAction(hold.order.id, "resume", { productionHoldId: hold.id, resolutionNotes: values.note, proceedWithShortages: Boolean(values.proceed), expectedMoVersion: hold.order.version, idempotencyKey: requestKey });
      await refresh("Production resumed.");
    },
  });
  const requestResume = () => setAsk({
    title: `Ask to resume ${hold.order.number}`, confirm: "Request resume", description: "A manager other than you approves it; any change to the hold before then withdraws the request.",
    fields: resumeFields,
    run: async (values) => { await holdAction(hold.order.id, "request-resume", { note: values.note, proceedWithShortages: Boolean(values.proceed), expectedMoVersion: hold.order.version }); await refresh("Resume requested."); },
  });
  const decide = (decision: "APPROVE" | "REJECT") => setAsk({
    title: decision === "APPROVE" ? `Approve resuming ${hold.order.number}` : "Keep production on hold", confirm: decision === "APPROVE" ? "Approve and resume" : "Reject", tone: "danger",
    description: decision === "APPROVE" ? `Resumes to ${hold.previousStatusLabel.toLowerCase()} after checking everything again. Request: ${hold.resumeRequest?.note ?? ""}` : undefined,
    fields: [{ name: "note", label: decision === "APPROVE" ? "Note" : "Why it stays on hold", kind: "textarea", required: decision === "REJECT" }],
    run: async (values) => { await holdAction(hold.order.id, "decide-resume", { decision, note: values.note || undefined }); await refresh(decision === "APPROVE" ? "Approved: production resumed." : "Rejected: the order stays on hold."); },
  });
  const toolbar = (
    <div className="flex flex-wrap gap-2">
      {can.addReason && <Button size="compact" variant="secondary" onPress={() => setAsk(holdAsk(hold.order.id, { adding: true, onDone: () => refresh("Reason added.") }))}>Add reason</Button>}
      {can.resume && <Button size="compact" variant="primary" isDisabled={Boolean(readiness && !readiness.ready && !shortageOnly)} onPress={resume}>Resume production</Button>}
      {can.requestResume && !hold.resumeRequest?.current && <Button size="compact" variant="primary" isDisabled={Boolean(readiness && !readiness.ready && !shortageOnly && !readiness.checks.every((row) => !row.blocking || row.code === "MFG_HOLD_RESUME_APPROVAL_REQUIRED"))} onPress={requestResume}>Request resume</Button>}
      {can.decideResume && <Button size="compact" variant="primary" onPress={() => decide("APPROVE")}>Approve resume</Button>}
      {can.decideResume && <Button size="compact" variant="secondary" onPress={() => decide("REJECT")}>Reject resume</Button>}
    </div>
  );
  return (
    <RecordDetailsPage
      header={{
        breadcrumbs: <Link className="text-sm text-brand underline" href={HOLDS_BASE}>Production Holds</Link>,
        title: `${hold.number} · ${hold.order.number}`,
        status: <span className="flex flex-wrap gap-1"><StatusBadge tone={STATUS_TONE[hold.status]}>{hold.statusLabel}</StatusBadge><StatusBadge tone={SEVERITY_TONE[hold.severity]}>{hold.severity.toLowerCase()}</StatusBadge>
          {hold.overdue && <StatusBadge tone="danger">Overdue</StatusBadge>}</span>,
        fields: [{ label: "Product", value: hold.order.item }, { label: "Interrupted", value: hold.previousStatusLabel }, { label: "Owner", value: hold.owner ?? "—" },
          { label: active ? "On hold for" : "Lasted", value: duration(hold.durationHours) }],
        primaryAction: toolbar,
      }}
    >
      <div className="flex flex-col gap-4">
        {message?.text && <Notice tone={message.tone}>{message.text}</Notice>}
        {hold.closedReason && <Notice tone="neutral">{hold.closedReason}. A cancelled order is never resumed.</Notice>}
        {hold.status === "RESUMED" && <Notice tone="success">Resumed to {hold.resumedTo?.toLowerCase().replace(/_/g, " ")} by {hold.resumedBy} on {formatDateTime(hold.resolvedAt!)}: {hold.resolutionNotes}</Notice>}
        {hold.overdue && <Notice tone="danger">On hold for more than {hold.overdueAfterHours} hours.</Notice>}
        <FactList items={[
          ["Manufacturing order", <Link key="order" className="text-brand underline" href={`${MO_BASE}/${hold.order.id}`}>{hold.order.number} · {hold.order.statusLabel}</Link>],
          ["Progress (kept as it was)", `${qty(hold.order.accepted)} of ${qty(hold.order.planned)} accepted · ${qty(hold.order.remaining)} remaining`],
          ["Started", `${formatDateTime(hold.startedAt)} by ${hold.requestedBy ?? "—"}`], ["Production owner", hold.order.productionOwner ?? "—"],
          ["Affected location", hold.location ? `${hold.location.code} · ${hold.location.name}` : "—"],
          ["Expected resolution", hold.expectedResolutionAt ? formatDateTime(hold.expectedResolutionAt) : "—"],
        ]} />
        <Panel title="Why production stopped" description="Every reason must be cleared — each by its own authority — before production resumes. Clearing one does not resume the order.">
          <LinesTable columns={["Reason", "Severity", "Details", "Cleared by", "Status", ""]}>
            {hold.reasons.map((reason) => (
              <tr key={reason.id}>
                <Cell><span className="flex flex-col"><span className="font-medium">{reason.label}</span><span className="text-xs text-text-muted">Added by {reason.addedBy}, {formatDateTime(reason.addedAt)}</span></span></Cell>
                <Cell><StatusBadge tone={SEVERITY_TONE[reason.severity]}>{reason.severity.toLowerCase()}</StatusBadge></Cell>
                <Cell><span className="flex flex-col text-sm"><span>{reason.description}</span>
                  {reason.materials.length > 0 && <span className="text-xs text-text-muted">Materials: {reason.materials.join(", ")}</span>}
                  {reason.sourceReference && <span className="text-xs text-text-muted">Reference: {reason.sourceReference}</span>}
                  {reason.sourceType === "QUALITY_HOLD" && <span className="text-xs text-text-muted">Linked to a quality hold</span>}
                  {reason.sourceType === "QUALITY_INSPECTION" && reason.sourceId && <Link className="text-xs text-brand underline" href={`/manufacturing/quality-inspections/${reason.sourceId}`}>Linked inspection</Link>}
                  {reason.correctiveAction && <span className="text-xs">Action: {reason.correctiveAction}</span>}
                  {reason.resolutionNotes && <span className="text-xs text-success">Cleared by {reason.resolvedBy}, {formatDateTime(reason.resolvedAt!)}: {reason.resolutionNotes}{reason.evidence ? ` (${reason.evidence})` : ""}</span>}
                  {reason.pendingClearance && <span className="text-xs text-warning">{reason.pendingClearance}</span>}</span></Cell>
                <Cell>{reason.authorityLabel}</Cell>
                <Cell><StatusBadge tone={reason.status === "ACTIVE" ? "warning" : "success"}>{reason.status === "ACTIVE" ? "Blocking" : "Cleared"}</StatusBadge></Cell>
                <Cell><span className="flex flex-wrap justify-end gap-1">
                  {reason.can.act && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Corrective action", confirm: "Record", fields: [{ name: "correctiveAction", label: "What is being done", kind: "textarea", required: true, initial: reason.correctiveAction ?? "" }],
                    run: async (values) => { await reasonAction(reason.id, "corrective-action", { correctiveAction: values.correctiveAction }); await refresh("Corrective action recorded."); } })}>Action</Button>}
                  {reason.can.resolve && <Button size="compact" variant="secondary" onPress={() => setAsk({
                    title: `Clear: ${reason.label}`, confirm: "Clear reason", tone: "danger",
                    description: `${reason.authorityLabel} clears this reason. Clearing it does not resume the order${hold.reasons.filter((row) => row.status === "ACTIVE").length > 1 ? " — other reasons remain" : ""}.`,
                    fields: [{ name: "resolutionNotes", label: "What resolved it", kind: "textarea", required: true }, { name: "evidence", label: "Evidence (report, PO, test record)", kind: "text" }],
                    run: async (values, requestKey) => { await reasonAction(reason.id, "resolve", { resolutionNotes: values.resolutionNotes, evidence: values.evidence || null, idempotencyKey: requestKey }); await refresh("Reason cleared."); },
                  })}>Clear</Button>}
                </span></Cell>
              </tr>
            ))}
          </LinesTable>
        </Panel>
        {readiness && (
          <Panel title="Resume readiness" description={`Checked ${readiness.checkedAt ? formatDateTime(readiness.checkedAt) : "now"} on the server; resuming checks it all again.`}>
            <ul className="flex flex-col gap-1 text-sm">
              {readiness.checks.map((row) => (
                <li key={row.code + row.message} className="flex items-start gap-2"><StatusBadge tone={row.ok ? "success" : row.blocking ? "danger" : "warning"}>{row.ok ? "OK" : row.blocking ? "Blocks" : "Note"}</StatusBadge><span>{row.message}</span></li>
              ))}
              {readiness.warnings.filter((text) => !readiness.checks.some((row) => row.message === text)).map((text) => (
                <li key={text} className="flex items-start gap-2"><StatusBadge tone="warning">Note</StatusBadge><span>{text}</span></li>
              ))}
            </ul>
          </Panel>
        )}
        {hold.resumeRequest && (
          <Panel title="Resume request">
            <FactList items={[["Asked by", `${hold.resumeRequest.by ?? "—"}, ${formatDateTime(hold.resumeRequest.at)}`], ["Note", hold.resumeRequest.note ?? "—"],
              ["Status", hold.resumeRequest.approvedAt ? `Approved by ${hold.resumeRequest.approvedBy}` : hold.resumeRequest.current ? "Waiting for approval" : "Withdrawn: the hold changed after it was asked"]]} />
          </Panel>
        )}
        {hold.salesDemand.length > 0 && (
          <Panel title="Customer demand affected" description="The hold changes no promised date or quantity: that stays a Sales decision. Sales sees only the simplified message.">
            <LinesTable columns={["Sales order", "Customer", "Required", { label: "Still to make", numeric: true }, "Risk", "Sales sees"]}>
              {hold.salesDemand.map((row) => (
                <tr key={row.demandId}><Cell>{row.salesOrderNumber}</Cell><Cell>{row.customer ?? ""}</Cell><Cell>{row.requiredDate ? formatDate(row.requiredDate) : "—"}</Cell><Cell numeric>{qty(row.unfinished)}</Cell>
                  <Cell><StatusBadge tone={RISK_TONE[row.risk]}>{RISK_LABEL[row.risk]}</StatusBadge></Cell><Cell>{row.salesMessage ?? ""}</Cell></tr>
              ))}
            </LinesTable>
          </Panel>
        )}
        {(hold.dependencies.parents.length > 0 || hold.dependencies.children.some((row) => row.holdNumber)) && (
          <Panel title="Linked orders" description="Shown for planning; no linked order is paused or resumed automatically.">
            <LinesTable columns={["Order", "Link", "Product", "Status", "Note"]}>
              {hold.dependencies.parents.map((row) => <tr key={row.id}><Cell><Link className="text-brand underline" href={`${MO_BASE}/${row.id}`}>{row.number}</Link></Cell><Cell>Uses this order&apos;s output</Cell><Cell>{row.item}</Cell><Cell>{row.statusLabel}</Cell><Cell>{row.note ?? ""}</Cell></tr>)}
              {hold.dependencies.children.filter((row) => row.holdNumber).map((row) => <tr key={row.id}><Cell><Link className="text-brand underline" href={`${MO_BASE}/${row.id}`}>{row.number}</Link></Cell><Cell>Subassembly for this order</Cell><Cell>{row.item}</Cell><Cell>{row.statusLabel}</Cell><Cell>{row.holdNumber} since {formatDateTime(row.heldSince!)}</Cell></tr>)}
            </LinesTable>
          </Panel>
        )}
        <EvidencePanel hold={hold} />
        <HistoryList title="Timeline" entries={hold.history.map((row) => ({ summary: row.label, at: row.at, actor: row.actor, detail: row.summary ?? undefined }))} />
      </div>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </RecordDetailsPage>
  );
}

function EvidencePanel({ hold }: { hold: ProductionHold }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "manufacturing", "production-hold-files", hold.id);
  const files = useQuery({ queryKey: key, queryFn: () => holdFiles(hold.id) });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await work(); await queryClient.invalidateQueries({ queryKey: key }); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Panel title="Notes and evidence" description="Incident reports, photos, supplier confirmations and clearance records (up to 10 MB each). Evidence of an ended hold is kept.">
      {hold.notes && <p className="text-sm">{hold.notes}</p>}
      {error && <Notice tone="danger">{error}</Notice>}
      {(files.data ?? []).length ? (
        <LinesTable columns={["File", { label: "Size", numeric: true }, "Added", ""]}>
          {(files.data ?? []).map((file) => (
            <tr key={file.id}>
              <Cell><a className="text-brand underline" href={`/api/manufacturing/production-holds/${hold.id}/files/${file.id}`}>{file.fileName}</a></Cell>
              <Cell numeric>{Math.max(1, Math.round(file.sizeBytes / 1024))} KB</Cell><Cell>{formatDateTime(file.uploadedAt)}</Cell>
              <Cell>{hold.status === "ACTIVE" && hold.can.attach && <Button size="compact" variant="ghost" isDisabled={busy} onPress={() => run(() => removeHoldFile(hold.id, file.id))}>Remove</Button>}</Cell>
            </tr>
          ))}
        </LinesTable>
      ) : <p className="text-sm text-text-muted">{files.isLoading ? "Loading…" : "No evidence attached."}</p>}
      {hold.can.attach && (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-text-secondary">Attach a file</span>
          <input type="file" disabled={busy} accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.xlsx,.docx"
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(() => uploadHoldFile(hold.id, file)); }} />
        </label>
      )}
    </Panel>
  );
}

"use client";

// One production inspection: what it covers (order, entry, batch, product, quantity, sample), the frozen checklist with each result evaluated
// on the server, defects, the decision (accepted, rejected with what happens to it, held), the review the company's policy or a deviation asks
// for, what finalizing posted, evidence files and the timeline. While it is open the inspector records results and the decision here; the
// toolbar offers only what its state and the person's permissions allow, and finalizing asks first and re-checks everything on the server.
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ErrorState, PermissionState, RecordDetailsPage, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, qty } from "@/features/manufacturing/orders/api/mo-api";
import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import {
  DEFECT_REASONS, DISPOSITION_LABEL, QI_BASE, QI_TONE, getInspection, inspectionAction, inspectionFiles, reasonLabel, recordInspection, removeInspectionFile, uploadInspectionFile,
  type QiCheck, type QualityInspection,
} from "../api/qi-api";

type DefectRow = { reasonCode: string; severity: string; affectedQuantity: string; observation: string };
type Draft = {
  values: Record<string, string>; notes: Record<string, string>; defects: DefectRow[]; examined: string; accepted: string; rejected: string; held: string; rejectionReason: string;
  disposition: string; reworkAssignedTo: string; holdReason: string; deviationRequested: boolean; generalNotes: string;
};
const NONE = "none";
const zero = (value: string) => (Number(value) ? value : "");
const draftOf = (inspection: QualityInspection): Draft => ({
  values: Object.fromEntries(inspection.checks.map((row) => [row.key, row.value ?? ""])), notes: Object.fromEntries(inspection.checks.map((row) => [row.key, row.notes ?? ""])),
  defects: inspection.defects.map((row) => ({ reasonCode: row.reasonCode, severity: row.severity, affectedQuantity: row.affectedQuantity, observation: row.observation ?? "" })),
  examined: inspection.quantities.examined, accepted: zero(inspection.quantities.accepted), rejected: zero(inspection.quantities.rejected), held: zero(inspection.quantities.held),
  rejectionReason: inspection.decision.rejectionReason ?? "", disposition: inspection.decision.rejectionDisposition ?? NONE, reworkAssignedTo: inspection.decision.reworkAssignedTo ?? "",
  holdReason: inspection.decision.holdReason ?? "", deviationRequested: inspection.decision.deviationRequested, generalNotes: inspection.notes ?? "",
});
const resultTone = (result: QiCheck["result"]) => (result === "PASS" ? "success" : result === "FAIL" ? "danger" : "neutral");

export function QiDetailScreen({ inspectionId }: { inspectionId: string }) {
  const workspace = useWorkspaceContext();
  const key = scopedQueryKey(workspace, "manufacturing", "quality-inspection", inspectionId);
  const query = useQuery({ queryKey: key, queryFn: () => getInspection(inspectionId), retry: false });
  if (query.isLoading) return <LoadingState label="Loading the inspection" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to production inspections" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the inspection" description={errorMessage(query.error)} />;
  }
  return <Inspection inspection={query.data} queryKey={key} />;
}

function Inspection({ inspection, queryKey }: { inspection: QualityInspection; queryKey: readonly unknown[] }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = inspection.can;
  // Unsaved edits; without any, the form shows the inspection as saved.
  const [edits, setEdits] = useState<Draft | null>(null);
  const draft = edits ?? draftOf(inspection);
  const dirty = edits !== null;
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const edit = (patch: Partial<Draft>) => setEdits({ ...draft, ...patch });
  const refresh = async (next?: QualityInspection) => {
    if (next) queryClient.setQueryData(queryKey, next);
    await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
  };
  const perform = async (work: () => Promise<unknown>, text: string) => {
    setBusy(true);
    try {
      const result = await work() as { inspection?: QualityInspection };
      setEdits(null);
      await refresh(result?.inspection);
      setMessage({ tone: "success", text });
    } catch (failure) {
      setMessage({ tone: "danger", text: errorMessage(failure) });
      throw failure;
    } finally { setBusy(false); }
  };
  const quiet = (work: () => Promise<unknown>, text: string) => perform(work, text).catch(() => undefined);
  const save = () => quiet(() => recordInspection(inspection.id, {
    expectedVersion: inspection.rowVersion,
    results: inspection.checks.map((row) => ({ key: row.key, value: draft.values[row.key]?.trim() || null, notes: draft.notes[row.key]?.trim() || null })),
    defects: draft.defects.filter((row) => row.reasonCode && Number(row.affectedQuantity) > 0).map((row) => ({ ...row, observation: row.observation.trim() || null })),
    examinedQuantity: draft.examined || null, acceptedQuantity: draft.accepted || "0", rejectedQuantity: draft.rejected || "0", holdQuantity: draft.held || "0",
    rejectionReason: draft.rejectionReason.trim() || null, rejectionDisposition: Number(draft.rejected) > 0 && draft.disposition !== NONE ? draft.disposition : null,
    reworkAssignedTo: draft.reworkAssignedTo.trim() || null, holdReason: draft.holdReason.trim() || null, deviationRequested: draft.deviationRequested, notes: draft.generalNotes.trim() || null,
  }).then((next) => ({ inspection: next })), "Saved. The checks below are evaluated on the server.");
  const q = inspection.quantities;
  const finalize = () => setAsk({
    title: `Finalize ${inspection.number}`, confirm: "Finalize", tone: "danger",
    description: inspection.stage === "IN_PROCESS" ? "Records this in-process check. It decides no output."
      : `${qty(q.accepted)} accepted${Number(q.rejected) ? `, ${qty(q.rejected)} rejected (${DISPOSITION_LABEL[inspection.decision.rejectionDisposition ?? ""]?.toLowerCase() ?? ""})` : ""}${Number(q.held) ? `, ${qty(q.held)} placed on hold` : ""} of ${inspection.entry.number}. This is the one quality decision for these units: it cannot be edited afterwards, only corrected by a recorded quality correction. No stock moves — accepted output is received through a finished-goods receipt.`,
    fields: [],
    run: () => perform(() => inspectionAction(inspection.id, "finalize", { expectedVersion: inspection.rowVersion, expectedEntryVersion: inspection.entry.rowVersion ?? undefined }), "Finalized: the decision is posted."),
  });
  const open = ["DRAFT", "IN_PROGRESS", "PENDING_REVIEW"].includes(inspection.status);
  const editable = can.record;

  const toolbar = (
    <div className="flex flex-wrap gap-2">
      {editable && <Button size="compact" variant={dirty ? "primary" : "secondary"} isLoading={busy} onPress={save}>Save results</Button>}
      {can.finalize && <Button size="compact" variant="primary" isDisabled={dirty || busy} onPress={finalize}>Finalize</Button>}
      {can.submit && <Button size="compact" variant="primary" isDisabled={dirty || busy} onPress={() => quiet(() => inspectionAction(inspection.id, "submit", { expectedVersion: inspection.rowVersion }), "Submitted for review.")}>Submit for review</Button>}
      {can.review && <Button size="compact" variant="primary" isLoading={busy} onPress={() => setAsk({ title: `Approve ${inspection.number}`, confirm: "Approve and finalize", tone: "danger",
        description: `Approving finalizes the inspection: ${qty(q.accepted)} accepted, ${qty(q.rejected)} rejected, ${qty(q.held)} held.${inspection.decision.deviation ? " Acceptance is under a documented deviation after a critical failure." : ""}`,
        fields: [{ name: "note", label: "Note", kind: "textarea" }],
        run: (values) => perform(() => inspectionAction(inspection.id, "review", { decision: "APPROVE", note: values.note || undefined }), "Approved and finalized.") })}>Approve</Button>}
      {can.review && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Return the inspection", confirm: "Return", fields: [{ name: "note", label: "What needs to change", kind: "textarea", required: true }],
        run: (values) => perform(() => inspectionAction(inspection.id, "review", { decision: "RETURN", note: values.note }), "Returned to the inspector.") })}>Return</Button>}
      {can.print && <Button size="compact" variant="ghost" onPress={() => window.open(`${QI_BASE}/${inspection.id}/print`, "_blank")}>{inspection.print.count ? "Reprint" : "Print"}</Button>}
      {can.recover && <Button size="compact" variant="ghost" isLoading={busy} onPress={() => quiet(() => inspectionAction(inspection.id, "recover"), "Re-checked against the posted decision.")}>Re-check</Button>}
      {can.cancel && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Cancel the inspection", confirm: "Cancel inspection", tone: "danger", fields: [{ name: "reason", label: "Why", kind: "textarea", required: true }],
        run: (values) => perform(() => inspectionAction(inspection.id, "cancel", { reason: values.reason, expectedVersion: inspection.rowVersion }), "Cancelled.") })}>Cancel</Button>}
    </div>
  );

  return (
    <RecordDetailsPage
      header={{
        breadcrumbs: <Link className="text-sm text-brand underline" href={QI_BASE}>Production Inspections</Link>,
        title: `${inspection.number} · ${inspection.order.number}`,
        status: <span className="flex flex-wrap gap-1"><StatusBadge tone={QI_TONE[inspection.status]}>{inspection.statusLabel}</StatusBadge>
          {inspection.stage === "IN_PROCESS" && <StatusBadge tone="neutral">In-process check</StatusBadge>}{inspection.criticalFailure && <StatusBadge tone="danger">Critical failure</StatusBadge>}</span>,
        fields: [
          { label: "Entry", value: `${inspection.entry.number ?? ""}${inspection.entry.batch ? ` · ${inspection.entry.batch}` : ""}` },
          { label: "Product", value: `${inspection.item.code ?? ""} · ${inspection.item.name ?? ""}` },
          { label: "Covers", value: `${qty(q.scope)} ${inspection.uom ?? ""}${q.examined !== q.scope ? ` · ${qty(q.examined)} examined` : ""}` },
          { label: "Checklist", value: inspection.template ? `${inspection.template.number} rev ${inspection.template.revision}` : "Basic" },
        ],
        primaryAction: toolbar,
      }}
    >
      <div className="flex flex-col gap-4">
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        {inspection.status === "RECOVERY_REQUIRED" && <Notice tone="danger">This inspection disagrees with the decision it posted. Do not inspect the output again: re-check once it is corrected.</Notice>}
        {inspection.cancelReason && <Notice tone="neutral">Cancelled by {inspection.cancelledBy}: {inspection.cancelReason}</Notice>}
        {inspection.reporterBlocked && open && <Notice tone="warning">You reported this output: someone else finalizes its quality decision.</Notice>}
        {open && inspection.review.required && !inspection.review.approved && (
          <Notice tone="warning">{inspection.status === "PENDING_REVIEW" ? `Waiting for a review (${inspection.review.reasons.join(", ")}), by someone other than the inspector.` : `Needs a review before it is final: ${inspection.review.reasons.join(", ")}.`}</Notice>
        )}
        {inspection.review.decision === "RETURNED" && inspection.status === "IN_PROGRESS" && <Notice tone="warning">Returned by {inspection.review.reviewer}: {inspection.review.note}</Notice>}
        {open && inspection.problems.length > 0 && !dirty && (
          <Notice tone="danger"><ul className="list-disc pl-4">{inspection.problems.map((row) => <li key={row.message}>{row.message}</li>)}</ul></Notice>
        )}
        {dirty && <Notice tone="neutral">Unsaved changes: save the results to have them checked.</Notice>}
        {open && q.available !== null && Number(q.available) < Number(q.scope) && inspection.stage === "FINAL" && (
          <Notice tone="warning">Only {qty(q.available)} of this entry still awaits a decision: another inspection or a hold took some of it.</Notice>
        )}
        <FactList items={[
          ["Manufacturing order", <Link key="order" className="text-brand underline" href={`${MO_BASE}/${inspection.order.id}?tab=quality`}>{inspection.order.number}</Link>],
          ["Inspector", `${inspection.inspector ?? "—"} · ${formatDateTime(inspection.inspectedAt)}`],
          ["Sampling", inspection.samplingBasis === "FULL" ? "Every unit covered is examined" : inspection.samplingBasis === "SAMPLE" ? "A sample: only the units examined are decided" : "A sample deciding the units it covers (company policy)"],
          ["Where", inspection.location ? `${inspection.location.code} · ${inspection.location.name}` : "—"],
          ["Finalized", inspection.finalizedAt ? `${inspection.finalizedBy}, ${formatDateTime(inspection.finalizedAt)}` : "—"],
        ]} />
        <Panel title="Checks" description={inspection.template ? `${inspection.template.name}, revision ${inspection.template.revision}${inspection.template.current ? "" : " (since revised: this inspection keeps the revision it started with)"}. Each result is evaluated on the server.` : "A basic inspection: no checklist is in force for this product."}>
          {inspection.checks.length === 0 ? <p className="text-sm text-text-muted">No checks: record the decision with its reasons and defects.</p> : (
            <LinesTable columns={["Check", "Requirement", "Result", "Evaluation", "Notes"]}>
              {inspection.checks.map((row) => (
                <tr key={row.key}>
                  <Cell><span className="flex flex-col"><span>{row.name}{row.critical ? <span className="text-xs text-danger"> · critical</span> : null}{row.required ? "" : <span className="text-xs text-text-muted"> · optional</span>}</span>
                    {row.instructions && <span className="text-xs text-text-muted">{row.instructions}</span>}</span></Cell>
                  <Cell>{row.type === "NUMERIC" ? `${row.lower ?? "—"} to ${row.upper ?? "—"} ${row.unit ?? ""}` : row.type === "CHOICE" ? (row.acceptedChoices.length ? `One of ${row.acceptedChoices.join(", ")}` : row.choices.join(" / ")) : row.type === "PASS_FAIL" ? "Pass" : "Observation"}</Cell>
                  <Cell>{editable ? (
                    row.type === "PASS_FAIL" ? <Select aria-label={row.name} selectedKey={draft.values[row.key] || NONE} onSelectionChange={(value) => edit({ values: { ...draft.values, [row.key]: String(value) === NONE ? "" : String(value) } })}
                      options={[{ value: NONE, label: "—" }, { value: "PASS", label: "Pass" }, { value: "FAIL", label: "Fail" }, ...(row.required ? [] : [{ value: "NA", label: "Not applicable" }])]} />
                    : row.type === "CHOICE" ? <Select aria-label={row.name} selectedKey={draft.values[row.key] || NONE} onSelectionChange={(value) => edit({ values: { ...draft.values, [row.key]: String(value) === NONE ? "" : String(value) } })}
                      options={[{ value: NONE, label: "—" }, ...row.choices.map((choice) => ({ value: choice, label: choice }))]} />
                    : <TextField aria-label={row.name} size="compact" className="w-32" inputMode={row.type === "NUMERIC" ? "decimal" : "text"} value={draft.values[row.key] ?? ""}
                      onChange={(value) => edit({ values: { ...draft.values, [row.key]: value } })} />
                  ) : <span>{row.value ?? "—"}{row.type === "NUMERIC" && row.unit && row.value ? ` ${row.unit}` : ""}</span>}</Cell>
                  <Cell>{dirty ? <span className="text-xs text-text-muted">Save to evaluate</span> : row.result ? <StatusBadge tone={resultTone(row.result)}>{row.result === "NA" ? "N/A" : row.result === "PASS" ? "Pass" : "Fail"}</StatusBadge>
                    : row.problem ? <span className="text-xs text-danger">{row.problem === "MFG_QI_MEASUREMENT_INVALID" ? "Not valid" : "Not recorded"}</span> : <span className="text-xs text-text-muted">—</span>}</Cell>
                  <Cell>{editable ? <TextField aria-label={`${row.name} notes`} size="compact" value={draft.notes[row.key] ?? ""} onChange={(value) => edit({ notes: { ...draft.notes, [row.key]: value } })} /> : row.notes ?? ""}</Cell>
                </tr>
              ))}
            </LinesTable>
          )}
        </Panel>
        <Panel title="Defects" description="What was found, how serious and on how many units. Two defects on one unit are two defects and one rejected unit — defects are never added up into rejected quantity.">
          {editable ? (
            <div className="flex flex-col gap-2">
              {draft.defects.map((row, index) => {
                const set = (patch: Partial<DefectRow>) => edit({ defects: draft.defects.map((defect, at) => (at === index ? { ...defect, ...patch } : defect)) });
                return (
                  <div key={index} className="grid items-end gap-2 sm:grid-cols-[1fr_10rem_8rem_1fr_auto]">
                    <Select label="Reason" selectedKey={row.reasonCode} onSelectionChange={(value) => set({ reasonCode: String(value) })}
                      options={[...new Set([...DEFECT_REASONS, row.reasonCode])].filter(Boolean).map((code) => ({ value: code, label: reasonLabel(code) }))} />
                    <Select label="Severity" selectedKey={row.severity} onSelectionChange={(value) => set({ severity: String(value) })}
                      options={[{ value: "MINOR", label: "Minor" }, { value: "MAJOR", label: "Major" }, { value: "CRITICAL", label: "Critical" }]} />
                    <TextField label="Units affected" inputMode="decimal" value={row.affectedQuantity} onChange={(value) => set({ affectedQuantity: value })} />
                    <TextField label="Observation" value={row.observation} onChange={(value) => set({ observation: value })} />
                    <Button size="compact" variant="ghost" onPress={() => edit({ defects: draft.defects.filter((_, at) => at !== index) })}>Remove</Button>
                  </div>
                );
              })}
              <div><Button size="compact" variant="secondary" onPress={() => edit({ defects: [...draft.defects, { reasonCode: "SCRATCH", severity: "MINOR", affectedQuantity: "1", observation: "" }] })}>Add defect</Button></div>
            </div>
          ) : inspection.defects.length ? (
            <LinesTable columns={["Reason", "Severity", { label: "Units affected", numeric: true }, "Observation"]}>
              {inspection.defects.map((row) => <tr key={row.id}><Cell>{reasonLabel(row.reasonCode)}</Cell><Cell>{row.severity.toLowerCase()}</Cell><Cell numeric>{qty(row.affectedQuantity)}</Cell><Cell>{row.observation ?? ""}</Cell></tr>)}
            </LinesTable>
          ) : <p className="text-sm text-text-muted">No defects recorded.</p>}
        </Panel>
        <Panel title="Decision" description={inspection.stage === "IN_PROCESS" ? "An in-process check records results only: the output is decided by a final inspection." : `Of the ${qty(q.scope)} covered: accepted, rejected and held. What is left undecided stays awaiting inspection.`}>
          {editable && inspection.stage === "FINAL" ? (
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-4">
                <TextField label="Units examined" inputMode="decimal" value={draft.examined} onChange={(value) => edit({ examined: value })} />
                <TextField label="Accepted" inputMode="decimal" value={draft.accepted} onChange={(value) => edit({ accepted: value })} />
                <TextField label="Rejected" inputMode="decimal" value={draft.rejected} onChange={(value) => edit({ rejected: value })} />
                <TextField label="On hold" inputMode="decimal" value={draft.held} onChange={(value) => edit({ held: value })} />
              </div>
              {Number(draft.rejected) > 0 && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Select label="Rejected output goes to" selectedKey={draft.disposition} onSelectionChange={(value) => edit({ disposition: String(value) })}
                    options={[{ value: NONE, label: "Choose…" }, { value: "QUARANTINE", label: "Quarantine (decide later)" }, { value: "REWORK", label: "Rework" }, { value: "SCRAP", label: "Scrap" }]} />
                  <TextField label="Rejection reason" value={draft.rejectionReason} onChange={(value) => edit({ rejectionReason: value })} description="Or record the defects above." />
                  {draft.disposition === "REWORK" && <TextField label="Rework assigned to" value={draft.reworkAssignedTo} onChange={(value) => edit({ reworkAssignedTo: value })} />}
                </div>
              )}
              {Number(draft.held) > 0 && <TextField label="Why it is held" value={draft.holdReason} onChange={(value) => edit({ holdReason: value })} />}
              {inspection.criticalFailure && Number(draft.accepted) > 0 && (
                <Checkbox isSelected={draft.deviationRequested} onChange={(value) => edit({ deviationRequested: value })}>Ask to accept under a documented deviation (only where the company allows it; it needs a review)</Checkbox>
              )}
            </div>
          ) : (
            <FactList items={[
              ["Accepted", qty(q.accepted)], ["Rejected", Number(q.rejected) ? `${qty(q.rejected)} · ${DISPOSITION_LABEL[inspection.decision.rejectionDisposition ?? ""] ?? ""}${inspection.decision.rejectionReason ? ` — ${inspection.decision.rejectionReason}` : ""}` : "0"],
              ["On hold", Number(q.held) ? `${qty(q.held)} — ${inspection.decision.holdReason ?? ""}` : "0"], ["Left awaiting inspection", qty(q.undecided)],
              ...(inspection.decision.reworkAssignedTo ? [["Rework assigned to", inspection.decision.reworkAssignedTo] as [string, string]] : []),
              ...(inspection.decision.deviation ? [["Deviation", "Accepted under a documented deviation after a critical failure"] as [string, string]] : []),
            ]} />
          )}
          {editable && <TextArea label="Notes" value={draft.generalNotes} onChange={(value) => edit({ generalNotes: value })} maxLength={2000} />}
          {!editable && inspection.notes && <p className="text-sm">{inspection.notes}</p>}
        </Panel>
        {(inspection.review.required || inspection.review.decision) && (
          <Panel title="Review">
            <FactList items={[["Why it is needed", inspection.review.reasons.join(", ") || "—"], ["Submitted by", inspection.review.submittedBy ? `${inspection.review.submittedBy}, ${formatDateTime(inspection.review.submittedAt!)}` : "—"],
              ["Reviewer", inspection.review.reviewer ? `${inspection.review.reviewer}, ${formatDateTime(inspection.review.reviewedAt!)} · ${inspection.review.decision?.toLowerCase()}` : "—"], ["Note", inspection.review.note ?? "—"]]} />
          </Panel>
        )}
        {inspection.hold && (
          <Panel title="Hold placed by this inspection">
            <FactList items={[["Held", qty(inspection.hold.quantity)], ["Why", inspection.hold.reason], ["Status", inspection.hold.status === "ACTIVE" ? "On hold" : `Released by ${inspection.hold.releasedBy}, ${formatDateTime(inspection.hold.releasedAt!)}${inspection.hold.note ? ` — ${inspection.hold.note}` : ""}`]]} />
            {inspection.hold.status === "ACTIVE" && <p className="text-xs text-text-muted">Release or reinspect it from the order&apos;s Quality tab.</p>}
          </Panel>
        )}
        {inspection.finalizeKey && (
          <Panel title="Posting" description="Recorded once, under the order's and the entry's locks.">
            <FactList items={[["Posting identity", inspection.finalizeKey], ["Quality decision", inspection.decision.qualityDecisionId ? "Posted" : "None (nothing decided)"], ["Stock", "No stock moves at inspection"]]} />
          </Panel>
        )}
        {inspection.corrections.length > 0 && (
          <Panel title="Quality corrections">
            <LinesTable columns={["Correction", "Change", { label: "Quantity", numeric: true }, "Why", "By"]}>
              {inspection.corrections.map((row) => <tr key={row.id}><Cell>{row.number}</Cell><Cell>{row.direction === "ACCEPTED_TO_REJECTED" ? "Accepted → rejected" : `Rejected → accepted${row.kind === "REWORK" ? " after rework" : ""}`}</Cell>
                <Cell numeric>{qty(row.quantity)}</Cell><Cell>{row.reason}</Cell><Cell>{row.by}, {formatDateTime(row.at)}</Cell></tr>)}
            </LinesTable>
          </Panel>
        )}
        <EvidencePanel inspection={inspection} />
        <HistoryList title="Timeline" entries={inspection.history.map((row) => ({ summary: row.label, at: row.at, actor: row.actor, detail: row.summary ?? undefined }))} />
      </div>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </RecordDetailsPage>
  );
}

function EvidencePanel({ inspection }: { inspection: QualityInspection }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "manufacturing", "quality-inspection-files", inspection.id);
  const files = useQuery({ queryKey: key, queryFn: () => inspectionFiles(inspection.id) });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = ["DRAFT", "IN_PROGRESS", "PENDING_REVIEW"].includes(inspection.status);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await work(); await queryClient.invalidateQueries({ queryKey: key }); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Panel title="Evidence" description="Photos of defects, measurement sheets and test records (up to 10 MB each). Evidence of a finalized inspection is kept.">
      {error && <Notice tone="danger">{error}</Notice>}
      {(files.data ?? []).length ? (
        <LinesTable columns={["File", { label: "Size", numeric: true }, "Added", ""]}>
          {(files.data ?? []).map((file) => (
            <tr key={file.id}>
              <Cell><a className="text-brand underline" href={`/api/manufacturing/quality-inspections/${inspection.id}/files/${file.id}`}>{file.fileName}</a></Cell>
              <Cell numeric>{Math.max(1, Math.round(file.sizeBytes / 1024))} KB</Cell><Cell>{formatDateTime(file.uploadedAt)}</Cell>
              <Cell>{open && inspection.can.attach && <Button size="compact" variant="ghost" isDisabled={busy} onPress={() => run(() => removeInspectionFile(inspection.id, file.id))}>Remove</Button>}</Cell>
            </tr>
          ))}
        </LinesTable>
      ) : <p className="text-sm text-text-muted">{files.isLoading ? "Loading…" : "No evidence attached."}</p>}
      {inspection.can.attach && (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-text-secondary">Attach a file</span>
          <input type="file" disabled={busy} accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.xlsx,.docx"
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(() => uploadInspectionFile(inspection.id, file)); }} />
        </label>
      )}
    </Panel>
  );
}

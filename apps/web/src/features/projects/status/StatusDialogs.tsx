"use client";

// Projects — Project Status, the dialogs: one per status action. Each shows what the server will check (readiness for resume and completion,
// the review for cancellation and reopening) before anything changes, keeps what the person typed when the server refuses, and confirms only
// once the server has applied the change.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorDetails, errorMessage, getMembers, newKey, type Project } from "../api/projects-api";
import {
  HOLD_REASON_LABEL, SEVERITY_LABEL, getCancellationReview, getCompletionReadiness, getReopenReview, getResumeReadiness, runStatusAction, type Check, type StatusActionKey,
} from "./status-api";

const CHECK_TONE = { PASS: "success", FAIL: "danger", WARN: "warning", NOT_TRACKED: "neutral", TO_CONFIRM: "info" } as const;
const CHECK_LABEL = { PASS: "Done", FAIL: "Outstanding", WARN: "Note", NOT_TRACKED: "Not tracked yet", TO_CONFIRM: "Confirm at completion" } as const;
const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

export function ChecksList({ checks }: { checks: Check[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {checks.map((row) => (
        <li key={row.key} className="flex flex-col gap-0.5 rounded-md border border-border p-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <span className="flex flex-col"><span className="text-sm font-medium">{row.label}</span><span className="text-xs text-text-secondary">{row.message}</span></span>
          <StatusBadge tone={CHECK_TONE[row.state]}>{CHECK_LABEL[row.state]}</StatusBadge>
        </li>
      ))}
    </ul>
  );
}

type Props = { project: Project; onClose: () => void; onDone: (text: string) => Promise<void> };

// The shared submit: the server's answer, or a plain explanation (with every problem it named) — never a success before it confirms.
function useSubmit(project: Project, action: StatusActionKey, onDone: Props["onDone"], onClose: Props["onClose"]) {
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (input: Record<string, unknown>, text: string) => {
    setBusy(true); setError(null);
    try {
      const result = await runStatusAction(project.id, action, { expectedVersion: project.version, ...input }, key);
      await onDone((result as { approval?: string }).approval === "PENDING" ? "Sent for approval: someone who approves projects decides." : text);
      onClose();
    } catch (failure) {
      const problems = (errorDetails(failure).problems as Array<{ message: string }> | undefined) ?? [];
      setError(problems.length > 1 ? `${errorMessage(failure)} ${problems.slice(1).map((row) => row.message).join(" ")}` : errorMessage(failure));
    } finally { setBusy(false); }
  };
  return { busy, error, submit };
}
function Footer({ busy, disabled, label, danger, onClose, onPress }: { busy: boolean; disabled: boolean; label: string; danger?: boolean; onClose: () => void; onPress: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onPress={onClose}>Cancel</Button>
      <Button variant={danger ? "danger" : "primary"} isLoading={busy} isDisabled={busy || disabled} onPress={onPress}>{label}</Button>
    </div>
  );
}

export function ActivateDialog({ project, onClose, onDone }: Props) {
  const { busy, error, submit } = useSubmit(project, "activate", onDone, onClose);
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Mark ${project.code} as planned`}
      description={project.approval.required ? "The company asks for approval: someone who approves projects decides." : "The project is ready to start; nothing starts yet."}>
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <Footer busy={busy} disabled={false} label={project.approval.required ? "Request approval" : "Mark as planned"} onClose={onClose} onPress={() => submit({}, "The project is planned.")} />
      </div>
    </Dialog>
  );
}

export function StartDialog({ project, onClose, onDone }: Props) {
  const [date, setDate] = useState("");
  const { busy, error, submit } = useSubmit(project, "start", onDone, onClose);
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Start ${project.code}`}
      description="Execution begins and the team is told. The planned start date stays as it is; tasks and milestones start on their own.">
      <div className="flex flex-col gap-3">
        <TextField label="Started on" type="date" value={date} onChange={setDate} description="Today if left empty; a past date if work began earlier." />
        {error && <Notice tone="danger">{error}</Notice>}
        <Footer busy={busy} disabled={false} label="Start project" onClose={onClose} onPress={() => submit({ startDate: date || undefined }, "The project is in progress.")} />
      </div>
    </Dialog>
  );
}

type Blocker = { reasonCode: string; description: string; severity: string; ownerUserId: string };
export function HoldDialog({ project, onClose, onDone }: Props) {
  const workspace = useWorkspaceContext();
  const team = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "members", project.id), queryFn: () => getMembers(project.id) });
  const people = (team.data?.members ?? []).filter((row) => row.active && row.role !== "VIEWER").map((row) => ({ value: row.userId, label: row.name }));
  const blank = (): Blocker => ({ reasonCode: "CUSTOMER_APPROVAL_PENDING", description: "", severity: "MEDIUM", ownerUserId: project.managerId ?? "" });
  const [rows, setRows] = useState<Blocker[]>([blank()]);
  const [expected, setExpected] = useState("");
  const { busy, error, submit } = useSubmit(project, "hold", onDone, onClose);
  const set = (index: number, patch: Partial<Blocker>) => setRows((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  const complete = rows.every((row) => row.description.trim().length >= 3);
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Put ${project.code} on hold`} size="lg"
      description="Ordinary work pauses. Tasks, milestones, approvals, time, documents and dates stay exactly as they are; the project resumes to where it was once every reason is resolved.">
      <div className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <fieldset key={index} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <legend className="px-1 text-xs text-text-muted">{`Reason ${index + 1}`}</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              <Select label="Why" selectedKey={row.reasonCode} onSelectionChange={(key) => set(index, { reasonCode: String(key) })} options={options(HOLD_REASON_LABEL)} />
              <Select label="Impact" selectedKey={row.severity} onSelectionChange={(key) => set(index, { severity: String(key) })} options={options(SEVERITY_LABEL)} />
              <Select label="Owner" selectedKey={row.ownerUserId || null} onSelectionChange={(key) => set(index, { ownerUserId: String(key ?? "") })} options={people} />
            </div>
            <TextArea label="What is holding the project" isRequired value={row.description} onChange={(value) => set(index, { description: value })} maxLength={2000} />
            {rows.length > 1 && <Button variant="ghost" size="compact" onPress={() => setRows((current) => current.filter((_, at) => at !== index))}>Remove this reason</Button>}
          </fieldset>
        ))}
        <Button variant="secondary" size="compact" onPress={() => setRows((current) => [...current, blank()])}>Add another reason</Button>
        <TextField label="Expected to resume by" type="date" value={expected} onChange={setExpected} description="Optional; the target date is not moved." />
        {error && <Notice tone="danger">{error}</Notice>}
        <Footer busy={busy} disabled={!complete} label="Put on hold" danger onClose={onClose}
          onPress={() => submit({ reasons: rows.map((row) => ({ reasonCode: row.reasonCode, description: row.description.trim(), severity: row.severity, ownerUserId: row.ownerUserId || undefined })),
            expectedResolutionDate: expected || undefined }, "The project is on hold.")} />
      </div>
    </Dialog>
  );
}

export function ResumeDialog({ project, onClose, onDone }: Props) {
  const workspace = useWorkspaceContext();
  const readiness = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "resume-readiness", project.id, project.version), queryFn: () => getResumeReadiness(project.id) });
  const [resolution, setResolution] = useState("");
  const [evidence, setEvidence] = useState("");
  const { busy, error, submit } = useSubmit(project, "resume", onDone, onClose);
  const open = readiness.data?.hold?.reasons.filter((row) => !row.resolved) ?? [];
  const single = open.length === 1 ? open[0] : null;
  const needsEvidence = single?.reasonCode === "CUSTOMER_APPROVAL_PENDING";
  const otherFailing = (readiness.data?.checks ?? []).filter((row) => row.blocking && row.key !== "blockers");
  return (
    <Dialog isOpen isDismissable onOpenChange={(open_) => { if (!open_) onClose(); }} title={`Resume ${project.code}`} size="lg"
      description={`Back to ${readiness.data?.resumesToLabel?.toLowerCase() ?? "where it was"}. Blocked tasks stay blocked, dates stay as they are, nothing done before the hold is lost.`}>
      <div className="flex flex-col gap-3">
        {readiness.isLoading ? <LoadingState label="Checking" rows={3} /> : <ChecksList checks={readiness.data?.checks ?? []} />}
        {open.length > 1 && <Notice tone="warning">Resolve each open reason on the hold panel first: the project resumes only when all are clear.</Notice>}
        {single && (
          <>
            <TextArea label={`How "${single.reasonLabel}" was resolved`} isRequired value={resolution} onChange={setResolution} maxLength={2000} />
            {needsEvidence && <TextField label="Customer approval evidence" isRequired value={evidence} onChange={setEvidence} description="Who approved, when and how (e.g. email of 15 Oct)." />}
          </>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        <Footer busy={busy} label="Resume" onClose={onClose}
          disabled={open.length > 1 || otherFailing.length > 0 || (single !== null && (resolution.trim().length < 3 || (needsEvidence && evidence.trim().length < 3)))}
          onPress={() => submit(single ? { resolution: resolution.trim(), evidence: evidence.trim() || undefined } : {}, "The project resumed.")} />
      </div>
    </Dialog>
  );
}

export function CompleteDialog({ project, onClose, onDone }: Props) {
  const workspace = useWorkspaceContext();
  const readiness = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "completion-readiness", project.id, project.version), queryFn: () => getCompletionReadiness(project.id) });
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [delivered, setDelivered] = useState(false);
  const [acceptance, setAcceptance] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [waivers, setWaivers] = useState<Record<string, { on: boolean; reason: string; impact: string }>>({});
  const { busy, error, submit } = useSubmit(project, "complete", onDone, onClose);
  const checks = readiness.data?.checks ?? [];
  const openTasks = readiness.data?.openTasks ?? [];
  const needsAcceptance = checks.some((row) => row.key === "acceptance");
  const outstanding = checks.find((row) => row.key === "financial" && row.state === "TO_CONFIRM");
  const waived = openTasks.filter((row) => waivers[row.id]?.on);
  const unwaived = openTasks.filter((row) => !waivers[row.id]?.on);
  // The task check passes once every open task is waived; any other failing check still holds completion.
  const blocked = checks.some((row) => row.state === "FAIL" && !(row.key === "tasks" && unwaived.length === 0));
  const waiverReasonsMissing = waived.some((row) => (waivers[row.id]?.reason ?? "").trim().length < 3);
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Complete ${project.code}`} size="lg"
      description="Completion closes ordinary execution and records a completion review. Billing and collection carry on in Sales and Finance; nothing there changes.">
      <div className="flex flex-col gap-3">
        {readiness.isLoading ? <LoadingState label="Checking" rows={4} /> : <ChecksList checks={checks} />}
        {openTasks.length > 0 && (
          <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
            <legend className="px-1 text-xs text-text-muted">Open tasks</legend>
            <p className="text-xs text-text-secondary">Complete or cancel them, or waive one that no longer needs doing (it stays open, recorded as waived). Urgent tasks are never waived.</p>
            {openTasks.map((row) => (
              <div key={row.id} className="flex flex-col gap-1">
                <Checkbox isSelected={Boolean(waivers[row.id]?.on)} isDisabled={!row.waivable}
                  onChange={(on) => setWaivers((current) => ({ ...current, [row.id]: { reason: current[row.id]?.reason ?? "", impact: current[row.id]?.impact ?? "", on } }))}>
                  {`Waive ${row.code} ${row.title}${row.waivable ? "" : " (Urgent: cannot be waived)"}`}
                </Checkbox>
                {waivers[row.id]?.on && (
                  <div className="grid gap-2 pl-6 sm:grid-cols-2">
                    <TextField label="Why it is waived" isRequired value={waivers[row.id].reason} onChange={(value) => setWaivers((current) => ({ ...current, [row.id]: { ...current[row.id], reason: value } }))} />
                    <TextField label="Impact on the agreed deliverables" value={waivers[row.id].impact} onChange={(value) => setWaivers((current) => ({ ...current, [row.id]: { ...current[row.id], impact: value } }))} />
                  </div>
                )}
              </div>
            ))}
          </fieldset>
        )}
        {blocked && <Notice tone="danger">Something above is outstanding. Resolve it, then complete the project.</Notice>}
        <TextField label="Completed on" type="date" value={date} onChange={setDate} description="Today if left empty." />
        <TextArea label="Closing notes" value={note} onChange={setNote} maxLength={4000} isRequired />
        <Checkbox isSelected={delivered} onChange={setDelivered}>The project&apos;s deliverables were delivered</Checkbox>
        {needsAcceptance && <TextField label="Customer sign-off" value={acceptance} onChange={setAcceptance} description="Who accepted, and how (e.g. signed handover on 30 Nov)." />}
        {outstanding && <Checkbox isSelected={acknowledge} onChange={setAcknowledge}>{`I understand billing or collection is still open: ${outstanding.message.split(" — ")[0]}`}</Checkbox>}
        {error && <Notice tone="danger">{error}</Notice>}
        <Footer busy={busy} label="Complete project" onClose={onClose}
          disabled={blocked || waiverReasonsMissing || note.trim().length < 3 || !delivered || (needsAcceptance && acceptance.trim().length < 3) || (Boolean(outstanding) && !acknowledge)}
          onPress={() => submit({ completionDate: date || undefined, closingNote: note, deliverablesConfirmed: delivered, customerAcceptance: acceptance || undefined, acknowledgeOutstanding: acknowledge,
            waivers: waived.map((row) => ({ taskId: row.id, reason: waivers[row.id].reason.trim(), impact: waivers[row.id].impact.trim() || undefined })) }, "The project is completed.")} />
      </div>
    </Dialog>
  );
}

export function CancelDialog({ project, onClose, onDone }: Props) {
  const workspace = useWorkspaceContext();
  const review = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "cancellation-review", project.id, project.version), queryFn: () => getCancellationReview(project.id) });
  const [reasonCode, setReasonCode] = useState("CUSTOMER_CANCELLED");
  const [reason, setReason] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const { busy, error, submit } = useSubmit(project, "cancel", onDone, onClose);
  const data = review.data;
  const needsAck = Boolean(data && (data.dependencies.length > 0 || data.openTasks > 0 || data.openMilestones > 0));
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Cancel ${project.code}`} size="lg"
      description="Ordinary work stops. Nothing is deleted or reversed: work, history, time, expenses and linked sales and finance records stay with their owners.">
      <div className="flex flex-col gap-3">
        {review.isLoading ? <LoadingState label="Reviewing what depends on it" rows={3} /> : (
          <>
            <ul className="flex flex-col gap-1 text-sm">{(data?.notes ?? []).map((row) => <li key={row}>• {row}</li>)}</ul>
            {(data?.dependencies.length ?? 0) > 0 && (
              <Notice tone="warning">
                <span className="flex flex-col gap-1"><span>{`${data!.dependencies.length} linked business record(s) stay with their own modules:`}</span>
                  {data!.dependencies.map((row, index) => <span key={index}>{`${row.type} ${row.number ?? ""}${row.status ? ` (${row.status.replace(/_/g, " ")})` : ""}`}</span>)}</span>
              </Notice>
            )}
          </>
        )}
        <Select label="Why" selectedKey={reasonCode} onSelectionChange={(key) => setReasonCode(String(key))} options={(data?.reasons ?? []).map((row) => ({ value: row.code, label: row.label }))} />
        <TextArea label={reasonCode === "OTHER" ? "Explain why" : "Details (optional)"} value={reason} onChange={setReason} maxLength={2000} isRequired={reasonCode === "OTHER"} />
        {needsAck && <Checkbox isSelected={acknowledge} onChange={setAcknowledge}>I reviewed the open work and linked records; they stay as they are</Checkbox>}
        {error && <Notice tone="danger">{error}</Notice>}
        <Footer busy={busy} danger label="Cancel project" onClose={onClose}
          disabled={(reasonCode === "OTHER" && reason.trim().length < 3) || (needsAck && !acknowledge)}
          onPress={() => submit({ reasonCode, reason: reason.trim() || undefined, acknowledgeDependencies: acknowledge }, "The project is cancelled.")} />
      </div>
    </Dialog>
  );
}

export function ReopenDialog({ project, onClose, onDone }: Props) {
  const workspace = useWorkspaceContext();
  const review = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "reopen-review", project.id, project.version), queryFn: () => getReopenReview(project.id) });
  const [reasonCode, setReasonCode] = useState("POST_COMPLETION_DEFECT");
  const [reason, setReason] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const { busy, error, submit } = useSubmit(project, "reopen", onDone, onClose);
  const data = review.data;
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Reopen ${project.code}`} size="lg"
      description="Back in progress. The original completion and its review stay in the history; accepted milestones, done tasks and issued billing stay as they are.">
      <div className="flex flex-col gap-3">
        {review.isLoading ? <LoadingState label="Reviewing" rows={3} /> : <ul className="flex flex-col gap-1 text-sm">{(data?.notes ?? []).map((row) => <li key={row}>• {row}</li>)}</ul>}
        <Select label="Why" selectedKey={reasonCode} onSelectionChange={(key) => setReasonCode(String(key))} options={(data?.reasons ?? []).map((row) => ({ value: row.code, label: row.label }))} />
        <TextArea label={reasonCode === "OTHER" ? "Explain why" : "Details"} value={reason} onChange={setReason} maxLength={2000} isRequired={reasonCode === "OTHER"} />
        {data?.needsAcknowledgement && <Checkbox isSelected={acknowledge} onChange={setAcknowledge}>I reviewed the accepted milestones and issued billing; they stay as they are</Checkbox>}
        <p className="text-xs text-text-muted">New post-delivery work is safest as new tasks or a new milestone.</p>
        {error && <Notice tone="danger">{error}</Notice>}
        <Footer busy={busy} danger label="Reopen" onClose={onClose}
          disabled={(reasonCode === "OTHER" && reason.trim().length < 3) || (Boolean(data?.needsAcknowledgement) && !acknowledge)}
          onPress={() => submit({ reasonCode, reason: reason.trim() || undefined, acknowledgeReview: acknowledge }, "Reopened: the project is in progress.")} />
      </div>
    </Dialog>
  );
}

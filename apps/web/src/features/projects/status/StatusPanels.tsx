"use client";

// Projects — Project Status on the project page: the status actions (the next one in the header, the rest in the menu, and every one on the
// Status card with the reason it is not available), the hold with each of its reasons (resolved one by one, others added while it lasts), and
// the status timeline with each completion's review.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Dialog, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { FactList, HistoryList, type MoreAction } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { STATUS_TONE, dateLabel, errorMessage, getMembers, type Project } from "../api/projects-api";
import { ActivateDialog, CancelDialog, CompleteDialog, HoldDialog, ReopenDialog, ResumeDialog, StartDialog } from "./StatusDialogs";
import { HOLD_REASON_LABEL, SEVERITY_LABEL, addHoldReason, getStatusHistory, resolveHoldReason, type HoldReason, type StatusActionKey } from "./status-api";

const PRIMARY: StatusActionKey[] = ["activate", "start", "resume", "complete"];
type Done = (text: string) => Promise<void>;

// The header's status controls: the next step as the primary button, the other allowed actions for the "…" menu, and the open dialog.
export function useStatusActions(project: Project, onDone: Done) {
  const [open, setOpen] = useState<StatusActionKey | null>(null);
  const allowed = project.statusActions.filter((row) => row.allowed);
  const next = PRIMARY.map((key) => allowed.find((row) => row.action === key)).find(Boolean) ?? null;
  const primary = next ? <Button variant="primary" onPress={() => setOpen(next.action)}>{next.label}</Button> : null;
  const menu: MoreAction[] = allowed.filter((row) => row.action !== next?.action).map((row) => ({ id: `status-${row.action}`, label: row.label, run: () => setOpen(row.action) }));
  const props = { project, onClose: () => setOpen(null), onDone };
  const dialog = open === "activate" ? <ActivateDialog {...props} /> : open === "start" ? <StartDialog {...props} /> : open === "hold" ? <HoldDialog {...props} />
    : open === "resume" ? <ResumeDialog {...props} /> : open === "complete" ? <CompleteDialog {...props} /> : open === "cancel" ? <CancelDialog {...props} />
    : open === "reopen" ? <ReopenDialog {...props} /> : null;
  return { primary, menu, dialog, openAction: setOpen };
}

// The Status card on the overview: where the project stands, its dates, and every action with whether it is available and why not.
export function StatusPanel({ project, onAction }: { project: Project; onAction: (action: StatusActionKey) => void }) {
  return (
    <Panel title="Status" description="The lifecycle only — health, priority and progress are separate. Every change is checked again on the server.">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={STATUS_TONE[project.status]}>{project.statusLabel}</StatusBadge>
        {project.archived && <StatusBadge tone="neutral">Archived</StatusBadge>}
        {project.reopenCount > 0 && <span className="text-xs text-text-muted">{`Reopened ${project.reopenCount} time(s)${project.lastReopenedAt ? `, last ${formatDateTime(project.lastReopenedAt)}` : ""}`}</span>}
      </div>
      <FactList columns={3} items={[["Planned start", dateLabel(project.plannedStartDate)], ["Actual start", dateLabel(project.actualStartDate)], ["Target", dateLabel(project.targetEndDate)],
        ["Completed", project.completedAt ? `${dateLabel(project.completedAt)}${project.completedBy ? ` by ${project.completedBy}` : ""}` : "—"]]} />
      {project.statusActions.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {project.statusActions.map((row) => (
            <li key={row.action} className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="secondary" size="compact" isDisabled={!row.allowed} onPress={() => onAction(row.action)}>{row.label}</Button>
              {!row.allowed && row.reason && <span className="text-xs text-text-secondary">{row.reason}</span>}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-text-muted">{project.archived ? "Archived: restore it to change its status." : "No status action is available."}</p>}
    </Panel>
  );
}

// The hold: each reason with its owner, impact and what it is about; resolved one by one (with evidence for a customer approval); more added
// while the hold lasts. The project resumes only when all are resolved — never by itself.
export function HoldPanel({ project, onChanged }: { project: Project; onChanged: Done }) {
  const [resolving, setResolving] = useState<HoldReason | null>(null);
  const [adding, setAdding] = useState(false);
  const hold = project.hold;
  if (!hold) return null;
  const mayResolve = project.can.resume || project.can.hold;
  return (
    <Panel title="On hold" description={`Since ${formatDateTime(hold.startedAt)}. ${hold.openReasons ? `${hold.openReasons} reason(s) still open — the project resumes only when all are resolved.` : "Every reason is resolved: the project may resume."}`}
      actions={project.can.hold ? <Button size="compact" variant="secondary" onPress={() => setAdding(true)}>Add a reason</Button> : undefined}>
      <ul className="flex flex-col gap-2">
        {hold.reasons.map((row) => (
          <li key={row.id} className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{row.reasonLabel}</span>
              <StatusBadge tone={row.resolved ? "success" : row.severity === "CRITICAL" || row.severity === "HIGH" ? "danger" : "warning"}>{row.resolved ? "Resolved" : `${row.severityLabel} impact`}</StatusBadge>
            </span>
            <span>{row.description}</span>
            <span className="text-xs text-text-muted">{[row.owner ? `Owner: ${row.owner}` : null, row.source?.label ? `About ${row.source.label}` : null, row.addedBy ? `Added by ${row.addedBy}` : null].filter(Boolean).join(" · ")}</span>
            {row.resolved
              ? <span className="text-xs text-text-secondary">{`Resolved ${row.resolvedAt ? formatDateTime(row.resolvedAt) : ""}${row.resolvedBy ? ` by ${row.resolvedBy}` : ""}: ${row.resolution ?? ""}${row.resolutionEvidence ? ` (evidence: ${row.resolutionEvidence})` : ""}`}</span>
              : (mayResolve || row.owner) && <Button size="compact" variant="ghost" onPress={() => setResolving(row)}>Resolve</Button>}
          </li>
        ))}
      </ul>
      {resolving && <ResolveReasonDialog project={project} reason={resolving} onClose={() => setResolving(null)} onDone={onChanged} />}
      {adding && <AddReasonDialog project={project} onClose={() => setAdding(false)} onDone={onChanged} />}
    </Panel>
  );
}

function ResolveReasonDialog({ project, reason, onClose, onDone }: { project: Project; reason: HoldReason; onClose: () => void; onDone: Done }) {
  const [resolution, setResolution] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsEvidence = reason.reasonCode === "CUSTOMER_APPROVAL_PENDING";
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Resolve: ${reason.reasonLabel}`} description={reason.description}>
      <div className="flex flex-col gap-3">
        <TextArea label="How it was resolved" isRequired value={resolution} onChange={setResolution} maxLength={2000} />
        <TextField label={needsEvidence ? "Customer approval evidence" : "Evidence (optional)"} isRequired={needsEvidence} value={evidence} onChange={setEvidence}
          description={needsEvidence ? "Who approved, when and how." : "A reference, a document or a message."} />
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || resolution.trim().length < 3 || (needsEvidence && evidence.trim().length < 3)} onPress={async () => {
            setBusy(true); setError(null);
            try {
              const result = await resolveHoldReason(project.id, reason.id, { resolution: resolution.trim(), evidence: evidence.trim() || undefined });
              await onDone(result.openReasons ? `Resolved; ${result.openReasons} reason(s) still open.` : "Every hold reason is resolved: the project may resume.");
              onClose();
            } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
          }}>Resolve</Button>
        </div>
      </div>
    </Dialog>
  );
}

function AddReasonDialog({ project, onClose, onDone }: { project: Project; onClose: () => void; onDone: Done }) {
  const workspace = useWorkspaceContext();
  const team = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "members", project.id), queryFn: () => getMembers(project.id) });
  const [reasonCode, setReasonCode] = useState("DEPENDENCY_BLOCKED");
  const [severity, setSeverity] = useState("MEDIUM");
  const [owner, setOwner] = useState(project.managerId ?? "");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const people = (team.data?.members ?? []).filter((row) => row.active && row.role !== "VIEWER").map((row) => ({ value: row.userId, label: row.name }));
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title="Add a hold reason" description="The project stays on hold until this one is resolved too.">
      <div className="flex flex-col gap-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <Select label="Why" selectedKey={reasonCode} onSelectionChange={(key) => setReasonCode(String(key))} options={Object.entries(HOLD_REASON_LABEL).map(([value, label]) => ({ value, label }))} />
          <Select label="Impact" selectedKey={severity} onSelectionChange={(key) => setSeverity(String(key))} options={Object.entries(SEVERITY_LABEL).map(([value, label]) => ({ value, label }))} />
          <Select label="Owner" selectedKey={owner || null} onSelectionChange={(key) => setOwner(String(key ?? ""))} options={people} />
        </div>
        <TextArea label="What is holding the project" isRequired value={description} onChange={setDescription} maxLength={2000} />
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || description.trim().length < 3} onPress={async () => {
            setBusy(true); setError(null);
            try { await addHoldReason(project.id, { reasonCode, severity, ownerUserId: owner || undefined, description: description.trim() }); await onDone("Hold reason added."); onClose(); }
            catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
          }}>Add reason</Button>
        </div>
      </div>
    </Dialog>
  );
}

// Every status change (from, to, why, who, when), and each completion's review (sign-off, waivers, what stayed outstanding).
export function StatusTimeline({ project }: { project: Project }) {
  const workspace = useWorkspaceContext();
  const history = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "status-history", project.id, project.version), queryFn: () => getStatusHistory(project.id) });
  if (history.isLoading) return <LoadingState label="Loading the status history" rows={3} />;
  const data = history.data;
  return (
    <div className="flex flex-col gap-4">
      <HistoryList title="Status history" empty="No status changes yet." entries={(data?.transitions ?? []).map((row) => ({
        summary: `${row.fromLabel ?? "Created"} → ${row.toLabel}`, at: row.at, actor: row.actor, label: row.action.toLowerCase().replace(/_/g, " "), detail: row.reason ?? undefined }))} />
      {(data?.completions ?? []).length > 0 && (
        <Panel title="Completion reviews" description="Each completion keeps its review, even after a reopening.">
          <ul className="flex flex-col gap-2 text-sm">
            {data!.completions.map((row, index) => (
              <li key={index} className="flex flex-col gap-1 rounded-md border border-border p-3">
                <span className="font-medium">{`Completed ${dateLabel(row.completionDate)}${row.signedOffBy ? ` — signed off by ${row.signedOffBy}` : ""}`}</span>
                <span>{row.closingNote}</span>
                {row.customerAcceptance && <span className="text-xs text-text-secondary">{`Customer sign-off: ${row.customerAcceptance}`}</span>}
                {row.waivers.map((waiver) => <span key={waiver.code} className="text-xs text-text-secondary">{`Waived ${waiver.code} ${waiver.title}: ${waiver.reason}${waiver.impact ? ` (impact: ${waiver.impact})` : ""}`}</span>)}
                {row.outstanding.length > 0 && <span className="text-xs text-text-muted">{`Outstanding at completion: ${row.outstanding.map((item) => item.label).join(", ")}`}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

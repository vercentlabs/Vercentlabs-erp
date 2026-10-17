"use client";

// Projects — Timesheets, the review: the timesheets waiting for this person's decision (and the ones decided), and one submission — the exact
// entry versions it carried, the checks behind the decision (versions unchanged, billable allowed, period open, items flagged, who may
// decide), its versions and history — approved, or returned with the reason and the entries to correct.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, EmptyState, ErrorState, MetricStrip, PageHeader, PermissionState, StatusBadge, Tab, TabList, Tabs, TextArea } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { useSubmitKey } from "@/shared/http/submit-once";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, HistoryList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus, newKey } from "../api/projects-api";
import { EntryTable } from "./TimeViews";
import { SUBMISSION_TONE, TIMESHEETS_BASE, decideSubmission, getApprovals, getSubmission, hours, runTimeCommand, weekLabel, type SubmissionDetail } from "./timesheets-api";

const QUEUES = [{ id: "SUBMITTED", label: "Waiting for review" }, { id: "CHANGES_REQUESTED", label: "Returned" }, { id: "APPROVED", label: "Approved" }];

export function ApprovalsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [status, setStatus] = useState("SUBMITTED");
  const queue = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-approvals", status), queryFn: () => getApprovals(status), retry: false });
  if (queue.error && errorStatus(queue.error) === 403) return <PermissionState title="You don't approve timesheets" description="Project managers review the time recorded on their projects." />;
  const rows = queue.data?.rows ?? [];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Pending Approvals" description="Timesheets submitted on the projects you review. You never review your own time." />
      {status === "SUBMITTED" && queue.data && <MetricStrip metrics={[{ label: "Waiting", value: String(rows.length) }, { label: "Hours waiting", value: hours(queue.data.pendingMinutes) },
        { label: "Flagged", value: String(rows.filter((row) => row.flags.length).length) }, { label: "Late", value: String(rows.filter((row) => row.late).length) }]} />}
      <Tabs selectedKey={status} onSelectionChange={(value) => setStatus(String(value))}><TabList aria-label="Queue">{QUEUES.map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList></Tabs>
      {queue.isLoading && <LoadingState label="Loading the queue" rows={6} />}
      {queue.isError && errorStatus(queue.error) !== 403 && <ErrorState title="Could not load the queue" description={errorMessage(queue.error)} />}
      {queue.data && (rows.length === 0 ? <EmptyState title={status === "SUBMITTED" ? "Nothing waits for your review." : "Nothing here yet."} description="Submitted timesheets appear here." /> : (
        <Panel>
          <LinesTable columns={["Employee", "Project", "Week", { label: "Hours", numeric: true }, { label: "Billable", numeric: true }, "Submitted", "Notes"]}>
            {rows.map((row) => (
              <tr key={row.id} className="cursor-pointer hover:bg-surface-muted" onClick={() => router.push(`${TIMESHEETS_BASE}/${row.id}`)}>
                <Cell><Link className="text-brand underline" href={`${TIMESHEETS_BASE}/${row.id}`}>{row.employee}</Link></Cell><Cell>{row.project}</Cell>
                <Cell>{`${weekLabel(row.weekStart, row.weekEnd)}${row.version > 1 ? ` · v${row.version}` : ""}`}</Cell><Cell numeric>{row.total}</Cell><Cell numeric>{hours(row.billableMinutes)}</Cell>
                <Cell>{`${formatDateTime(row.submittedAt)}${row.waitingDays ? ` · ${row.waitingDays} day(s) waiting` : ""}`}</Cell>
                <Cell><span className="flex flex-wrap gap-1">{row.late && <StatusBadge tone="warning">Late</StatusBadge>}{row.flags.filter((f) => f.code !== "LATE").length > 0 && <StatusBadge tone="warning">{`${row.flags.length} to review`}</StatusBadge>}
                  {status !== "SUBMITTED" && <StatusBadge tone={SUBMISSION_TONE[row.status]}>{row.statusLabel}</StatusBadge>}</span></Cell>
              </tr>
            ))}
          </LinesTable>
        </Panel>
      ))}
    </div>
  );
}

const CHECK_TONE = { PASS: "success", FAIL: "danger", WARN: "warning" } as const;
const CHECK_TEXT = { PASS: "OK", FAIL: "Blocks approval", WARN: "Review" } as const;

export function SubmissionScreen({ submissionId }: { submissionId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<"approve" | "return" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-submission", submissionId), queryFn: () => getSubmission(submissionId), retry: false });
  if (query.isLoading) return <LoadingState label="Loading the timesheet" rows={8} />;
  if (query.isError || !query.data) return <ErrorState title="This timesheet could not be opened" description={errorStatus(query.error) === 404 ? "It does not exist, or you may not see it." : errorMessage(query.error)} />;
  const sub = query.data;
  const done = async (text: string) => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); setMessage(text); };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${sub.employee ?? "Timesheet"} — ${sub.project ?? ""}`} description={`Week of ${weekLabel(sub.weekStart, sub.weekEnd)} · ${sub.number} · version ${sub.version}`}
        breadcrumbs={<Link className="text-sm text-brand underline" href={sub.can.mine ? TIMESHEETS_BASE : `${TIMESHEETS_BASE}/approvals`}>{sub.can.mine ? "My Timesheets" : "Pending Approvals"}</Link>}
        primaryAction={sub.can.approve ? <Button variant="primary" onPress={() => setDialog("approve")}>Approve</Button> : undefined}
        secondaryActions={sub.can.requestChanges ? <Button variant="secondary" onPress={() => setDialog("return")}>Request changes</Button> : undefined} />
      {message && <Notice tone="success">{message}</Notice>}
      <div className="flex flex-wrap gap-2"><StatusBadge tone={SUBMISSION_TONE[sub.status]}>{sub.statusLabel}</StatusBadge>{sub.late && <StatusBadge tone="warning">{`Late: ${sub.lateReason ?? ""}`}</StatusBadge>}</div>
      {sub.comment && <Notice tone={sub.status === "CHANGES_REQUESTED" ? "warning" : "neutral"}>{`${sub.decidedBy ?? "Reviewer"}: ${sub.comment}`}</Notice>}
      <MetricStrip metrics={[{ label: "Total", value: sub.total }, { label: "Billable", value: hours(sub.billableMinutes) }, { label: "Non-billable", value: hours(sub.totalMinutes - sub.billableMinutes) },
        { label: "Entries", value: String(sub.entries.length) }]} />
      <Panel title="Checks" description="What the approval relies on.">
        <ul className="flex flex-col gap-2">
          {sub.checks.map((row) => (
            <li key={row.key} className="flex items-start justify-between gap-3 rounded-md border border-border p-2">
              <span className="flex flex-col"><span className="text-sm">{row.label}</span>{row.message && <span className="text-xs text-text-muted">{row.message}</span>}</span>
              <StatusBadge tone={CHECK_TONE[row.state]}>{CHECK_TEXT[row.state]}</StatusBadge>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Submitted time" description="The exact versions submitted. A returned entry is marked; time changed since it was submitted needs a new version.">
        <EntryTable entries={sub.entries} empty="No entries." />
        {sub.entries.some((entry) => entry.returned) && <p className="text-xs text-text-muted">{`Returned for correction: ${sub.entries.filter((e) => e.returned).map((e) => e.number).join(", ")}`}</p>}
      </Panel>
      {sub.versions.length > 1 && (
        <Panel title="Versions">
          <LinesTable columns={["Version", "Submitted", { label: "Hours", numeric: true }, "Decision", "Comment"]}>
            {sub.versions.map((row) => (
              <tr key={row.id}><Cell><Link className="text-brand underline" href={`${TIMESHEETS_BASE}/${row.id}`}>{`v${row.version}`}</Link></Cell><Cell>{formatDateTime(row.submittedAt)}</Cell>
                <Cell numeric>{row.total}</Cell><Cell><StatusBadge tone={SUBMISSION_TONE[row.status]}>{row.statusLabel}</StatusBadge></Cell><Cell>{row.comment ?? "—"}</Cell></tr>
            ))}
          </LinesTable>
        </Panel>
      )}
      <Panel><HistoryList title="History" entries={sub.history.map((row) => ({ summary: row.summary ?? row.action.replace(/_/g, " ").toLowerCase(), at: row.at, actor: row.actor }))} /></Panel>
      {dialog && <DecisionDialog submission={sub} action={dialog} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}

function DecisionDialog({ submission, action, onClose, onDone }: { submission: SubmissionDetail; action: "approve" | "return"; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [comment, setComment] = useState("");
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newKey);
  const { run } = useSubmitKey();
  const approve = action === "approve";
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await runTimeCommand(key, () => run(() => decideSubmission(submission.id, approve ? "approve" : "request-changes",
        { comment: comment || undefined, entryIds: approve ? undefined : entryIds, expectedVersion: submission.rowVersion, idempotencyKey: key })));
      await onDone(approve ? `Approved ${submission.total}. The time is locked.` : "Returned to the employee with your comments.");
      onClose();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={approve ? `Approve ${submission.total}` : "Request changes"}
      description={approve ? "Approval locks this time and fixes its labor cost. It does not create an invoice." : "Say what needs correcting; the employee corrects it and submits a new version."}>
      <div className="flex flex-col gap-3">
        {!approve && (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Entries to correct (optional)</span>
            {submission.entries.map((entry) => (
              <Checkbox key={entry.id} isSelected={entryIds.includes(entry.id)} onChange={(on) => setEntryIds(on ? [...entryIds, entry.id] : entryIds.filter((id) => id !== entry.id))}>
                {`${entry.number} · ${entry.workDate} · ${entry.duration} · ${entry.description.slice(0, 60)}`}
              </Checkbox>
            ))}
          </div>
        )}
        <TextArea label={approve ? "Comment (optional)" : "What needs correcting?"} value={comment} onChange={setComment} isRequired={!approve} />
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant={approve ? "primary" : "secondary"} isLoading={busy} isDisabled={busy || (!approve && comment.trim().length < 3)} onPress={submit}>{approve ? "Approve" : "Return for changes"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

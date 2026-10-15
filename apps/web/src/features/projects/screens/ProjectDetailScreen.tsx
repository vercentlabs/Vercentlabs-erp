"use client";

// One project's workspace: who leads it, where it stands, whether it is on track (with the reasons) and the next step; then its team, its
// documents and notes, the records other modules hold for it, its customer and the customer's people (a customer project), and its history. The toolbar offers only what the project's state and the
// person's access allow; every action is checked again on the server.
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, ErrorState, LinkButton, PermissionState, RecordDetailsPage, StatusBadge, Tab, TabList, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { FactList, HistoryList, MoreActions, type MoreAction } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import {
  HEALTH_TONE, PRIORITY_LABEL, PRIORITY_TONE, PROJECTS_BASE, STATUS_TONE, dateLabel, errorDetails, errorMessage, errorStatus, getActivity, getCancellationReview, getCompletionCheck,
  getProject, getStatusHistory, getSummary, newKey, projectAction, type Check, type Project,
} from "../api/projects-api";
import { CustomerTab } from "../components/CustomerTab";
import { MilestonesTab } from "../components/MilestonesTab";
import { TasksTab } from "../components/TasksTab";
import { DocumentsTab, RelatedTab, TeamTab } from "../components/ProjectTabs";

const TABS = [{ id: "overview", label: "Overview" }, { id: "tasks", label: "Tasks" }, { id: "milestones", label: "Milestones" }, { id: "customer", label: "Customer & Contacts" }, { id: "team", label: "Team" }, { id: "documents", label: "Documents" },
  { id: "related", label: "Related" }, { id: "activity", label: "Activity" }];
const CHECK_TONE = { PASS: "success", FAIL: "danger", WARN: "warning", NOT_TRACKED: "neutral", TO_CONFIRM: "info" } as const;
const CHECK_LABEL = { PASS: "Done", FAIL: "Outstanding", WARN: "Note", NOT_TRACKED: "Not tracked yet", TO_CONFIRM: "Confirm at completion" } as const;

export function ProjectDetailScreen({ projectId }: { projectId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "project", projectId), queryFn: () => getProject(projectId), retry: false });
  const [tab, setTab] = useState(TABS.some((row) => row.id === params.get("tab")) ? params.get("tab")! : "overview");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [dialog, setDialog] = useState<"complete" | "cancel" | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  if (query.isLoading) return <LoadingState label="Loading the project" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to projects" description="Ask an administrator for access." />;
    return <ErrorState title="Project not found" description={errorStatus(query.error) === 404 ? "It does not exist, was removed, or you are not on it." : errorMessage(query.error)}
      action={{ label: "All projects", onPress: () => router.push(`${PROJECTS_BASE}/all`) }} />;
  }
  const project = query.data;
  const can = project.can;
  // The Customer & Contacts tab belongs to a customer project.
  const tabs = TABS.filter((row) => row.id !== "customer" || project.classification === "CUSTOMER");
  const refresh = async (text: string, tone: "success" | "warning" = "success") => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); setMessage({ tone, text }); };
  const act = (action: string, input: Record<string, unknown>, text: string) => projectAction(project.id, action, { expectedVersion: project.version, idempotencyKey: newKey(), ...input })
    .then(async (result) => { await refresh(result.approval === "PENDING" ? "Sent for approval: someone who approves projects decides." : text); return result; });
  const runNow = async (action: string, input: Record<string, unknown>, text: string) => {
    try { await act(action, input, text); } catch (failure) {
      const problems = (errorDetails(failure).problems as Array<{ message: string }> | undefined) ?? [];
      setMessage({ tone: "danger", text: problems.length ? `${errorMessage(failure)} ${problems.slice(1).map((row) => row.message).join(" ")}` : errorMessage(failure) });
    }
  };
  const selectTab = (id: string) => { setTab(id); router.replace(`${pathname}?tab=${id}`, { scroll: false }); };
  const primary = can.activate ? <Button variant="primary" onPress={() => runNow("activate", {}, "The project is planned.")}>{project.approval.required ? "Request approval" : "Activate"}</Button>
    : project.approval.mayDecide ? <Button variant="primary" onPress={() => setAsk({ title: `Approve ${project.code}`, confirm: "Approve", fields: [{ name: "note", label: "Note", kind: "textarea" }],
      run: (values) => act("decide", { decision: "APPROVE", note: values.note || undefined }, "Approved: the project is planned.") })}>Approve</Button>
    : can.start ? <Button variant="primary" onPress={() => setAsk({ title: `Start ${project.code}`, confirm: "Start the project", description: "Execution begins; the team is told.",
      fields: [{ name: "startDate", label: "Started on", kind: "date", description: "Today if left empty." }], run: (values) => act("start", { startDate: values.startDate || undefined }, "The project is in progress.") })}>Start</Button>
    : can.resume ? <Button variant="primary" onPress={() => setAsk({ title: `Resume ${project.code}`, confirm: "Resume", tone: "danger",
      description: `Back to ${project.previousStatus === "PLANNED" ? "planned (it had not started)" : "in progress"}. Nothing done before the hold is lost.`,
      fields: [{ name: "resolution", label: "How the hold was resolved", kind: "textarea", required: true }], run: (values) => act("resume", { resolution: values.resolution }, "The project resumed.") })}>Resume</Button>
    : can.complete ? <Button variant="primary" onPress={() => setDialog("complete")}>Complete</Button>
    : can.restore ? <Button variant="primary" onPress={() => runNow("restore", {}, "Restored from the archive.")}>Restore</Button> : undefined;
  const more: MoreAction[] = [
    { id: "reject", label: "Return without approval", show: project.approval.mayDecide, run: () => setAsk({ title: `Return ${project.code}`, confirm: "Return", fields: [{ name: "note", label: "Why", kind: "textarea", required: true }],
      run: (values) => act("decide", { decision: "REJECT", note: values.note }, "Returned to the requester.") }) },
    { id: "hold", label: "Put on hold", show: can.hold, run: () => setAsk({ title: `Put ${project.code} on hold`, confirm: "Put on hold", tone: "danger",
      description: "Pauses the project; its team, documents, links and history stay. It resumes to where it was.",
      fields: [{ name: "reason", label: "Why it is paused", kind: "textarea", required: true }, { name: "expected", label: "Expected to resume by", kind: "date" }],
      run: (values) => act("hold", { reason: values.reason, expectedResolutionDate: values.expected || undefined }, "The project is on hold.") }) },
    { id: "risk", label: project.risk.flagged ? "Clear the delivery risk" : "Flag a delivery risk", show: can.edit && !["DRAFT"].includes(project.status), run: () => setAsk(project.risk.flagged
      ? { title: "Clear the delivery risk", confirm: "Clear", fields: [{ name: "note", label: "What changed", kind: "textarea" }], run: (values) => act("risk", { flagged: false, note: values.note || undefined }, "Delivery risk cleared.") }
      : { title: "Flag a delivery risk", confirm: "Flag", description: "Shown in the project's health, with your note, until cleared.", fields: [{ name: "note", label: "The risk", kind: "textarea", required: true }],
        run: (values) => act("risk", { flagged: true, note: values.note }, "Delivery risk flagged.") }) },
    { id: "health", label: "Explain the health", show: (can.edit || project.role === "MANAGER") && ["AT_RISK", "BLOCKED"].includes(project.health.state), run: () => setAsk({ title: "Explain the health warning",
      confirm: "Save", description: "Shown beside the warning; it never hides the reasons.", fields: [{ name: "note", label: "Explanation", kind: "textarea", required: true }],
      run: (values) => act("health-note", { note: values.note }, "Explanation saved.") }) },
    { id: "reopen", label: "Reopen", show: can.reopen, run: () => setAsk({ title: `Reopen ${project.code}`, confirm: "Reopen", tone: "danger",
      description: "Back in progress. The original completion stays in the history; invoices and finance postings are not touched.",
      fields: [{ name: "reason", label: "Why it is reopened", kind: "textarea", required: true }], run: (values) => act("reopen", { reason: values.reason }, "Reopened: the project is in progress.") }) },
    { id: "cancel", label: "Cancel the project", show: can.cancel, run: () => setDialog("cancel") },
    { id: "archive", label: "Archive", show: can.archive, run: () => setAsk({ title: `Archive ${project.code}`, confirm: "Archive", description: "Hidden from the everyday lists; everything is kept and still found under Archived.",
      fields: [], run: () => act("archive", {}, "Archived.") }) },
    { id: "delete", label: "Remove this draft", show: can.delete, run: () => setAsk({ title: `Remove ${project.code}`, confirm: "Remove", tone: "danger",
      description: "Only an unused draft is removed. A draft with links, notes or files is cancelled instead.", fields: [],
      run: async () => { await projectAction(project.id, "delete"); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); router.replace(`${PROJECTS_BASE}/all`); } }) },
  ];
  return (
    <>
      <RecordDetailsPage
        header={{
          title: <>{project.name ?? "Untitled draft"} <span className="text-base font-normal whitespace-nowrap text-text-muted">{project.code} · {project.classification === "CUSTOMER" ? "Customer project" : "Internal project"}</span></>,
          status: (
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={STATUS_TONE[project.status]}>{project.statusLabel}</StatusBadge>
              <StatusBadge tone={HEALTH_TONE[project.health.state]}>{project.health.label}</StatusBadge>
              {project.archived && <StatusBadge tone="neutral">Archived</StatusBadge>}
            </span>
          ),
          fields: [
            { label: project.classification === "CUSTOMER" ? "Customer" : "Kind", value: project.classification === "CUSTOMER"
              ? (project.customer ? `${project.customer}${project.crmAccountId ? " (CRM account, not yet a Customer)" : project.customerInactive ? " (inactive)" : ""}` : "Not set") : "Internal" },
            { label: "Project Manager", value: project.manager ? `${project.manager}${project.managerActive ? "" : " (inactive)"}` : "Not assigned" },
            { label: "Target", value: dateLabel(project.targetEndDate) },
            { label: "Progress", value: project.progress.percent === null ? project.progress.label : `${project.progress.percent}%` },
            { label: "Priority", value: <StatusBadge tone={PRIORITY_TONE[project.priority]}>{PRIORITY_LABEL[project.priority]}</StatusBadge> },
            { label: "Your access", value: project.roleLabel ?? "—" },
          ],
          primaryAction: primary,
          secondaryActions: (
            <>
              {can.edit && <LinkButton variant="secondary" href={`${PROJECTS_BASE}/${project.id}/edit`}>Edit</LinkButton>}
              <MoreActions actions={more} />
            </>
          ),
        }}
        tabs={
          <div className="flex flex-col gap-3">
            {message && <Notice tone={message.tone}>{message.text}</Notice>}
            {project.archived && <Notice tone="neutral">Archived {project.archivedAt ? formatDateTime(project.archivedAt) : ""}{project.archivedBy ? ` by ${project.archivedBy}` : ""}. Everything is kept; restore it to work on it again.</Notice>}
            {project.hold && <Notice tone="warning">{`On hold since ${formatDateTime(project.hold.startedAt)}: ${project.hold.reason}${project.hold.owner ? ` (owner: ${project.hold.owner})` : ""}.`}</Notice>}
            {project.approval.status === "PENDING" && <Notice tone="info">{`Waiting for approval${project.approval.requestedBy ? ` — requested by ${project.approval.requestedBy}` : ""}.`}</Notice>}
            {project.approval.status === "REJECTED" && project.status === "DRAFT" && <Notice tone="warning">{`Not approved: ${project.approval.note ?? ""} Change the project and request approval again.`}</Notice>}
            {!project.managerActive && project.status !== "COMPLETED" && project.status !== "CANCELLED" && <Notice tone="danger">The Project Manager is no longer active. Assign a replacement so the project stays accountable.</Notice>}
            {project.activation && !project.activation.ready && <Notice tone="neutral">{`Before activation: ${project.activation.problems.map((row) => row.message).join(" ")}`}</Notice>}
            {project.customerReview && <Notice tone="warning">{`Commercial review needed: ${project.customerReview.reason}`} <button type="button" className="text-brand underline" onClick={() => selectTab("customer")}>Review</button></Notice>}
          </div>
        }
      >
        <Tabs selectedKey={tab} onSelectionChange={(key) => selectTab(String(key))}>
          <TabList aria-label="Project sections">{tabs.map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList>
        </Tabs>
        <div className="mt-4">
          {tab === "overview" && <OverviewTab project={project} onTab={selectTab} />}
          {tab === "tasks" && <TasksTab project={project} />}
          {tab === "milestones" && <MilestonesTab project={project} />}
          {tab === "customer" && project.classification === "CUSTOMER" && <CustomerTab project={project} onChanged={refresh} onTab={selectTab} />}
          {tab === "team" && <TeamTab project={project} onChanged={refresh} />}
          {tab === "documents" && <DocumentsTab project={project} />}
          {tab === "related" && <RelatedTab project={project} />}
          {tab === "activity" && <ActivityTab project={project} />}
        </div>
      </RecordDetailsPage>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
      {dialog === "complete" && <CompleteDialog project={project} onClose={() => setDialog(null)} onDone={(text) => refresh(text)} />}
      {dialog === "cancel" && <CancelDialog project={project} onClose={() => setDialog(null)} onDone={(text) => refresh(text)} />}
    </>
  );
}

function OverviewTab({ project, onTab }: { project: Project; onTab: (tab: string) => void }) {
  const workspace = useWorkspaceContext();
  const summary = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "summary", project.id), queryFn: () => getSummary(project.id) });
  const tasks = project.progress.tasks;
  const milestones = project.progress.milestones;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[["Progress", project.progress.percent === null ? "—" : `${project.progress.percent}%`, project.progress.label],
          ["Health", project.health.label, project.health.final ? "Final outcome" : `${project.health.reasons.length} reason(s)`],
          ["Team", String(project.members), "active member(s)"],
          ["Target", dateLabel(project.targetEndDate), project.actualStartDate ? `Started ${dateLabel(project.actualStartDate)}` : project.plannedStartDate ? `Starts ${dateLabel(project.plannedStartDate)}` : "No start date"]].map(([label, value, note]) => (
          <div key={label} className="rounded-md border border-border bg-surface p-3"><p className="text-xs text-text-muted">{label}</p><p className="text-lg font-semibold">{value}</p><p className="text-xs text-text-muted">{note}</p></div>
        ))}
      </div>
      <Panel title="Health" description="A warning, not a forecast: each reason comes from the project's own records.">
        <ul className="flex flex-col gap-1 text-sm">{project.health.reasons.map((reason) => <li key={reason}>• {reason}</li>)}</ul>
        {project.health.note && <p className="text-sm text-text-secondary">{`Explanation${project.health.noteBy ? ` by ${project.health.noteBy}` : ""}: ${project.health.note.text}`}</p>}
        {project.risk.flagged && <Notice tone="warning">{`Delivery risk: ${project.risk.note ?? ""}`}</Notice>}
      </Panel>
      <Panel title="Work" description="Progress is done tasks over all tasks but the cancelled — never typed in. Milestones show which outcomes are reached.">
        {tasks && tasks.total > 0 ? <FactList columns={3} items={[["Tasks", `${tasks.completed} of ${tasks.total} done`], ["Open", String(tasks.open)], ["Overdue", String(tasks.overdue)]]} />
          : <p className="text-sm text-text-muted">No tasks yet, so no progress data (a project with no tasks never shows as complete). <button type="button" className="text-brand underline" onClick={() => onTab("tasks")}>Add tasks</button>.</p>}
        {milestones && milestones.total > 0 ? <FactList columns={3} items={[["Milestones", `${milestones.completed} of ${milestones.total} done`], ["Open", String(milestones.open)], ["Overdue", String(milestones.overdue)]]} />
          : <p className="text-sm text-text-muted">No milestones yet. <button type="button" className="text-brand underline" onClick={() => onTab("milestones")}>Plan them</button> to track the project&apos;s checkpoints.</p>}
      </Panel>
      {summary.data && <Notice tone="info">{`Next: ${summary.data.next}`}</Notice>}
      <FactList title="Details" items={[
        ["Code", project.code], ["Type", project.type ?? "Not set"], ["Kind", project.classification === "CUSTOMER" ? "Customer project" : "Internal project"],
        ["Customer", project.customer ? `${project.customer}${project.customerNumber ? ` · ${project.customerNumber}` : ""}` : "—"], ["Primary contact", project.contact ? `${project.contact.name}${project.contact.email ? ` · ${project.contact.email}` : ""}` : "—"],
        ["Project Manager", project.manager ?? "Not assigned"], ["Planned start", dateLabel(project.plannedStartDate)], ["Target end", dateLabel(project.targetEndDate)],
        ["Actual start", dateLabel(project.actualStartDate)], ["Completed", project.completedAt ? `${dateLabel(project.completedAt)}${project.completedBy ? ` by ${project.completedBy}` : ""}` : "—"],
        ["Priority", PRIORITY_LABEL[project.priority]], ["Tags", project.tags.length ? project.tags.join(", ") : "—"],
        ["Source", project.source === "SALES_ORDER" ? "Created from a sales order" : project.source === "IMPORT" ? "Imported" : "Created directly"], ["Created", `${formatDateTime(project.createdAt)}${project.createdBy ? ` by ${project.createdBy}` : ""}`],
        ...(project.cancelReason ? [["Cancelled", `${project.cancelledAt ? formatDateTime(project.cancelledAt) : ""} — ${project.cancelReason}`] as [string, string]] : []),
        ...(project.completionNote ? [["Closing notes", project.completionNote] as [string, string]] : []),
      ]} />
      <Panel title="Description and scope">
        {project.description ? <p className="whitespace-pre-wrap text-sm">{project.description}</p> : <p className="text-sm text-text-muted">No description yet.</p>}
      </Panel>
      {summary.data && (
        <Panel title="Recent activity" actions={<Button size="compact" variant="ghost" onPress={() => onTab("activity")}>All activity</Button>}>
          <HistoryList title={null} entries={summary.data.activity.map((row) => ({ summary: row.summary ?? row.action.toLowerCase().replace(/_/g, " "), at: row.at, actor: row.actor }))} />
          {summary.data.links.length > 0 && <p className="text-sm text-text-secondary">{`Linked: ${summary.data.links.map((row) => `${row.count} ${row.label.toLowerCase()}${row.count > 1 ? "s" : ""}`).join(", ")}.`}{" "}
            <button type="button" className="text-brand underline" onClick={() => onTab("related")}>See them</button></p>}
        </Panel>
      )}
    </div>
  );
}

function ActivityTab({ project }: { project: Project }) {
  const workspace = useWorkspaceContext();
  const activity = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "activity", project.id), queryFn: () => getActivity(project.id) });
  const history = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "status-history", project.id), queryFn: () => getStatusHistory(project.id) });
  if (activity.isLoading) return <LoadingState label="Loading activity" rows={5} />;
  return (
    <div className="flex flex-col gap-4">
      <HistoryList title="Activity" entries={(activity.data ?? []).map((row) => ({ summary: row.summary ?? row.action.toLowerCase().replace(/_/g, " "), at: row.at, actor: row.actor, label: row.action.toLowerCase().replace(/_/g, " ") }))} />
      <HistoryList title="Status changes" empty="No status changes yet." entries={(history.data ?? []).map((row) => ({ summary: `${row.from ? row.from.toLowerCase().replace(/_/g, " ") : "created"} → ${row.to.toLowerCase().replace(/_/g, " ")}`,
        at: row.at, actor: row.actor, detail: row.reason ?? undefined }))} />
    </div>
  );
}

function ChecksList({ checks }: { checks: Check[] }) {
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

function CompleteDialog({ project, onClose, onDone }: { project: Project; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const check = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "completion-check", project.id), queryFn: () => getCompletionCheck(project.id) });
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [delivered, setDelivered] = useState(false);
  const [acceptance, setAcceptance] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checks = check.data?.checks ?? [];
  const needsAcceptance = checks.some((row) => row.key === "acceptance");
  const outstanding = checks.find((row) => row.key === "financial" && row.state === "TO_CONFIRM");
  const blocked = checks.some((row) => row.state === "FAIL");
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Complete ${project.code}`} size="lg">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">Completion locks ordinary execution. Billing and collection carry on in Sales and Finance; nothing there changes.</p>
        {check.isLoading ? <LoadingState label="Checking" rows={4} /> : <ChecksList checks={checks} />}
        {blocked && <Notice tone="danger">Something above is outstanding. Resolve it, then complete the project.</Notice>}
        <TextField label="Completed on" type="date" value={date} onChange={setDate} description="Today if left empty." />
        <TextArea label="Closing notes" value={note} onChange={setNote} maxLength={4000} isRequired />
        <Checkbox isSelected={delivered} onChange={setDelivered}>The project&apos;s deliverables were delivered</Checkbox>
        {needsAcceptance && <TextField label="Customer acceptance" value={acceptance} onChange={setAcceptance} description="Who accepted, and how (e.g. signed handover on 30 Nov)." />}
        {outstanding && <Checkbox isSelected={acknowledge} onChange={setAcknowledge}>{`I understand billing or collection is still open: ${outstanding.message.split(" — ")[0]}`}</Checkbox>}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || blocked || note.trim().length < 3 || !delivered || (needsAcceptance && acceptance.trim().length < 3) || (Boolean(outstanding) && !acknowledge)}
            onPress={async () => {
              setBusy(true); setError(null);
              try {
                await projectAction(project.id, "complete", { expectedVersion: project.version, idempotencyKey: key, completionDate: date || undefined, closingNote: note, deliverablesConfirmed: delivered,
                  customerAcceptance: acceptance || undefined, acknowledgeOutstanding: acknowledge });
                await onDone("The project is completed."); onClose();
              } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
            }}>Complete the project</Button>
        </div>
      </div>
    </Dialog>
  );
}

function CancelDialog({ project, onClose, onDone }: { project: Project; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const review = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "cancellation-review", project.id), queryFn: () => getCancellationReview(project.id) });
  const [reason, setReason] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dependencies = review.data?.dependencies ?? [];
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Cancel ${project.code}`} size="lg">
      <div className="flex flex-col gap-3">
        {review.isLoading ? <LoadingState label="Reviewing what depends on it" rows={3} /> : (
          <>
            <ul className="flex flex-col gap-1 text-sm">{(review.data?.notes ?? []).map((row) => <li key={row}>• {row}</li>)}</ul>
            {dependencies.length > 0 && (
              <Notice tone="warning">
                <span className="flex flex-col gap-1"><span>{`${dependencies.length} linked business record(s) stay with their own modules:`}</span>
                  {dependencies.map((row, index) => <span key={index}>{`${row.type} ${row.number ?? ""}${row.status ? ` (${row.status.replace(/_/g, " ")})` : ""}`}</span>)}</span>
              </Notice>
            )}
          </>
        )}
        <TextArea label="Why the project is cancelled" value={reason} onChange={setReason} maxLength={2000} isRequired />
        {dependencies.length > 0 && <Checkbox isSelected={acknowledge} onChange={setAcknowledge}>I reviewed the linked records; they are handled in their own modules</Checkbox>}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Keep the project</Button>
          <Button variant="danger" isLoading={busy} isDisabled={busy || reason.trim().length < 3 || (dependencies.length > 0 && !acknowledge)} onPress={async () => {
            setBusy(true); setError(null);
            try { await projectAction(project.id, "cancel", { expectedVersion: project.version, idempotencyKey: key, reason, acknowledgeDependencies: acknowledge }); await onDone("The project is cancelled."); onClose(); }
            catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
          }}>Cancel the project</Button>
        </div>
      </div>
    </Dialog>
  );
}

"use client";

// One milestone: what it is, who owns it, when it is due, whether it can be submitted or completed (and why not), and the next step. Its
// deliverables with their evidence, the tasks and prerequisite milestones it waits for, its blockers, every submission with the decisions on
// it (internal approval, and the customer's acceptance recorded from the evidence they sent), its billing handoff to Sales, notes, files and
// history. The toolbar offers only what the milestone's state and the person's access allow; every action is checked again on the server.
import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQuickCreate } from "@/shell/pickers/useQuickCreate";
import { Button, Checkbox, Dialog, ErrorState, PermissionState, RecordDetailsPage, Select, StatusBadge, Tab, TabList, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable, MoreActions, type MoreAction } from "@/shared/ui/record";
import { useDebouncedValue } from "@/shared/ui/list";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask, type Field } from "@/shared/ui/AskDialog";
import {
  APPROVAL_TONE, BLOCKER_LABEL, MILESTONES_BASE, MILESTONE_TONE, MILESTONE_TYPE_LABEL, PROJECTS_BASE, dateLabel, dueLabel, errorDetails,
  addProjectContact, getProject, errorMessage, errorStatus, getLinks, getMembers, getMilestone, getMilestoneActivity, getProjectContacts, getProjectMilestones, milestoneAction, milestoneFileHref,
  newKey, removeMilestoneFile, searchMilestoneTasks, updateMilestone, uploadMilestoneFile, getMilestoneFiles, type BillingStage, type MilestoneCheck, type MilestoneDetail,
} from "../api/projects-api";
import { AssignTaskDialog } from "../assignees/AssignTaskDialog";
import { PriorityBadge, PriorityDialog, PriorityField, priorityReasonMissing } from "../priority/Priority";
import { CommentThread, CommentsTabLabel } from "../collaboration/CommentThread";

const TABS = [{ id: "overview", label: "Overview" }, { id: "deliverables", label: "Deliverables" }, { id: "tasks", label: "Tasks" }, { id: "dependencies", label: "Dependencies" },
  { id: "approvals", label: "Approvals" }, { id: "billing", label: "Billing" }, { id: "files", label: "Files" }, { id: "comments", label: "Comments" }, { id: "activity", label: "Activity" }];
const CHECK_TONE = { PASS: "success", FAIL: "danger", NOT_TRACKED: "neutral", WAIVED: "warning" } as const;
const CHECK_LABEL = { PASS: "Done", FAIL: "Outstanding", NOT_TRACKED: "Not tracked yet", WAIVED: "By exception" } as const;
const DECISION_LABEL = { APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested", REJECTED: "Rejected" } as const;
const DECISION_TONE = { APPROVED: "success", CHANGES_REQUESTED: "warning", REJECTED: "danger" } as const;
const DECISION_OPTIONS = [{ value: "APPROVED", label: "Approve" }, { value: "CHANGES_REQUESTED", label: "Ask for changes" }, { value: "REJECTED", label: "Reject" }];

type Act = (action: string, input: Record<string, unknown>, text: string) => Promise<unknown>;

export function MilestoneDetailScreen({ milestoneId }: { milestoneId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "milestone", milestoneId), queryFn: () => getMilestone(milestoneId), retry: false });
  const [tab, setTab] = useState(params.get("tab") === "notes" ? "files" : TABS.some((row) => row.id === params.get("tab")) ? params.get("tab")! : "overview");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [dialog, setDialog] = useState<"edit" | "customer" | "billing-stage" | "owner" | "priority" | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  if (query.isLoading) return <LoadingState label="Loading the milestone" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to this milestone" description="Ask an administrator for access to project milestones." />;
    return <ErrorState title="Milestone not found" description={errorStatus(query.error) === 404 ? "It does not exist, or you are not on its project." : errorMessage(query.error)}
      action={{ label: "All milestones", onPress: () => router.push(MILESTONES_BASE) }} />;
  }
  const milestone = query.data;
  const can = milestone.can;
  const refresh = async (text: string, tone: "success" | "warning" = "success") => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); setMessage({ tone, text }); };
  const act: Act = (action, input, text) => milestoneAction(milestone.id, action, { expectedVersion: milestone.version, idempotencyKey: newKey(), ...input }).then(async (result) => { await refresh(text); return result; });
  const selectTab = (id: string) => { setTab(id); router.replace(`${pathname}?tab=${id}`, { scroll: false }); };
  const unmet = milestone.prerequisites.filter((row) => row.status !== "COMPLETED");
  const exceptionField: Field[] = unmet.length && can.waive ? [{ name: "exception", label: `Proceed before ${unmet.map((row) => row.code).join(", ")} — the reason (an authorized exception)`, kind: "textarea", required: true }] : [];
  const start = () => setAsk({ title: `Start ${milestone.code}`, confirm: "Start", description: unmet.length ? `${unmet.map((row) => `${row.code} ${row.name}`).join(", ")} is not complete yet.` : "Work on the milestone begins.",
    fields: exceptionField, run: (values) => act("start", { exceptionReason: values.exception || undefined }, "The milestone is in progress.") });
  const failingDependencies = milestone.readiness.checks.some((row) => row.key === "dependencies" && row.state === "FAIL");
  const dependencyField: Field[] = failingDependencies && can.waive ? [{ name: "exception", label: "Prerequisites are open — proceed by exception (reason)", kind: "textarea" }] : [];
  const submitAsk = () => setAsk({ title: `Submit ${milestone.code} for review`, confirm: "Submit",
    description: "What is reviewed — deliverables, evidence, files — is kept exactly as it is now. To change it afterwards, withdraw the submission.",
    fields: [{ name: "note", label: "Note for the reviewer", kind: "textarea" }, ...dependencyField],
    run: (values) => act("submit", { note: values.note || undefined, dependencyException: values.exception || undefined }, "Submitted for review.") });
  const reviewAsk = () => setAsk({ title: `Review ${milestone.code}`, confirm: "Record the decision",
    fields: [{ name: "decision", label: "Decision", kind: "select", options: DECISION_OPTIONS, required: true, initial: "APPROVED" }, { name: "note", label: "Note (required to ask for changes or reject)", kind: "textarea" }],
    run: (values) => act("approve", { decision: values.decision, note: values.note || undefined }, values.decision === "APPROVED" ? "Approved." : "Returned to the owner with your note.") });
  const completeAsk = () => setAsk({ title: `Complete ${milestone.code}`, confirm: "Complete the milestone",
    description: milestone.billing.stage ? "Once complete, its billing can be requested from Sales." : "Every condition is checked again before it completes.",
    fields: [{ name: "completionDate", label: "Completed on", kind: "date", description: "Today if left empty; never in the future." }, { name: "note", label: "Note", kind: "textarea" }, ...dependencyField],
    run: (values) => act("complete", { completionDate: values.completionDate || undefined, note: values.note || undefined, dependencyException: values.exception || undefined }, "The milestone is complete.") });
  const billingAsk = () => setAsk({ title: "Request billing from Sales", confirm: "Request billing",
    description: "Sales reviews the invoice details and taxes and invoices it; nothing financial happens here. A request is made once.",
    fields: [{ name: "note", label: "Note for Sales", kind: "textarea" }], run: (values) => act("request-billing", { note: values.note || undefined }, "Billing requested: Sales was told.") });
  // The next step, in the order a milestone moves; the rest go under More actions.
  const steps = [
    { id: "start", label: "Start", show: can.start, run: start },
    { id: "submit", label: "Submit for review", show: can.submit, run: submitAsk },
    { id: "review", label: "Review", show: can.approve, run: reviewAsk },
    { id: "customer", label: "Record customer decision", show: can.customerAcceptance, run: () => setDialog("customer") },
    { id: "complete", label: "Complete", show: can.complete, run: completeAsk },
    { id: "billing", label: "Request billing", show: can.billingRequest, run: billingAsk },
  ];
  const next = steps.find((row) => row.show);
  const primary = next ? <Button variant="primary" onPress={next.run}>{next.label}</Button> : undefined;
  const activeDependents = milestone.dependents.filter((row) => row.status !== "CANCELLED");
  const more: MoreAction[] = [
    { id: "edit", label: "Edit", show: can.edit, run: () => setDialog("edit") },
    { id: "priority", label: "Change priority", show: can.edit && !["COMPLETED", "CANCELLED"].includes(milestone.status), run: () => setDialog("priority") },
    { id: "assign", label: "Change owner", show: can.assign, run: () => setDialog("owner") },
    ...steps.filter((row) => row.show && row.id !== next?.id),
    { id: "block", label: "Raise a blocker", show: can.block, run: () => setAsk({ title: "Raise a blocker", confirm: "Raise",
      description: milestone.status === "SUBMITTED" ? "It holds back completion until resolved." : "The milestone shows as blocked until every blocker is resolved; it then resumes where it was.",
      fields: [{ name: "category", label: "What kind", kind: "select", options: Object.entries(BLOCKER_LABEL).map(([value, label]) => ({ value, label })), initial: "OTHER" },
        { name: "description", label: "What is blocking it", kind: "textarea", required: true }],
      run: (values) => act("raise-blocker", { category: values.category, description: values.description }, "Blocker raised: the Project Manager was told.") }) },
    { id: "withdraw", label: "Withdraw the submission", show: can.withdraw, run: () => setAsk({ title: "Withdraw the submission", confirm: "Withdraw",
      description: "Back to in progress so it can be changed. The submission stays in the history; a decision on it no longer counts.", fields: [{ name: "reason", label: "Why", kind: "textarea" }],
      run: (values) => act("withdraw", { reason: values.reason || undefined }, "Submission withdrawn.") }) },
    { id: "reopen", label: "Reopen", show: can.reopen, run: () => setAsk({ title: `Reopen ${milestone.code}`, confirm: "Reopen", tone: "danger",
      description: "Back to in progress. The original completion, submissions and decisions stay in the history; approval is needed again on the changed work.",
      fields: [{ name: "reason", label: "Why it is reopened", kind: "textarea", required: true },
        ...(activeDependents.length ? [{ name: "dependents", label: `I reviewed what depends on it: ${activeDependents.map((row) => `${row.code} (${row.statusLabel.toLowerCase()})`).join(", ")}`, kind: "checkbox" as const }] : []),
        ...(milestone.billing.request && milestone.billing.request.status !== "WITHDRAWN" ? [{ name: "billing", label: "I understand its billing request stays with Sales (it is not cancelled here)", kind: "checkbox" as const }] : [])],
      run: (values) => act("reopen", { reason: values.reason, acknowledgeDependents: Boolean(values.dependents), acknowledgeBilling: Boolean(values.billing) }, "Reopened: the milestone is in progress.") }) },
    { id: "waive", label: "Let the project complete without it", show: can.waiveForCompletion, run: () => setAsk({ title: "Waive for project completion", confirm: "Waive", tone: "danger",
      description: "The project may then complete while this milestone is open. It stays open and on record.", fields: [{ name: "reason", label: "Why", kind: "textarea", required: true }],
      run: (values) => act("waive-for-completion", { reason: values.reason }, "Waived for project completion.") }) },
    { id: "cancel", label: "Cancel the milestone", show: can.cancel, run: () => setAsk({ title: `Cancel ${milestone.code}`, confirm: "Cancel the milestone", tone: "danger",
      description: activeDependents.length ? `${activeDependents.map((row) => row.code).join(", ")} depend on it: they will no longer wait for it. Linked tasks are not changed.` : "Linked tasks are not changed. It stays on record as cancelled.",
      fields: [{ name: "reason", label: "Why it is cancelled", kind: "textarea", required: true },
        ...(activeDependents.length ? [{ name: "dependents", label: "I reviewed the milestones that depend on it", kind: "checkbox" as const }] : [])],
      run: (values) => act("cancel", { reason: values.reason, acknowledgeDependents: Boolean(values.dependents) }, "The milestone is cancelled.") }) },
  ];
  return (
    <>
      <RecordDetailsPage
        header={{
          title: <>{milestone.name} <span className="text-base font-normal whitespace-nowrap text-text-muted">{milestone.code} · {milestone.typeLabel}</span></>,
          status: (
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={MILESTONE_TONE[milestone.status]}>{milestone.statusLabel}</StatusBadge>
              {milestone.approvalStatus !== "NOT_REQUIRED" && <StatusBadge tone={APPROVAL_TONE[milestone.approvalStatus]}>{milestone.approvalLabel}</StatusBadge>}
              {milestone.overdue && <StatusBadge tone="danger">Overdue</StatusBadge>}
              {milestone.waiver && <StatusBadge tone="warning">Waived for completion</StatusBadge>}
            </span>
          ),
          fields: [
            { label: "Project", value: <Link className="text-brand hover:underline" href={`${PROJECTS_BASE}/${milestone.projectId}?tab=milestones`}>{`${milestone.projectCode}${milestone.projectName ? ` · ${milestone.projectName}` : ""}`}</Link> },
            { label: "Owner", value: milestone.owner ?? "—" },
            { label: "Due", value: `${dateLabel(milestone.dueDate)}${milestone.rescheduled ? ` (was ${dateLabel(milestone.originalDueDate)})` : ""}` },
            { label: "Deliverables", value: milestone.criteriaProgress.total ? `${milestone.criteriaProgress.done} of ${milestone.criteriaProgress.total}` : "None yet" },
            { label: "Acceptance", value: [milestone.internalApprovalRequired ? "Internal approval" : null, milestone.customerAcceptanceRequired ? "Customer acceptance" : null].filter(Boolean).join(" + ") || "None" },
            { label: "Priority", value: <PriorityBadge priority={milestone.priority} /> },
          ],
          primaryAction: primary,
          secondaryActions: <MoreActions actions={more} />,
        }}
        tabs={
          <div className="flex flex-col gap-3">
            {message && <Notice tone={message.tone}>{message.text}</Notice>}
            {milestone.projectStatus === "ON_HOLD" && <Notice tone="warning">The project is on hold: milestone work is paused until it resumes.</Notice>}
            {["COMPLETED", "CANCELLED"].includes(milestone.projectStatus) && <Notice tone="neutral">{`The project is ${milestone.projectStatus === "COMPLETED" ? "completed" : "cancelled"}: this milestone is read-only.`}</Notice>}
            {milestone.status === "SUBMITTED" && <Notice tone="info">Under review. What was submitted is locked; withdraw the submission to change it.</Notice>}
            {milestone.status === "BLOCKED" && <Notice tone="danger">{`Blocked: ${milestone.blockers.filter((row) => row.status === "OPEN").map((row) => row.description).join("; ")}`}</Notice>}
            {milestone.status === "CANCELLED" && <Notice tone="neutral">{`Cancelled ${milestone.cancelledAt ? formatDateTime(milestone.cancelledAt) : ""}${milestone.cancelledBy ? ` by ${milestone.cancelledBy}` : ""}: ${milestone.cancelReason ?? ""}`}</Notice>}
            {milestone.approvalStatus === "CHANGES_REQUESTED" && <Notice tone="warning">Changes were requested on the last submission. See Approvals, update the work and submit again.</Notice>}
          </div>
        }
      >
        <Tabs selectedKey={tab} onSelectionChange={(key) => selectTab(String(key))}>
          <TabList aria-label="Milestone sections">{TABS.map((row) => <Tab key={row.id} id={row.id}>{row.id === "comments" ? <CommentsTabLabel parentType="MILESTONE" parentId={milestone.id} /> : row.label}</Tab>)}</TabList>
        </Tabs>
        <div className="mt-4">
          {tab === "overview" && <OverviewTab milestone={milestone} act={act} setAsk={setAsk} />}
          {tab === "deliverables" && <DeliverablesTab milestone={milestone} act={act} setAsk={setAsk} />}
          {tab === "tasks" && <TasksTab milestone={milestone} act={act} setAsk={setAsk} />}
          {tab === "dependencies" && <DependenciesTab milestone={milestone} act={act} setAsk={setAsk} />}
          {tab === "approvals" && <ApprovalsTab milestone={milestone} />}
          {tab === "billing" && <BillingTab milestone={milestone} act={act} setAsk={setAsk} onStage={() => setDialog("billing-stage")} />}
          {tab === "files" && <FilesTab milestone={milestone} onChanged={refresh} />}
          {tab === "comments" && <CommentThread parentType="MILESTONE" parentId={milestone.id} />}
          {tab === "activity" && <ActivityTab milestone={milestone} />}
        </div>
      </RecordDetailsPage>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
      {dialog === "priority" && <PriorityDialog target={{ kind: "milestone", id: milestone.id, code: milestone.code, name: milestone.name, priority: milestone.priority, version: milestone.version }}
        onClose={() => setDialog(null)} onDone={(text) => refresh(text)} />}
      {dialog === "edit" && <EditDialog milestone={milestone} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === "customer" && <CustomerDecisionDialog milestone={milestone} onClose={() => setDialog(null)} act={act} />}
      {dialog === "billing-stage" && <BillingStageDialog milestone={milestone} onClose={() => setDialog(null)} act={act} />}
      {dialog === "owner" && <OwnerDialog milestone={milestone} onClose={() => setDialog(null)} act={act} />}
    </>
  );
}

function ChecksList({ checks }: { checks: MilestoneCheck[] }) {
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

type TabProps = { milestone: MilestoneDetail; act: Act; setAsk: (ask: Ask | null) => void };

function OverviewTab({ milestone, act, setAsk }: TabProps) {
  const due = dueLabel(milestone);
  const open = milestone.blockers.filter((row) => row.status === "OPEN");
  const stage = milestone.status === "SUBMITTED" || (!milestone.internalApprovalRequired && !milestone.customerAcceptanceRequired) ? "completion" : "submission";
  return (
    <div className="flex flex-col gap-4">
      <Panel title={`Ready for ${stage}?`} description={milestone.readiness.ready ? `Every condition for ${stage} holds.` : "Each outstanding condition, and what to do about it."}>
        <ChecksList checks={milestone.readiness.checks} />
      </Panel>
      <Panel title="Blockers" description="What stops progress, with an owner. The milestone resumes where it was once the last one is resolved.">
        {milestone.blockers.length === 0 ? <p className="text-sm text-text-muted">No blockers.</p> : (
          <ul className="flex flex-col gap-2">
            {milestone.blockers.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 rounded-md border border-border p-2 sm:flex-row sm:items-start sm:justify-between">
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{`${row.categoryLabel}: ${row.description}`}</span>
                  <span className="text-xs text-text-muted">{`Raised ${formatDateTime(row.raisedAt)}${row.raisedBy ? ` by ${row.raisedBy}` : ""}${row.owner ? ` · owner ${row.owner}` : ""}`}</span>
                  {row.status === "RESOLVED" && <span className="text-xs text-text-secondary">{`Resolved ${row.resolvedAt ? formatDateTime(row.resolvedAt) : ""}${row.resolvedBy ? ` by ${row.resolvedBy}` : ""}: ${row.resolution ?? ""}`}</span>}
                </span>
                {row.status === "OPEN" && milestone.can.block ? <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Resolve the blocker", confirm: "Resolve",
                  fields: [{ name: "resolution", label: "How it was resolved", kind: "textarea", required: true }],
                  run: (values) => act("resolve-blocker", { blockerId: row.id, resolution: values.resolution }, open.length === 1 ? "Blocker resolved: the milestone resumes." : "Blocker resolved.") })}>Resolve</Button>
                  : <StatusBadge tone={row.status === "OPEN" ? "danger" : "neutral"}>{row.status === "OPEN" ? "Open" : "Resolved"}</StatusBadge>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <FactList title="Details" items={[
        ["Code", milestone.code], ["Type", MILESTONE_TYPE_LABEL[milestone.type] ?? milestone.type], ["Owner", milestone.owner ?? "—"], ["Project Manager", milestone.projectManager ?? "—"],
        ["Planned start", dateLabel(milestone.plannedStartDate)], ["Original due date", dateLabel(milestone.originalDueDate)], ["Current due date", `${dateLabel(milestone.dueDate)}${due ? ` · ${due}` : ""}`],
        ["Project target", dateLabel(milestone.projectTargetEndDate)], ["Started", milestone.startedAt ? formatDateTime(milestone.startedAt) : "—"],
        ["Submitted", milestone.submittedAt ? formatDateTime(milestone.submittedAt) : "—"], ["Completed", milestone.completedAt ? `${formatDateTime(milestone.completedAt)}${milestone.completedBy ? ` by ${milestone.completedBy}` : ""}` : "—"],
        ["Internal approval", milestone.internalApprovalRequired ? "Required" : "Not required"],
        ["Customer acceptance", milestone.customerAcceptanceRequired ? `Required${milestone.customerContact ? ` · ${milestone.customerContact}` : " · contact not chosen yet"}` : "Not required"],
        ["Project completion", milestone.requiredForCompletion ? (milestone.waiver ? `Waived: ${milestone.waiver.reason}` : "Required") : "Not required"],
        ["Tasks", milestone.taskProgress.label], ["Created", `${formatDateTime(milestone.createdAt)}${milestone.createdBy ? ` by ${milestone.createdBy}` : ""}`],
      ]} />
      <Panel title="Description">
        {milestone.description ? <p className="whitespace-pre-wrap text-sm">{milestone.description}</p> : <p className="text-sm text-text-muted">No description.</p>}
      </Panel>
    </div>
  );
}

function DeliverablesTab({ milestone, act, setAsk }: TabProps) {
  const can = milestone.can;
  const evidenceOptions = [{ value: "", label: "No file" }, ...milestone.files.map((row) => ({ value: row.id, label: row.fileName }))];
  const editable = can.edit && milestone.status !== "SUBMITTED";
  const move = (index: number, delta: number) => {
    const order = milestone.criteria.map((row) => row.id);
    const [moved] = order.splice(index, 1);
    order.splice(index + delta, 0, moved);
    return act("reorder-criteria", { order }, "Deliverables reordered.");
  };
  return (
    <Panel title="Deliverables" description="The completion criteria. A required one must be completed (with its evidence, when asked) or waived before the milestone is submitted or completed."
      actions={editable ? <Button size="compact" variant="primary" onPress={() => setAsk({ title: "Add a deliverable", confirm: "Add",
        fields: [{ name: "description", label: "Deliverable", kind: "text", required: true }, { name: "optional", label: "Optional (not required for completion)", kind: "checkbox" },
          { name: "evidence", label: "Needs evidence (a file or a reference)", kind: "checkbox" }],
        run: (values) => act("add-criterion", { description: values.description, isRequired: !values.optional, evidenceRequired: Boolean(values.evidence) }, "Deliverable added.") })}>Add deliverable</Button> : undefined}>
      {milestone.criteria.length === 0 ? <p className="text-sm text-text-muted">No deliverables yet. A milestone needs at least one before it is submitted or completed.</p> : (
        <ul className="flex flex-col gap-2">
          {milestone.criteria.map((row, index) => (
            <li key={row.id} className="flex flex-col gap-2 rounded-md border border-border p-2 sm:flex-row sm:items-start sm:justify-between">
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{`${index + 1}. ${row.description}`}</span>
                <span className="text-xs text-text-muted">{[row.required ? "Required" : "Optional", row.evidenceRequired ? "evidence required" : null].filter(Boolean).join(" · ")}</span>
                {row.status === "COMPLETED" && <span className="text-xs text-text-secondary">{`Done ${row.completedAt ? formatDateTime(row.completedAt) : ""}${row.completedBy ? ` by ${row.completedBy}` : ""}`}
                  {row.evidenceFileId && <> · <a className="text-brand underline" href={milestoneFileHref(milestone.id, row.evidenceFileId)}>{row.evidenceFile ?? "evidence"}</a></>}
                  {row.evidenceNote ? ` · ${row.evidenceNote}` : ""}</span>}
                {row.status === "WAIVED" && <span className="text-xs text-warning">{`Waived${row.waivedBy ? ` by ${row.waivedBy}` : ""}: ${row.waiverReason ?? ""}`}</span>}
              </span>
              <span className="flex flex-wrap items-center gap-1">
                <StatusBadge tone={row.status === "COMPLETED" ? "success" : row.status === "WAIVED" ? "warning" : "neutral"}>{row.status === "COMPLETED" ? "Done" : row.status === "WAIVED" ? "Waived" : "Outstanding"}</StatusBadge>
                {can.work && row.status === "PENDING" && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: `Complete: ${row.description}`, confirm: "Mark done",
                  description: row.evidenceRequired ? "Evidence is required: choose a file uploaded to this milestone (Files), give a reference, or both." : undefined,
                  fields: [{ name: "file", label: "Evidence file", kind: "select", options: evidenceOptions, initial: "" }, { name: "note", label: "Evidence reference or note", kind: "text" }],
                  run: (values) => act("complete-criterion", { criterionId: row.id, evidenceFileId: values.file || undefined, evidenceNote: values.note || undefined }, "Deliverable done.") })}>Done</Button>}
                {can.work && row.status !== "PENDING" && (row.status === "COMPLETED" || can.waive) && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Back to outstanding", confirm: "Reopen",
                  fields: [{ name: "reason", label: "Why", kind: "text" }], run: (values) => act("reopen-criterion", { criterionId: row.id, reason: values.reason || undefined }, "Deliverable reopened.") })}>Reopen</Button>}
                {can.waive && can.work && row.status === "PENDING" && row.required && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: `Waive: ${row.description}`, confirm: "Waive", tone: "danger",
                  fields: [{ name: "reason", label: "Why it is waived", kind: "textarea", required: true }], run: (values) => act("waive-criterion", { criterionId: row.id, reason: values.reason }, "Deliverable waived.") })}>Waive</Button>}
                {editable && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Change the deliverable", confirm: "Save",
                  fields: [{ name: "description", label: "Deliverable", kind: "text", required: true, initial: row.description }, { name: "optional", label: "Optional", kind: "checkbox", initial: !row.required },
                    { name: "evidence", label: "Needs evidence", kind: "checkbox", initial: row.evidenceRequired }],
                  run: (values) => act("update-criterion", { criterionId: row.id, description: values.description, isRequired: !values.optional, evidenceRequired: Boolean(values.evidence) }, "Deliverable changed.") })}>Change</Button>}
                {editable && index > 0 && <Button size="compact" variant="ghost" aria-label="Move up" onPress={() => move(index, -1)}>↑</Button>}
                {editable && index < milestone.criteria.length - 1 && <Button size="compact" variant="ghost" aria-label="Move down" onPress={() => move(index, 1)}>↓</Button>}
                {editable && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Remove the deliverable", confirm: "Remove", tone: "danger", description: row.description, fields: [],
                  run: () => act("remove-criterion", { criterionId: row.id }, "Deliverable removed.") })}>Remove</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function TasksTab({ milestone, act, setAsk }: TabProps) {
  const [assigning, setAssigning] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search);
  const workspace = useWorkspaceContext();
  const linkable = milestone.can.links && milestone.tasksTracked && milestone.status !== "SUBMITTED";
  const found = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "milestone-task-search", milestone.id, term), queryFn: () => searchMilestoneTasks(milestone.id, term), enabled: linkable });
  if (!milestone.tasksTracked || milestone.tasks === null) return <Notice tone="neutral">Project tasks are not tracked yet. Once they are, the tasks a milestone needs are linked here and counted in its readiness.</Notice>;
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Linked tasks" description={milestone.taskProgress.label}>
        <LinesTable columns={["Task", "Status", "Counts", ""]} empty={milestone.tasks.length ? undefined : "No tasks linked."}>
          {milestone.tasks.map((row) => (
            <tr key={row.linkId}>
              <Cell>{row.task ? <Link className="text-brand hover:underline" href={`/projects/tasks/${row.taskId}`}>{`${row.task.code ? `${row.task.code} ` : ""}${row.task.title}`}</Link> : "Task not found"}
                {row.disposition && <span className="block text-xs text-text-muted">{`Disposition: ${row.disposition}`}</span>}
                {row.task && !row.task.completed && !row.task.cancelled && <button type="button" className="block text-xs text-brand hover:underline" onClick={() => setAssigning(row.taskId)}>Reassign</button>}</Cell>
              <Cell>{row.task ? <StatusBadge tone={row.task.completed ? "success" : row.task.cancelled ? "neutral" : "info"}>{row.task.status}</StatusBadge> : null}</Cell>
              <Cell>{row.required ? "Required" : "Optional"}</Cell>
              <Cell>{milestone.can.links && (
                <span className="flex gap-1">
                  <Button size="compact" variant="ghost" onPress={() => act("update-task-link", { linkId: row.linkId, isRequired: !row.required }, row.required ? "Now optional." : "Now required.")}>{row.required ? "Make optional" : "Make required"}</Button>
                  {row.task?.cancelled && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "What the cancelled task means", confirm: "Save",
                    fields: [{ name: "disposition", label: "Disposition (e.g. replaced by another task, no longer needed)", kind: "text", required: true, initial: row.disposition ?? "" }],
                    run: (values) => act("update-task-link", { linkId: row.linkId, disposition: values.disposition }, "Disposition saved.") })}>Disposition</Button>}
                  <Button size="compact" variant="ghost" onPress={() => act("update-task-link", { linkId: row.linkId, remove: true }, "Task unlinked.")}>Unlink</Button>
                </span>
              )}</Cell>
            </tr>
          ))}
        </LinesTable>
      </Panel>
      {linkable && (
        <Panel title="Link a task" description="A task counts toward one milestone at a time.">
          <TextField label="Search the project's tasks" value={search} onChange={setSearch} />
          <ul className="flex flex-col gap-1">
            {(found.data?.tasks ?? []).map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{`${task.code ? `${task.code} ` : ""}${task.title}`}</span>
                <Button size="compact" variant="secondary" onPress={() => act("link-task", { taskId: task.id }, "Task linked.")}>Link</Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {assigning && <AssignTaskDialog taskId={assigning} projectId={milestone.projectId} onClose={() => setAssigning(null)} onDone={() => undefined} />}
    </div>
  );
}

function DependenciesTab({ milestone, act }: TabProps) {
  const workspace = useWorkspaceContext();
  const siblings = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "milestones", milestone.projectId), queryFn: () => getProjectMilestones(milestone.projectId), enabled: milestone.can.links });
  const [choice, setChoice] = useState<string | null>(null);
  const taken = new Set(milestone.prerequisites.map((row) => row.id));
  const options = (siblings.data?.milestones ?? []).filter((row) => row.id !== milestone.id && row.status !== "CANCELLED" && !taken.has(row.id))
    .map((row) => ({ value: row.id, label: `${row.code} ${row.name} · ${row.statusLabel.toLowerCase()} · due ${dateLabel(row.dueDate)}` }));
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Prerequisites" description="Milestones that must be completed before this one starts, is submitted or completes (finish-to-start). Loops are refused.">
        <LinesTable columns={["Milestone", "Status", "Due", ""]} empty={milestone.prerequisites.length ? undefined : "No prerequisites."}>
          {milestone.prerequisites.map((row) => (
            <tr key={row.dependencyId}>
              <Cell><Link className="text-brand hover:underline" href={`${MILESTONES_BASE}/${row.id}`}>{`${row.code} ${row.name}`}</Link></Cell>
              <Cell><StatusBadge tone={MILESTONE_TONE[row.status]}>{row.statusLabel}</StatusBadge></Cell>
              <Cell>{dateLabel(row.dueDate)}</Cell>
              <Cell>{milestone.can.links && <Button size="compact" variant="ghost" onPress={() => act("remove-dependency", { dependencyId: row.dependencyId }, "Prerequisite removed.")}>Remove</Button>}</Cell>
            </tr>
          ))}
        </LinesTable>
        {milestone.can.links && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Select label="Add a prerequisite" selectedKey={choice} onSelectionChange={(key) => setChoice(String(key))} options={options} className="sm:min-w-80" />
            <Button variant="secondary" isDisabled={!choice} onPress={async () => { await act("add-dependency", { prerequisiteId: choice }, "Prerequisite added."); setChoice(null); }}>Add</Button>
          </div>
        )}
      </Panel>
      <Panel title="Depends on this" description="Milestones that wait for this one.">
        {milestone.dependents.length === 0 ? <p className="text-sm text-text-muted">Nothing waits for this milestone.</p> : (
          <ul className="flex flex-col gap-1 text-sm">{milestone.dependents.map((row) => (
            <li key={row.dependencyId}><Link className="text-brand hover:underline" href={`${MILESTONES_BASE}/${row.id}`}>{`${row.code} ${row.name}`}</Link>{` · ${row.statusLabel}`}</li>
          ))}</ul>
        )}
      </Panel>
    </div>
  );
}

function ApprovalsTab({ milestone }: { milestone: MilestoneDetail }) {
  if (!milestone.internalApprovalRequired && !milestone.customerAcceptanceRequired && milestone.submissions.length === 0)
    return <Notice tone="neutral">This milestone needs no approval: it is completed directly once its deliverables are done.</Notice>;
  return (
    <div className="flex flex-col gap-4">
      {milestone.submissions.length === 0 && <p className="text-sm text-text-muted">Not submitted yet.</p>}
      {milestone.submissions.map((row) => {
        const snapshot = row.snapshot as { criteria?: Array<{ description: string; status: string }>; files?: Array<{ fileName: string }> };
        return (
          <Panel key={row.id} title={`Submission ${row.number}`} description={`${formatDateTime(row.submittedAt)}${row.submittedBy ? ` by ${row.submittedBy}` : ""}${row.current && !row.stale ? " · current" : row.stale ? " · superseded (the work changed after it)" : ""}`}>
            {row.note && <p className="text-sm">{row.note}</p>}
            <FactList columns={2} items={[["Deliverables submitted", (snapshot.criteria ?? []).map((item) => `${item.description} (${item.status.toLowerCase()})`).join("; ") || "—"],
              ["Files", (snapshot.files ?? []).map((item) => item.fileName).join(", ") || "—"]]} />
            {row.decisions.length === 0 ? <p className="text-sm text-text-muted">No decision yet.</p> : (
              <ul className="flex flex-col gap-2">
                {row.decisions.map((decision) => (
                  <li key={decision.id} className="rounded-md border border-border p-2 text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{decision.reviewerType === "CUSTOMER" ? `Customer${decision.customerContact ? ` · ${decision.customerContact}` : ""}` : "Internal review"}</span>
                      <StatusBadge tone={DECISION_TONE[decision.decision]}>{decision.reviewerType === "CUSTOMER" && decision.decision === "APPROVED" ? "Accepted" : DECISION_LABEL[decision.decision]}</StatusBadge>
                    </span>
                    {decision.note && <p className="text-text-secondary">{decision.note}</p>}
                    <p className="text-xs text-text-muted">{decision.reviewerType === "CUSTOMER"
                      ? `Decided ${dateLabel(decision.customerDecisionDate)}; recorded ${formatDateTime(decision.recordedAt)}${decision.recordedBy ? ` by ${decision.recordedBy}` : ""}`
                      : `${formatDateTime(decision.recordedAt)}${decision.recordedBy ? ` by ${decision.recordedBy}` : ""}`}
                      {decision.evidenceFileId && <> · <a className="text-brand underline" href={milestoneFileHref(milestone.id, decision.evidenceFileId)}>{decision.evidenceFile ?? "evidence"}</a></>}
                      {decision.evidenceReference ? ` · ${decision.evidenceReference}` : ""}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

function BillingTab({ milestone, act, setAsk, onStage }: TabProps & { onStage: () => void }) {
  const billing = milestone.billing;
  const stage = billing.stage && "salesOrderId" in billing.stage ? (billing.stage as BillingStage) : null;
  const request = billing.request;
  if (!milestone.can.viewBilling) return <Notice tone="neutral">{billing.stage ? "This milestone bills through Sales. You don't have access to its billing details." : "No billing stage."}</Notice>;
  return (
    <div className="flex flex-col gap-4">
      <Notice tone="neutral">Completing a milestone never invoices anything. Its billing is handed to Sales once, as a request; Sales reviews the details and taxes and creates the invoice.</Notice>
      <Panel title="Billing stage" description="The sales order (and, optionally, its line) this milestone bills against."
        actions={milestone.can.billingStage && !request ? <Button size="compact" variant="secondary" onPress={onStage}>{stage ? "Change" : "Choose"}</Button> : undefined}>
        {!billing.stage ? <p className="text-sm text-text-muted">{milestone.projectClassification === "CUSTOMER" ? "No billing stage chosen." : "An internal project's milestones are not billed."}</p>
          : "missing" in billing.stage ? <Notice tone="warning">The sales order is no longer available.</Notice>
          : stage && <FactList columns={2} items={[["Sales order", <Link key="so" className="text-brand hover:underline" href={stage.href}>{stage.number}</Link>],
            ["Order status", stage.status.replace(/_/g, " ")], ["Billing status", stage.billingStatus ? stage.billingStatus.replace(/_/g, " ") : "—"],
            ["Line", stage.line ? ("missing" in stage.line ? "No longer on the order" : `${stage.line.sequence}. ${stage.line.item ?? stage.line.description ?? ""}${stage.line.current ? "" : " (revised away)"}`) : "Whole order"],
            ...(billing.amountsVisible && stage.line && !("missing" in stage.line) && stage.line.amount ? [["Line value", stage.line.amount] as [string, string]] : []),
            ["Reference", stage.reference ?? "—"]]} />}
      </Panel>
      <Panel title="Billing request">
        {!request ? <p className="text-sm text-text-muted">{milestone.status === "COMPLETED" ? (stage ? "Not requested yet." : "Choose the billing stage first.") : "Requested once the milestone is complete."}</p> : (
          <>
            <FactList columns={2} items={[["Status", request.status === "OPEN" ? "With Sales (open)" : request.status === "ACKNOWLEDGED" ? "Taken up by Sales" : "Withdrawn"],
              ["Requested", request.requestedAt ? `${formatDateTime(request.requestedAt)}${request.requestedBy ? ` by ${request.requestedBy}` : ""}` : "—"],
              ["Note", request.note ?? "—"], ...(request.closedAt ? [["Closed", `${formatDateTime(request.closedAt)}${request.closedBy ? ` by ${request.closedBy}` : ""}${request.closeNote ? `: ${request.closeNote}` : ""}`] as [string, string]] : [])]} />
            <span className="flex gap-2">
              {milestone.can.billingWithdraw && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Withdraw the billing request", confirm: "Withdraw", tone: "danger",
                fields: [{ name: "note", label: "Why", kind: "textarea", required: true }], run: (values) => act("withdraw-billing", { note: values.note }, "Billing request withdrawn.") })}>Withdraw</Button>}
              {milestone.can.billingAcknowledge && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Acknowledge for Sales", confirm: "Acknowledge",
                fields: [{ name: "note", label: "Note (e.g. the invoice it went on)", kind: "text" }], run: (values) => act("acknowledge-billing", { note: values.note || undefined }, "Acknowledged.") })}>Acknowledge</Button>}
            </span>
          </>
        )}
      </Panel>
    </div>
  );
}

function FilesTab({ milestone, onChanged }: { milestone: MilestoneDetail; onChanged: (text: string) => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const files = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "milestone-files", milestone.id), queryFn: () => getMilestoneFiles(milestone.id) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const evidence = new Set([...milestone.criteria.map((row) => row.evidenceFileId), ...milestone.submissions.flatMap((row) => row.decisions.map((decision) => decision.evidenceFileId))].filter(Boolean));
  const run = async (work: () => Promise<unknown>, text: string) => {
    setBusy(true); setError(null);
    try { await work(); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); await onChanged(text); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  const mayUpload = milestone.can.evidence || milestone.can.customerAcceptance;
  return (
    <div className="flex flex-col gap-4">
      {error && <Notice tone="danger">{error}</Notice>}
      <Panel title="Files" description="Deliverables and evidence. A file used as evidence stays with the record it proves."
        actions={mayUpload ? <>
          <input ref={input} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(() => uploadMilestoneFile(milestone.id, file), `${file.name} uploaded.`); }} />
          <Button size="compact" variant="secondary" isDisabled={busy} onPress={() => input.current?.click()}>Upload</Button>
        </> : undefined}>
        <LinesTable columns={["File", "Uploaded", ""]} empty={(files.data ?? []).length ? undefined : "No files."}>
          {(files.data ?? []).map((row) => (
            <tr key={row.id}>
              <Cell><a className="text-brand hover:underline" href={milestoneFileHref(milestone.id, row.id)}>{row.fileName}</a>{evidence.has(row.id) && <span className="ml-2 text-xs text-text-muted">evidence</span>}</Cell>
              <Cell>{`${formatDateTime(row.uploadedAt)}${row.uploadedBy ? ` · ${row.uploadedBy}` : ""}`}</Cell>
              <Cell>{milestone.can.edit && !evidence.has(row.id) && <Button size="compact" variant="ghost" isDisabled={busy} onPress={() => run(() => removeMilestoneFile(milestone.id, row.id), "File removed.")}>Remove</Button>}</Cell>
            </tr>
          ))}
        </LinesTable>
      </Panel>
    </div>
  );
}

function ActivityTab({ milestone }: { milestone: MilestoneDetail }) {
  const workspace = useWorkspaceContext();
  const activity = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "milestone-activity", milestone.id, milestone.version), queryFn: () => getMilestoneActivity(milestone.id) });
  if (activity.isLoading) return <LoadingState label="Loading activity" rows={5} />;
  return <HistoryList title="History" entries={(activity.data ?? []).map((row) => ({ summary: row.summary ?? row.action.toLowerCase().replace(/_/g, " "), at: row.at, actor: row.actor,
    label: row.action.toLowerCase().replace(/_/g, " "), detail: row.from && row.to && row.from !== row.to ? `${row.from.toLowerCase().replace(/_/g, " ")} → ${row.to.toLowerCase().replace(/_/g, " ")}` : undefined }))} />;
}

// ------------------------------------------------------------------ dialogs
function useSave(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await work(); onClose(); } catch (failure) {
      const checks = (errorDetails(failure).checks as MilestoneCheck[] | undefined) ?? [];
      setError(checks.length ? `${errorMessage(failure)}` : errorMessage(failure));
    } finally { setBusy(false); }
  };
  return { busy, error, save };
}

function EditDialog({ milestone, onClose, onDone }: { milestone: MilestoneDetail; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const customer = milestone.projectClassification === "CUSTOMER";
  const contacts = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "project-contacts", milestone.projectId), queryFn: () => getProjectContacts(milestone.projectId), enabled: customer });
  const [form, setForm] = useState({ name: milestone.name, description: milestone.description ?? "", type: milestone.type, priority: milestone.priority, priorityReason: "", sequence: String(milestone.sequence),
    plannedStartDate: milestone.plannedStartDate ?? "", dueDate: milestone.dueDate, dueDateReason: "", internal: milestone.internalApprovalRequired, customer: milestone.customerAcceptanceRequired,
    contactId: milestone.customerContactId ?? "", required: milestone.requiredForCompletion, withdraw: false });
  const [key] = useState(newKey);
  const { busy, error, save } = useSave(onClose);
  const set = (name: keyof typeof form) => (value: string | boolean) => setForm((current) => ({ ...current, [name]: value }));
  const moved = form.dueDate !== milestone.dueDate;
  const contactOptions = [{ value: "", label: "Not chosen yet" }, ...(contacts.data?.contacts ?? []).filter((row) => row.active).map((row) => ({ value: row.contactId, label: `${row.name} · ${row.roleLabel}` }))];
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title={`Edit ${milestone.code}`} size="lg">
      <div className="flex flex-col gap-3">
        <TextField label="Name" value={form.name} onChange={set("name")} isRequired maxLength={200} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Type" selectedKey={form.type} onSelectionChange={(next) => set("type")(String(next))} options={Object.entries(MILESTONE_TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
          <PriorityField value={form.priority} onChange={(next) => set("priority")(next)} original={milestone.priority} reason={form.priorityReason} onReasonChange={set("priorityReason")} />
          <TextField label="Planned start" type="date" value={form.plannedStartDate} onChange={set("plannedStartDate")} />
          <TextField label="Due date" type="date" value={form.dueDate} onChange={set("dueDate")} isRequired description={`Originally ${dateLabel(milestone.originalDueDate)}; the original is kept.`} />
          <TextField label="Order" inputMode="numeric" value={form.sequence} onChange={set("sequence")} />
        </div>
        {moved && <TextArea label="Why the due date changes" value={form.dueDateReason} onChange={set("dueDateReason")} isRequired maxLength={2000} />}
        <TextArea label="Description" value={form.description} onChange={set("description")} maxLength={4000} />
        <Checkbox isSelected={form.internal} onChange={set("internal")}>Needs internal approval</Checkbox>
        {customer && <Checkbox isSelected={form.customer} onChange={set("customer")}>Needs the customer&apos;s acceptance</Checkbox>}
        {customer && form.customer && <Select label="Customer contact who accepts" selectedKey={form.contactId} onSelectionChange={(next) => set("contactId")(String(next ?? ""))} options={contactOptions} />}
        <Checkbox isSelected={form.required} onChange={set("required")}>Required for the project to be completed</Checkbox>
        {milestone.status === "SUBMITTED" && <Checkbox isSelected={form.withdraw} onChange={set("withdraw")}>Withdraw the submission to change what is reviewed</Checkbox>}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || form.name.trim().length < 2 || !form.dueDate || (moved && form.dueDateReason.trim().length < 3) || priorityReasonMissing(milestone.priority, form.priority, form.priorityReason)} onPress={() => save(async () => {
            const result = await updateMilestone(milestone.id, { expectedVersion: milestone.version, idempotencyKey: key, name: form.name, description: form.description, milestoneType: form.type,
              priority: form.priority, priorityReason: form.priorityReason.trim() || undefined, sequence: Number(form.sequence) || milestone.sequence, plannedStartDate: form.plannedStartDate || null, dueDate: form.dueDate,
              dueDateReason: moved ? form.dueDateReason : undefined, internalApprovalRequired: form.internal, customerAcceptanceRequired: customer && form.customer,
              customerContactId: customer && form.customer ? form.contactId || null : null, requiredForCompletion: form.required, withdrawSubmission: form.withdraw || undefined });
            await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") });
            await onDone(result.changed?.length ? `Saved: ${result.changed.join(", ")}.` : "Nothing changed.");
          })}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}

function OwnerDialog({ milestone, onClose, act }: { milestone: MilestoneDetail; onClose: () => void; act: Act }) {
  const workspace = useWorkspaceContext();
  const team = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "members", milestone.projectId), queryFn: () => getMembers(milestone.projectId) });
  const [owner, setOwner] = useState<string | null>(milestone.ownerId);
  const [note, setNote] = useState("");
  const { busy, error, save } = useSave(onClose);
  const options = (team.data?.members ?? []).filter((row) => row.active && ["MANAGER", "MEMBER"].includes(row.role)).map((row) => ({ value: row.userId, label: `${row.name} · ${row.roleLabel}` }));
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title="Change the owner">
      <div className="flex flex-col gap-3">
        {team.isLoading ? <LoadingState label="Loading the team" rows={2} /> : <Select label="Owner" selectedKey={owner} onSelectionChange={(next) => setOwner(String(next))} options={options}
          description="The Project Manager or a member who works on the project." />}
        <TextField label="Note" value={note} onChange={setNote} />
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || !owner || owner === milestone.ownerId} onPress={() => save(() => act("assign", { ownerUserId: owner, note: note || undefined }, "Owner changed: they were told."))}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}

function CustomerDecisionDialog({ milestone, onClose, act }: { milestone: MilestoneDetail; onClose: () => void; act: Act }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const contacts = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "project-contacts", milestone.projectId), queryFn: () => getProjectContacts(milestone.projectId) });
  const [form, setForm] = useState({ contactId: milestone.customerContactId ?? "", decision: "APPROVED", date: "", fileId: "", reference: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const files = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "milestone-files", milestone.id), queryFn: () => getMilestoneFiles(milestone.id) });
  const set = (name: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [name]: value }));
  const contactOptions = (contacts.data?.contacts ?? []).filter((row) => row.active).map((row) => ({ value: row.contactId, label: `${row.name} · ${row.roleLabel}` }));
  // The customer's person who decided, added here when not yet on the project (Create-Where-You-Are PJ2): a new customer contact,
  // linked to the project as its approval contact.
  const project = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "project", milestone.projectId), queryFn: () => getProject(milestone.projectId) });
  const customerId = project.data?.customerId ?? null;
  const newContact = useQuickCreate("customerContact", {
    prefill: { partyId: customerId ?? undefined, partyName: project.data?.customer ?? undefined },
    onCreated: (record) => {
      void addProjectContact(milestone.projectId, { contactId: record.id, role: "APPROVAL" })
        .then(() => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects", "project-contacts", milestone.projectId) }))
        .then(() => set("contactId")(record.id))
        .catch((failure) => setError(errorMessage(failure)));
    },
  });
  const fileOptions = [{ value: "", label: "No file" }, ...(files.data ?? []).map((row) => ({ value: row.id, label: row.fileName }))];
  const ready = Boolean(form.contactId) && Boolean(form.date) && (Boolean(form.fileId) || form.reference.trim().length >= 3) && (form.decision === "APPROVED" || form.note.trim().length >= 3);
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title="Record the customer's decision" size="lg">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">Record what the customer decided, from the evidence they sent (a signed document, an email). This records an external decision; it does not sign on the customer&apos;s behalf.</p>
        <Select label="Who decided" selectedKey={form.contactId || null} onSelectionChange={(next) => set("contactId")(String(next))} options={contactOptions} isRequired
          description={contactOptions.length ? "One of the project's customer contacts." : "No customer contact on this project yet."} />
        {customerId && newContact.canCreate && (
          <Button variant="outline" size="compact" className="w-fit" onPress={() => newContact.open("")}>Add a customer contact</Button>
        )}
        {newContact.drawer}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Decision" selectedKey={form.decision} onSelectionChange={(next) => set("decision")(String(next))}
            options={[{ value: "APPROVED", label: "Accepted" }, { value: "CHANGES_REQUESTED", label: "Asked for changes" }, { value: "REJECTED", label: "Rejected" }]} />
          <TextField label="Decided on" type="date" value={form.date} onChange={set("date")} isRequired description="Not before the submission, not in the future." />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Select label="Evidence file" selectedKey={form.fileId} onSelectionChange={(next) => set("fileId")(String(next ?? ""))} options={fileOptions} className="sm:min-w-72" />
          <input ref={input} type="file" className="hidden" onChange={async (event) => {
            const file = event.target.files?.[0]; event.target.value = "";
            if (!file) return;
            try { const stored = await uploadMilestoneFile(milestone.id, file); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects", "milestone-files", milestone.id) }); set("fileId")(stored.id); }
            catch (failure) { setError(errorMessage(failure)); }
          }} />
          <Button variant="secondary" onPress={() => input.current?.click()}>Upload the sign-off</Button>
        </div>
        <TextField label="Evidence reference" value={form.reference} onChange={set("reference")} description="E.g. the email's subject and date. Needed when no file is attached." />
        <TextArea label={form.decision === "APPROVED" ? "Note" : "What the customer asked to change"} value={form.note} onChange={set("note")} maxLength={2000} isRequired={form.decision !== "APPROVED"} />
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || !ready} onPress={async () => {
            setBusy(true); setError(null);
            try {
              await act("customer-acceptance", { customerContactId: form.contactId, decision: form.decision, decisionDate: form.date, evidenceFileId: form.fileId || undefined,
                evidenceReference: form.reference || undefined, note: form.note || undefined }, form.decision === "APPROVED" ? "The customer's acceptance is recorded." : "The customer's decision is recorded: back to the owner.");
              onClose();
            } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
          }}>Record</Button>
        </div>
      </div>
    </Dialog>
  );
}

function BillingStageDialog({ milestone, onClose, act }: { milestone: MilestoneDetail; onClose: () => void; act: Act }) {
  const workspace = useWorkspaceContext();
  const links = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "links", milestone.projectId), queryFn: () => getLinks(milestone.projectId) });
  const current = milestone.billing.stage && "salesOrderId" in milestone.billing.stage ? (milestone.billing.stage as BillingStage) : null;
  const [order, setOrder] = useState<string>(current?.salesOrderId ?? "");
  const [reference, setReference] = useState(current?.reference ?? "");
  const { busy, error, save } = useSave(onClose);
  const orders = [...new Map((links.data?.links ?? []).filter((row) => row.sourceType === "SALES_ORDER")
    .map((row) => [row.sourceId, "number" in row.record ? `${row.record.number ?? "Sales order"}${row.record.status ? ` · ${row.record.status.replace(/_/g, " ")}` : ""}` : "Sales order"] as const)).entries()]
    .map(([value, label]) => ({ value, label }));
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title="Billing stage">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">The confirmed sales order of the project&apos;s customer this milestone bills against. Link the order to the project first (Related tab).</p>
        {links.isLoading ? <LoadingState label="Loading the project's sales orders" rows={2} /> : orders.length === 0 ? <Notice tone="warning">No sales order is linked to the project.</Notice>
          : <Select label="Sales order" selectedKey={order || null} onSelectionChange={(next) => setOrder(String(next))} options={orders} />}
        <TextField label="Billing stage" value={reference} onChange={setReference} description="How Sales knows it — e.g. 30% on design sign-off." />
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          {current && <Button variant="ghost" isDisabled={busy} onPress={() => save(() => act("billing-stage", { salesOrderId: null }, "Billing stage removed."))}>Remove</Button>}
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || !order} onPress={() => save(() => act("billing-stage", { salesOrderId: order, reference: reference || undefined }, "Billing stage saved."))}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}

"use client";

// One project's workspace: who leads it, where it stands, whether it is on track (with the reasons) and the next step; then its team, its
// documents and notes, the records other modules hold for it, its customer and the customer's people (a customer project), and its history. The toolbar offers only what the project's state and the
// person's access allow; every action is checked again on the server.
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, LinkButton, PermissionState, RecordDetailsPage, StatusBadge, Tab, TabList, Tabs } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { FactList, HistoryList, MoreActions, type MoreAction } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import {
  HEALTH_TONE, PRIORITY_LABEL, PROJECTS_BASE, STATUS_TONE, dateLabel, errorDetails, errorMessage, errorStatus,
  getProject, getSummary, newKey, projectAction, type Project,
} from "../api/projects-api";
import { HoldPanel, StatusPanel, StatusTimeline, useStatusActions } from "../status/StatusPanels";
import { ProjectFinancialsWorkspace } from "../financials/FinancialsWorkspace";
import { BillingPolicyPanel } from "../billable/BillingPanels";
import { ProjectTimeTab } from "../timesheets/ProjectTimeTab";
import { CustomerTab } from "../components/CustomerTab";
import { MilestonesTab } from "../components/MilestonesTab";
import { TasksTab } from "../components/TasksTab";
import { DocumentsTab, RelatedTab, TeamTab } from "../components/ProjectTabs";
import { getTimeline } from "../collaboration/collaboration-api";
import { ProjectProgress } from "../progress/ProgressViews";
import { ProjectExpensesPanel } from "../expenses/ExpenseScreens";
import { CommentThread, CommentsTabLabel } from "../collaboration/CommentThread";
import { PriorityBadge, PriorityDialog } from "../priority/Priority";

// The project workspace: ten tabs. The customer, its contacts and sales links and the billing method live in Settings; linked records with the
// files in Documents; the project's conversation in Discussions. Older links (?tab=customer, comments, related) open their new home.
const TABS = [{ id: "overview", label: "Overview" }, { id: "tasks", label: "Tasks" }, { id: "milestones", label: "Milestones" }, { id: "team", label: "Team" }, { id: "time", label: "Time & Expenses" },
  { id: "financials", label: "Financials" }, { id: "documents", label: "Documents" }, { id: "discussions", label: "Discussions" }, { id: "activity", label: "Activity" }, { id: "settings", label: "Settings" }];
const MOVED: Record<string, string> = { customer: "settings", comments: "discussions", related: "documents" };

// Until the project loads, the status controls have nothing to offer.
const EMPTY_PROJECT = { id: "", code: "", version: 0, statusActions: [] } as unknown as Project;

export function ProjectDetailScreen({ projectId }: { projectId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "project", projectId), queryFn: () => getProject(projectId), retry: false });
  const requested = MOVED[params.get("tab") ?? ""] ?? params.get("tab");
  const [tab, setTab] = useState(TABS.some((row) => row.id === requested) ? requested! : "overview");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [dialog, setDialog] = useState<"priority" | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const refresh = async (text: string, tone: "success" | "warning" = "success") => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); setMessage({ tone, text }); };
  const status = useStatusActions(query.data ?? EMPTY_PROJECT, refresh);
  if (query.isLoading) return <LoadingState label="Loading the project" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to projects" description="Ask an administrator for access." />;
    return <ErrorState title="Project not found" description={errorStatus(query.error) === 404 ? "It does not exist, was removed, or you are not on it." : errorMessage(query.error)}
      action={{ label: "All projects", onPress: () => router.push(`${PROJECTS_BASE}/all`) }} />;
  }
  const project = query.data;
  const can = project.can;
  const tabs = TABS;
  const act = (action: string, input: Record<string, unknown>, text: string) => projectAction(project.id, action, { expectedVersion: project.version, idempotencyKey: newKey(), ...input })
    .then(async (result) => { await refresh(result.approval === "PENDING" ? "Sent for approval: someone who approves projects decides." : text); return result; });
  const runNow = async (action: string, input: Record<string, unknown>, text: string) => {
    try { await act(action, input, text); } catch (failure) {
      const problems = (errorDetails(failure).problems as Array<{ message: string }> | undefined) ?? [];
      setMessage({ tone: "danger", text: problems.length ? `${errorMessage(failure)} ${problems.slice(1).map((row) => row.message).join(" ")}` : errorMessage(failure) });
    }
  };
  const selectTab = (id: string) => { const next = MOVED[id] ?? id; setTab(next); router.replace(`${pathname}?tab=${next}`, { scroll: false }); };
  const primary = project.approval.mayDecide ? <Button variant="primary" onPress={() => setAsk({ title: `Approve ${project.code}`, confirm: "Approve", fields: [{ name: "note", label: "Note", kind: "textarea" }],
      run: (values) => act("decide", { decision: "APPROVE", note: values.note || undefined }, "Approved: the project is planned.") })}>Approve</Button>
    : status.primary ?? (can.restore ? <Button variant="primary" onPress={() => runNow("restore", {}, "Restored from the archive.")}>Restore</Button> : undefined);
  const more: MoreAction[] = [
    ...status.menu,
    { id: "priority", label: "Change priority", show: can.edit && !["COMPLETED", "CANCELLED"].includes(project.status) && !project.archived, run: () => setDialog("priority") },
    { id: "reject", label: "Return without approval", show: project.approval.mayDecide, run: () => setAsk({ title: `Return ${project.code}`, confirm: "Return", fields: [{ name: "note", label: "Why", kind: "textarea", required: true }],
      run: (values) => act("decide", { decision: "REJECT", note: values.note }, "Returned to the requester.") }) },
    { id: "risk", label: project.risk.flagged ? "Clear the delivery risk" : "Flag a delivery risk", show: can.edit && !["DRAFT"].includes(project.status), run: () => setAsk(project.risk.flagged
      ? { title: "Clear the delivery risk", confirm: "Clear", fields: [{ name: "note", label: "What changed", kind: "textarea" }], run: (values) => act("risk", { flagged: false, note: values.note || undefined }, "Delivery risk cleared.") }
      : { title: "Flag a delivery risk", confirm: "Flag", description: "Shown in the project's health, with your note, until cleared.", fields: [{ name: "note", label: "The risk", kind: "textarea", required: true }],
        run: (values) => act("risk", { flagged: true, note: values.note }, "Delivery risk flagged.") }) },
    { id: "health", label: "Explain the health", show: (can.edit || project.role === "MANAGER") && ["AT_RISK", "BLOCKED"].includes(project.health.state), run: () => setAsk({ title: "Explain the health warning",
      confirm: "Save", description: "Shown beside the warning; it never hides the reasons.", fields: [{ name: "note", label: "Explanation", kind: "textarea", required: true }],
      run: (values) => act("health-note", { note: values.note }, "Explanation saved.") }) },
    { id: "archive", label: "Archive", show: can.archive, run: () => setAsk({ title: `Archive ${project.code}`, confirm: "Archive", description: "Hidden from the everyday lists; everything is kept and still found under Archived.",
      fields: [], run: () => act("archive", {}, "Archived.") }) },
    // A draft no longer needed is discarded, never cancelled; its notes, links and files stay with it.
    { id: "delete", label: "Discard this draft", show: can.delete, run: () => setAsk({ title: `Discard ${project.code}`, confirm: "Discard", tone: "danger",
      description: "The draft leaves the project lists. A draft with links, notes or files says why; they stay with it.", fields: [{ name: "reason", label: "Why", kind: "textarea" }],
      run: async (values) => { await projectAction(project.id, "delete", { reason: values.reason || undefined }); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); router.replace(`${PROJECTS_BASE}/all`); } }) },
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
            { label: "Priority", value: <PriorityBadge priority={project.priority} /> },
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
            <HoldPanel project={project} onChanged={refresh} />
            {project.approval.status === "PENDING" && <Notice tone="info">{`Waiting for approval${project.approval.requestedBy ? ` — requested by ${project.approval.requestedBy}` : ""}.`}</Notice>}
            {project.approval.status === "REJECTED" && project.status === "DRAFT" && <Notice tone="warning">{`Not approved: ${project.approval.note ?? ""} Change the project and request approval again.`}</Notice>}
            {!project.managerActive && project.status !== "COMPLETED" && project.status !== "CANCELLED" && <Notice tone="danger">The Project Manager is no longer active. Assign a replacement so the project stays accountable.</Notice>}
            {project.activation && !project.activation.ready && <Notice tone="neutral">{`Before activation: ${project.activation.problems.map((row) => row.message).join(" ")}`}</Notice>}
            {project.customerReview && <Notice tone="warning">{`Commercial review needed: ${project.customerReview.reason}`} <button type="button" className="text-brand underline" onClick={() => selectTab("settings")}>Review</button></Notice>}
          </div>
        }
      >
        <Tabs selectedKey={tab} onSelectionChange={(key) => selectTab(String(key))}>
          <TabList aria-label="Project sections">{tabs.map((row) => <Tab key={row.id} id={row.id}>{row.id === "discussions" ? <CommentsTabLabel parentType="PROJECT" parentId={project.id} /> : row.label}</Tab>)}</TabList>
        </Tabs>
        <div className="mt-4">
          {tab === "overview" && <OverviewTab project={project} onTab={selectTab} onStatusAction={status.openAction} />}
          {tab === "tasks" && <TasksTab project={project} />}
          {tab === "milestones" && <MilestonesTab project={project} />}
          {tab === "team" && <TeamTab project={project} onChanged={refresh} />}
          {tab === "time" && <div className="flex flex-col gap-4"><ProjectTimeTab project={project} /><ProjectExpensesPanel projectId={project.id} /></div>}
          {tab === "financials" && <ProjectFinancialsWorkspace project={project} />}
          {tab === "documents" && <div className="flex flex-col gap-4"><DocumentsTab project={project} /><RelatedTab project={project} /></div>}
          {tab === "discussions" && <CommentThread parentType="PROJECT" parentId={project.id} />}
          {tab === "activity" && <ActivityTab project={project} />}
          {tab === "settings" && <SettingsTab project={project} onChanged={refresh} onTab={selectTab} />}
        </div>
      </RecordDetailsPage>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
      {dialog === "priority" && <PriorityDialog target={{ kind: "project", id: project.id, code: project.code, name: project.name ?? project.code, priority: project.priority, version: project.version }}
        onClose={() => setDialog(null)} onDone={(text) => refresh(text)} />}
      {status.dialog}
    </>
  );
}

function OverviewTab({ project, onTab, onStatusAction }: { project: Project; onTab: (tab: string) => void; onStatusAction: Parameters<typeof StatusPanel>[0]["onAction"] }) {
  const workspace = useWorkspaceContext();
  const summary = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "summary", project.id), queryFn: () => getSummary(project.id) });
  return (
    <div className="flex flex-col gap-4">
      {/* Progress Tracking: task completion, required milestones, schedule, health with its reasons, the trend and what changed. */}
      <ProjectProgress projectId={project.id} onTab={onTab} healthNote={<>
        {project.health.note && <p className="text-sm text-text-secondary">{`Explanation${project.health.noteBy ? ` by ${project.health.noteBy}` : ""}: ${project.health.note.text}`}</p>}
        {project.risk.flagged && <Notice tone="warning">{`Delivery risk: ${project.risk.note ?? ""}`}</Notice>}
      </>} />
      <StatusPanel project={project} onAction={onStatusAction} />
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

// The project's settings: its details (edited on the Edit page), the customer with its contacts and sales links (a customer project), and the
// billing method. Status changes, archiving and discarding stay in the header's actions, under the status rules.
function SettingsTab({ project, onChanged, onTab }: { project: Project; onChanged: (text: string) => Promise<void>; onTab: (tab: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Project details" description="Name, type, manager, dates, description and tags. Status actions (start, hold, complete, cancel, reopen, archive) are in the header."
        actions={project.can.edit ? <LinkButton size="compact" variant="secondary" href={`${PROJECTS_BASE}/${project.id}/edit`}>Edit details</LinkButton> : undefined}>
        <FactList title="Details" items={[["Code", project.code], ["Type", project.type ?? "Not set"], ["Project Manager", project.manager ?? "Not assigned"], ["Planned", `${dateLabel(project.plannedStartDate)} – ${dateLabel(project.targetEndDate)}`]]} />
      </Panel>
      {project.classification === "CUSTOMER" && <CustomerTab project={project} onChanged={onChanged} onTab={onTab} />}
      {project.classification === "CUSTOMER" && <BillingPolicyPanel project={project} />}
      <Panel title="Team and access" actions={<Button size="compact" variant="ghost" onPress={() => onTab("team")}>Open Team</Button>}>
        <p className="text-sm text-text-secondary">Who is on the project and their project role; a project role never goes beyond the person&apos;s company role.</p>
      </Panel>
    </div>
  );
}

function ActivityTab({ project }: { project: Project }) {
  const workspace = useWorkspaceContext();
  // Recorded activity and the conversation, told apart by their source; restricted comments only for those who may read them.
  const activity = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "timeline", project.id), queryFn: () => getTimeline(project.id) });
  if (activity.isLoading) return <LoadingState label="Loading activity" rows={5} />;
  return (
    <div className="flex flex-col gap-4">
      <HistoryList title="Activity" entries={(activity.data ?? []).map((row) => ({
        summary: row.href ? <Link className="hover:underline" href={row.href}>{row.summary}</Link> : row.summary ?? row.action.toLowerCase().replace(/_/g, " "), at: row.at, actor: row.actor,
        label: row.source === "COMMENT" ? (row.restricted ? "Comment · restricted" : "Comment") : row.action.toLowerCase().replace(/_/g, " ") }))} />
      <StatusTimeline project={project} />
    </div>
  );
}

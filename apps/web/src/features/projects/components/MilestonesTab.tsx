"use client";

// The project workspace's Milestones tab: the project's checkpoints in order — who owns each, when it is due (and whether it moved), where it
// stands, what approval it waits for and how much of its deliverables are done — as a list or a timeline, and adding one (its owner, target
// date, deliverables and prerequisites). Everything else about a milestone happens on its own page.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, LinkButton, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { useSubmitKey } from "@/shared/http/submit-once";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  APPROVAL_TONE, MILESTONES_BASE, MILESTONE_TONE, MILESTONE_TYPE_LABEL, PRIORITY_LABEL, createMilestone, dateLabel, dueLabel, errorDetails, errorMessage, getMembers, getOptions,
  getProjectContacts, getProjectMilestones, milestoneExportHref, newKey, type MilestoneRow, type Project, type ProjectMilestones,
} from "../api/projects-api";

export function MilestonesTab({ project }: { project: Project }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "milestones", project.id), queryFn: () => getProjectMilestones(project.id), retry: false });
  const [view, setView] = useState<"list" | "timeline">("list");
  const [adding, setAdding] = useState(false);
  if (query.isLoading) return <LoadingState label="Loading milestones" rows={5} />;
  if (query.isError || !query.data) return <Notice tone="danger">{errorMessage(query.error)}</Notice>;
  const data = query.data;
  const rows = data.milestones;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {([["Milestones", data.summary.total], ["Completed", data.summary.completed], ["Overdue", data.summary.overdue], ["Blocked", data.summary.blocked], ["Awaiting review", data.summary.pendingApproval]] as const).map(([label, value]) => (
          <div key={label} className="rounded-md border border-border bg-surface p-3"><p className="text-xs text-text-muted">{label}</p><p className="text-lg font-semibold">{value}</p></div>
        ))}
      </div>
      {!data.tasksTracked && <Notice tone="neutral">Project tasks are not tracked yet, so milestones do not wait for tasks. Deliverables, prerequisites, blockers and approvals still apply.</Notice>}
      <Panel title="Milestones" description="Checkpoints the project must reach, in order. Open one to work on its deliverables, submit it for review or complete it."
        actions={
          <span className="flex flex-wrap gap-2">
            <Select aria-label="View" size="compact" selectedKey={view} onSelectionChange={(key) => setView(key === "timeline" ? "timeline" : "list")}
              options={[{ value: "list", label: "List" }, { value: "timeline", label: "Timeline" }]} />
            {data.can.export && rows.length > 0 && <LinkButton size="compact" variant="ghost" href={milestoneExportHref({ projectId: project.id })}>Export</LinkButton>}
            {data.can.create && <Button size="compact" variant="primary" onPress={() => setAdding(true)}>Add milestone</Button>}
          </span>
        }>
        {rows.length === 0 ? <p className="text-sm text-text-muted">{data.can.create ? "No milestones yet. Add the checkpoints this project must reach — each with an owner, a target date and its deliverables." : "No milestones yet."}</p>
          : view === "list" ? <MilestoneTable rows={rows} /> : <Timeline data={data} />}
      </Panel>
      {adding && <AddMilestoneDialog project={project} existing={rows} onClose={() => setAdding(false)} />}
    </div>
  );
}

function DueCell({ row }: { row: MilestoneRow }) {
  const due = dueLabel(row);
  return (
    <span className="flex flex-col">
      <span className="whitespace-nowrap">{dateLabel(row.dueDate)}</span>
      {row.rescheduled && <span className="text-xs text-text-muted">{`was ${dateLabel(row.originalDueDate)}`}</span>}
      {due && <span className={row.overdue ? "text-xs text-danger" : "text-xs text-text-muted"}>{due}</span>}
    </span>
  );
}

function MilestoneTable({ rows }: { rows: MilestoneRow[] }) {
  return (
    <LinesTable columns={["#", "Milestone", "Owner", "Due", "Status", "Approval", "Deliverables"]}>
      {rows.map((row) => (
        <tr key={row.id} className={row.status === "CANCELLED" ? "opacity-60" : undefined}>
          <Cell>{row.sequence}</Cell>
          <Cell>
            <span className="flex flex-col">
              <Link className="font-medium text-brand hover:underline" href={`${MILESTONES_BASE}/${row.id}`}>{row.name}</Link>
              <span className="text-xs text-text-muted">{`${row.code} · ${row.typeLabel}${row.requiredForCompletion ? (row.waived ? " · waived for completion" : " · required") : " · optional"}${row.openBlockers ? ` · ${row.openBlockers} blocker(s)` : ""}`}</span>
            </span>
          </Cell>
          <Cell>{row.owner}</Cell>
          <Cell><DueCell row={row} /></Cell>
          <Cell><StatusBadge tone={MILESTONE_TONE[row.status]}>{row.statusLabel}</StatusBadge></Cell>
          <Cell>{row.approvalStatus === "NOT_REQUIRED" ? <span className="text-text-muted">None</span> : <StatusBadge tone={APPROVAL_TONE[row.approvalStatus]}>{row.approvalLabel}</StatusBadge>}</Cell>
          <Cell>{row.criteria && row.criteria.total ? `${row.criteria.done} of ${row.criteria.total}` : "None yet"}</Cell>
        </tr>
      ))}
    </LinesTable>
  );
}

// The milestones on a line by due date, between the project's start and target, with what each waits for.
function Timeline({ data }: { data: ProjectMilestones }) {
  const rows = data.milestones.filter((row) => row.status !== "CANCELLED").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const codes = new Map(data.milestones.map((row) => [row.id, row.code]));
  return (
    <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
      {data.plannedStartDate && <li className="text-xs text-text-muted">{`Project start · ${dateLabel(data.plannedStartDate)}`}</li>}
      {rows.map((row) => (
        <li key={row.id} className="relative">
          <span className={`absolute -left-[21px] top-1.5 size-2.5 rounded-full ${row.status === "COMPLETED" ? "bg-success" : row.overdue ? "bg-danger" : row.status === "BLOCKED" ? "bg-warning" : "bg-border-strong"}`} />
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium tabular-nums">{dateLabel(row.dueDate)}</span>
            <Link className="text-sm text-brand hover:underline" href={`${MILESTONES_BASE}/${row.id}`}>{`${row.code} ${row.name}`}</Link>
            <StatusBadge tone={MILESTONE_TONE[row.status]}>{row.statusLabel}</StatusBadge>
          </span>
          <span className="block text-xs text-text-muted">{[row.owner, row.rescheduled ? `moved from ${dateLabel(row.originalDueDate)}` : null,
            row.prerequisiteIds?.length ? `after ${row.prerequisiteIds.map((id) => codes.get(id) ?? "?").join(", ")}` : null, dueLabel(row)].filter(Boolean).join(" · ")}</span>
        </li>
      ))}
      {data.targetEndDate && <li className="text-xs text-text-muted">{`Project target · ${dateLabel(data.targetEndDate)}`}</li>}
    </ol>
  );
}

function AddMilestoneDialog({ project, existing, onClose }: { project: Project; existing: MilestoneRow[]; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const submit = useSubmitKey();
  const team = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "members", project.id), queryFn: () => getMembers(project.id) });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "options"), queryFn: getOptions, staleTime: 60_000 });
  const customer = project.classification === "CUSTOMER";
  const contacts = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "project-contacts", project.id), queryFn: () => getProjectContacts(project.id), enabled: customer });
  const internalDefault = options.data?.settings.milestoneInternalApprovalDefault ?? true;
  const [form, setForm] = useState({ name: "", type: "DELIVERABLE", ownerUserId: project.managerId ?? "", dueDate: "", plannedStartDate: "", priority: "NORMAL", description: "",
    criteria: "", evidence: false, required: true, customerAcceptance: false, customerContactId: "" });
  const [internal, setInternal] = useState<boolean | null>(null);
  const [prerequisites, setPrerequisites] = useState<string[]>([]);
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const set = (key: keyof typeof form) => (value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const owners = [...new Map([...(project.managerId ? [[project.managerId, project.manager ?? "Project Manager"] as const] : []),
    ...(team.data?.members ?? []).filter((row) => row.active && ["MANAGER", "MEMBER"].includes(row.role)).map((row) => [row.userId, row.name] as const)]).entries()]
    .map(([value, label]) => ({ value, label }));
  const contactOptions = (contacts.data?.contacts ?? []).filter((row) => row.active).map((row) => ({ value: row.contactId, label: `${row.name} · ${row.roleLabel}` }));
  const criteria = form.criteria.split("\n").map((line) => line.trim()).filter(Boolean);
  const ready = form.name.trim().length >= 2 && Boolean(form.ownerUserId) && Boolean(form.dueDate) && !busy && !done;
  const open = existing.filter((row) => row.status !== "CANCELLED");
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title="Add milestone" size="lg">
      <div className="flex flex-col gap-3">
        <TextField label="Name" value={form.name} onChange={set("name")} isRequired maxLength={200} description="What is reached — e.g. Design approved, Site survey complete." />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Owner" selectedKey={form.ownerUserId || null} onSelectionChange={(key) => set("ownerUserId")(String(key))} options={owners} isRequired
            description="Accountable for reaching it: the Project Manager or a project member." />
          <Select label="Type" selectedKey={form.type} onSelectionChange={(key) => set("type")(String(key))} options={Object.entries(MILESTONE_TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
          <TextField label="Target date" type="date" value={form.dueDate} onChange={set("dueDate")} isRequired
            description={project.targetEndDate ? `On or before the project's target (${dateLabel(project.targetEndDate)}).` : undefined} />
          <TextField label="Planned start" type="date" value={form.plannedStartDate} onChange={set("plannedStartDate")} />
          <Select label="Priority" selectedKey={form.priority} onSelectionChange={(key) => set("priority")(String(key))} options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))} />
        </div>
        <TextArea label="Description" value={form.description} onChange={set("description")} maxLength={4000} />
        <TextArea label="Deliverables (one per line)" value={form.criteria} onChange={set("criteria")} maxLength={10000}
          description="The completion criteria. Each must be done (or waived) before the milestone is submitted or completed." />
        {criteria.length > 0 && <Checkbox isSelected={form.evidence} onChange={set("evidence")}>Each deliverable needs evidence (a file or a reference)</Checkbox>}
        {open.length > 0 && (
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">Prerequisites</legend>
            <p className="text-xs text-text-muted">Milestones that must be completed before this one starts.</p>
            {open.map((row) => (
              <Checkbox key={row.id} isSelected={prerequisites.includes(row.id)} onChange={(on) => setPrerequisites((current) => (on ? [...current, row.id] : current.filter((id) => id !== row.id)))}>
                {`${row.code} ${row.name} (due ${dateLabel(row.dueDate)})`}
              </Checkbox>
            ))}
          </fieldset>
        )}
        <Checkbox isSelected={internal ?? internalDefault} onChange={setInternal}>Needs internal approval before it is completed</Checkbox>
        {customer && <Checkbox isSelected={form.customerAcceptance} onChange={set("customerAcceptance")}>Needs the customer&apos;s acceptance (recorded from the evidence they send)</Checkbox>}
        {customer && form.customerAcceptance && (
          contactOptions.length ? <Select label="Customer contact who accepts" selectedKey={form.customerContactId || null} onSelectionChange={(key) => set("customerContactId")(String(key))} options={contactOptions}
            description="Can be chosen later, before submission." />
            : <Notice tone="warning">The project has no customer contacts yet. Add one on the Customer &amp; Contacts tab before submitting this milestone.</Notice>
        )}
        <Checkbox isSelected={form.required} onChange={set("required")}>Required for the project to be completed</Checkbox>
        {error && <Notice tone="danger">{error.text}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={!ready} onPress={async () => {
            setBusy(true); setError(null);
            try {
              const result = await submit.run(() => createMilestone(project.id, {
                idempotencyKey: key, name: form.name, milestoneType: form.type, ownerUserId: form.ownerUserId, dueDate: form.dueDate, plannedStartDate: form.plannedStartDate || undefined,
                priority: form.priority, description: form.description || undefined, requiredForCompletion: form.required, internalApprovalRequired: internal ?? internalDefault,
                customerAcceptanceRequired: customer && form.customerAcceptance, customerContactId: customer && form.customerAcceptance && form.customerContactId ? form.customerContactId : undefined,
                criteria: criteria.map((description) => ({ description, evidenceRequired: form.evidence })), prerequisiteIds: prerequisites,
              }));
              setDone(true);
              await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") });
              router.push(`${MILESTONES_BASE}/${result.milestoneId}`);
            } catch (failure) {
              setError({ text: errorMessage(failure), field: (errorDetails(failure).field as string | undefined) ?? undefined });
            } finally { setBusy(false); }
          }}>Add milestone</Button>
        </div>
      </div>
    </Dialog>
  );
}

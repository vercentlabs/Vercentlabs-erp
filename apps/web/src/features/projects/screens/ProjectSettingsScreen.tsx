"use client";

// Project settings: the company's project policy (activation approval, the due-soon window, customer acceptance at completion), the project
// types, and the project roles (fixed: a project role refines, never exceeds, a person's company role). Templates come with their own feature.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ErrorState, PageHeader, PermissionState, StatusBadge, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import { errorMessage, errorStatus, getSettings, saveSettings, saveType } from "../api/projects-api";
import { BillingSettingsPanel } from "../billable/BillableReports";
import { TimeSettingsPanel } from "../timesheets/TimeReports";
import { CommentSettingsPanel } from "../collaboration/DiscussionScreens";
import { ProgressSettingsPanel } from "../progress/ProgressViews";
import { ExpenseSettingsPanel } from "../expenses/ExpenseScreens";
import { OverheadPolicyPanel } from "../costing/ProjectCost";

const ROLE_HELP: Record<string, string> = { MANAGER: "Leads the project: scope, team, dates and lifecycle.", MEMBER: "Works on the project; adds updates, notes and files.",
  VIEWER: "Reads the project.", FINANCIAL_VIEWER: "Reads the project and the amounts on its linked commercial records." };

export function ProjectSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "settings"), queryFn: getSettings });
  const [days, setDays] = useState<string | null>(null);
  const [reminder, setReminder] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (query.isLoading) return <LoadingState label="Loading settings" rows={5} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to project settings" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load settings" description={errorMessage(query.error)} />;
  }
  const { settings, types, roles, can } = query.data;
  const run = async (work: () => Promise<unknown>, text: string) => {
    setBusy(true); setMessage(null);
    try { await work(); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); setMessage({ tone: "success", text }); }
    catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
  };
  const typeAsk = (type?: { id: string; name: string; description: string | null; status: string }): Ask => ({
    title: type ? `Edit ${type.name}` : "New project type", confirm: type ? "Save" : "Create",
    fields: [{ name: "name", label: "Name", kind: "text", required: true, initial: type?.name ?? "" }, { name: "description", label: "Description", kind: "textarea", initial: type?.description ?? "" }],
    run: async (values) => { await saveType({ id: type?.id, name: values.name, description: values.description || null, status: type?.status }); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") });
      setMessage({ tone: "success", text: type ? "Project type saved." : "Project type created." }); },
  });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Project Settings" description="How projects are run in your company." />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <TimeSettingsPanel />
      <BillingSettingsPanel />
      <CommentSettingsPanel />
      <ProgressSettingsPanel />
      <ExpenseSettingsPanel />
      <OverheadPolicyPanel />
      <Panel title="Policy">
        <Checkbox isDisabled={!can.manage || busy} isSelected={settings.activationApprovalRequired} onChange={(value) => run(() => saveSettings({ activationApprovalRequired: value }), value ? "Activation now needs approval." : "Projects activate without approval.")}>
          A draft is approved before it is activated</Checkbox>
        {settings.activationApprovalRequired && <Checkbox isDisabled={!can.manage || busy} isSelected={settings.selfApprovalAllowed}
          onChange={(value) => run(() => saveSettings({ selfApprovalAllowed: value }), value ? "Requesters may approve their own projects." : "Someone other than the requester approves.")}>The requester may approve their own project</Checkbox>}
        <Checkbox isDisabled={!can.manage || busy} isSelected={settings.customerAcceptanceRequired} onChange={(value) => run(() => saveSettings({ customerAcceptanceRequired: value }), value ? "Customer projects record the customer's acceptance at completion." : "Customer acceptance is optional.")}>
          A customer project records the customer&apos;s acceptance when it is completed</Checkbox>
        <Checkbox isDisabled={!can.manage || busy} isSelected={settings.customerChangeApprovalRequired} onChange={(value) => run(() => saveSettings({ customerChangeApprovalRequired: value }), value ? "A planned project's customer change needs approval." : "A planned project's customer changes after review, without approval.")}>
          A planned project&apos;s customer change is approved by someone else (a running or held project&apos;s always is)</Checkbox>
        <Checkbox isDisabled={!can.manage || busy} isSelected={settings.primaryContactRequired} onChange={(value) => run(() => saveSettings({ primaryContactRequired: value }), value ? "Customer projects need a primary contact to activate." : "A primary contact is optional.")}>
          A customer project names the customer&apos;s primary contact before it is activated</Checkbox>
        <Checkbox isDisabled={!can.manage || busy} isSelected={settings.inactiveCustomerAllowed} onChange={(value) => run(() => saveSettings({ inactiveCustomerAllowed: value }), value ? "Inactive customers may be chosen." : "Only active customers may be chosen.")}>
          An inactive customer may be chosen for a new project</Checkbox>
        <div className="flex flex-wrap items-end gap-2">
          <TextField label="Due soon means within (days)" inputMode="numeric" className="w-56" isDisabled={!can.manage} value={days ?? String(settings.dueSoonDays)} onChange={setDays}
            description="Projects this close to their target date are flagged and their managers alerted." />
          {can.manage && days !== null && <Button variant="primary" isDisabled={busy || !/^\d+$/.test(days)} onPress={() => run(async () => { await saveSettings({ dueSoonDays: Number(days) }); setDays(null); }, "Saved.")}>Save</Button>}
        </div>
      </Panel>
      <Panel title="Milestones and tasks" description="How milestone approvals and task reviews work, and when people are reminded of a task's due date.">
        <Checkbox isDisabled={!can.manage || busy} isSelected={settings.milestoneInternalApprovalDefault ?? true} onChange={(value) => run(() => saveSettings({ milestoneInternalApprovalDefault: value }), "Saved.")}>
          A new milestone needs internal approval (unless whoever adds it says otherwise)</Checkbox>
        <Checkbox isDisabled={!can.manage || busy} isSelected={settings.milestoneSelfApprovalAllowed ?? false} onChange={(value) => run(() => saveSettings({ milestoneSelfApprovalAllowed: value }), "Saved.")}>
          Whoever submitted a milestone may also approve it</Checkbox>
        <Checkbox isDisabled={!can.manage || busy} isSelected={settings.taskReviewDefault ?? false} onChange={(value) => run(() => saveSettings({ taskReviewDefault: value }), "Saved.")}>
          A new task needs review before it is done (unless whoever adds it says otherwise)</Checkbox>
        <Checkbox isDisabled={!can.manage || busy} isSelected={settings.taskSelfReviewAllowed ?? false} onChange={(value) => run(() => saveSettings({ taskSelfReviewAllowed: value }), "Saved.")}>
          Whoever submitted a task for review may also approve it</Checkbox>
        <div className="flex flex-wrap items-end gap-2">
          <TextField label="Remind the assignee this many days before a task is due" inputMode="numeric" className="w-72" isDisabled={!can.manage} value={reminder ?? String(settings.taskReminderDays ?? 1)} onChange={setReminder}
            description="One reminder; 0 reminds on the day. Overdue tasks are reported to the assignee and the Project Manager." />
          {can.manage && reminder !== null && <Button variant="primary" isDisabled={busy || !/^\d+$/.test(reminder)} onPress={() => run(async () => { await saveSettings({ taskReminderDays: Number(reminder) }); setReminder(null); }, "Saved.")}>Save</Button>}
        </div>
      </Panel>
      <Panel title="Project types" description="A simple category for each project." actions={can.manage ? <Button size="compact" variant="secondary" onPress={() => setAsk(typeAsk())}>New type</Button> : undefined}>
        <LinesTable columns={["Type", "Code", "Status", ""]}>
          {types.map((type) => (
            <tr key={type.id}><Cell><span className="flex flex-col"><span>{type.name}</span>{type.description && <span className="text-xs text-text-muted">{type.description}</span>}</span></Cell>
              <Cell>{type.code}</Cell><Cell><StatusBadge tone={type.status === "ACTIVE" ? "success" : "neutral"}>{type.status === "ACTIVE" ? "Active" : "Inactive"}</StatusBadge></Cell>
              <Cell>{can.manage && <span className="flex gap-1"><Button size="compact" variant="ghost" onPress={() => setAsk(typeAsk(type))}>Edit</Button>
                <Button size="compact" variant="ghost" isDisabled={busy} onPress={() => run(() => saveType({ id: type.id, name: type.name, description: type.description, status: type.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }),
                  type.status === "ACTIVE" ? `${type.name} is no longer offered.` : `${type.name} is offered again.`)}>{type.status === "ACTIVE" ? "Deactivate" : "Reactivate"}</Button></span>}</Cell></tr>
          ))}
        </LinesTable>
      </Panel>
      <Panel title="Project roles" description="Within a project, on top of a person's company role — never beyond it.">
        <LinesTable columns={["Role", "What it allows"]}>{roles.map((role) => <tr key={role.code}><Cell>{role.name}</Cell><Cell>{ROLE_HELP[role.code]}</Cell></tr>)}</LinesTable>
      </Panel>
      <Panel title="Project templates">
        <p className="text-sm text-text-secondary">Templates arrive with their own feature. Projects already keep a reference to the template they came from, so nothing changes when they do.</p>
      </Panel>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

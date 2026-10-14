"use client";

// The CRM "+ Create" menu, in the top bar of every CRM page and as Home's primary button: Lead · Deal · Company · Contact, then Task ·
// Follow-up. Each entry shows only with its create permission. Task and Follow-up open their dialogs over the current page; the others open
// their new-record pages. A quotation is not here: it belongs to Sales and is started from its deal.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button, Menu, MenuItem, MenuSeparator, MenuTrigger } from "@vercentlabs/design-system";

import { ScheduleFollowUpDialog } from "@/features/crm/follow-ups/components/FollowUpDialogs";
import { getFollowUpOptions, type FollowUpOptions } from "@/features/crm/follow-ups/api/follow-ups-api";
import { TaskFormDialog } from "@/features/crm/tasks/components/TaskDialogs";
import { getTaskOptions, type TaskOptions } from "@/features/crm/tasks/api/tasks-api";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const RECORDS = [
  { id: "lead", label: "Lead", href: "/crm/leads/new", permission: "crm.leads.create" },
  { id: "deal", label: "Deal", href: "/crm/opportunities/new", permission: "crm.opportunities.create" },
  { id: "company", label: "Company", href: "/crm/accounts/new", permission: "crm.accounts.create" },
  { id: "contact", label: "Contact", href: "/crm/contacts/new", permission: "crm.contacts.create" },
];
const WORK = [
  { id: "task", label: "Task", permission: "crm.tasks.create" },
  { id: "follow-up", label: "Follow-up", permission: "crm.follow_ups.create" },
];

export function CrmCreateMenu({ size = "standard" }: { size?: "compact" | "standard" }) {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const owner = workspace.roleSlugs.includes("organization_owner");
  const may = (permission: string) => owner || workspace.permissions.includes(permission);
  const records = RECORDS.filter((entry) => may(entry.permission));
  const work = WORK.filter((entry) => may(entry.permission));
  const [dialog, setDialog] = useState<{ kind: "task"; options: TaskOptions } | { kind: "follow-up"; options: FollowUpOptions } | null>(null);
  if (records.length + work.length === 0) return null;
  const choose = async (key: string) => {
    const record = records.find((entry) => entry.id === key);
    if (record) return router.push(record.href);
    // The dialog needs the options a new task or follow-up starts from; they are loaded (and cached) when chosen.
    if (key === "task") setDialog({ kind: "task", options: await queryClient.fetchQuery({ queryKey: scopedQueryKey(workspace, "crm", "task-options"), queryFn: getTaskOptions, staleTime: 60_000 }) });
    if (key === "follow-up") setDialog({ kind: "follow-up", options: await queryClient.fetchQuery({ queryKey: scopedQueryKey(workspace, "crm", "follow-up-options"), queryFn: getFollowUpOptions, staleTime: 60_000 }) });
  };
  const saved = (path: string) => {
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm") });
    router.push(path);
  };
  return (
    <>
      <MenuTrigger>
        <Button variant="primary" size={size}>
          <Plus className="size-4" aria-hidden="true" />
          Create
        </Button>
        <Menu onAction={(key) => void choose(String(key))}>
          {records.map((entry) => <MenuItem key={entry.id} id={entry.id}>{entry.label}</MenuItem>)}
          {records.length > 0 && work.length > 0 && <MenuSeparator />}
          {work.map((entry) => <MenuItem key={entry.id} id={entry.id}>{entry.label}</MenuItem>)}
        </Menu>
      </MenuTrigger>
      {dialog?.kind === "task" && (
        <TaskFormDialog isOpen onOpenChange={(open) => { if (!open) setDialog(null); }} options={dialog.options} onSaved={(task) => saved(`/crm/tasks/${task.id}`)} />
      )}
      {dialog?.kind === "follow-up" && (
        <ScheduleFollowUpDialog isOpen onOpenChange={(open) => { if (!open) setDialog(null); }} options={dialog.options} onSaved={(followUp) => saved(`/crm/follow-ups/${followUp.id}`)} />
      )}
    </>
  );
}

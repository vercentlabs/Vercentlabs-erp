"use client";

// The inline actions on a task or follow-up row (Home's agenda, the To-dos lists): Complete, and on a follow-up Reschedule and Snooze. Each
// opens the existing dialog; the record and its options are loaded when the action is chosen, so a list never loads every record up front.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BellOff, CalendarClock, Check } from "lucide-react";
import { Button, Menu, MenuItem, MenuTrigger } from "@vercentlabs/design-system";

import { CompleteFollowUpDialog, RescheduleFollowUpDialog } from "@/features/crm/follow-ups/components/FollowUpDialogs";
import { getFollowUp, getFollowUpOptions, snoozeFollowUp, type FollowUp, type FollowUpOptions } from "@/features/crm/follow-ups/api/follow-ups-api";
import { snoozeChoices } from "@/features/crm/follow-ups/follow-up-format";
import { CompleteTaskDialog } from "@/features/crm/tasks/components/TaskDialogs";
import { getTask, getTaskOptions, type Task, type TaskOptions } from "@/features/crm/tasks/api/tasks-api";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Loaded = { kind: "task"; record: Task; options: TaskOptions; action: "complete" } | { kind: "follow_up"; record: FollowUp; options: FollowUpOptions; action: "complete" | "reschedule" };

export function WorkRowActions({ kind, id, snooze = kind === "follow_up", onDone, onMessage }: {
  kind: "task" | "follow_up"; id: string; snooze?: boolean; onDone?: () => void; onMessage?: (text: string) => void;
}) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm") });
    onDone?.();
  };
  const open = async (action: "complete" | "reschedule") => {
    setBusy(true);
    try {
      if (kind === "task") {
        const [record, options] = await Promise.all([getTask(id), queryClient.fetchQuery({ queryKey: scopedQueryKey(workspace, "crm", "task-options"), queryFn: getTaskOptions, staleTime: 60_000 })]);
        setLoaded({ kind, record, options, action: "complete" });
      } else {
        const [record, options] = await Promise.all([getFollowUp(id), queryClient.fetchQuery({ queryKey: scopedQueryKey(workspace, "crm", "follow-up-options"), queryFn: getFollowUpOptions, staleTime: 60_000 })]);
        setLoaded({ kind, record, options, action });
      }
    } catch (failure) {
      onMessage?.(failure instanceof Error ? failure.message : "That item could not be opened.");
    } finally { setBusy(false); }
  };
  const snoozeFor = async (choice: string) => {
    const picked = snoozeChoices().find((entry) => entry.id === choice);
    setBusy(true);
    try {
      await snoozeFollowUp(id, picked?.minutes ? { minutes: picked.minutes } : { until: picked?.until?.() });
      onMessage?.(`Reminder snoozed: ${picked?.label ?? ""}.`);
      refresh();
    } catch (failure) {
      onMessage?.(failure instanceof Error ? failure.message : "The reminder could not be snoozed.");
    } finally { setBusy(false); }
  };
  const close = () => setLoaded(null);
  return (
    // Shown on hover (and to keyboard focus) on desktop; always visible on a touch screen.
    <span className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 lg:opacity-0"
      onClick={(event) => event.stopPropagation()}>
      <Button size="compact" variant="ghost" isDisabled={busy} aria-label="Complete" onPress={() => void open("complete")}><Check className="size-4" aria-hidden="true" /><span className="max-xl:sr-only">Complete</span></Button>
      {kind === "follow_up" && (
        <Button size="compact" variant="ghost" isDisabled={busy} aria-label="Reschedule" onPress={() => void open("reschedule")}><CalendarClock className="size-4" aria-hidden="true" /><span className="max-xl:sr-only">Reschedule</span></Button>
      )}
      {kind === "follow_up" && snooze && (
        <MenuTrigger>
          <Button size="compact" variant="ghost" isDisabled={busy} aria-label="Snooze the reminder"><BellOff className="size-4" aria-hidden="true" /><span className="max-xl:sr-only">Snooze</span></Button>
          <Menu onAction={(key) => void snoozeFor(String(key))}>
            {snoozeChoices().map((choice) => <MenuItem key={choice.id} id={choice.id}>{choice.label}</MenuItem>)}
          </Menu>
        </MenuTrigger>
      )}
      {loaded?.kind === "task" && <CompleteTaskDialog isOpen onOpenChange={(value) => { if (!value) close(); }} task={loaded.record} options={loaded.options} onDone={() => { refresh(); onMessage?.("Task completed."); }} />}
      {loaded?.kind === "follow_up" && loaded.action === "complete" && (
        <CompleteFollowUpDialog isOpen onOpenChange={(value) => { if (!value) close(); }} followUp={loaded.record} options={loaded.options} onDone={() => { refresh(); onMessage?.("Follow-up completed."); }} />
      )}
      {loaded?.kind === "follow_up" && loaded.action === "reschedule" && (
        <RescheduleFollowUpDialog isOpen onOpenChange={(value) => { if (!value) close(); }} followUp={loaded.record} onDone={() => { refresh(); onMessage?.("Follow-up rescheduled."); }} />
      )}
    </span>
  );
}

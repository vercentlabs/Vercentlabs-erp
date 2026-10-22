"use client";

// The inline actions on a task or follow-up row (Home's agenda, the To-dos lists): Complete, and on a follow-up Reschedule and Snooze. Each
// opens the existing dialog; the record and its options are loaded when the action is chosen, so a list never loads every record up front.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BellOff, CalendarClock, Check, MoreHorizontal } from "lucide-react";
import { Button, IconButton, Menu, MenuItem, MenuTrigger } from "@vercentlabs/design-system";

import { CompleteFollowUpDialog, RescheduleFollowUpDialog } from "@/features/crm/follow-ups/components/FollowUpDialogs";
import { getFollowUp, getFollowUpOptions, snoozeFollowUp, type FollowUp, type FollowUpOptions } from "@/features/crm/follow-ups/api/follow-ups-api";
import { snoozeChoices } from "@/features/crm/follow-ups/follow-up-format";
import { CompleteTaskDialog } from "@/features/crm/tasks/components/TaskDialogs";
import { getTask, getTaskOptions, type Task, type TaskOptions } from "@/features/crm/tasks/api/tasks-api";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Loaded = { kind: "task"; record: Task; options: TaskOptions; action: "complete" } | { kind: "follow_up"; record: FollowUp; options: FollowUpOptions; action: "complete" | "reschedule" };

// layout "check": an always-visible round Complete button for the first column of a list (and, on a follow-up, a ⋯ menu with Reschedule
// and Snooze), instead of the hover actions.
// labelled: the check is followed by the word Complete (a phone card, where there is room and no column header).
export function WorkRowActions({ kind, id, snooze = kind === "follow_up", onDone, onMessage, layout = "row", labelled = false }: {
  kind: "task" | "follow_up"; id: string; snooze?: boolean; onDone?: () => void; onMessage?: (text: string) => void; layout?: "row" | "check"; labelled?: boolean;
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
  const dialogs = (
    <>
      {loaded?.kind === "task" && <CompleteTaskDialog isOpen onOpenChange={(value) => { if (!value) close(); }} task={loaded.record} options={loaded.options} onDone={() => { refresh(); onMessage?.("Task completed."); }} />}
      {loaded?.kind === "follow_up" && loaded.action === "complete" && (
        <CompleteFollowUpDialog isOpen onOpenChange={(value) => { if (!value) close(); }} followUp={loaded.record} options={loaded.options} onDone={() => { refresh(); onMessage?.("Follow-up completed."); }} />
      )}
    </>
  );
  if (layout === "check")
    return (
      <span className="flex items-center" onClick={(event) => event.stopPropagation()}>
        {labelled ? (
          <button type="button" disabled={busy} onClick={() => void open("complete")}
            className="flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-text-secondary outline-none transition-colors hover:border-success hover:bg-success-soft hover:text-success focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50">
            <span className="flex size-4 items-center justify-center rounded-full border-2 border-current"><Check className="size-2.5" strokeWidth={3} aria-hidden="true" /></span>Complete
          </button>
        ) : (
          <button type="button" disabled={busy} aria-label="Complete" title="Complete" onClick={() => void open("complete")}
            className="group/check flex size-6 items-center justify-center rounded-full border-2 border-border-strong text-transparent outline-none transition-colors hover:border-success hover:bg-success-soft hover:text-success focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50">
            <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
          </button>
        )}
        {kind === "follow_up" && (
          <MenuTrigger>
            <IconButton size="compact" variant="ghost" isDisabled={busy} aria-label="More actions"><MoreHorizontal className="size-4" aria-hidden="true" /></IconButton>
            <Menu onAction={(key) => { if (key === "reschedule") void open("reschedule"); else void snoozeFor(String(key)); }}>
              <MenuItem id="reschedule">Reschedule…</MenuItem>
              {snooze ? snoozeChoices().map((choice) => <MenuItem key={choice.id} id={choice.id}>{`Snooze: ${choice.label}`}</MenuItem>) : null}
            </Menu>
          </MenuTrigger>
        )}
        {dialogs}
        {loaded?.kind === "follow_up" && loaded.action === "reschedule" && (
          <RescheduleFollowUpDialog isOpen onOpenChange={(value) => { if (!value) close(); }} followUp={loaded.record} onDone={() => { refresh(); onMessage?.("Follow-up rescheduled."); }} />
        )}
      </span>
    );
  return (
    // Shown on hover (and to keyboard focus) on desktop; always visible on a touch screen.
    <span className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 lg:opacity-0"
      onClick={(event) => event.stopPropagation()}>
      <Button size="compact" variant="ghost" isDisabled={busy} aria-label="Complete" onPress={() => void open("complete")}><Check className="size-4" aria-hidden="true" /><span>Complete</span></Button>
      {kind === "follow_up" && (
        <Button size="compact" variant="ghost" isDisabled={busy} aria-label="Reschedule" onPress={() => void open("reschedule")}><CalendarClock className="size-4" aria-hidden="true" /><span>Reschedule</span></Button>
      )}
      {kind === "follow_up" && snooze && (
        <MenuTrigger>
          <Button size="compact" variant="ghost" isDisabled={busy} aria-label="Snooze the reminder"><BellOff className="size-4" aria-hidden="true" /><span>Snooze</span></Button>
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

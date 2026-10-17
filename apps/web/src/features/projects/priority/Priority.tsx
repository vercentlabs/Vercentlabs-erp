"use client";

// Priority in Projects: one look and one way to choose it for projects, milestones and tasks. The badge always pairs the colour with a word
// and an arrow (never colour alone); the picker explains each level; raising to Urgent, or lowering from it, asks why. Changing priority never
// changes a due date, an assignee, a status or an approval — the dialog says so, and confirms only once the server has saved it.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ChevronsUp, Minus } from "lucide-react";
import { Button, Dialog, Select, TextArea, statusBadgeVariants } from "@vercentlabs/design-system";

import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { PRIORITY_LABEL, PRIORITY_TONE, errorMessage, newKey, type Priority } from "../api/projects-api";
import { PRIORITIES, PRIORITY_DESCRIPTION, priorityNeedsReason, setPriority as savePriority, type PriorityCounts, type PriorityTarget } from "./priority-api";

const ICON = { URGENT: ChevronsUp, HIGH: ChevronUp, NORMAL: Minus, LOW: ChevronDown } as const;

export function PriorityBadge({ priority }: { priority: Priority }) {
  const Icon = ICON[priority] ?? Minus;
  return (
    // The status badge's look, with an arrow for the level (up for High and Urgent, down for Low) beside the word.
    <span className={statusBadgeVariants({ tone: PRIORITY_TONE[priority] })}>
      <Icon className="size-3.5" aria-hidden="true" />{PRIORITY_LABEL[priority]}
    </span>
  );
}

const OPTIONS = PRIORITIES.map((value) => ({ value, label: `${PRIORITY_LABEL[value]} — ${PRIORITY_DESCRIPTION[value]}` }));

// The priority field of a form. `original` is the saved value when editing (a change to or from Urgent then asks why); creating has none.
export function PriorityField({ value, onChange, original, reason, onReasonChange, label = "Priority" }: {
  value: Priority; onChange: (value: Priority) => void; original?: Priority | null; reason?: string; onReasonChange?: (value: string) => void; label?: string;
}) {
  const needsReason = priorityNeedsReason(original, value);
  return (
    <>
      <Select label={label} selectedKey={value} onSelectionChange={(key) => onChange(String(key) as Priority)} options={OPTIONS} />
      {needsReason && onReasonChange && (
        <TextArea label={value === "URGENT" ? "Why is this Urgent?" : "Why is this no longer Urgent?"} isRequired value={reason ?? ""} onChange={onReasonChange} maxLength={1000}
          errorMessage={reason !== undefined && reason.trim().length > 0 && reason.trim().length < 3 ? "Give at least a few words." : undefined} />
      )}
    </>
  );
}
// A form may save when the priority's reason (if one is needed) is given.
export const priorityReasonMissing = (original: Priority | null | undefined, value: Priority, reason: string | undefined) =>
  priorityNeedsReason(original, value) && (reason ?? "").trim().length < 3;


// "Change priority" on a task, milestone or project page (and from lists). Saves through the record's priority command.
export function PriorityDialog({ target, onClose, onDone }: { target: PriorityTarget; onClose: () => void; onDone?: (text: string) => void | Promise<void> }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [priority, setPriority] = useState<Priority>(target.priority);
  const [reason, setReason] = useState("");
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = priorityReasonMissing(target.priority, priority, reason);
  const what = target.kind === "task" ? "the task's assignee, due date, status or approvals" : target.kind === "milestone" ? "the milestone's tasks, due date, status or approvals"
    : "the project's milestones, tasks, dates, status or hold";
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title={`Set ${target.kind} priority`} description={`${target.code} · ${target.name}`}>
      <div className="flex flex-col gap-3">
        <PriorityField value={priority} onChange={setPriority} original={target.priority} reason={reason} onReasonChange={setReason} />
        <p className="text-xs text-text-muted">{`Changing priority does not change ${what}.`}</p>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || priority === target.priority || missing} onPress={async () => {
            setBusy(true); setError(null);
            const input = { priority, reason: reason.trim() || undefined, expectedVersion: target.version, idempotencyKey: key };
            try {
              await savePriority(target, input);
              await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") });
              await onDone?.(`${target.code} is now ${PRIORITY_LABEL[priority]}.`);
              onClose();
            } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
          }}>Save priority</Button>
        </div>
      </div>
    </Dialog>
  );
}

// One chip per level for filtering a list, each with how many records it holds under the other filters; several can be on at once (Urgent + High).
export function PriorityChips({ selected, counts, onChange }: { selected: string | undefined; counts: PriorityCounts | undefined; onChange: (next: string | null) => void }) {
  const on = new Set((selected ?? "").split(",").filter(Boolean));
  return (
    <div role="group" aria-label="Priority" className="flex flex-wrap items-center gap-1.5">
      {PRIORITIES.map((level) => {
        const active = on.has(level);
        return (
          <button key={level} type="button" aria-pressed={active}
            onClick={() => { const next = new Set(on); if (active) next.delete(level); else next.add(level); onChange(next.size ? PRIORITIES.filter((entry) => next.has(entry)).join(",") : null); }}
            className={`flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand ${
              active ? "border-brand bg-brand-soft text-brand-active" : "border-border text-text-secondary hover:bg-surface-muted"}`}>
            {PRIORITY_LABEL[level]}{counts ? <span className="tabular-nums text-xs text-text-muted">{counts[level]}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

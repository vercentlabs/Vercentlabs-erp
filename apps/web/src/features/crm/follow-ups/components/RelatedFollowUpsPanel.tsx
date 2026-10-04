"use client";

// The follow-ups on one lead, account, contact or opportunity: the next one
// first and prominent, then the rest, with complete, reschedule and snooze at
// hand. Scheduled from here, the record is prefilled.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Menu, MenuItem, MenuTrigger } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, getFollowUpOptions, listFollowUps, snoozeFollowUp, type FollowUp } from "../api/follow-ups-api";
import { ErrorBanner, FollowUpStatusBadge, FollowUpWhen, TYPE_LABELS, snoozeChoices } from "../follow-up-format";
import { CompleteFollowUpDialog, RescheduleFollowUpDialog, ScheduleFollowUpDialog, type RelatedRecord } from "./FollowUpDialogs";

type Action = { kind: "complete" | "reschedule"; followUp: FollowUp } | null;

export function RelatedFollowUpsPanel({ related, canCreate = true, onChanged }: { related: RelatedRecord; canCreate?: boolean; onChanged?: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [scheduling, setScheduling] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filters = related.type === "party" ? { view: "all" as const, accountId: related.id }
    : related.type === "contact" ? { view: "all" as const, contactId: related.id } : { view: "all" as const, relatedType: related.type, relatedId: related.id };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups", "related", related.type, related.id), queryFn: () => listFollowUps({ ...filters, limit: 100 }) });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "follow-up-options"), queryFn: getFollowUpOptions, staleTime: 60_000 });
  const options = optionsQuery.data;
  const can = options?.capabilities;
  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "timeline") });
    onChanged?.();
  };
  const snooze = useMutation({
    mutationFn: ({ followUp, choice }: { followUp: FollowUp; choice: string }) => {
      const picked = snoozeChoices().find((entry) => entry.id === choice);
      return snoozeFollowUp(followUp.id, picked?.minutes ? { minutes: picked.minutes } : { until: picked?.until?.() });
    },
    onSuccess: refresh,
    onError: (failure) => setError(errorMessage(failure)),
  });
  const rows = query.data?.rows ?? [];
  const open = rows.filter((row) => row.status === "scheduled");
  const shown = showClosed ? rows : open;
  const next = open[0];

  return (
    <section className="flex flex-col gap-3">
      {next ? (
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border px-4 py-3 text-sm ${next.isOverdue ? "border-danger-emphasis/40 bg-danger-soft" : "border-brand-border bg-brand-soft"}`}>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs font-medium tracking-wide text-text-secondary uppercase">Next follow-up</span>
            <span className="font-medium">{TYPE_LABELS[next.type]} · <FollowUpWhen followUp={next} /></span>
            <span className="text-text-secondary">{[next.subject, next.contactName, next.assignedName].filter(Boolean).join(" · ")}</span>
          </div>
          {can?.complete && <Button variant="primary" size="compact" onPress={() => setAction({ kind: "complete", followUp: next })}>Complete</Button>}
        </div>
      ) : !query.isLoading && <p className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-4 py-3 text-sm">No follow-up scheduled.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Checkbox isSelected={showClosed} onChange={setShowClosed}>Show completed and cancelled</Checkbox>
        {canCreate && can?.create && <Button variant="secondary" size="compact" onPress={() => setScheduling(true)}>Schedule follow-up</Button>}
      </div>
      <ErrorBanner message={error} />
      {query.isLoading ? <LoadingState label="Loading follow-ups" rows={3} /> : shown.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-border px-4 py-6 text-center text-sm text-text-secondary">{showClosed ? "No follow-ups yet." : "No scheduled follow-ups."}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
          {shown.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={`/crm/follow-ups/${row.id}`} className="font-medium hover:underline">{row.subject}</Link>
                  <FollowUpStatusBadge status={row.status} />
                </span>
                <span className="flex flex-wrap items-center gap-x-2 text-xs text-text-secondary">
                  <span>{TYPE_LABELS[row.type]}</span>
                  <FollowUpWhen followUp={row} />
                  {row.contactName && <span>· {row.contactName}</span>}
                  <span>· {row.assignedName ?? "Unassigned"}</span>
                  {related.type === "party" && row.relatedType !== "party" && row.relatedName && <span>· {row.relatedName}</span>}
                  {row.outcomeLabel && <span>· {row.outcomeLabel}</span>}
                </span>
              </div>
              {row.status === "scheduled" && (
                <span className="flex flex-wrap gap-1">
                  {can?.complete && <Button variant="secondary" size="compact" onPress={() => setAction({ kind: "complete", followUp: row })}>Complete</Button>}
                  {can?.reschedule && <Button variant="ghost" size="compact" onPress={() => setAction({ kind: "reschedule", followUp: row })}>Reschedule</Button>}
                  {row.assignedTo === options?.currentUserId && (
                    <MenuTrigger>
                      <Button variant="ghost" size="compact">Snooze</Button>
                      <Menu onAction={(choice) => snooze.mutate({ followUp: row, choice: String(choice) })}>
                        {snoozeChoices().map((choice) => <MenuItem key={choice.id} id={choice.id}>{choice.label}</MenuItem>)}
                      </Menu>
                    </MenuTrigger>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {options && scheduling && <ScheduleFollowUpDialog isOpen onOpenChange={setScheduling} options={options} related={related} onSaved={refresh} />}
      {options && action?.kind === "complete" && <CompleteFollowUpDialog isOpen onOpenChange={(isOpen) => !isOpen && setAction(null)} followUp={action.followUp} options={options} onDone={refresh} />}
      {action?.kind === "reschedule" && <RescheduleFollowUpDialog isOpen onOpenChange={(isOpen) => !isOpen && setAction(null)} followUp={action.followUp} onDone={refresh} />}
    </section>
  );
}

// The record page's "Schedule follow-up" button: the dialog, with the record prefilled.
export function ScheduleFollowUpForRecord({ isOpen, onOpenChange, related, onDone }: { isOpen: boolean; onOpenChange: (open: boolean) => void; related: RelatedRecord; onDone: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "follow-up-options"), queryFn: getFollowUpOptions, staleTime: 60_000, enabled: isOpen });
  if (!isOpen || !optionsQuery.data) return null;
  return (
    <ScheduleFollowUpDialog isOpen onOpenChange={onOpenChange} options={optionsQuery.data} related={related}
      onSaved={() => { void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups") }); onDone(); }} />
  );
}

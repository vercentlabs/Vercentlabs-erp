"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { AlertDialog, Button, ErrorState, Menu, MenuItem, MenuTrigger, RecordDetailsPage } from "@vercentlabs/design-system";

import { PropertyList } from "@/shared/ui/PropertyList";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { deleteFollowUp, errorMessage, getFollowUp, getFollowUpOptions, listFollowUpHistory, snoozeFollowUp } from "../api/follow-ups-api";
import { CancelFollowUpDialog, CompleteFollowUpDialog, ReassignFollowUpDialog, RescheduleFollowUpDialog, ScheduleFollowUpDialog } from "../components/FollowUpDialogs";
import { ErrorBanner, FollowUpStatusBadge, FollowUpWhen, RELATED_LABELS, TYPE_LABELS, snoozeChoices } from "../follow-up-format";

type DialogKind = "edit" | "complete" | "reschedule" | "cancel" | "reassign" | "delete" | null;

export function FollowUpDetailScreen({ followUpId }: { followUpId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups", "record", followUpId), queryFn: () => getFollowUp(followUpId), staleTime: 0, refetchOnWindowFocus: true });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "follow-up-options"), queryFn: getFollowUpOptions, staleTime: 60_000 });
  const historyQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups", "history", followUpId, query.data?.updatedAt), queryFn: () => listFollowUpHistory(followUpId), enabled: Boolean(query.data) });
  const followUp = query.data;
  const options = optionsQuery.data;
  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "timeline") });
  };
  const action = useMutation({ mutationFn: (run: () => Promise<unknown>) => run(), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });

  if (query.isLoading || optionsQuery.isLoading) return <LoadingState label="Loading follow-up" />;
  if (query.isError || !followUp)
    return <ErrorState title="Follow-up not found" description="It may have been deleted, or you may not have access to it." action={{ label: "Back to follow-ups", onPress: () => router.push("/crm/follow-ups") }} />;
  if (!options) return <ErrorState title="Could not load this page" description="Refresh to try again." />;

  const can = options.capabilities;
  const open = followUp.status === "scheduled";
  const close = (isOpen: boolean) => !isOpen && setDialog(null);
  const snooze = (choice: string) => {
    const picked = snoozeChoices().find((entry) => entry.id === choice);
    action.mutate(async () => {
      const result = await snoozeFollowUp(followUp.id, picked?.minutes ? { minutes: picked.minutes } : { until: picked?.until?.() });
      setNotice(`Reminder snoozed until ${formatDateTime(result.remindAt)}. The follow-up is still on ${followUp.scheduledDate}.`);
    });
  };
  const menu = [
    { id: "edit", label: "Edit", show: open && can.edit, run: () => setDialog("edit") },
    { id: "reassign", label: "Reassign", show: open && can.reassign, run: () => setDialog("reassign") },
    { id: "cancel", label: "Cancel follow-up", show: open && can.cancel, run: () => setDialog("cancel") },
    { id: "delete", label: "Delete", show: can.delete, run: () => setDialog("delete") },
  ].filter((entry) => entry.show);

  return (
    <>
      <RecordDetailsPage
        header={{
          title: <>{followUp.subject} <span className="text-base font-normal whitespace-nowrap text-text-muted">{followUp.number}</span></>,
          status: <span className="flex flex-wrap items-center gap-2"><FollowUpStatusBadge status={followUp.status} /><span className="text-sm">{TYPE_LABELS[followUp.type]}</span></span>,
          fields: [
            { label: "When", value: <FollowUpWhen followUp={followUp} /> },
            { label: "Contact", value: followUp.contactId ? <Link className="hover:underline" href={`/crm/contacts/${followUp.contactId}`}>{followUp.contactName}</Link> : followUp.contactName ?? "—" },
            { label: "Company", value: followUp.accountId ? <Link className="hover:underline" href={`/crm/accounts/${followUp.accountId}`}>{followUp.accountName}</Link> : followUp.accountName ?? "—" },
            { label: "About", value: followUp.relatedHref ? <Link className="hover:underline" href={followUp.relatedHref}>{followUp.relatedName} ({RELATED_LABELS[followUp.relatedType ?? ""]})</Link> : "—" },
            { label: "Assigned to", value: followUp.assignedName ?? "Unassigned" },
          ],
          primaryAction: open && can.complete ? <Button variant="primary" onPress={() => setDialog("complete")}>Complete</Button> : undefined,
          secondaryActions: (
            <>
              {open && can.reschedule && <Button variant="secondary" onPress={() => setDialog("reschedule")}>Reschedule</Button>}
              {open && followUp.assignedTo === options.currentUserId && (
                <MenuTrigger>
                  <Button variant="secondary">Snooze reminder</Button>
                  <Menu onAction={(choice) => snooze(String(choice))}>{snoozeChoices().map((choice) => <MenuItem key={choice.id} id={choice.id}>{choice.label}</MenuItem>)}</Menu>
                </MenuTrigger>
              )}
              {menu.length > 0 && (
                <MenuTrigger>
                  <Button variant="outline" aria-label="More actions"><MoreHorizontal className="size-4" aria-hidden="true" /></Button>
                  <Menu onAction={(id) => menu.find((entry) => entry.id === id)?.run()}>{menu.map((entry) => <MenuItem key={entry.id} id={entry.id}>{entry.label}</MenuItem>)}</Menu>
                </MenuTrigger>
              )}
            </>
          ),
        }}
        tabs={
          <div className="flex flex-col gap-2">
            <ErrorBanner message={error} />
            {notice && <p role="status" className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">{notice}</p>}
          </div>
        }
      >
        <div className="flex flex-col gap-6">
          {followUp.status === "completed" && (
            <p role="status" className="rounded-[var(--radius-control)] border border-success-emphasis/30 bg-success-soft px-3 py-2 text-sm">
              Completed {formatDateTime(followUp.completedAt)}{followUp.completedByName ? ` by ${followUp.completedByName}` : ""}
              {followUp.outcomeLabel ? ` — ${followUp.outcomeLabel}` : ""}{followUp.outcomeNotes ? `: ${followUp.outcomeNotes}` : ""}
            </p>
          )}
          {followUp.status === "cancelled" && (
            <p role="status" className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">
              Cancelled {formatDateTime(followUp.cancelledAt)}{followUp.cancelledByName ? ` by ${followUp.cancelledByName}` : ""}{followUp.cancellationReason ? ` — ${followUp.cancellationReason}` : ""}
            </p>
          )}
          <PropertyList title="Follow-up" columns={3} items={[
            { label: "Purpose / notes", value: followUp.notes ? <span className="whitespace-pre-wrap">{followUp.notes}</span> : null, wide: true },
            { label: "Reminder", value: followUp.reminderOffsetMinutes === null ? "None" : options.reminderOptions.find((entry) => entry.minutes === followUp.reminderOffsetMinutes)?.label ?? formatDateTime(followUp.reminderAt) },
            { label: "Contact details", value: [followUp.contactMobile, followUp.contactEmail].filter(Boolean).join(" · ") || null },
            { label: "Scheduled from lead", value: followUp.originLeadId ? <Link className="hover:underline" href={`/crm/leads/${followUp.originLeadId}`}>{followUp.originLeadCode ?? "Open lead"}</Link> : null },
            { label: "Created", value: `${formatDateTime(followUp.createdAt)}${followUp.createdByName ? ` by ${followUp.createdByName}` : ""}` },
            { label: "Updated", value: `${formatDateTime(followUp.updatedAt)}${followUp.updatedByName ? ` by ${followUp.updatedByName}` : ""}` },
          ]} />
          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">History</h2>
            {historyQuery.isLoading ? <LoadingState label="Loading history" rows={3} /> : (
              <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
                {(historyQuery.data ?? []).map((entry) => (
                  <li key={entry.id} className="flex flex-col gap-0.5 px-4 py-2.5">
                    <span className="font-medium">{entry.summary}</span>
                    <span className="text-xs text-text-muted">{formatDateTime(entry.createdAt)} · {entry.actorName ?? "System"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </RecordDetailsPage>

      {dialog === "edit" && <ScheduleFollowUpDialog isOpen onOpenChange={close} options={options} followUp={followUp} onSaved={refresh} />}
      {dialog === "complete" && <CompleteFollowUpDialog isOpen onOpenChange={close} followUp={followUp} options={options} onDone={refresh} />}
      {dialog === "reschedule" && <RescheduleFollowUpDialog isOpen onOpenChange={close} followUp={followUp} onDone={refresh} />}
      {dialog === "cancel" && <CancelFollowUpDialog isOpen onOpenChange={close} followUp={followUp} onDone={refresh} />}
      {dialog === "reassign" && <ReassignFollowUpDialog isOpen onOpenChange={close} followUp={followUp} options={options} onDone={refresh} />}
      <AlertDialog isOpen={dialog === "delete"} onOpenChange={close} tone="danger" confirmLabel="Delete" isConfirming={action.isPending} title="Delete this follow-up?"
        description="Only a follow-up scheduled by mistake can be deleted: never rescheduled, reassigned, reminded, completed or cancelled. Otherwise cancel it, so its history is kept."
        onConfirm={() => action.mutate(async () => { try { await deleteFollowUp(followUp.id); router.replace("/crm/follow-ups"); } finally { setDialog(null); } })} />
    </>
  );
}

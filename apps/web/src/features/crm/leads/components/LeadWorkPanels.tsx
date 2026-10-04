"use client";

// The work done and planned on a lead: logged activities, tasks and
// follow-ups. All three read one list (the lead's activities) and write
// through the lead, task and follow-up operations.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Dialog, EmptyState, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { DateTimeInput } from "@/features/crm/shared/ui/DateTimeInput";
import { RelatedTasksPanel } from "@/features/crm/tasks/components/RelatedTasksPanel";
import { formatDateTime, humanize } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, listLeadActivities, logLeadActivity, type LeadOptions } from "../api/leads-api";
import { ErrorBanner } from "../lead-format";
import { LIVE_LEAD_QUERY } from "../live-query";

const FOLLOW_UP_TYPE_LABELS: Record<string, string> = { call: "Call", email: "Email", meeting: "Meeting", task: "Task", other: "Other" };
const NO_NEXT_ACTION = "none";

type PanelProps = { leadId: string; options: LeadOptions; canEdit: boolean };

function useLeadActivities(leadId: string) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "crm", "lead", leadId, "activities");
  const query = useQuery({ queryKey: key, queryFn: () => listLeadActivities(leadId), ...LIVE_LEAD_QUERY });
  // A change here also moves the lead's last activity, next follow-up and timeline.
  const refresh = () => void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead", leadId) });
  return { query, refresh };
}


function PanelShell({ title, action, query, isEmpty, emptyTitle, emptyDescription, children }: {
  title: string;
  action?: React.ReactNode;
  query: { isLoading: boolean; isError: boolean; refetch: () => unknown };
  isEmpty: boolean;
  emptyTitle: string;
  emptyDescription: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {query.isLoading ? <LoadingState label={`Loading ${title.toLowerCase()}`} rows={3} />
        : query.isError ? <ErrorBanner message={`Could not load ${title.toLowerCase()}. Refresh the page.`} />
        : isEmpty ? <EmptyState title={emptyTitle} description={emptyDescription} />
        : <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">{children}</ul>}
    </section>
  );
}



// ------------------------------------------------------------------ logged activities

export function LeadActivitiesPanel({ leadId, options, canEdit }: PanelProps) {
  const { query, refresh } = useLeadActivities(leadId);
  const [isLogging, setLogging] = useState(false);
  const logged = (query.data ?? []).filter((activity) => activity.type !== "task" && activity.type !== "follow_up");

  return (
    <>
      <PanelShell
        title="Activities"
        action={canEdit && <Button variant="primary" size="compact" onPress={() => setLogging(true)}>Log activity</Button>}
        query={query}
        isEmpty={logged.length === 0}
        emptyTitle="No activities logged"
        emptyDescription="Log each call, email and meeting so anyone can see what has happened with this lead."
      >
        {logged.map((activity) => (
          <li key={activity.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{activity.type === "other" ? "Activity" : humanize(activity.type)}</Badge>
              <span className="font-medium">{activity.subject}</span>
              <span className="text-text-muted">{formatDateTime(activity.completedAt ?? activity.createdAt)}</span>
            </div>
            {activity.outcome && <p><span className="text-text-secondary">Outcome:</span> {activity.outcome}</p>}
            {activity.notes && <p className="whitespace-pre-wrap text-text-secondary">{activity.notes}</p>}
            <p className="text-xs text-text-muted">By {activity.assignedName ?? activity.createdByName ?? "Unknown"}</p>
          </li>
        ))}
      </PanelShell>
      <LogActivityDialog isOpen={isLogging} onOpenChange={setLogging} leadId={leadId} options={options} onDone={refresh} />
    </>
  );
}

// currentStage: given when the caller may change the lead's stage, so the
// activity can move it ("connected — move to Contacted"). Logging an activity
// never moves the stage by itself.
const KEEP_STAGE = "__keep__";

export function LogActivityDialog({ isOpen, onOpenChange, leadId, options, onDone, currentStage }: {
  isOpen: boolean; onOpenChange: (open: boolean) => void; leadId: string; options: LeadOptions; onDone: () => void; currentStage?: string;
}) {
  const [stage, setStage] = useState(KEEP_STAGE);
  const [type, setType] = useState("call");
  const [subject, setSubject] = useState("");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [nextType, setNextType] = useState(NO_NEXT_ACTION);
  const [nextDueAt, setNextDueAt] = useState("");
  const [nextNotes, setNextNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setSubject(""); setOutcome(""); setNotes(""); setOccurredAt(""); setNextType(NO_NEXT_ACTION); setNextDueAt(""); setNextNotes(""); setStage(KEEP_STAGE); setError(null);
  };
  const mutation = useMutation({
    mutationFn: () => logLeadActivity(leadId, {
      type, subject, outcome, notes, occurredAt: occurredAt || undefined,
      ...(stage !== KEEP_STAGE ? { stage } : {}),
      ...(nextType !== NO_NEXT_ACTION ? { nextAction: { type: nextType, dueAt: nextDueAt, notes: nextNotes } } : {}),
    }),
    onSuccess: () => { onDone(); reset(); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const nextActionIncomplete = nextType !== NO_NEXT_ACTION && !nextDueAt;

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Log activity" description="Record something that has already happened." size="lg">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Type" isRequired selectedKey={type} onSelectionChange={(key) => setType(String(key))}
            options={options.activityTypes.map((entry) => ({ value: entry.code, label: entry.label }))} />
          <DateTimeInput label="When" description="Leave empty for now." value={occurredAt} onChange={setOccurredAt} />
        </div>
        <TextField label="Subject" description="Leave empty to use the activity type and lead name." value={subject} onChange={setSubject} />
        <TextField label="Outcome" value={outcome} onChange={setOutcome} placeholder="For example: Interested, asked for a quote" />
        <TextArea label="Notes" value={notes} onChange={setNotes} />
        {currentStage && (
          <Select label="Update lead stage" description="Optional. For example, move to Contacted once you have spoken to them." selectedKey={stage} onSelectionChange={(key) => setStage(String(key))}
            options={[{ value: KEEP_STAGE, label: "Keep the current stage" }, ...options.stages.filter((entry) => entry.code !== currentStage).map((entry) => ({ value: entry.code, label: `Move to ${entry.label}` }))]} />
        )}
        <div className="flex flex-col gap-4 rounded-[var(--radius-control)] border border-border p-3">
          <Select label="Next action" selectedKey={nextType} onSelectionChange={(key) => setNextType(String(key))}
            options={[{ value: NO_NEXT_ACTION, label: "None" }, ...options.followUpTypes.map((entry) => ({ value: entry, label: `Follow-up: ${FOLLOW_UP_TYPE_LABELS[entry] ?? entry}` }))]} />
          {nextType !== NO_NEXT_ACTION && (
            <>
              <DateTimeInput label="Follow-up date and time" isRequired value={nextDueAt} onChange={setNextDueAt} />
              <TextField label="Follow-up notes" value={nextNotes} onChange={setNextNotes} />
            </>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={nextActionIncomplete}>Log activity</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ tasks

// The tasks on this record, through CRM Tasks.
export function LeadTasksPanel({ leadId, canEdit }: PanelProps) {
  return <RelatedTasksPanel relatedType="lead" relatedId={leadId} canCreate={canEdit} />;
}

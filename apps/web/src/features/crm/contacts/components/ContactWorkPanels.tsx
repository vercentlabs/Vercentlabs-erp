"use client";

// The work done and planned with a person: logged activities, tasks and
// follow-ups. A logged call or meeting can be about one of their
// opportunities; a task can belong to the contact or to an opportunity.
// Everything logged here also shows on the person's company.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Dialog, EmptyState, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { DateTimeInput } from "@/features/crm/shared/ui/DateTimeInput";
import { RelatedTasksPanel } from "@/features/crm/tasks/components/RelatedTasksPanel";
import { formatDateTime, humanize } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  errorMessage, listContactActivities, listContactRelated, logContactActivity,
  type ContactActivity, type ContactOptions,
} from "../api/contacts-api";
import { ErrorBanner, LIVE_CONTACT_QUERY } from "../contact-format";

const FOLLOW_UP_TYPE_LABELS: Record<string, string> = { call: "Call", email: "Email", meeting: "Meeting", task: "Task", other: "Other" };
const NO_NEXT_ACTION = "none";
const NO_OPPORTUNITY = "__none__";

type PanelProps = { contactId: string; options: ContactOptions; canEdit: boolean };

function useContactActivities(contactId: string) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "contact", contactId, "activities"), queryFn: () => listContactActivities(contactId), ...LIVE_CONTACT_QUERY });
  // A change here also moves the contact's (and company's) last activity, next follow-up, summary and timeline.
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "contact", contactId) });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "contacts") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "account") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "timeline") });
  };
  return { query, refresh };
}

// The person's open opportunities, for "what was this about?" pickers.
function useOpportunityOptions(contactId: string, enabled: boolean) {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "contact", contactId, "related", "opportunities"),
    queryFn: () => listContactRelated(contactId, "opportunities"),
    enabled,
  });
  return (query.data ?? []).filter((row) => row.status === "open");
}


function PanelShell({ title, action, query, isEmpty, emptyTitle, emptyDescription, children }: {
  title: string;
  action?: React.ReactNode;
  query: { isLoading: boolean; isError: boolean };
  isEmpty: boolean;
  emptyTitle: string;
  emptyDescription: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
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

// The company and opportunity the activity belongs to.
function SourceLine({ activity }: { activity: ContactActivity }) {
  const parts = [
    activity.accountName ? <Link key="a" href={`/crm/accounts/${activity.accountId}`} className="hover:underline">{activity.accountName}</Link> : null,
    activity.opportunityName ? <Link key="o" href={`/crm/opportunities/${activity.opportunityId}`} className="hover:underline">Opportunity: {activity.opportunityName}</Link> : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <p className="flex flex-wrap gap-x-3 text-xs text-text-secondary">{parts}</p>;
}



// ------------------------------------------------------------------ logged activities

export function ContactActivitiesPanel({ contactId, options, canEdit }: PanelProps) {
  const { query, refresh } = useContactActivities(contactId);
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
        emptyDescription="Log each call, email and meeting with this person so anyone can see what has happened."
      >
        {logged.map((activity) => (
          <li key={activity.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{activity.type === "other" ? "Activity" : humanize(activity.type)}</Badge>
              <span className="font-medium">{activity.subject}</span>
              <span className="text-text-muted">{formatDateTime(activity.completedAt ?? activity.createdAt)}</span>
            </div>
            <SourceLine activity={activity} />
            {activity.outcome && <p><span className="text-text-secondary">Outcome:</span> {activity.outcome}</p>}
            {activity.notes && <p className="whitespace-pre-wrap text-text-secondary">{activity.notes}</p>}
            <p className="text-xs text-text-muted">By {activity.assignedName ?? activity.createdByName ?? "Unknown"}</p>
          </li>
        ))}
      </PanelShell>
      <LogContactActivityDialog isOpen={isLogging} onOpenChange={setLogging} contactId={contactId} options={options} onDone={refresh} />
    </>
  );
}

export function LogContactActivityDialog({ isOpen, onOpenChange, contactId, options, onDone }: {
  isOpen: boolean; onOpenChange: (open: boolean) => void; contactId: string; options: ContactOptions; onDone: () => void;
}) {
  const opportunities = useOpportunityOptions(contactId, isOpen);
  const [type, setType] = useState("call");
  const [opportunityId, setOpportunityId] = useState(NO_OPPORTUNITY);
  const [subject, setSubject] = useState("");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [nextType, setNextType] = useState(NO_NEXT_ACTION);
  const [nextDueAt, setNextDueAt] = useState("");
  const [nextNotes, setNextNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setOpportunityId(NO_OPPORTUNITY); setSubject(""); setOutcome(""); setNotes(""); setOccurredAt(""); setNextType(NO_NEXT_ACTION); setNextDueAt(""); setNextNotes(""); setError(null);
  };
  const mutation = useMutation({
    mutationFn: () => logContactActivity(contactId, {
      type, subject, outcome, notes, occurredAt: occurredAt || undefined, opportunityId: opportunityId === NO_OPPORTUNITY ? undefined : opportunityId,
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
        <Select label="About an opportunity" selectedKey={opportunityId} onSelectionChange={(key) => setOpportunityId(String(key))}
          options={[{ value: NO_OPPORTUNITY, label: "No specific opportunity" }, ...opportunities.map((row) => ({ value: row.id, label: row.title ?? row.code ?? "Opportunity" }))]} />
        <TextField label="Subject" description="Leave empty to use the activity type and the person's name." value={subject} onChange={setSubject} />
        <TextField label="Outcome" value={outcome} onChange={setOutcome} placeholder="For example: Interested, wants a demo" />
        <TextArea label="Notes" value={notes} onChange={setNotes} />
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
export function ContactTasksPanel({ contactId, canEdit }: PanelProps) {
  return <RelatedTasksPanel relatedType="contact" relatedId={contactId} canCreate={canEdit} />;
}

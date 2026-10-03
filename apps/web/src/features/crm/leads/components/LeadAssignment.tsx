"use client";

// Lead ownership on screen: the assign / reassign dialog (one lead or many),
// the assignment panel on a lead (who has it, how they got it, every change)
// and the dialog that hands a user's leads to someone else.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge, Button, Checkbox, Dialog, Radio, RadioGroup, Select, TextArea } from "@vercentlabs/design-system";

import { PropertyList } from "@/features/crm/shared/ui/PropertyList";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  assignLead, bulkLeadAction, errorMessage, getLeadWorkload, getUserActiveLeadCount, listLeadAssignmentHistory, transferUserLeads,
  type Lead, type LeadBulkResult, type LeadOptions,
} from "../api/leads-api";
import { ErrorBanner } from "../lead-format";

const UNASSIGNED = "__unassigned__";
const NO_CHANGE = "__no_change__";
const NO_TEAM = "__no_team__";
const NONE = "";

const leadCount = (count: number) => `${count} ${count === 1 ? "lead" : "leads"}`;

// Each salesperson with their open leads, so work is shared out sensibly.
function useWorkloadLabels(enabled: boolean) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "leads", "workload"), queryFn: getLeadWorkload, enabled, staleTime: 30_000 });
  const open = new Map((query.data ?? []).map((row) => [row.userId, row.openLeads]));
  return (user: { id: string; name: string }, currentUserId: string) => {
    const name = user.id === currentUserId ? `${user.name} (me)` : user.name;
    return open.has(user.id) ? `${name} · ${open.get(user.id)} open` : name;
  };
}

// ------------------------------------------------------------------ assign / reassign

// One lead: saved directly, refusing if someone else changed the lead meanwhile.
// Several: asks for confirmation, then reports each lead's outcome.
export function AssignLeadsDialog({ isOpen, onOpenChange, leadIds, lead, options, onDone }: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  lead?: Lead;
  options: LeadOptions;
  onDone: (result: LeadBulkResult) => void;
}) {
  const [owner, setOwner] = useState(NO_CHANGE);
  const [team, setTeam] = useState(NO_CHANGE);
  const [reason, setReason] = useState("");
  const [moveOpenActivities, setMoveOpenActivities] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = useWorkloadLabels(isOpen);
  const single = leadIds.length === 1;

  // An owner chosen together with a team must belong to that team.
  const chosenTeam = options.teams.find((entry) => entry.id === team);
  const users = chosenTeam ? options.users.filter((user) => chosenTeam.memberIds.includes(user.id)) : options.users;
  const changeTeam = (next: string) => {
    setTeam(next);
    setConfirming(false);
    const members = options.teams.find((entry) => entry.id === next)?.memberIds;
    if (members && owner !== NO_CHANGE && owner !== UNASSIGNED && !members.includes(owner)) setOwner(NO_CHANGE);
  };

  const input = {
    ...(owner !== NO_CHANGE ? { ownerUserId: owner === UNASSIGNED ? null : owner } : {}),
    ...(team !== NO_CHANGE ? { teamId: team === NO_TEAM ? null : team } : {}),
    reason: reason.trim() || undefined,
    moveOpenActivities,
  };
  const mutation = useMutation({
    mutationFn: async (): Promise<LeadBulkResult> => {
      if (!single) return bulkLeadAction({ action: "assign", leadIds, ...input });
      await assignLead(leadIds[0], { ...input, expectedUpdatedAt: lead?.updatedAt });
      return { results: [{ leadId: leadIds[0], ok: true }], succeeded: 1, failed: 0 };
    },
    onSuccess: (result) => {
      setError(null);
      onDone(result);
      onOpenChange(false);
    },
    onError: (failure) => { setConfirming(false); setError(errorMessage(failure)); },
  });

  const nothingChosen = owner === NO_CHANGE && team === NO_CHANGE;
  const ownerName = owner === UNASSIGNED ? "the unassigned queue" : options.users.find((user) => user.id === owner)?.name;
  const target = [ownerName, chosenTeam && `team ${chosenTeam.name}`, team === NO_TEAM && "no team"].filter(Boolean).join(" and ");
  const reassigning = Boolean(lead?.ownerUserId);

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={single ? (reassigning ? "Reassign lead" : "Assign lead") : `Assign ${leadCount(leadIds.length)}`}
      description={lead ? `Current owner: ${lead.ownerName ?? "Unassigned"}${lead.teamName ? ` · Team ${lead.teamName}` : ""}` : "Choose a new owner, a sales team, or both."}
    >
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <Select
          label="Assigned team"
          selectedKey={team}
          onSelectionChange={(key) => changeTeam(String(key))}
          options={[
            { value: NO_CHANGE, label: "Keep current team" },
            { value: NO_TEAM, label: "No team" },
            ...options.teams.map((entry) => ({ value: entry.id, label: entry.name })),
          ]}
        />
        <Select
          label="Lead owner"
          description={chosenTeam ? `Only members of ${chosenTeam.name} are listed.` : "Each name shows how many open leads that person already has."}
          selectedKey={owner}
          onSelectionChange={(key) => { setOwner(String(key)); setConfirming(false); }}
          options={[
            { value: NO_CHANGE, label: "Keep current owner" },
            { value: UNASSIGNED, label: "Unassigned (back to the queue)" },
            ...users.map((user) => ({ value: user.id, label: label(user, options.currentUserId) })),
          ]}
        />
        <TextArea label="Reason" description="Optional. Kept in the assignment history." value={reason} onChange={setReason} />
        {owner !== NO_CHANGE && owner !== UNASSIGNED && (!single || reassigning) && (
          <Checkbox isSelected={moveOpenActivities} onChange={setMoveOpenActivities}>
            Move the previous owner&apos;s open tasks and follow-ups to the new owner
          </Checkbox>
        )}
        {confirming && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm">
            Assign {leadCount(leadIds.length)} to {target}? Each lead is checked on its own; any that cannot be assigned are listed afterwards.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => (confirming ? setConfirming(false) : onOpenChange(false))}>{confirming ? "Back" : "Cancel"}</Button>
          <Button
            variant="primary"
            isLoading={mutation.isPending}
            isDisabled={nothingChosen}
            onPress={() => (single || confirming ? mutation.mutate() : setConfirming(true))}
          >
            {single ? (reassigning ? "Reassign" : "Assign") : confirming ? `Yes, assign ${leadCount(leadIds.length)}` : "Assign"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ on the lead

// Who is responsible, how they got the lead, and every change of owner or team.
export function LeadAssignmentPanel({ lead, options }: { lead: Lead; options: LeadOptions }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "lead", lead.id, "assignment-history", lead.updatedAt),
    queryFn: () => listLeadAssignmentHistory(lead.id),
  });
  const history = query.data ?? [];
  const previousOwner = history.find((entry) => entry.ownerChanged)?.previousOwnerName ?? null;
  const method = options.assignmentMethods.find((entry) => entry.code === lead.assignmentMethod)?.label ?? null;
  const idle = Boolean(lead.ownerUserId) && lead.status === "open" && !lead.firstActivityAt;

  return (
    <section className="flex flex-col gap-4">
      <PropertyList
        title="Assignment"
        columns={3}
        items={[
          { label: "Lead owner", value: lead.ownerName ?? <Badge tone="warning">Unassigned</Badge> },
          { label: "Assigned team", value: lead.teamName },
          { label: "Assigned at", value: formatDateTime(lead.assignedAt) },
          { label: "Assigned by", value: lead.assignedByName },
          { label: "Assignment method", value: method && (lead.assignmentRuleName ? `${method}: ${lead.assignmentRuleName}` : method) },
          { label: "Previous owner", value: previousOwner },
          { label: "First activity", value: lead.firstActivityAt ? formatDateTime(lead.firstActivityAt) : idle ? <Badge tone="warning">No activity yet</Badge> : null },
          { label: "Last activity", value: formatDateTime(lead.lastActivityAt) },
          { label: "Next follow-up", value: formatDateTime(lead.nextFollowUpAt) },
        ]}
      />
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Assignment history</h3>
        {query.isLoading ? <LoadingState label="Loading assignment history" rows={2} />
          : query.isError ? <ErrorBanner message="Could not load the assignment history." />
          : history.length === 0 ? <p className="text-sm text-text-secondary">This lead has not been assigned yet.</p>
          : (
            <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
              {history.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-1 px-4 py-3">
                  <span className="font-medium">
                    {[
                      entry.ownerChanged && `${entry.previousOwnerName ?? "Unassigned"} → ${entry.newOwnerName ?? "Unassigned"}`,
                      entry.teamChanged && `Team: ${entry.previousTeamName ?? "No team"} → ${entry.newTeamName ?? "No team"}`,
                    ].filter(Boolean).join(" · ")}
                  </span>
                  {entry.reason && <span className="text-text-secondary">Reason: {entry.reason}</span>}
                  <span className="text-xs text-text-muted">
                    {formatDateTime(entry.assignedAt)} · {entry.assignedByName ?? "System"} · {entry.methodLabel}{entry.ruleName ? `: ${entry.ruleName}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ transfer a user's leads

// For someone leaving or overloaded: every active lead they own goes to
// another person, to a team's queue, or back through the assignment rules.
export function TransferLeadsDialog({ isOpen, onOpenChange, options, fromUserId, onDone }: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  options: LeadOptions;
  // Preselected when the dialog is opened for a particular user.
  fromUserId?: string;
  onDone: (message: string) => void;
}) {
  const workspace = useWorkspaceContext();
  const [from, setFrom] = useState(fromUserId ?? NONE);
  const [mode, setMode] = useState("user");
  const [toUser, setToUser] = useState(NONE);
  const [toTeam, setToTeam] = useState(NONE);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const label = useWorkloadLabels(isOpen);

  const countQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", "active-count", from),
    queryFn: () => getUserActiveLeadCount(from),
    enabled: isOpen && Boolean(from),
  });
  const total = countQuery.data?.total ?? 0;
  const name = options.users.find((user) => user.id === from)?.name ?? "This user";
  const mutation = useMutation({
    mutationFn: () => transferUserLeads({
      fromUserId: from,
      reason: reason.trim() || undefined,
      ...(mode === "rules" ? { useRules: true } : mode === "team" ? { teamId: toTeam } : { toUserId: toUser }),
    }),
    onSuccess: (result) => {
      onDone(`${leadCount(result.moved)} transferred${result.unassigned ? `, ${result.unassigned} returned to the unassigned queue` : ""}.`);
      onOpenChange(false);
    },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const ready = Boolean(from) && total > 0 && (mode === "rules" || (mode === "team" ? Boolean(toTeam) : Boolean(toUser)));

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Transfer active leads" description="Open and qualified leads move; converted, disqualified and archived leads keep their owner for the record.">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <Select label="Transfer leads from" isRequired selectedKey={from} onSelectionChange={(key) => setFrom(String(key ?? NONE))}
          options={options.users.map((user) => ({ value: user.id, label: label(user, options.currentUserId) }))} />
        {from && (
          <p className="text-sm font-medium" role="status">
            {countQuery.isLoading ? "Counting leads…" : countQuery.isError ? "Could not count this user's leads." : `${name} has ${leadCount(total)} active.`}
          </p>
        )}
        <RadioGroup label="Give them to" value={mode} onChange={setMode}>
          <Radio value="user">Another salesperson</Radio>
          <Radio value="team">A team&apos;s queue (no owner yet)</Radio>
          <Radio value="rules">Run the assignment rules on each lead</Radio>
        </RadioGroup>
        {mode === "user" && (
          <Select label="New owner" isRequired selectedKey={toUser} onSelectionChange={(key) => setToUser(String(key ?? NONE))}
            options={options.users.filter((user) => user.id !== from).map((user) => ({ value: user.id, label: label(user, options.currentUserId) }))} />
        )}
        {mode === "team" && (
          <Select label="Team" isRequired selectedKey={toTeam} onSelectionChange={(key) => setToTeam(String(key ?? NONE))}
            options={options.teams.map((team) => ({ value: team.id, label: team.name }))} />
        )}
        <TextArea label="Reason" description="Optional. Kept in each lead's assignment history." value={reason} onChange={setReason} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!ready}>
            Transfer {total ? leadCount(total) : "leads"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

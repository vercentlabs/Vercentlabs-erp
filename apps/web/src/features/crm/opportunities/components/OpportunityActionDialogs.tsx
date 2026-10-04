"use client";

// The decisions made on a deal: assign it, move its stage, mark it won or
// lost, reopen it. Each is its own operation on the server; these dialogs
// collect what that operation needs.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { formatMoney } from "@/shared/format/human";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  assignOpportunity, bulkOpportunityAction, changeOpportunityStage, errorMessage, listOpportunityQuotations, markOpportunityLost, markOpportunityWon,
  reopenOpportunity, type Opportunity, type OpportunityBulkResult, type OpportunityOptions,
} from "../api/opportunities-api";
import { ErrorBanner } from "../opportunity-format";

const NO_CHANGE = "__no_change__";
const UNASSIGNED = "__unassigned__";
const NO_TEAM = "__no_team__";
const NONE = "";
const count = (ids: string[]) => `${ids.length} ${ids.length === 1 ? "opportunity" : "opportunities"}`;

type DialogProps = { isOpen: boolean; onOpenChange: (open: boolean) => void; options: OpportunityOptions };

function Actions({ onCancel, onConfirm, label, isLoading, isDisabled, danger }: {
  onCancel: () => void; onConfirm: () => void; label: string; isLoading: boolean; isDisabled?: boolean; danger?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onPress={onCancel}>Cancel</Button>
      <Button variant={danger ? "danger" : "primary"} onPress={onConfirm} isLoading={isLoading} isDisabled={isDisabled}>{label}</Button>
    </div>
  );
}

// One opportunity: saved directly, refusing if someone changed it meanwhile.
// Several: each is checked on its own and the outcome is reported per deal.
export function AssignOpportunitiesDialog({ isOpen, onOpenChange, options, opportunityIds, opportunity, onDone }: DialogProps & {
  opportunityIds: string[]; opportunity?: Opportunity; onDone: (result: OpportunityBulkResult) => void;
}) {
  const [owner, setOwner] = useState(NO_CHANGE);
  const [team, setTeam] = useState(NO_CHANGE);
  const [reason, setReason] = useState("");
  const [moveOpenActivities, setMoveOpenActivities] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const single = opportunityIds.length === 1;
  const chosenTeam = options.teams.find((entry) => entry.id === team);
  const users = chosenTeam ? options.users.filter((user) => chosenTeam.memberIds.includes(user.id)) : options.users;

  const input = {
    ...(owner !== NO_CHANGE ? { ownerUserId: owner === UNASSIGNED ? null : owner } : {}),
    ...(team !== NO_CHANGE ? { teamId: team === NO_TEAM ? null : team } : {}),
    reason: reason.trim() || undefined,
    moveOpenActivities,
  };
  const mutation = useMutation({
    mutationFn: async (): Promise<OpportunityBulkResult> => {
      if (!single) return bulkOpportunityAction({ action: "assign", opportunityIds, ...input });
      await assignOpportunity(opportunityIds[0], { ...input, expectedUpdatedAt: opportunity?.updatedAt });
      return { results: [{ opportunityId: opportunityIds[0], ok: true }], succeeded: 1, failed: 0 };
    },
    onSuccess: (result) => { setError(null); onDone(result); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={single ? "Assign opportunity" : `Assign ${count(opportunityIds)}`}
      description={opportunity ? `Current owner: ${opportunity.ownerName ?? "Unassigned"}${opportunity.teamName ? ` · Team ${opportunity.teamName}` : ""}. The stage and status do not change.` : "The stage and status of each opportunity stay as they are."}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <Select label="Team" selectedKey={team} onSelectionChange={(key) => setTeam(String(key))}
          options={[{ value: NO_CHANGE, label: "Keep current team" }, { value: NO_TEAM, label: "No team" }, ...options.teams.map((entry) => ({ value: entry.id, label: entry.name }))]} />
        <Select label="Owner" selectedKey={owner} onSelectionChange={(key) => setOwner(String(key))}
          options={[
            { value: NO_CHANGE, label: "Keep current owner" }, { value: UNASSIGNED, label: "Unassigned" },
            ...users.map((user) => ({ value: user.id, label: user.id === options.currentUserId ? `${user.name} (me)` : user.name })),
          ]} />
        <TextArea label="Reason" description="Optional. Kept in the assignment history." value={reason} onChange={setReason} />
        {owner !== NO_CHANGE && owner !== UNASSIGNED && (
          <Checkbox isSelected={moveOpenActivities} onChange={setMoveOpenActivities}>Move the previous owner&apos;s open tasks and follow-ups to the new owner</Checkbox>
        )}
        <Actions onCancel={() => onOpenChange(false)} onConfirm={() => mutation.mutate()} label="Assign" isLoading={mutation.isPending}
          isDisabled={owner === NO_CHANGE && team === NO_CHANGE} />
      </div>
    </Dialog>
  );
}

export function ChangeStageDialog({ isOpen, onOpenChange, options, opportunityIds, onDone }: DialogProps & {
  opportunityIds: string[]; onDone: (result: OpportunityBulkResult) => void;
}) {
  const [stageId, setStageId] = useState(NONE);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => bulkOpportunityAction({ action: "stage", opportunityIds, stageId }),
    onSuccess: (result) => { setError(null); onDone(result); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={`Change stage of ${count(opportunityIds)}`}
      description="Only open opportunities move. Closing a deal is done with Mark won or Mark lost on the opportunity itself.">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <Select label="Sales stage" isRequired selectedKey={stageId} onSelectionChange={(key) => setStageId(String(key ?? NONE))}
          options={options.stages.map((stage) => ({ value: stage.id, label: `${stage.name} · ${stage.probability}%` }))} />
        <Actions onCancel={() => onOpenChange(false)} onConfirm={() => mutation.mutate()} label="Change stage" isLoading={mutation.isPending} isDisabled={!stageId} />
      </div>
    </Dialog>
  );
}

// Winning needs the date it closed and the final value. The estimate is kept
// beside it, so the two can be compared later.
export function MarkWonDialog({ isOpen, onOpenChange, opportunity, onDone }: {
  isOpen: boolean; onOpenChange: (open: boolean) => void; opportunity: Opportunity; onDone: () => void;
}) {
  const workspace = useWorkspaceContext();
  const [closeDate, setCloseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [finalValue, setFinalValue] = useState(String(opportunity.amount || ""));
  const [quotationId, setQuotationId] = useState(NONE);
  const [notes, setNotes] = useState("");
  const [openTasks, setOpenTasks] = useState("keep");
  const [error, setError] = useState<string | null>(null);
  const quotations = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunity", opportunity.id, "quotations"),
    queryFn: () => listOpportunityQuotations(opportunity.id),
    enabled: isOpen && opportunity.quotationCount > 0,
  });
  const mutation = useMutation({
    mutationFn: () => markOpportunityWon(opportunity.id, {
      actualCloseDate: closeDate, finalValue, winningQuotationId: quotationId || undefined, notes: notes.trim() || undefined, expectedUpdatedAt: opportunity.updatedAt,
      openTasks: openTasks as "keep" | "cancel",
    }),
    onSuccess: () => { setError(null); onDone(); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  // Choosing the winning quotation offers its total as the final value.
  const chooseQuotation = (id: string) => {
    setQuotationId(id);
    const chosen = quotations.data?.find((entry) => entry.id === id);
    if (chosen?.total) setFinalValue(String(chosen.total));
  };
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Mark opportunity won"
      description={`${opportunity.name} · estimated ${formatMoney(opportunity.currencyCode ?? undefined, opportunity.amount)}. The probability becomes 100%.`}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <DateInput label="Close date" isRequired value={closeDate} onChange={setCloseDate} />
          <TextField label={`Final deal value (${opportunity.currencyCode ?? ""})`} isRequired inputMode="decimal" value={finalValue} onChange={setFinalValue} />
        </div>
        {(quotations.data?.length ?? 0) > 0 && (
          <Select label="Winning quotation" selectedKey={quotationId} onSelectionChange={(key) => chooseQuotation(String(key ?? NONE))}
            options={[{ value: NONE, label: "None chosen" }, ...(quotations.data ?? []).map((entry) => ({
              value: entry.id, label: `${entry.number}${entry.total !== null ? ` · ${formatMoney(entry.currencyCode ?? undefined, entry.total)}` : ""} · ${entry.status}`,
            }))]} />
        )}
        <TextArea label="Notes" value={notes} onChange={setNotes} />
        <OpenTasksChoice count={opportunity.openTaskCount} value={openTasks} onChange={setOpenTasks} won />
        <Actions onCancel={() => onOpenChange(false)} onConfirm={() => mutation.mutate()} label="Mark won" isLoading={mutation.isPending} isDisabled={!closeDate || finalValue.trim() === ""} />
      </div>
    </Dialog>
  );
}

// Losing always has a reason. "Other" needs a note; a competitor can be named.
export function MarkLostDialog({ isOpen, onOpenChange, options, opportunity, onDone }: DialogProps & { opportunity: Opportunity; onDone: () => void }) {
  const [reasonId, setReasonId] = useState(NONE);
  const [notes, setNotes] = useState("");
  const [competitorName, setCompetitorName] = useState("");
  const [closeDate, setCloseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [openTasks, setOpenTasks] = useState("cancel");
  const [error, setError] = useState<string | null>(null);
  const reason = options.lostReasons.find((entry) => entry.id === reasonId);
  const mutation = useMutation({
    mutationFn: () => markOpportunityLost(opportunity.id, {
      reasonId, actualCloseDate: closeDate, notes: notes.trim() || undefined, competitorName: competitorName.trim() || undefined, expectedUpdatedAt: opportunity.updatedAt,
      openTasks: openTasks as "keep" | "cancel",
    }),
    onSuccess: () => { setError(null); onDone(); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Mark opportunity lost"
      description="The opportunity is kept with its history and can be reopened later. The probability becomes 0%.">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Lost reason" isRequired selectedKey={reasonId} onSelectionChange={(key) => setReasonId(String(key ?? NONE))}
            options={options.lostReasons.map((entry) => ({ value: entry.id, label: entry.name }))} />
          <DateInput label="Close date" isRequired value={closeDate} onChange={setCloseDate} />
        </div>
        {reason?.asksCompetitor && <TextField label="Competitor" description="Optional. Who won the deal." value={competitorName} onChange={setCompetitorName} />}
        <TextArea label="Notes" isRequired={reason?.requiresNotes} description={reason?.requiresNotes ? "Explain the reason." : "What happened? Useful for pricing and product decisions later."} value={notes} onChange={setNotes} />
        <OpenTasksChoice count={opportunity.openTaskCount} value={openTasks} onChange={setOpenTasks} />
        <Actions danger onCancel={() => onOpenChange(false)} onConfirm={() => mutation.mutate()} label="Mark lost" isLoading={mutation.isPending}
          isDisabled={!reasonId || !closeDate || (Boolean(reason?.requiresNotes) && !notes.trim())} />
      </div>
    </Dialog>
  );
}

export function ReopenOpportunityDialog({ isOpen, onOpenChange, options, opportunity, onDone }: DialogProps & { opportunity: Opportunity; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [stageId, setStageId] = useState(NONE);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => reopenOpportunity(opportunity.id, { reason, stageId: stageId || undefined }),
    onSuccess: () => { setError(null); onDone(); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Reopen opportunity"
      description={opportunity.status === "won"
        ? "A won deal can be reopened only while it has no sales order or accepted quotation. Otherwise, create a new opportunity."
        : "The lost reason and close date stay in the history."}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <TextArea label="Why is it being reopened?" isRequired value={reason} onChange={setReason} />
        <Select label="Reopen into stage" selectedKey={stageId} onSelectionChange={(key) => setStageId(String(key ?? NONE))}
          options={[{ value: NONE, label: `The stage it was in${opportunity.stageBeforeCloseName ? ` (${opportunity.stageBeforeCloseName})` : ""}` },
            ...options.stages.map((stage) => ({ value: stage.id, label: stage.name }))]} />
        <Actions onCancel={() => onOpenChange(false)} onConfirm={() => mutation.mutate()} label="Reopen" isLoading={mutation.isPending} isDisabled={!reason.trim()} />
      </div>
    </Dialog>
  );
}

// Closing a deal never removes its open tasks silently: they are kept or cancelled.
function OpenTasksChoice({ count, value, onChange, won }: { count: number; value: string; onChange: (value: string) => void; won?: boolean }) {
  if (!count) return null;
  return (
    <Select label={`${count} open ${count === 1 ? "task" : "tasks"} on this opportunity`} selectedKey={value} onSelectionChange={(key) => onChange(String(key))}
      description={won ? "A won deal may still need work, such as the implementation handoff." : undefined}
      options={[{ value: "keep", label: "Keep them open" }, { value: "cancel", label: "Cancel them" }]} />
  );
}

// A single stage move from the opportunity page.
export async function moveStage(opportunity: Opportunity, stageId: string) {
  return changeOpportunityStage(opportunity.id, { stageId, expectedUpdatedAt: opportunity.updatedAt });
}

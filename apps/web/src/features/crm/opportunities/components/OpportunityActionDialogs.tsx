"use client";

// The decisions made on an open deal: assign it and move its stage. Each is
// its own operation on the server. Mark won, Mark lost and Reopen live with
// Won / Lost Reasons (features/crm/close-reasons).
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, Select, TextArea } from "@vercentlabs/design-system";


import {
  assignOpportunity, bulkOpportunityAction, changeOpportunityStage, errorMessage, type Opportunity, type OpportunityBulkResult, type OpportunityOptions,
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
// A single stage move from the opportunity page.
export async function moveStage(opportunity: Opportunity, stageId: string) {
  return changeOpportunityStage(opportunity.id, { stageId, expectedUpdatedAt: opportunity.updatedAt });
}

"use client";

// The light changes made from a card: stage, expected close date, owner,
// priority, probability and next step. Only what was changed is sent; the
// server saves all of it together or none of it.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, LinkButton, Select, TextField } from "@vercentlabs/design-system";

import type { Opportunity, OpportunityOptions } from "@/features/crm/opportunities/api/opportunities-api";
import { ErrorBanner, PRIORITY_OPTIONS } from "@/features/crm/opportunities/opportunity-format";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";

import { errorMessage, quickEditOpportunity, quickEditWarningOf, type QuickEditInput } from "../api/pipeline-api";

const UNASSIGNED = "__unassigned__";

export function QuickEditDialog({ opportunity, options, onClose, onSaved }: {
  opportunity: Opportunity; options: OpportunityOptions; onClose: () => void; onSaved: () => void;
}) {
  const can = options.capabilities;
  const [stageId, setStageId] = useState(opportunity.stageId);
  const [expectedCloseDate, setExpectedCloseDate] = useState(opportunity.expectedCloseDate ?? "");
  const [owner, setOwner] = useState(opportunity.ownerUserId ?? UNASSIGNED);
  const [priority, setPriority] = useState<string>(opportunity.priority);
  const [probability, setProbability] = useState(String(opportunity.probability));
  const [nextStep, setNextStep] = useState(opportunity.nextStep ?? "");
  const [error, setError] = useState<string | null>(null);
  // Set when the stage move deserves a second look; saving again goes ahead.
  const [warnings, setWarnings] = useState<string[] | null>(null);

  const canAssign = opportunity.ownerUserId ? can.reassign : can.assign;
  const probabilityValue = Number(probability);
  const probabilityValid = probability.trim() !== "" && Number.isFinite(probabilityValue) && probabilityValue >= 0 && probabilityValue <= 100;
  const stage = options.stages.find((entry) => entry.id === stageId);
  // A stage that has been deactivated is still the deal's stage until it moves.
  const stageOptions = [
    ...(options.stages.some((entry) => entry.id === opportunity.stageId) ? [] : [{ value: opportunity.stageId, label: `${opportunity.stageName ?? "Current stage"} (inactive)` }]),
    ...options.stages.map((entry) => ({ value: entry.id, label: `${entry.name} · ${entry.probability}%` })),
  ];

  const changes: QuickEditInput = {};
  if (stageId !== opportunity.stageId) changes.stageId = stageId;
  if (expectedCloseDate !== (opportunity.expectedCloseDate ?? "")) changes.expectedCloseDate = expectedCloseDate;
  if (owner !== (opportunity.ownerUserId ?? UNASSIGNED)) changes.ownerUserId = owner === UNASSIGNED ? null : owner;
  if (priority !== opportunity.priority) changes.priority = priority;
  // Sent only when typed: otherwise a new stage brings its own default probability.
  if (probabilityValid && probabilityValue !== opportunity.probability) changes.probability = probabilityValue;
  if (nextStep.trim() !== (opportunity.nextStep ?? "")) changes.nextStep = nextStep.trim();
  const dirty = Object.keys(changes).length > 0;

  const mutation = useMutation({
    mutationFn: () => quickEditOpportunity(opportunity.id, { ...changes, expectedUpdatedAt: opportunity.updatedAt, warn: warnings === null }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (failure) => {
      const found = quickEditWarningOf(failure);
      if (found) { setWarnings(found); setError(null); } else setError(errorMessage(failure));
    },
  });

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Quick edit" description={`${opportunity.name} · ${opportunity.accountName ?? "No account"}`}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        {warnings && (
          <p role="status" className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm">{warnings.join(" ")} Save again to continue.</p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Sales stage" isDisabled={!can.changeStage} selectedKey={stageId} onSelectionChange={(key) => { setStageId(String(key)); setWarnings(null); }} options={stageOptions} />
          <TextField label="Probability (%)" inputMode="numeric" isDisabled={!can.changeProbability} value={probability} onChange={setProbability}
            description={changes.stageId && changes.probability === undefined && stage ? `Becomes ${stage.probability}% with the new stage${opportunity.probabilityOverridden ? ", unless set by hand" : ""}.` : undefined}
            errorMessage={probabilityValid ? undefined : "Enter a number from 0 to 100."} />
          <DateInput label="Expected close date" value={expectedCloseDate} onChange={setExpectedCloseDate} />
          <Select label="Priority" isDisabled={!can.edit} selectedKey={priority} onSelectionChange={(key) => setPriority(String(key))} options={PRIORITY_OPTIONS} />
          <Select label="Owner" isDisabled={!canAssign} selectedKey={owner} onSelectionChange={(key) => setOwner(String(key))}
            options={[{ value: UNASSIGNED, label: "Unassigned" }, ...options.users.map((user) => ({ value: user.id, label: user.id === options.currentUserId ? `${user.name} (me)` : user.name }))]} />
          <TextField label="Next step" isDisabled={!can.edit} value={nextStep} onChange={setNextStep} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <LinkButton variant="outline" href={`/crm/opportunities/${opportunity.id}/edit`}>Edit everything</LinkButton>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!dirty || !probabilityValid}>{warnings ? "Save anyway" : "Save"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

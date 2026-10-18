"use client";

// Apply an activity plan to a lead or deal (CRM plan 5.2): each step becomes a follow-up, so many days from the start date. Shown only
// when the organization has a plan for this kind of record.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Dialog, Select } from "@vercentlabs/design-system";

import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { applyActivityPlan, errorMessage, listActivityPlans } from "./activity-types-api";

export function ApplyPlanButton({ relatedType, relatedId, onApplied }: { relatedType: "lead" | "opportunity"; relatedId: string; onApplied: () => void }) {
  const workspace = useWorkspaceContext();
  const plans = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "activity-plans", relatedType), queryFn: () => listActivityPlans({ appliesTo: relatedType }), staleTime: 60_000 });
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState("");
  const [startDate, setStartDate] = useState("");
  const apply = useMutation({
    mutationFn: () => applyActivityPlan(planId, { relatedType, relatedId, ...(startDate ? { startDate } : {}) }),
    onSuccess: () => { onApplied(); setOpen(false); },
  });
  const list = plans.data ?? [];
  if (!list.length) return null;
  const chosen = list.find((plan) => plan.id === planId);
  return (
    <>
      <Button variant="secondary" onPress={() => { setPlanId(list[0].id); setOpen(true); }}>Apply plan</Button>
      {open && (
        <Dialog isOpen onOpenChange={setOpen} title="Apply an activity plan" description="Each step is planned as a follow-up on this record, counting days from the start date.">
          <div className="flex flex-col gap-4">
            {apply.isError && <p role="alert" className="text-sm text-danger">{errorMessage(apply.error, "The plan could not be applied.")}</p>}
            <Select label="Plan" selectedKey={planId || null} onSelectionChange={(key) => setPlanId(String(key))} options={list.map((plan) => ({ value: plan.id, label: plan.name }))} />
            {chosen && <p className="text-sm text-text-secondary">{chosen.steps.map((step) => `Day ${step.offsetDays}: ${step.subject || step.activityTypeName}`).join(" · ")}</p>}
            <DateInput label="Start date" description="Optional. Today when left empty." value={startDate} onChange={setStartDate} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" isLoading={apply.isPending} isDisabled={!planId} onPress={() => apply.mutate()}>Apply plan</Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

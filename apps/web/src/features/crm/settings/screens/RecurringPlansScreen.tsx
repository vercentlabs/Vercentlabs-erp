"use client";

// CRM › Setup › Recurring plans (CRM plan 5.3): how often a deal's recurring revenue comes in. Monthly, Quarterly and Yearly are there
// from the start; add others (every 6 months, every 2 years). A plan deals use keeps its period.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button, Dialog, ErrorState, PageHeader, PermissionState, StatusBadge, TextField } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { createRecurringPlan, errorMessage, listRecurringPlans, updateRecurringPlan, type RecurringPlan } from "@/features/crm/shared/fields-api";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function RecurringPlansScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const key = scopedQueryKey(workspace, "crm", "recurring-plans", "all");
  const query = useQuery({ queryKey: key, queryFn: () => listRecurringPlans(true), enabled: canManage });
  const [editing, setEditing] = useState<RecurringPlan | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-options") });
  };
  const toggle = useMutation({ mutationFn: (plan: RecurringPlan) => updateRecurringPlan(plan.id, { isActive: !plan.isActive }), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });

  if (!canManage) return <PermissionState title="You can't manage recurring plans" description="Ask an administrator for the Manage CRM settings permission." />;
  if (query.isLoading) return <LoadingState label="Loading recurring plans" rows={3} />;
  if (query.isError) return <ErrorState title="Could not load recurring plans" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <PageHeader title="Recurring plans" description="For deals whose revenue repeats — AMCs, subscriptions, rentals. A deal names its plan and the amount per period; the pipeline shows it as monthly revenue."
        primaryAction={<Button variant="primary" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New plan</Button>} />
      {error && <Notice>{error}</Notice>}
      <ul className="flex max-w-2xl flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
        {(query.data ?? []).map((plan) => (
          <li key={plan.id} className="flex items-center justify-between gap-3 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{plan.name}</span>
              <span className="text-text-secondary">every {plan.months === 1 ? "month" : `${plan.months} months`} · {plan.dealCount ?? 0} {plan.dealCount === 1 ? "deal" : "deals"}</span>
              {!plan.isActive && <StatusBadge tone="neutral">Off</StatusBadge>}
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="compact" onPress={() => setEditing(plan)}>Edit</Button>
              <Button variant="ghost" size="compact" isDisabled={toggle.isPending} onPress={() => toggle.mutate(plan)}>{plan.isActive ? "Switch off" : "Switch on"}</Button>
            </div>
          </li>
        ))}
      </ul>
      {editing && <PlanDialog plan={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

function PlanDialog({ plan, onClose, onSaved }: { plan: RecurringPlan | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(plan?.name ?? "");
  const [months, setMonths] = useState(String(plan?.months ?? 1));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => (plan ? updateRecurringPlan(plan.id, { name, months: Number(months) }) : createRecurringPlan({ name, months: Number(months) })),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const valid = name.trim() && Number.isInteger(Number(months)) && Number(months) >= 1 && Number(months) <= 120;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={plan ? `Edit ${plan.name}` : "New recurring plan"}>
      <div className="flex flex-col gap-4">
        {error && <Notice>{error}</Notice>}
        <TextField label="Name" isRequired value={name} onChange={setName} maxLength={80} />
        <TextField label="Every (months)" isRequired inputMode="numeric" value={months} onChange={setMonths} isDisabled={Boolean(plan?.dealCount)}
          description={plan?.dealCount ? "Deals use this plan, so its period stays." : "1 for monthly, 12 for yearly."} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!valid} onPress={() => save.mutate()}>{plan ? "Save" : "Add plan"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

"use client";

// CRM › Setup › Repeat orders / AMC (CRM plan 5.3): how often a deal's repeat revenue comes in. Monthly, Quarterly and Yearly are there
// from the start; add others (every 6 months, every 2 years). A deal names its plan and the amount per period (on its form, under More
// details); its page shows that as a monthly figure, the deal dashboard adds them up, and here each plan shows its deals and what they
// bring a month. A plan deals use keeps its period.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Power } from "lucide-react";
import { Button, Dialog, ErrorState, PageHeader, PermissionState, StatusBadge, TextField } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { createRecurringPlan, errorMessage, listRecurringPlanResults, updateRecurringPlan, type RecurringPlan } from "@/features/crm/shared/fields-api";
import { formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const period = (months: number) => (months === 1 ? "Every month" : months === 12 ? "Every year" : months % 12 === 0 ? `Every ${months / 12} years` : `Every ${months} months`);
const PRESETS = [{ label: "Monthly", months: 1 }, { label: "Quarterly", months: 3 }, { label: "Half-yearly", months: 6 }, { label: "Yearly", months: 12 }, { label: "Every 2 years", months: 24 }];

export function RecurringPlansScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const key = scopedQueryKey(workspace, "crm", "recurring-plans", "all");
  const query = useQuery({ queryKey: key, queryFn: listRecurringPlanResults, enabled: canManage });
  const [editing, setEditing] = useState<RecurringPlan | "new" | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "recurring-plans") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-options") });
  };
  const toggle = useMutation({
    mutationFn: (plan: RecurringPlan) => updateRecurringPlan(plan.id, { isActive: !plan.isActive }),
    onSuccess: (plan) => { setNotice({ tone: "success", text: plan.isActive ? `${plan.name} is offered on deals again.` : `${plan.name} is switched off: no longer offered; deals on it keep it.` }); refresh(); },
    onError: (failure) => setNotice({ tone: "danger", text: errorMessage(failure) }),
  });

  if (!canManage) return <PermissionState title="You can't manage repeat plans" description="Ask an administrator for the Manage CRM settings permission." />;
  if (query.isLoading) return <LoadingState label="Loading repeat plans" rows={3} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load repeat plans" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const { plans, currency } = query.data;
  const money = (value: number) => (currency ? formatMoney(currency, value) : String(value));
  const active = plans.filter((plan) => plan.isActive);
  const off = plans.filter((plan) => !plan.isActive);
  const won = plans.reduce((sum, plan) => sum + (plan.wonMonthly ?? 0), 0);
  const open = plans.reduce((sum, plan) => sum + (plan.openMonthly ?? 0), 0);
  const wonDeals = plans.reduce((sum, plan) => sum + (plan.wonDeals ?? 0), 0);

  const row = (plan: RecurringPlan) => (
    <li key={plan.id} className="grid grid-cols-1 gap-3 p-4 text-sm md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center md:gap-4">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{plan.name}</span>{!plan.isActive && <StatusBadge tone="neutral">Off</StatusBadge>}</span>
        <span className="text-xs text-text-muted">{period(plan.months)}</span>
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-xs text-text-muted md:hidden">Deals</span>
        {plan.dealCount ? (
          <Link className="text-brand hover:underline" href={`/crm/opportunities?view=all&recurringPlanId=${plan.id}`}>
            {`${plan.dealCount} deal${plan.dealCount === 1 ? "" : "s"}`}{plan.wonDeals || plan.openDeals ? <span className="text-text-muted">{` (${plan.wonDeals ?? 0} won, ${plan.openDeals ?? 0} open)`}</span> : null}
          </Link>
        ) : <span className="text-text-muted">No deals yet</span>}
      </span>
      <span className="flex flex-col gap-0.5 tabular-nums">
        <span className="text-xs text-text-muted md:hidden">A month</span>
        <span>{plan.wonMonthly ? `${money(plan.wonMonthly)} won` : "—"}</span>
        {Boolean(plan.openMonthly) && <span className="text-xs text-text-muted">{`${money(plan.openMonthly ?? 0)} in the pipeline`}</span>}
      </span>
      <span className="grid grid-cols-2 gap-2 md:flex md:justify-end">
        <Button variant="secondary" size="compact" className="w-full md:w-auto" aria-label={`Edit ${plan.name}`} onPress={() => { setNotice(null); setEditing(plan); }}>
          <Pencil className="size-3.5" aria-hidden="true" />Edit</Button>
        <Button variant="ghost" size="compact" className="w-full md:w-auto" aria-label={`${plan.isActive ? "Switch off" : "Switch on"} ${plan.name}`} isDisabled={toggle.isPending}
          onPress={() => toggle.mutate(plan)}><Power className="size-3.5" aria-hidden="true" />{plan.isActive ? "Switch off" : "Switch on"}</Button>
      </span>
    </li>
  );

  return (
    <div className="flex flex-col gap-5">
      <SetupBackLink />
      <PageHeader title="Repeat orders / AMC" description="For deals whose revenue repeats: AMCs, subscriptions, rentals. A deal names its plan and the amount per period; CRM shows it as monthly revenue." />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {/* phone: one card, a row per figure; sm+: three cards */}
      <dl className="grid grid-cols-1 divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface sm:grid-cols-3 sm:gap-3 sm:divide-y-0 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent">
        {[
          { label: `Coming in a month (${wonDeals} won deal${wonDeals === 1 ? "" : "s"})`, value: money(won) },
          { label: "A year at that rate", value: money(won * 12) },
          { label: "A month more in the open pipeline", value: money(open) },
        ].map((figure) => (
          <div key={figure.label} className="flex items-center justify-between gap-3 px-3 py-2.5 sm:block sm:rounded-[var(--radius-card)] sm:border sm:border-border sm:bg-surface sm:p-3">
            <dt className="min-w-0 text-xs text-text-muted">{figure.label}</dt>
            <dd className="shrink-0 text-base font-semibold tabular-nums sm:mt-0.5 sm:text-lg">{figure.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{`Plans (${active.length})`}</h2>
        <Button variant="primary" className="shrink-0" onPress={() => { setNotice(null); setEditing("new"); }}><Plus className="size-4" aria-hidden="true" />New plan</Button>
      </div>
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        <div className="hidden border-b border-border bg-surface-muted px-4 py-2 text-xs font-medium text-text-secondary md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:gap-4">
          <span>Plan</span><span>Deals</span><span>Repeat revenue a month</span><span className="sr-only">Actions</span>
        </div>
        {active.length ? <ul className="flex flex-col divide-y divide-border">{active.map(row)}</ul> : <p className="p-4 text-sm text-text-secondary">No plan is switched on.</p>}
      </div>
      {off.length > 0 && (
        <Panel title={`Switched off (${off.length})`} description="Not offered on deals; the deals on them keep them.">
          <ul className="-m-4 flex flex-col divide-y divide-border">{off.map(row)}</ul>
        </Panel>
      )}
      <p className="text-xs text-text-muted">On a deal, open More details, choose the plan and enter the amount per period. Totals are in your reporting currency.</p>
      {editing && <PlanDialog plan={editing === "new" ? null : editing} onClose={() => setEditing(null)}
        onSaved={(saved, created) => { setEditing(null); setNotice({ tone: "success", text: created ? `Added ${saved.name}.` : `Saved ${saved.name}.` }); refresh(); }} />}
    </div>
  );
}

function PlanDialog({ plan, onClose, onSaved }: { plan: RecurringPlan | null; onClose: () => void; onSaved: (saved: RecurringPlan, created: boolean) => void }) {
  const [name, setName] = useState(plan?.name ?? "");
  const [months, setMonths] = useState(String(plan?.months ?? 1));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => (plan ? updateRecurringPlan(plan.id, { name, ...(plan.dealCount ? {} : { months: Number(months) }) }) : createRecurringPlan({ name, months: Number(months) })),
    onSuccess: (saved) => onSaved(saved, !plan),
    onError: (failure) => setError(errorMessage(failure)),
  });
  const locked = Boolean(plan?.dealCount);
  const valid = Boolean(name.trim()) && Number.isInteger(Number(months)) && Number(months) >= 1 && Number(months) <= 120;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={plan ? `Edit ${plan.name}` : "New repeat plan"}>
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (valid) save.mutate(); }}>
        {error && <Notice>{error}</Notice>}
        <TextField label="Name" isRequired value={name} onChange={(value) => { setName(value); setError(null); }} maxLength={80} placeholder="Half-yearly AMC" />
        <TextField label="Every (months)" isRequired inputMode="numeric" value={months} onChange={(value) => setMonths(value.replace(/\D/g, ""))} isDisabled={locked}
          description={locked ? "Deals use this plan, so its period stays. Make a new plan for another period." : `${valid ? period(Number(months)) : "1 to 120 months"}.`} />
        {!locked && (
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <Button key={preset.months} size="compact" variant={Number(months) === preset.months ? "primary" : "ghost"}
                onPress={() => { setMonths(String(preset.months)); if (!name.trim()) setName(preset.label); }}>{preset.label}</Button>
            ))}
          </div>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" isLoading={save.isPending} isDisabled={!valid || save.isPending}>{plan ? "Save" : "Add plan"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

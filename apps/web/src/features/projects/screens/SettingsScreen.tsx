"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, NumberField, PageHeader, Select } from "@vercentlabs/design-system";

import { act, ProjectsApiError, readView } from "@/features/projects/shared/client";
import { ProjectsAlert, ProjectsPanel, useCan } from "@/features/projects/shared/ProjectsUi";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

type S = Record<string, unknown>;
const TOGGLES: Array<[string, string]> = [
  ["require_time_approval", "Logged time needs approval before it counts"],
  ["require_expense_approval", "Expenses need approval before they count"],
  ["prohibit_self_approval", "Nobody can approve their own time, expense, budget or billing (segregation of duties)"],
  ["require_membership_for_time", "Only people on the project team can log time to it"],
  ["require_baseline_approval", "A baseline needs approval before it becomes the reference plan"],
  ["require_budget_approval", "Budgets and revisions need approval before they are active"],
  ["require_billing_approval", "Billing lines need approval before they are invoiced"],
  ["require_close_checks", "Completing a project checks open work, unapproved time and expenses, and unbilled work"],
];

export function ProjectsSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "settings"), queryFn: async () => (await readView<{ settings: S }>("settings")).settings });
  const [edits, setEdits] = useState<S>({});
  const form: S = { ...(query.data ?? {}), ...edits };
  const setField = (key: string, value: unknown) => setEdits((current) => ({ ...current, [key]: value }));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      act("settings-save", {
        requireTimeApproval: form.require_time_approval, requireExpenseApproval: form.require_expense_approval, prohibitSelfApproval: form.prohibit_self_approval,
        requireMembershipForTime: form.require_membership_for_time, requireBaselineApproval: form.require_baseline_approval, requireBudgetApproval: form.require_budget_approval,
        requireBillingApproval: form.require_billing_approval, requireCloseChecks: form.require_close_checks, hoursPerDay: form.hours_per_day, defaultBillingMethod: form.default_billing_method,
      }),
    onSuccess: () => { setMessage("Settings saved."); setError(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); },
    onError: (e) => { setError(e instanceof ProjectsApiError ? e.message : "This could not be saved."); setMessage(null); },
  });
  const editable = can("projects.settings.manage");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Project settings" description="Approval controls, working hours and billing defaults for this company." />
      {error && <ProjectsAlert>{error}</ProjectsAlert>}
      {message && <ProjectsAlert tone="success">{message}</ProjectsAlert>}
      <ProjectsPanel title="Controls">
        <div className="flex flex-col gap-2">
          {TOGGLES.map(([column, text]) => (
            <label key={column} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" disabled={!editable} checked={Boolean(form[column])} onChange={(e) => setField(column, e.target.checked)} />
              <span>{text}</span>
            </label>
          ))}
        </div>
      </ProjectsPanel>
      <ProjectsPanel title="Defaults">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumberField label="Working hours per day" isDisabled={!editable} value={Number(form.hours_per_day ?? 8)} onChange={(v) => setField("hours_per_day", v)} minValue={1} maxValue={24} />
          <Select label="Default billing method" isDisabled={!editable} options={["fixed_price", "time_and_material", "milestone", "non_billable"].map((v) => ({ value: v, label: v.replace(/_/g, " ") }))} selectedKey={String(form.default_billing_method ?? "non_billable")} onSelectionChange={(k) => setField("default_billing_method", String(k))} />
        </div>
        {editable && <div className="flex justify-end"><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save settings</Button></div>}
      </ProjectsPanel>
    </div>
  );
}

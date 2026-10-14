"use client";

// Which qualification criteria a lead must meet before it can be qualified.
// Sales processes differ, so each of the four is required or optional per
// organization; beside the choices, the Qualify checklist as a salesperson
// will see it. Needs the Manage CRM settings permission.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ErrorState, PageHeader, PermissionState } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, getLeadQualificationSettings, saveLeadQualificationSettings, type LeadQualificationRequirements } from "../api/leads-api";
import { ErrorBanner } from "../lead-format";
import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";

const CRITERIA: Array<{ key: keyof LeadQualificationRequirements; label: string; meaning: string }> = [
  { key: "need", label: "Need", meaning: "Need identified is Yes." },
  { key: "budget", label: "Budget", meaning: "Budget is Confirmed or Likely." },
  { key: "authority", label: "Authority", meaning: "The contact is a Decision Maker or an Influencer." },
  { key: "timeline", label: "Timeline", meaning: "A purchase timeframe is chosen and is not Unknown." },
];

export function LeadQualificationSettingsScreen() {
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.settingsManage);
  const key = scopedQueryKey(workspace, "crm", "lead-qualification-settings");
  const query = useQuery({ queryKey: key, queryFn: getLeadQualificationSettings, enabled: canManage });

  if (!canManage) return <PermissionState title="You don't have access to CRM setup" description="Ask an administrator for the Manage CRM settings permission." />;
  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <PageHeader
        title="Qualification"
        description="Choose what must be known about a lead before it can be qualified. A manager with the override permission can still qualify a lead that falls short, with a reason."
      />
      {query.isLoading ? <LoadingState label="Loading requirements" rows={4} />
        : query.isError || !query.data ? <ErrorState title="Could not load the requirements" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />
        // Re-created when the saved requirements change, so the form starts from them.
        : <RequirementsForm key={query.dataUpdatedAt} requirements={query.data} />}
    </div>
  );
}

function RequirementsForm({ requirements }: { requirements: LeadQualificationRequirements }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(requirements);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const mutation = useMutation({
    mutationFn: () => saveLeadQualificationSettings(form),
    onSuccess: () => {
      setError(null);
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead-options") });
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead") });
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <div className="grid max-w-5xl gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
    <section className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">Qualification requirements</h2>
      <ErrorBanner message={error} />
      <ul className="flex flex-col divide-y divide-border">
        {CRITERIA.map((criterion) => (
          <li key={criterion.key} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
            <Checkbox isSelected={form[criterion.key]} onChange={(checked) => { setForm({ ...form, [criterion.key]: checked }); setSaved(false); }}>
              {criterion.label} is required
            </Checkbox>
            <p className="pl-7 text-sm text-text-secondary">{form[criterion.key] ? "Required" : "Optional"} — met when: {criterion.meaning}</p>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending}>Save requirements</Button>
        {saved && <span role="status" className="text-sm text-text-secondary">Saved</span>}
      </div>
    </section>
    <aside aria-label="The Qualify checklist" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-dashed border-border bg-surface-muted p-4">
      <h2 className="text-sm font-semibold text-text">What a salesperson sees on Qualify</h2>
      <ul className="flex flex-col gap-2 text-sm">
        {CRITERIA.map((criterion) => (
          <li key={criterion.key} className="flex items-start gap-2">
            <span aria-hidden="true" className="text-text-muted">○</span>
            <span className="flex flex-col"><span className="font-medium">{criterion.label}{form[criterion.key] ? "" : " (optional)"}</span>
              <span className="text-xs text-text-secondary">{criterion.meaning}</span></span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-text-muted">{CRITERIA.some((criterion) => form[criterion.key]) ? "Qualify is offered once every required answer is met." : "Nothing is required: any lead can be qualified."}</p>
    </aside>
    </div>
  );
}

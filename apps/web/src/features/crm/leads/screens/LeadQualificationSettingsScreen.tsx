"use client";

// Which qualification criteria a lead must meet before it can be qualified.
// Sales processes differ, so each of the four is required or optional per
// organization. Needs the Manage CRM settings permission.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ErrorState, PageHeader, PermissionState } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, getLeadQualificationSettings, saveLeadQualificationSettings, type LeadQualificationRequirements } from "../api/leads-api";
import { ErrorBanner } from "../lead-format";

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
      <PageHeader
        title="Lead qualification"
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
    <section className="flex max-w-2xl flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
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
  );
}

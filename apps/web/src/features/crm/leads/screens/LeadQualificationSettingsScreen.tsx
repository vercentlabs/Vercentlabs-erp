"use client";

// Which qualification criteria a lead must meet before it can be qualified. Sales processes differ, so each of the four is required or
// optional per organization; beside the choices, the Qualify checklist exactly as the lead page shows it (the same wording as
// services/api/src/modules/crm/leads/qualification-criteria.js). Needs the Manage CRM settings permission.
// Desktop: the requirements on the left, the checklist preview on the right. Tablet and phone: one column, the requirements first; each
// requirement's Required switch sits beside it, under it on a phone.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Checkbox, ErrorState, PageHeader, PermissionState } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, getLeadQualificationSettings, saveLeadQualificationSettings, type LeadQualificationRequirements } from "../api/leads-api";
import { ErrorBanner } from "../lead-format";
import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";

// title: the requirement's name; checklist: the line the lead page shows; meaning: the answer that meets it.
const CRITERIA: Array<{ key: keyof LeadQualificationRequirements; title: string; checklist: string; meaning: string }> = [
  { key: "need", title: "Requirement", checklist: "Requirement understood", meaning: "The lead's requirement is answered Yes." },
  { key: "budget", title: "Budget", checklist: "Budget confirmed or likely", meaning: "Budget is Confirmed or Likely." },
  { key: "authority", title: "Who decides", checklist: "Who decides is known (the buyer, a manager, a parent)", meaning: "The contact is the Decision maker or an Influencer." },
  { key: "timeline", title: "When to buy", checklist: "When they will buy is known", meaning: "A purchase timeframe is chosen (not Unknown)." },
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
        : <RequirementsForm key={query.dataUpdatedAt} requirements={query.data} queryKeyFor={key} />}
    </div>
  );
}

function RequirementsForm({ requirements, queryKeyFor }: { requirements: LeadQualificationRequirements; queryKeyFor: readonly unknown[] }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(requirements);
  const [saved, setSaved] = useState(requirements);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = CRITERIA.some((criterion) => form[criterion.key] !== saved[criterion.key]);
  const requiredCount = CRITERIA.filter((criterion) => form[criterion.key]).length;
  const mutation = useMutation({
    mutationFn: () => saveLeadQualificationSettings(form),
    onSuccess: (result) => {
      setError(null);
      setSaved(result ?? form);
      setJustSaved(true);
      void queryClient.invalidateQueries({ queryKey: queryKeyFor });
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead-options") });
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead") });
    },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const set = (key: keyof LeadQualificationRequirements, value: boolean) => { setForm((current) => ({ ...current, [key]: value })); setJustSaved(false); };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
      <section aria-labelledby="qualification-requirements" className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
          <h2 id="qualification-requirements" className="text-sm font-semibold text-text">Before a lead can be qualified</h2>
          <span className="text-xs text-text-muted">{requiredCount ? `${requiredCount} of ${CRITERIA.length} required` : "Nothing required"}</span>
        </div>
        {error && <div className="px-4 pt-3"><ErrorBanner message={error} /></div>}
        <ul className="flex flex-col divide-y divide-border">
          {CRITERIA.map((criterion) => (
            <li key={criterion.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-text">{criterion.title}</span>
                  <Badge tone={form[criterion.key] ? "info" : "neutral"}>{form[criterion.key] ? "Required" : "Optional"}</Badge>
                </span>
                <span className="text-sm text-text-secondary">{`Met when: ${criterion.meaning}`}</span>
              </div>
              <Checkbox className="shrink-0" isSelected={form[criterion.key]} onChange={(checked) => set(criterion.key, checked)}>Required</Checkbox>
            </li>
          ))}
        </ul>
        {/* The save row: on a phone the button is full width. */}
        <div className="flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:items-center">
          <Button variant="primary" className="w-full sm:w-auto" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!dirty}>Save requirements</Button>
          {dirty ? <span className="text-sm text-text-secondary">Unsaved changes</span>
            : justSaved ? <span role="status" className="text-sm text-text-secondary">Saved. Leads are checked against these from now on.</span> : null}
        </div>
      </section>

      <div className="flex flex-col gap-4">
        <section aria-labelledby="qualification-preview" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <div className="flex flex-col gap-0.5">
            <h2 id="qualification-preview" className="text-sm font-semibold text-text">The Qualify checklist</h2>
            <p className="text-xs text-text-muted">What a salesperson sees on a lead, with these choices.</p>
          </div>
          <ul className="flex flex-col gap-2 text-sm">
            {[CRITERIA[0], { key: "product" as const, checklist: "Relevant product or service identified" }, ...CRITERIA.slice(1)].map((item) => {
              const required = item.key !== "product" && form[item.key];
              return (
                <li key={item.key} className="flex items-start gap-2">
                  <span aria-hidden="true" className="mt-0.5 flex size-4 shrink-0 rounded-[4px] border border-border" />
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
                    <span className="text-text">{item.checklist}</span>
                    <span className={`text-xs ${required ? "font-medium text-brand" : "text-text-muted"}`}>{required ? "Required" : "Optional"}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-border pt-3 text-xs text-text-muted">
            {requiredCount ? "Qualify is allowed once every required item is met." : "Nothing is required: any open lead can be qualified."}
          </p>
        </section>
        <section aria-labelledby="qualification-rules" className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 id="qualification-rules" className="text-sm font-semibold text-text">Good to know</h2>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-text-secondary">
            <li>A manager with the Qualify anyway permission can qualify a lead that falls short, with a reason; the reason is kept on the lead.</li>
            <li>Optional items still count towards the lead&apos;s score and suggested rating.</li>
            <li>A change applies to leads qualified from now on; leads already qualified stay qualified.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

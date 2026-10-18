"use client";

// CRM › Setup › Lead scoring (CRM plan 5.3): the points your rules give, and whether what history says about similar leads blends in.
// Every open lead is scored again when a rule or setting changes.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Badge, Button, Checkbox, Dialog, ErrorState, PageHeader, PermissionState, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { getLeadOptions } from "@/features/crm/leads/api/leads-api";
import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { createScoringRule, deleteScoringRule, errorMessage, getLeadScoring, saveLeadScoringSettings, updateScoringRule, type LeadScoring } from "@/features/crm/shared/fields-api";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const OPERATOR_LABELS: Record<string, string> = { equals: "is", contains: "mentions", is_set: "is filled in", at_least: "is at least" };

export function LeadScoringScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const key = scopedQueryKey(workspace, "crm", "lead-scoring");
  const query = useQuery({ queryKey: key, queryFn: getLeadScoring, enabled: canManage });
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const done = (result: { rescored: number }) => {
    setNotice(`${result.rescored} open ${result.rescored === 1 ? "lead was" : "leads were"} scored again.`);
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads") });
  };
  const change = useMutation({ mutationFn: (run: () => Promise<{ rescored: number }>) => run(), onSuccess: done, onError: (failure) => setNotice(errorMessage(failure)) });

  if (!canManage) return <PermissionState title="You can't manage lead scoring" description="Ask an administrator for the Manage CRM settings permission." />;
  if (query.isLoading) return <LoadingState label="Loading lead scoring" rows={4} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load lead scoring" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const { settings, rules, history } = query.data;
  const historyReady = history.closedLeads >= settings.minimumHistory;

  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <PageHeader title="Lead scoring" description="A score from 0 to 100 on every lead, to work the best ones first: points from your rules, blended with how often similar leads converted."
        primaryAction={<Button variant="primary" onPress={() => setAdding(true)}><Plus className="size-4" aria-hidden="true" />New rule</Button>} />
      {notice && <Notice tone="info">{notice}</Notice>}

      <section className="flex max-w-4xl flex-col gap-2" aria-label="Rules">
        <h2 className="text-base font-semibold">Rules</h2>
        {rules.length === 0 ? <p className="text-sm text-text-secondary">No rules yet. For example: +30 for IndiaMART, +20 for Maharashtra, +15 with a mobile number, −40 for students.</p> : (
          <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge tone={rule.points > 0 ? "success" : "danger"}>{rule.points > 0 ? `+${rule.points}` : rule.points}</Badge>
                  <span>{rule.label}</span>
                  {!rule.isActive && <StatusBadge tone="neutral">Off</StatusBadge>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="compact" isDisabled={change.isPending} onPress={() => change.mutate(() => updateScoringRule(rule.id, { isActive: !rule.isActive }))}>{rule.isActive ? "Switch off" : "Switch on"}</Button>
                  <Button variant="ghost" size="compact" aria-label={`Delete ${rule.label}`} isDisabled={change.isPending} onPress={() => change.mutate(() => deleteScoringRule(rule.id))}><Trash2 className="size-4" aria-hidden="true" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex max-w-4xl flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4" aria-label="History">
        <h2 className="text-base font-semibold">What history says</h2>
        <p className="text-sm text-text-secondary">
          {history.closedLeads} leads closed in the last year, {Math.round(history.conversionRate * 100)}% of them converted.{" "}
          {settings.useHistory ? (historyReady ? "Their conversion by source, campaign, medium and state is part of every score." : `Used from ${settings.minimumHistory} closed leads.`) : "Not used."}
        </p>
        <SettingsForm settings={settings} isSaving={change.isPending} onSave={(next) => change.mutate(() => saveLeadScoringSettings(next))} />
      </section>

      {adding && <RuleDialog scoring={query.data} onClose={() => setAdding(false)} onSaved={(result) => { setAdding(false); done(result); }} />}
    </div>
  );
}

function SettingsForm({ settings, isSaving, onSave }: { settings: LeadScoring["settings"]; isSaving: boolean; onSave: (settings: LeadScoring["settings"]) => void }) {
  const [useHistory, setUseHistory] = useState(settings.useHistory);
  const [minimum, setMinimum] = useState(String(settings.minimumHistory));
  const [hot, setHot] = useState(String(settings.hotThreshold));
  return (
    <div className="grid items-end gap-3 sm:grid-cols-[auto_10rem_10rem_auto]">
      <Checkbox isSelected={useHistory} onChange={setUseHistory}>Blend in history</Checkbox>
      <TextField label="From closed leads" inputMode="numeric" value={minimum} onChange={setMinimum} />
      <TextField label="Hot from score" inputMode="numeric" value={hot} onChange={setHot} />
      <Button variant="secondary" isLoading={isSaving} onPress={() => onSave({ useHistory, minimumHistory: Number(minimum), hotThreshold: Number(hot) })}>Save</Button>
    </div>
  );
}

function RuleDialog({ scoring, onClose, onSaved }: { scoring: LeadScoring; onClose: () => void; onSaved: (result: { rescored: number }) => void }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-options"), queryFn: getLeadOptions, staleTime: 60_000 });
  const [field, setField] = useState(scoring.fields[0]?.key ?? "sourceId");
  const definition = scoring.fields.find((entry) => entry.key === field);
  const [operator, setOperator] = useState(definition?.operators[0] ?? "equals");
  const [value, setValue] = useState("");
  const [points, setPoints] = useState("10");
  const [error, setError] = useState<string | null>(null);
  // Fields with a list to choose from.
  const choices: Array<{ value: string; label: string }> | null = field === "sourceId" ? (options.data?.sources ?? []).map((entry) => ({ value: entry.id, label: entry.name }))
    : field === "campaignId" ? (options.data?.campaigns ?? []).map((entry) => ({ value: entry.id, label: entry.name }))
    : field === "medium" ? (options.data?.mediums ?? []).map((entry) => ({ value: entry.code, label: entry.label }))
    : field === "rating" ? [{ value: "hot", label: "Hot" }, { value: "warm", label: "Warm" }, { value: "cold", label: "Cold" }]
    : field === "priority" ? [{ value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }] : null;
  const save = useMutation({
    mutationFn: () => {
      const shown = choices?.find((entry) => entry.value === value)?.label ?? value;
      const label = operator === "is_set" ? `Has ${definition?.label.toLowerCase()}` : `${definition?.label}: ${OPERATOR_LABELS[operator]} ${shown}`;
      return createScoringRule({ field, operator, value: operator === "is_set" ? null : value, points: Number(points), label });
    },
    onSuccess: onSaved,
    onError: (failure) => setError(errorMessage(failure)),
  });
  const pointsValid = Number.isInteger(Number(points)) && Number(points) !== 0 && Math.abs(Number(points)) <= 100;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="New scoring rule" description="Points are added when a lead matches; use negative points for poor fits.">
      <div className="flex flex-col gap-4">
        {error && <Notice>{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="When" selectedKey={field} onSelectionChange={(key) => {
            const next = scoring.fields.find((entry) => entry.key === String(key));
            setField(String(key)); setOperator(next?.operators[0] ?? "equals"); setValue("");
          }} options={scoring.fields.map((entry) => ({ value: entry.key, label: entry.label }))} />
          <Select label="Is" selectedKey={operator} onSelectionChange={(key) => setOperator(String(key))}
            options={(definition?.operators ?? ["equals"]).map((entry) => ({ value: entry, label: OPERATOR_LABELS[entry] ?? entry }))} />
          {operator !== "is_set" && (choices && operator === "equals"
            ? <Select label="Value" isRequired selectedKey={value || null} onSelectionChange={(key) => setValue(String(key))} options={choices} />
            : <TextField label="Value" isRequired inputMode={operator === "at_least" ? "decimal" : undefined} value={value} onChange={setValue} />)}
          <TextField label="Points" description="−100 to 100." inputMode="numeric" value={points} onChange={setPoints} isInvalid={!pointsValid} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!pointsValid || (operator !== "is_set" && !value.trim())} onPress={() => save.mutate()}>Add rule</Button>
        </div>
      </div>
    </Dialog>
  );
}

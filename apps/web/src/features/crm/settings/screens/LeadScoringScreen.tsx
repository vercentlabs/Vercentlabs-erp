"use client";

// CRM › Setup › Lead scoring (CRM plan 5.3): the points your rules give, and whether what history says about similar leads blends in.
// Every open lead is scored again when a rule or setting changes.
// Desktop: the rules and the history settings on the left, how a score is worked out on the right. Tablet and phone: one column; on a
// phone each rule's actions sit in its More menu so the row stays compact.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { AlertDialog, Badge, Button, Checkbox, Dialog, ErrorState, PageHeader, PermissionState, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { getLeadOptions } from "@/features/crm/leads/api/leads-api";
import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import {
  createScoringRule, deleteScoringRule, errorMessage, getLeadScoring, saveLeadScoringSettings, updateScoringRule, type LeadScoring, type ScoringRule,
} from "@/features/crm/shared/fields-api";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const OPERATOR_LABELS: Record<string, string> = { equals: "is", contains: "mentions", is_set: "is filled in", at_least: "is at least" };
const signed = (points: number) => (points > 0 ? `+${points}` : `−${Math.abs(points)}`);

export function LeadScoringScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const key = scopedQueryKey(workspace, "crm", "lead-scoring");
  const query = useQuery({ queryKey: key, queryFn: getLeadScoring, enabled: canManage });
  const [editing, setEditing] = useState<ScoringRule | "new" | null>(null);
  const [deleting, setDeleting] = useState<ScoringRule | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const done = (result: { rescored: number }) => {
    setNotice({ tone: "success", text: `Saved. ${result.rescored} open ${result.rescored === 1 ? "lead was" : "leads were"} scored again.` });
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads") });
  };
  const change = useMutation({
    mutationFn: (run: () => Promise<{ rescored: number }>) => run(),
    onSuccess: (result) => { setDeleting(null); done(result); },
    onError: (failure) => setNotice({ tone: "danger", text: errorMessage(failure) }),
  });

  if (!canManage) return <PermissionState title="You can't manage lead scoring" description="Ask an administrator for the Manage CRM settings permission." />;
  if (query.isLoading) return <LoadingState label="Loading lead scoring" rows={4} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load lead scoring" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const { settings, rules, history } = query.data;
  const active = rules.filter((rule) => rule.isActive);
  const historyOn = settings.useHistory && history.closedLeads >= settings.minimumHistory;
  const newRule = <Button variant="primary" className="w-full sm:w-auto" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New rule</Button>;

  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <PageHeader title="Lead scoring" description="A score from 0 to 100 on every lead, so the team works the best ones first."
        primaryAction={rules.length ? newRule : undefined} />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          <section aria-labelledby="scoring-rules" className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
              <h2 id="scoring-rules" className="text-sm font-semibold text-text">Rules</h2>
              <span className="text-xs text-text-muted">{rules.length ? `${active.length} of ${rules.length} on` : "None yet"}</span>
            </div>
            {rules.length === 0 ? (
              <div className="flex flex-col items-start gap-3 p-4">
                <p className="text-sm text-text-secondary">Give points for what makes a good lead for you. For example: +30 for IndiaMART, +20 in Maharashtra, +15 with a mobile number, −40 for students.</p>
                {newRule}
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {rules.map((rule) => (
                  <li key={rule.id} className={`flex items-center gap-3 px-4 py-3 text-sm ${rule.isActive ? "" : "bg-surface-muted"}`}>
                    <Badge tone={!rule.isActive ? "neutral" : rule.points > 0 ? "success" : "danger"}>{signed(rule.points)}</Badge>
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      <span className={rule.isActive ? "text-text" : "text-text-muted"}>{rule.label}</span>
                      {!rule.isActive && <StatusBadge tone="neutral">Off</StatusBadge>}
                    </span>
                    <div className="shrink-0 sm:hidden">
                      <MoreMenu label={`Actions for ${rule.label}`} items={[
                        { id: "edit", label: "Edit", onAction: () => setEditing(rule) },
                        { id: "toggle", label: rule.isActive ? "Switch off" : "Switch on", isDisabled: change.isPending,
                          onAction: () => change.mutate(() => updateScoringRule(rule.id, { isActive: !rule.isActive })) },
                        { id: "delete", label: "Delete", onAction: () => setDeleting(rule) },
                      ]} />
                    </div>
                    <div className="hidden shrink-0 items-center gap-1 sm:flex">
                      <Button variant="ghost" size="compact" onPress={() => setEditing(rule)}>Edit</Button>
                      <Button variant="ghost" size="compact" isDisabled={change.isPending}
                        onPress={() => change.mutate(() => updateScoringRule(rule.id, { isActive: !rule.isActive }))}>{rule.isActive ? "Switch off" : "Switch on"}</Button>
                      <Button variant="ghost" size="compact" onPress={() => setDeleting(rule)}>Delete</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="scoring-history" className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <h2 id="scoring-history" className="text-sm font-semibold text-text">What history says</h2>
                <p className="text-sm text-text-secondary">
                  {`${history.closedLeads} ${history.closedLeads === 1 ? "lead was" : "leads were"} closed in the last year; ${Math.round(history.conversionRate * 100)}% of them converted.`}
                </p>
              </div>
              <StatusBadge tone={historyOn ? "success" : "neutral"}>
                {historyOn ? "In use" : !settings.useHistory ? "Off" : `Waiting for ${settings.minimumHistory - history.closedLeads} more closed`}
              </StatusBadge>
            </div>
            <SettingsForm key={JSON.stringify(settings)} settings={settings} isSaving={change.isPending} onSave={(next) => change.mutate(() => saveLeadScoringSettings(next))} />
          </section>
        </div>

        <section aria-labelledby="scoring-how" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <h2 id="scoring-how" className="text-sm font-semibold text-text">How a score is worked out</h2>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-text-secondary">
            <li>The points of every rule the lead matches are added up, kept between 0 and 100.</li>
            <li>With history in use, how often similar leads converted (same source, campaign, medium and state) gives a second score.</li>
            <li>The lead&apos;s score is the average of the two, or the rules alone until history is in use.</li>
            <li>{`A lead scoring ${settings.hotThreshold} or more is marked hot.`}</li>
          </ol>
          <p className="border-t border-border pt-3 text-xs text-text-muted">
            A lead is scored when it is created or edited, and every open lead again when a rule or setting changes. The lead page shows why a lead has its score.
          </p>
        </section>
      </div>

      {editing && <RuleDialog scoring={query.data} rule={editing === "new" ? null : editing} onClose={() => setEditing(null)}
        onSaved={(result) => { setEditing(null); done(result); }} />}
      <AlertDialog isOpen={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)} title={`Delete "${deleting?.label ?? ""}"?`}
        description="The rule is removed and every open lead is scored again without its points. To keep it for later, switch it off instead."
        confirmLabel="Delete rule" isConfirming={change.isPending} onConfirm={() => deleting && change.mutate(() => deleteScoringRule(deleting.id))} />
    </div>
  );
}

function SettingsForm({ settings, isSaving, onSave }: { settings: LeadScoring["settings"]; isSaving: boolean; onSave: (settings: LeadScoring["settings"]) => void }) {
  const [useHistory, setUseHistory] = useState(settings.useHistory);
  const [minimum, setMinimum] = useState(String(settings.minimumHistory));
  const [hot, setHot] = useState(String(settings.hotThreshold));
  const minimumValid = Number.isInteger(Number(minimum)) && Number(minimum) >= 5 && Number(minimum) <= 10000;
  const hotValid = Number.isInteger(Number(hot)) && Number(hot) >= 1 && Number(hot) <= 100;
  const dirty = useHistory !== settings.useHistory || Number(minimum) !== settings.minimumHistory || Number(hot) !== settings.hotThreshold;
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <Checkbox isSelected={useHistory} onChange={setUseHistory}>Blend what history says into every score</Checkbox>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Start using history after" description="Closed leads needed first (5 to 10,000)." inputMode="numeric" value={minimum} onChange={setMinimum}
          isDisabled={!useHistory} isInvalid={!minimumValid} errorMessage={minimumValid ? undefined : "Enter 5 to 10,000."} />
        <TextField label="Mark a lead hot from score" description="1 to 100." inputMode="numeric" value={hot} onChange={setHot}
          isInvalid={!hotValid} errorMessage={hotValid ? undefined : "Enter 1 to 100."} />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button variant="primary" className="w-full sm:w-auto" isLoading={isSaving} isDisabled={!dirty || !minimumValid || !hotValid}
          onPress={() => onSave({ useHistory, minimumHistory: Number(minimum), hotThreshold: Number(hot) })}>Save settings</Button>
        {dirty && <span className="text-sm text-text-secondary">Unsaved changes</span>}
      </div>
    </div>
  );
}

function RuleDialog({ scoring, rule, onClose, onSaved }: { scoring: LeadScoring; rule: ScoringRule | null; onClose: () => void; onSaved: (result: { rescored: number }) => void }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-options"), queryFn: getLeadOptions, staleTime: 60_000 });
  const [field, setField] = useState(rule?.field ?? scoring.fields[0]?.key ?? "sourceId");
  const definition = scoring.fields.find((entry) => entry.key === field);
  const [operator, setOperator] = useState<string>(rule?.operator ?? definition?.operators[0] ?? "equals");
  const [value, setValue] = useState(rule?.value ?? "");
  const [points, setPoints] = useState(rule ? String(rule.points) : "10");
  const [label, setLabel] = useState(rule?.label ?? "");
  const [error, setError] = useState<string | null>(null);
  // Fields with a list to choose from.
  const choices: Array<{ value: string; label: string }> | null = field === "sourceId" ? (options.data?.sources ?? []).map((entry) => ({ value: entry.id, label: entry.name }))
    : field === "campaignId" ? (options.data?.campaigns ?? []).map((entry) => ({ value: entry.id, label: entry.name }))
    : field === "medium" ? (options.data?.mediums ?? []).map((entry) => ({ value: entry.code, label: entry.label }))
    : field === "rating" ? [{ value: "hot", label: "Hot" }, { value: "warm", label: "Warm" }, { value: "cold", label: "Cold" }]
    : field === "priority" ? [{ value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }] : null;
  const shown = choices?.find((entry) => entry.value === value)?.label ?? value;
  const suggested = operator === "is_set" ? `Has ${definition?.label.toLowerCase() ?? "it"}` : `${definition?.label ?? ""}: ${OPERATOR_LABELS[operator]} ${shown}`.trim();
  const save = useMutation({
    mutationFn: () => {
      const name = label.trim() || suggested;
      return rule
        ? updateScoringRule(rule.id, { points: Number(points), label: name, ...(operator === "is_set" ? {} : { value }) })
        : createScoringRule({ field, operator, value: operator === "is_set" ? null : value, points: Number(points), label: name });
    },
    onSuccess: onSaved,
    onError: (failure) => setError(errorMessage(failure)),
  });
  const pointsValid = Number.isInteger(Number(points)) && Number(points) !== 0 && Math.abs(Number(points)) <= 100;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={rule ? "Edit scoring rule" : "New scoring rule"}
      description="Points are added when a lead matches; use negative points for poor fits.">
      <div className="flex flex-col gap-4">
        {error && <Notice>{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* What a rule looks at is fixed once made: a different field is a different rule. */}
          <Select label="When" isDisabled={Boolean(rule)} selectedKey={field} onSelectionChange={(key) => {
            const next = scoring.fields.find((entry) => entry.key === String(key));
            setField(String(key)); setOperator(next?.operators[0] ?? "equals"); setValue("");
          }} options={scoring.fields.map((entry) => ({ value: entry.key, label: entry.label }))} />
          <Select label="Is" isDisabled={Boolean(rule)} selectedKey={operator} onSelectionChange={(key) => setOperator(String(key))}
            options={(definition?.operators ?? ["equals"]).map((entry) => ({ value: entry, label: OPERATOR_LABELS[entry] ?? entry }))} />
          {operator !== "is_set" && (choices && operator === "equals"
            ? <Select label="Value" isRequired selectedKey={value || null} onSelectionChange={(key) => setValue(String(key))} options={choices} />
            : <TextField label="Value" isRequired inputMode={operator === "at_least" ? "decimal" : undefined} value={value} onChange={setValue} />)}
          <TextField label="Points" description="−100 to 100, not 0." inputMode="numeric" value={points} onChange={setPoints} isInvalid={!pointsValid}
            errorMessage={pointsValid ? undefined : "Enter −100 to 100, not 0."} />
          <TextField className="sm:col-span-2" label="Name" description={`Shown on the lead. Empty: "${suggested}".`} value={label} onChange={setLabel} maxLength={120} />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Button variant="primary" className="w-full sm:w-auto" isLoading={save.isPending} isDisabled={!pointsValid || (operator !== "is_set" && !value.trim())}
            onPress={() => save.mutate()}>{rule ? "Save rule" : "Add rule"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

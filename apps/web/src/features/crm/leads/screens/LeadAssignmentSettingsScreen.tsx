"use client";

// Lead assignment setup: how leads get an owner (settings and fallback), the
// ordered rules that route new leads, each salesperson's workload, and
// transferring a user's leads. Needs the Manage lead assignment rules
// permission (or Manage CRM settings).
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  AlertDialog, Button, Checkbox, Dialog, ErrorState, LinkButton, PageHeader, PermissionState, Radio, RadioGroup, Select, StatusBadge, TextField,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { CountrySelect } from "@/features/crm/shared/ui/CountrySelect";
import { countryName } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  deleteLeadAssignmentRule, errorMessage, getLeadAssignmentSettings, getLeadOptions, getLeadWorkload, listLeadAssignmentRules, reorderLeadAssignmentRules,
  saveLeadAssignmentRule, saveLeadAssignmentSettings, setLeadAssignmentRuleActive,
  type LeadAssignmentRule, type LeadAssignmentSettings, type LeadOptions, type LeadRuleCondition,
} from "../api/leads-api";
import { TransferLeadsDialog } from "../components/LeadAssignment";
import { ErrorBanner, PRIORITY_OPTIONS, RATING_OPTIONS } from "../lead-format";

const NONE = "";
const VALUELESS = new Set(["is_empty", "is_not_empty"]);

function conditionText(condition: LeadRuleCondition, options: LeadOptions) {
  const field = options.ruleFields.find((entry) => entry.code === condition.field);
  const operator = options.ruleOperators.find((entry) => entry.code === condition.operator)?.label ?? condition.operator;
  if (VALUELESS.has(condition.operator)) return `${field?.label ?? condition.field} ${operator}`;
  const value = field?.kind === "source" ? options.sources.find((source) => source.id === condition.value)?.name ?? "a removed source"
    : field?.kind === "country" && condition.operator !== "contains" ? countryName(condition.value)
    : condition.value;
  return `${field?.label ?? condition.field} ${operator} ${value}`;
}

function targetText(rule: LeadAssignmentRule) {
  if (rule.targetType === "user") return rule.targetUserName ?? "A removed user";
  return rule.strategy === "round_robin" ? `Team ${rule.targetTeamName ?? ""} — each member in turn` : `Team ${rule.targetTeamName ?? ""} queue (no owner)`;
}

export function LeadAssignmentSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.leadsManageAssignmentRules) || workspace.permissions.includes(CRM_PERMISSIONS.settingsManage);
  const rulesKey = scopedQueryKey(workspace, "crm", "lead-assignment-rules");
  const optionsKey = scopedQueryKey(workspace, "crm", "lead-options");
  const rulesQuery = useQuery({ queryKey: rulesKey, queryFn: listLeadAssignmentRules, enabled: canManage });
  const optionsQuery = useQuery({ queryKey: optionsKey, queryFn: getLeadOptions, staleTime: 60_000, enabled: canManage });
  const [editing, setEditing] = useState<LeadAssignmentRule | "new" | null>(null);
  const [deleting, setDeleting] = useState<LeadAssignmentRule | null>(null);
  // Settings › Users links here with ?transferFrom=<user> before disabling someone.
  const transferFrom = useSearchParams().get("transferFrom") ?? undefined;
  const [transferring, setTransferring] = useState(Boolean(transferFrom));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: rulesKey });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads") });
  };
  const change = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => { setDeleting(null); refresh(); },
    onError: (failure) => { setDeleting(null); setError(errorMessage(failure)); },
  });

  if (!canManage)
    return <PermissionState title="You don't have access to lead assignment setup" description="Ask an administrator for the Manage lead assignment rules permission." />;
  if (rulesQuery.isLoading || optionsQuery.isLoading) return <LoadingState label="Loading assignment setup" rows={6} />;
  const options = optionsQuery.data;
  if (rulesQuery.isError || !options)
    return <ErrorState title="Could not load assignment setup" description="Refresh to try again." action={{ label: "Try again", onPress: () => { void rulesQuery.refetch(); void optionsQuery.refetch(); } }} />;

  const rules = rulesQuery.data ?? [];
  const move = (index: number, offset: number) => {
    const ids = rules.map((rule) => rule.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    change.mutate(() => reorderLeadAssignmentRules(ids));
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Lead assignment"
        description="Every lead has one owner who is responsible for it. Decide how new leads get that owner, and what happens when nothing matches."
        primaryAction={<Button variant="primary" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New rule</Button>}
        secondaryActions={
          <>
            <Button variant="outline" onPress={() => setTransferring(true)}>Transfer a user&apos;s leads</Button>
            <LinkButton variant="outline" href="/crm/settings/territories">Teams</LinkButton>
          </>
        }
      />
      <ErrorBanner message={error} />
      {notice && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">
          <p className="font-medium">{notice}</p>
          <Button variant="ghost" size="compact" onPress={() => setNotice(null)}>Dismiss</Button>
        </div>
      )}

      <SettingsSection options={options} onSaved={() => { void queryClient.invalidateQueries({ queryKey: optionsKey }); setNotice("Assignment settings saved."); }} />

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-semibold">Assignment rules</h2>
          <p className="text-sm text-text-secondary">
            Rules run from top to bottom when a lead is created, imported with &quot;run rules&quot;, or when someone chooses Run assignment rules. The first rule whose
            conditions all match decides who gets the lead. Editing a lead never reassigns it.
          </p>
        </div>
        {rules.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-dashed border-border px-4 py-6 text-center text-sm text-text-secondary">
            No rules yet. Add a rule to route leads by source, location or product interest to a salesperson or a team.
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
            {rules.map((rule, index) => (
              <li key={rule.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-col gap-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{index + 1}. {rule.name}</span>
                    <StatusBadge tone={rule.isActive ? "success" : "neutral"}>{rule.isActive ? "Active" : "Inactive"}</StatusBadge>
                  </div>
                  <p><span className="text-text-secondary">When: </span>{rule.conditions.length ? rule.conditions.map((condition) => conditionText(condition, options)).join(" and ") : "Any lead"}</p>
                  <p><span className="text-text-secondary">Assign to: </span>{targetText(rule)}</p>
                  <p className="text-xs text-text-muted">{rule.leadCount} {rule.leadCount === 1 ? "lead" : "leads"} currently assigned by this rule</p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button variant="ghost" size="compact" aria-label={`Move ${rule.name} up`} isDisabled={index === 0 || change.isPending} onPress={() => move(index, -1)}><ArrowUp className="size-4" aria-hidden="true" /></Button>
                  <Button variant="ghost" size="compact" aria-label={`Move ${rule.name} down`} isDisabled={index === rules.length - 1 || change.isPending} onPress={() => move(index, 1)}><ArrowDown className="size-4" aria-hidden="true" /></Button>
                  <Button variant="ghost" size="compact" onPress={() => setEditing(rule)}>Edit</Button>
                  <Button variant="ghost" size="compact" isDisabled={change.isPending} onPress={() => change.mutate(() => setLeadAssignmentRuleActive(rule.id, !rule.isActive))}>
                    {rule.isActive ? "Deactivate" : "Activate"}
                  </Button>
                  <Button variant="ghost" size="compact" onPress={() => setDeleting(rule)}>Delete</Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <WorkloadSection />

      {editing && <RuleDialog rule={editing === "new" ? null : editing} options={options} onClose={() => setEditing(null)} onSaved={refresh} />}
      <TransferLeadsDialog isOpen={transferring} onOpenChange={setTransferring} options={options} fromUserId={transferFrom}
        onDone={(message) => { setNotice(message); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads") }); }} />
      <AlertDialog
        isOpen={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this rule?"
        description={`"${deleting?.name ?? ""}" is removed. A rule that has already assigned leads cannot be deleted; deactivate it instead.`}
        tone="danger"
        confirmLabel="Delete rule"
        isConfirming={change.isPending}
        onConfirm={() => deleting && change.mutate(() => deleteLeadAssignmentRule(deleting.id))}
      />
    </div>
  );
}

// ------------------------------------------------------------------ settings

function SettingsSection({ options, onSaved }: { options: LeadOptions; onSaved: () => void }) {
  const workspace = useWorkspaceContext();
  const key = scopedQueryKey(workspace, "crm", "lead-assignment-settings");
  const query = useQuery({ queryKey: key, queryFn: getLeadAssignmentSettings });
  if (query.isLoading) return <LoadingState label="Loading settings" rows={3} />;
  if (query.isError || !query.data) return <ErrorBanner message="Could not load the assignment settings." />;
  // Re-created when the saved settings change, so the form starts from them.
  return <SettingsForm key={query.dataUpdatedAt} settings={query.data} options={options} onSaved={() => { void query.refetch(); onSaved(); }} />;
}

function SettingsForm({ settings, options, onSaved }: { settings: LeadAssignmentSettings; options: LeadOptions; onSaved: () => void }) {
  const [form, setForm] = useState({
    allowSelfAssignment: settings.allowSelfAssignment,
    manualCreationMode: settings.manualCreationMode as string,
    fallbackMode: settings.fallbackMode as string,
    fallbackUserId: settings.fallbackUserId ?? NONE,
    fallbackTeamId: settings.fallbackTeamId ?? NONE,
  });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(field: K) => (value: (typeof form)[K]) => { setForm((current) => ({ ...current, [field]: value })); setError(null); };
  const mutation = useMutation({
    mutationFn: () => saveLeadAssignmentSettings({
      allowSelfAssignment: form.allowSelfAssignment,
      manualCreationMode: form.manualCreationMode as LeadAssignmentSettings["manualCreationMode"],
      fallbackMode: form.fallbackMode as LeadAssignmentSettings["fallbackMode"],
      fallbackUserId: form.fallbackUserId || null,
      fallbackTeamId: form.fallbackTeamId || null,
    }),
    onSuccess: onSaved,
    onError: (failure) => setError(errorMessage(failure)),
  });
  const incomplete = (form.fallbackMode === "user" && !form.fallbackUserId) || (form.fallbackMode === "team" && !form.fallbackTeamId);

  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">How leads get an owner</h2>
      <ErrorBanner message={error} />
      <div className="grid gap-6 lg:grid-cols-2">
        <RadioGroup label="When someone adds a lead by hand" value={form.manualCreationMode} onChange={set("manualCreationMode")}>
          <Radio value="creator">The person who adds it becomes the owner</Radio>
          <Radio value="rules">Run the assignment rules</Radio>
        </RadioGroup>
        <div className="flex flex-col gap-3">
          <RadioGroup label="When no rule matches" value={form.fallbackMode} onChange={set("fallbackMode")}>
            <Radio value="unassigned">Leave the lead in the unassigned queue</Radio>
            <Radio value="user">Give it to a default user</Radio>
            <Radio value="team">Give it to a default team</Radio>
          </RadioGroup>
          {form.fallbackMode === "user" && (
            <Select label="Default user" isRequired selectedKey={form.fallbackUserId} onSelectionChange={(selected) => set("fallbackUserId")(String(selected ?? NONE))}
              options={options.users.map((user) => ({ value: user.id, label: user.name }))} />
          )}
          {form.fallbackMode === "team" && (
            <Select label="Default team" isRequired selectedKey={form.fallbackTeamId} onSelectionChange={(selected) => set("fallbackTeamId")(String(selected ?? NONE))}
              options={options.teams.map((team) => ({ value: team.id, label: team.name }))} />
          )}
        </div>
      </div>
      <Checkbox isSelected={form.allowSelfAssignment} onChange={set("allowSelfAssignment")}>
        Salespeople can take unassigned leads themselves with &quot;Assign to me&quot;
      </Checkbox>
      <div>
        <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={incomplete}>Save settings</Button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ rule builder

type ConditionRow = { field: string; operator: string; value: string };

function RuleDialog({ rule, options, onClose, onSaved }: { rule: LeadAssignmentRule | null; options: LeadOptions; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(rule?.name ?? "");
  const [isActive, setIsActive] = useState(rule?.isActive ?? true);
  const [conditions, setConditions] = useState<ConditionRow[]>(
    rule ? rule.conditions.map((condition) => ({ field: condition.field, operator: condition.operator, value: condition.value ?? "" }))
      : [{ field: "state", operator: "equals", value: "" }],
  );
  // user | team | round_robin
  const [target, setTarget] = useState(rule ? (rule.targetType === "user" ? "user" : rule.strategy === "round_robin" ? "round_robin" : "team") : "user");
  const [userId, setUserId] = useState(rule?.targetUserId ?? NONE);
  const [teamId, setTeamId] = useState(rule?.targetTeamId ?? NONE);
  const [error, setError] = useState<string | null>(null);

  const update = (index: number, patch: Partial<ConditionRow>) => {
    setConditions((current) => current.map((row, position) => (position === index ? { ...row, ...patch } : row)));
    setError(null);
  };
  const mutation = useMutation({
    mutationFn: () => saveLeadAssignmentRule(rule?.id ?? null, {
      name,
      isActive,
      conditions: conditions.map((row) => (VALUELESS.has(row.operator) ? { field: row.field, operator: row.operator } : row)),
      targetType: target === "user" ? "user" : "team",
      targetUserId: target === "user" ? userId : null,
      targetTeamId: target === "user" ? null : teamId,
      strategy: target === "round_robin" ? "round_robin" : "direct",
    }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const conditionsComplete = conditions.every((row) => VALUELESS.has(row.operator) || row.value.trim());
  const ready = Boolean(name.trim()) && conditionsComplete && (target === "user" ? Boolean(userId) : Boolean(teamId));
  const members = options.teams.find((team) => team.id === teamId)?.memberIds.length ?? 0;

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={rule ? "Edit assignment rule" : "New assignment rule"} size="lg">
      <div className="flex flex-col gap-5">
        <ErrorBanner message={error} />
        <TextField label="Rule name" isRequired value={name} onChange={setName} placeholder="For example: Maharashtra leads to Rahul" />

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">When a lead matches all of these</legend>
          {conditions.length === 0 && <p className="text-sm text-text-secondary">No conditions: this rule matches every lead that reaches it.</p>}
          {conditions.map((row, index) => {
            const field = options.ruleFields.find((entry) => entry.code === row.field);
            const operators = options.ruleOperators.filter((operator) => operator.code !== "contains" || field?.kind === "text" || field?.kind === "country");
            return (
              <div key={index} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <Select aria-label="Lead field" selectedKey={row.field} onSelectionChange={(selected) => update(index, { field: String(selected), operator: "equals", value: "" })}
                  options={options.ruleFields.map((entry) => ({ value: entry.code, label: entry.label }))} />
                <Select aria-label="Comparison" selectedKey={row.operator} onSelectionChange={(selected) => update(index, { operator: String(selected) })}
                  options={operators.map((operator) => ({ value: operator.code, label: operator.label }))} />
                {VALUELESS.has(row.operator) ? <span aria-hidden="true" />
                  : field?.kind === "source" ? (
                    <Select aria-label="Lead source" selectedKey={row.value} onSelectionChange={(selected) => update(index, { value: String(selected ?? NONE) })}
                      options={options.sources.map((source) => ({ value: source.id, label: source.name }))} />
                  ) : field?.kind === "country" && row.operator !== "contains" ? (
                    <CountrySelect label="" value={row.value} onChange={(code) => update(index, { value: code })} />
                  ) : field?.kind === "choice" ? (
                    <Select aria-label="Value" selectedKey={row.value} onSelectionChange={(selected) => update(index, { value: String(selected ?? NONE) })}
                      options={row.field === "rating" ? RATING_OPTIONS : PRIORITY_OPTIONS} />
                  ) : (
                    <TextField aria-label="Value" value={row.value} onChange={(value) => update(index, { value })} placeholder="Value" />
                  )}
                <Button variant="ghost" size="compact" aria-label="Remove condition" onPress={() => setConditions((current) => current.filter((_row, position) => position !== index))}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            );
          })}
          <div>
            <Button variant="secondary" size="compact" isDisabled={conditions.length >= 10} onPress={() => setConditions((current) => [...current, { field: "city", operator: "equals", value: "" }])}>
              <Plus className="size-4" aria-hidden="true" />Add condition
            </Button>
          </div>
        </fieldset>

        <RadioGroup label="Assign it to" value={target} onChange={setTarget}>
          <Radio value="user">One salesperson</Radio>
          <Radio value="team">A team&apos;s queue (no owner until someone takes it)</Radio>
          <Radio value="round_robin">A team, each active member in turn (round-robin)</Radio>
        </RadioGroup>
        {target === "user" ? (
          <Select label="Salesperson" isRequired selectedKey={userId} onSelectionChange={(selected) => setUserId(String(selected ?? NONE))}
            options={options.users.map((user) => ({ value: user.id, label: user.name }))} />
        ) : (
          <Select label="Team" isRequired selectedKey={teamId} onSelectionChange={(selected) => setTeamId(String(selected ?? NONE))}
            description={teamId ? `${members} ${members === 1 ? "member" : "members"}. Inactive members and people without CRM access are skipped.` : undefined}
            options={options.teams.map((team) => ({ value: team.id, label: team.name }))} />
        )}

        <Checkbox isSelected={isActive} onChange={setIsActive}>Rule is active</Checkbox>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!ready}>{rule ? "Save rule" : "Create rule"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ workload

function WorkloadSection() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "leads", "workload"), queryFn: getLeadWorkload });
  const rows = query.data ?? [];
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">Workload</h2>
        <p className="text-sm text-text-secondary">Active leads per salesperson, to share work evenly when assigning by hand.</p>
      </div>
      {query.isLoading ? <LoadingState label="Loading workload" rows={3} /> : query.isError ? <ErrorBanner message="Could not load the workload." /> : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-text-secondary">
              <tr>
                <th className="px-3 py-2 font-medium">Salesperson</th>
                {["Open leads", "Qualified", "Assigned today", "No activity (2+ days)", "Overdue follow-ups"].map((heading) => (
                  <th key={heading} className="px-3 py-2 text-right font-medium">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-text-secondary">Nobody has CRM access yet.</td></tr>}
              {rows.map((row) => (
                <tr key={row.userId}>
                  <td className="px-3 py-2 font-medium">{row.name}</td>
                  {[row.openLeads, row.qualifiedLeads, row.assignedToday, row.noActivity, row.overdueFollowUps].map((value, index) => (
                    <td key={index} className="px-3 py-2 text-right tabular-nums">{value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

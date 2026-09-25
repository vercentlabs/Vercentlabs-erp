"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, NumberField, PermissionState, Select, StatusBadge, Switch, type SelectOption } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { LoadingState } from "@/features/crm/shared/ui/LoadingState";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

import { DuplicateRuleApiError, listDuplicateRules, setDuplicateRuleEnabled, upsertDuplicateRule } from "../api/duplicate-rules-api";
import { DUPLICATE_ENTITY_TYPES, DUPLICATE_SIGNAL_CATALOG, type DuplicateEntityType, type DuplicateRule } from "../types";

const ENTITY_LABELS: Record<DuplicateEntityType, string> = { lead: "Leads", contact: "Contacts", account: "Accounts" };

const ENTITY_OPTIONS: SelectOption[] = DUPLICATE_ENTITY_TYPES.map((value) => ({ value, label: ENTITY_LABELS[value] }));

// F008 gap-closure — every organization created after migration 090
// shipped got zero rows in tenant.crm_duplicate_rules (no AFTER INSERT ON
// organizations trigger existed, unlike the sibling qualification-criteria
// and lifecycle-stage tables), so Account/Contact duplicate detection was
// silently inert for them, with no settings surface to notice or fix it —
// migration 169 closed the seeding gap; this screen closes the visibility
// gap. A rule is always one of the fixed DUPLICATE_SIGNAL_CATALOG entries:
// an admin only ever reweights/enables/disables a pre-defined comparison,
// never types a signal or method freely (mirrors the backend's own
// anti-injection design in duplicate-rules.js).
export function DuplicateRulesSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.dataQualityManage);
  const [entityType, setEntityType] = useState<DuplicateEntityType>("lead");
  const [editing, setEditing] = useState<{ signal: string; method: DuplicateRule["method"]; label: string; rule: DuplicateRule | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "duplicate-rules"), queryFn: listDuplicateRules });
  const rules = query.data?.rows ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "duplicate-rules") });
  }
  function handleError(err: unknown) {
    setError(err instanceof DuplicateRuleApiError ? err.message : "This action could not be completed.");
  }

  const toggleMutation = useMutation({
    mutationFn: (rule: DuplicateRule) => setDuplicateRuleEnabled(rule.id, !rule.enabled),
    onSuccess: invalidate,
    onError: handleError,
  });

  if (!canManage) return <PermissionState title="You don't have access to Duplicate Rules" description="Ask an administrator to grant crm.data-quality.manage." />;

  const catalog = DUPLICATE_SIGNAL_CATALOG[entityType];
  const rulesFor = (signal: string, method: string) => rules.find((rule) => rule.entityType === entityType && rule.signal === signal && rule.method === method) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-text">Duplicate matching rules</h1>
        <p className="text-sm text-text-secondary">
          Choose which signals identify a possible duplicate for each record type, how much each one weighs, and whether a match should block saving outright.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <Select label="Record type" options={ENTITY_OPTIONS} selectedKey={entityType} onSelectionChange={(key) => setEntityType((key as DuplicateEntityType) ?? "lead")} />

      {query.isLoading && <LoadingState label="Loading duplicate rules" rows={3} onRetry={() => query.refetch()} />}
      {query.isError && (
        <p role="alert" className="text-sm text-danger">
          The duplicate rules could not be loaded. <button type="button" className="underline" onClick={() => query.refetch()}>Try again</button>
        </p>
      )}

      {query.isSuccess && (
        <div className="flex flex-col gap-2">
          {catalog.map((entry) => {
            const rule = rulesFor(entry.signal, entry.method);
            return (
              <div key={`${entry.signal}:${entry.method}`} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border-strong p-3">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-text">{entry.label}</span>
                  <span className="text-xs text-text-muted">
                    {rule ? `Weight ${rule.weight}${rule.fuzzyThreshold != null ? ` · similarity threshold ${rule.fuzzyThreshold}` : ""}` : "Not configured yet — defaults to off."}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {rule?.blocking && <StatusBadge tone="danger">Blocks save</StatusBadge>}
                  {rule && (
                    <Switch isSelected={rule.enabled} onChange={() => toggleMutation.mutate(rule)} isDisabled={toggleMutation.isPending}>
                      {rule.enabled ? "On" : "Off"}
                    </Switch>
                  )}
                  <Button variant="secondary" size="compact" onPress={() => setEditing({ signal: entry.signal, method: entry.method, label: entry.label, rule })}>
                    {rule ? "Edit" : "Configure"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <RuleDialog
        key={editing ? `${editing.signal}:${editing.method}` : "closed"}
        entityType={entityType}
        editing={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={invalidate}
        onError={handleError}
      />
    </div>
  );
}

function RuleDialog({
  entityType,
  editing,
  onOpenChange,
  onSaved,
  onError,
}: {
  entityType: DuplicateEntityType;
  editing: { signal: string; method: DuplicateRule["method"]; label: string; rule: DuplicateRule | null } | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  // Number(...): weight/fuzzyThreshold both round-trip through Postgres
  // numeric columns, which node-postgres returns as strings (to avoid
  // float precision loss) — an uncoerced string value renders this
  // NumberField blank, confirmed by hitting exactly that while writing
  // this screen.
  const [weight, setWeight] = useState(Number(editing?.rule?.weight ?? 50));
  const [fuzzyThreshold, setFuzzyThreshold] = useState(Number(editing?.rule?.fuzzyThreshold ?? 0.55));
  const [blocking, setBlocking] = useState(editing?.rule?.blocking ?? false);

  const mutation = useMutation({
    mutationFn: () =>
      upsertDuplicateRule({
        entityType,
        signal: editing!.signal,
        method: editing!.method,
        weight,
        blocking,
        enabled: editing?.rule?.enabled ?? true,
        ...(editing!.method === "fuzzy" ? { fuzzyThreshold } : {}),
      }),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError,
  });

  if (!editing) return null;

  return (
    <Dialog isOpen={Boolean(editing)} onOpenChange={onOpenChange} title={editing.label}>
      <div className="flex flex-col gap-4">
        <NumberField label="Weight" description="How much this signal contributes toward a possible match, from 0 to 100." value={weight} onChange={setWeight} minValue={0} maxValue={100} />
        {editing.method === "fuzzy" && (
          <NumberField
            label="Similarity threshold"
            description="How closely two values must resemble each other to count, from 0 to 1."
            value={fuzzyThreshold}
            onChange={setFuzzyThreshold}
            minValue={0.01}
            maxValue={1}
            step={0.05}
          />
        )}
        <Switch isSelected={blocking} onChange={setBlocking}>
          Block saving outright when this signal matches (exact duplicate)
        </Switch>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending}>
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

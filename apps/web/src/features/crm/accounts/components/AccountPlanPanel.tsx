"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Plus } from "lucide-react";
import { Button, IconButton, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  AccountApiError,
  archiveAccountStakeholder,
  createAccountPlan,
  createAccountStakeholder,
  listAccountPlans,
  listAccountStakeholders,
  updateAccountPlan,
} from "../api/accounts-api";

const TIER_OPTIONS = [
  { value: "strategic", label: "Strategic" },
  { value: "key", label: "Key" },
  { value: "growth", label: "Growth" },
  { value: "standard", label: "Standard" },
];

// F002 Tranche E — crm_account_plans/crm_account_stakeholders already
// existed (003_crm_enterprise_core.sql) as registered generic resources
// with zero frontend wiring before this pass (confirmed by grep — no
// apps/web file referenced either table/resource).
export function AccountPlanPanel({ accountId, canManage }: { accountId: string; canManage: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const plansQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "account-plans", accountId),
    queryFn: () => listAccountPlans(accountId),
  });
  const plan = plansQuery.data?.rows[0] ?? null;

  const [seededFor, setSeededFor] = useState<unknown>(undefined);
  if (!dirty && plansQuery.data && plansQuery.data !== seededFor) {
    setSeededFor(plansQuery.data);
    setDraft({
      accountTier: plan?.accountTier ?? "",
      lifecycleStage: plan?.lifecycleStage ?? "",
      objectives: plan?.objectives ?? "",
      risks: plan?.risks ?? "",
      whiteSpace: plan?.whiteSpace ?? "",
      successPlan: plan?.successPlan ?? "",
    });
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "account-plans", accountId) });
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const input = { partyId: accountId, ...draft };
      return plan ? updateAccountPlan(plan.id, draft, plan.updatedAt) : createAccountPlan(input);
    },
    onSuccess: () => {
      setError(null);
      setDirty(false);
      invalidate();
    },
    onError: (err: unknown) => setError(err instanceof AccountApiError ? err.message : "The account plan could not be saved."),
  });

  if (plansQuery.isLoading) return <p className="text-sm text-text-secondary">Loading account plan…</p>;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {!plan && !canManage && <p className="text-sm text-text-muted">No account plan yet.</p>}
      {(plan || canManage) && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Account tier"
              options={TIER_OPTIONS}
              selectedKey={draft.accountTier ?? ""}
              onSelectionChange={(key) => {
                setDirty(true);
                setDraft((current) => ({ ...current, accountTier: String(key ?? "") }));
              }}
              isDisabled={!canManage}
            />
            <TextField
              label="Lifecycle stage"
              value={draft.lifecycleStage ?? ""}
              onChange={(value) => {
                setDirty(true);
                setDraft((current) => ({ ...current, lifecycleStage: value }));
              }}
              isDisabled={!canManage}
            />
          </div>
          <TextArea
            label="Objectives"
            value={draft.objectives ?? ""}
            onChange={(value) => {
              setDirty(true);
              setDraft((current) => ({ ...current, objectives: value }));
            }}
            isDisabled={!canManage}
          />
          <TextArea
            label="Risks"
            value={draft.risks ?? ""}
            onChange={(value) => {
              setDirty(true);
              setDraft((current) => ({ ...current, risks: value }));
            }}
            isDisabled={!canManage}
          />
          <TextArea
            label="White space"
            value={draft.whiteSpace ?? ""}
            onChange={(value) => {
              setDirty(true);
              setDraft((current) => ({ ...current, whiteSpace: value }));
            }}
            isDisabled={!canManage}
          />
          <TextArea
            label="Success plan"
            value={draft.successPlan ?? ""}
            onChange={(value) => {
              setDirty(true);
              setDraft((current) => ({ ...current, successPlan: value }));
            }}
            isDisabled={!canManage}
          />
          {canManage && (
            <Button variant="secondary" size="compact" className="self-start" onPress={() => saveMutation.mutate()} isLoading={saveMutation.isPending} isDisabled={!dirty}>
              {plan ? "Save plan" : "Create account plan"}
            </Button>
          )}
        </div>
      )}
      {plan && <AccountStakeholdersList accountPlanId={plan.id} canManage={canManage} />}
    </div>
  );
}

function AccountStakeholdersList({ accountPlanId, canManage }: { accountPlanId: string; canManage: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [stakeholderRole, setStakeholderRole] = useState("");

  const stakeholdersQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "account-stakeholders", accountPlanId),
    queryFn: () => listAccountStakeholders(accountPlanId),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "account-stakeholders", accountPlanId) });
  }

  const addMutation = useMutation({
    mutationFn: () => createAccountStakeholder({ accountPlanId, name, title: title || null, stakeholderRole: stakeholderRole || null }),
    onSuccess: () => {
      invalidate();
      setName("");
      setTitle("");
      setStakeholderRole("");
    },
  });
  const removeMutation = useMutation({
    mutationFn: (stakeholder: { id: string; updatedAt: string }) => archiveAccountStakeholder(stakeholder.id, stakeholder.updatedAt),
    onSuccess: invalidate,
  });

  const stakeholders = stakeholdersQuery.data?.rows ?? [];

  return (
    <div className="flex flex-col gap-2 border-t border-border-strong pt-3">
      <p className="text-sm font-medium text-text">Stakeholders</p>
      {stakeholdersQuery.isLoading && <p className="text-sm text-text-secondary">Loading stakeholders…</p>}
      {!stakeholdersQuery.isLoading && stakeholders.length === 0 && <p className="text-sm text-text-muted">No stakeholders mapped yet.</p>}
      {stakeholders.map((stakeholder) => (
        <div key={stakeholder.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2">
          <div className="flex flex-col text-sm">
            <span className="font-medium text-text">{stakeholder.name}</span>
            <span className="text-text-secondary">
              {stakeholder.title || "—"} {stakeholder.stakeholderRole ? `· ${stakeholder.stakeholderRole}` : ""}
            </span>
          </div>
          {canManage && (
            <IconButton aria-label={`Remove ${stakeholder.name}`} size="compact" variant="danger" onPress={() => removeMutation.mutate(stakeholder)}>
              <Archive className="size-4" aria-hidden="true" />
            </IconButton>
          )}
        </div>
      ))}
      {canManage && (
        <div className="flex flex-wrap items-end gap-2">
          <TextField label="Name" value={name} onChange={setName} />
          <TextField label="Title" value={title} onChange={setTitle} />
          <TextField label="Role" placeholder="e.g. champion, blocker" value={stakeholderRole} onChange={setStakeholderRole} />
          <Button variant="secondary" size="compact" onPress={() => addMutation.mutate()} isLoading={addMutation.isPending} isDisabled={!name.trim()}>
            <Plus className="size-4" aria-hidden="true" />
            Add
          </Button>
        </div>
      )}
    </div>
  );
}

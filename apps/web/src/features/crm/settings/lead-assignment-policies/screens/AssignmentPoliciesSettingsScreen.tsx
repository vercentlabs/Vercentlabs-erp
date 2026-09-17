"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { HelpCircle, Pencil, Plus, Power } from "lucide-react";
import {
  Button,
  Dialog,
  EnterpriseDataGrid,
  EnterpriseListPage,
  IconButton,
  MultiSelect,
  PermissionState,
  Select,
  StatusBadge,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import {
  AssignmentPolicyApiError,
  createLeadAssignmentPolicy,
  explainAssignmentPolicy,
  listLeadAssignmentPolicies,
  setLeadAssignmentPolicyStatus,
  updateLeadAssignmentPolicy,
} from "../api/lead-assignment-policies-api";
import type { AssignmentMode, LeadAssignmentPolicy } from "../types";

const MODE_OPTIONS: SelectOption[] = [
  { value: "fixed", label: "Fixed owner" },
  { value: "round_robin", label: "Round robin" },
  { value: "workload", label: "Workload balanced" },
  { value: "territory", label: "Territory" },
];
const GRADE_OPTIONS: SelectOption[] = [
  { value: "", label: "Any grade" },
  { value: "cold", label: "Cold" },
  { value: "warm", label: "Warm" },
  { value: "hot", label: "Hot" },
  { value: "qualified", label: "Qualified" },
];

function modeLabel(mode: AssignmentMode) {
  return MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}
function targetSummary(row: LeadAssignmentPolicy) {
  if (row.mode === "fixed") return row.assignee_name || "—";
  if (row.mode === "territory") return row.territory_name || "—";
  return row.members.length ? row.members.map((m) => m.name).join(", ") : "—";
}

// F005 Tranche I (Stage A) — the governed policy setup UI for
// tenant.crm_lead_assignment_policies, the table lead-governance.js's
// resolveLeadAssignment already reads at assignment time. This service
// (assignment-engine.js) had zero setup UI before this pass.
export function AssignmentPoliciesSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.settingsManage);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<LeadAssignmentPolicy | null>(null);
  const [explainingPolicy, setExplainingPolicy] = useState<LeadAssignmentPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-assignment-policies"), queryFn: listLeadAssignmentPolicies });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const rows = useMemo(() => [...(query.data?.rows ?? [])].sort((a, b) => a.sequence - b.sequence), [query.data]);

  const userOptions: SelectOption[] = useMemo(() => (optionsQuery.data?.options?.users ?? []).map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.id) })), [optionsQuery.data]);
  const sourceOptions: SelectOption[] = useMemo(() => [{ value: "", label: "Any source" }, ...(optionsQuery.data?.options?.sources ?? []).map((row) => ({ value: String(row.id), label: String(row.name || row.id) }))], [optionsQuery.data]);
  const territoryOptions: SelectOption[] = useMemo(() => (optionsQuery.data?.options?.territories ?? []).map((row) => ({ value: String(row.id), label: String(row.name || row.id) })), [optionsQuery.data]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead-assignment-policies") });
  }
  function handleError(err: unknown) {
    setError(err instanceof AssignmentPolicyApiError ? err.message : "This action could not be completed.");
    // A stale-write conflict means the row's local updated_at is already
    // wrong — refetch so the next attempt uses current data.
    if (err instanceof AssignmentPolicyApiError && err.code === "CRM_STALE_WRITE") invalidate();
  }

  const toggleMutation = useMutation({
    mutationFn: (row: LeadAssignmentPolicy) => setLeadAssignmentPolicyStatus(row.id, row.status === "active" ? "inactive" : "active", row.updated_at),
    onSuccess: invalidate,
    onError: handleError,
  });

  const columns: ColumnDef<LeadAssignmentPolicy, unknown>[] = useMemo(
    () => [
      { id: "sequence", header: "Order", accessorKey: "sequence" },
      { id: "name", header: "Name", accessorKey: "name", cell: ({ row }) => <span className="font-medium text-text">{row.original.name}</span> },
      { id: "mode", header: "Mode", accessorFn: (row) => modeLabel(row.mode) },
      { id: "target", header: "Target", accessorFn: targetSummary },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>{String(getValue())}</StatusBadge>,
      },
    ],
    [],
  );

  if (!canManage) return <PermissionState title="You don't have access to CRM Setup" description="Ask an administrator to grant crm.settings.manage." />;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <EnterpriseListPage
        header={{
          title: "Lead assignment rules",
          description: "Evaluated in order; the first matching, active rule assigns a new Lead's owner.",
          primaryAction: (
            <Button variant="primary" onPress={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New rule
            </Button>
          ),
        }}
      >
        <EnterpriseDataGrid<LeadAssignmentPolicy>
          aria-label="Lead assignment rules"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={query.isLoading ? "loading" : rows.length === 0 ? "empty" : "ready"}
          rowActions={(row) => (
            <span onClick={(event) => event.stopPropagation()} className="flex items-center gap-1">
              <IconButton aria-label={`Edit ${row.name}`} size="compact" variant="outline" onPress={() => setEditingPolicy(row)}>
                <Pencil className="size-4" aria-hidden="true" />
              </IconButton>
              <IconButton
                aria-label={row.status === "active" ? `Deactivate ${row.name}` : `Activate ${row.name}`}
                size="compact"
                variant={row.status === "active" ? "danger" : "outline"}
                onPress={() => toggleMutation.mutate(row)}
                isDisabled={toggleMutation.isPending}
              >
                <Power className="size-4" aria-hidden="true" />
              </IconButton>
              {(row.mode === "round_robin" || row.mode === "workload" || row.mode === "fixed") && (
                <IconButton aria-label={`Explain eligible owners for ${row.name}`} size="compact" variant="outline" onPress={() => setExplainingPolicy(row)}>
                  <HelpCircle className="size-4" aria-hidden="true" />
                </IconButton>
              )}
            </span>
          )}
        />
      </EnterpriseListPage>

      <ExplainDialog policy={explainingPolicy} onOpenChange={(open) => !open && setExplainingPolicy(null)} />

      <PolicyDialog
        isOpen={createOpen || Boolean(editingPolicy)}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditingPolicy(null);
          }
        }}
        policy={editingPolicy}
        userOptions={userOptions}
        sourceOptions={sourceOptions}
        territoryOptions={territoryOptions}
        onSaved={invalidate}
        onError={handleError}
      />
    </div>
  );
}

function PolicyDialog({
  isOpen,
  onOpenChange,
  policy,
  userOptions,
  sourceOptions,
  territoryOptions,
  onSaved,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  policy: LeadAssignmentPolicy | null;
  userOptions: SelectOption[];
  sourceOptions: SelectOption[];
  territoryOptions: SelectOption[];
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState(policy?.name ?? "");
  const [sequence, setSequence] = useState(String(policy?.sequence ?? 100));
  const [mode, setMode] = useState<AssignmentMode>(policy?.mode ?? "fixed");
  const [assigneeUserId, setAssigneeUserId] = useState(policy?.assignee_user_id ?? "");
  const [memberUserIds, setMemberUserIds] = useState<string[]>(policy?.member_user_ids ?? []);
  const [territoryId, setTerritoryId] = useState(policy?.territory_id ?? "");
  const [sourceId, setSourceId] = useState(policy?.criteria.sourceId ?? "");
  const [countryCode, setCountryCode] = useState(policy?.criteria.countryCode ?? "");
  const [industry, setIndustry] = useState(policy?.criteria.industry ?? "");
  const [leadGrade, setLeadGrade] = useState(policy?.criteria.leadGrade ?? "");

  const [seededFor, setSeededFor] = useState<LeadAssignmentPolicy | null | undefined>(undefined);
  if (isOpen && policy !== seededFor) {
    setSeededFor(policy);
    setName(policy?.name ?? "");
    setSequence(String(policy?.sequence ?? 100));
    setMode(policy?.mode ?? "fixed");
    setAssigneeUserId(policy?.assignee_user_id ?? "");
    setMemberUserIds(policy?.member_user_ids ?? []);
    setTerritoryId(policy?.territory_id ?? "");
    setSourceId(policy?.criteria.sourceId ?? "");
    setCountryCode(policy?.criteria.countryCode ?? "");
    setIndustry(policy?.criteria.industry ?? "");
    setLeadGrade(policy?.criteria.leadGrade ?? "");
  }

  const input = {
    name,
    sequence: Number(sequence) || 0,
    mode,
    assigneeUserId: mode === "fixed" ? assigneeUserId || null : null,
    memberUserIds: mode === "round_robin" || mode === "workload" ? memberUserIds : [],
    territoryId: mode === "territory" ? territoryId || null : null,
    criteria: {
      ...(sourceId ? { sourceId } : {}),
      ...(countryCode ? { countryCode } : {}),
      ...(industry ? { industry } : {}),
      ...(leadGrade ? { leadGrade } : {}),
    },
  };
  const mutation = useMutation({
    mutationFn: () => (policy ? updateLeadAssignmentPolicy(policy.id, input, policy.updated_at) : createLeadAssignmentPolicy(input)),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={policy ? `Edit ${policy.name}` : "New assignment rule"}>
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <TextField label="Order" description="Rules are evaluated in this order; the first match wins." value={sequence} onChange={setSequence} />
        <Select label="Mode" options={MODE_OPTIONS} selectedKey={mode} onSelectionChange={(key) => setMode((key as AssignmentMode) ?? "fixed")} />
        {mode === "fixed" && <Select label="Assignee" options={userOptions} selectedKey={assigneeUserId} onSelectionChange={(key) => setAssigneeUserId(String(key ?? ""))} />}
        {(mode === "round_robin" || mode === "workload") && (
          <MultiSelect label="Members" options={userOptions} value={memberUserIds} onChange={setMemberUserIds} />
        )}
        {mode === "territory" && <Select label="Territory" options={territoryOptions} selectedKey={territoryId} onSelectionChange={(key) => setTerritoryId(String(key ?? ""))} />}

        <p className="text-sm font-medium text-text">Conditions (optional — matches any Lead if left blank)</p>
        <Select label="Source" options={sourceOptions} selectedKey={sourceId} onSelectionChange={(key) => setSourceId(String(key ?? ""))} />
        <TextField label="Country code" placeholder="e.g. IN" value={countryCode} onChange={(v) => setCountryCode(v.toUpperCase())} />
        <TextField label="Industry" value={industry} onChange={setIndustry} />
        <Select label="Lead grade" options={GRADE_OPTIONS} selectedKey={leadGrade} onSelectionChange={(key) => setLeadGrade(String(key ?? "") as typeof leadGrade)} />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim()}>
            {policy ? "Save changes" : "Create rule"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// F005-CAP-001's own canonical sentence: "route a lead to the best
// eligible owner and explain why that owner won." explainLeadAssignment-
// Candidates already computed exactly this (per-candidate eligible/
// reasons) inside resolveLeadAssignment's own round_robin/workload
// resolution — this dialog is the first place a human can see it
// directly, not a new decision engine.
function ExplainDialog({ policy, onOpenChange }: { policy: LeadAssignmentPolicy | null; onOpenChange: (open: boolean) => void }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "assignment-policy-explain", policy?.id),
    queryFn: () => explainAssignmentPolicy(policy!.id),
    enabled: Boolean(policy),
  });
  const rows = query.data?.rows ?? [];

  return (
    <Dialog isOpen={Boolean(policy)} onOpenChange={onOpenChange} title={policy ? `Why would ${policy.name} choose this owner?` : "Explain"}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">
          {policy?.mode === "fixed" ? "This rule always assigns to a single fixed owner." : "Every member below is evaluated in order; the first eligible member wins."}
        </p>
        {query.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
        {!query.isLoading && rows.length === 0 && <p className="text-sm text-text-muted">No members configured on this rule.</p>}
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.userId} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-sm">
              <span className="text-text">{row.name || row.userId}</span>
              <span className="flex items-center gap-2">
                <StatusBadge tone={row.eligible ? "success" : "neutral"}>{row.eligible ? "Eligible" : "Ineligible"}</StatusBadge>
                {row.reasons.length > 0 && <span className="text-xs text-text-muted">{row.reasons.join(", ")}</span>}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}

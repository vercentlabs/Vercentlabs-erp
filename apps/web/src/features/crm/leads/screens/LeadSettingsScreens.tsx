"use client";

// CRM setup for leads: the list of lead sources, and the rules that assign
// new leads automatically. Both need the CRM settings permission.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import {
  AlertDialog, Button, Checkbox, Dialog, EnterpriseDataGrid, EnterpriseListPage, PermissionState, Select, StatusBadge, TextField,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { CountrySelect } from "@/features/crm/shared/ui/CountrySelect";
import { gridStates } from "@/features/crm/shared/ui/gridStates";
import { countryName } from "@/shared/format/human";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  createLeadSource, deleteLeadAssignmentRule, errorMessage, getLeadOptions, listLeadAssignmentRules, listLeadSources, saveLeadAssignmentRule, updateLeadSource,
  type LeadAssignmentRule, type LeadOptions, type LeadSource,
} from "../api/leads-api";
import { ErrorBanner } from "../lead-format";

const NONE = "";

function useCanManage() {
  return useWorkspaceContext().permissions.includes(CRM_PERMISSIONS.settingsManage);
}

const NoAccess = () => <PermissionState title="You don't have access to CRM setup" description="Ask an administrator for the Manage CRM settings permission." />;

// ------------------------------------------------------------------ lead sources

export function LeadSourcesSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = useCanManage();
  const key = scopedQueryKey(workspace, "crm", "lead-sources");
  const query = useQuery({ queryKey: key, queryFn: () => listLeadSources(true), enabled: canManage });
  const [editing, setEditing] = useState<LeadSource | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead-options") });
  };
  const toggle = useMutation({
    mutationFn: (source: LeadSource) => updateLeadSource(source.id, { isActive: !source.isActive }),
    onSuccess: () => { setError(null); refresh(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const rows = query.data ?? [];

  const columns = useMemo<ColumnDef<LeadSource, unknown>[]>(() => [
    { id: "name", header: "Source", accessorKey: "name", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: "description", header: "Description", accessorKey: "description", cell: ({ row }) => row.original.description ?? "" },
    { id: "leadCount", header: "Leads", accessorKey: "leadCount", cell: ({ row }) => <span className="tabular-nums">{row.original.leadCount ?? 0}</span> },
    { id: "state", header: "State", accessorKey: "isActive", cell: ({ row }) => <StatusBadge tone={row.original.isActive ? "success" : "neutral"}>{row.original.isActive ? "Active" : "Inactive"}</StatusBadge> },
  ], []);

  if (!canManage) return <NoAccess />;
  return (
    <div className="flex flex-col gap-4">
      <ErrorBanner message={error} />
      <EnterpriseListPage
        header={{
          title: "Lead sources",
          description: "Where leads come from. A source in use is never deleted; deactivate it to stop offering it on new leads.",
          primaryAction: <Button variant="primary" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New source</Button>,
        }}
      >
        <EnterpriseDataGrid<LeadSource>
          aria-label="Lead sources"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          {...gridStates(query, rows.length, "lead sources", { title: "No lead sources", description: "Add the channels your leads come from." })}
          rowActions={(row) => (
            <span className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
              <Button variant="ghost" size="compact" onPress={() => setEditing(row)}>Edit</Button>
              <Button variant="ghost" size="compact" onPress={() => toggle.mutate(row)} isDisabled={toggle.isPending}>{row.isActive ? "Deactivate" : "Activate"}</Button>
            </span>
          )}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">{row.name}</span>
                  {row.description && <span className="text-sm text-text-secondary">{row.description}</span>}
                  <span className="text-xs text-text-muted">{row.leadCount ?? 0} {row.leadCount === 1 ? "lead" : "leads"}</span>
                </div>
                <StatusBadge tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</StatusBadge>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="compact" onPress={() => setEditing(row)}>Edit</Button>
                <Button variant="secondary" size="compact" onPress={() => toggle.mutate(row)} isDisabled={toggle.isPending}>{row.isActive ? "Deactivate" : "Activate"}</Button>
              </div>
            </div>
          )}
        />
      </EnterpriseListPage>
      {editing && <SourceDialog source={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

function SourceDialog({ source, onClose, onSaved }: { source: LeadSource | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(source?.name ?? "");
  const [description, setDescription] = useState(source?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => (source ? updateLeadSource(source.id, { name, description }) : createLeadSource({ name, description })),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={source ? "Edit lead source" : "New lead source"}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <TextField label="Description" value={description} onChange={setDescription} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim()}>{source ? "Save" : "Create source"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ assignment rules

function ruleConditions(rule: LeadAssignmentRule) {
  return [
    rule.sourceName && `Source is ${rule.sourceName}`,
    rule.countryCode && `Country is ${countryName(rule.countryCode)}`,
    rule.state && `State is ${rule.state}`,
    rule.city && `City is ${rule.city}`,
    rule.productKeyword && `Interest mentions "${rule.productKeyword}"`,
  ].filter(Boolean).join(" and ");
}

export function LeadAssignmentRulesScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = useCanManage();
  const key = scopedQueryKey(workspace, "crm", "lead-assignment-rules");
  const query = useQuery({ queryKey: key, queryFn: listLeadAssignmentRules, enabled: canManage });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-options"), queryFn: getLeadOptions, staleTime: 60_000, enabled: canManage });
  const [editing, setEditing] = useState<LeadAssignmentRule | "new" | null>(null);
  const [deleting, setDeleting] = useState<LeadAssignmentRule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const remove = useMutation({
    mutationFn: (rule: LeadAssignmentRule) => deleteLeadAssignmentRule(rule.id),
    onSuccess: () => { setDeleting(null); setError(null); refresh(); },
    onError: (failure) => { setDeleting(null); setError(errorMessage(failure)); },
  });
  const rows = query.data ?? [];

  const columns = useMemo<ColumnDef<LeadAssignmentRule, unknown>[]>(() => [
    { id: "priority", header: "Order", accessorKey: "priority", cell: ({ row }) => <span className="tabular-nums">{row.original.priority}</span> },
    { id: "name", header: "Rule", accessorKey: "name", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: "when", header: "When a new lead", accessorFn: ruleConditions },
    { id: "assign", header: "Assign to", accessorFn: (rule) => [rule.ownerName, rule.teamName && `Team ${rule.teamName}`].filter(Boolean).join(" · ") },
    { id: "state", header: "State", accessorKey: "isActive", cell: ({ row }) => <StatusBadge tone={row.original.isActive ? "success" : "neutral"}>{row.original.isActive ? "Active" : "Inactive"}</StatusBadge> },
  ], []);

  if (!canManage) return <NoAccess />;
  return (
    <div className="flex flex-col gap-4">
      <ErrorBanner message={error} />
      <EnterpriseListPage
        header={{
          title: "Lead assignment rules",
          description: "When a lead is created without an owner, the first active rule it matches (lowest order number first) decides who gets it. A lead that matches no rule stays with its creator, or unassigned when imported.",
          primaryAction: <Button variant="primary" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New rule</Button>,
        }}
      >
        <EnterpriseDataGrid<LeadAssignmentRule>
          aria-label="Lead assignment rules"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          {...gridStates(query, rows.length, "assignment rules", {
            title: "No assignment rules",
            description: "Add a rule to route leads by source, location or product interest to a salesperson or team.",
          })}
          rowActions={(row) => (
            <span className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
              <Button variant="ghost" size="compact" onPress={() => setEditing(row)}>Edit</Button>
              <Button variant="ghost" size="compact" onPress={() => setDeleting(row)}>Delete</Button>
            </span>
          )}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{row.priority}. {row.name}</span>
                <StatusBadge tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</StatusBadge>
              </div>
              <p><span className="text-text-secondary">When a new lead: </span>{ruleConditions(row)}</p>
              <p><span className="text-text-secondary">Assign to: </span>{[row.ownerName, row.teamName && `Team ${row.teamName}`].filter(Boolean).join(" · ")}</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="compact" onPress={() => setEditing(row)}>Edit</Button>
                <Button variant="secondary" size="compact" onPress={() => setDeleting(row)}>Delete</Button>
              </div>
            </div>
          )}
        />
      </EnterpriseListPage>
      {editing && optionsQuery.data && <RuleDialog rule={editing === "new" ? null : editing} options={optionsQuery.data} onClose={() => setEditing(null)} onSaved={refresh} />}
      <AlertDialog
        isOpen={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this rule?"
        description={`"${deleting?.name ?? ""}" will stop assigning new leads. Leads already assigned keep their owner.`}
        tone="danger"
        confirmLabel="Delete rule"
        isConfirming={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </div>
  );
}

function RuleDialog({ rule, options, onClose, onSaved }: { rule: LeadAssignmentRule | null; options: LeadOptions; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: rule?.name ?? "",
    priority: String(rule?.priority ?? 100),
    isActive: rule?.isActive ?? true,
    sourceId: rule?.sourceId ?? NONE,
    countryCode: rule?.countryCode?.trim() ?? "",
    state: rule?.state ?? "",
    city: rule?.city ?? "",
    productKeyword: rule?.productKeyword ?? "",
    ownerUserId: rule?.ownerUserId ?? NONE,
    teamId: rule?.teamId ?? NONE,
  });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(field: K) => (value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError(null);
  };
  const mutation = useMutation({
    mutationFn: () => saveLeadAssignmentRule(rule?.id ?? null, { ...form, priority: Number(form.priority), sourceId: form.sourceId || null, ownerUserId: form.ownerUserId || null, teamId: form.teamId || null }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const hasCondition = Boolean(form.sourceId || form.countryCode || form.state.trim() || form.city.trim() || form.productKeyword.trim());
  const hasTarget = Boolean(form.ownerUserId || form.teamId);

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={rule ? "Edit assignment rule" : "New assignment rule"} size="lg">
      <div className="flex flex-col gap-5">
        <ErrorBanner message={error} />
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <TextField label="Rule name" isRequired value={form.name} onChange={set("name")} />
          <TextField label="Order" description="Lower runs first." inputMode="numeric" value={form.priority} onChange={set("priority")} />
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">When a new lead matches all of these</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Lead source" selectedKey={form.sourceId} onSelectionChange={(key) => set("sourceId")(String(key ?? NONE))}
              options={[{ value: NONE, label: "Any source" }, ...options.sources.map((source) => ({ value: source.id, label: source.name }))]} />
            <CountrySelect value={form.countryCode} onChange={set("countryCode")} />
            <TextField label="State" value={form.state} onChange={set("state")} />
            <TextField label="City" value={form.city} onChange={set("city")} />
            <TextField label="Product / service interest contains" className="sm:col-span-2" value={form.productKeyword} onChange={set("productKeyword")} placeholder="For example: payroll" />
          </div>
          {!hasCondition && <p className="text-sm text-text-secondary">Add at least one condition.</p>}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">Assign it to</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Salesperson" selectedKey={form.ownerUserId} onSelectionChange={(key) => set("ownerUserId")(String(key ?? NONE))}
              options={[{ value: NONE, label: "Nobody (team queue)" }, ...options.users.map((user) => ({ value: user.id, label: user.name }))]} />
            <Select label="Team" selectedKey={form.teamId} onSelectionChange={(key) => set("teamId")(String(key ?? NONE))}
              options={[{ value: NONE, label: "No team" }, ...options.teams.map((team) => ({ value: team.id, label: team.name }))]} />
          </div>
          {!hasTarget && <p className="text-sm text-text-secondary">Choose a salesperson, a team, or both.</p>}
        </fieldset>

        <Checkbox isSelected={form.isActive} onChange={set("isActive")}>Rule is active</Checkbox>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!form.name.trim() || !hasCondition || !hasTarget}>
            {rule ? "Save rule" : "Create rule"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

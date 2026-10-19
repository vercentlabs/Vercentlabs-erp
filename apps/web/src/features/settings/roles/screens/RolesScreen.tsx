"use client";

// Settings › Roles and permissions. A role is a named set of permissions; people get roles in Users. Built-in roles are ready-made and
// kept up to date by Vercentlabs, so they are viewed (and copied), never edited; custom roles are the organization's own. Roles are
// grouped by the app they are for, with search, an app filter and Built-in / Custom, and every role opens to the permissions it grants.
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, CircleHelp, Copy, Eye, Layers, Pencil, RotateCcw, ShieldAlert, ShieldCheck, ShieldHalf, Sparkles, Trash2, UserCheck, Users } from "lucide-react";
import {
  AlertDialog, Badge, Button, Checkbox, Dialog, EmptyState, ErrorState, NoResultsState, PageHeader, PermissionState, SearchField, Select, TextField,
} from "@vercentlabs/design-system";
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";

import { LoadingState } from "@/shared/ui/LoadingState";

import {
  archiveRole, createRole, listArchivedRoles, listPermissionCatalog, listRoles, restoreRole, updateRole, RolesApiError,
  type PermissionCatalogEntry, type RoleInput, type RoleRow,
} from "../api/roles-api";
import { AccessReports } from "../components/AccessReports";
import { PermissionMatrix } from "../components/PermissionMatrix";
import { RecordAccessEditor } from "../components/RecordAccess";
import { RoleDetailDialog } from "../components/RoleDetailDialog";

const ROLES_QUERY_KEY = ["settings", "roles"];
const PERMISSIONS_QUERY_KEY = ["settings", "roles", "permissions"];

type Risk = "standard" | "sensitive" | "privileged";
// What each level means, shown in the legend, on every role and in the editor.
const RISKS: Record<Risk, { label: string; tone: "success" | "warning" | "danger"; meaning: string; icon: typeof ShieldCheck }> = {
  standard: { label: "Standard", tone: "success", meaning: "Everyday work in an app.", icon: ShieldCheck },
  sensitive: { label: "Sensitive", tone: "warning", meaning: "Sees or changes money, prices or personal data.", icon: ShieldHalf },
  privileged: { label: "Privileged", tone: "danger", meaning: "Runs the organization: users, roles, settings or approvals.", icon: ShieldAlert },
};
const riskOf = (value: string): Risk => (value in RISKS ? (value as Risk) : "standard");

// Derived from the one module catalogue (@vercentlabs/shared-types) — never a local list.
const MODULE_OPTIONS = [
  { value: "platform", label: "Platform (whole organization)" },
  ...ERP_MODULE_CATALOG.map((module) => ({ value: module.key, label: module.name })),
];
const MODULE_LABEL = new Map(MODULE_OPTIONS.map((option) => [option.value, option.label]));
const MODULE_ORDER = new Map(MODULE_OPTIONS.map((option, index) => [option.value, index]));
const ALL = "all";
type Focus = "all" | "in_use" | "custom" | "privileged";

type EditorState = { mode: "create" } | { mode: "edit"; role: RoleRow };
type Tab = "roles" | "matrix" | "reports" | "archived";
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const people = (count: number) => `${count} ${count === 1 ? "person" : "people"}`;

// canSeeUsers: the User access report (users.view).
export function RolesScreen({ canManage, canEdit, canSeeUsers = false }: { canManage: boolean; canEdit: boolean; canSeeUsers?: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ROLES_QUERY_KEY, queryFn: listRoles, enabled: canManage });
  const permissionsQuery = useQuery({ queryKey: PERMISSIONS_QUERY_KEY, queryFn: listPermissionCatalog, enabled: canManage, staleTime: 5 * 60_000 });
  const catalog = useMemo(() => new Map((permissionsQuery.data?.permissions ?? []).map((entry) => [entry.key, entry])), [permissionsQuery.data]);

  const [tab, setTab] = useState<Tab>("roles");
  const [search, setSearch] = useState("");
  const [appFilter, setAppFilter] = useState(ALL);
  const [focus, setFocus] = useState<Focus>("all");
  const [showGuide, setShowGuide] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [viewing, setViewing] = useState<RoleRow | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<RoleRow | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [moduleKey, setModuleKey] = useState("platform");
  const [riskLevel, setRiskLevel] = useState<Risk>("standard");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);

  function openEditor(state: EditorState, from?: RoleRow, copy = false) {
    setEditor(state);
    setName(from ? (copy ? `${from.name} (custom)` : from.name) : "");
    setDescription(from?.description ?? "");
    setModuleKey(from?.module_key ?? "platform");
    setRiskLevel(from ? riskOf(from.risk_level) : "standard");
    setSelectedPermissions(from ? [...from.permission_keys] : []);
    setFormError(null);
    setAcknowledgeWarnings(false);
  }
  const openCreate = () => openEditor({ mode: "create" });
  const openCopy = (role: RoleRow) => { setViewing(null); openEditor({ mode: "create" }, role, true); };
  const openEdit = (role: RoleRow) => { setViewing(null); openEditor({ mode: "edit", role }, role); };

  const saveMutation = useMutation({
    mutationFn: () => {
      const input: RoleInput = { name, description, moduleKey, riskLevel, permissionKeys: selectedPermissions, acknowledgeWarningConflicts: acknowledgeWarnings,
        ...(editor?.mode === "edit" ? { expectedVersion: editor.role.version } : {}) };
      return editor?.mode === "edit" ? updateRole(editor.role.id, input) : createRole(input);
    },
    onSuccess: () => {
      setEditor(null);
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
    onError: (error: unknown) => {
      if (error instanceof RolesApiError && error.code === "ACCESS_ADMIN_ROLE_STALE") void queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
      if (error instanceof RolesApiError && error.code === "ACCESS_ADMIN_SOD_WARNING") {
        setFormError(`${error.message} Tick "Acknowledge conflicts" and save again if this is intentional.`);
        return;
      }
      setFormError(error instanceof RolesApiError ? error.message : "The role could not be saved.");
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (role: RoleRow) => archiveRole(role.id),
    onSuccess: () => {
      setArchiveTarget(null);
      setPageError(null);
      void queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
    onError: (error: unknown) => {
      setArchiveTarget(null);
      setPageError(error instanceof RolesApiError ? error.message : "The role could not be removed.");
    },
  });

  const roles = useMemo(() => query.data?.roles ?? [], [query.data]);
  const term = search.trim().toLowerCase();
  const shown = roles.filter((role) =>
    (appFilter === ALL || role.module_key === appFilter)
    && (focus === "all" || (focus === "custom" ? !role.is_system : focus === "in_use" ? role.assigned_user_count > 0 : role.risk_level === "privileged"))
    && (!term || `${role.name} ${role.description} ${MODULE_LABEL.get(role.module_key) ?? ""}`.toLowerCase().includes(term)));
  const groups = useMemo(() => {
    const byApp = new Map<string, RoleRow[]>();
    for (const role of shown) byApp.set(role.module_key, [...(byApp.get(role.module_key) ?? []), role]);
    return [...byApp.entries()]
      .sort(([a], [b]) => (MODULE_ORDER.get(a) ?? 99) - (MODULE_ORDER.get(b) ?? 99))
      .map(([key, list]) => ({ key, label: MODULE_LABEL.get(key) ?? key, roles: list.sort((x, y) => Number(y.is_system) - Number(x.is_system) || x.name.localeCompare(y.name)) }));
  }, [shown]);
  const appsInUse = MODULE_OPTIONS.filter((option) => roles.some((role) => role.module_key === option.value));
  const customCount = roles.filter((role) => !role.is_system).length;
  // The tiles at the top: each a count and a one-click filter.
  const tiles: Array<{ key: Focus; label: string; count: number; icon: typeof Layers; tone: string; selected: string }> = [
    { key: "all", label: "All roles", count: roles.length, icon: Layers, tone: "bg-brand-soft text-brand", selected: "border-brand bg-brand-soft ring-1 ring-brand" },
    { key: "in_use", label: "In use", count: roles.filter((role) => role.assigned_user_count > 0).length, icon: UserCheck, tone: "bg-success-soft text-success", selected: "border-success bg-success-soft ring-1 ring-success" },
    { key: "custom", label: "Custom", count: customCount, icon: Sparkles, tone: "bg-info-soft text-info", selected: "border-info bg-info-soft ring-1 ring-info" },
    { key: "privileged", label: "Privileged", count: roles.filter((role) => role.risk_level === "privileged").length, icon: ShieldAlert, tone: "bg-danger-soft text-danger", selected: "border-danger bg-danger-soft ring-1 ring-danger" },
  ];
  const filtering = Boolean(term) || appFilter !== ALL || focus !== "all";
  const toggleGroup = (key: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  if (!canManage)
    return (
      <div className="flex flex-1 flex-col gap-6">
        <PermissionState title="You don't have access to Roles and permissions" description="Ask an administrator for access to view roles." />
      </div>
    );

  return (
    <div className="flex flex-1 flex-col gap-5">
      <PageHeader
        title="Roles and permissions"
        description={canEdit
          ? "What each role lets people do. Give people their roles in Users."
          : "What each role lets people do. Only organization owners and system administrators can change roles."}
        primaryAction={canEdit && <Button variant="primary" onPress={openCreate}>New role</Button>}
      />

      <div className="-mt-3 flex flex-col gap-2">
        <button type="button" aria-expanded={showGuide} onClick={() => setShowGuide((open) => !open)}
          className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand">
          <CircleHelp className="size-4" aria-hidden="true" />How roles work
          <ChevronDown className={`size-4 transition-transform ${showGuide ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {showGuide && (
          <section aria-label="How roles work" className="grid gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 md:grid-cols-[1.3fr_1fr]">
            <ul className="flex flex-col gap-1.5 text-sm text-text-secondary">
              <li><span className="font-medium text-text">A role is a set of permissions.</span> A person can hold more than one; they can do everything their roles allow.</li>
              <li><span className="font-medium text-text">Built-in roles</span> are ready-made for each app and kept up to date by Vercentlabs, so they can&apos;t be edited.</li>
              <li><span className="font-medium text-text">Need something different?</span> Copy a built-in role into a custom role and change it, or start a new one.</li>
              <li><span className="font-medium text-text">Record access</span> decides whose records a role reaches in CRM, Sales, Procurement and Projects: their own, their team&apos;s or everyone&apos;s.</li>
            </ul>
            <dl className="flex flex-col gap-1.5 text-sm">
              {(Object.keys(RISKS) as Risk[]).map((key) => (
                <div key={key} className="flex items-start gap-2">
                  <dt className="w-24 shrink-0"><Badge tone={RISKS[key].tone}>{RISKS[key].label}</Badge></dt>
                  <dd className="text-text-secondary">{RISKS[key].meaning}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>

      {pageError && <p role="alert" className="rounded-[var(--radius-control)] bg-danger-soft px-3 py-2 text-sm text-danger">{pageError}</p>}

      <div role="tablist" aria-label="Roles and permissions" className="-mb-1 flex gap-1 overflow-x-auto border-b border-border">
        {([["roles", "Roles"], ["matrix", "Permission matrix"], ["reports", "Reports"], ["archived", "Archived"]] as Array<[Tab, string]>).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand ${tab === key ? "border-brand text-brand" : "border-transparent text-text-secondary hover:text-text"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "matrix" && (permissionsQuery.isLoading || query.isLoading ? <LoadingState label="Loading the matrix" rows={6} />
        : <PermissionMatrix roles={roles} catalog={permissionsQuery.data?.permissions ?? []} />)}
      {tab === "reports" && <AccessReports appLabel={(key) => MODULE_LABEL.get(key) ?? key} canSeeUsers={canSeeUsers} />}
      {tab === "archived" && <ArchivedRoles canEdit={canEdit} onRestored={() => void queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY })} />}

      {tab === "roles" && (<>
      <section aria-label="Role summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          const selected = focus === tile.key;
          return (
            <button key={tile.key} type="button" aria-pressed={selected} onClick={() => setFocus(selected && tile.key !== "all" ? "all" : tile.key)}
              className={`flex items-center gap-3 rounded-[var(--radius-card)] border p-3 text-left outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand ${selected ? tile.selected : "border-border bg-surface"}`}>
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${tile.tone}`}><Icon className="size-4" aria-hidden="true" /></span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-xs font-medium text-text-secondary">{tile.label}</span>
                <span className="text-xl font-semibold tabular-nums text-text">{query.isLoading ? "–" : tile.count}</span>
              </span>
            </button>
          );
        })}
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchField aria-label="Search roles" placeholder="Search roles" className="w-full sm:max-w-sm sm:flex-1" value={search} onChange={setSearch} />
        <div className="w-full sm:w-56">
          <Select aria-label="App" selectedKey={appFilter} onSelectionChange={(key) => setAppFilter(String(key))}
            options={[{ value: ALL, label: "All apps" }, ...appsInUse]} />
        </div>
        {filtering && (
          <button type="button" onClick={() => { setSearch(""); setAppFilter(ALL); setFocus("all"); }}
            className="self-start text-sm font-medium text-text-secondary outline-none hover:text-brand hover:underline focus-visible:ring-2 focus-visible:ring-brand sm:self-center">
            Clear filters
          </button>
        )}
        <span className="text-sm text-text-muted sm:ml-auto">{`${shown.length} of ${roles.length} roles`}</span>
      </div>

      {query.isLoading ? <LoadingState label="Loading roles" rows={6} />
        : query.isError ? <ErrorState title="Could not load roles" description="Something went wrong." action={{ label: "Retry", onPress: () => query.refetch() }} />
        : roles.length === 0 ? <EmptyState title="No roles yet" />
        : groups.length === 0 ? <NoResultsState title="No roles match" description={focus === "custom" ? "No custom roles yet. Copy a built-in role, or create a new one." : "Try another search or app."} />
        : (
          <div className="flex flex-col gap-4">
            {groups.map((group) => {
              const open = filtering || !collapsed.has(group.key);
              const inUse = group.roles.filter((role) => role.assigned_user_count > 0).length;
              return (
                <section key={group.key} aria-label={group.label} className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
                  <button type="button" aria-expanded={open} onClick={() => toggleGroup(group.key)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand">
                    <span className="flex min-w-0 flex-col">
                      <span className="text-sm font-semibold text-text">{group.label}</span>
                      <span className="text-xs text-text-secondary">{`${plural(group.roles.length, "role")}${inUse ? ` · ${inUse} in use` : ""}`}</span>
                    </span>
                    <ChevronDown className={`size-4 shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                  {open && (
                    <ul className="grid gap-3 border-t border-border bg-surface-muted p-3 md:grid-cols-2 xl:grid-cols-3">
                      {group.roles.map((role) => (
                        <RoleCard key={role.id} role={role} canEdit={canEdit}
                          onView={() => setViewing(role)} onCopy={() => openCopy(role)} onEdit={() => openEdit(role)} onRemove={() => setArchiveTarget(role)} />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}

      </>)}

      {viewing && (
        <RoleDetailDialog role={viewing} catalog={catalog} appLabel={MODULE_LABEL.get(viewing.module_key) ?? "Platform"} risk={RISKS[riskOf(viewing.risk_level)]}
          canEdit={canEdit} onClose={() => setViewing(null)} onCopy={() => openCopy(viewing)} onEdit={() => openEdit(viewing)} />
      )}

      <Dialog isOpen={Boolean(editor)} onOpenChange={(open) => !open && setEditor(null)} size="lg"
        title={editor?.mode === "edit" ? `Edit role: ${editor.role.name}` : "New role"}
        description={editor?.mode === "edit" ? undefined : "A custom role for your organization. Pick what it allows below."}>
        {/* One scroll (the dialog's own); the footer stays pinned so Save is always in reach. */}
        <div className="flex flex-col gap-6 pr-1">
          <EditorSection step={1} title="Basics">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Role name" isRequired value={name} onChange={setName} />
              {editor?.mode === "create"
                ? <Select label="App" description="Where the role is listed." options={MODULE_OPTIONS} selectedKey={moduleKey} onSelectionChange={(key) => setModuleKey(String(key))} />
                : <TextField label="App" value={MODULE_LABEL.get(moduleKey) ?? "Platform"} isReadOnly />}
              <div className="sm:col-span-2"><TextField label="Description" value={description} onChange={setDescription} placeholder="Who this role is for and what they do" /></div>
            </div>
          </EditorSection>
          <EditorSection step={2} title="Access level">
            <RiskPicker value={riskLevel} onChange={setRiskLevel} />
            <RecordAccessEditor selected={selectedPermissions} onChange={setSelectedPermissions} />
          </EditorSection>
          <EditorSection step={3} title="Permissions">
            <PermissionPicker catalog={permissionsQuery.data?.permissions ?? []} loading={permissionsQuery.isLoading} selected={selectedPermissions} onChange={setSelectedPermissions} />
          </EditorSection>
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-col gap-2 border-t border-border bg-surface-raised px-1 pb-0.5 pt-3 shadow-[0_-8px_12px_-12px_rgba(0,0,0,0.25)]">
            {formError && (
              <div className="flex flex-col gap-2">
                <p role="alert" className="text-sm text-danger">{formError}</p>
                {formError.includes("Acknowledge conflicts") && <Checkbox isSelected={acknowledgeWarnings} onChange={setAcknowledgeWarnings}>Acknowledge conflicts and continue</Checkbox>}
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-text-muted">{`${plural(selectedPermissions.length, "permission")} selected`}</span>
              <span className="flex gap-2">
                <Button variant="secondary" onPress={() => setEditor(null)}>Cancel</Button>
                <Button variant="primary" isLoading={saveMutation.isPending} isDisabled={!name.trim()} onPress={() => saveMutation.mutate()}>
                  {editor?.mode === "edit" ? "Save role" : "Create role"}
                </Button>
              </span>
            </div>
          </div>
        </div>
      </Dialog>

      <AlertDialog isOpen={Boolean(archiveTarget)} onOpenChange={(open) => !open && setArchiveTarget(null)} title="Remove this role?" tone="danger"
        description={`${archiveTarget?.name ?? ""} can no longer be given to anyone. ${archiveTarget?.assigned_user_count ? `It is held by ${people(archiveTarget.assigned_user_count)}: change their roles in Users first.` : "Nobody holds it now."}`}
        confirmLabel="Remove role" isConfirming={archiveMutation.isPending} onConfirm={() => archiveTarget && archiveMutation.mutate(archiveTarget)} />
    </div>
  );
}

function RoleCard({ role, canEdit, onView, onCopy, onEdit, onRemove }: {
  role: RoleRow; canEdit: boolean; onView: () => void; onCopy: () => void; onEdit: () => void; onRemove: () => void;
}) {
  const risk = RISKS[riskOf(role.risk_level)];
  const RiskIcon = risk.icon;
  const accent = risk.tone === "danger" ? "bg-danger" : risk.tone === "warning" ? "bg-warning" : "bg-success";
  return (
    <li className="relative flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface transition-shadow hover:shadow-md">
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${accent}`} />
      <button type="button" onClick={onView} className="flex flex-1 flex-col gap-2 p-4 pl-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand">
        <span className="flex items-start gap-3">
          <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${risk.tone === "danger" ? "bg-danger-soft text-danger" : risk.tone === "warning" ? "bg-warning-soft text-warning" : "bg-success-soft text-success"}`} title={`${risk.label}: ${risk.meaning}`}>
            <RiskIcon className="size-4" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-sm font-semibold text-text">{role.name}</span>
            <span className="flex flex-wrap gap-1.5">
              <Badge tone={risk.tone}>{risk.label}</Badge>
              {!role.is_system && <Badge tone="brand">Custom</Badge>}
              {!role.assignable && <Badge tone="neutral">Assigned automatically</Badge>}
            </span>
          </span>
        </span>
        {role.description && <span className="line-clamp-2 text-xs text-text-secondary">{role.description}</span>}
      </button>
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 pl-5">
        <span className="flex items-center gap-3 text-xs text-text-secondary">
          <span className="tabular-nums">{plural(role.permission_keys.length, "permission")}</span>
          <span className={`inline-flex items-center gap-1 tabular-nums ${role.assigned_user_count ? "font-medium text-text" : ""}`} title={people(role.assigned_user_count)}>
            <Users className="size-3.5" aria-hidden="true" />{role.assigned_user_count}<span className="sr-only"> people with this role</span>
          </span>
        </span>
        <span className="flex shrink-0 gap-0.5">
          <Button variant="ghost" size="compact" onPress={onView} aria-label={`View ${role.name}`}><Eye className="size-4" aria-hidden="true" /><span className="max-sm:sr-only">View</span></Button>
          {canEdit && (role.is_system
            ? <Button variant="ghost" size="compact" onPress={onCopy} aria-label={`Copy ${role.name}`}><Copy className="size-4" aria-hidden="true" /><span className="max-sm:sr-only">Copy</span></Button>
            : (
              <>
                <Button variant="ghost" size="compact" onPress={onEdit} aria-label={`Edit ${role.name}`}><Pencil className="size-4" aria-hidden="true" /><span className="max-sm:sr-only">Edit</span></Button>
                <Button variant="ghost" size="compact" onPress={onRemove} aria-label={`Remove ${role.name}`}><Trash2 className="size-4" aria-hidden="true" /></Button>
              </>
            ))}
        </span>
      </div>
    </li>
  );
}

// A numbered part of the role editor.
function EditorSection({ step, title, children }: { step: number; title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
        <span className="flex size-5 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand" aria-hidden="true">{step}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function RiskPicker({ value, onChange }: { value: Risk; onChange: (next: Risk) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-sm font-medium text-text">Risk level</legend>
      <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
        {(Object.keys(RISKS) as Risk[]).map((key) => {
          const risk = RISKS[key];
          const selected = value === key;
          const tone = risk.tone === "danger" ? "border-danger bg-danger-soft" : risk.tone === "warning" ? "border-warning bg-warning-soft" : "border-success bg-success-soft";
          return (
            <button key={key} type="button" role="radio" aria-checked={selected} onClick={() => onChange(key)}
              className={`flex flex-col gap-0.5 rounded-[var(--radius-control)] border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand ${selected ? tone : "border-border hover:border-border-strong"}`}>
              <span className="text-sm font-medium text-text">{risk.label}</span>
              <span className="text-xs text-text-secondary">{risk.meaning}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// Choosing permissions: a search across all of them, and per group a count with "Select all" / "Clear".
function PermissionPicker({ catalog, loading, selected, onChange }: {
  catalog: PermissionCatalogEntry[]; loading: boolean; selected: string[]; onChange: (next: string[]) => void;
}) {
  const [filter, setFilter] = useState("");
  const term = filter.trim().toLowerCase();
  const chosen = new Set(selected);
  const groups = useMemo(() => {
    const byCategory = new Map<string, PermissionCatalogEntry[]>();
    for (const entry of catalog) {
      if (term && !`${entry.name} ${entry.category} ${entry.description}`.toLowerCase().includes(term)) continue;
      byCategory.set(entry.category, [...(byCategory.get(entry.category) ?? []), entry]);
    }
    return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [catalog, term]);
  const setMany = (keys: string[], on: boolean) => {
    const next = new Set(selected);
    for (const key of keys) {
      if (on) next.add(key);
      else next.delete(key);
    }
    onChange([...next]);
  };
  let body: ReactNode;
  if (loading) body = <LoadingState label="Loading permissions" rows={3} />;
  else if (!groups.length) body = <p className="text-sm text-text-secondary">No permission matches “{filter}”.</p>;
  else
    body = groups.map(([category, entries]) => {
      const count = entries.filter((entry) => chosen.has(entry.key)).length;
      return (
        <details key={category} open={Boolean(term)} className="rounded-[var(--radius-control)] border border-border">
          <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-text">
            <span>{category}</span>
            <span className={`text-xs font-normal ${count ? "text-brand" : "text-text-muted"}`}>{`${count} of ${entries.length}`}</span>
          </summary>
          <div className="flex flex-col gap-2 border-t border-border px-3 py-2">
            <div className="flex gap-3 text-xs">
              <button type="button" className="font-medium text-brand hover:underline" onClick={() => setMany(entries.map((entry) => entry.key), true)}>Select all</button>
              <button type="button" className="font-medium text-text-secondary hover:underline" onClick={() => setMany(entries.map((entry) => entry.key), false)}>Clear</button>
            </div>
            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {entries.map((entry) => (
                <Checkbox key={entry.key} isSelected={chosen.has(entry.key)} onChange={(on) => setMany([entry.key], on)}>{entry.name}</Checkbox>
              ))}
            </div>
          </div>
        </details>
      );
    });
  return (
    <div className="flex flex-col gap-2">
      <SearchField aria-label="Search permissions" placeholder="Search permissions, such as “approve” or “export”" className="w-full" value={filter} onChange={setFilter} />
      <p className="text-xs text-text-muted">Open an area to pick its permissions, or use Select all.</p>
      <div className="flex flex-col gap-1.5">{body}</div>
    </div>
  );
}

// Archived custom roles, each restorable (its name must still be free).
function ArchivedRoles({ canEdit, onRestored }: { canEdit: boolean; onRestored: () => void }) {
  const archived = useQuery({ queryKey: [...ROLES_QUERY_KEY, "archived"], queryFn: listArchivedRoles });
  const [error, setError] = useState<string | null>(null);
  const restore = useMutation({
    mutationFn: (id: string) => restoreRole(id),
    onSuccess: () => { setError(null); void archived.refetch(); onRestored(); },
    onError: (failure: unknown) => setError(failure instanceof RolesApiError ? failure.message : "The role could not be restored."),
  });
  const rows = archived.data?.roles ?? [];
  if (archived.isLoading) return <LoadingState label="Loading archived roles" rows={3} />;
  return (
    <div className="flex flex-col gap-3">
      {error && <p role="alert" className="rounded-[var(--radius-control)] bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {rows.length === 0 ? <p className="text-sm text-text-secondary">No archived roles. A custom role you remove appears here and can be restored.</p> : (
        <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          {rows.map((role) => (
            <li key={role.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold text-text">{role.name}</span>
                <span className="text-xs text-text-secondary">{`${MODULE_LABEL.get(role.module_key) ?? "Platform"} · archived ${new Date(role.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}</span>
              </span>
              {canEdit && <Button variant="outline" size="compact" isLoading={restore.isPending && restore.variables === role.id} onPress={() => restore.mutate(role.id)}><RotateCcw className="size-4" aria-hidden="true" />Restore</Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  Badge,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  PermissionState,
  Select,
  TextField,
} from "@vercentlabs/design-system";

import {
  createRole,
  archiveRole,
  listPermissionCatalog,
  listRoles,
  updateRole,
  RoleInput,
  RoleRow,
  RolesApiError,
} from "../api/roles-api";

const ROLES_QUERY_KEY = ["settings", "roles"];
const PERMISSIONS_QUERY_KEY = ["settings", "roles", "permissions"];

const RISK_TONE: Record<string, "success" | "warning" | "danger"> = {
  standard: "success",
  sensitive: "warning",
  privileged: "danger",
};

const RISK_OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "sensitive", label: "Sensitive" },
  { value: "privileged", label: "Privileged" },
];

const MODULE_OPTIONS = [
  { value: "platform", label: "Platform" },
  { value: "crm", label: "CRM" },
  { value: "sales", label: "Sales" },
  { value: "accounting", label: "Accounting" },
  { value: "procurement", label: "Procurement" },
  { value: "stock", label: "Stock" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "projects", label: "Projects" },
  { value: "assets", label: "Assets" },
  { value: "point-of-sale", label: "Point of Sale" },
  { value: "quality", label: "Quality" },
  { value: "support", label: "Support" },
  { value: "hr-payroll", label: "HR & Payroll" },
];

type EditorState = { mode: "create" } | { mode: "edit"; role: RoleRow };

export function RolesScreen({ canManage, canEdit }: { canManage: boolean; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ROLES_QUERY_KEY, queryFn: listRoles });
  const permissionsQuery = useQuery({ queryKey: PERMISSIONS_QUERY_KEY, queryFn: listPermissionCatalog, enabled: canEdit });

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<RoleRow | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [moduleKey, setModuleKey] = useState("platform");
  const [riskLevel, setRiskLevel] = useState<"standard" | "sensitive" | "privileged">("standard");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);

  const permissionsByCategory = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; description: string }[]>();
    for (const permission of permissionsQuery.data?.permissions ?? []) {
      const list = groups.get(permission.category) ?? [];
      list.push(permission);
      groups.set(permission.category, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [permissionsQuery.data]);

  function openCreate() {
    setEditor({ mode: "create" });
    setName("");
    setDescription("");
    setModuleKey("platform");
    setRiskLevel("standard");
    setSelectedPermissions([]);
    setFormError(null);
    setAcknowledgeWarnings(false);
  }

  function openEdit(role: RoleRow) {
    setEditor({ mode: "edit", role });
    setName(role.name);
    setDescription(role.description);
    setModuleKey(role.module_key);
    setRiskLevel(role.risk_level as "standard" | "sensitive" | "privileged");
    setSelectedPermissions(role.permission_keys);
    setFormError(null);
    setAcknowledgeWarnings(false);
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const input: RoleInput = {
        name,
        description,
        moduleKey,
        riskLevel,
        permissionKeys: selectedPermissions,
        acknowledgeWarningConflicts: acknowledgeWarnings,
      };
      return editor?.mode === "edit" ? updateRole(editor.role.id, input) : createRole(input);
    },
    onSuccess: () => {
      setEditor(null);
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
    onError: (error: unknown) => {
      if (error instanceof RolesApiError && error.code === "ACCESS_ADMIN_SOD_WARNING") {
        setFormError(`${error.message} Check "Acknowledge conflicts" and save again if this is intentional.`);
        return;
      }
      setFormError(error instanceof RolesApiError ? error.message : "The role could not be saved.");
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (role: RoleRow) => archiveRole(role.id),
    onSuccess: () => {
      setArchiveTarget(null);
      queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
    onError: (error: unknown) => setFormError(error instanceof RolesApiError ? error.message : "The role could not be removed."),
  });

  if (!canManage) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <PermissionState title="You don't have access to Roles and permissions" description="Ask an administrator to grant roles.view." />
      </div>
    );
  }

  const roles = query.data?.roles ?? [];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Roles and permissions"
        description="Create custom roles, edit their permission grants, and assign roles to users."
        primaryAction={
          canEdit && (
            <Button variant="primary" onPress={openCreate}>
              New role
            </Button>
          )
        }
      />

      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : query.isError ? (
        <ErrorState title="Could not load roles" description="Something went wrong." action={{ label: "Retry", onPress: () => query.refetch() }} />
      ) : roles.length === 0 ? (
        <EmptyState title="No roles yet" />
      ) : (
        <ul className="flex max-w-[860px] flex-col gap-2">
          {roles.map((role) => (
            <li key={role.id} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-text">{role.name}</span>
                  <Badge tone={RISK_TONE[role.risk_level] ?? "success"}>{role.risk_level}</Badge>
                  {role.is_system && <Badge tone="neutral">System role</Badge>}
                  {!role.assignable && <Badge tone="neutral">Not directly assignable</Badge>}
                </div>
                {role.description ? <span className="text-xs text-text-muted">{role.description}</span> : null}
                <span className="text-xs text-text-muted">
                  Module: {role.module_key} · {role.permission_keys.length} permission(s) · {role.assigned_user_count} user(s) assigned
                </span>
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-2 sm:shrink-0">
                  <Button variant="secondary" size="compact" onPress={() => openEdit(role)} isDisabled={role.is_system}>
                    {role.is_system ? "Reserved" : "Edit"}
                  </Button>
                  {!role.is_system && (
                    <Button variant="secondary" size="compact" onPress={() => setArchiveTarget(role)}>
                      Remove
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog
        isOpen={Boolean(editor)}
        onOpenChange={(open) => !open && setEditor(null)}
        title={editor?.mode === "edit" ? `Edit role — ${editor.role.name}` : "New role"}
      >
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
          <TextField label="Role name" isRequired value={name} onChange={setName} />
          <TextField label="Description" value={description} onChange={setDescription} />
          {editor?.mode === "create" && (
            <Select label="Module" options={MODULE_OPTIONS} selectedKey={moduleKey} onSelectionChange={(key) => setModuleKey(String(key))} />
          )}
          <Select
            label="Risk level"
            options={RISK_OPTIONS}
            selectedKey={riskLevel}
            onSelectionChange={(key) => setRiskLevel(String(key) as typeof riskLevel)}
          />

          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">
              Permissions ({selectedPermissions.length} selected)
            </span>
            {permissionsQuery.isLoading ? (
              <p className="text-sm text-text-secondary">Loading permissions…</p>
            ) : (
              <div className="flex flex-col gap-1">
                {permissionsByCategory.map(([category, permissions]) => (
                  <details key={category} className="rounded-[var(--radius-control)] border border-border p-2">
                    <summary className="cursor-pointer text-sm font-medium text-text">
                      {category} ({permissions.filter((p) => selectedPermissions.includes(p.key)).length}/{permissions.length})
                    </summary>
                    <div className="mt-2 flex flex-col gap-1 pl-2">
                      {permissions.map((permission) => (
                        <Checkbox
                          key={permission.key}
                          isSelected={selectedPermissions.includes(permission.key)}
                          onChange={(isSelected) =>
                            setSelectedPermissions((current) =>
                              isSelected ? [...current, permission.key] : current.filter((key) => key !== permission.key),
                            )
                          }
                        >
                          {permission.name}
                        </Checkbox>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>

          {formError ? (
            <div className="flex flex-col gap-2">
              <p role="alert" className="text-sm text-danger">
                {formError}
              </p>
              {formError.includes("Acknowledge conflicts") && (
                <Checkbox isSelected={acknowledgeWarnings} onChange={setAcknowledgeWarnings}>
                  Acknowledge conflicts and continue
                </Checkbox>
              )}
            </div>
          ) : null}

          <Button variant="primary" isLoading={saveMutation.isPending} onPress={() => saveMutation.mutate()} className="self-start">
            Save role
          </Button>
        </div>
      </Dialog>

      <AlertDialog
        isOpen={Boolean(archiveTarget)}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title="Remove this role?"
        description={`${archiveTarget?.name ?? ""} will no longer be assignable. This is blocked if any user still holds it.`}
        confirmLabel="Remove"
        isConfirming={archiveMutation.isPending}
        onConfirm={() => archiveTarget && archiveMutation.mutate(archiveTarget)}
      />
    </div>
  );
}

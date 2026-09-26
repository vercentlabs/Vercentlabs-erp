"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, Badge, Button, Dialog, EmptyState, ErrorState, PageHeader, PermissionState } from "@vercentlabs/design-system";

import { AccessApiError, getAccessOptions, saveUserAccessScope } from "@/features/settings/access/api/access-api";
import { EffectiveAccessSummary } from "@/features/settings/access/EffectiveAccessSummary";
import { RoleSelector } from "@/features/settings/access/RoleSelector";
import { ScopeSelector, type AccessScope } from "@/features/settings/access/ScopeSelector";
import { RolesApiError, setUserRoles } from "@/features/settings/roles/api/roles-api";
import { listMembers, MemberRow, setMemberStatus, UsersApiError } from "../api/users-api";

const QUERY_KEY = ["settings", "users"];
const OPTIONS_KEY = ["settings", "access", "options"];

export type UsersAbilities = {
  canView: boolean;
  canManageUsers: boolean;
  canAssignRoles: boolean;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof UsersApiError || error instanceof RolesApiError || error instanceof AccessApiError ? error.message : fallback;
}

function Scope({ names, empty }: { names: string[]; empty: string }) {
  return <span>{names.length ? names.join(", ") : empty}</span>;
}

export function UsersScreen({ abilities, currentUserId }: { abilities: UsersAbilities; currentUserId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: listMembers, enabled: abilities.canView });
  const optionsQuery = useQuery({ queryKey: OPTIONS_KEY, queryFn: getAccessOptions, enabled: abilities.canManageUsers || abilities.canAssignRoles });

  const [statusTarget, setStatusTarget] = useState<MemberRow | null>(null);
  const [accessTarget, setAccessTarget] = useState<MemberRow | null>(null);
  const [scope, setScope] = useState<AccessScope>({ companyIds: [], branchIds: [], departmentIds: [], teamIds: [] });
  const [rolesTarget, setRolesTarget] = useState<MemberRow | null>(null);
  const [roleSelection, setRoleSelection] = useState<{ roleIds: string[]; primaryRoleId: string }>({ roleIds: [], primaryRoleId: "" });
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const statusMutation = useMutation({
    mutationFn: (member: MemberRow) => setMemberStatus(member.user_id, member.membership_status === "active" ? "disabled" : "active"),
    onSuccess: () => {
      setActionError(null);
      setStatusTarget(null);
      refresh();
    },
    onError: (error: unknown) => {
      setStatusTarget(null);
      setActionError(errorMessage(error, "The member's status could not be changed."));
    },
  });

  const accessMutation = useMutation({
    mutationFn: () => saveUserAccessScope(accessTarget!.user_id, scope),
    onSuccess: () => {
      setDialogError(null);
      setAccessTarget(null);
      refresh();
    },
    onError: (error: unknown) => setDialogError(errorMessage(error, "Access could not be updated.")),
  });

  const rolesMutation = useMutation({
    mutationFn: () => setUserRoles(rolesTarget!.user_id, roleSelection.roleIds, roleSelection.primaryRoleId),
    onSuccess: () => {
      setDialogError(null);
      setRolesTarget(null);
      refresh();
    },
    onError: (error: unknown) => setDialogError(errorMessage(error, "Roles could not be updated.")),
  });

  if (!abilities.canView) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <PermissionState title="You don't have access to Users" description="Ask an administrator for access to view users." />
      </div>
    );
  }

  const members = query.data?.members ?? [];
  const options = optionsQuery.data;
  const grantableCompanies = options?.scope?.companies ?? [];
  const roles = options?.roles ?? [];
  const selectedRoles = roles.filter((role) => roleSelection.roleIds.includes(role.id));
  // Roles this person already holds that the current administrator could not
  // grant: shown, never silently dropped, and saving is blocked (the server
  // would refuse it anyway).
  const lockedRoles = selectedRoles.filter((role) => !role.grantable);

  const openAccess = (member: MemberRow) => {
    // Ids come straight from the server — never reconstructed from names.
    setScope({ companyIds: member.company_ids, branchIds: member.branch_ids, departmentIds: member.department_ids ?? [], teamIds: member.team_ids ?? [] });
    setDialogError(null);
    setAccessTarget(member);
  };
  const openRoles = (member: MemberRow) => {
    setRoleSelection({ roleIds: member.role_ids, primaryRoleId: member.primary_role_id ?? member.role_ids[0] ?? "" });
    setDialogError(null);
    setRolesTarget(member);
  };

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Users"
        description={
          options?.scope && !options.scope.unrestricted
            ? "Members in the companies and branches you administer."
            : "Members of your organization, their roles and their company and branch access."
        }
      />

      {actionError ? (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      ) : null}

      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : query.isError ? (
        <ErrorState title="Could not load users" description="Something went wrong." action={{ label: "Retry", onPress: () => query.refetch() }} />
      ) : members.length === 0 ? (
        <EmptyState title="No users to show" description="Users appear here once they have access inside your administration scope." />
      ) : (
        <ul className="flex max-w-[960px] flex-col gap-2" aria-label="Users">
          {members.map((member) => {
            const additional = member.role_names.filter((name) => name !== member.primary_role_name);
            const isSelf = member.user_id === currentUserId;
            return (
              <li key={member.user_id} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-text">{member.full_name}</span>
                    <Badge tone={member.membership_status === "active" ? "success" : "neutral"}>{member.membership_status === "active" ? "Active" : "Disabled"}</Badge>
                    {isSelf && <Badge tone="info">You</Badge>}
                  </div>
                  <span className="text-xs break-all text-text-muted">{member.email}</span>
                  <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-0.5 text-xs text-text-secondary">
                    <dt className="text-text-muted">Role</dt>
                    <dd>
                      {member.primary_role_name ?? "No role assigned"}
                      {additional.length > 0 && <span className="text-text-muted">{` + ${additional.join(", ")}`}</span>}
                    </dd>
                    <dt className="text-text-muted">Companies</dt>
                    <dd>
                      <Scope names={member.company_names} empty="No company access" />
                    </dd>
                    <dt className="text-text-muted">Branches</dt>
                    <dd>
                      <Scope names={member.branch_names} empty="No branch access" />
                    </dd>
                  </dl>
                </div>
                <div className="flex flex-wrap gap-2">
                  {abilities.canAssignRoles && (
                    <Button variant="secondary" size="compact" onPress={() => openRoles(member)}>
                      Manage roles
                    </Button>
                  )}
                  {abilities.canManageUsers && (
                    <Button variant="secondary" size="compact" onPress={() => openAccess(member)}>
                      Manage access
                    </Button>
                  )}
                  {abilities.canManageUsers && !isSelf && (
                    <Button variant="secondary" size="compact" onPress={() => setStatusTarget(member)}>
                      {member.membership_status === "active" ? "Disable" : "Enable"}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog
        isOpen={Boolean(statusTarget)}
        onOpenChange={(open) => !open && setStatusTarget(null)}
        title={statusTarget?.membership_status === "active" ? "Disable this user?" : "Enable this user?"}
        description={
          statusTarget?.membership_status === "active"
            ? `${statusTarget?.full_name} will lose access immediately and be signed out of every active session.`
            : `${statusTarget?.full_name} will regain access to this organization.`
        }
        confirmLabel={statusTarget?.membership_status === "active" ? "Disable" : "Enable"}
        isConfirming={statusMutation.isPending}
        onConfirm={() => statusTarget && statusMutation.mutate(statusTarget)}
      />

      <Dialog isOpen={Boolean(accessTarget)} onOpenChange={(open) => !open && setAccessTarget(null)} title={`Manage access — ${accessTarget?.full_name ?? ""}`}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">Choose the companies, branches, departments and teams this person can work in.</p>
          {optionsQuery.isLoading ? (
            <p className="text-sm text-text-secondary">Loading…</p>
          ) : (
            <ScopeSelector companies={grantableCompanies} departments={options?.scope?.departments ?? []} teams={options?.scope?.teams ?? []} companyIds={scope.companyIds} branchIds={scope.branchIds} departmentIds={scope.departmentIds} teamIds={scope.teamIds} onChange={setScope} />
          )}
          {dialogError && accessTarget ? (
            <p role="alert" className="text-sm text-danger">
              {dialogError}
            </p>
          ) : null}
          <Button variant="primary" isLoading={accessMutation.isPending} onPress={() => accessMutation.mutate()}>
            Save access
          </Button>
        </div>
      </Dialog>

      <Dialog isOpen={Boolean(rolesTarget)} onOpenChange={(open) => !open && setRolesTarget(null)} title={`Manage roles — ${rolesTarget?.full_name ?? ""}`}>
        <div className="flex flex-col gap-4">
          {optionsQuery.isLoading ? (
            <p className="text-sm text-text-secondary">Loading…</p>
          ) : (
            <RoleSelector roles={roles} roleIds={roleSelection.roleIds} primaryRoleId={roleSelection.primaryRoleId} onChange={setRoleSelection} />
          )}
          {lockedRoles.length > 0 && (
            <p role="note" className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm text-warning">
              {`${lockedRoles.map((role) => role.name).join(", ")} can only be changed by an administrator who holds that access.`}
            </p>
          )}
          <EffectiveAccessSummary roles={selectedRoles} />
          {dialogError && rolesTarget ? (
            <p role="alert" className="text-sm text-danger">
              {dialogError}
            </p>
          ) : null}
          <Button
            variant="primary"
            isLoading={rolesMutation.isPending}
            isDisabled={roleSelection.roleIds.length === 0 || !roleSelection.primaryRoleId || lockedRoles.length > 0}
            onPress={() => rolesMutation.mutate()}
          >
            Save roles
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

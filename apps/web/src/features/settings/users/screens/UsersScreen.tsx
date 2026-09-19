"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, Badge, Button, Checkbox, Dialog, EmptyState, ErrorState, PageHeader, PermissionState, Select } from "@vercentlabs/design-system";

import { listCompanies } from "@/features/settings/companies/api/companies-api";
import { listBranches } from "@/features/settings/branches/api/branches-api";
import { listRoles, RolesApiError, setUserRoles } from "@/features/settings/roles/api/roles-api";
import { listMembers, MemberRow, setMemberAccess, setMemberStatus, UsersApiError } from "../api/users-api";

const QUERY_KEY = ["settings", "users"];

export function UsersScreen({ canManage, currentUserId }: { canManage: boolean; currentUserId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: listMembers });
  const companiesQuery = useQuery({ queryKey: ["settings", "companies"], queryFn: listCompanies });
  const branchesQuery = useQuery({ queryKey: ["settings", "branches"], queryFn: listBranches });
  const rolesQuery = useQuery({ queryKey: ["settings", "roles"], queryFn: listRoles });

  const [statusTarget, setStatusTarget] = useState<MemberRow | null>(null);
  const [accessTarget, setAccessTarget] = useState<MemberRow | null>(null);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  const [rolesTarget, setRolesTarget] = useState<MemberRow | null>(null);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [primaryRoleId, setPrimaryRoleId] = useState<string>("");
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const statusMutation = useMutation({
    mutationFn: (member: MemberRow) => setMemberStatus(member.user_id, member.membership_status === "active" ? "disabled" : "active"),
    onSuccess: () => {
      setActionError(null);
      setStatusTarget(null);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: unknown) => setActionError(error instanceof UsersApiError ? error.message : "The member's status could not be changed."),
  });

  const accessMutation = useMutation({
    mutationFn: () => setMemberAccess(accessTarget!.user_id, selectedCompanyIds, selectedBranchIds),
    onSuccess: () => {
      setActionError(null);
      setAccessTarget(null);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: unknown) => setActionError(error instanceof UsersApiError ? error.message : "Access could not be updated."),
  });

  const rolesMutation = useMutation({
    mutationFn: () => setUserRoles(rolesTarget!.user_id, selectedRoleIds, primaryRoleId),
    onSuccess: () => {
      setRolesError(null);
      setRolesTarget(null);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: unknown) => setRolesError(error instanceof RolesApiError ? error.message : "Roles could not be updated."),
  });

  if (!canManage) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <PermissionState title="You don't have access to Users" description="Ask an administrator to grant users.manage." />
      </div>
    );
  }

  const members = query.data?.members ?? [];
  const companies = companiesQuery.data?.companies ?? [];
  const branches = branchesQuery.data?.branches ?? [];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Users" description="Active members, status, roles, and company/branch access." />

      {actionError ? (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      ) : null}

      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : query.isError ? (
        <ErrorState title="Could not load members" description="Something went wrong." action={{ label: "Retry", onPress: () => query.refetch() }} />
      ) : members.length === 0 ? (
        <EmptyState title="No members yet" />
      ) : (
        <ul className="flex max-w-[860px] flex-col gap-2">
          {members.map((member) => (
            <li key={member.user_id} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-text">{member.full_name}</span>
                  <Badge tone={member.membership_status === "active" ? "success" : "neutral"}>{member.membership_status}</Badge>
                  {member.user_id === currentUserId && <Badge tone="info">You</Badge>}
                </div>
                <span className="text-xs text-text-muted break-all">{member.email}</span>
                <span className="text-xs text-text-muted">
                  {member.role_names.length ? member.role_names.join(", ") : "No role assigned"}
                  {" · "}
                  {member.company_names.length ? `Companies: ${member.company_names.join(", ")}` : "No company access"}
                  {member.branch_names.length ? ` · Branches: ${member.branch_names.join(", ")}` : ""}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="compact"
                  onPress={() => {
                    setRolesTarget(member);
                    setSelectedRoleIds(member.role_ids);
                    setPrimaryRoleId(member.primary_role_id ?? member.role_ids[0] ?? "");
                    setRolesError(null);
                  }}
                >
                  Manage roles
                </Button>
                <Button
                  variant="secondary"
                  size="compact"
                  onPress={() => {
                    setAccessTarget(member);
                    setSelectedCompanyIds(companies.filter((c) => member.company_names.includes(c.name)).map((c) => c.id));
                    setSelectedBranchIds(branches.filter((b) => member.branch_names.includes(b.name)).map((b) => b.id));
                  }}
                >
                  Manage access
                </Button>
                {member.user_id !== currentUserId && (
                  <Button variant="secondary" size="compact" onPress={() => setStatusTarget(member)}>
                    {member.membership_status === "active" ? "Disable" : "Enable"}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        isOpen={Boolean(statusTarget)}
        onOpenChange={(open) => !open && setStatusTarget(null)}
        title={statusTarget?.membership_status === "active" ? "Disable this member?" : "Enable this member?"}
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
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">Companies</span>
            {companies.map((company) => (
              <Checkbox
                key={company.id}
                isSelected={selectedCompanyIds.includes(company.id)}
                onChange={(isSelected) =>
                  setSelectedCompanyIds((current) => (isSelected ? [...current, company.id] : current.filter((id) => id !== company.id)))
                }
              >
                {company.name}
              </Checkbox>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">Branches</span>
            {branches.map((branch) => (
              <Checkbox
                key={branch.id}
                isSelected={selectedBranchIds.includes(branch.id)}
                onChange={(isSelected) =>
                  setSelectedBranchIds((current) => (isSelected ? [...current, branch.id] : current.filter((id) => id !== branch.id)))
                }
              >
                {branch.name}
              </Checkbox>
            ))}
          </div>
          <Button variant="primary" isLoading={accessMutation.isPending} onPress={() => accessMutation.mutate()}>
            Save access
          </Button>
        </div>
      </Dialog>

      <Dialog isOpen={Boolean(rolesTarget)} onOpenChange={(open) => !open && setRolesTarget(null)} title={`Manage roles — ${rolesTarget?.full_name ?? ""}`}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">Roles</span>
            {(rolesQuery.data?.roles ?? [])
              .filter((role) => role.assignable)
              .map((role) => (
                <Checkbox
                  key={role.id}
                  isSelected={selectedRoleIds.includes(role.id)}
                  onChange={(isSelected) => {
                    setSelectedRoleIds((current) => {
                      const next = isSelected ? [...current, role.id] : current.filter((id) => id !== role.id);
                      if (isSelected && !primaryRoleId) setPrimaryRoleId(role.id);
                      if (!isSelected && primaryRoleId === role.id) setPrimaryRoleId(next[0] ?? "");
                      return next;
                    });
                  }}
                >
                  {role.name}
                </Checkbox>
              ))}
          </div>
          {selectedRoleIds.length > 1 && (
            <Select
              label="Primary role"
              options={selectedRoleIds.map((id) => ({ value: id, label: rolesQuery.data?.roles.find((r) => r.id === id)?.name ?? id }))}
              selectedKey={primaryRoleId}
              onSelectionChange={(key) => setPrimaryRoleId(String(key))}
            />
          )}
          {rolesError ? (
            <p role="alert" className="text-sm text-danger">
              {rolesError}
            </p>
          ) : null}
          <Button
            variant="primary"
            isLoading={rolesMutation.isPending}
            isDisabled={selectedRoleIds.length === 0 || !primaryRoleId}
            onPress={() => rolesMutation.mutate()}
          >
            Save roles
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

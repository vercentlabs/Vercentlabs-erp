"use client";

// Settings › Users: everyone in the organization as a list — who they are, their role, whether they can sign in and when they joined —
// with search, an Active / Disabled filter and Invite someone at the top. A row opens Change role; its ⋯ holds Change role and the rarer
// account actions (sign out everywhere, reset two-step sign-in, make owner, disable / enable). Every action is re-checked on the server.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Mail, UserPlus, X } from "lucide-react";
import {
  AlertDialog,
  Avatar,
  Button,
  Dialog,
  EmptyState,
  EnterpriseDataGrid,
  EnterpriseListPage,
  ErrorState,
  NoResultsState,
  PermissionState,
  SearchField,
  Select,
  StatusBadge,
  buttonVariants,
} from "@vercentlabs/design-system";

import { AccessApiError, getAccessOptions } from "@/features/settings/access/api/access-api";
import { EffectiveAccessSummary } from "@/features/settings/access/EffectiveAccessSummary";
import { RoleSelector } from "@/features/settings/access/RoleSelector";
import { getUserActiveLeadCount } from "@/features/crm/leads/api/leads-api";
import { RolesApiError, setUserRoles } from "@/features/settings/roles/api/roles-api";
import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { useMinWidth } from "@/shared/ui/use-min-width";
import { listMembers, MemberRow, setMemberStatus, UsersApiError } from "../api/users-api";
import { MemberActionsMenu } from "../MemberActionsMenu";
import { PEOPLE_ACCESS_TITLE, PeopleAccessTabs } from "@/features/settings/people/PeopleAccessTabs";

const QUERY_KEY = ["settings", "users"];
const OPTIONS_KEY = ["settings", "access", "options"];
const PAGE_SIZE = 20;
const STATUSES = [{ value: "all", label: "Everyone" }, { value: "active", label: "Active" }, { value: "disabled", label: "Disabled" }];

export type UsersAbilities = {
  canView: boolean;
  canManageUsers: boolean;
  canAssignRoles: boolean;
  isOwner?: boolean;
  isAdmin?: boolean;
  canViewRoles?: boolean;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof UsersApiError || error instanceof RolesApiError || error instanceof AccessApiError ? error.message : fallback;
}

export function UsersScreen({ abilities, currentUserId }: { abilities: UsersAbilities; currentUserId: string }) {
  const queryClient = useQueryClient();
  // From laptop width (lg) up the email gets its own column; below it sits under the name, so the table still fits a tablet.
  const wide = useMinWidth(1024);
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: listMembers, enabled: abilities.canView });
  const optionsQuery = useQuery({ queryKey: OPTIONS_KEY, queryFn: getAccessOptions, enabled: abilities.canManageUsers || abilities.canAssignRoles });

  const router = useRouter();
  // Roles › "N people" links here with ?role=<id>: the list shows only the people holding that role, as a removable chip.
  const roleFilter = useSearchParams().get("role");
  const [search, setSearchState] = useState("");
  const [status, setStatusState] = useState("all");
  const [pageIndex, setPageIndex] = useState(0);
  // A new search or status starts again from the first page.
  const setSearch = (next: string) => { setSearchState(next); setPageIndex(0); };
  const setStatus = (next: string) => { setStatusState(next); setPageIndex(0); };
  const [statusTarget, setStatusTarget] = useState<MemberRow | null>(null);
  const [rolesTarget, setRolesTarget] = useState<MemberRow | null>(null);
  const [roleSelection, setRoleSelection] = useState<{ roleIds: string[]; primaryRoleId: string }>({ roleIds: [], primaryRoleId: "" });
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  // Disabling someone who still owns leads would strand them. The count is a courtesy: it is skipped when this administrator cannot see CRM.
  const disabling = statusTarget?.membership_status === "active" ? statusTarget : null;
  const activeLeads = useQuery({
    queryKey: [...QUERY_KEY, "active-leads", disabling?.user_id],
    queryFn: () => getUserActiveLeadCount(disabling!.user_id),
    enabled: Boolean(disabling),
    retry: false,
  });
  const leadsOwned = disabling ? (activeLeads.data?.total ?? 0) : 0;

  const statusMutation = useMutation({
    mutationFn: (member: MemberRow) => setMemberStatus(member.user_id, member.membership_status === "active" ? "disabled" : "active"),
    onSuccess: () => { setActionError(null); setStatusTarget(null); refresh(); },
    onError: (error: unknown) => { setStatusTarget(null); setActionError(errorMessage(error, "The member's status could not be changed.")); },
  });

  const rolesMutation = useMutation({
    mutationFn: () => setUserRoles(rolesTarget!.user_id, roleSelection.roleIds, roleSelection.primaryRoleId),
    onSuccess: () => { setDialogError(null); setRolesTarget(null); refresh(); },
    onError: (error: unknown) => setDialogError(errorMessage(error, "The role could not be changed.")),
  });

  const members = useMemo(() => query.data?.members ?? [], [query.data]);
  const counts = { active: members.filter((m) => m.membership_status === "active").length, disabled: members.filter((m) => m.membership_status !== "active").length };
  const needle = search.trim().toLowerCase();
  const roleFilterName = roleFilter ? members.find((member) => member.role_ids.includes(roleFilter))?.primary_role_name ?? "this role" : null;
  const rows = members.filter((member) =>
    (status === "all" || member.membership_status === status)
    && (!roleFilter || member.role_ids.includes(roleFilter))
    && (!needle || member.full_name.toLowerCase().includes(needle) || member.email.toLowerCase().includes(needle)));

  const openRoles = (member: MemberRow) => {
    // One role: the one they have (their primary, if an older record still lists more).
    const current = member.primary_role_id ?? member.role_ids[0] ?? "";
    setRoleSelection({ roleIds: current ? [current] : [], primaryRoleId: current });
    setDialogError(null);
    setRolesTarget(member);
  };

  const columns = useMemo<ColumnDef<MemberRow, unknown>[]>(() => [
    {
      id: "person", header: "Name", enableSorting: false,
      cell: ({ row }) => <Person member={row.original} isSelf={row.original.user_id === currentUserId} showEmail={!wide} />,
    },
    { id: "email", header: "Email", enableSorting: false, cell: ({ row }) => <span className="break-all text-text-secondary">{row.original.email}</span> },
    { id: "role", header: "Role", enableSorting: false, cell: ({ row }) => <RoleCell member={row.original} linkRoles={Boolean(abilities.canViewRoles)} /> },
    {
      id: "status", header: "Status", enableSorting: false,
      cell: ({ row }) => <StatusBadge tone={row.original.membership_status === "active" ? "success" : "neutral"}>{row.original.membership_status === "active" ? "Active" : "Disabled"}</StatusBadge>,
    },
    { id: "joined", header: "Joined", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap text-text-secondary">{formatDate(row.original.joined_at)}</span> },
  ], [currentUserId, wide, abilities.canViewRoles]);

  if (!abilities.canView) {
    return <PermissionState title="You don't have access to Users" description="Ask an administrator for access to view users." />;
  }

  const options = optionsQuery.data;
  const roles = options?.roles ?? [];
  const selectedRoles = roles.filter((role) => roleSelection.roleIds.includes(role.id));
  // Roles this person already holds that the current administrator could not grant: shown, never silently dropped, and saving is
  // blocked (the server would refuse it anyway).
  const lockedRoles = selectedRoles.filter((role) => !role.grantable);

  // Everything for a person is behind ⋯ (Change role first), so the table fits without scrolling sideways; clicking the row opens Change
  // roles. The wrapper keeps a click in the menu (rendered in a popover) from also counting as a click on the row.
  const actions = (member: MemberRow) => (
    <span onClick={(event) => event.stopPropagation()}>
      <MemberActionsMenu member={member} isSelf={member.user_id === currentUserId} isOwner={Boolean(abilities.isOwner)} isAdmin={Boolean(abilities.isAdmin)}
        canManageUsers={abilities.canManageUsers} onManageRoles={abilities.canAssignRoles && member.membership_role !== "owner" ? () => openRoles(member) : undefined}
        onToggleStatus={() => setStatusTarget(member)} onMessage={setNotice} />
    </span>
  );

  return (
    <>
      <EnterpriseListPage
        tabs={<PeopleAccessTabs current="users" />}
        header={{
          title: PEOPLE_ACCESS_TITLE,
          description: query.data
            ? `${counts.active} active${counts.disabled ? ` · ${counts.disabled} disabled` : ""}. Their roles decide what each person can see and do.`
            : "People in your organization and their roles.",
          primaryAction: abilities.canManageUsers ? (
            <Link href="/settings/invitations?new=1" className={buttonVariants({ variant: "primary" })}><UserPlus className="size-4" aria-hidden="true" />Invite someone</Link>
          ) : undefined,
          secondaryActions: abilities.canManageUsers ? (
            <Link href="/settings/invitations" className={buttonVariants({ variant: "outline" })}><Mail className="size-4" aria-hidden="true" />Invitations</Link>
          ) : undefined,
        }}
        actionBar={{
          // Search and status share one row at every width: wrapped together, the action bar keeps them side by side instead of giving
          // the search a line of its own on a phone. From sm up the status sits at the right end of the row.
          start: (
            <div className="flex w-full items-center gap-2">
              <SearchField aria-label="Search users" placeholder="Search name or email" className="min-w-0 flex-1 sm:w-72 sm:flex-none" value={search} onChange={setSearch} />
              <Select aria-label="Status" className="w-32 shrink-0 sm:ml-auto sm:w-40" selectedKey={status} onSelectionChange={(key) => setStatus(String(key))} options={STATUSES} />
            </div>
          ),
          collapseFilters: false,
        }}
      >
        <div className="flex flex-col gap-3">
          {actionError && <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{actionError}</p>}
          {notice && <p role="status" className="self-start rounded-[var(--radius-control)] bg-success-soft px-3 py-1.5 text-sm text-success">{notice}</p>}
          {roleFilterName && (
            <span className="inline-flex items-center gap-1 self-start rounded-full border border-border bg-surface py-0.5 pr-1 pl-3 text-sm text-text">
              {`Role: ${roleFilterName}`}
              <button type="button" aria-label="Show everyone" onClick={() => { setPageIndex(0); router.replace("/settings/users"); }}
                className="flex size-5 items-center justify-center rounded-full text-text-muted outline-none hover:bg-surface-muted hover:text-text focus-visible:ring-2 focus-visible:ring-brand">
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </span>
          )}
          <EnterpriseDataGrid<MemberRow>
            aria-label="Users"
            columns={columns}
            data={rows.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE)}
            getRowId={(row) => row.user_id}
            columnVisibility={{ email: wide }}
            pageIndex={pageIndex}
            pageSize={PAGE_SIZE}
            pageCount={Math.max(1, Math.ceil(rows.length / PAGE_SIZE))}
            totalRowCount={rows.length}
            onPageChange={setPageIndex}
            rowActions={actions}
            onRowClick={abilities.canAssignRoles ? (member) => member.membership_role !== "owner" && openRoles(member) : undefined}
            state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (members.length ? "no-results" : "empty") : "ready"}
            loadingContent={<LoadingState label="Loading users" rows={4} />}
            errorContent={<ErrorState title="Could not load users" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />}
            emptyContent={<EmptyState title="No users yet" description="People appear here once they accept an invitation." />}
            noResultsContent={<NoResultsState title="No one matches" description="Try another name, email or status." action={{ label: "Clear", onPress: () => { setSearch(""); setStatus("all"); } }} />}
            renderMobileCard={(member) => (
              // Everything beside the avatar: who, their email, then role and when they joined; the status top right and ⋯ under it.
              <div className="flex min-w-0 items-start gap-3">
                <Avatar size="sm" name={member.full_name} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-text">
                    {member.full_name}{member.user_id === currentUserId && <span className="font-normal text-text-muted"> (you)</span>}
                  </span>
                  <span className="truncate text-xs text-text-muted">{member.email}</span>
                  <span className="mt-1 truncate text-xs text-text-secondary">
                    {`${member.primary_role_name ?? "No role"}${member.role_names.length > 1 ? ` +${member.role_names.length - 1}` : ""} · Joined ${formatDate(member.joined_at)}`}
                  </span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusBadge tone={member.membership_status === "active" ? "success" : "neutral"}>{member.membership_status === "active" ? "Active" : "Disabled"}</StatusBadge>
                  {actions(member)}
                </div>
              </div>
            )}
          />
        </div>
      </EnterpriseListPage>

      <AlertDialog
        isOpen={Boolean(statusTarget)}
        onOpenChange={(open) => !open && setStatusTarget(null)}
        title={statusTarget?.membership_status === "active" ? "Disable this user?" : "Enable this user?"}
        description={
          statusTarget?.membership_status === "active" ? (
            <>
              {`${statusTarget?.full_name} will lose access immediately and be signed out of every active session.`}
              {leadsOwned > 0 && (
                <span className="mt-2 block font-medium text-text">
                  {`${statusTarget?.full_name} has ${leadsOwned} active ${leadsOwned === 1 ? "lead" : "leads"}. `}
                  <Link className="text-brand underline" href={`/crm/settings/leads/assignment?transferFrom=${statusTarget?.user_id}`}>Transfer active leads</Link>
                  {" before disabling, or they stay with a user who cannot work them."}
                </span>
              )}
            </>
          ) : (
            `${statusTarget?.full_name} will regain access to this organization.`
          )
        }
        confirmLabel={statusTarget?.membership_status === "active" ? "Disable" : "Enable"}
        isConfirming={statusMutation.isPending}
        onConfirm={() => statusTarget && statusMutation.mutate(statusTarget)}
      />

      <Dialog
        isOpen={Boolean(rolesTarget)}
        onOpenChange={(open) => !open && setRolesTarget(null)}
        title={`Change role — ${rolesTarget?.full_name ?? ""}`}
        description="Each person has one role. Effective access shows what it lets them do."
        size="xl"
        footer={(
          <>
            <Button variant="secondary" onPress={() => setRolesTarget(null)}>Cancel</Button>
            <Button variant="primary" isLoading={rolesMutation.isPending}
              isDisabled={roleSelection.roleIds.length === 0 || !roleSelection.primaryRoleId || lockedRoles.length > 0} onPress={() => rolesMutation.mutate()}>
              Save role
            </Button>
          </>
        )}
      >
        {/* Roles on the left; from md up, what they add up to stays in view on the right while the roles scroll. */}
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="flex min-w-0 flex-col gap-4">
            {optionsQuery.isLoading ? <LoadingState label="Loading roles" rows={3} /> : (
              <RoleSelector roles={roles} roleIds={roleSelection.roleIds} primaryRoleId={roleSelection.primaryRoleId} onChange={setRoleSelection} />
            )}
          </div>
          <div className="flex flex-col gap-3 md:sticky md:top-0 md:self-start">
            {lockedRoles.length > 0 && (
              <p role="note" className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm text-warning">
                {`${lockedRoles.map((role) => role.name).join(", ")} can only be changed by an administrator who holds that access.`}
              </p>
            )}
            {selectedRoles.length ? <EffectiveAccessSummary roles={selectedRoles} />
              : <p className="rounded-[var(--radius-control)] border border-dashed border-border px-3 py-4 text-sm text-text-secondary">Pick a role to see what this person will be able to do.</p>}
            {dialogError && rolesTarget ? <p role="alert" className="text-sm text-danger">{dialogError}</p> : null}
          </div>
        </div>
      </Dialog>
    </>
  );
}

// The name with their initials, and the email under it when it has no column of its own; your own row says so quietly instead of with
// another badge.
function Person({ member, isSelf, showEmail }: { member: MemberRow; isSelf: boolean; showEmail: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar size="sm" name={member.full_name} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-text">
          {member.full_name}{isSelf && <span className="font-normal text-text-muted"> (you)</span>}
        </span>
        {showEmail && <span className="truncate text-xs text-text-muted">{member.email}</span>}
      </span>
    </span>
  );
}

// Their role (and how many more an older record still lists, named in the tooltip). With access to Roles the name opens that role's
// details there; the click stays out of the row, which opens Change role.
function RoleCell({ member, linkRoles }: { member: MemberRow; linkRoles: boolean }) {
  const others = member.role_names.filter((name) => name !== member.primary_role_name);
  if (!member.primary_role_name) return <span className="text-text-muted">No role</span>;
  return (
    <span className="whitespace-nowrap text-sm text-text" title={others.length ? `Also: ${others.join(", ")}` : undefined}>
      {linkRoles && member.primary_role_id
        ? <Link href={`/settings/roles?role=${member.primary_role_id}`} onClick={(event) => event.stopPropagation()} className="hover:text-brand hover:underline">{member.primary_role_name}</Link>
        : member.primary_role_name}
      {others.length > 0 && <span className="text-text-muted">{` +${others.length}`}</span>}
    </span>
  );
}

"use client";

// Settings › Invitations: every invitation as a list, laid out like Users — who was invited, as what, its status, who invited them and
// when it expires (or was accepted) — with search, a status filter and Invite someone at the top. A pending invitation's ⋯ holds Resend
// and Revoke. Invite someone opens a dialog with the email and the one role on the left and what that role lets them do on the right;
// Users › Invite someone links here with ?new=1, which opens it straight away.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, UserPlus, Users } from "lucide-react";
import {
  AlertDialog,
  Button,
  Dialog,
  EmptyState,
  EnterpriseDataGrid,
  EnterpriseListPage,
  ErrorState,
  IconButton,
  Menu,
  MenuItem,
  MenuTrigger,
  NoResultsState,
  PermissionState,
  SearchField,
  Select,
  StatusBadge,
  TextField,
  buttonVariants,
} from "@vercentlabs/design-system";

import { getAccessOptions } from "@/features/settings/access/api/access-api";
import { EffectiveAccessSummary } from "@/features/settings/access/EffectiveAccessSummary";
import { RoleSelector } from "@/features/settings/access/RoleSelector";
import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { useMinWidth } from "@/shared/ui/use-min-width";
import {
  createInvitation,
  InvitationRow,
  InvitationsApiError,
  listInvitations,
  resendInvitation,
  revokeInvitation,
} from "../api/invitations-api";
import { INVITATIONS_QUERY_KEY, PEOPLE_ACCESS_TITLE, PeopleAccessTabs } from "@/features/settings/people/PeopleAccessTabs";

// Shared with the People and access tab row, which shows the pending count from the same list.
const QUERY_KEY = INVITATIONS_QUERY_KEY;
const PAGE_SIZE = 20;

const STATUS: Record<InvitationRow["status"], { label: string; tone: "success" | "warning" | "neutral" | "danger" }> = {
  pending: { label: "Pending", tone: "warning" },
  accepted: { label: "Accepted", tone: "success" },
  revoked: { label: "Revoked", tone: "neutral" },
  expired: { label: "Expired", tone: "danger" },
};
const STATUSES = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "expired", label: "Expired" },
  { value: "revoked", label: "Revoked" },
];

const EMPTY_FORM = { email: "", roleIds: [] as string[], primaryRoleId: "", note: "" };

const days = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 86_400_000);
// When, in words: "in 6 days" while pending, "Accepted 22 Oct 2026", "Expired 3 days ago", "Revoked 22 Oct 2026".
function whenLabel(invitation: InvitationRow) {
  const now = new Date();
  if (invitation.status === "accepted" && invitation.accepted_at) return `Accepted ${formatDate(invitation.accepted_at)}`;
  if (invitation.status === "revoked" && invitation.revoked_at) return `Revoked ${formatDate(invitation.revoked_at)}`;
  const expires = new Date(invitation.expires_at);
  const left = days(now, expires);
  if (invitation.status === "expired" || left < 0) {
    const ago = Math.max(0, -left);
    return ago === 0 ? "Expired today" : `Expired ${ago} ${ago === 1 ? "day" : "days"} ago`;
  }
  return left === 0 ? "Expires today" : `Expires in ${left} ${left === 1 ? "day" : "days"}`;
}

export function InvitationsScreen({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: listInvitations, enabled: canManage });
  const optionsQuery = useQuery({ queryKey: ["settings", "access", "options"], queryFn: getAccessOptions, enabled: canManage });
  // From laptop width (lg) up "Invited by" gets its own column; below it sits under the email, so the table still fits a tablet.
  const wide = useMinWidth(1024);

  const params = useSearchParams();
  const [createOpen, setCreateOpen] = useState(() => canManage && params.get("new") === "1");
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<InvitationRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearchState] = useState("");
  const [status, setStatusState] = useState("all");
  const [pageIndex, setPageIndex] = useState(0);
  // A new search or status starts again from the first page.
  const setSearch = (next: string) => { setSearchState(next); setPageIndex(0); };
  const setStatus = (next: string) => { setStatusState(next); setPageIndex(0); };

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  const failure = (error: unknown, fallback: string) => (error instanceof InvitationsApiError ? error.message : fallback);

  const createMutation = useMutation({
    mutationFn: () => createInvitation(form),
    onSuccess: () => {
      setFormError(null);
      setNotice(`Invitation sent to ${form.email.trim()}.`);
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      refresh();
    },
    onError: (error: unknown) => setFormError(failure(error, "The invitation could not be sent.")),
  });
  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeInvitation(id),
    onSuccess: () => { setActionError(null); setRevokeTarget(null); refresh(); },
    onError: (error: unknown) => setActionError(failure(error, "The invitation could not be revoked.")),
  });
  const resendMutation = useMutation({
    mutationFn: (invitation: InvitationRow) => resendInvitation(invitation.id),
    onSuccess: (_, invitation) => { setActionError(null); setNotice(`Invitation resent to ${invitation.email}.`); refresh(); },
    onError: (error: unknown) => setActionError(failure(error, "The invitation could not be resent.")),
  });

  const invitations = useMemo(() => query.data?.invitations ?? [], [query.data]);
  const columns = useMemo<ColumnDef<InvitationRow, unknown>[]>(() => [
    {
      id: "email", header: "Email", enableSorting: false,
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-text">{row.original.email}</span>
          {!wide && <span className="truncate text-xs text-text-muted">{`Invited by ${row.original.invited_by_name}`}</span>}
        </span>
      ),
    },
    { id: "role", header: "Role", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap text-sm text-text">{row.original.primary_role_name ?? "No role"}</span> },
    { id: "status", header: "Status", enableSorting: false, cell: ({ row }) => <StatusBadge tone={STATUS[row.original.status].tone}>{STATUS[row.original.status].label}</StatusBadge> },
    { id: "invitedBy", header: "Invited by", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap text-text-secondary">{row.original.invited_by_name}</span> },
    { id: "when", header: "When", enableSorting: false, cell: ({ row }) => <span className="whitespace-nowrap text-text-secondary">{whenLabel(row.original)}</span> },
  ], [wide]);

  if (!canManage) {
    return <PermissionState title="You don't have access to Invitations" description="Ask an administrator for permission to manage users." />;
  }

  const roles = optionsQuery.data?.roles ?? [];
  const selectedRoles = roles.filter((role) => form.roleIds.includes(role.id));
  const seats = query.data?.seats;
  const seatsFull = seats?.available === 0;
  const pending = invitations.filter((invitation) => invitation.status === "pending").length;
  const canSubmit = form.email.trim() !== "" && form.roleIds.length > 0 && Boolean(form.primaryRoleId) && !seatsFull;

  const needle = search.trim().toLowerCase();
  const rows = invitations.filter((invitation) => (status === "all" || invitation.status === status) && (!needle || invitation.email.toLowerCase().includes(needle)));

  // Resend and Revoke behind ⋯, for a pending invitation only.
  const actions = (invitation: InvitationRow) => invitation.status !== "pending" ? null : (
    <MenuTrigger>
      <IconButton aria-label={`More actions for ${invitation.email}`} variant="ghost" size="compact"><MoreHorizontal className="size-4" aria-hidden="true" /></IconButton>
      <Menu onAction={(id) => (id === "resend" ? resendMutation.mutate(invitation) : setRevokeTarget(invitation))}>
        <MenuItem id="resend">Resend invitation</MenuItem>
        <MenuItem id="revoke" isDanger>Revoke invitation</MenuItem>
      </Menu>
    </MenuTrigger>
  );

  return (
    <>
      <EnterpriseListPage
        tabs={<PeopleAccessTabs current="invitations" />}
        header={{
          title: PEOPLE_ACCESS_TITLE,
          description: seats && seats.capacity !== null
            ? `${seats.used} of ${seats.capacity} users on your plan are in use, counting pending invitations.`
            : query.data ? `${pending} pending. People join once they accept.` : "People you have invited and whether they have joined.",
          primaryAction: (
            <Button variant="primary" onPress={() => setCreateOpen(true)}><UserPlus className="size-4" aria-hidden="true" />Invite someone</Button>
          ),
          secondaryActions: <Link href="/settings/users" className={buttonVariants({ variant: "outline" })}><Users className="size-4" aria-hidden="true" />Users</Link>,
        }}
        actionBar={{
          // Search and status share one row at every width; from sm up the status sits at the right end.
          start: (
            <div className="flex w-full items-center gap-2">
              <SearchField aria-label="Search invitations" placeholder="Search email" className="min-w-0 flex-1 sm:w-72 sm:flex-none" value={search} onChange={setSearch} />
              <Select aria-label="Status" className="w-32 shrink-0 sm:ml-auto sm:w-40" selectedKey={status} onSelectionChange={(key) => setStatus(String(key))} options={STATUSES} />
            </div>
          ),
          collapseFilters: false,
        }}
      >
        <div className="flex flex-col gap-3">
          {actionError && <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{actionError}</p>}
          {notice && <p role="status" className="self-start rounded-[var(--radius-control)] bg-success-soft px-3 py-1.5 text-sm text-success">{notice}</p>}
          <EnterpriseDataGrid<InvitationRow>
            aria-label="Invitations"
            columns={columns}
            data={rows.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE)}
            getRowId={(row) => row.id}
            columnVisibility={{ invitedBy: wide }}
            rowActions={actions}
            pageIndex={pageIndex}
            pageSize={PAGE_SIZE}
            pageCount={Math.max(1, Math.ceil(rows.length / PAGE_SIZE))}
            totalRowCount={rows.length}
            onPageChange={setPageIndex}
            state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (invitations.length ? "no-results" : "empty") : "ready"}
            loadingContent={<LoadingState label="Loading invitations" rows={4} />}
            errorContent={<ErrorState title="Could not load invitations" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />}
            emptyContent={<EmptyState title="No invitations yet" description="Invite someone to give them their own sign-in." action={{ label: "Invite someone", onPress: () => setCreateOpen(true) }} />}
            noResultsContent={<NoResultsState title="No invitation matches" description="Try another email or status." action={{ label: "Clear", onPress: () => { setSearch(""); setStatus("all"); } }} />}
            renderMobileCard={(invitation) => (
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-text">{invitation.email}</span>
                  <span className="truncate text-xs text-text-secondary">{invitation.primary_role_name ?? "No role"}</span>
                  <span className="mt-1 truncate text-xs text-text-muted">{`${whenLabel(invitation)} · by ${invitation.invited_by_name}`}</span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusBadge tone={STATUS[invitation.status].tone}>{STATUS[invitation.status].label}</StatusBadge>
                  {actions(invitation)}
                </div>
              </div>
            )}
          />
        </div>
      </EnterpriseListPage>

      <Dialog
        isOpen={createOpen}
        onOpenChange={(open) => { if (!open) { setCreateOpen(false); setFormError(null); } }}
        title="Invite someone"
        description="They get an email to set up their own sign-in. Their role decides what they can see and do."
        size="xl"
        footer={(
          <>
            <Button variant="secondary" onPress={() => { setCreateOpen(false); setFormError(null); }}>Cancel</Button>
            <Button variant="primary" isDisabled={!canSubmit} isLoading={createMutation.isPending} onPress={() => createMutation.mutate()}>Send invitation</Button>
          </>
        )}
      >
        {/* The email and the role on the left; from md up, what the role lets them do stays in view on the right. */}
        <form className="grid gap-5 md:grid-cols-[minmax(0,1fr)_18rem]" noValidate onSubmit={(event) => { event.preventDefault(); if (canSubmit) createMutation.mutate(); }}>
          <div className="flex min-w-0 flex-col gap-4">
            <TextField label="Email" type="email" isRequired value={form.email} onChange={(email) => setForm((current) => ({ ...current, email }))} />
            {optionsQuery.isLoading ? <LoadingState label="Loading roles" rows={3} /> : (
              <RoleSelector roles={roles} roleIds={form.roleIds} primaryRoleId={form.primaryRoleId} onChange={(next) => setForm((current) => ({ ...current, ...next }))} />
            )}
          </div>
          <div className="flex flex-col gap-3 md:sticky md:top-0 md:self-start">
            {selectedRoles.length ? <EffectiveAccessSummary roles={selectedRoles} />
              : <p className="rounded-[var(--radius-control)] border border-dashed border-border px-3 py-4 text-sm text-text-secondary">Pick a role to see what they will be able to do.</p>}
            <TextField label="A short note for the email (optional)" value={form.note} maxLength={300} onChange={(note) => setForm((current) => ({ ...current, note }))} />
            {seatsFull && <p className="text-sm text-warning">All users on your plan are in use. Add users in Settings › Billing to send more invitations.</p>}
            {formError && <p role="alert" className="text-sm text-danger">{formError}</p>}
          </div>
        </form>
      </Dialog>

      <AlertDialog
        isOpen={Boolean(revokeTarget)}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke this invitation?"
        description={`${revokeTarget?.email} will no longer be able to accept this invitation.`}
        confirmLabel="Revoke invitation"
        isConfirming={revokeMutation.isPending}
        onConfirm={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)}
      />
    </>
  );
}

"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, Badge, Button, Dialog, EmptyState, ErrorState, PageHeader, PermissionState, TextField } from "@vercentlabs/design-system";

import { getAccessOptions } from "@/features/settings/access/api/access-api";
import { EffectiveAccessSummary } from "@/features/settings/access/EffectiveAccessSummary";
import { RoleSelector } from "@/features/settings/access/RoleSelector";
import { ScopeSelector } from "@/features/settings/access/ScopeSelector";
import { createInvitation, InvitationRow, InvitationsApiError, listInvitations, resendInvitation, revokeInvitation } from "../api/invitations-api";

const QUERY_KEY = ["settings", "invitations"];

const STATUS: Record<InvitationRow["status"], { label: string; tone: "success" | "warning" | "neutral" | "danger" }> = {
  pending: { label: "Pending", tone: "warning" },
  accepted: { label: "Accepted", tone: "success" },
  revoked: { label: "Revoked", tone: "neutral" },
  expired: { label: "Expired", tone: "danger" },
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

const EMPTY_FORM = { email: "", roleIds: [] as string[], primaryRoleId: "", companyIds: [] as string[], branchIds: [] as string[], departmentIds: [] as string[], teamIds: [] as string[] };

export function InvitationsScreen({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: listInvitations, enabled: canManage });
  const optionsQuery = useQuery({ queryKey: ["settings", "access", "options"], queryFn: getAccessOptions, enabled: canManage });

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<InvitationRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resentMessage, setResentMessage] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => createInvitation(form),
    onSuccess: () => {
      setFormError(null);
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: unknown) => setFormError(error instanceof InvitationsApiError ? error.message : "The invitation could not be sent."),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeInvitation(id),
    onSuccess: () => {
      setActionError(null);
      setRevokeTarget(null);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: unknown) => setActionError(error instanceof InvitationsApiError ? error.message : "The invitation could not be revoked."),
  });

  const resendMutation = useMutation({
    mutationFn: (id: string) => resendInvitation(id),
    onSuccess: () => {
      setActionError(null);
      setResentMessage("Invitation resent.");
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: unknown) => setActionError(error instanceof InvitationsApiError ? error.message : "The invitation could not be resent."),
  });

  if (!canManage) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <PermissionState title="You don't have access to Invitations" description="Ask an administrator for permission to manage users." />
      </div>
    );
  }

  const invitations = query.data?.invitations ?? [];
  const options = optionsQuery.data;
  const roles = options?.roles ?? [];
  const selectedRoles = roles.filter((role) => form.roleIds.includes(role.id));
  const scoped = options?.scope ? !options.scope.unrestricted : false;
  const seats = query.data?.seats;
  const seatsFull = seats?.available === 0;
  const seatLine = seats && seats.capacity !== null ? `${seats.used} of ${seats.capacity} users on your plan are used (members and pending invitations).` : null;
  const canSubmit = form.email.trim() !== "" && form.roleIds.length > 0 && Boolean(form.primaryRoleId) && (!scoped || form.companyIds.length > 0) && !seatsFull;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Invitations"
        description={seatLine ?? "Invite people and track pending invitations."}
        primaryAction={
          <Button variant="primary" onPress={() => setCreateOpen(true)}>
            Invite someone
          </Button>
        }
      />

      {actionError ? (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      ) : null}
      {resentMessage ? <p className="text-sm text-success">{resentMessage}</p> : null}

      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : query.isError ? (
        <ErrorState title="Could not load invitations" description="Something went wrong." action={{ label: "Retry", onPress: () => query.refetch() }} />
      ) : invitations.length === 0 ? (
        <EmptyState title="No invitations yet" />
      ) : (
        <ul className="flex max-w-[960px] flex-col gap-2" aria-label="Invitations">
          {invitations.map((invitation) => {
            const others = invitation.roles.filter((role) => !role.isPrimary).map((role) => role.name);
            return (
              <li key={invitation.id} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium break-all text-text">{invitation.email}</span>
                    <Badge tone={STATUS[invitation.status].tone}>{STATUS[invitation.status].label}</Badge>
                  </div>
                  <span className="text-xs text-text-secondary">
                    {invitation.primary_role_name ?? "No role"}
                    {others.length > 0 ? ` + ${others.join(", ")}` : ""}
                    {" · "}
                    {invitation.company_names.length ? invitation.company_names.join(", ") : "Organisation-wide"}
                    {invitation.branch_names.length ? ` (${invitation.branch_names.join(", ")})` : ""}
                  </span>
                  <span className="text-xs text-text-muted">
                    Invited by {invitation.invited_by_name} · expires {dateTimeFormatter.format(new Date(invitation.expires_at))}
                  </span>
                </div>
                {invitation.status === "pending" && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="compact" isLoading={resendMutation.isPending} onPress={() => resendMutation.mutate(invitation.id)}>
                      Resend
                    </Button>
                    <Button variant="secondary" size="compact" onPress={() => setRevokeTarget(invitation)}>
                      Revoke
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog isOpen={createOpen} onOpenChange={(open) => !open && setCreateOpen(false)} title="Invite someone">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) createMutation.mutate();
          }}
          noValidate
        >
          <TextField label="Email" type="email" isRequired value={form.email} onChange={(email) => setForm((current) => ({ ...current, email }))} />
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">Roles</span>
            <RoleSelector
              roles={roles}
              roleIds={form.roleIds}
              primaryRoleId={form.primaryRoleId}
              onChange={(next) => setForm((current) => ({ ...current, ...next }))}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">Access scope</span>
            {scoped && <p className="text-xs text-text-muted">Choose at least one company you administer.</p>}
            <ScopeSelector
              companies={options?.scope?.companies ?? []}
              departments={options?.scope?.departments ?? []}
              teams={options?.scope?.teams ?? []}
              companyIds={form.companyIds}
              branchIds={form.branchIds}
              departmentIds={form.departmentIds}
              teamIds={form.teamIds}
              onChange={(next) => setForm((current) => ({ ...current, ...next }))}
            />
          </div>
          <EffectiveAccessSummary roles={selectedRoles} />
          {seatsFull ? <p className="text-sm text-warning">All users on your plan are in use. Add users in Settings &gt; Billing to send more invitations.</p> : null}
          {formError ? (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          ) : null}
          <Button type="submit" variant="primary" isDisabled={!canSubmit} isLoading={createMutation.isPending}>
            Send invitation
          </Button>
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
    </div>
  );
}

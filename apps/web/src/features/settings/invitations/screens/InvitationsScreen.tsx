"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, Badge, Button, Checkbox, Dialog, EmptyState, ErrorState, PageHeader, PermissionState, Select, TextField } from "@vercentlabs/design-system";

import { listCompanies } from "@/features/settings/companies/api/companies-api";
import { listBranches } from "@/features/settings/branches/api/branches-api";
import { listRoles } from "@/features/settings/roles/api/roles-api";
import { createInvitation, InvitationRow, InvitationsApiError, listInvitations, resendInvitation, revokeInvitation } from "../api/invitations-api";

const QUERY_KEY = ["settings", "invitations"];

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  pending: "warning",
  accepted: "success",
  revoked: "neutral",
  expired: "danger",
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function InvitationsScreen({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: listInvitations });
  const rolesQuery = useQuery({ queryKey: ["settings", "roles"], queryFn: listRoles });
  const companiesQuery = useQuery({ queryKey: ["settings", "companies"], queryFn: listCompanies });
  const branchesQuery = useQuery({ queryKey: ["settings", "branches"], queryFn: listBranches });

  const [createOpen, setCreateOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<InvitationRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resentMessage, setResentMessage] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => createInvitation({ email, roleId, companyIds, branchIds }),
    onSuccess: () => {
      setFormError(null);
      setCreateOpen(false);
      setEmail("");
      setRoleId("");
      setCompanyIds([]);
      setBranchIds([]);
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
      <div className="flex flex-1 flex-col gap-6 px-8 py-10">
        <PermissionState title="You don't have access to Invitations" description="Ask an administrator to grant users.manage." />
      </div>
    );
  }

  const invitations = query.data?.invitations ?? [];
  const roles = rolesQuery.data?.roles ?? [];
  const companies = companiesQuery.data?.companies ?? [];
  const branches = branchesQuery.data?.branches ?? [];
  const roleOptions = roles.filter((r) => r.assignable).map((r) => ({ value: r.id, label: r.name }));

  return (
    <div className="flex flex-1 flex-col gap-6 px-8 py-10">
      <PageHeader
        title="Invitations"
        description="Pending invitations and their status."
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
        <ul className="flex max-w-[860px] flex-col gap-2">
          {invitations.map((invitation) => (
            <li key={invitation.id} className="flex items-center justify-between gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text">{invitation.email}</span>
                  <Badge tone={STATUS_TONE[invitation.status]}>{invitation.status}</Badge>
                </div>
                <span className="text-xs text-text-muted">
                  {invitation.role_name ?? "No role"} · invited by {invitation.invited_by_name} · expires {dateTimeFormatter.format(new Date(invitation.expires_at))}
                </span>
              </div>
              {invitation.status === "pending" && (
                <div className="flex gap-2">
                  <Button variant="secondary" size="compact" isLoading={resendMutation.isPending} onPress={() => resendMutation.mutate(invitation.id)}>
                    Resend
                  </Button>
                  <Button variant="secondary" size="compact" onPress={() => setRevokeTarget(invitation)}>
                    Revoke
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog isOpen={createOpen} onOpenChange={(open) => !open && setCreateOpen(false)} title="Invite someone">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate();
          }}
          noValidate
        >
          <TextField label="Email" type="email" isRequired value={email} onChange={setEmail} />
          <Select label="Role" isRequired options={roleOptions} selectedKey={roleId} onSelectionChange={(key) => setRoleId(String(key))} />
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">Company access</span>
            {companies.map((company) => (
              <Checkbox
                key={company.id}
                isSelected={companyIds.includes(company.id)}
                onChange={(isSelected) => setCompanyIds((current) => (isSelected ? [...current, company.id] : current.filter((id) => id !== company.id)))}
              >
                {company.name}
              </Checkbox>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">Branch access</span>
            {branches.map((branch) => (
              <Checkbox
                key={branch.id}
                isSelected={branchIds.includes(branch.id)}
                onChange={(isSelected) => setBranchIds((current) => (isSelected ? [...current, branch.id] : current.filter((id) => id !== branch.id)))}
              >
                {branch.name}
              </Checkbox>
            ))}
          </div>
          {formError ? (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          ) : null}
          <Button type="submit" variant="primary" isLoading={createMutation.isPending}>
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

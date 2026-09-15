"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Pencil, Users } from "lucide-react";
import { Button, ConflictBanner, ErrorState, PermissionState, RecordDetailsPage, StatusBadge } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { NotesPanel } from "@/features/crm/shared/NotesPanel";
import { CrmAttachmentPanel } from "@/features/crm/shared/CrmAttachmentPanel";
import { CustomFieldsRuntimePanel } from "@/features/crm/shared/CustomFieldsRuntimePanel";
import { AccountApiError, archiveAccount, getAccount } from "../api/accounts-api";
import { AccountHierarchyPanel } from "../components/AccountHierarchyPanel";
import { AccountDuplicatesPanel } from "../components/AccountDuplicatesPanel";
import { AccountPlanPanel } from "../components/AccountPlanPanel";
import { AccountContactRelationshipsPanel } from "../components/AccountContactRelationshipsPanel";
import { AccountCommunicationsPanel } from "../components/AccountCommunicationsPanel";

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-sm text-text">{value === null || value === undefined || value === "" ? "—" : value}</span>
    </div>
  );
}

export function AccountDetailScreen({ accountId }: { accountId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.accountsManage);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const accountQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "accounts", accountId),
    queryFn: () => getAccount(accountId),
  });
  const account = accountQuery.data?.record;

  const archiveMutation = useMutation({
    mutationFn: () => archiveAccount(accountId, account!.updatedAt),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "accounts") });
    },
    onError: (error: unknown) => {
      if (error instanceof AccountApiError && error.code === "CRM_STALE_WRITE") {
        setConflictMessage(error.message);
        return;
      }
      setActionError(error instanceof Error ? error.message : "This action could not be completed.");
    },
  });

  if (accountQuery.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading account…</p>;
  if (accountQuery.isError) {
    if (accountQuery.error instanceof AccountApiError && accountQuery.error.status === 403) {
      return <PermissionState title="You don't have access to this Account" />;
    }
    return <ErrorState title="Account not found" description="This Account may have been merged or removed." action={{ label: "Back to Accounts", onPress: () => router.push("/crm/accounts") }} />;
  }
  if (!account) return null;

  return (
    <RecordDetailsPage
      header={{
        title: account.displayName,
        status: <StatusBadge tone={account.status === "active" ? "success" : "neutral"}>{account.status}</StatusBadge>,
        fields: [
          { label: "Industry", value: account.industry || "—" },
          { label: "Contacts", value: account.relationships?.contacts ?? 0 },
          { label: "Opportunities", value: account.relationships?.opportunities ?? 0 },
        ],
        primaryAction:
          canManage && account.status === "active" ? (
            <Button variant="secondary" onPress={() => router.push(`/crm/accounts/${accountId}/edit`)}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
          ) : undefined,
        secondaryActions:
          canManage && account.status === "active" ? (
            <Button variant="danger" onPress={() => archiveMutation.mutate()} isLoading={archiveMutation.isPending}>
              <Archive className="size-4" aria-hidden="true" />
              Archive
            </Button>
          ) : undefined,
      }}
    >
      <div className="flex flex-col gap-6 py-4">
        {conflictMessage && <ConflictBanner message={conflictMessage} onReload={() => router.refresh()} />}
        {actionError && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {actionError}
          </p>
        )}
        <AccountDuplicatesPanel account={account} canManage={canManage} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Legal name" value={account.legalName} />
          <Field label="Website" value={account.website} />
          <Field label="Phone" value={account.phone} />
          <Field label="Email" value={account.email} />
          <Field label="GSTIN" value={account.gstin} />
          <Field label="PAN" value={account.pan} />
          <Field label="MSME number" value={account.msmeNumber} />
          <Field label="Currency" value={account.currencyCode} />
          <Field label="Address" value={account.addressLine1} />
          <Field label="City" value={account.city} />
          <Field label="State" value={account.state} />
          <Field label="Country" value={account.countryCode} />
        </div>
        <div className="flex items-center gap-2 border-t border-border pt-4">
          <Users className="size-4 text-text-muted" aria-hidden="true" />
          <button type="button" className="text-sm text-brand hover:underline" onClick={() => router.push(`/crm/contacts?accountId=${accountId}`)}>
            View {account.relationships?.contacts ?? 0} contact{account.relationships?.contacts === 1 ? "" : "s"} for this account
          </button>
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm font-semibold text-text">Contact relationships</p>
          <AccountContactRelationshipsPanel accountId={accountId} />
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm font-semibold text-text">Hierarchy</p>
          <AccountHierarchyPanel accountId={accountId} canManage={canManage} />
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm font-semibold text-text">Account plan</p>
          <AccountPlanPanel accountId={accountId} canManage={canManage} />
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm font-semibold text-text">Notes</p>
          <NotesPanel entityType="party" entityId={accountId} />
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm font-semibold text-text">Attachments</p>
          <CrmAttachmentPanel entityType="party" entityId={accountId} />
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm font-semibold text-text">Communications</p>
          <AccountCommunicationsPanel accountId={accountId} />
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm font-semibold text-text">Custom fields</p>
          <CustomFieldsRuntimePanel entityType="party" entityId={accountId} />
        </div>
      </div>
    </RecordDetailsPage>
  );
}

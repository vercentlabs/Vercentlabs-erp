"use client";

// Merging a duplicate into the account being viewed. The user picks the
// duplicate, sees both records side by side, chooses which value survives
// for each field, and sees what will move before confirming.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Dialog, Radio, RadioGroup } from "@vercentlabs/design-system";

import { formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, mergeAccounts, previewAccountMerge, type Account } from "../api/accounts-api";
import { ErrorBanner, TYPE_LABELS } from "../account-format";
import { AccountPicker } from "./AccountPicker";

const FIELD_LABELS: Record<string, string> = {
  displayName: "Account name", legalName: "Legal name", industry: "Industry", website: "Website", email: "Email", phone: "Phone",
  secondaryPhone: "Secondary phone", employeeRange: "Employees", annualRevenue: "Annual revenue", description: "Description",
  sourceId: "Source", ownerUserId: "Owner", teamId: "Team",
};

// What each field shows in the comparison (ids are shown by their names).
function display(account: Account, field: string): string {
  if (field === "sourceId") return account.sourceName ?? "";
  if (field === "ownerUserId") return account.ownerName ?? "";
  if (field === "teamId") return account.teamName ?? "";
  if (field === "annualRevenue") return account.annualRevenue === null ? "" : formatMoney(account.currencyCode ?? undefined, account.annualRevenue);
  const value = (account as unknown as Record<string, unknown>)[field];
  return value === null || value === undefined ? "" : String(value);
}

export function MergeAccountsDialog({ keep, isOpen, onOpenChange, initialDuplicateId = null, onMerged }: {
  keep: Account; isOpen: boolean; onOpenChange: (open: boolean) => void; initialDuplicateId?: string | null; onMerged: () => void;
}) {
  const workspace = useWorkspaceContext();
  const [duplicateId, setDuplicateId] = useState<string | null>(initialDuplicateId);
  const [choices, setChoices] = useState<Record<string, "keep" | "duplicate">>({});
  const [error, setError] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "account-merge", keep.id, duplicateId),
    queryFn: () => previewAccountMerge(keep.id, duplicateId as string),
    enabled: isOpen && Boolean(duplicateId),
  });
  const mutation = useMutation({
    mutationFn: () => mergeAccounts({ keepId: keep.id, duplicateId: duplicateId as string, choices }),
    onSuccess: () => { setError(null); setDuplicateId(null); setChoices({}); onOpenChange(false); onMerged(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const data = preview.data;
  const differing = data ? data.fields.filter((field) => display(data.keep, field) !== display(data.duplicate, field) && display(data.duplicate, field)) : [];
  const moves = data ? Object.entries(data.moves).filter(([, count]) => count > 0) : [];

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={`Merge a duplicate into ${keep.displayName}`}
      description="Everything recorded against the duplicate moves to this account. The duplicate is archived, not deleted, and links to it open this account." size="lg">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <AccountPicker label="Duplicate account" value={duplicateId} excludeId={keep.id} onChange={(id) => { setDuplicateId(id); setChoices({}); setError(null); }} />
        {duplicateId && preview.isLoading && <LoadingState label="Comparing accounts" rows={3} />}
        {preview.isError && <ErrorBanner message={errorMessage(preview.error)} />}
        {data && (
          <>
            {data.blockers.length > 0 && (
              <div role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
                {data.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)}
              </div>
            )}
            <p className="text-sm text-text-secondary">
              Keeping <strong>{data.keep.displayName}</strong> ({data.keep.code}, {TYPE_LABELS[data.keep.accountType]}); merging <strong>{data.duplicate.displayName}</strong> ({data.duplicate.code}, {TYPE_LABELS[data.duplicate.accountType]}).
            </p>
            {differing.length > 0 ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">Choose which value to keep</p>
                {differing.map((field) => (
                  <RadioGroup key={field} label={FIELD_LABELS[field] ?? field} orientation="vertical"
                    value={choices[field] ?? (display(data.keep, field) ? "keep" : "duplicate")}
                    onChange={(value) => setChoices((current) => ({ ...current, [field]: value as "keep" | "duplicate" }))}>
                    <Radio value="keep">{display(data.keep, field) || <span className="text-text-muted">Empty</span>} <span className="text-xs text-text-muted">(this account)</span></Radio>
                    <Radio value="duplicate">{display(data.duplicate, field)} <span className="text-xs text-text-muted">(duplicate)</span></Radio>
                  </RadioGroup>
                ))}
              </div>
            ) : <p className="text-sm text-text-secondary">The duplicate has no different values to choose from.</p>}
            <p className="text-sm text-text-secondary">
              {moves.length ? `Moves to this account: ${moves.map(([label, count]) => `${count} ${label}`).join(", ")}.` : "The duplicate has no related records to move."}
            </p>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="danger" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!data || data.blockers.length > 0}>Merge accounts</Button>
        </div>
      </div>
    </Dialog>
  );
}

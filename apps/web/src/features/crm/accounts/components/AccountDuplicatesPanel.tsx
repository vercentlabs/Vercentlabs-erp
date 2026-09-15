"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Button, Dialog, Select } from "@vercentlabs/design-system";
import { Merge } from "lucide-react";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import type { Account } from "../types";
import { AccountApiError, findAccountDuplicates, mergeAccounts, previewAccountMerge } from "../api/accounts-api";

// F002 Tranche E — findAccountDuplicates/previewAccountMergeForCaller/
// mergeAccountsGoverned (duplicate-matching.js, account-intelligence.js)
// were already real, already-tested backend services with zero frontend
// wiring before this pass. Unlike Lead's duplicate finder, this function
// has no restricted-match projection layer of its own (confirmed by
// reading its source) — every returned row is shown as-is, honestly
// reflecting what the API actually returns rather than inventing a
// redaction UI the backend doesn't implement.
export function AccountDuplicatesPanel({ account, canManage }: { account: Account; canManage: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [mergeCandidateId, setMergeCandidateId] = useState<string | null>(null);

  const duplicatesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "accounts", account.id, "duplicates"),
    queryFn: () => findAccountDuplicates({ displayName: account.displayName, legalName: account.legalName, gstin: account.gstin, pan: account.pan, excludeId: account.id }),
    enabled: account.status === "active",
  });

  const duplicates = duplicatesQuery.data?.duplicates ?? [];
  if (!duplicatesQuery.isLoading && duplicates.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-3">
      {duplicatesQuery.isLoading ? (
        <p className="text-sm text-text-secondary">Checking for possible duplicates…</p>
      ) : (
        <>
          <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
            <Merge className="size-4" aria-hidden="true" />
            Possible duplicate accounts found
          </p>
          <ul className="flex flex-col gap-2">
            {duplicates.map((match) => (
              <li key={match.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-secondary">
                <button type="button" className="text-left hover:underline" onClick={() => router.push(`/crm/accounts/${match.id}`)}>
                  {match.display_name} {match.gstin ? `· GSTIN ${match.gstin}` : ""} — score {match.match_score}
                </button>
                {canManage && (
                  <Button variant="secondary" size="compact" onPress={() => setMergeCandidateId(match.id)}>
                    Merge
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {mergeCandidateId && (
        <AccountMergeDialog
          sourceId={mergeCandidateId}
          survivorId={account.id}
          onClose={() => setMergeCandidateId(null)}
          onMerged={() => {
            setMergeCandidateId(null);
            queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "accounts") });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function AccountMergeDialog({ sourceId, survivorId, onClose, onMerged }: { sourceId: string; survivorId: string; onClose: () => void; onMerged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [fieldSelections, setFieldSelections] = useState<Record<string, "source" | "survivor">>({});

  const previewQuery = useQuery({
    queryKey: ["crm", "account-merge-preview", sourceId, survivorId],
    queryFn: () => previewAccountMerge(sourceId, survivorId),
  });

  const mergeMutation = useMutation({
    mutationFn: () => mergeAccounts(sourceId, survivorId, null, fieldSelections),
    onSuccess: onMerged,
    onError: (err: unknown) => setError(err instanceof AccountApiError ? err.message : "The merge could not be completed."),
  });

  const preview = previewQuery.data;

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Merge accounts">
      <div className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        {previewQuery.isLoading && <p className="text-sm text-text-secondary">Loading merge preview…</p>}
        {preview && (
          <>
            <p className="text-sm text-text-secondary">
              The source account will be archived; its related records move to the surviving account. This can&apos;t be undone.
            </p>
            {preview.impact.length > 0 && (
              <ul className="text-sm text-text-secondary">
                {preview.impact.map((row) => (
                  <li key={`${row.tableName}.${row.columnName}`}>
                    {row.count} row{row.count === 1 ? "" : "s"} in {row.tableName} will move to the surviving account.
                  </li>
                ))}
              </ul>
            )}
            {Object.keys(preview.fieldComparison).length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-text">Field selection (defaults to the surviving account&apos;s value)</p>
                {Object.entries(preview.fieldComparison).map(([field, { source, survivor }]) =>
                  String(source) === String(survivor) ? null : (
                    <Select
                      key={field}
                      label={field}
                      options={[
                        { value: "survivor", label: `Keep: ${String(survivor ?? "—")}` },
                        { value: "source", label: `Use instead: ${String(source ?? "—")}` },
                      ]}
                      selectedKey={fieldSelections[field] ?? "survivor"}
                      onSelectionChange={(key) => setFieldSelections((current) => ({ ...current, [field]: key === "source" ? "source" : "survivor" }))}
                    />
                  ),
                )}
              </div>
            )}
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="danger" onPress={() => mergeMutation.mutate()} isLoading={mergeMutation.isPending} isDisabled={!preview}>
            Merge accounts
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

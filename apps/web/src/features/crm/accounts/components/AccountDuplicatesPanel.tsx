"use client";

import { humanize } from "@/shared/format/human";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Button, Dialog, Select } from "@vercentlabs/design-system";
import { Merge } from "lucide-react";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import type { Account } from "../types";
import { AccountApiError, findAccountDuplicates, getAccount, mergeAccounts, previewAccountMerge } from "../api/accounts-api";
import { DuplicateComparison, type ComparisonField } from "@/features/crm/shared/ui/DuplicateComparison";

const ACCOUNT_FIELDS: ComparisonField[] = [
  { label: "Name", key: "displayName" }, { label: "Legal name", key: "legalName" }, { label: "GSTIN", key: "gstin" }, { label: "Email", key: "email" },
  { label: "Phone", key: "phone" }, { label: "Industry", key: "industry" }, { label: "City", key: "city" }, { label: "Created", key: "createdAt", format: "date" },
];

// F002 Tranche E — findAccountDuplicates/previewAccountMergeForCaller/
// mergeAccountsGoverned (duplicate-matching.js, account-intelligence.js)
// were already real, already-tested backend services with zero frontend
// wiring before this pass. Unlike Lead's duplicate finder, this function
// has no restricted-match projection layer of its own (confirmed by
// reading its source) — every returned row is shown as-is, honestly
// reflecting what the API actually returns rather than inventing a
// redaction UI the backend doesn't implement.
// Related records by kind, in words (one line per table, however many columns point at it).
const TABLE_LABELS: Record<string, [string, string]> = {
  crm_leads: ["lead", "leads"], crm_opportunities: ["deal", "deals"], crm_contacts: ["contact", "contacts"], crm_activities: ["activity", "activities"],
  crm_communications: ["message", "messages"], crm_notes: ["note", "notes"], crm_conversion_records: ["conversion record", "conversion records"],
  crm_contact_account_relationships: ["account link", "account links"], crm_opportunity_contact_roles: ["deal role", "deal roles"], crm_account_plans: ["account plan", "account plans"],
};
function mergeImpact(impact: Array<{ tableName: string; count: number }>) {
  const totals = new Map<string, number>();
  for (const row of impact) totals.set(row.tableName, (totals.get(row.tableName) ?? 0) + Number(row.count));
  return [...totals.entries()].filter(([, count]) => count > 0).map(([table, count]) => {
    const [one, many] = TABLE_LABELS[table] ?? [humanize(table.replace(/^crm_/, "")).toLowerCase(), humanize(table.replace(/^crm_/, "")).toLowerCase()];
    return { label: count === 1 ? one : many, count };
  });
}

// Scores are internal weights; people read the strength.
function matchStrength(score: number | string | null | undefined) {
  const value = Number(score ?? 0);
  return value >= 100 ? "very likely the same" : value >= 60 ? "likely the same" : "possibly the same";
}

export function AccountDuplicatesPanel({ account, canManage }: { account: Account; canManage: boolean }) {
  const [comparingId, setComparingId] = useState<string | null>(null);
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
                  {match.display_name} {match.gstin ? `· GSTIN ${match.gstin}` : ""} — {matchStrength(match.match_score)}
                </button>
                <Button variant="ghost" size="compact" onPress={() => setComparingId(comparingId === match.id ? null : match.id)}>
                  {comparingId === match.id ? "Hide comparison" : "Compare side by side"}
                </Button>
                {canManage && (
                  <Button variant="secondary" size="compact" onPress={() => setMergeCandidateId(match.id)}>
                    Merge
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {comparingId && (
            <div className="rounded-[var(--radius-control)] border border-border bg-surface p-3">
              <DuplicateComparison entity="accounts" current={account as unknown as Record<string, unknown>} candidateId={comparingId} fields={ACCOUNT_FIELDS} loadCandidate={getAccount} currentTitle="This account" candidateTitle="Possible duplicate" />
            </div>
          )}
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
  const workspace = useWorkspaceContext();
  const [error, setError] = useState<string | null>(null);
  const [fieldSelections, setFieldSelections] = useState<Record<string, "source" | "survivor">>({});

  const previewQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "account-merge-preview", sourceId, survivorId),
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
            {mergeImpact(preview.impact).length > 0 && (
              <ul className="text-sm text-text-secondary">
                {mergeImpact(preview.impact).map((row) => (
                  <li key={row.label}>{`${row.count} ${row.label} will move to the surviving account.`}</li>
                ))}
              </ul>
            )}
            {(() => {
              const differing = Object.entries(preview.fieldComparison).filter(([, { source, survivor }]) => String(source ?? "") !== String(survivor ?? ""));
              if (differing.length === 0) return <p className="text-sm text-text-secondary">Both records hold the same details, so nothing needs choosing.</p>;
              return (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-text">Where they differ, choose what to keep (the surviving account&apos;s value by default)</p>
                  {differing.map(([field, { source, survivor }]) => (
                    <Select
                      key={field}
                      label={humanize(field)}
                      options={[
                        { value: "survivor", label: `Keep: ${String(survivor ?? "—")}` },
                        { value: "source", label: `Use instead: ${String(source ?? "—")}` },
                      ]}
                      selectedKey={fieldSelections[field] ?? "survivor"}
                      onSelectionChange={(key) => setFieldSelections((current) => ({ ...current, [field]: key === "source" ? "source" : "survivor" }))}
                    />
                  ))}
                </div>
              );
            })()}
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

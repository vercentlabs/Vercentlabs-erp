"use client";

// Existing accounts that look like this one, with the option to merge a
// duplicate into it through the side-by-side merge dialog.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { checkAccountDuplicates, type Account } from "../api/accounts-api";
import { AccountDuplicateWarning } from "./AccountDuplicateWarning";
import { MergeAccountsDialog } from "./MergeAccountsDialog";

export function AccountDuplicatesPanel({ account, canMerge, hideWhenEmpty = false, onMerged }: {
  account: Account;
  canMerge: boolean;
  hideWhenEmpty?: boolean;
  onMerged?: () => void;
}) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [mergingId, setMergingId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "account", account.id, "duplicates"),
    queryFn: () => checkAccountDuplicates({
      displayName: account.displayName, legalName: account.legalName, website: account.website, email: account.email, phone: account.phone,
      city: account.city, excludeId: account.id,
    }),
    enabled: account.status !== "archived",
  });

  const matches = query.data?.matches ?? [];
  if (matches.length === 0) {
    if (hideWhenEmpty || query.isLoading) return null;
    return <p className="text-sm text-text-secondary">No similar accounts were found for {account.displayName}.</p>;
  }
  const mergeable = matches.filter((match) => match.canOpen && match.status !== "archived");

  return (
    <section className="flex flex-col gap-3">
      <AccountDuplicateWarning matches={matches} blocking={query.data?.hasBlockingMatch ?? false}>
        {canMerge && mergeable.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {mergeable.map((match) => (
              <Button key={match.id} variant="outline" size="compact" onPress={() => setMergingId(match.id)}>
                Merge {match.name ?? match.code} into this account
              </Button>
            ))}
          </div>
        )}
      </AccountDuplicateWarning>
      {mergingId && (
        <MergeAccountsDialog keep={account} isOpen initialDuplicateId={mergingId} onOpenChange={(open) => !open && setMergingId(null)}
          onMerged={() => {
            void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "account", account.id) });
            void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "accounts") });
            onMerged?.();
          }} />
      )}
    </section>
  );
}

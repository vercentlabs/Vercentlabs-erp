"use client";

// Existing leads and contacts that look like this lead, with the option to
// merge a duplicate lead into it. Merging moves the duplicate's activities,
// notes, files and tags here and archives the duplicate as "Duplicate".
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, Button } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { checkLeadDuplicates, errorMessage, mergeLead, type Lead, type LeadDuplicateMatch } from "../api/leads-api";
import { ErrorBanner, leadName } from "../lead-format";
import { DuplicateWarning } from "./DuplicateWarning";

export function LeadDuplicatesPanel({ lead, canResolve, hideWhenEmpty = false, onMerged }: {
  lead: Lead;
  canResolve: boolean;
  hideWhenEmpty?: boolean;
  onMerged?: () => void;
}) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [merging, setMerging] = useState<LeadDuplicateMatch | null>(null);
  const [error, setError] = useState<string | null>(null);

  const key = scopedQueryKey(workspace, "crm", "lead", lead.id, "duplicates");
  const query = useQuery({
    queryKey: key,
    queryFn: () => checkLeadDuplicates({
      firstName: lead.firstName, lastName: lead.lastName, companyName: lead.companyName, email: lead.email, mobile: lead.mobile, phone: lead.phone,
      excludeLeadId: lead.id,
    }),
    enabled: !lead.archivedAt && lead.status !== "converted",
  });
  const merge = useMutation({
    mutationFn: (duplicate: LeadDuplicateMatch) => mergeLead(duplicate.id, lead.id),
    onSuccess: () => {
      setMerging(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead", lead.id) });
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads") });
      onMerged?.();
    },
    onError: (failure) => { setMerging(null); setError(errorMessage(failure)); },
  });

  const matches = query.data?.matches ?? [];
  if (matches.length === 0) {
    if (hideWhenEmpty || query.isLoading) return null;
    return <p className="text-sm text-text-secondary">No similar leads or contacts were found for {leadName(lead)}.</p>;
  }
  const mergeable = matches.filter((match) => match.kind === "lead" && match.canOpen && match.status !== "converted");

  return (
    <section className="flex flex-col gap-3">
      <ErrorBanner message={error} />
      <DuplicateWarning matches={matches} blocking={query.data?.hasBlockingMatch ?? false}>
        {canResolve && mergeable.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {mergeable.map((match) => (
              <Button key={match.id} variant="outline" size="compact" onPress={() => setMerging(match)}>
                Merge {match.code} into this lead
              </Button>
            ))}
          </div>
        )}
      </DuplicateWarning>
      <AlertDialog
        isOpen={Boolean(merging)}
        onOpenChange={(open) => !open && setMerging(null)}
        title={`Merge ${merging?.code ?? ""} into ${lead.code}?`}
        description={`Activities, notes, files and tags from ${merging?.name ?? merging?.code ?? "the duplicate"} move to ${leadName(lead)}, and its details fill any blanks here. The duplicate is archived as "Duplicate" and keeps its history.`}
        confirmLabel="Merge leads"
        isConfirming={merge.isPending}
        onConfirm={() => merging && merge.mutate(merging)}
      />
    </section>
  );
}

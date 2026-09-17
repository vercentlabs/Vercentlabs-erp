"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@vercentlabs/design-system";
import { Merge } from "lucide-react";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import type { Lead } from "../types";
import { dismissLeadDuplicate, findLeadDuplicates, mergeLead } from "../api/leads-api";

// F008 Tranche G — a standalone-workspace variant of the same duplicate
// check/dismiss/merge already embedded in LeadDetailScreen.tsx. Built as
// its own self-contained component rather than extracting LeadDetailScreen's
// inline block, to avoid refactoring an already-shipped, untested-by-
// automation screen under this tranche's time budget — the two share the
// same backend calls (findLeadDuplicates/dismissLeadDuplicate/mergeLead),
// just not the same JSX, so there is no behavioral drift risk.
export function LeadDuplicatesWorkspacePanel({ lead, canManage }: { lead: Lead; canManage: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const duplicatesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", lead.id, "duplicates"),
    queryFn: () =>
      findLeadDuplicates(
        { firstName: lead.firstName, lastName: lead.lastName, email: lead.email, mobile: lead.mobile, phone: lead.phone, companyName: lead.companyName },
        lead.id,
      ),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads", lead.id, "duplicates") });
  }

  const dismissMutation = useMutation({
    mutationFn: (matchedLeadId: string) => dismissLeadDuplicate(lead.id, matchedLeadId, "Reviewed and confirmed not the same Lead."),
    onSuccess: invalidate,
    onError: (err: unknown) => setActionError(err instanceof Error ? err.message : "The dismissal could not be recorded."),
  });
  const mergeMutation = useMutation({
    mutationFn: (sourceId: string) => mergeLead(lead.id, sourceId),
    onSuccess: invalidate,
    onError: (err: unknown) => setActionError(err instanceof Error ? err.message : "The merge could not be completed."),
  });

  const duplicates = duplicatesQuery.data?.duplicates ?? [];

  return (
    <div className="flex flex-col gap-3">
      {actionError && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      )}
      {duplicatesQuery.isLoading && <p className="text-sm text-text-secondary">Checking for possible duplicates…</p>}
      {!duplicatesQuery.isLoading && duplicates.length === 0 && <p className="text-sm text-text-muted">No possible duplicates found for this Lead.</p>}
      {duplicates.length > 0 && (
        <ul className="flex flex-col gap-2">
          {duplicates.map((match, i) =>
            match.restricted ? (
              <li key={i} className="text-sm text-text-secondary">A possible match exists that you don&apos;t have visibility into.</li>
            ) : (
              <li key={match.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm text-text-secondary">
                <span className="flex items-center gap-1.5">
                  <Merge className="size-4 text-warning" aria-hidden="true" />
                  {match.fullName} {match.companyName ? `· ${match.companyName}` : ""} — {match.classification} match
                </span>
                {canManage && (
                  <span className="flex items-center gap-2">
                    <Button variant="ghost" size="compact" onPress={() => dismissMutation.mutate(match.id)} isLoading={dismissMutation.isPending} isDisabled={match.classification === "exact"}>
                      Dismiss
                    </Button>
                    <Button variant="secondary" size="compact" onPress={() => mergeMutation.mutate(match.id)} isLoading={mergeMutation.isPending}>
                      Merge into this Lead
                    </Button>
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

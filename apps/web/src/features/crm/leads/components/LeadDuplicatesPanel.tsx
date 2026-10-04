"use client";

// Existing leads, contacts and accounts that look like this lead, with the
// way to resolve them: merge a duplicate lead into this one, choosing field
// by field which value survives. A duplicate that is merged is archived and
// points here; it is never deleted.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, Radio, RadioGroup } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { checkLeadDuplicates, errorMessage, getLead, mergeLead, type Lead, type LeadDuplicateMatch } from "../api/leads-api";
import { ErrorBanner, leadName } from "../lead-format";
import { DuplicateWarning } from "./DuplicateWarning";

// The fields a merge can take from the duplicate.
const MERGE_FIELDS: Array<{ field: keyof Lead; label: string }> = [
  { field: "firstName", label: "First name" },
  { field: "lastName", label: "Last name" },
  { field: "companyName", label: "Company" },
  { field: "jobTitle", label: "Job title" },
  { field: "email", label: "Email" },
  { field: "mobile", label: "Mobile" },
  { field: "phone", label: "Phone" },
  { field: "website", label: "Website" },
  { field: "city", label: "City" },
  { field: "state", label: "State" },
  { field: "industry", label: "Industry" },
  { field: "productInterest", label: "Product / service interest" },
  { field: "sourceDetail", label: "Source detail" },
  { field: "description", label: "Description" },
];
const shown = (value: unknown) => (value === null || value === undefined || value === "" ? "" : String(value));

export function LeadDuplicatesPanel({ lead, canResolve, hideWhenEmpty = false, onMerged }: {
  lead: Lead;
  canResolve: boolean;
  hideWhenEmpty?: boolean;
  onMerged?: () => void;
}) {
  const workspace = useWorkspaceContext();
  const [merging, setMerging] = useState<LeadDuplicateMatch | null>(null);

  const key = scopedQueryKey(workspace, "crm", "lead", lead.id, "duplicates");
  const query = useQuery({
    queryKey: key,
    queryFn: () => checkLeadDuplicates({
      firstName: lead.firstName, lastName: lead.lastName, companyName: lead.companyName, email: lead.email, mobile: lead.mobile, phone: lead.phone,
      website: lead.website, excludeLeadId: lead.id,
    }),
    enabled: !lead.archivedAt && lead.status !== "converted",
  });

  const matches = query.data?.matches ?? [];
  if (matches.length === 0) {
    if (hideWhenEmpty || query.isLoading) return null;
    return <p className="text-sm text-text-secondary">No similar leads, contacts or accounts were found for {leadName(lead)}.</p>;
  }
  const mergeable = matches.filter((match) => match.kind === "lead" && match.canOpen && match.status !== "converted" && !match.isArchived);

  return (
    <section className="flex flex-col gap-3">
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
      {merging && <MergeLeadsDialog keep={lead} duplicateId={merging.id} onClose={() => setMerging(null)} onMerged={onMerged} />}
    </section>
  );
}

// Primary and duplicate side by side; for every field where they differ the
// user picks the value that survives.
function MergeLeadsDialog({ keep, duplicateId, onClose, onMerged }: { keep: Lead; duplicateId: string; onClose: () => void; onMerged?: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const duplicateQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead", duplicateId), queryFn: () => getLead(duplicateId) });
  const duplicate = duplicateQuery.data;
  const [choices, setChoices] = useState<Record<string, "keep" | "duplicate">>({});
  const [error, setError] = useState<string | null>(null);

  const merge = useMutation({
    mutationFn: () => mergeLead(duplicateId, keep.id, choices),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead", keep.id) });
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads") });
      onMerged?.();
      onClose();
    },
    onError: (failure) => setError(errorMessage(failure)),
  });
  // Only fields where the duplicate has a value that differs are a decision.
  const differing = duplicate ? MERGE_FIELDS.filter(({ field }) => shown(duplicate[field]) && shown(duplicate[field]) !== shown(keep[field])) : [];

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Merge leads" size="lg"
      description={`${keep.code} is kept. Activities, notes, files and tags from the duplicate move to it; the duplicate is archived as "Duplicate" and keeps its own history.`}>
      {duplicateQuery.isLoading || !duplicate ? (
        duplicateQuery.isError ? <ErrorBanner message={errorMessage(duplicateQuery.error)} /> : <LoadingState label="Loading the duplicate" rows={4} />
      ) : (
        <div className="flex flex-col gap-4">
          <ErrorBanner message={error} />
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-text-secondary">Primary (kept)</p><p className="font-medium">{leadName(keep)} · {keep.code}</p></div>
            <div><p className="text-text-secondary">Duplicate (merged)</p><p className="font-medium">{leadName(duplicate)} · {duplicate.code}</p></div>
          </div>
          {differing.length === 0 ? (
            <p className="text-sm text-text-secondary">The two leads have the same details. Nothing to choose.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {differing.map(({ field, label }) => {
                const keepValue = shown(keep[field]);
                // A blank on the primary is filled from the duplicate unless the user says otherwise.
                const selected = choices[field] ?? (keepValue ? "keep" : "duplicate");
                return (
                  <RadioGroup key={field} label={label} orientation="horizontal" value={selected}
                    onChange={(value) => setChoices({ ...choices, [field]: value as "keep" | "duplicate" })}>
                    <Radio value="keep">{keepValue || "Leave empty"}</Radio>
                    <Radio value="duplicate">{shown(duplicate[field])}</Radio>
                  </RadioGroup>
                );
              })}
            </div>
          )}
          <p className="text-sm text-text-secondary">Merging cannot be undone.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={onClose}>Cancel</Button>
            <Button variant="primary" onPress={() => merge.mutate()} isLoading={merge.isPending}>Merge into {keep.code}</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

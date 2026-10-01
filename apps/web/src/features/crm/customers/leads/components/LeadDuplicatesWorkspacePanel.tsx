"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, TextArea } from "@vercentlabs/design-system";
import { Merge } from "lucide-react";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import type { Lead } from "../types";
import {
  dismissLeadDuplicate,
  findLeadDuplicates,
  getLead,
  mergeLead,
  type LeadDuplicateMatch,
} from "../api/leads-api";
import {
  DuplicateComparison,
  type ComparisonField,
} from "@/features/crm/shared/ui/DuplicateComparison";

const LEAD_FIELDS: ComparisonField[] = [
  { label: "Name", key: "fullName" },
  { label: "Company", key: "companyName" },
  { label: "Email", key: "email" },
  { label: "Mobile", key: "mobile" },
  { label: "Phone", key: "phone" },
  { label: "Job title", key: "jobTitle" },
  { label: "City", key: "city" },
  { label: "Owner", key: "ownerName" },
  { label: "Created", key: "createdAt", format: "date" },
];

const REASON_MIN = 10;

type VisibleMatch = Exclude<LeadDuplicateMatch, { restricted: true }>;

// The one Lead duplicate review (Lead 360 and the duplicates workspace):
// possible duplicates with why they matched, a side-by-side comparison, and —
// for people who resolve duplicates (crm.data-quality.manage, as the server
// requires) — a reasoned dismissal or a confirmed merge into this Lead.
export function LeadDuplicatesWorkspacePanel({
  lead,
  canResolve,
  hideWhenEmpty = false,
  onMerged,
}: {
  lead: Lead;
  canResolve: boolean;
  hideWhenEmpty?: boolean;
  onMerged?: () => void;
}) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [comparingId, setComparingId] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<VisibleMatch | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [merging, setMerging] = useState<VisibleMatch | null>(null);
  const closed =
    lead.recordStatus === "converted" || lead.recordStatus === "archived";
  const duplicatesKey = scopedQueryKey(
    workspace,
    "crm",
    "leads",
    lead.id,
    "duplicates",
  );

  const duplicatesQuery = useQuery({
    queryKey: duplicatesKey,
    queryFn: () =>
      findLeadDuplicates(
        {
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
          mobile: lead.mobile,
          phone: lead.phone,
          companyName: lead.companyName,
        },
        lead.id,
      ),
    enabled: !closed,
  });

  const dismissMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      dismissLeadDuplicate(lead.id, id, reason),
    onSuccess: () => {
      setActionError(null);
      setDismissing(null);
      setDismissReason("");
      queryClient.invalidateQueries({ queryKey: duplicatesKey });
    },
    onError: (err: unknown) =>
      setActionError(
        err instanceof Error
          ? err.message
          : "The dismissal could not be recorded.",
      ),
  });
  const mergeMutation = useMutation({
    mutationFn: (sourceId: string) => mergeLead(lead.id, sourceId),
    onSuccess: () => {
      setActionError(null);
      setMerging(null);
      queryClient.invalidateQueries({ queryKey: duplicatesKey });
      queryClient.invalidateQueries({
        queryKey: scopedQueryKey(workspace, "crm", "leads"),
      });
      onMerged?.();
    },
    onError: (err: unknown) =>
      setActionError(
        err instanceof Error
          ? err.message
          : "The merge could not be completed.",
      ),
  });

  // Review is for Leads that can still be merged or dismissed: a converted
  // Lead, or one already merged away (archived), is not offered again.
  const duplicates = (duplicatesQuery.data?.duplicates ?? []).filter(
    (match) =>
      match.restricted ||
      (match.recordStatus !== "converted" && match.recordStatus !== "archived"),
  );
  if (
    closed ||
    (hideWhenEmpty &&
      !duplicatesQuery.isLoading &&
      duplicates.length === 0 &&
      !actionError)
  )
    return null;

  return (
    <section aria-label="Possible duplicates" className="flex flex-col gap-3">
      {actionError && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {actionError}
        </p>
      )}
      {duplicatesQuery.isLoading ? (
        !hideWhenEmpty && (
          <p className="text-sm text-text-secondary">
            Checking for possible duplicates…
          </p>
        )
      ) : duplicates.length === 0 ? (
        <p className="text-sm text-text-muted">
          No possible duplicates found for this lead.
        </p>
      ) : (
        <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
            <Merge className="size-4" aria-hidden="true" />
            Possible duplicates found
          </p>
          <ul className="flex flex-col gap-2">
            {duplicates.map((match, index) =>
              match.restricted ? (
                <li
                  key={`restricted-${index}`}
                  className="text-sm text-text-secondary"
                >
                  A possible match exists that you can&apos;t open.
                </li>
              ) : (
                <li
                  key={match.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-secondary"
                >
                  <span>
                    <span className="font-medium text-text">
                      {match.fullName}
                    </span>
                    {match.companyName ? ` · ${match.companyName}` : ""}
                    {` — ${match.classification === "exact" ? "exact match" : "possible match"}`}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="ghost"
                      size="compact"
                      onPress={() =>
                        setComparingId(
                          comparingId === match.id ? null : match.id,
                        )
                      }
                    >
                      {comparingId === match.id
                        ? "Hide comparison"
                        : "Compare side by side"}
                    </Button>
                    {canResolve && (
                      <>
                        {match.classification !== "exact" && (
                          <Button
                            variant="ghost"
                            size="compact"
                            onPress={() => setDismissing(match)}
                          >
                            Not a duplicate
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          size="compact"
                          onPress={() => setMerging(match)}
                        >
                          Merge into this lead
                        </Button>
                      </>
                    )}
                  </span>
                </li>
              ),
            )}
          </ul>
          {comparingId && (
            <div className="rounded-[var(--radius-control)] border border-border bg-surface p-3">
              <DuplicateComparison
                entity="leads"
                current={
                  {
                    ...lead,
                    fullName: [lead.firstName, lead.lastName]
                      .filter(Boolean)
                      .join(" "),
                  } as unknown as Record<string, unknown>
                }
                candidateId={comparingId}
                fields={LEAD_FIELDS}
                loadCandidate={getLead}
                currentTitle="This lead"
                candidateTitle="Possible duplicate"
              />
            </div>
          )}
        </div>
      )}

      <Dialog
        isOpen={dismissing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDismissing(null);
            setDismissReason("");
          }
        }}
        title="Not a duplicate"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">
            {`${dismissing?.fullName ?? "This lead"} will stop being suggested as a duplicate of this lead. Your reason is kept with the decision.`}
          </p>
          <TextArea
            label="Why are these different people?"
            description={`At least ${REASON_MIN} characters.`}
            value={dismissReason}
            onChange={setDismissReason}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={() => setDismissing(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onPress={() =>
                dismissing &&
                dismissMutation.mutate({
                  id: dismissing.id,
                  reason: dismissReason.trim(),
                })
              }
              isLoading={dismissMutation.isPending}
              isDisabled={dismissReason.trim().length < REASON_MIN}
            >
              Record decision
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        isOpen={merging !== null}
        onOpenChange={(open) => !open && setMerging(null)}
        title="Merge leads"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">
            {`${merging?.fullName ?? "The other lead"} will be archived. Its activities, messages, tags and campaign memberships move to this lead, and the merge is recorded. This can't be undone.`}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={() => setMerging(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onPress={() => merging && mergeMutation.mutate(merging.id)}
              isLoading={mergeMutation.isPending}
            >
              Merge leads
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}

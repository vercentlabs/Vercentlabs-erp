"use client";

// On a closed opportunity: what happened (won or lost), why, where it ended
// (its final stage), who closed it and when; and the earlier closes kept
// through reopens. Close notes are internal and are never put on a customer
// document.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, StatusBadge } from "@vercentlabs/design-system";

import type { Opportunity } from "@/features/crm/opportunities/api/opportunities-api";
import { formatDate, formatDateTime, formatMoney } from "@/shared/format/human";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { listOpportunityCloseHistory } from "../api/close-reasons-api";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex min-w-0 flex-col"><dt className="text-text-secondary">{label}</dt><dd className="break-words font-medium">{children}</dd></div>;
}

export function CloseSummaryPanel({ opportunity, canCorrect, onCorrect }: { opportunity: Opportunity; canCorrect: boolean; onCorrect: () => void }) {
  const workspace = useWorkspaceContext();
  const history = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunity", opportunity.id, "close-history", opportunity.updatedAt),
    queryFn: () => listOpportunityCloseHistory(opportunity.id),
  });
  const closed = opportunity.status === "won" || opportunity.status === "lost";
  const earlier = (history.data ?? []).filter((entry) => entry.reopenedAt);
  if (!closed && earlier.length === 0) return null;
  const currency = opportunity.currencyCode ?? undefined;
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface-muted p-4" aria-label="Outcome">
      {closed && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <StatusBadge tone={opportunity.status === "won" ? "success" : "danger"}>{opportunity.status === "won" ? "Won" : "Lost"}</StatusBadge>
              {opportunity.closeReasonName ?? "No reason recorded"}
            </h2>
            {canCorrect && <Button variant="secondary" size="compact" onPress={onCorrect}>Correct reason</Button>}
          </div>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Final stage">{opportunity.stageName}</Fact>
            <Fact label="Actual close date">{opportunity.actualCloseDate ? formatDate(opportunity.actualCloseDate) : "—"}</Fact>
            {opportunity.status === "won"
              ? <Fact label="Final value">{formatMoney(currency, opportunity.wonAmount ?? opportunity.amount)} <span className="font-normal text-text-secondary">(estimated {formatMoney(currency, opportunity.amount)})</span></Fact>
              : <Fact label="Value lost">{formatMoney(currency, opportunity.amount)}</Fact>}
            <Fact label="Closed by">{opportunity.closedByName ?? "—"}{opportunity.closedAt ? <span className="font-normal text-text-secondary"> · {formatDateTime(opportunity.closedAt)}</span> : null}</Fact>
            {opportunity.competitorName && <Fact label="Competitor">{opportunity.competitorName}</Fact>}
            {opportunity.duplicateOfOpportunityId && (
              <Fact label="Duplicate of"><Link className="text-brand hover:underline" href={`/crm/opportunities/${opportunity.duplicateOfOpportunityId}`}>{opportunity.duplicateOfCode} {opportunity.duplicateOfName}</Link></Fact>
            )}
          </dl>
          {opportunity.closeNotes && (
            <div className="text-sm">
              <p className="text-text-secondary">Close notes (internal)</p>
              <p className="whitespace-pre-wrap">{opportunity.closeNotes}</p>
            </div>
          )}
        </>
      )}
      {earlier.length > 0 && (
        <div className="flex flex-col gap-1 text-sm">
          <h3 className="font-semibold">{closed ? "Earlier outcomes" : "Previous outcomes"}</h3>
          <ul className="flex flex-col gap-1">
            {earlier.map((entry) => (
              <li key={entry.id} className="text-text-secondary">
                <span className="font-medium text-text">{formatDate(entry.actualCloseDate)} · {entry.outcome === "won" ? "Won" : "Lost"} — {entry.reasonName ?? "No reason"}</span>
                {entry.competitorName ? ` · Competitor: ${entry.competitorName}` : ""}{entry.finalStageName ? ` · in ${entry.finalStageName}` : ""}{entry.notes ? ` · ${entry.notes}` : ""}
                <br />
                Reopened {entry.reopenedAt ? formatDate(entry.reopenedAt) : ""}{entry.reopenedByName ? ` by ${entry.reopenedByName}` : ""}{entry.reopenReason ? `: ${entry.reopenReason}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

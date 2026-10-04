"use client";

// The open deals as columns, one per sales stage. Dragging a card to another
// column moves the deal to that stage, forwards or backwards. Won and lost
// are outcomes, not columns: a deal is closed from its own page.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorState } from "@vercentlabs/design-system";

import { formatDate, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { changeOpportunityStage, errorMessage, listOpportunities, type Opportunity, type OpportunityListFilters, type OpportunityOptions } from "../api/opportunities-api";
import { LIVE_OPPORTUNITY_QUERY } from "../live-query";
import { ErrorBanner, OpportunityFlags, days } from "../opportunity-format";

const BOARD_LIMIT = 300;

export function OpportunityBoard({ filters, options }: { filters: OpportunityListFilters; options: OpportunityOptions }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [dragged, setDragged] = useState<Opportunity | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only open deals sit in a stage column.
  const boardFilters: OpportunityListFilters = { ...filters, status: "open", sortBy: "amount", sortDirection: "desc" };
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunities", "board", boardFilters),
    queryFn: () => listOpportunities({ ...boardFilters, limit: BOARD_LIMIT }),
    ...LIVE_OPPORTUNITY_QUERY,
  });
  const move = useMutation({
    mutationFn: ({ opportunity, stageId }: { opportunity: Opportunity; stageId: string }) =>
      changeOpportunityStage(opportunity.id, { stageId, expectedUpdatedAt: opportunity.updatedAt }),
    onSuccess: () => setError(null),
    onError: (failure) => setError(errorMessage(failure)),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunities") }),
  });
  const canMove = options.capabilities.changeStage;
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;

  if (query.isLoading) return <LoadingState label="Loading pipeline" rows={6} />;
  if (query.isError) return <ErrorState title="Could not load the pipeline" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;

  const drop = (stageId: string) => {
    setOver(null);
    if (dragged && dragged.stageId !== stageId) move.mutate({ opportunity: dragged, stageId });
    setDragged(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <ErrorBanner message={error} />
      {total > rows.length && <p className="text-sm text-text-secondary">Showing the {rows.length} largest of {total} open opportunities. Use the filters or the list to see the rest.</p>}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {options.stages.map((stage) => {
          const cards = rows.filter((row) => row.stageId === stage.id);
          const value = cards.reduce((sum, row) => sum + row.amount, 0);
          return (
            <section key={stage.id} aria-label={stage.name}
              className={`flex w-72 shrink-0 flex-col gap-2 rounded-[var(--radius-card)] border p-2 ${over === stage.id ? "border-brand bg-brand-soft" : "border-border bg-surface-muted"}`}
              onDragOver={canMove ? (event) => { event.preventDefault(); setOver(stage.id); } : undefined}
              onDragLeave={() => setOver((current) => (current === stage.id ? null : current))}
              onDrop={canMove ? () => drop(stage.id) : undefined}>
              <header className="flex flex-col px-1">
                <span className="flex items-center justify-between text-sm font-semibold">{stage.name}<span className="font-normal text-text-secondary">{stage.probability}%</span></span>
                <span className="text-xs text-text-secondary">{cards.length} · {formatMoney(options.baseCurrency, value)}</span>
              </header>
              {cards.length === 0 && <p className="px-1 py-4 text-center text-xs text-text-muted">No opportunities</p>}
              {cards.map((card) => (
                <article key={card.id} draggable={canMove} onDragStart={() => setDragged(card)} onDragEnd={() => { setDragged(null); setOver(null); }}
                  className={`flex flex-col gap-1 rounded-[var(--radius-control)] border border-border bg-surface p-2.5 text-sm shadow-sm ${canMove ? "cursor-grab" : ""} ${dragged?.id === card.id ? "opacity-50" : ""}`}>
                  <Link href={`/crm/opportunities/${card.id}`} className="font-medium text-text underline-offset-2 hover:underline">{card.name}</Link>
                  <span className="text-xs text-text-secondary">{card.accountName ?? "No account"}</span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium tabular-nums">{formatMoney(card.currencyCode ?? options.baseCurrency, card.amount)}</span>
                    <span className="text-xs text-text-muted">{card.probability}%</span>
                  </span>
                  <span className="text-xs text-text-muted">
                    {card.ownerName ?? "Unassigned"}{card.expectedCloseDate ? ` · closes ${formatDate(card.expectedCloseDate)}` : ""} · {days(card.stageAgeDays)} in stage
                  </span>
                  <span className="flex flex-wrap gap-1"><OpportunityFlags opportunity={card} /></span>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

"use client";

// The board: one column per sales stage, one card per deal. Dropping a card on another column, choosing Move to on its menu, or pressing
// ← / → on a focused card all change the deal's stage through the same operation (so the stage checks and the "are you sure?" warning
// behave the same); the card moves at once and returns if the server refuses. Each column header is one line: name, count and value, with
// the probability, weighted value and average time in a tooltip.
// Won and lost are outcomes, not columns: a deal is closed with Mark won or
// Mark lost from its card.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";

import { changeOpportunityStage, stageWarningOf, type Opportunity, type OpportunityOptions } from "@/features/crm/opportunities/api/opportunities-api";
import { StageWarningDialog } from "@/features/crm/sales-stages/components/StageChange";
import { days } from "@/features/crm/opportunities/opportunity-format";
import { formatMoney } from "@/shared/format/human";

import { errorMessage, type Pipeline, type PipelineStage } from "../api/pipeline-api";
import { PipelineCard, type CardAction } from "./PipelineCard";

// The pipeline as it will look once the card has moved: counts and values follow the card.
function withCardMoved(pipeline: Pipeline, card: Opportunity, target: PipelineStage): Pipeline {
  const probability = card.probabilityOverridden ? card.probability : target.probability;
  const moved: Opportunity = { ...card, stageId: target.id, stageName: target.name, probability, weightedValue: Math.round(card.amount * probability) / 100, stageAgeDays: 0 };
  const stages = pipeline.stages.map((stage) => {
    if (stage.id === card.stageId)
      return { ...stage, cards: stage.cards.filter((entry) => entry.id !== card.id), count: stage.count - 1, value: stage.value - card.amount, weightedValue: stage.weightedValue - card.weightedValue };
    if (stage.id === target.id)
      return { ...stage, cards: [moved, ...stage.cards], count: stage.count + 1, value: stage.value + card.amount, weightedValue: stage.weightedValue + moved.weightedValue };
    return stage;
  });
  return { ...pipeline, stages, weightedValue: stages.reduce((sum, stage) => sum + stage.weightedValue, 0) };
}

export function PipelineBoard({ pipeline, pipelineKey, options, stageListHref, onChanged, onError, onAction }: {
  pipeline: Pipeline; pipelineKey: QueryKey; options: OpportunityOptions; stageListHref: (stageId: string) => string;
  onChanged: () => void; onError: (message: string | null) => void; onAction: (action: CardAction, card: Opportunity) => void;
}) {
  const queryClient = useQueryClient();
  const [dragged, setDragged] = useState<Opportunity | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // A move the server wants confirmed first: the card is back in its column until the user continues.
  const [confirming, setConfirming] = useState<{ card: Opportunity; stage: PipelineStage; warnings: string[]; stageName: string } | null>(null);
  const can = options.capabilities;
  const canMove = can.changeStage && pipeline.status === "open";
  const currency = options.baseCurrency;

  const move = useMutation({
    mutationFn: ({ card, stage, confirmed }: { card: Opportunity; stage: PipelineStage; confirmed?: boolean }) =>
      changeOpportunityStage(card.id, { stageId: stage.id, expectedUpdatedAt: card.updatedAt, warn: !confirmed }),
    onMutate: async ({ card, stage }) => {
      onError(null);
      await queryClient.cancelQueries({ queryKey: pipelineKey });
      const previous = queryClient.getQueryData<Pipeline>(pipelineKey);
      if (previous) queryClient.setQueryData<Pipeline>(pipelineKey, withCardMoved(previous, card, stage));
      return { previous };
    },
    // Refused (no permission, a stage requirement, changed by someone else): the card goes back.
    onError: (failure, attempted, context) => {
      if (context?.previous) queryClient.setQueryData(pipelineKey, context.previous);
      const warning = stageWarningOf(failure);
      if (warning && !attempted.confirmed) setConfirming({ card: attempted.card, stage: attempted.stage, ...warning });
      else onError(errorMessage(failure));
    },
    onSettled: onChanged,
  });

  const activeStages = pipeline.stages.filter((stage) => !stage.isInactive);
  const moveTo = (card: Opportunity, stageId: string) => {
    const stage = activeStages.find((entry) => entry.id === stageId);
    if (stage && stage.id !== card.stageId) move.mutate({ card, stage });
  };
  const step = (card: Opportunity, direction: -1 | 1) => {
    const index = activeStages.findIndex((entry) => entry.id === card.stageId);
    const target = index < 0 ? undefined : activeStages[index + direction];
    if (!target) return;
    move.mutate({ card, stage: target });
    // The card is drawn again in its new column; keep the keyboard on it.
    window.setTimeout(() => document.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`)?.focus(), 60);
  };
  const drop = (stage: PipelineStage) => {
    setOver(null);
    if (dragged && dragged.stageId !== stage.id && !stage.isInactive) move.mutate({ card: dragged, stage });
    setDragged(null);
  };

  return (
    <>
    <StageWarningDialog warning={confirming} isConfirming={move.isPending} onCancel={() => setConfirming(null)}
      onConfirm={() => { if (confirming) move.mutate({ card: confirming.card, stage: confirming.stage, confirmed: true }); setConfirming(null); }} />
    <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 sm:snap-none" role="list" aria-label="Pipeline stages">
      {pipeline.stages.map((stage) => (
        <section key={stage.id} role="listitem" aria-label={stage.name}
          className={`flex w-[85vw] shrink-0 snap-start flex-col gap-2 rounded-[var(--radius-card)] border p-2 sm:w-72 ${over === stage.id ? "border-brand bg-brand-soft" : "border-border bg-surface-muted"}`}
          onDragOver={canMove && !stage.isInactive ? (event) => { event.preventDefault(); setOver(stage.id); } : undefined}
          onDragLeave={() => setOver((current) => (current === stage.id ? null : current))}
          onDrop={canMove ? () => drop(stage) : undefined}>
          <header className="flex items-baseline justify-between gap-2 px-1 pt-1 text-sm"
            title={[`${stage.probability}% probability`, `${formatMoney(currency, stage.weightedValue)} weighted`,
              stage.averageDaysInStage !== null ? `average ${days(Math.round(stage.averageDaysInStage))} in stage` : null].filter(Boolean).join(" · ")}>
            <span className="min-w-0 truncate font-semibold">{stage.name}{stage.isInactive ? " (inactive)" : ""} <span className="font-normal text-text-secondary">· {stage.count}</span></span>
            <span className="shrink-0 text-xs tabular-nums text-text-secondary">{formatMoney(currency, stage.value)}</span>
          </header>
          {stage.cards.length === 0 && (
            <p className="rounded-[var(--radius-control)] border border-dashed border-border px-2 py-6 text-center text-xs text-text-muted">No deals in {stage.name}</p>
          )}
          {stage.cards.map((card) => (
            <PipelineCard key={card.id} card={card} baseCurrency={currency} can={can} canDrag={canMove && card.status === "open"} isDragging={dragged?.id === card.id}
              moveTargets={canMove && card.status === "open" ? activeStages.filter((entry) => entry.id !== card.stageId).map((entry) => ({ id: entry.id, name: entry.name })) : []}
              onDragStart={() => setDragged(card)} onDragEnd={() => { setDragged(null); setOver(null); }} onAction={(action) => onAction(action, card)}
              onMove={(stageId) => moveTo(card, stageId)} onStep={(direction) => step(card, direction)} />
          ))}
          {stage.hasMore && (
            <Link href={stageListHref(stage.id)} className="px-1 pb-1 text-xs font-medium text-brand underline-offset-2 hover:underline">
              Showing {stage.cards.length} of {stage.count}. Open them all in the list
            </Link>
          )}
        </section>
      ))}
    </div>
    </>
  );
}

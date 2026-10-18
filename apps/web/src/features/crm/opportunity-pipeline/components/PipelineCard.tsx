"use client";

// One deal on the board: name, company, value, close date (red once past), owner initials and days in the stage — and its actions. A deal
// moves three ways, all through the same stage change: drag the card, choose Move to in its "…" menu, or focus it and press ← / →.
import type { KeyboardEvent } from "react";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { Badge, Button, Menu, MenuItem, MenuSection, MenuTrigger } from "@vercentlabs/design-system";

import type { Opportunity, OpportunityCapabilities } from "@/features/crm/opportunities/api/opportunities-api";
import { OpportunityStatusBadge, days } from "@/features/crm/opportunities/opportunity-format";
import { formatDate, formatMoney } from "@/shared/format/human";

export type CardAction = "quickEdit" | "task" | "followUp" | "activity" | "quotation" | "won" | "lost";

const initials = (name: string | null) => (name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "–";

export function PipelineCard({ card, baseCurrency, can, canDrag, isDragging, moveTargets, onDragStart, onDragEnd, onAction, onMove, onStep }: {
  card: Opportunity; baseCurrency: string; can: OpportunityCapabilities; canDrag: boolean; isDragging: boolean;
  // The other stages this card can move to (empty when it cannot move).
  moveTargets: Array<{ id: string; name: string }>;
  onDragStart: () => void; onDragEnd: () => void; onAction: (action: CardAction) => void; onMove: (stageId: string) => void; onStep: (direction: -1 | 1) => void;
}) {
  const open = card.status === "open";
  const currency = card.currencyCode ?? baseCurrency;
  const actions = [
    { id: "quickEdit", label: "Quick edit", show: open && (can.edit || can.changeStage) },
    { id: "task", label: "Add task", show: open && can.edit },
    { id: "followUp", label: "Schedule follow-up", show: open && can.edit },
    { id: "activity", label: "Log activity", show: can.edit },
    { id: "quotation", label: "Create quotation", show: open && can.quoteInSales },
    { id: "won", label: "Mark won", show: open && can.markWon },
    { id: "lost", label: "Mark lost", show: open && can.markLost },
  ].filter((entry) => entry.show);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || !canDrag) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); onStep(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); onStep(1); }
  };

  return (
    <article data-card-id={card.id} draggable={canDrag} onDragStart={onDragStart} onDragEnd={onDragEnd} tabIndex={canDrag ? 0 : undefined} onKeyDown={onKeyDown}
      aria-label={canDrag ? `${card.name}. Press left or right arrow to move it to the previous or next stage.` : card.name}
      className={`flex flex-col gap-1 rounded-[var(--radius-control)] border border-border bg-surface p-2.5 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-brand ${canDrag ? "cursor-grab active:cursor-grabbing" : ""} ${isDragging ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-1">
        <Link href={`/crm/opportunities/${card.id}`} className="min-w-0 font-medium text-text underline-offset-2 hover:underline">{card.name}</Link>
        {(actions.length > 0 || moveTargets.length > 0) && (
          <MenuTrigger>
            <Button variant="ghost" size="compact" aria-label={`Actions for ${card.name}`}><MoreHorizontal className="size-4" aria-hidden="true" /></Button>
            <Menu onAction={(id) => { const key = String(id); if (key.startsWith("move:")) onMove(key.slice(5)); else onAction(key as CardAction); }}>
              <MenuSection>{actions.map((entry) => <MenuItem key={entry.id} id={entry.id}>{entry.label}</MenuItem>)}</MenuSection>
              {moveTargets.length > 0 && (
                <MenuSection title="Move to">{moveTargets.map((stage) => <MenuItem key={stage.id} id={`move:${stage.id}`}>{stage.name}</MenuItem>)}</MenuSection>
              )}
            </Menu>
          </MenuTrigger>
        )}
      </div>
      <span className="truncate text-xs text-text-secondary">{card.accountName ?? "No company"}</span>
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-semibold tabular-nums">{formatMoney(currency, open ? card.amount : card.wonAmount ?? card.amount)}</span>
        <span className={`text-xs ${open && card.isOverdue ? "font-semibold text-danger" : "text-text-secondary"}`}>
          {open ? (card.expectedCloseDate ? formatDate(card.expectedCloseDate) : "No close date") : `Closed ${formatDate(card.actualCloseDate)}`}
        </span>
      </span>
      <span className="flex items-center justify-between gap-2 text-xs text-text-muted">
        <span title={card.ownerName ?? "Unassigned"} className="flex size-6 items-center justify-center rounded-full bg-surface-muted text-[0.65rem] font-semibold text-text-secondary">{initials(card.ownerName)}</span>
        <span className="flex flex-wrap items-center justify-end gap-1">
          {!open && <OpportunityStatusBadge status={card.status} />}
          {card.isStale && <Badge tone="warning">Stale</Badge>}
          {card.stageOverdue && <Badge tone="danger">{card.stageTimeLimitDays ? `Over its ${card.stageTimeLimitDays}-day limit` : "Over its time limit"}</Badge>}
          {card.hasAcceptedQuotation && open && <Badge tone="success">Quote accepted</Badge>}
          {open && <span>{days(card.stageAgeDays)} in stage</span>}
        </span>
      </span>
    </article>
  );
}

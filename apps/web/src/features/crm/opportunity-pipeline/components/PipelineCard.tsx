"use client";

// One opportunity on the board: what a salesperson needs to decide what to
// do next, and the actions that do it. Editing the record itself happens on
// the opportunity page.
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { Badge, Button, Menu, MenuItem, MenuTrigger } from "@vercentlabs/design-system";

import type { Opportunity, OpportunityCapabilities } from "@/features/crm/opportunities/api/opportunities-api";
import { OpportunityStatusBadge, PriorityBadge, days } from "@/features/crm/opportunities/opportunity-format";
import { formatDate, formatMoney, humanize } from "@/shared/format/human";

export type CardAction = "quickEdit" | "task" | "followUp" | "activity" | "quotation" | "won" | "lost";

function shortDate(value: string | null) {
  return value ? formatDate(value) : "";
}

export function PipelineCard({ card, baseCurrency, can, canDrag, isDragging, onDragStart, onDragEnd, onAction }: {
  card: Opportunity; baseCurrency: string; can: OpportunityCapabilities; canDrag: boolean; isDragging: boolean;
  onDragStart: () => void; onDragEnd: () => void; onAction: (action: CardAction) => void;
}) {
  const open = card.status === "open";
  const currency = card.currencyCode ?? baseCurrency;
  const actions = [
    { id: "quickEdit", label: "Quick edit", show: open && (can.edit || can.changeStage) },
    { id: "task", label: "Add task", show: open && can.edit },
    { id: "followUp", label: "Schedule follow-up", show: open && can.edit },
    { id: "activity", label: "Log activity", show: can.edit },
    { id: "quotation", label: "Create quotation", show: open && can.createQuotation },
    { id: "won", label: "Mark won", show: open && can.markWon },
    { id: "lost", label: "Mark lost", show: open && can.markLost },
  ].filter((entry) => entry.show);

  return (
    <article draggable={canDrag} onDragStart={onDragStart} onDragEnd={onDragEnd}
      className={`flex flex-col gap-1.5 rounded-[var(--radius-control)] border bg-surface p-2.5 text-sm shadow-sm ${card.isOverdue ? "border-danger-emphasis/40" : "border-border"} ${canDrag ? "cursor-grab active:cursor-grabbing" : ""} ${isDragging ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-1">
        <Link href={`/crm/opportunities/${card.id}`} className="min-w-0 font-medium text-text underline-offset-2 hover:underline">{card.name}</Link>
        {actions.length > 0 && (
          <MenuTrigger>
            <Button variant="ghost" size="compact" aria-label={`Actions for ${card.name}`}><MoreHorizontal className="size-4" aria-hidden="true" /></Button>
            <Menu onAction={(id) => onAction(String(id) as CardAction)}>
              {actions.map((entry) => <MenuItem key={entry.id} id={entry.id}>{entry.label}</MenuItem>)}
            </Menu>
          </MenuTrigger>
        )}
      </div>
      <span className="text-xs text-text-secondary">{[card.accountName ?? "No account", card.contactName].filter(Boolean).join(" · ")}</span>
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-semibold tabular-nums">{formatMoney(currency, open ? card.amount : card.wonAmount ?? card.amount)}</span>
        <span className="text-xs text-text-secondary">{card.probability}%{card.probabilityOverridden && open ? " (set)" : ""}</span>
      </span>
      <span className="text-xs text-text-secondary">
        {card.ownerName ?? "Unassigned"}
        {open
          ? card.expectedCloseDate ? <> · Close <span className={card.isOverdue ? "font-semibold text-danger" : card.isClosingSoon ? "font-semibold text-warning" : ""}>{shortDate(card.expectedCloseDate)}</span></> : " · No close date"
          : ` · Closed ${shortDate(card.actualCloseDate)}`}
      </span>
      {open && (
        <span className={`text-xs ${card.hasNoNextActivity && !card.nextStep ? "font-medium text-warning" : "text-text-secondary"}`}>
          {card.nextActivity
            ? <>Next: {card.nextActivity.subject}{card.nextActivity.dueAt ? ` · ${shortDate(card.nextActivity.dueAt)}` : ""}</>
            : card.nextStep ? <>Next step: {card.nextStep}</> : "No next activity"}
        </span>
      )}
      {open && (
        <span className={`text-xs ${card.nextFollowUpAt ? "text-text-secondary" : "text-warning"}`}>
          {card.nextFollowUpAt ? <>Next follow-up: {shortDate(card.nextFollowUpAt)}</> : "No next follow-up"}
        </span>
      )}
      {card.quotationCount > 0 && (
        <span className="text-xs text-text-secondary">
          {card.quotationCount} {card.quotationCount === 1 ? "quotation" : "quotations"}
          {card.latestQuotationNumber ? ` · Latest ${card.latestQuotationNumber}` : ""}
          {card.latestQuotationTotal !== null ? ` · ${formatMoney(card.latestQuotationCurrency ?? currency, card.latestQuotationTotal)}` : ""}
          {card.latestQuotationStatus && !card.hasAcceptedQuotation ? ` · ${humanize(card.latestQuotationStatus)}` : ""}
        </span>
      )}
      <span className="flex flex-wrap items-center gap-1">
        {!open && <OpportunityStatusBadge status={card.status} />}
        {card.priority !== "medium" && <PriorityBadge priority={card.priority} />}
        {card.isOverdue && <Badge tone="danger">Overdue</Badge>}
        {card.isClosingSoon && <Badge tone="warning">Closing soon</Badge>}
        {card.isStale && <Badge tone="warning">Stale · {days(card.daysSinceActivity)}</Badge>}
        {open && card.hasNoNextActivity && card.nextStep && <Badge tone="warning">No next activity</Badge>}
        {card.hasAcceptedQuotation && open && <Badge tone="success">Quotation accepted</Badge>}
        {open && <span className="text-xs text-text-muted">{days(card.stageAgeDays)} in stage</span>}
        {card.status === "lost" && card.lostReasonName && <span className="text-xs text-text-muted">{card.lostReasonName}</span>}
      </span>
    </article>
  );
}

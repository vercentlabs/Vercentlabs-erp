"use client";

// The board view of a Sales list (CRM parity: deals have a board beside the table). One column per stage with its count and value, a
// card per document that opens it. The same filters as the table; up to 200 documents, newest first. Columns scroll sideways on a phone
// and tablet and sit side by side on a desktop. Moving a card is not offered: each document's stage changes through its own actions.
import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";

import { money } from "@/features/sales/shared/format";
import { ViewToggle } from "@/features/crm/shared/ui/ViewToggle";

export const BOARD_LIMIT = 200;

export type BoardColumn = { key: string; label: string; tone?: "neutral" | "success" | "warning" | "danger" };
export type BoardCard = { id: string; href: string; title: string; subtitle?: string | null; meta?: ReactNode; currency: string; amount: number };

const TONE = { neutral: "bg-surface-muted", success: "bg-success-soft", warning: "bg-warning-soft", danger: "bg-danger-soft" } as const;

export function SalesBoard({ columns, cards, columnOf, total, loading }: {
  columns: BoardColumn[]; cards: BoardCard[]; columnOf: (card: BoardCard) => string | null; total: number; loading: boolean;
}) {
  if (loading) return <p className="px-4 py-6 text-sm text-text-muted">Loading the board…</p>;
  const placed = columns.map((column) => ({ column, cards: cards.filter((card) => columnOf(card) === column.key) }));
  return (
    <div className="flex flex-col gap-2">
      {total > cards.length && (
        <p className="text-xs text-text-muted">{`Showing the ${cards.length} newest of ${total}. Filter or search to see the rest here, or use the table.`}</p>
      )}
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:px-0">
        {placed.map(({ column, cards: inColumn }) => {
          const currency = inColumn[0]?.currency ?? "INR";
          const value = inColumn.reduce((sum, card) => sum + card.amount, 0);
          return (
            <section key={column.key} aria-label={column.label} className="flex w-72 shrink-0 snap-start flex-col rounded-[var(--radius-card)] border border-border bg-surface lg:w-auto lg:min-w-0 lg:flex-1">
              <header className={`flex items-baseline justify-between gap-2 rounded-t-[var(--radius-card)] px-3 py-2 ${TONE[column.tone ?? "neutral"]}`}>
                <span className="text-sm font-semibold text-text">{`${column.label} (${inColumn.length})`}</span>
                <span className="text-xs tabular-nums text-text-secondary">{money(currency, value)}</span>
              </header>
              <ul className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto p-2">
                {inColumn.map((card) => (
                  <li key={card.id}>
                    <Link href={card.href} className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-border bg-surface p-2.5 text-sm hover:border-brand">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-medium tabular-nums text-text">{card.title}</span>
                        <span className="shrink-0 tabular-nums text-text-secondary">{money(card.currency, card.amount)}</span>
                      </span>
                      {card.subtitle && <span className="truncate text-xs text-text-secondary">{card.subtitle}</span>}
                      {card.meta && <span className="text-xs text-text-muted">{card.meta}</span>}
                    </Link>
                  </li>
                ))}
                {!inColumn.length && <li className="px-1 py-3 text-xs text-text-muted">None</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// Table or Board, remembered per list on this device.
export function useBoardMode(storageKey: string) {
  const [mode, setModeState] = useState<"table" | "board">(() => {
    if (typeof window === "undefined") return "table";
    try { return window.localStorage.getItem(storageKey) === "board" ? "board" : "table"; } catch { return "table"; }
  });
  const setMode = (next: string) => {
    const value = next === "board" ? "board" : "table";
    setModeState(value);
    try { window.localStorage.setItem(storageKey, value); } catch { /* a convenience only */ }
  };
  return { mode, setMode, toggle: <ViewToggle label="Show as" options={[{ id: "table", label: "Table" }, { id: "board", label: "Board" }]} value={mode} onChange={setMode} /> };
}

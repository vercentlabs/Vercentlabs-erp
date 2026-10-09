"use client";

// Pieces of a record page in CRM's style, shared by every module: the lines table inside a panel, the history list (CRM's audit trail look)
// and the "More actions" menu beside a record's primary action.
import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Badge, Button, Menu, MenuItem, MenuTrigger, cn } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { PropertyList } from "@/shared/ui/PropertyList";

export type LinesColumn = { label: string; numeric?: boolean };

export function LinesTable({ columns, children, empty, className }: { columns: Array<string | LinesColumn>; children: ReactNode; empty?: ReactNode; className?: string }) {
  const heads = columns.map((column) => (typeof column === "string" ? { label: column } : column));
  return (
    <div className={cn("overflow-x-auto rounded-[var(--radius-card)] border border-border", className)}>
      <table className="w-full text-sm">
        <thead className="bg-surface-muted text-left text-text-secondary">
          <tr>{heads.map((head) => <th key={head.label} scope="col" className={cn("px-3 py-2 font-medium whitespace-nowrap", head.numeric && "text-right")}>{head.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {children}
          {empty ? <tr><td colSpan={heads.length} className="px-3 py-4 text-text-muted">{empty}</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

export function Cell({ children, numeric, className }: { children?: ReactNode; numeric?: boolean; className?: string }) {
  const blank = children === null || children === undefined || children === "";
  return <td className={cn("px-3 py-2", numeric && "text-right tabular-nums", className)}>{blank ? <span className="text-text-muted">—</span> : children}</td>;
}

export type HistoryEntry = { summary: ReactNode; at: string | null; actor?: string | null; label?: string | null; detail?: ReactNode };

// Every change to the record, newest first, as on CRM records.
export function HistoryList({ entries, title = "Audit trail", empty = "No history yet." }: { entries: HistoryEntry[]; title?: string | null; empty?: string }) {
  return (
    <section className="flex flex-col gap-3">
      {title && <h2 className="text-base font-semibold">{title}</h2>}
      {!entries.length ? <p className="text-sm text-text-muted">{empty}</p> : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
          {entries.map((entry, index) => (
            <li key={index} className="flex flex-col gap-1 px-4 py-3">
              <span className="flex flex-wrap items-center gap-2">{entry.label && <Badge tone="neutral">{entry.label}</Badge>}<span className="font-medium">{entry.summary}</span></span>
              {entry.detail}
              <span className="text-xs text-text-muted">{entry.at ? formatDateTime(entry.at) : ""}{entry.actor ? ` · ${entry.actor}` : entry.at ? " · System" : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export type MoreAction = { id: string; label: string; run: () => void; show?: boolean };

// The record's less frequent or destructive actions, behind "More actions" (CRM's "…" menu).
export function MoreActions({ actions }: { actions: MoreAction[] }) {
  const shown = actions.filter((action) => action.show !== false);
  if (!shown.length) return null;
  return (
    <MenuTrigger>
      <Button variant="outline" aria-label="More actions"><MoreHorizontal className="size-4" aria-hidden="true" /></Button>
      <Menu onAction={(key) => shown.find((action) => action.id === key)?.run()}>
        {shown.map((action) => <MenuItem key={action.id} id={action.id}>{action.label}</MenuItem>)}
      </Menu>
    </MenuTrigger>
  );
}

// "12 Oct 2026, 10:30 by Gopal" — when and by whom a step was taken.
export const byLine = (at: string | null | undefined, name: string | null | undefined) => (at ? `${formatDateTime(at)}${name ? ` by ${name}` : ""}` : null);

// Labelled values given as [label, value] pairs, shown as CRM's PropertyList card (empty values named once, not as rows of dashes).
export function FactList({ items, title, description, columns = 3 }: { items: Array<[string, ReactNode]>; title?: string; description?: string; columns?: 1 | 2 | 3 }) {
  return <PropertyList title={title} description={description} columns={columns} items={items.map(([label, value]) => ({ label, value }))} />;
}

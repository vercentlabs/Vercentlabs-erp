"use client";

// A module's Overview (home) in CRM's shape, shared by every module: "Welcome back" with the module's Create menu, four headline figures,
// the person's work and what needs attention side by side as counted lists, a wider breakdown, and recent activity. Every figure opens the
// list behind it; a figure the person may not see is left out (pass null).
import type { ReactNode } from "react";
import Link from "next/link";
import { MetricCard, PageHeader } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function OverviewHeader({ description, action }: { description: string; action?: ReactNode }) {
  const workspace = useWorkspaceContext();
  const firstName = workspace.fullName.split(" ")[0] || workspace.fullName;
  return <PageHeader title={`Welcome back, ${firstName}`} description={description} primaryAction={action} />;
}

export type OverviewCard = { label: string; value: number | string | null; href: string };

// The headline figures: up to four cards, each opening its list.
export function OverviewCards({ label, cards }: { label: string; cards: OverviewCard[] }) {
  const shown = cards.filter((card) => card.value !== null);
  if (shown.length === 0) return null;
  return (
    <section aria-label={label} className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {shown.map((card) => (
        <Link key={card.label} href={card.href} className="rounded-[var(--radius-card)] outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand">
          <MetricCard label={card.label} value={card.value ?? 0} />
        </Link>
      ))}
    </section>
  );
}

export function OverviewPanel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export type CountRow = { label: string; value: number | string | null; href: string; tone?: "danger" | "warning" };

// "My work" / "Needs attention": a label and its count per row, each opening its list. A non-zero count with a tone is coloured.
export function CountList({ rows, empty = "Nothing here." }: { rows: CountRow[]; empty?: string }) {
  const shown = rows.filter((row) => row.value !== null);
  if (!shown.length) return <p className="text-sm text-text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border text-sm">
      {shown.map((row) => {
        const active = row.tone && row.value !== 0 && row.value !== "0";
        return (
          <li key={row.label}>
            <Link href={row.href} className="flex items-center justify-between gap-3 py-2 hover:text-brand">
              <span>{row.label}</span>
              <span className={`font-semibold tabular-nums ${active ? (row.tone === "danger" ? "text-danger" : "text-warning") : ""}`}>{row.value}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export type Tile = { key: string; label: string; value: string; caption?: string; href: string };

// A breakdown (CRM's pipeline by stage): small tiles, each opening its list.
export function TileGrid({ tiles }: { tiles: Tile[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {tiles.map((tile) => (
        <li key={tile.key}>
          <Link href={tile.href} className="flex flex-col gap-0.5 rounded-[var(--radius-control)] border border-border p-3 hover:border-border-strong hover:bg-surface-muted">
            <span className="text-sm text-text-secondary">{tile.label}</span>
            <span className="text-base font-semibold tabular-nums">{tile.value}</span>
            {tile.caption && <span className="text-xs text-text-muted">{tile.caption}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export type ActivityEntry = { key: string; href: string; title: ReactNode; summary?: ReactNode; meta: string };

// Recent activity: the record, what happened, who and when.
export function ActivityList({ entries, empty }: { entries: ActivityEntry[]; empty: string }) {
  if (!entries.length) return <p className="text-sm text-text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border text-sm">
      {entries.map((entry) => (
        <li key={entry.key} className="flex flex-col gap-0.5 py-2">
          <span>
            <Link href={entry.href} className="font-medium hover:underline">{entry.title}</Link>
            {entry.summary && <span className="text-text-secondary"> · {entry.summary}</span>}
          </span>
          <span className="text-xs text-text-muted">{entry.meta}</span>
        </li>
      ))}
    </ul>
  );
}

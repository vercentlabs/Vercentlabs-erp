"use client";

import { useMemo, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EnterpriseDataGrid, SectionHeader, cn, surfaceVariants } from "@vercentlabs/design-system";

// Small POS-side compositions over the design system's own primitives
// (Surface + SectionHeader), so every POS screen's panels, alerts and mini
// tables read the same way CRM's dashboard/detail panels do instead of each
// screen hand-rolling its own border/radius/heading classes. Presentation
// only -- no data access, no business logic.

/** A bordered card with an optional title row — the POS equivalent of the
 * panels on CRM's dashboard and record-detail screens. */
export function PosPanel({
  title,
  description,
  actions,
  children,
  className,
  padding = "md",
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md" | "lg";
}) {
  return (
    <section className={cn(surfaceVariants({ padding }), "flex flex-col gap-3", className)}>
      {(title || actions) && <SectionHeader title={title} description={description} actions={actions} className={padding === "none" ? "px-4 pt-4 pb-3" : undefined} />}
      {children}
    </section>
  );
}

const alertTone = {
  danger: "border-danger-emphasis/30 bg-danger-soft text-danger",
  warning: "border-warning-emphasis/30 bg-warning-soft text-warning",
  success: "border-success-emphasis/30 bg-success-soft text-success",
  info: "border-info-emphasis/30 bg-info-soft text-info",
} as const;

/** The inline error/notice banner CRM's screens render above their content. */
export function PosAlert({ tone = "danger", children, className }: { tone?: keyof typeof alertTone; children: ReactNode; className?: string }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-[var(--radius-control)] border px-3 py-2 text-sm", alertTone[tone], className)}>
      {children}
    </div>
  );
}

/** Label/value pairs in a responsive grid — for the read-only facts in a
 * panel (totals, identifiers, timestamps). */
export function PosFacts({ items, columns = 3 }: { items: Array<{ label: string; value: ReactNode }>; columns?: 2 | 3 | 4 }) {
  const cols = columns === 2 ? "sm:grid-cols-2" : columns === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3", cols)}>
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-0.5">
          <dt className="text-xs font-medium text-text-muted">{item.label}</dt>
          <dd className="text-sm text-text">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export type PosTableColumn<T> = {
  key: string;
  header: string;
  /** Right-align + tabular figures, for money and counts. */
  numeric?: boolean;
  render?: (row: T) => ReactNode;
};

/** A compact read-only table for dashboard/report panels. Built on the design
 * system's EnterpriseDataGrid (the project's one table primitive), given a smaller
 * corner radius so it reads as an inset table inside a PosPanel. Anything a user
 * filters, pages, selects or acts on belongs in a full EnterpriseDataGrid list
 * screen instead -- this is only for short breakdowns. */
export function PosDataTable<T extends Record<string, unknown>>({
  rows,
  columns,
  empty = "No data for this range.",
  caption,
}: {
  rows: T[];
  columns: PosTableColumn<T>[];
  empty?: string;
  caption?: string;
}) {
  const definitions = useMemo<ColumnDef<T, unknown>[]>(
    () =>
      columns.map((column) => ({
        id: column.key,
        // Numbers read right-aligned under a right-aligned header.
        header: column.numeric ? () => <span className="block text-right">{column.header}</span> : column.header,
        accessorFn: (row: T) => row[column.key],
        enableSorting: false,
        cell: ({ row }: { row: { original: T } }) => {
          const content = column.render ? column.render(row.original) : String(row.original[column.key] ?? "—");
          return column.numeric ? <span className="block text-right tabular-nums">{content}</span> : content;
        },
      })),
    [columns],
  );
  if (!rows.length) return <p className="text-sm text-text-muted">{empty}</p>;
  return <EnterpriseDataGrid<T> aria-label={caption ?? "Data table"} className="rounded-[var(--radius-control)]" columns={definitions} data={rows} density="compact" />;
}

export function PosLoading({ label = "Loading…" }: { label?: string }) {
  return <p className="px-4 py-8 text-sm text-text-secondary">{label}</p>;
}

/** "← All shifts" style return link for record pages, rendered above the
 * RecordHeader title. A real link (client-side navigation, middle-click,
 * keyboard) rather than a button that calls router.push. */
export function PosBackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm text-text-muted outline-none hover:text-text focus-visible:underline">
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      {children}
    </Link>
  );
}

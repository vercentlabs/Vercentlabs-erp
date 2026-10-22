"use client";

// The card section every module's pages are built from, in CRM's style: a bordered surface with a small heading (and optional description
// and actions), its content below. Notice is the inline message strip; Facts the labelled values of a card. One set for every module —
// CRM, Sales, Procurement and Inventory — so a panel looks the same wherever it is.
import type { ReactNode } from "react";
import { cn } from "@vercentlabs/design-system";

export function Panel({ title, description, actions, children, className }: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title && <h3 className="text-sm font-semibold text-text">{title}</h3>}
            {description && <p className="text-xs text-text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const tones = {
  danger: "border-danger-emphasis/30 bg-danger-soft text-danger",
  warning: "border-warning-emphasis/30 bg-warning-soft text-warning",
  success: "border-success-emphasis/30 bg-success-soft text-success",
  info: "border-info-emphasis/30 bg-info-soft text-info",
  neutral: "border-border bg-surface-muted text-text-secondary",
} as const;

export function Notice({ tone = "danger", children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-[var(--radius-control)] border px-3 py-2 text-sm", tones[tone], className)}>
      {children}
    </div>
  );
}

export function Facts({ items, columns = 3 }: { items: Array<{ label: string; value: ReactNode }>; columns?: 2 | 3 | 4 }) {
  const cols = columns === 2 ? "sm:grid-cols-2" : columns === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <dl className={cn("grid grid-cols-1 gap-x-8 gap-y-3", cols)}>
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-0.5">
          <dt className="text-xs text-text-muted">{item.label}</dt>
          <dd className="text-sm text-text">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

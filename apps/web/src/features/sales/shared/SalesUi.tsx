"use client";

import type { ReactNode } from "react";
import { SectionHeader, cn, surfaceVariants } from "@vercentlabs/design-system";

// Presentation-only helpers for Sales screens, composed from design-system
// primitives so Sales panels/alerts look like CRM's and POS's (same tokens,
// same section header). Kept local to Sales rather than importing POS's copy:
// modules must not depend on each other's feature folders.
export function SalesPanel({ title, description, actions, children, className }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn(surfaceVariants({ padding: "md" }), "flex flex-col gap-3", className)}>
      {(title || actions) && <SectionHeader title={title} description={description} actions={actions} />}
      {children}
    </section>
  );
}

const tones = {
  danger: "border-danger-emphasis/30 bg-danger-soft text-danger",
  warning: "border-warning-emphasis/30 bg-warning-soft text-warning",
  success: "border-success-emphasis/30 bg-success-soft text-success",
  info: "border-info-emphasis/30 bg-info-soft text-info",
} as const;

export function SalesAlert({ tone = "danger", children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-[var(--radius-control)] border px-3 py-2 text-sm", tones[tone], className)}>
      {children}
    </div>
  );
}

export function SalesFacts({ items, columns = 3 }: { items: Array<{ label: string; value: ReactNode }>; columns?: 2 | 3 | 4 }) {
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

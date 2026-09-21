"use client";

import Link from "next/link";

export type BarItem = { id: string; label: string; value: number; display: string; secondary?: string; href?: string };

// Horizontal bars over real figures, each with its number written out (the bar is never the only carrier).
export function BarList({ title, description, items, emptyText, ariaLabel }: { title: string; description?: string; items: BarItem[]; emptyText: string; ariaLabel?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4" aria-label={ariaLabel ?? title}>
      <div>
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {description && <p className="text-xs text-text-muted">{description}</p>}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-text-muted">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((item) => {
            const label = item.href ? <Link href={item.href} className="truncate text-text hover:underline">{item.label}</Link> : <span className="truncate text-text">{item.label}</span>;
            return (
              <li key={item.id} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  {label}
                  <span className="shrink-0 tabular-nums text-text-secondary">{item.display}{item.secondary ? <span className="text-text-muted">{` · ${item.secondary}`}</span> : null}</span>
                </div>
                <div className="h-2 rounded-full bg-canvas-strong" aria-hidden="true">
                  <div className="h-2 rounded-full bg-brand" style={{ width: `${Math.max(item.value > 0 ? 3 : 0, (item.value / max) * 100)}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

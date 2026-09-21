"use client";

import type { ReactNode } from "react";

export type Property = { label: string; value: ReactNode | null | undefined; wide?: boolean };

const isEmpty = (value: ReactNode | null | undefined) => value === null || value === undefined || value === "" || (typeof value === "string" && value.trim() === "");

// Labelled values in compact groups. Empty values are not rendered as rows of dashes: the ones that are missing
// are named once in a quiet line ("Not provided: Phone, Mobile, Industry") so nothing looks hidden.
export function PropertyList({ title, description, items, columns = 2 }: { title?: string; description?: string; items: Property[]; columns?: 1 | 2 | 3 }) {
  const filled = items.filter((item) => !isEmpty(item.value));
  const missing = items.filter((item) => isEmpty(item.value)).map((item) => item.label);
  if (filled.length === 0 && missing.length === 0) return null;
  const cols = columns === 1 ? "sm:grid-cols-1" : columns === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2";
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      {title && (
        <div>
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          {description && <p className="text-xs text-text-muted">{description}</p>}
        </div>
      )}
      {filled.length > 0 && (
        <dl className={`grid grid-cols-1 gap-x-8 gap-y-3 ${cols}`}>
          {filled.map((item) => (
            <div key={item.label} className={`flex flex-col gap-0.5 ${item.wide ? "sm:col-span-full" : ""}`}>
              <dt className="text-xs text-text-muted">{item.label}</dt>
              <dd className="text-sm text-text">{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {missing.length > 0 && <p className="text-xs text-text-muted">Not provided: {missing.join(", ")}</p>}
    </section>
  );
}

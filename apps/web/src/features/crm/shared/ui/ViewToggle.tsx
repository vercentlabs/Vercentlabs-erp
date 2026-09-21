"use client";

import type { ReactNode } from "react";

export type ViewOption = { id: string; label: string; icon?: ReactNode };

// One control for switching between alternate views of the same records (Table / Board / Calendar).
export function ViewToggle({ options, value, onChange, label = "View" }: { options: ViewOption[]; value: string; onChange: (id: string) => void; label?: string }) {
  return (
    <div role="group" aria-label={label} className="flex items-center rounded-[var(--radius-control)] border border-border bg-surface p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`flex min-h-8 items-center gap-1.5 rounded-[calc(var(--radius-control)-2px)] px-2.5 py-1.5 text-sm font-medium transition-colors ${value === option.id ? "bg-brand-soft text-brand" : "text-text-secondary hover:bg-surface-muted"}`}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

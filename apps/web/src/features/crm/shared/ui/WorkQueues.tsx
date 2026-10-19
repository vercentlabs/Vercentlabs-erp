"use client";

// The To-dos tabs' shared top: a row of coloured, counted cards that each open one slice of the list (Overdue, Due today… for tasks and
// follow-ups; Leads, Companies… for notes and files), and a segmented switch for whose work is shown (Mine / Team / Everyone).
import type { ComponentType } from "react";

export type QueueTone = "danger" | "warning" | "info" | "brand" | "success" | "neutral";
// Full class names (not built from the tone) so Tailwind keeps them.
export const QUEUE_TONES: Record<QueueTone, { icon: string; value: string; selected: string }> = {
  danger: { icon: "bg-danger-soft text-danger", value: "text-danger", selected: "border-danger bg-danger-soft ring-1 ring-danger" },
  warning: { icon: "bg-warning-soft text-warning", value: "text-warning", selected: "border-warning bg-warning-soft ring-1 ring-warning" },
  info: { icon: "bg-info-soft text-info", value: "text-info", selected: "border-info bg-info-soft ring-1 ring-info" },
  brand: { icon: "bg-brand-soft text-brand", value: "text-brand", selected: "border-brand bg-brand-soft ring-1 ring-brand" },
  success: { icon: "bg-success-soft text-success", value: "text-success", selected: "border-success bg-success-soft ring-1 ring-success" },
  neutral: { icon: "bg-canvas-strong text-text-secondary", value: "text-text", selected: "border-border-strong bg-surface-muted ring-1 ring-border-strong" },
};

export type QueueCard<K extends string> = { key: K; label: string; tone: QueueTone; icon: ComponentType<{ className?: string }>; count?: number };

export function QueueCards<K extends string>({ label, cards, value, onChange }: { label: string; cards: QueueCard<K>[]; value: K; onChange: (next: K) => void }) {
  const columns = cards.length >= 5 ? "lg:grid-cols-5" : cards.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3";
  return (
    <section aria-label={label} className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${columns}`}>
      {cards.map((card) => {
        const tone = QUEUE_TONES[card.tone];
        const Icon = card.icon;
        const selected = value === card.key;
        return (
          <button key={card.key} type="button" aria-pressed={selected} onClick={() => onChange(card.key)}
            className={`flex items-center gap-3 rounded-[var(--radius-card)] border p-3 text-left outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand ${selected ? tone.selected : "border-border bg-surface"}`}>
            <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${tone.icon}`}><Icon className="size-4" aria-hidden="true" /></span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-xs font-medium text-text-secondary">{card.label}</span>
              <span className={`text-xl font-semibold tabular-nums ${card.count ? tone.value : "text-text"}`}>{card.count ?? "–"}</span>
            </span>
          </button>
        );
      })}
    </section>
  );
}

export type WorkScope = "mine" | "team" | "everyone";
export const SCOPE_LABELS: Record<WorkScope, string> = { mine: "Mine", team: "Team", everyone: "Everyone" };

// Whose work: a segmented switch at the start of the toolbar.
export function ScopeSwitch({ label, scopes, value, onChange }: { label: string; scopes: WorkScope[]; value: WorkScope; onChange: (next: WorkScope) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 items-center gap-0.5 rounded-[var(--radius-control)] border border-border bg-surface-muted p-0.5">
      {scopes.map((entry) => (
        <button key={entry} type="button" role="radio" aria-checked={value === entry} onClick={() => onChange(entry)}
          className={`rounded-[calc(var(--radius-control)-2px)] px-3 py-1 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand ${value === entry ? "bg-surface text-brand shadow-sm" : "text-text-secondary hover:text-text"}`}>
          {SCOPE_LABELS[entry]}
        </button>
      ))}
    </div>
  );
}

// The local calendar date (YYYY-MM-DD), days from today.
export function localDate(daysFromToday = 0) {
  const date = new Date(Date.now() + daysFromToday * 86_400_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

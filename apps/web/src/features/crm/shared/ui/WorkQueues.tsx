"use client";

// The To-dos tabs' shared top: one strip of counted queues that each open one slice of the list (Overdue, Due today… for tasks and
// follow-ups; Leads, Companies… for notes and files), and a segmented switch for whose work is shown (Mine / Team / Everyone).
export type QueueTone = "danger" | "warning" | "info" | "brand" | "success" | "neutral";
// Full class names (not built from the tone) so Tailwind keeps them. The tone colours a count above zero and the selected bar.
export const QUEUE_TONES: Record<QueueTone, { value: string; bar: string }> = {
  danger: { value: "text-danger", bar: "after:bg-danger" },
  warning: { value: "text-warning", bar: "after:bg-warning" },
  info: { value: "text-text", bar: "after:bg-info" },
  brand: { value: "text-text", bar: "after:bg-brand" },
  success: { value: "text-text", bar: "after:bg-success" },
  neutral: { value: "text-text", bar: "after:bg-text-secondary" },
};

export type QueueCard<K extends string> = { key: K; label: string; tone: QueueTone; count?: number };

// One bordered strip split into equal cells — the selected one carries a bar in its tone along the bottom, like a selected tab. A
// zero stays grey so only real work stands out. On a phone the strip folds into two columns (an odd last cell takes the full row);
// the 1px gaps over the border colour draw the dividers either way.
export function QueueCards<K extends string>({ label, cards, value, onChange }: { label: string; cards: QueueCard<K>[]; value: K; onChange: (next: K) => void }) {
  return (
    <section aria-label={label}
      className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-border bg-border sm:flex [&>*:last-child:nth-child(odd)]:col-span-2">
      {cards.map((card) => {
        const tone = QUEUE_TONES[card.tone];
        const selected = value === card.key;
        return (
          <button key={card.key} type="button" aria-pressed={selected} onClick={() => onChange(card.key)}
            className={`relative flex min-w-0 flex-1 flex-col gap-1 px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset sm:px-4 sm:py-3
              after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 ${selected ? `bg-surface-muted ${tone.bar}` : "bg-surface after:bg-transparent hover:bg-surface-muted"}`}>
            <span className={`truncate text-xs font-medium ${selected ? "text-text" : "text-text-secondary"}`}>{card.label}</span>
            <span className={`text-xl leading-7 font-semibold tabular-nums ${card.count ? tone.value : "text-text-muted"}`}>{card.count ?? "–"}</span>
          </button>
        );
      })}
    </section>
  );
}

export type WorkScope = "mine" | "team" | "everyone";
export const SCOPE_LABELS: Record<WorkScope, string> = { mine: "Mine", team: "Team", everyone: "Everyone" };

// Whose work: a segmented switch at the start of the toolbar, as tall as the search and selects beside it.
export function ScopeSwitch({ label, scopes, value, onChange }: { label: string; scopes: WorkScope[]; value: WorkScope; onChange: (next: WorkScope) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex h-[var(--control-height-standard)] shrink-0 items-stretch gap-0.5 rounded-[var(--radius-control)] border border-border bg-surface-muted p-0.5">
      {scopes.map((entry) => (
        <button key={entry} type="button" role="radio" aria-checked={value === entry} onClick={() => onChange(entry)}
          className={`flex items-center rounded-[calc(var(--radius-control)-2px)] px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand ${value === entry ? "bg-surface text-brand shadow-sm" : "text-text-secondary hover:text-text"}`}>
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

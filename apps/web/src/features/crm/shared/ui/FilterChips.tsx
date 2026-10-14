"use client";

// Chips that narrow what a feed or list shows (the same chip style as the saved views on lists), never primary buttons.
export function FilterChips({ label, chips, selected, onSelect }: {
  label: string; chips: Array<{ id: string; label: string; count?: number }>; selected: string; onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {chips.map((chip) => {
        const active = chip.id === selected;
        return (
          <button key={chip.id} type="button" aria-pressed={active} onClick={() => onSelect(chip.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand ${
              active ? "border-brand bg-brand-soft text-brand-active" : "border-border text-text-secondary hover:bg-surface-muted hover:text-text"}`}>
            {chip.label}
            {chip.count !== undefined && <span className="tabular-nums text-xs text-text-muted">{chip.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

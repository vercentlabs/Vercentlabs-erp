"use client";

import { Skeleton } from "@vercentlabs/design-system";

export type Slot = { startsAt: string; endsAt: string };

// The free times for the chosen day, shown in the guest's own time zone. Each is a radio-style choice 44px tall.
export function TimeSlotList({ slots, loading, selected, onSelect, timeZone }: { slots: Slot[]; loading: boolean; selected: string | null; onSelect: (slot: Slot) => void; timeZone: string }) {
  if (loading) {
    return (
      <div role="status" aria-busy="true" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-11" />
        ))}
        <span className="sr-only">Loading available times</span>
      </div>
    );
  }
  if (slots.length === 0) {
    return <p className="rounded-[var(--radius-control)] bg-canvas-strong px-3 py-3 text-sm text-text-secondary">No times are free on this day. Try another date.</p>;
  }
  return (
    <div role="radiogroup" aria-label="Available times" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {slots.map((slot) => {
        const on = selected === slot.startsAt;
        return (
          <button
            key={slot.startsAt}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onSelect(slot)}
            className={`min-h-11 rounded-[var(--radius-control)] border px-2 text-sm font-medium transition-colors ${on ? "border-brand bg-brand text-text-inverse" : "border-brand-border bg-surface text-brand hover:bg-brand-soft"}`}
          >
            {new Date(slot.startsAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone })}
          </button>
        );
      })}
    </div>
  );
}

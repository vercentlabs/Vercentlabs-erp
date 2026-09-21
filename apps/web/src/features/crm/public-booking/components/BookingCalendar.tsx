"use client";

import { useState } from "react";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = (n: number) => String(n).padStart(2, "0");
const key = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

// A month grid of selectable days. Days outside min/max are disabled. Dates are plain YYYY-MM-DD strings (the host
// calendar day), never JS Date instants, so no time zone can shift a day.
export function BookingCalendar({ value, onChange, min, max }: { value: string; onChange: (date: string) => void; min: string; max?: string }) {
  const start = value || min;
  const [view, setView] = useState({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 });
  const first = new Date(Date.UTC(view.y, view.m, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const monthLabel = first.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const go = (delta: number) =>
    setView((v) => {
      const d = new Date(Date.UTC(v.y, v.m + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    });
  const canPrev = key(view.y, view.m, 1) > min.slice(0, 7) + "-01";
  const canNext = !max || key(view.y, view.m + 1, 1) <= max;

  return (
    <div className="flex flex-col gap-2" role="group" aria-label={`Choose a date, ${monthLabel}`}>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => go(-1)} disabled={!canPrev} aria-label="Previous month" className="size-11 rounded-full text-lg text-text hover:bg-surface-muted disabled:opacity-30">
          ‹
        </button>
        <p className="text-sm font-semibold text-text" aria-live="polite">
          {monthLabel}
        </p>
        <button type="button" onClick={() => go(1)} disabled={!canNext} aria-label="Next month" className="size-11 rounded-full text-lg text-text hover:bg-surface-muted disabled:opacity-30">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-text-muted" aria-hidden="true">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: offset }).map((_, i) => (
          <span key={`b${i}`} />
        ))}
        {Array.from({ length: days }).map((_, i) => {
          const date = key(view.y, view.m, i + 1);
          const disabled = date < min || (max ? date > max : false);
          const selected = date === value;
          return (
            <button
              key={date}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              aria-label={new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}
              onClick={() => onChange(date)}
              className={`aspect-square min-h-11 rounded-full text-sm transition-colors ${selected ? "bg-brand font-semibold text-text-inverse" : disabled ? "text-text-muted opacity-40" : "text-text hover:bg-brand-soft"}`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { NumberField, Select, TextField } from "@vercentlabs/design-system";

import type { RecurrenceConfig, RecurrenceFrequency } from "../types";

const FREQ_OPTIONS = [
  { value: "daily", label: "Day(s)" },
  { value: "weekly", label: "Week(s)" },
  { value: "monthly", label: "Month(s)" },
];

const END_OPTIONS = [
  { value: "never", label: "Never" },
  { value: "count", label: "After a number of occurrences" },
  { value: "until", label: "On a date" },
];

const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

function endMode(config: RecurrenceConfig): "never" | "count" | "until" {
  if (config.count) return "count";
  if (config.until) return "until";
  return "never";
}

// F015 Stage A2 §6. Maps directly to the existing authoritative
// recurrenceConfig contract (normalizeRecurrenceConfig, task-operations.js)
// — {freq, interval, count?, until?, byWeekday?} — not an invented
// cron/RRULE syntax. recurringRule (free text) is untouched; this builds
// the machine-readable field generateNextTaskOccurrence actually reads.
export function RecurrenceBuilder({ value, onChange }: { value: RecurrenceConfig | null; onChange: (value: RecurrenceConfig | null) => void }) {
  const enabled = Boolean(value);
  const config = value ?? { freq: "weekly" as RecurrenceFrequency, interval: 1 };

  function update(patch: Partial<RecurrenceConfig>) {
    onChange({ ...config, ...patch });
  }

  function toggleWeekday(day: number) {
    const current = new Set(config.byWeekday ?? []);
    if (current.has(day)) current.delete(day);
    else current.add(day);
    update({ byWeekday: [...current].sort((a, b) => a - b) });
  }

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-border p-3">
      <label className="flex items-center gap-2 text-sm font-medium text-text">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onChange(event.target.checked ? { freq: "weekly", interval: 1 } : null)}
        />
        Repeat this task
      </label>

      {enabled && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <div className="flex items-end gap-2">
            <NumberField label="Every" className="w-24" minValue={1} maxValue={365} value={config.interval} onChange={(interval) => update({ interval })} />
            <Select
              aria-label="Frequency unit"
              options={FREQ_OPTIONS}
              selectedKey={config.freq}
              onSelectionChange={(key) => update({ freq: (key as RecurrenceFrequency) ?? "weekly", byWeekday: key === "weekly" ? config.byWeekday : undefined })}
            />
          </div>

          {config.freq === "weekly" && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-muted">On these days (optional — defaults to the due date&apos;s own weekday cadence)</span>
              <div className="flex flex-wrap gap-1">
                {WEEKDAYS.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleWeekday(day.value)}
                    className={`rounded-[var(--radius-control)] border px-2 py-1 text-xs ${
                      (config.byWeekday ?? []).includes(day.value) ? "border-accent bg-accent-soft text-accent-emphasis" : "border-border bg-canvas text-text"
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Select
            label="Ends"
            options={END_OPTIONS}
            selectedKey={endMode(config)}
            onSelectionChange={(key) => {
              if (key === "never") onChange({ freq: config.freq, interval: config.interval, byWeekday: config.byWeekday });
              else if (key === "count") update({ count: config.count ?? 5, until: undefined });
              else update({ until: config.until ?? new Date().toISOString().slice(0, 10), count: undefined });
            }}
          />
          {endMode(config) === "count" && (
            <NumberField label="Occurrences" className="w-32" minValue={1} maxValue={500} value={config.count ?? 5} onChange={(count) => update({ count })} />
          )}
          {endMode(config) === "until" && (
            <TextField
              label="End date"
              placeholder="YYYY-MM-DD"
              value={config.until ? config.until.slice(0, 10) : ""}
              onChange={(until) => update({ until: until || undefined })}
            />
          )}
        </div>
      )}
    </div>
  );
}

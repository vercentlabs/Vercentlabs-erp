"use client";

import { useState } from "react";
import { Button, NumberField, Select } from "@vercentlabs/design-system";

import { REMINDER_PRESETS, reminderLabel } from "@/shared/format/human";

// Reminders as chips ("1 day before", "1 hour before", "At due time") over the integer minutes the backend stores.
export function ReminderPicker({ value, onChange, label = "Reminders" }: { value: number[]; onChange: (minutes: number[]) => void; label?: string }) {
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState(2);
  const [unit, setUnit] = useState("1440");
  const toggle = (minutes: number) => onChange(value.includes(minutes) ? value.filter((m) => m !== minutes) : [...value, minutes]);
  const custom = value.filter((m) => !REMINDER_PRESETS.some((p) => p.minutes === m)).sort((a, b) => b - a);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-text">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {[...REMINDER_PRESETS, ...custom.map((minutes) => ({ minutes, label: reminderLabel(minutes) }))].map((preset) => {
          const on = value.includes(preset.minutes);
          return (
            <button
              key={preset.minutes}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(preset.minutes)}
              className={`min-h-9 rounded-full border px-3 text-sm transition-colors ${on ? "border-brand bg-brand-soft font-medium text-brand" : "border-border bg-surface text-text-secondary hover:bg-surface-hover"}`}
            >
              {on ? "✓ " : ""}
              {preset.label}
            </button>
          );
        })}
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="min-h-9 rounded-full border border-dashed border-border-strong px-3 text-sm text-text-secondary hover:bg-surface-hover">
            + Add reminder
          </button>
        )}
      </div>
      {adding && (
        <div className="flex flex-wrap items-end gap-2">
          <NumberField label="Before due" value={amount} onChange={(v) => setAmount(Math.max(1, Math.round(Number(v) || 1)))} minValue={1} className="w-28" />
          <Select label="Unit" options={[{ value: "1", label: "minutes" }, { value: "60", label: "hours" }, { value: "1440", label: "days" }, { value: "10080", label: "weeks" }]} selectedKey={unit} onSelectionChange={(k) => setUnit(String(k))} className="w-36" />
          <Button variant="secondary" onPress={() => { const minutes = amount * Number(unit); if (!value.includes(minutes)) onChange([...value, minutes]); setAdding(false); }}>Add</Button>
          <Button variant="ghost" onPress={() => setAdding(false)}>Cancel</Button>
        </div>
      )}
      {value.length === 0 && <p className="text-xs text-text-muted">No reminders. You will not be notified before this is due.</p>}
    </fieldset>
  );
}

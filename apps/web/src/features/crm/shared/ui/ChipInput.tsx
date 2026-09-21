"use client";

import { useState } from "react";

// Enter, comma, space or leaving the field turns the typed text into a removable chip. Used for guest emails.
export function ChipInput({
  label, values, onChange, placeholder, validate, description,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  validate?: (value: string) => string | null;
  description?: string;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const commit = (raw: string) => {
    const parts = raw.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const next = [...values];
    for (const part of parts) {
      const problem = validate?.(part) ?? null;
      if (problem) {
        setError(problem);
        setDraft(part);
        return;
      }
      if (!next.some((v) => v.toLowerCase() === part.toLowerCase())) next.push(part);
    }
    setError(null);
    setDraft("");
    onChange(next);
  };
  const id = `chips-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-text">{label}</label>
      <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface px-2 py-1.5 focus-within:border-brand">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-canvas-strong px-2.5 py-1 text-sm text-text">
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="text-text-muted hover:text-text">×</button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          placeholder={values.length ? "" : placeholder}
          onChange={(e) => (/[,;\s]$/.test(e.target.value) ? commit(e.target.value) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
          }}
          onBlur={() => commit(draft)}
          aria-invalid={error ? true : undefined}
          className="min-w-32 flex-1 bg-transparent px-1 py-1 text-sm outline-none"
        />
      </div>
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : description ? <p className="text-xs text-text-muted">{description}</p> : null}
    </div>
  );
}

"use client";

// The pieces every quick-create form shares: the drawer footer (Cancel / Create, kept at the bottom), an error line, and the
// "Did you mean…?" list a duplicate refusal comes back with, where Use this picks the existing record instead.
import type { ReactNode } from "react";
import { Button } from "@vercentlabs/design-system";

import type { PickedRecord } from "./types";

export function QuickCreateLayout({ children, error, duplicates, onUse, onCancel, onSubmit, submitLabel, isPending, isDisabled }: {
  children: ReactNode;
  error?: string | null;
  duplicates?: PickedRecord[] | null;
  onUse?: (record: PickedRecord) => void;
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
  isPending?: boolean;
  isDisabled?: boolean;
}) {
  return (
    <form className="flex h-full flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (!isDisabled && !isPending) onSubmit(); }}>
      <div className="flex flex-1 flex-col gap-4">
        {duplicates && duplicates.length > 0 && (
          <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-warning/40 bg-warning-soft p-3 text-sm" role="alert">
            <p className="font-medium text-text">Did you mean one of these?</p>
            <ul className="flex flex-col gap-1.5">
              {duplicates.map((record) => (
                <li key={record.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-surface px-2.5 py-1.5">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-text">{record.label}</span>
                    {record.description && <span className="truncate text-xs text-text-secondary">{record.description}</span>}
                  </span>
                  {onUse && <Button variant="outline" size="compact" onPress={() => onUse(record)}>Use this</Button>}
                </li>
              ))}
            </ul>
            <p className="text-xs text-text-secondary">Or change the details below and create a new one.</p>
          </div>
        )}
        {error && <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        {children}
      </div>
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface-raised pt-4">
        <Button variant="secondary" onPress={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" isLoading={isPending} isDisabled={isDisabled}>{submitLabel}</Button>
      </div>
    </form>
  );
}

// "Ravi Kumar" → { first: "Ravi", last: "Kumar" }: what was typed in a person picker becomes the name fields.
export function splitName(text: string) {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

// Typed digits go to the phone field, an address with @ to email, anything else to the name.
export function readTyped(text: string) {
  const value = text.trim();
  if (/^\+?[\d\s-]{6,}$/.test(value)) return { name: "", phone: value, email: "" };
  if (/^[^\s@]+@[^\s@]+$/.test(value)) return { name: "", phone: "", email: value };
  return { name: value, phone: "", email: "" };
}

export const failure = (error: unknown, fallback = "It could not be created. Check the details and try again.") =>
  error instanceof Error && error.message ? error.message : fallback;

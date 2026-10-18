"use client";

// A small action dialog built from a list of fields (text, reason, quantity, choice, flag, date): the caller says what to ask and what to do
// with the answers. It holds one request key, so a retried click never posts twice. Shared by every module (CRM plan 5.9 moved it here
// from Manufacturing's order dialogs).
import { useState } from "react";
import { Button, Checkbox, Dialog, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { Notice } from "@/shared/ui/Panel";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export type Field = { name: string; label: string; kind: "text" | "textarea" | "quantity" | "select" | "checkbox" | "datetime" | "date"; options?: Array<{ value: string; label: string }>;
  required?: boolean; description?: string; initial?: string | boolean };
export type Ask = { title: string; description?: string; fields: Field[]; confirm: string; tone?: "primary" | "danger";
  run: (values: Record<string, string | boolean>, key: string) => Promise<unknown> };

export function AskDialog({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() => Object.fromEntries(ask.fields.map((field) => [field.name, field.initial ?? (field.kind === "checkbox" ? false : "")])));
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = ask.fields.every((field) => !field.required || (field.kind === "checkbox" ? true : String(values[field.name] ?? "").trim().length > 0));
  const confirm = async () => {
    setBusy(true); setError(null);
    try { await ask.run(values, key); onClose(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Something went wrong."); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={ask.title} size="md">
      <div className="flex flex-col gap-3">
        {ask.description && <p className="text-sm text-text-secondary">{ask.description}</p>}
        {ask.fields.map((field) => {
          const value = values[field.name];
          const set = (next: string | boolean) => setValues((current) => ({ ...current, [field.name]: next }));
          if (field.kind === "textarea") return <TextArea key={field.name} label={field.label} description={field.description} value={String(value)} onChange={set} maxLength={1000} />;
          if (field.kind === "select") return <Select key={field.name} label={field.label} description={field.description} selectedKey={String(value) || null} onSelectionChange={(next) => set(String(next))} options={field.options ?? []} />;
          if (field.kind === "checkbox") return <Checkbox key={field.name} isSelected={Boolean(value)} onChange={set}>{field.label}</Checkbox>;
          return <TextField key={field.name} label={field.label} description={field.description} type={field.kind === "datetime" ? "datetime-local" : field.kind === "date" ? "date" : "text"} inputMode={field.kind === "quantity" ? "decimal" : undefined}
            value={String(value)} onChange={set} />;
        })}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant={ask.tone === "danger" ? "danger" : "primary"} isLoading={busy} isDisabled={!ready} onPress={confirm}>{ask.confirm}</Button>
        </div>
      </div>
    </Dialog>
  );
}

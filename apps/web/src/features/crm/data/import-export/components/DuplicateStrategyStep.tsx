"use client";

import { Button } from "@vercentlabs/design-system";
import type { LeadImportWizard } from "../hooks/useLeadImportWizard";

const STRATEGIES = [
  {
    value: "skip",
    label: "Skip duplicates",
    help: "A row that matches an existing lead is left out. Safest choice.",
  },
  {
    value: "update",
    label: "Update the existing lead",
    help: "A matching row fills in the existing lead instead of creating a new one.",
  },
  {
    value: "warn",
    label: "Import anyway and flag it",
    help: "The row is created and marked as a possible duplicate for review.",
  },
  {
    value: "block",
    label: "Stop on the first duplicate",
    help: "The whole row is rejected so you can fix the file.",
  },
];

// Duplicate step: choose what happens when a row matches an existing Lead,
// then ask the server to check the file.
export function DuplicateStrategyStep({
  duplicateStrategy,
  setDuplicateStrategy,
  setStep,
  previewMutation,
}: {
  duplicateStrategy: string;
  setDuplicateStrategy: LeadImportWizard["setDuplicateStrategy"];
  setStep: LeadImportWizard["setStep"];
  previewMutation: { mutate: () => void; isPending: boolean };
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        Some rows may match leads you already have. Choose what should happen
        when one does.
      </p>
      <div
        role="radiogroup"
        aria-label="If a duplicate is found"
        className="flex flex-col gap-2"
      >
        {STRATEGIES.map((s) => (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={duplicateStrategy === s.value}
            onClick={() => setDuplicateStrategy(s.value)}
            className={`flex flex-col rounded-[var(--radius-control)] border px-4 py-3 text-left ${duplicateStrategy === s.value ? "border-brand bg-brand-soft" : "border-border hover:bg-surface-muted"}`}
          >
            <span className="text-sm font-medium text-text">{s.label}</span>
            <span className="text-xs text-text-secondary">{s.help}</span>
          </button>
        ))}
      </div>
      <div className="flex justify-between gap-2">
        <Button variant="secondary" onPress={() => setStep("map")}>
          Back
        </Button>
        <Button
          variant="primary"
          isLoading={previewMutation.isPending}
          onPress={() => previewMutation.mutate()}
        >
          Check the file
        </Button>
      </div>
    </div>
  );
}

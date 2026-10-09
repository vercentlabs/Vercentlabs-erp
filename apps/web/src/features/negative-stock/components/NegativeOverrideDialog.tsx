"use client";

// The authorised negative-stock override: a warning that posting will make physical stock negative (each position: on hand now, the
// movement, projected), a reason and notes, and a deliberately different, dangerous action. The stock engine checks the permission, the policy,
// the reason and that valuation can cost the issue; this dialog only collects them.
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, Dialog, Select, TextArea } from "@vercentlabs/design-system";

import type { NegativeOverride, OverrideReason } from "../api/negative-stock-api";

export type NegativeLine = { key: string; label: string; location: string; uom: string; onHand: string | number; requested: string | number; projected: string | number };

export function NegativeOverrideDialog({ title, lines, reasons, isPending, error, onConfirm, onClose }: {
  title: string; lines: NegativeLine[]; reasons: OverrideReason[]; isPending: boolean; error: string | null; onConfirm: (override: NegativeOverride) => void; onClose: () => void;
}) {
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const minimum = reasonCode === "OTHER" ? 20 : 10;
  const ready = Boolean(reasonCode) && notes.trim().length >= minimum;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title} size="lg">
      <div className="flex flex-col gap-3 text-sm">
        <div role="alert" className="flex gap-2 rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div><p className="font-semibold">Posting this transaction will create negative physical stock.</p>
            <p>This may affect inventory valuation and reconciliation. The negative position stays open as an exception until a real receipt, return or transfer brings it back.</p></div>
        </div>
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-text-secondary"><tr>{["Item", "Location", "Current on hand", "Movement", "Projected on hand"].map((label) =>
              <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {lines.map((line) => (
                <tr key={line.key}><td className="px-3 py-2">{line.label}</td><td className="px-3 py-2">{line.location}</td>
                  <td className="px-3 py-2 tabular-nums">{line.onHand} {line.uom}</td><td className="px-3 py-2 tabular-nums">−{line.requested} {line.uom}</td>
                  <td className="px-3 py-2 font-semibold tabular-nums text-danger">{line.projected} {line.uom}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <Select label="Override reason" isRequired selectedKey={reasonCode} onSelectionChange={(key) => setReasonCode(key ? String(key) : null)}
          options={reasons.map((reason) => ({ value: reason.id, label: reason.label }))} />
        <TextArea label="Explanation" isRequired value={notes} onChange={setNotes}
          description={`At least ${minimum} characters${reasonCode === "OTHER" ? " — Other needs a detailed explanation" : ""}. Kept for good in the negative-stock audit.`} />
        {error && <p role="alert" className="text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="danger" isDisabled={!ready} isLoading={isPending} onPress={() => reasonCode && onConfirm({ reasonCode, notes: notes.trim() })}>Post with override</Button>
        </div>
      </div>
    </Dialog>
  );
}

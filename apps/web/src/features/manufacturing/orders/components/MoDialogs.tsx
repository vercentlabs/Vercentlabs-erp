"use client";

// The manufacturing order's action dialogs: the shared field dialog (shared/ui/AskDialog), and the per-material dialog that issues,
// returns or records usage line by line. Each dialog holds one request key, so a retried click never posts twice.
import { useState } from "react";
import { Button, Dialog, TextField } from "@vercentlabs/design-system";

import { Notice } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";

import { newKey, qty, type MoMaterial } from "../api/mo-api";

export { AskDialog, type Ask, type Field } from "@/shared/ui/AskDialog";

// Issue, return or usage, line by line: the quantity per material (and a reason for a return).
export type LinesMode = "issue" | "return" | "consume";
const MODE = {
  issue: { title: "Issue materials to production", confirm: "Issue", limit: (row: MoMaterial) => row.remainingToIssue, limitLabel: "To issue",
    note: "Inventory issues from usable stock (this order's reservation first). You also need Inventory's issue permission." },
  return: { title: "Return unused material", confirm: "Return", limit: (row: MoMaterial) => row.inCustody, limitLabel: "In production",
    note: "Back to the material warehouse at the line's average issue cost." },
  consume: { title: "Record material used", confirm: "Record", limit: (row: MoMaterial) => row.inCustody, limitLabel: "In production",
    note: "What production actually used of what was issued. No stock moves; it is the actual usage against plan." },
} as const;

export function MaterialLinesDialog({ mode, materials, onClose, run }: { mode: LinesMode; materials: MoMaterial[]; onClose: () => void;
  run: (lines: Array<{ materialId: string; quantity: string; reason?: string }>, key: string) => Promise<unknown> }) {
  const config = MODE[mode];
  const rows = materials.filter((row) => Number(config.limit(row)) > 0);
  const [entries, setEntries] = useState<Record<string, { quantity: string; reason: string }>>(() =>
    Object.fromEntries(rows.map((row) => [row.id, { quantity: mode === "issue" ? String(Math.min(Number(row.remainingToIssue), Number(row.reserved) + Number(row.availableToReserve))) : "", reason: "" }])));
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = rows.filter((row) => Number(entries[row.id]?.quantity) > 0);
  const confirm = async () => {
    setBusy(true); setError(null);
    try { await run(chosen.map((row) => ({ materialId: row.id, quantity: entries[row.id].quantity, ...(mode === "return" ? { reason: entries[row.id].reason } : {}) })), key); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Something went wrong."); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={config.title} size="lg">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">{config.note}</p>
        {rows.length ? (
          <LinesTable columns={["Material", { label: config.limitLabel, numeric: true }, ...(mode === "issue" ? [{ label: "Reserved", numeric: true }, { label: "Free", numeric: true }] : []), "Quantity",
            ...(mode === "return" ? ["Reason"] : [])]}>
            {rows.map((row) => (
              <tr key={row.id}>
                <Cell><span className="flex flex-col"><span>{row.code} · {row.name}</span><span className="text-xs text-text-muted">{row.uom}{row.trackingType !== "none" ? ` · ${row.trackingType} tracked` : ""}</span></span></Cell>
                <Cell numeric>{qty(config.limit(row))}</Cell>
                {mode === "issue" && <><Cell numeric>{qty(row.reserved)}</Cell><Cell numeric>{qty(row.availableToReserve)}</Cell></>}
                <Cell><TextField aria-label={`${row.code} quantity`} size="compact" inputMode="decimal" className="w-28" value={entries[row.id]?.quantity ?? ""}
                  onChange={(value) => setEntries((current) => ({ ...current, [row.id]: { ...current[row.id], quantity: value } }))} /></Cell>
                {mode === "return" && <Cell><TextField aria-label={`${row.code} reason`} size="compact" value={entries[row.id]?.reason ?? ""}
                  onChange={(value) => setEntries((current) => ({ ...current, [row.id]: { ...current[row.id], reason: value } }))} /></Cell>}
              </tr>
            ))}
          </LinesTable>
        ) : <p className="text-sm text-text-muted">Nothing to {mode === "consume" ? "record" : mode}.</p>}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={!chosen.length} onPress={confirm}>{config.confirm}</Button>
        </div>
      </div>
    </Dialog>
  );
}

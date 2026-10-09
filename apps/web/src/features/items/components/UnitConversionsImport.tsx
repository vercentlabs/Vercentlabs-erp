"use client";

// Import unit conversions: one row per item and unit (SKU, Unit, Conversion to base, Purchasing, Sales, Inventory, Status). Checked first
// (nothing is saved), then applied; each row goes through the same rules as the Units screen and a failing row never stops the others.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dialog } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, importUnitConversions, unitConversionsTemplateUrl, type UnitImportResult } from "../api/items-api";
import { ErrorBanner } from "../item-format";

export function UnitConversionsImport({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);
  const [result, setResult] = useState<UnitImportResult | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) => importUnitConversions(file!, { dryRun, acknowledgeHistory: acknowledge }),
    onSuccess: (outcome) => { setResult(outcome); if (!outcome.dryRun) void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products") }); },
  });
  const close = () => { setFile(null); setResult(null); setAcknowledge(false); run.reset(); onClose(); };
  return (
    <Dialog isOpen={isOpen} onOpenChange={(open) => !open && close()} title="Import unit conversions"
      description="One row per item and unit. Check the file first: nothing is saved until you apply it.">
      <div className="flex flex-col gap-3">
        <ErrorBanner message={run.isError ? errorMessage(run.error) : null} />
        <a className="text-sm text-brand hover:underline" href={unitConversionsTemplateUrl} download>Download the template</a>
        <input type="file" accept=".csv,.xlsx" aria-label="Conversion file" className="text-sm" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setResult(null); }} />
        <Checkbox isSelected={acknowledge} onChange={setAcknowledge}>
          Change conversions of items already in use (documents and stock keep their old conversion)
        </Checkbox>
        {result && (
          <div className="flex flex-col gap-2">
            <p className="text-sm">{result.dryRun ? "Check: " : "Applied: "}{result.created} added · {result.updated} changed · {result.skipped} skipped · {result.failed} failed</p>
            {result.results.some((row) => row.outcome === "failed" || row.outcome === "skipped") && (
              <ul className="max-h-60 overflow-auto rounded-[var(--radius-control)] border border-border text-sm">
                {result.results.filter((row) => row.outcome !== "created" && row.outcome !== "updated").map((row) => (
                  <li key={row.rowNumber} className="border-b border-border px-3 py-1.5 last:border-b-0">Row {row.rowNumber} · {row.sku} {row.uom}: <span className={row.outcome === "failed" ? "text-danger" : "text-text-muted"}>{row.message}</span></li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={close}>{result && !result.dryRun ? "Done" : "Cancel"}</Button>
          <Button variant="outline" isDisabled={!file} isLoading={run.isPending && run.variables === true} onPress={() => run.mutate(true)}>Check file</Button>
          <Button variant="primary" isDisabled={!file || !result?.dryRun} isLoading={run.isPending && run.variables === false} onPress={() => run.mutate(false)}>Apply</Button>
        </div>
      </div>
    </Dialog>
  );
}

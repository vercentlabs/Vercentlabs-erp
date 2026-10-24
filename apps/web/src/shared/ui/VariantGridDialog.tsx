"use client";

// The variant grid (Sales and Procurement reports, Phase 3): choose a product made in sizes and colours, type quantities in a sizes ×
// colours grid, and each filled cell becomes a line for that variant. The grid scrolls sideways on a phone; the first column stays in place.
// basePath: the app's API ("/api/sales" or "/api/procurement"), whose variant-templates routes list what it may use.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Dialog, SearchField } from "@vercentlabs/design-system";

import { useDebouncedValue } from "@/shared/ui/list";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

async function request<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message ?? "The variants could not be loaded.");
  return payload as T;
}

type Template = { id: string; code: string; name: string; variants: number };
type Grid = { template: { id: string; name: string }; rowAttribute: string | null; columnAttribute: string | null; rows: string[]; columns: string[];
  cells: Record<string, { itemId: string; code: string; name: string }> };

export function VariantGridDialog({ onClose, onAdd, basePath, scope, emptyText = "No product with variants matches." }: {
  onClose: () => void; onAdd: (lines: Array<{ itemId: string; quantity: number }>) => void; basePath: string; scope: string; emptyText?: string;
}) {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const templates = useQuery({ queryKey: scopedQueryKey(workspace, scope, "variant-templates", submitted),
    queryFn: () => request<{ templates: Template[] }>(`${basePath}/variant-templates?q=${encodeURIComponent(submitted)}`).then((result) => result.templates), enabled: !templateId });
  const grid = useQuery({ queryKey: scopedQueryKey(workspace, scope, "variant-grid", templateId ?? ""),
    queryFn: () => request<{ grid: Grid }>(`${basePath}/variant-templates/${templateId}`).then((result) => result.grid), enabled: Boolean(templateId) });
  const filled = Object.entries(quantities).filter(([, quantity]) => quantity > 0);
  const data = grid.data;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} size="lg" title={data ? data.template.name : "Add by size and colour"}
      description={data ? "Type the quantity of each variant. Empty cells add nothing." : "Choose a product sold in variants."}>
      <div className="flex flex-col gap-4">
        {!templateId ? (
          <>
            <SearchField aria-label="Search products with variants" placeholder="Search products with variants" value={search} onChange={setSearch} />
            {templates.data?.length === 0 && <p className="text-sm text-text-secondary">{emptyText}</p>}
            <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-control)] border border-border text-sm">
              {(templates.data ?? []).map((template) => (
                <li key={template.id}>
                  <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-muted" onClick={() => setTemplateId(template.id)}>
                    <span className="font-medium">{template.name}</span><span className="text-xs text-text-muted">{`${template.variants} variants`}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : !data ? <p className="text-sm text-text-muted">Loading the variants…</p> : (
          <div className="overflow-x-auto rounded-[var(--radius-control)] border border-border">
            <table className="w-full min-w-max text-sm">
              <thead className="bg-surface-muted text-xs text-text-secondary">
                <tr>
                  <th className="sticky left-0 bg-surface-muted px-3 py-2 text-left font-medium">{`${data.rowAttribute ?? ""}${data.columnAttribute ? ` / ${data.columnAttribute}` : ""}`}</th>
                  {data.columns.map((column) => <th key={column} className="px-2 py-2 text-center font-medium">{column || "Quantity"}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.map((row) => (
                  <tr key={row}>
                    <th scope="row" className="sticky left-0 bg-surface px-3 py-2 text-left font-medium">{row}</th>
                    {data.columns.map((column) => {
                      const cell = data.cells[`${row}|${column}`];
                      return (
                        <td key={column} className="px-2 py-1.5 text-center">
                          {cell ? (
                            <input type="number" min={0} step={1} inputMode="numeric" aria-label={`${cell.name} quantity`}
                              className="h-10 w-20 rounded-[var(--radius-control)] border border-border bg-surface px-2 text-right tabular-nums"
                              value={quantities[cell.itemId] ?? ""} onChange={(event) => setQuantities((current) => ({ ...current, [cell.itemId]: Number(event.target.value) || 0 }))} />
                          ) : <span className="text-text-muted">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {templateId && <Button variant="ghost" className="w-full sm:w-auto" onPress={() => { setTemplateId(null); setQuantities({}); }}>Choose another product</Button>}
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          {templateId && <Button variant="primary" className="w-full sm:w-auto" isDisabled={!filled.length}
            onPress={() => onAdd(filled.map(([itemId, quantity]) => ({ itemId, quantity })))}>{filled.length ? `Add ${filled.length} ${filled.length === 1 ? "line" : "lines"}` : "Add lines"}</Button>}
        </div>
      </div>
    </Dialog>
  );
}

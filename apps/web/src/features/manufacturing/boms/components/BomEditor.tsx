"use client";

// The BOM editor: the product and its reference output, expected yield, batch size and instructions, then the materials — item, quantity,
// unit (the item's own units and conversions), proportional or fixed per batch, extra-material allowance, an optional pinned subassembly
// recipe and notes. Lines are added, removed and reordered; saving keeps it a draft, and the server checks everything again (a stale
// version, an unconvertible unit, a cycle) before it can be submitted.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, ComboBox, IconButton, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { useQuickCreate } from "@/shell/pickers/useQuickCreate";

import { bomOptions, errorIssues, errorMessage, itemUnits, type BomIssue, type BomRevision } from "../api/bom-api";

// lineageId: the line's identity across edits and revisions (absent on a new line), so comparison and the change log follow it.
export type EditorLine = { key: string; lineageId?: string; componentItemId: string | null; quantity: string; uomId: string | null; consumptionMode: "PROPORTIONAL" | "FIXED_PER_BATCH";
  scrapAllowancePct: string; childBomRevisionId: string | null; notes: string };
export type EditorState = { finishedItemId: string | null; name: string; outputQuantity: string; outputUomId: string | null; expectedYieldPct: string; batchSize: string;
  defaultWarehouseId: string | null; description: string; changeReason: string; lines: EditorLine[] };

let lineSeed = 0;
const lineKey = () => `line-${(lineSeed += 1)}`;
export const blankLine = (): EditorLine => ({ key: lineKey(), componentItemId: null, quantity: "1", uomId: null, consumptionMode: "PROPORTIONAL", scrapAllowancePct: "0", childBomRevisionId: null, notes: "" });
export const stateFromRevision = (revision: BomRevision, finishedItemId: string, name: string | null): EditorState => ({
  finishedItemId, name: name ?? "", outputQuantity: revision.outputQuantity, outputUomId: revision.outputUomId, expectedYieldPct: revision.expectedYieldPct, batchSize: revision.batchSize ?? "",
  defaultWarehouseId: revision.defaultWarehouseId, description: revision.description ?? "", changeReason: revision.changeReason ?? "",
  lines: revision.lines.map((line) => ({ key: lineKey(), lineageId: line.lineageId, componentItemId: line.componentItemId, quantity: line.quantity, uomId: line.uomId, consumptionMode: line.consumptionMode,
    scrapAllowancePct: line.scrapAllowancePct, childBomRevisionId: line.childBomRevisionId, notes: line.notes ?? "" })),
});
export const payloadOf = (state: EditorState) => ({
  name: state.name.trim() || null, outputQuantity: state.outputQuantity, outputUomId: state.outputUomId ?? undefined, expectedYieldPct: state.expectedYieldPct || "100",
  batchSize: state.batchSize.trim() || null, defaultWarehouseId: state.defaultWarehouseId, description: state.description.trim() || null, changeReason: state.changeReason.trim() || undefined,
  lines: state.lines.filter((line) => line.componentItemId).map((line) => ({ lineageId: line.lineageId, componentItemId: line.componentItemId, quantity: line.quantity, uomId: line.uomId,
    consumptionMode: line.consumptionMode, scrapAllowancePct: line.scrapAllowancePct || "0", childBomRevisionId: line.childBomRevisionId, notes: line.notes.trim() || null })),
});

export function BomEditor({ state, onChange, productLocked, issues, saving, onSave, onSubmit, saveLabel = "Save draft" }: {
  state: EditorState; onChange: (next: EditorState) => void; productLocked: boolean; issues: BomIssue[]; saving: boolean; onSave: () => void; onSubmit?: () => void; saveLabel?: string;
}) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "bom-options"), queryFn: bomOptions, staleTime: 60_000 });
  const product = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "item-units", state.finishedItemId ?? ""), queryFn: () => itemUnits(state.finishedItemId!), enabled: Boolean(state.finishedItemId) });
  const set = <K extends keyof EditorState>(key: K, value: EditorState[K]) => onChange({ ...state, [key]: value });
  // A product not in the catalogue yet is created in place (Create-Where-You-Are M2); the options reload with it.
  const newProduct = useQuickCreate("item", {
    prefill: { type: "stock", isSellable: true, isPurchasable: false },
    onCreated: (record) => { void options.refetch().then((fresh) => onChange({ ...state, finishedItemId: record.id, outputUomId: fresh.data?.products.find((item) => item.id === record.id)?.uomId ?? null })); },
  });
  const setLine = (index: number, patch: Partial<EditorLine>) => onChange({ ...state, lines: state.lines.map((line, at) => (at === index ? { ...line, ...patch } : line)) });
  const move = (index: number, by: number) => {
    const lines = [...state.lines];
    const [line] = lines.splice(index, 1);
    lines.splice(index + by, 0, line);
    onChange({ ...state, lines });
  };
  const lineIssues = (n: number) => issues.filter((issue) => issue.lineNumber === n);
  const general = issues.filter((issue) => !issue.lineNumber);
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Product and output" description="What this recipe makes, and the quantity its materials are for.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ComboBox label="Product to manufacture" isRequired isDisabled={productLocked} placeholder="Search products" selectedKey={state.finishedItemId}
            onSelectionChange={(key) => onChange({ ...state, finishedItemId: key ? String(key) : null, outputUomId: options.data?.products.find((item) => item.id === key)?.uomId ?? null })}
            options={(options.data?.products ?? []).filter((item) => productLocked || !item.hasBom || item.id === state.finishedItemId).map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))}
            onCreate={!productLocked && newProduct.canCreate ? newProduct.open : undefined} createLabel={(text) => (text ? `+ New product "${text}"` : "+ New product")} />
          {newProduct.drawer}
          <TextField label="BOM name (optional)" value={state.name} onChange={(value) => set("name", value)} maxLength={200} />
          <div className="flex gap-2">
            <TextField label="Output quantity" isRequired inputMode="decimal" value={state.outputQuantity} onChange={(value) => set("outputQuantity", value)} className="w-32" />
            <Select label="Unit" selectedKey={state.outputUomId} onSelectionChange={(key) => set("outputUomId", String(key))}
              options={(product.data?.units ?? []).map((unit) => ({ value: unit.uomId, label: unit.code }))} />
          </div>
          <TextField label="Expected yield %" description="Good output per 100 produced (100 = no loss)." inputMode="decimal" value={state.expectedYieldPct} onChange={(value) => set("expectedYieldPct", value)} />
          <TextField label="Batch size (optional)" description="Needed for fixed-per-batch materials." inputMode="decimal" value={state.batchSize} onChange={(value) => set("batchSize", value)} />
          <Select label="Default warehouse (planning)" selectedKey={state.defaultWarehouseId ?? "none"} onSelectionChange={(key) => set("defaultWarehouseId", key === "none" ? null : String(key))}
            options={[{ value: "none", label: "None" }, ...(options.data?.warehouses ?? []).map((warehouse) => ({ value: warehouse.id, label: `${warehouse.code} · ${warehouse.name}` }))]} />
        </div>
        <TextArea label="Instructions (optional)" value={state.description} onChange={(value) => set("description", value)} maxLength={4000} />
      </Panel>
      {general.length > 0 && (
        <Notice tone={general.some((issue) => issue.severity === "error") ? "danger" : "warning"}>
          <ul className="list-disc pl-4">{general.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>
        </Notice>
      )}
      <Panel title="Materials" description="Quantities are for the output quantity above. A subassembly with its own recipe can be made or taken from stock when planning.">
        <div className="flex flex-col gap-3">
          {state.lines.map((line, index) => (
            <MaterialLine key={line.key} line={line} index={index} count={state.lines.length} materials={options.data?.materials ?? []} issues={lineIssues(index + 1)}
              onChange={(patch) => setLine(index, patch)} onMove={(by) => move(index, by)} onRemove={() => onChange({ ...state, lines: state.lines.filter((_, at) => at !== index) })} />
          ))}
          <div><Button size="compact" variant="secondary" onPress={() => onChange({ ...state, lines: [...state.lines, blankLine()] })}><Plus className="size-4" aria-hidden="true" />Add material</Button></div>
        </div>
      </Panel>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" isLoading={saving} isDisabled={!state.finishedItemId} onPress={onSave}>{saveLabel}</Button>
        {onSubmit && <Button variant="primary" isLoading={saving} isDisabled={!state.finishedItemId} onPress={onSubmit}>Save and submit for approval</Button>}
      </div>
    </div>
  );
}

function MaterialLine({ line, index, count, materials, issues, onChange, onMove, onRemove }: {
  line: EditorLine; index: number; count: number; materials: Array<{ id: string; code: string; name: string; uomId: string; hasBom: boolean }>; issues: BomIssue[];
  onChange: (patch: Partial<EditorLine>) => void; onMove: (by: number) => void; onRemove: () => void;
}) {
  const workspace = useWorkspaceContext();
  const units = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "item-units", line.componentItemId ?? ""), queryFn: () => itemUnits(line.componentItemId!),
    enabled: Boolean(line.componentItemId) });
  const material = materials.find((item) => item.id === line.componentItemId);
  // A material not in the catalogue yet is created in place (Create-Where-You-Are M2).
  const queryClient = useQueryClient();
  const newMaterial = useQuickCreate("item", {
    prefill: { type: "stock", isSellable: false, isPurchasable: true },
    onCreated: (record) => {
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing", "bom-options") })
        .then(() => onChange({ lineageId: undefined, componentItemId: record.id, uomId: String((record.raw as { baseUomId?: string } | undefined)?.baseUomId ?? "") || null, childBomRevisionId: null }));
    },
  });
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <span className="pb-2 text-sm font-medium tabular-nums text-text-muted">{index + 1}</span>
        <ComboBox label="Material" className="sm:w-72" placeholder="Search items" selectedKey={line.componentItemId}
          onSelectionChange={(key) => onChange({ ...(key !== line.componentItemId ? { lineageId: undefined } : {}), componentItemId: key ? String(key) : null, uomId: materials.find((item) => item.id === key)?.uomId ?? null, childBomRevisionId: null })}
          options={materials.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}${item.hasBom ? " (has a recipe)" : ""}` }))}
          onCreate={newMaterial.canCreate ? newMaterial.open : undefined} createLabel={(text) => (text ? `+ New item "${text}"` : "+ New item")} />
        {newMaterial.drawer}
        <TextField label="Quantity" inputMode="decimal" value={line.quantity} onChange={(value) => onChange({ quantity: value })} className="w-28" />
        <Select label="Unit" selectedKey={line.uomId} onSelectionChange={(key) => onChange({ uomId: String(key) })}
          options={(units.data?.units ?? []).map((unit) => ({ value: unit.uomId, label: unit.isBase ? unit.code : `${unit.code} (${unit.text})` }))} />
        <Select label="Counted" selectedKey={line.consumptionMode} onSelectionChange={(key) => onChange({ consumptionMode: key === "FIXED_PER_BATCH" ? "FIXED_PER_BATCH" : "PROPORTIONAL" })}
          options={[{ value: "PROPORTIONAL", label: "Per output" }, { value: "FIXED_PER_BATCH", label: "Fixed per batch" }]} />
        <TextField label="Extra material %" inputMode="decimal" value={line.scrapAllowancePct} onChange={(value) => onChange({ scrapAllowancePct: value })} className="w-28" />
        <span className="flex gap-1 pb-1">
          <IconButton aria-label="Move up" variant="ghost" size="compact" isDisabled={index === 0} onPress={() => onMove(-1)}><ArrowUp className="size-4" /></IconButton>
          <IconButton aria-label="Move down" variant="ghost" size="compact" isDisabled={index === count - 1} onPress={() => onMove(1)}><ArrowDown className="size-4" /></IconButton>
          <IconButton aria-label="Remove material" variant="ghost" size="compact" onPress={onRemove}><Trash2 className="size-4" /></IconButton>
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {material?.hasBom && (
          <Select label="Subassembly recipe" selectedKey={line.childBomRevisionId ?? "effective"} onSelectionChange={(key) => onChange({ childBomRevisionId: key === "effective" ? null : String(key) })}
            options={[{ value: "effective", label: "The effective recipe at the time" }, ...(units.data?.recipes ?? []).map((recipe) => ({ value: recipe.id, label: recipe.label }))]} />
        )}
        <TextField label="Notes" value={line.notes} onChange={(value) => onChange({ notes: value })} maxLength={1000} className="sm:min-w-[20rem]" />
      </div>
      {issues.map((issue, at) => <p key={at} className={`text-xs ${issue.severity === "error" ? "text-danger" : "text-warning"}`}>{issue.message}</p>)}
    </div>
  );
}

export { errorIssues, errorMessage };

"use client";

// Create or edit a draft Stock Adjustment: one warehouse, a reason, and lines — an item at one location in one disposition, entered as what was
// counted (System / Counted / Difference shown side by side; the system stock is captured when saved) or as a difference, in any of the item's
// units, batch by batch or serial number by serial number. Saving keeps a draft: nothing moves. The detail page previews the impact and posts.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button, Checkbox, ComboBox, ErrorState, RecordFormPage, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { useInvOptions } from "@/features/inventory/shared/client";
import { ErrorBanner, quantity } from "@/features/items/item-format";
import { FormSection } from "@/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  ADJUSTMENTS_BASE, DISPOSITION_LABEL, createAdjustment, errorMessage, errorsOf, getAdjustment, getAdjustmentOptions, getStock, signed, updateAdjustment,
  type AdjustmentDetail, type AdjustmentOptions, type Disposition, type EntryMode, type LineInput, type ValuationSource,
} from "../api/adjustments-api";

type Lot = { key: string; batchId: string; newBatchNumber: string; newExpiresOn: string; value: string };
type Line = {
  key: string; lineId?: string; itemId: string; locationId: string; disposition: Disposition; mode: EntryMode; uomId: string; value: string; lots: Lot[];
  missing: string[]; found: string; valuationSource: ValuationSource; unitCost: string; costNote: string; notes: string;
};
const blank = (prefill: Partial<Line> = {}): Line => ({ key: crypto.randomUUID(), itemId: "", locationId: "", disposition: "available", mode: "counted", uomId: "", value: "", lots: [],
  missing: [], found: "", valuationSource: "current_valuation_cost", unitCost: "", costNote: "", notes: "", ...prefill });
const num = (value: string) => (value.trim() === "" || Number.isNaN(Number(value)) ? null : Number(value));

export function AdjustmentFormScreen({ adjustmentId, prefill }: { adjustmentId?: string; prefill?: { itemId?: string; warehouseId?: string; locationId?: string } }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "adjustments", "options"), queryFn: getAdjustmentOptions, staleTime: 60_000 });
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "adjustments", "detail", adjustmentId), queryFn: () => getAdjustment(adjustmentId!), enabled: Boolean(adjustmentId) });
  if (options.isLoading || existing.isLoading) return <LoadingState label="Loading stock adjustment" rows={4} />;
  if (!options.data || (adjustmentId && !existing.data)) return <ErrorState title="Could not load the stock adjustment" description={errorMessage(options.error ?? existing.error)} />;
  if (existing.data && existing.data.adjustment.status !== "draft")
    return <ErrorState title="This stock adjustment cannot be edited" description="Only a draft is edited. A posted adjustment is reversed (a posting mistake) or followed by a new one (a later discrepancy)." />;
  return <Form options={options.data} existing={existing.data ?? null} prefill={prefill} />;
}

function Form({ options, existing, prefill }: { options: AdjustmentOptions; existing: AdjustmentDetail | null; prefill?: { itemId?: string; warehouseId?: string; locationId?: string } }) {
  const router = useRouter();
  const inv = useInvOptions();
  const saved = existing?.adjustment;
  const [header, setHeader] = useState({
    warehouseId: saved?.warehouseId ?? prefill?.warehouseId ?? options.warehouses.find((entry) => entry.isDefault)?.id ?? options.warehouses[0]?.id ?? "",
    adjustmentDate: saved?.adjustmentDate ?? "", reasonId: saved?.reasonId ?? options.reasons.find((entry) => entry.code === "PHYSICAL_COUNT_LOSS")?.id ?? "",
    reference: saved?.reference ?? "", countReference: saved?.countReference ?? "", notes: saved?.notes ?? "",
  });
  const [lines, setLines] = useState<Line[]>(() => existing?.lines.length ? existing.lines.map((line) => ({
    key: line.id, lineId: line.id, itemId: line.itemId, locationId: line.locationId ?? "", disposition: line.disposition, mode: line.entryMode, uomId: line.uomId,
    value: String(line.entryMode === "counted" ? line.countedQuantity ?? "" : line.enteredDifference ?? ""),
    lots: line.batches.map((batch) => ({ key: crypto.randomUUID(), batchId: batch.batchId ?? "", newBatchNumber: batch.isNew ? batch.batch : "", newExpiresOn: batch.isNew ? batch.expiresOn ?? "" : "",
      value: String(line.entryMode === "counted" ? (batch.countedQuantity ?? 0) / line.conversion : batch.difference / line.conversion) })),
    missing: line.serials.filter((serial) => serial.direction === "out").map((serial) => serial.id ?? ""), found: line.serials.filter((serial) => serial.direction === "in").map((serial) => serial.serialNumber).join(", "),
    valuationSource: line.valuationSource ?? "current_valuation_cost", unitCost: line.unitCost === null || line.unitCost === undefined ? "" : String(line.unitCost), costNote: line.costNote ?? "", notes: line.notes ?? "",
  })) : [blank({ itemId: prefill?.itemId ?? "", locationId: prefill?.locationId ?? "" })]);
  const set = (key: keyof typeof header) => (value: string) => setHeader((current) => ({ ...current, [key]: value }));
  const setLine = (key: string, change: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...change } : line)));
  const reason = options.reasons.find((entry) => entry.id === header.reasonId);
  const warehouse = options.warehouses.find((entry) => entry.id === header.warehouseId);
  const payload = useMemo(() => ({
    warehouseId: header.warehouseId, adjustmentDate: header.adjustmentDate || undefined, reasonId: header.reasonId, reference: header.reference || null,
    countReference: header.countReference || null, notes: header.notes || null,
    lines: lines.filter((line) => line.itemId).map((line): LineInput => {
      const item = inv.data?.items.find((entry) => entry.id === line.itemId);
      const base: LineInput = { lineId: line.lineId, itemId: line.itemId, locationId: line.locationId || null, disposition: line.disposition, entryMode: line.mode, uomId: line.uomId || undefined,
        valuationSource: line.valuationSource, unitCost: line.unitCost || undefined, costNote: line.costNote || undefined, notes: line.notes || null };
      const found = line.found.split(/[\s,;]+/).map((entry) => entry.trim()).filter(Boolean);
      if (item?.tracking_type === "batch")
        return { ...base, batches: line.lots.filter((lot) => (lot.batchId || lot.newBatchNumber) && lot.value.trim() !== "").map((lot) => ({
          ...(lot.batchId ? { batchId: lot.batchId } : { newBatchNumber: lot.newBatchNumber, newExpiresOn: lot.newExpiresOn || undefined }), [line.mode === "counted" ? "counted" : "difference"]: lot.value })) };
      if (item?.tracking_type === "serial")
        return line.mode === "counted" ? { ...base, missingSerialIds: line.missing, foundSerialNumbers: found } : { ...base, serialsOut: line.missing, serialsIn: found };
      return line.mode === "counted" ? { ...base, countedQuantity: line.value } : { ...base, difference: line.value };
    }),
  }), [header, lines, inv.data]);
  const save = useMutation({
    mutationFn: () => (existing ? updateAdjustment(existing.adjustment.id, { ...payload, expectedVersion: existing.adjustment.version }) : createAdjustment(payload)),
    onSuccess: (detail) => router.push(`${ADJUSTMENTS_BASE}/${detail.adjustment.id}`),
  });
  const errors = errorsOf(save.error);

  return (
    <RecordFormPage
      header={{
        title: saved ? `Edit ${saved.number}` : "New stock adjustment",
        description: "Correct the books to what physically exists. Enter what you counted (recommended) or the difference. Saving keeps a draft — nothing moves; you preview the impact and post it next.",
      }}
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.push(saved ? `${ADJUSTMENTS_BASE}/${saved.id}` : ADJUSTMENTS_BASE)}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save and preview</Button>
        </>
      }
      banner={save.error ? <Notice>{errorMessage(save.error)}{errors.length > 1 && <ul className="mt-1 list-disc pl-5">{errors.map((entry) => <li key={entry.message}>{entry.message}</li>)}</ul>}</Notice> : undefined}
    >
      <FormSection title="Stock adjustment" columns={1}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select label="Warehouse" isRequired selectedKey={header.warehouseId || null}
            onSelectionChange={(key) => { set("warehouseId")(String(key)); setLines((current) => current.map((line) => ({ ...line, locationId: "", lots: [], missing: [] }))); }}
            options={options.warehouses.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))} description="One warehouse per adjustment." />
          <TextField label="Adjustment date" type="date" value={header.adjustmentDate} onChange={set("adjustmentDate")}
            description={options.capabilities.backdate ? "When the count or discrepancy took effect (today if empty)." : "Today if empty; an earlier date needs the backdate permission."} />
          <Select label="Reason" isRequired selectedKey={header.reasonId || null} onSelectionChange={(key) => set("reasonId")(String(key))}
            options={options.reasons.map((entry) => ({ value: entry.id, label: entry.name }))} description={reason?.description ?? undefined} />
          <TextField label="Reference" value={header.reference} onChange={set("reference")} placeholder="Ticket or report" />
          <TextField label="Count / migration reference" value={header.countReference} onChange={set("countReference")} placeholder="COUNT-2026-10-08" />
        </div>
        <TextArea label="Notes" isRequired={reason?.requiresNotes} value={header.notes} onChange={set("notes")}
          description={reason?.requiresNotes ? `${reason.name} needs notes: what the books showed, what was found, who confirmed it.` : "What the books showed, what was found, who confirmed it."} />
      </FormSection>
      <FormSection title="Lines" description="What was counted, or the difference, per item and location." columns={1}>
        {lines.map((line, index) => (
          <LineEditor key={line.key} index={index} line={line} warehouseId={header.warehouseId} locations={warehouse?.locations ?? []} items={inv.data?.items ?? []} options={options}
            onChange={(change) => setLine(line.key, change)} onRemove={lines.length > 1 ? () => setLines((current) => current.filter((entry) => entry.key !== line.key)) : undefined} />
        ))}
        <div><Button variant="secondary" size="compact" onPress={() => setLines((current) => [...current, blank()])}><Plus className="size-4" aria-hidden="true" />Add line</Button></div>
      </FormSection>
    </RecordFormPage>
  );
}

type Item = NonNullable<ReturnType<typeof useInvOptions>["data"]>["items"][number];

function LineEditor({ index, line, warehouseId, locations, items, options, onChange, onRemove }: {
  index: number; line: Line; warehouseId: string; locations: AdjustmentOptions["warehouses"][number]["locations"]; items: Item[]; options: AdjustmentOptions;
  onChange: (change: Partial<Line>) => void; onRemove?: () => void;
}) {
  const workspace = useWorkspaceContext();
  const item = items.find((entry) => entry.id === line.itemId);
  const stock = useQuery({ queryKey: scopedQueryKey(workspace, "adjustments", "stock", warehouseId, line.itemId), queryFn: () => getStock(warehouseId, line.itemId),
    enabled: Boolean(warehouseId && line.itemId) });
  const main = locations.find((entry) => entry.isMain);
  const chosen = line.locationId || main?.id || "";
  const ledgerId = chosen && chosen !== main?.id ? chosen : null;
  const here = (stock.data?.positions ?? []).filter((position) => (position.locationId ?? null) === ledgerId);
  const unit = item?.units?.find((entry) => entry.uomId === (line.uomId || item.uom_id));
  const factor = item?.tracking_type === "serial" ? 1 : Number(unit?.factor ?? 1);
  const system = here.filter((position) => !position.batchId).reduce((sum, position) => sum + position.onHand, 0);
  const serials = (stock.data?.serials ?? []).filter((serial) => (serial.locationId ?? null) === ledgerId);
  const foundCount = line.found.split(/[\s,;]+/).filter(Boolean).length;
  const difference = item?.tracking_type === "serial"
    ? foundCount - line.missing.filter((id) => serials.some((serial) => serial.id === id)).length
    : item?.tracking_type === "batch"
      ? line.lots.reduce((sum, lot) => {
        const value = num(lot.value);
        if (value === null) return sum;
        const systemLot = here.find((position) => position.batchId === lot.batchId)?.onHand ?? 0;
        return sum + (line.mode === "counted" ? value * factor - (lot.batchId ? systemLot : 0) : value * factor);
      }, 0)
      : line.mode === "counted" ? (num(line.value) === null ? 0 : num(line.value)! * factor - system) : (num(line.value) ?? 0) * factor;
  const dispositionOf = (id: string) => locations.find((entry) => entry.id === id)?.disposition ?? "available";
  const costs = options.valuationSources.filter((entry) => entry.id === "current_valuation_cost" || (entry.id === "manual_authorized_cost" ? options.capabilities.manualCost : options.capabilities.zeroCost));
  const lotRows = item?.tracking_type === "batch" ? here.filter((position) => position.batchId) : [];
  const lotValue = (batchId: string) => line.lots.find((lot) => lot.batchId === batchId)?.value ?? "";
  const setLot = (batchId: string, value: string) => onChange({ lots: [...line.lots.filter((lot) => lot.batchId !== batchId), ...(value !== "" ? [{ key: batchId, batchId, newBatchNumber: "", newExpiresOn: "", value }] : [])] });
  const newLots = line.lots.filter((lot) => !lot.batchId);
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-border p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
        <ComboBox className="sm:col-span-2" label={`Line ${index + 1} · Item`} selectedKey={line.itemId || null} placeholder="Search SKU or name"
          options={items.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))}
          onSelectionChange={(key) => onChange({ itemId: key ? String(key) : "", uomId: "", lots: [], missing: [], found: "", value: "" })} />
        <Select label="Location" selectedKey={chosen || null} onSelectionChange={(key) => onChange({ locationId: String(key), disposition: dispositionOf(String(key)), lots: [], missing: [] })}
          options={locations.map((entry) => ({ value: entry.id, label: `${entry.code}${entry.disposition !== "available" ? ` (${DISPOSITION_LABEL[entry.disposition].toLowerCase()})` : ""}` }))} />
        <Select label="Stock" selectedKey={line.disposition} onSelectionChange={(key) => onChange({ disposition: String(key) as Disposition })}
          options={options.dispositions.filter((entry) => entry.id === "available" || options.capabilities.restricted).map((entry) => ({ value: entry.id, label: entry.label }))}
          description="The disposition where the discrepancy is; an adjustment never changes it." />
        <Select label="Entry" selectedKey={line.mode} onSelectionChange={(key) => onChange({ mode: String(key) as EntryMode, value: "", lots: [], missing: [], found: "" })}
          options={[{ value: "counted", label: "Counted quantity" }, { value: "difference", label: "Adjustment difference" }]} />
        {item?.tracking_type !== "serial" && (item?.units && item.units.length > 1
          ? <Select label="Unit" selectedKey={line.uomId || item.uom_id || null} onSelectionChange={(key) => onChange({ uomId: String(key) })}
              options={item.units.map((entry) => ({ value: entry.uomId, label: `${entry.code}${Number(entry.factor) !== 1 ? ` (= ${Number(entry.factor)} ${item.base_uom ?? ""})` : ""}` }))} />
          : <TextField label="Unit" value={item?.base_uom ?? ""} isReadOnly />)}
      </div>
      {line.itemId && item?.tracking_type !== "batch" && item?.tracking_type !== "serial" && (
        <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-4">
          <TextField label={`System quantity (${item?.base_uom ?? "base"})`} value={stock.isLoading ? "…" : quantity(system)} isReadOnly />
          {line.mode === "counted"
            ? <TextField label={`Counted (${unit?.code ?? item?.base_uom ?? ""})`} inputMode="decimal" value={line.value} onChange={(value) => onChange({ value })} />
            : <TextField label={`Difference (${unit?.code ?? item?.base_uom ?? ""}, + or −)`} inputMode="decimal" value={line.value} onChange={(value) => onChange({ value })} placeholder="-3 or +5" />}
          <TextField label={`Difference (${item?.base_uom ?? "base"})`} value={signed(difference)} isReadOnly />
          <TextField label="Result" value={quantity(system + difference)} isReadOnly />
        </div>
      )}
      {item?.tracking_type === "batch" && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium">Batches at {locations.find((entry) => entry.id === chosen)?.code ?? "MAIN"} — {line.mode === "counted" ? "enter what was counted of each batch" : "enter each batch's difference"} ({unit?.code ?? item.base_uom}).</p>
          {lotRows.map((position) => (
            <div key={position.batchId} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-5">
              <span className="text-sm sm:col-span-2">{position.batch}{position.expiresOn ? ` · expires ${position.expiresOn}` : ""} · system {quantity(position.onHand)}{position.reserved ? ` (${quantity(position.reserved)} reserved)` : ""}</span>
              <TextField aria-label={`${line.mode === "counted" ? "Counted" : "Difference"} for ${position.batch}`} inputMode="decimal" value={lotValue(position.batchId!)} onChange={(value) => setLot(position.batchId!, value)}
                placeholder={line.mode === "counted" ? "Counted" : "-3 or +5"} />
            </div>
          ))}
          {!lotRows.length && <p className="text-xs text-text-muted">No batch of this item is recorded at this location.</p>}
          {newLots.map((lot) => (
            <div key={lot.key} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-5">
              <TextField label="New lot found" value={lot.newBatchNumber} onChange={(value) => onChange({ lots: line.lots.map((entry) => (entry.key === lot.key ? { ...entry, newBatchNumber: value } : entry)) })} />
              <TextField label="Expires" type="date" value={lot.newExpiresOn} onChange={(value) => onChange({ lots: line.lots.map((entry) => (entry.key === lot.key ? { ...entry, newExpiresOn: value } : entry)) })} />
              <TextField label="Quantity found" inputMode="decimal" value={lot.value} onChange={(value) => onChange({ lots: line.lots.map((entry) => (entry.key === lot.key ? { ...entry, value } : entry)) })} />
              <Button variant="ghost" size="compact" onPress={() => onChange({ lots: line.lots.filter((entry) => entry.key !== lot.key) })}>Remove</Button>
            </div>
          ))}
          <div className="flex items-center gap-3"><Button variant="ghost" size="compact" onPress={() => onChange({ lots: [...line.lots, { key: crypto.randomUUID(), batchId: "", newBatchNumber: "", newExpiresOn: "", value: "" }] })}>
            Add a new lot found</Button><span className="text-xs text-text-muted">Only for a genuinely new lot; an existing batch is chosen above. Difference on this line: {signed(difference)} {item.base_uom ?? ""}</span></div>
        </div>
      )}
      {item?.tracking_type === "serial" && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium">Serial numbers recorded here ({serials.length}): tick the ones not physically found — they are adjusted out as missing.</p>
          <div className="flex flex-wrap gap-3">
            {serials.map((serial) => (
              <Checkbox key={serial.id} isSelected={line.missing.includes(serial.id)}
                onChange={(selected) => onChange({ missing: selected ? [...line.missing, serial.id] : line.missing.filter((id) => id !== serial.id) })}>
                {serial.serialNumber}{serial.reserved ? " (reserved)" : ""} missing
              </Checkbox>
            ))}
            {!serials.length && <p className="text-xs text-text-muted">No serial number of this item is recorded here.</p>}
          </div>
          <TextField label="Serial numbers found (not recorded here)" value={line.found} onChange={(value) => onChange({ found: value })} placeholder="SN-0101, SN-0102"
            description={`Each a new serial number, or one adjusted out as missing earlier. Difference on this line: ${signed(difference)}.`} />
          {serials.some((serial) => serial.reserved && line.missing.includes(serial.id)) &&
            <p className="text-xs text-warning">A reserved serial number is marked missing: posting asks how its reservation is resolved.</p>}
        </div>
      )}
      {difference > 0 && (
        <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-4">
          <Select label="Cost of stock found" selectedKey={line.valuationSource} onSelectionChange={(key) => onChange({ valuationSource: String(key) as ValuationSource })}
            options={costs.map((entry) => ({ value: entry.id, label: entry.label }))} />
          {line.valuationSource === "manual_authorized_cost" && <TextField label={`Unit cost (per ${item?.base_uom ?? "base unit"})`} inputMode="decimal" value={line.unitCost} onChange={(value) => onChange({ unitCost: value })} />}
          {line.valuationSource !== "current_valuation_cost" && <TextField className="sm:col-span-2" label="Where the cost comes from" isRequired value={line.costNote} onChange={(value) => onChange({ costNote: value })} />}
        </div>
      )}
      <div className="flex items-end gap-2">
        <TextField className="flex-1" label="Line notes" value={line.notes} onChange={(value) => onChange({ notes: value })} />
        {onRemove && <Button variant="ghost" size="compact" aria-label={`Remove line ${index + 1}`} onPress={onRemove}><Trash2 className="size-4" aria-hidden="true" /></Button>}
      </div>
      <ErrorBanner message={stock.isError ? errorMessage(stock.error) : null} />
    </div>
  );
}

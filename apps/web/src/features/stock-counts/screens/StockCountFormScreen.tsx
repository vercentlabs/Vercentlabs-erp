"use client";

// Create or edit a draft Stock Count: one warehouse, and what it covers — the whole warehouse, some locations, or some items (optionally in some
// locations); blind counting (on by default), a recount threshold, a reference and instructions. A draft freezes and captures nothing: Preview
// shows what starting it will cover and freeze, and Start does it.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button, Checkbox, ComboBox, ErrorState, RecordFormPage, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { useInvOptions } from "@/features/inventory/shared/client";
import { ErrorBanner } from "@/features/items/item-format";
import { FormSection } from "@/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { STOCK_COUNTS_BASE, createCount, errorMessage, getCount, getCountOptions, updateCount, type CountDetail, type CountOptions, type CountType } from "../api/stock-counts-api";

export type CountPrefill = { itemId?: string; warehouseId?: string; locationId?: string; batchId?: string; serialId?: string };
export function StockCountFormScreen({ countId, prefill }: { countId?: string; prefill?: CountPrefill }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "stock-counts", "options"), queryFn: getCountOptions, staleTime: 60_000 });
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "stock-counts", "detail", countId), queryFn: () => getCount(countId!), enabled: Boolean(countId) });
  if (options.isLoading || existing.isLoading) return <LoadingState label="Loading stock count" rows={4} />;
  if (!options.data || (countId && !existing.data)) return <ErrorState title="Could not load the stock count" description={errorMessage(options.error ?? existing.error)} />;
  if (existing.data && existing.data.count.status !== "draft") return <ErrorState title="This count has started" description="Only a draft's scope is changed. A started count is counted, completed or cancelled." />;
  return <Form options={options.data} existing={existing.data ?? null} prefill={prefill} />;
}

function Form({ options, existing, prefill }: { options: CountOptions; existing: CountDetail | null; prefill?: CountPrefill }) {
  const router = useRouter();
  const inv = useInvOptions();
  const saved = existing?.count;
  const [warehouseId, setWarehouseId] = useState(saved?.warehouseId ?? (prefill?.warehouseId && options.warehouses.some((entry) => entry.id === prefill.warehouseId) ? prefill.warehouseId : undefined)
    ?? options.warehouses.find((entry) => entry.isDefault)?.id ?? options.warehouses[0]?.id ?? "");
  // From an item, a count of that item.
  const [countType, setCountType] = useState<CountType>(saved?.countType ?? (prefill?.itemId ? "items" : "full_warehouse"));
  const [locationIds, setLocationIds] = useState<string[]>(() => [...new Set((existing?.scope ?? []).filter((entry) => entry.locationScoped).map((entry) => entry.locationId ?? mainOf(options, saved?.warehouseId) ?? ""))].filter(Boolean));
  const [itemIds, setItemIds] = useState<string[]>(() => existing ? [...new Set((existing.scope ?? []).map((entry) => entry.itemId).filter((id): id is string => Boolean(id)))]
    : prefill?.itemId ? [prefill.itemId] : []);
  const [blind, setBlind] = useState(saved?.blindCount ?? true);
  const [threshold, setThreshold] = useState(saved?.recountThresholdPercent === null || saved?.recountThresholdPercent === undefined ? "" : String(saved.recountThresholdPercent));
  const [reference, setReference] = useState(saved?.reference ?? "");
  const [instructions, setInstructions] = useState(saved?.instructions ?? "");
  const warehouse = options.warehouses.find((entry) => entry.id === warehouseId);
  const items = inv.data?.items ?? [];
  const save = useMutation({
    mutationFn: () => {
      const input = { warehouseId, countType, locationIds: countType === "full_warehouse" ? [] : locationIds, itemIds: countType === "items" ? itemIds : [], blindCount: blind,
        recountThresholdPercent: threshold.trim() === "" ? null : threshold.trim(), reference: reference || null, instructions: instructions || null };
      return existing ? updateCount(existing.count.id, { ...input, expectedVersion: existing.count.version }) : createCount(input);
    },
    onSuccess: (detail) => router.push(`${STOCK_COUNTS_BASE}/${detail.count.id}`),
  });
  return (
    <RecordFormPage
      header={{
        title: saved ? `Edit ${saved.number}` : "New stock count",
        description: "Saving keeps a draft: nothing is frozen or captured. On the next page, preview the scope and start the count — that captures the system stock and freezes the scope.",
      }}
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.push(saved ? `${STOCK_COUNTS_BASE}/${saved.id}` : STOCK_COUNTS_BASE)}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save draft</Button>
        </>
      }
      banner={<ErrorBanner message={save.isError ? errorMessage(save.error) : null} />}
    >
      <FormSection title="Stock count" columns={1}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select label="Warehouse" isRequired selectedKey={warehouseId || null} onSelectionChange={(key) => { setWarehouseId(String(key)); setLocationIds([]); }}
            options={options.warehouses.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))} description="One warehouse per count." />
          <Select label="Count scope" isRequired selectedKey={countType} onSelectionChange={(key) => setCountType(String(key) as CountType)}
            options={options.countTypes.map((entry) => ({ value: entry.id, label: entry.label }))} />
          <TextField label="Recount threshold (%)" inputMode="decimal" value={threshold} onChange={setThreshold} description="A first count off by more than this needs a recount. Empty: none." />
          <TextField label="Reference" value={reference} onChange={setReference} placeholder="YEAR-END-2026" />
        </div>
        <Checkbox isSelected={blind} onChange={setBlind}>Blind count — counters do not see the system quantity, variance or value</Checkbox>
        {countType !== "full_warehouse" && warehouse && (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{countType === "locations" ? "Locations to count" : "Only in these locations (optional — empty means the whole warehouse)"}</span>
            <div className="flex flex-wrap gap-3">
              {warehouse.locations.map((location) => (
                <Checkbox key={location.id} isSelected={locationIds.includes(location.id)}
                  onChange={(selected) => setLocationIds((current) => (selected ? [...current, location.id] : current.filter((id) => id !== location.id)))}>{location.code}</Checkbox>
              ))}
            </div>
          </div>
        )}
        {countType === "items" && (
          <div className="flex flex-col gap-2">
            <ComboBox label="Add an item" selectedKey={null} placeholder="Search SKU or name" options={items.filter((entry) => !itemIds.includes(entry.id)).map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))}
              onSelectionChange={(key) => { if (key) setItemIds((current) => [...current, String(key)]); }} />
            <div className="flex flex-wrap gap-2">
              {itemIds.map((id) => {
                const item = items.find((entry) => entry.id === id);
                return <span key={id} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-sm">{item ? `${item.code} · ${item.name}` : id}
                  <button type="button" aria-label="Remove" onClick={() => setItemIds((current) => current.filter((entry) => entry !== id))}><X className="size-3" aria-hidden="true" /></button></span>;
              })}
              {!itemIds.length && <span className="text-sm text-text-muted">No items chosen yet.</span>}
            </div>
          </div>
        )}
        <TextArea label="Instructions for counters" value={instructions} onChange={setInstructions} />
      </FormSection>
    </RecordFormPage>
  );
}

const mainOf = (options: CountOptions, warehouseId?: string) => options.warehouses.find((entry) => entry.id === warehouseId)?.locations.find((location) => location.isMain)?.id ?? null;

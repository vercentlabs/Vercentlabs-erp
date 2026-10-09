"use client";

// Create or edit a draft transfer: between two warehouses (direct, or through Goods in Transit) or between locations of one warehouse, with lines —
// an item from a source location to a destination location, in any of its units, with the batches or serial numbers that move. What is available
// is shown as you go; a draft reserves and moves nothing. Confirming (warehouse) reserves the source stock; a location transfer completes at once.
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
  DISPOSITION_LABEL, TRANSFERS_BASE, completeTransfer, confirmTransfer, createTransfer, errorMessage, errorsOf, getAvailability, getTransfer, getTransferOptions, updateTransfer,
  type Disposition, type LineInput, type TransferDetail, type TransferLocation, type TransferMode, type TransferOptions, type TransferType,
} from "../api/transfers-api";

type Line = {
  key: string; itemId: string; quantity: string; uomId: string; sourceLocationId: string; destinationLocationId: string; disposition: Disposition;
  batches: Array<{ batchId: string; quantity: string }>; serialIds: string[]; notes: string;
};
const blank = (): Line => ({ key: crypto.randomUUID(), itemId: "", quantity: "", uomId: "", sourceLocationId: "", destinationLocationId: "", disposition: "available", batches: [], serialIds: [], notes: "" });
const DISPOSITIONS: Disposition[] = ["available", "quality_hold", "quarantined", "damaged", "expired"];

export type TransferPrefill = { itemId?: string; warehouseId?: string; locationId?: string; batchId?: string; serialId?: string };
export function TransferFormScreen({ transferId, prefill }: { transferId?: string; prefill?: TransferPrefill }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "transfers", "options"), queryFn: getTransferOptions, staleTime: 60_000 });
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "transfers", "detail", transferId), queryFn: () => getTransfer(transferId!), enabled: Boolean(transferId) });
  if (options.isLoading || existing.isLoading) return <LoadingState label="Loading transfer" rows={4} />;
  if (!options.data || (transferId && !existing.data)) return <ErrorState title="Could not load the transfer" description={errorMessage(options.error ?? existing.error)} />;
  if (existing.data && existing.data.transfer.status !== "draft")
    return <ErrorState title="This transfer cannot be edited" description="Only a draft is edited. Move a confirmed transfer back to draft first; a dispatched or completed one is received, written off or reversed." />;
  return <Form options={options.data} existing={existing.data ?? null} prefill={prefill} />;
}

function Form({ options, existing, prefill }: { options: TransferOptions; existing: TransferDetail | null; prefill?: TransferPrefill }) {
  const router = useRouter();
  const inv = useInvOptions();
  const saved = existing?.transfer;
  const mine = options.warehouses.filter((entry) => entry.mine);
  const [header, setHeader] = useState({
    type: (saved?.type ?? "warehouse") as TransferType, mode: (saved?.mode ?? "in_transit") as TransferMode,
    sourceWarehouseId: saved?.sourceWarehouseId ?? (prefill?.warehouseId && mine.some((entry) => entry.id === prefill.warehouseId) ? prefill.warehouseId : undefined) ?? mine.find((entry) => entry.isDefault)?.id ?? mine[0]?.id ?? "",
    destinationWarehouseId: saved?.type === "warehouse" ? saved.destinationWarehouseId : "",
    transferDate: saved?.transferDate ?? "", expectedArrivalDate: saved?.expectedArrivalDate ?? "", reasonCode: saved?.reasonCode ?? "", reference: saved?.reference ?? "",
    carrier: saved?.carrier ?? "", vehicleNumber: saved?.vehicleNumber ?? "", transportReference: saved?.transportReference ?? "", notes: saved?.notes ?? "",
  });
  const [lines, setLines] = useState<Line[]>(() => existing?.lines.length ? existing.lines.map((line) => ({
    key: line.id, itemId: line.itemId, quantity: String(line.quantity), uomId: line.uomId, sourceLocationId: line.sourceLocationId ?? "", destinationLocationId: line.destinationLocationId ?? "",
    disposition: line.disposition, batches: line.batches.map((batch) => ({ batchId: batch.batchId, quantity: String(batch.quantity) })), serialIds: line.serials.map((serial) => serial.id),
    notes: line.notes ?? "",
  })) : [{ ...blank(), itemId: prefill?.itemId ?? "", sourceLocationId: prefill?.locationId ?? "", serialIds: prefill?.serialId ? [prefill.serialId] : [],
    batches: prefill?.batchId ? [{ batchId: prefill.batchId, quantity: "" }] as Line["batches"] : [] }]);
  const set = (key: keyof typeof header) => (value: string) => setHeader((current) => ({ ...current, [key]: value }));
  const setLine = (key: string, change: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...change } : line)));
  const isLocation = header.type === "location";
  const destinationId = isLocation ? header.sourceWarehouseId : header.destinationWarehouseId;
  const source = options.warehouses.find((entry) => entry.id === header.sourceWarehouseId);
  const destination = options.warehouses.find((entry) => entry.id === destinationId);
  const payload = useMemo(() => ({
    sourceWarehouseId: header.sourceWarehouseId, destinationWarehouseId: destinationId, transferMode: isLocation ? "direct" as const : header.mode,
    transferDate: header.transferDate || undefined, expectedArrivalDate: header.expectedArrivalDate || null, reasonCode: header.reasonCode || null, reference: header.reference || null,
    carrier: header.carrier || null, vehicleNumber: header.vehicleNumber || null, transportReference: header.transportReference || null, notes: header.notes || null,
    lines: lines.filter((line) => line.itemId).map((line): LineInput => {
      const item = inv.data?.items.find((entry) => entry.id === line.itemId);
      return { itemId: line.itemId, quantity: line.quantity, uomId: line.uomId || undefined, sourceLocationId: line.sourceLocationId || null, destinationLocationId: line.destinationLocationId || null,
        disposition: line.disposition, ...(item?.tracking_type === "batch" ? { batches: line.batches.filter((batch) => batch.batchId && batch.quantity) } : {}),
        ...(item?.tracking_type === "serial" ? { serialIds: line.serialIds } : {}), notes: line.notes || null };
    }),
  }), [header, lines, inv.data, destinationId, isLocation]);
  // The next step after saving: confirm (reserve) a warehouse transfer, or complete a location transfer at once.
  const next = isLocation ? (options.capabilities.dispatch ? "complete" : null) : (options.capabilities.confirm ? "confirm" : null);
  const save = useMutation({
    mutationFn: async (advance: boolean) => {
      const detail = existing ? await updateTransfer(existing.transfer.id, { ...payload, expectedVersion: existing.transfer.version }) : await createTransfer(payload);
      if (!advance) return detail;
      return (next === "complete" ? completeTransfer : confirmTransfer)(detail.transfer.id).catch((error) => { throw Object.assign(error, { savedId: detail.transfer.id }); });
    },
    onSuccess: (detail) => router.push(`${TRANSFERS_BASE}/${detail.transfer.id}`),
    onError: (error: Error & { savedId?: string }) => { if (error.savedId && !existing) router.replace(`${TRANSFERS_BASE}/${error.savedId}/edit`); },
  });
  const errors = errorsOf(save.error);
  const clearPositions = () => setLines((current) => current.map((line) => ({ ...line, sourceLocationId: "", destinationLocationId: "", batches: [], serialIds: [] })));

  const transport = !isLocation && header.mode === "in_transit";
  return (
    <RecordFormPage
      header={{
        title: saved ? `Edit ${saved.number}` : "New transfer",
        description: "Saving keeps a draft: nothing is reserved or moved. Confirming reserves the source stock; dispatching moves it into Goods in Transit, still yours; receiving puts it at the destination.",
      }}
      banner={save.error ? (
        <Notice>{errorMessage(save.error)}{errors.length > 1 && <ul className="mt-1 list-disc pl-5">{errors.map((entry) => <li key={entry.message}>{entry.message}</li>)}</ul>}
          {(save.error as Error & { savedId?: string }).savedId && <p className="mt-1">The draft was saved; fix the above and try again.</p>}</Notice>
      ) : undefined}
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.push(saved ? `${TRANSFERS_BASE}/${saved.id}` : TRANSFERS_BASE)}>Cancel</Button>
          <Button variant={next ? "secondary" : "primary"} isLoading={save.isPending && save.variables === false} onPress={() => save.mutate(false)}>Save draft</Button>
          {next && <Button variant="primary" isLoading={save.isPending && save.variables === true} onPress={() => save.mutate(true)}>{next === "complete" ? "Save and complete" : "Save and confirm"}</Button>}
        </>
      }
    >
      <FormSection title="Transfer">
        <Select label="Transfer" isRequired selectedKey={header.type} onSelectionChange={(key) => { setHeader((current) => ({ ...current, type: String(key) as TransferType })); clearPositions(); }}
          options={[{ value: "warehouse", label: "Between warehouses" }, { value: "location", label: "Between locations of one warehouse" }]} />
        {!isLocation ? <Select label="Mode" isRequired selectedKey={header.mode} onSelectionChange={(key) => set("mode")(String(key))}
          options={[{ value: "in_transit", label: "In transit (dispatch, then receive)" }, { value: "direct", label: "Direct (moves at once)" }]}
          description={header.mode === "direct" ? "For warehouses next to each other: out and in in one posting." : "Goods travel through Goods in Transit and are received at the destination."} /> : <span />}
        <Select label={isLocation ? "Warehouse" : "From warehouse"} isRequired selectedKey={header.sourceWarehouseId || null}
          onSelectionChange={(key) => { set("sourceWarehouseId")(String(key)); clearPositions(); }}
          options={mine.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}${!isLocation && !entry.transferEnabled ? " (transfers off)" : ""}` }))} />
        {!isLocation && <Select label="To warehouse" isRequired selectedKey={header.destinationWarehouseId || null}
          onSelectionChange={(key) => { set("destinationWarehouseId")(String(key)); setLines((current) => current.map((line) => ({ ...line, destinationLocationId: "" }))); }}
          options={options.warehouses.filter((entry) => entry.id !== header.sourceWarehouseId).map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}${!entry.transferEnabled ? " (transfers off)" : ""}` }))} />}
        <TextField label="Transfer date" type="date" value={header.transferDate} onChange={set("transferDate")} description="Today if empty." />
        {transport && <TextField label="Expected arrival" type="date" value={header.expectedArrivalDate} onChange={set("expectedArrivalDate")} />}
        <Select label="Reason" selectedKey={header.reasonCode || "none"} onSelectionChange={(key) => set("reasonCode")(key === "none" ? "" : String(key))}
          options={[{ value: "none", label: "Not specified" }, ...options.reasons.map((entry) => ({ value: entry.id, label: entry.label }))]} />
        <TextField label="Reference" value={header.reference} onChange={set("reference")} placeholder="Request or ticket number" />
        <TextArea label="Notes" className="sm:col-span-2" value={header.notes} onChange={set("notes")} />
      </FormSection>
      {transport && (
        <FormSection title="Transport" description="Optional. Kept with the transfer and its dispatch.">
          <TextField label="Carrier" value={header.carrier} onChange={set("carrier")} />
          <TextField label="Vehicle number" value={header.vehicleNumber} onChange={set("vehicleNumber")} placeholder="MH12 AB 1234" />
          <TextField label="Transport document" value={header.transportReference} onChange={set("transportReference")} placeholder="LR, e-way bill or docket number" />
        </FormSection>
      )}
      <FormSection title="Items" description="What moves, from which location to which, in any of the item's units." columns={1}>
        {lines.map((line, index) => (
          <LineEditor key={line.key} index={index} line={line} warehouseId={header.sourceWarehouseId} sourceLocations={source?.locations ?? []} destinationLocations={destination?.locations ?? []}
            isLocation={isLocation} items={inv.data?.items ?? []} restricted={options.capabilities.restricted} onChange={(change) => setLine(line.key, change)}
            onRemove={lines.length > 1 ? () => setLines((current) => current.filter((entry) => entry.key !== line.key)) : undefined} />
        ))}
        <div><Button variant="secondary" size="compact" onPress={() => setLines((current) => [...current, blank()])}><Plus className="size-4" aria-hidden="true" />Add item</Button></div>
      </FormSection>
    </RecordFormPage>
  );
}

type Item = NonNullable<ReturnType<typeof useInvOptions>["data"]>["items"][number];

function LineEditor({ index, line, warehouseId, sourceLocations, destinationLocations, isLocation, items, restricted, onChange, onRemove }: {
  index: number; line: Line; warehouseId: string; sourceLocations: TransferLocation[]; destinationLocations: TransferLocation[]; isLocation: boolean; items: Item[]; restricted: boolean;
  onChange: (change: Partial<Line>) => void; onRemove?: () => void;
}) {
  const workspace = useWorkspaceContext();
  const item = items.find((entry) => entry.id === line.itemId);
  const stock = useQuery({ queryKey: scopedQueryKey(workspace, "transfers", "availability", warehouseId, line.itemId), queryFn: () => getAvailability(warehouseId, line.itemId),
    enabled: Boolean(warehouseId && line.itemId) });
  const main = sourceLocations.find((entry) => entry.isMain);
  const locationId = line.sourceLocationId || null;
  const here = (value: string | null) => (value ?? null) === (locationId && locationId !== main?.id ? locationId : null);
  const atLocation = (stock.data?.positions ?? []).filter((position) => here(position.locationId));
  const unit = item?.units?.find((entry) => entry.uomId === (line.uomId || item.uom_id));
  const base = Number(line.quantity || 0) * Number(unit?.factor ?? 1);
  const free = atLocation.filter((position) => position.disposition === line.disposition).reduce((sum, position) => sum + position.available, 0);
  const serials = (stock.data?.serials ?? []).filter((serial) => here(serial.locationId));
  const destinationDefault = isLocation ? null : destinationLocations.find((entry) => entry.isReceiving) ?? destinationLocations.find((entry) => entry.isMain);
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
        <ComboBox className="sm:col-span-2" label={`Line ${index + 1} · Item`} selectedKey={line.itemId || null} placeholder="Search SKU or name"
          options={items.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))}
          onSelectionChange={(key) => onChange({ itemId: key ? String(key) : "", uomId: "", batches: [], serialIds: [] })} />
        <TextField label="Quantity" inputMode="decimal" value={line.quantity} onChange={(value) => onChange({ quantity: value })} />
        {item?.units && item.units.length > 1
          ? <Select label="Unit" selectedKey={line.uomId || item.uom_id || null} onSelectionChange={(key) => onChange({ uomId: String(key) })}
              options={item.units.map((entry) => ({ value: entry.uomId, label: `${entry.code}${Number(entry.factor) !== 1 ? ` (= ${Number(entry.factor)} ${item.base_uom ?? ""})` : ""}` }))} />
          : <TextField label="Unit" value={item?.base_uom ?? ""} isReadOnly />}
        <Select label="Stock" selectedKey={line.disposition} onSelectionChange={(key) => onChange({ disposition: String(key) as Disposition })}
          options={(restricted ? DISPOSITIONS : ["available" as Disposition]).map((entry) => ({ value: entry, label: DISPOSITION_LABEL[entry] }))}
          description={restricted ? "It arrives as it left: a transfer never changes disposition." : undefined} />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
        <Select className="sm:col-span-2" label="From location" selectedKey={line.sourceLocationId || main?.id || null} onSelectionChange={(key) => onChange({ sourceLocationId: String(key), batches: [], serialIds: [] })}
          options={sourceLocations.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))} />
        <Select className="sm:col-span-2" label="To location" selectedKey={line.destinationLocationId || (isLocation ? null : destinationDefault?.id ?? null)}
          onSelectionChange={(key) => onChange({ destinationLocationId: String(key) })} isRequired={isLocation}
          options={destinationLocations.filter((entry) => !isLocation || entry.id !== (line.sourceLocationId || main?.id)).map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))}
          description={isLocation ? "A different location of the same warehouse, holding the same kind of stock." : "Where the goods are put away (the receiving area if not chosen)."} />
      </div>
      {line.itemId && (
        <p className="text-xs text-text-muted">
          {stock.isLoading ? "Checking stock…" : stock.data ? <>At the source: on hand {quantity(stock.data.totals.onHand, item?.base_uom)} · reserved {quantity(stock.data.totals.reserved)} ·
            {" "}<span className="font-medium text-text">available {quantity(stock.data.totals.available)}</span>. At this location ({DISPOSITION_LABEL[line.disposition].toLowerCase()}): {quantity(free)}
            {base > 0 && unit && Number(unit.factor) !== 1 ? ` · this line is ${quantity(base)} ${item?.base_uom ?? ""}` : ""}
            {base > free ? <span className="text-warning"> · more than is available now; confirming will refuse it</span> : ""}</> : null}
        </p>
      )}
      {item?.tracking_type === "batch" && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium">Batches (base units; they must add up to {quantity(base)} {item.base_uom ?? ""}). The same batch arrives at the destination.</p>
          {atLocation.filter((position) => position.batchId).map((position) => {
            const entry = line.batches.find((batch) => batch.batchId === position.batchId);
            return (
              <div key={position.batchId} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-5">
                <span className="text-sm sm:col-span-2">{position.batch}{position.expiresOn ? ` · expires ${position.expiresOn}` : ""} · {DISPOSITION_LABEL[position.disposition] ?? position.disposition} · available {quantity(position.available)}</span>
                <TextField aria-label={`Quantity from ${position.batch}`} inputMode="decimal" value={entry?.quantity ?? ""}
                  onChange={(value) => onChange({ batches: [...line.batches.filter((batch) => batch.batchId !== position.batchId), ...(value ? [{ batchId: position.batchId!, quantity: value }] : [])] })} />
              </div>
            );
          })}
          {!atLocation.some((position) => position.batchId) && <p className="text-xs text-text-muted">No batch of this item is at this location.</p>}
        </div>
      )}
      {item?.tracking_type === "serial" && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium">Serial numbers (one per unit: {line.serialIds.length} of {quantity(base)} chosen). The same serial records move; none is created.</p>
          <div className="flex flex-wrap gap-3">
            {serials.map((serial) => (
              <Checkbox key={serial.id} isDisabled={serial.reserved && !line.serialIds.includes(serial.id)} isSelected={line.serialIds.includes(serial.id)}
                onChange={(selected) => onChange({ serialIds: selected ? [...line.serialIds, serial.id] : line.serialIds.filter((id) => id !== serial.id) })}>
                {serial.serialNumber}{serial.reserved ? " (reserved)" : ""}
              </Checkbox>
            ))}
            {!serials.length && <p className="text-xs text-text-muted">No serial number of this item is in stock here.</p>}
          </div>
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

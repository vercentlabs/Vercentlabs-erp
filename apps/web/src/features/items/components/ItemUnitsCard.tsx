"use client";

// An item's units: the base unit Inventory counts in, the default purchase and sales units, and every alternate unit with its fixed
// conversion to the base, what it may be used for (purchasing, sales, inventory entry) and its precision. Adding or changing a unit shows
// what a quantity becomes in the base unit before saving. A changed conversion only affects documents entered afterwards: documents keep
// the conversion they were entered with and stock is never recounted, so on an item already in use the change must be confirmed.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Checkbox, Dialog, NumberField, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  addItemUnit, convertItemUnits, deactivateItemUnit, errorCode, errorMessage, fieldErrors, getItemUnits, getItemUomHistory, setItemDefaultUnits, updateItemUnit, type Item, type ItemOptions,
  type ItemUnit, type ItemUnits,
} from "../api/items-api";
import { ErrorBanner } from "../item-format";

type Draft = { uomId: string; factor: string; purchasing: boolean; sales: boolean; inventory: boolean; precision: number; reason: string };
const SOURCE_LABEL = { base: "Base unit", item: "This item's conversion", standard: "Standard conversion" } as const;
const HISTORY_LABEL: Record<string, string> = {
  base_set: "Base unit set", base_changed: "Base unit changed", unit_added: "Unit added", conversion_changed: "Conversion changed", usage_changed: "Usage changed",
  precision_changed: "Precision changed", purchase_default_changed: "Default purchase unit changed", sales_default_changed: "Default sales unit changed",
  unit_deactivated: "Unit deactivated", unit_reactivated: "Unit brought back",
};

// Exact decimal arithmetic for the preview: quantity × factor, both as decimal strings.
function multiply(quantity: string, factor: string) {
  const parse = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return { digits: BigInt(`${whole}${fraction}` || "0"), scale: fraction.length };
  };
  if (!/^\d+(\.\d+)?$/.test(quantity) || !/^\d+(\.\d+)?$/.test(factor)) return null;
  const left = parse(quantity); const right = parse(factor);
  const digits = (left.digits * right.digits).toString().padStart(left.scale + right.scale + 1, "0");
  const scale = left.scale + right.scale;
  const text = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}
function divide(quantity: string, factor: string) {
  if (!/^\d+(\.\d+)?$/.test(quantity) || !/^\d*\.?\d+$/.test(factor) || Number(factor) <= 0) return null;
  const value = Number(quantity) / Number(factor);
  return { text: value.toLocaleString("en-IN", { maximumFractionDigits: 6 }), exact: Number.isInteger(value * 1e6) && Math.abs(value * Number(factor) - Number(quantity)) < 1e-9 };
}
const flags = (unit: ItemUnit) => [unit.purchasing && "Purchasing", unit.sales && "Sales", unit.inventory && "Inventory"].filter(Boolean).join(" · ") || "Not used";

export function ItemUnitsCard({ item, options }: { item: Item; options?: ItemOptions }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = item.capabilities!;
  const key = scopedQueryKey(workspace, "products", "product", item.id, "units");
  const query = useQuery({ queryKey: key, queryFn: () => getItemUnits(item.id) });
  const [dialog, setDialog] = useState<{ mode: "add" } | { mode: "edit"; unit: ItemUnit } | { mode: "history" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { setError(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products", "product", item.id) }); };
  const defaults = useMutation({
    mutationFn: (input: { purchaseUomId?: string; salesUomId?: string }) => setItemDefaultUnits(item.id, input),
    onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)),
  });
  const deactivate = useMutation({
    mutationFn: (unit: ItemUnit) => deactivateItemUnit(item.id, unit.conversionId!),
    onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)),
  });
  const reactivate = useMutation({
    mutationFn: (unit: ItemUnit) => addItemUnit(item.id, { uomId: unit.uomId, factor: unit.factor, purchasingEnabled: unit.purchasing, salesEnabled: unit.sales, inventoryEnabled: unit.inventory }),
    onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)),
  });

  if (query.isLoading) return <LoadingState label="Loading units" rows={3} />;
  if (query.isError || !query.data) return <ErrorBanner message={errorMessage(query.error, "The units could not be loaded.")} />;
  const data = query.data;
  const base = data.item.baseUom;
  const units = data.units;
  const purchaseChoices = units.filter((unit) => unit.isActive && unit.purchasing).map((unit) => ({ value: unit.uomId, label: unit.isBase ? `${unit.code} (base)` : unit.text }));
  const salesChoices = units.filter((unit) => unit.isActive && unit.sales).map((unit) => ({ value: unit.uomId, label: unit.isBase ? `${unit.code} (base)` : unit.text }));

  return (
    <section aria-label="Units of measure" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">Units of measure</h3>
        <span className="flex gap-1">
          <Button size="compact" variant="ghost" onPress={() => setDialog({ mode: "history" })}>View history</Button>
          {can.manageUnits && <Button size="compact" variant="secondary" onPress={() => { setError(null); setDialog({ mode: "add" }); }}>Add unit</Button>}
        </span>
      </div>
      <ErrorBanner message={dialog ? null : error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-0.5"><span className="text-xs font-medium text-text-muted">Base unit</span>
          <span className="text-sm">{data.item.baseUomName} ({base}) · {data.item.baseDecimals} decimal place{data.item.baseDecimals === 1 ? "" : "s"}</span>
          <span className="text-xs text-text-muted">{data.used ? "Fixed: the item has transactions." : "Can change in Edit while the item is unused."}</span></div>
        <Select label="Default purchase unit" size="compact" selectedKey={data.item.purchaseUomId} options={purchaseChoices} isDisabled={!can.changeDefaultUoms || defaults.isPending}
          onSelectionChange={(value) => value !== data.item.purchaseUomId && defaults.mutate({ purchaseUomId: String(value) })} description="New purchase orders start with it." />
        <Select label="Default sales unit" size="compact" selectedKey={data.item.salesUomId} options={salesChoices} isDisabled={!can.changeDefaultUoms || defaults.isPending}
          onSelectionChange={(value) => value !== data.item.salesUomId && defaults.mutate({ salesUomId: String(value) })} description="New quotations and orders start with it." />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-text-secondary"><tr>{["Unit", "Conversion", "Used for", "Precision", "Status", ""].map((label) => <th key={label} className="py-1 pr-3 font-medium">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">
            {units.map((unit) => (
              <tr key={unit.uomId} className={unit.isActive ? "" : "text-text-muted"}>
                <td className="py-1.5 pr-3"><span className="font-medium">{unit.code}</span> <span className="text-text-muted">{unit.name}</span>
                  <span className="ml-1 inline-flex gap-1">{unit.isPurchaseDefault && <Badge tone="info">Purchase default</Badge>}{unit.isSalesDefault && <Badge tone="info">Sales default</Badge>}</span></td>
                <td className="py-1.5 pr-3 tabular-nums">{unit.isBase ? `1 ${unit.code}` : `= ${unit.factor} ${base}`}<span className="block text-xs text-text-muted">{SOURCE_LABEL[unit.source]}</span></td>
                <td className="py-1.5 pr-3">{flags(unit)}</td>
                <td className="py-1.5 pr-3 tabular-nums">{unit.decimals}</td>
                <td className="py-1.5 pr-3">{unit.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  {unit.source === "item" && can.manageUnits && (unit.isActive ? (
                    <>
                      <Button size="compact" variant="ghost" onPress={() => { setError(null); setDialog({ mode: "edit", unit }); }}>Edit</Button>
                      {!unit.isPurchaseDefault && !unit.isSalesDefault && <Button size="compact" variant="ghost" isLoading={deactivate.isPending && deactivate.variables?.uomId === unit.uomId}
                        onPress={() => deactivate.mutate(unit)}>Deactivate</Button>}
                    </>
                  ) : <Button size="compact" variant="ghost" isLoading={reactivate.isPending && reactivate.variables?.uomId === unit.uomId} onPress={() => reactivate.mutate(unit)}>Reactivate</Button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Converter itemId={item.id} units={units.filter((unit) => unit.isActive)} />
      <p className="text-xs text-text-muted">Inventory always counts in {base}: base quantity = quantity × conversion. Documents keep the unit and conversion they were entered with, so a changed or deactivated unit only affects new documents. Two packagings in use at once are two units (BOX20, BOX24), not one changed BOX.</p>
      <UnitDialog item={item} data={data} options={options} dialog={dialog} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh(); }} />
    </section>
  );
}

function UnitDialog({ item, data, options, dialog, onClose, onSaved }: {
  item: Item; data: ItemUnits; options?: ItemOptions; dialog: { mode: "add" } | { mode: "edit"; unit: ItemUnit } | { mode: "history" } | null; onClose: () => void; onSaved: () => void;
}) {
  return (
    <Dialog isOpen={dialog !== null} onOpenChange={(open) => !open && onClose()}
      title={dialog?.mode === "history" ? "Unit history" : dialog?.mode === "edit" ? `Edit ${dialog.unit.code}` : `Add a unit to ${item.name}`}>
      {dialog?.mode === "history" ? <HistoryList itemId={item.id} /> : dialog ? (
        <UnitForm key={dialog.mode === "edit" ? dialog.unit.uomId : "new"} item={item} data={data} options={options} editing={dialog.mode === "edit" ? dialog.unit : null} onClose={onClose} onSaved={onSaved} />
      ) : null}
    </Dialog>
  );
}

function UnitForm({ item, data, options, editing, onClose, onSaved }: {
  item: Item; data: ItemUnits; options?: ItemOptions; editing: ItemUnit | null; onClose: () => void; onSaved: () => void;
}) {
  const base = data.item.baseUom;
  const taken = new Set(data.units.filter((unit) => unit.isActive || unit.source === "item").map((unit) => unit.uomId));
  const [draft, setDraft] = useState<Draft>(() => editing
    ? { uomId: editing.uomId, factor: editing.factor, purchasing: editing.purchasing, sales: editing.sales, inventory: editing.inventory, precision: editing.decimals, reason: "" }
    : { uomId: "", factor: "", purchasing: true, sales: true, inventory: true, precision: Number.NaN, reason: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const set = <K extends keyof Draft>(key: K) => (value: Draft[K]) => { setDraft((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: "" })); setConfirming(false); };
  const unitChoices = (options?.uoms ?? []).filter((uom) => uom.id !== data.item.baseUomId && !taken.has(uom.id)).map((uom) => ({ value: uom.id, label: `${uom.name} (${uom.code})` }));
  const chosen = editing ? { code: editing.code, decimalPlaces: editing.decimals } : options?.uoms.find((uom) => uom.id === draft.uomId);
  const code = chosen?.code ?? "unit";
  const factor = draft.factor.replace(/,/g, "").trim();
  // What the factor means, worked out before saving: 1, 5 and 10 of the unit, and 100 base units in it.
  const preview = ["1", "5", "10"].map((count) => ({ count, base: multiply(count, factor) })).filter((entry) => entry.base !== null);
  const reverse = divide("100", factor);
  const factorChanged = editing ? factor !== editing.factor : false;
  const save = useMutation({
    mutationFn: () => {
      const input = {
        factor, purchasingEnabled: draft.purchasing, salesEnabled: draft.sales, inventoryEnabled: draft.inventory,
        quantityPrecision: Number.isFinite(draft.precision) ? draft.precision : null, reason: draft.reason.trim() || undefined,
      };
      return editing ? updateItemUnit(item.id, editing.conversionId!, { ...input, expectedVersion: editing.version, acknowledgeHistory: confirming })
        : addItemUnit(item.id, { ...input, uomId: draft.uomId });
    },
    onSuccess: onSaved,
    onError: (failure) => {
      if (errorCode(failure) === "PRODUCT_CONVERSION_CONFIRM") { setConfirming(true); setError(errorMessage(failure)); return; }
      setErrors(fieldErrors(failure)); setError(errorMessage(failure));
    },
  });
  return (
    <div className="flex flex-col gap-3">
      {error && <p role="alert" className={`rounded-[var(--radius-control)] border px-3 py-2 text-sm ${confirming ? "border-warning-emphasis/40 bg-warning-soft" : "border-danger-emphasis/30 bg-danger-soft text-danger"}`}>{error}</p>}
      <p className="text-sm"><span className="text-text-muted">Base unit: </span>{base}{data.item.serialTracked ? " · serial-numbered: whole units only" : ""}</p>
      {!editing && <Select label="Unit" isRequired selectedKey={draft.uomId || null} placeholder="Choose a unit" options={unitChoices} onSelectionChange={(value) => set("uomId")(String(value))} errorMessage={errors.uomId} />}
      <TextField label={`1 ${code} =`} isRequired value={draft.factor} onChange={set("factor")} errorMessage={errors.factor}
        description={`How many ${base} one ${code} holds, such as 20.`} />
      {editing && factorChanged && (
        <p role="status" className="rounded-[var(--radius-control)] border border-warning-emphasis/40 bg-warning-soft px-3 py-2 text-sm">
          Current: 1 {code} = {editing.factor} {base}. New: 1 {code} = {factor || "…"} {base}. This applies to future transactions only; posted documents keep their conversion and stock is not
          recounted. If both pack sizes are in use, add a separate unit (such as {code}{factor || "24"}) instead.
        </p>
      )}
      {preview.length > 0 && factor && (
        <ul className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2 text-sm tabular-nums">
          {preview.map((entry) => <li key={entry.count}>{entry.count} {code} = {entry.base} {base}</li>)}
          {reverse && <li>100 {base} {reverse.exact ? "=" : "≈"} {reverse.text} {code}</li>}
        </ul>
      )}
      <div className="flex flex-wrap gap-4">
        <Checkbox isSelected={draft.purchasing} onChange={set("purchasing")}>Purchasing</Checkbox>
        <Checkbox isSelected={draft.sales} onChange={set("sales")}>Sales</Checkbox>
        <Checkbox isSelected={draft.inventory} onChange={set("inventory")}>Inventory entry</Checkbox>
      </div>
      {errors.purchasingEnabled && <p className="text-xs text-danger">{errors.purchasingEnabled}</p>}
      <NumberField label="Quantity precision (decimal places)" value={draft.precision} minValue={0} maxValue={chosen?.decimalPlaces ?? 6} step={1} onChange={set("precision")}
        errorMessage={errors.quantityPrecision} description={`Empty: as the unit allows (${chosen?.decimalPlaces ?? "–"}).`} />
      <TextArea label="Reason" rows={2} value={draft.reason} onChange={set("reason")} errorMessage={errors.reason}
        description={editing && factorChanged ? "Recorded in the unit history. Existing documents and stock keep the old conversion." : "Optional; needed when a measure converts to a count (1 M = 20 PCS)."} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onPress={onClose}>Cancel</Button>
        <Button variant={confirming ? "danger" : "primary"} isLoading={save.isPending} isDisabled={(!editing && !draft.uomId) || !factor} onPress={() => { setError(confirming ? error : null); save.mutate(); }}>
          {confirming ? "Change for new documents" : editing ? "Save" : "Add unit"}
        </Button>
      </div>
    </div>
  );
}

function HistoryList({ itemId }: { itemId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "products", "product", itemId, "units", "history"), queryFn: () => getItemUomHistory(itemId) });
  if (query.isLoading) return <LoadingState label="Loading history" rows={3} />;
  if (!query.data?.length) return <p className="text-sm text-text-muted">No unit changes yet.</p>;
  const show = (value: Record<string, unknown> | null) => (value ? Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined).map(([key, entry]) => `${key}: ${String(entry)}`).join(", ") : "");
  return (
    <ol className="flex max-h-[60vh] flex-col gap-2 overflow-auto text-sm">
      {query.data.map((entry) => (
        <li key={entry.id} className="rounded-[var(--radius-control)] border border-border px-3 py-2">
          <span className="font-medium">{HISTORY_LABEL[entry.eventType] ?? entry.eventType}{entry.uomCode ? ` · ${entry.uomCode}` : ""}</span>
          {(entry.from || entry.to) && <span className="block text-xs text-text-secondary">{entry.from ? `${show(entry.from)} → ` : ""}{show(entry.to)}</span>}
          <span className="block text-xs text-text-muted">{[entry.actorName, formatDateTime(entry.createdAt), entry.reason].filter(Boolean).join(" · ")}</span>
        </li>
      ))}
    </ol>
  );
}

// Any quantity (and a unit price) in one of the item's units, in another — worked out by the server's conversion engine, through the base.
function Converter({ itemId, units }: { itemId: string; units: ItemUnit[] }) {
  const [quantity, setQuantity] = useState("1");
  const [from, setFrom] = useState(units.find((unit) => !unit.isBase)?.uomId ?? units[0]?.uomId ?? "");
  const [to, setTo] = useState(units.find((unit) => unit.isBase)?.uomId ?? "");
  const [price, setPrice] = useState("");
  const convert = useMutation({ mutationFn: () => convertItemUnits(itemId, { quantity: quantity.trim() || "1", from, to, unitPrice: price.trim() || undefined }) });
  if (units.length < 2) return null;
  const choices = units.map((unit) => ({ value: unit.uomId, label: unit.code }));
  const code = (id: string) => units.find((unit) => unit.uomId === id)?.code ?? "";
  const result = convert.data;
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3">
      <span className="text-xs font-medium text-text-muted">Convert</span>
      <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-5">
        <TextField label="Quantity" size="compact" inputMode="decimal" value={quantity} onChange={setQuantity} />
        <Select label="From" size="compact" selectedKey={from || null} options={choices} onSelectionChange={(value) => setFrom(String(value))} />
        <Select label="To" size="compact" selectedKey={to || null} options={choices} onSelectionChange={(value) => setTo(String(value))} />
        <TextField label={`Unit price per ${code(from)} (optional)`} size="compact" inputMode="decimal" value={price} onChange={setPrice} />
        <Button size="compact" variant="secondary" isLoading={convert.isPending} isDisabled={!from || !to} onPress={() => convert.mutate()}>Convert</Button>
      </div>
      {result && (result.conversion.ok ? (
        <p className="text-sm tabular-nums">{quantity || "1"} {code(from)} {result.conversion.exact ? "=" : "≈"} {result.conversion.quantity} {code(to)}
          <span className="text-text-muted"> ({result.conversion.baseQuantity} base){result.conversion.exact ? "" : " · not exact: shown for reference only"}</span>
          {result.price?.ok && <span className="block">Price: {result.price.unitPrice} per {code(to)} ({result.price.baseUnitPrice} per base unit)</span>}</p>
      ) : <p className="text-sm text-danger">{result.conversion.message}</p>)}
      {convert.isError && <p className="text-sm text-danger">{errorMessage(convert.error)}</p>}
    </div>
  );
}

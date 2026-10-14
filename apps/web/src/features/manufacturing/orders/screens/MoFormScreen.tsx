"use client";

// New (or draft) manufacturing order: the product and quantity, the schedule (its planned start picks the BOM revision effective then), the
// warehouses for materials, production and finished goods, where the demand comes from, priority, owner and notes. "Calculate" shows the
// materials the revision needs, what is free in the material warehouse and the estimate — nothing is saved or reserved until "Save draft".
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ComboBox, ErrorState, PageHeader, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { useSubmitKey } from "@/shared/http/submit-once";

import { itemUnits } from "@/features/manufacturing/boms/api/bom-api";
import { MO_BASE, createOrder, errorMessage, getOrder, inr, newKey, orderOptions, previewOrder, qty, saveDraft, type MoOptions, type MoPreview } from "../api/mo-api";

type FormState = { finishedItemId: string | null; plannedQuantity: string; uomId: string | null; plannedStartAt: string; plannedEndAt: string; manufacturingWarehouseId: string | null;
  materialWarehouseId: string | null; finishedGoodsWarehouseId: string | null; sourceDemandType: string; sourceDemandId: string | null; sourceReference: string; priority: string;
  productionOwnerId: string | null; notes: string };

const local = (iso: string | Date) => { const date = new Date(iso); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 16); };
const iso = (value: string) => (value ? new Date(value).toISOString() : "");

export function MoFormScreen({ orderId }: { orderId?: string }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "order-options"), queryFn: orderOptions, staleTime: 60_000 });
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "order", orderId ?? ""), queryFn: () => getOrder(orderId!), enabled: Boolean(orderId) });
  if (options.isLoading || (orderId && existing.isLoading)) return <LoadingState label="Loading" rows={6} />;
  if (options.isError || !options.data) return <ErrorState title="Could not load the form" description={errorMessage(options.error)} />;
  if (orderId && (existing.isError || !existing.data)) return <ErrorState title="Could not load the order" description={errorMessage(existing.error)} />;
  const order = existing.data;
  const initial: FormState | null = order
    ? { finishedItemId: order.finishedItem.id, plannedQuantity: order.plannedQuantity, uomId: order.outputUomId, plannedStartAt: local(order.plannedStartAt), plannedEndAt: local(order.plannedEndAt),
      manufacturingWarehouseId: order.warehouses.manufacturing.id, materialWarehouseId: order.warehouses.material.id, finishedGoodsWarehouseId: order.warehouses.finishedGoods.id,
      sourceDemandType: order.source.type, sourceDemandId: order.source.id, sourceReference: order.source.reference ?? "", priority: order.priority, productionOwnerId: order.ownerId, notes: order.notes ?? "" }
    : null;
  return <MoForm orderId={orderId} options={options.data} initial={initial} version={order?.version} number={order?.number} />;
}

// A new order starts in an hour and is due in two days.
const blank = (): FormState => ({ finishedItemId: null, plannedQuantity: "1", uomId: null, plannedStartAt: local(new Date(Date.now() + 3_600_000)),
  plannedEndAt: local(new Date(Date.now() + 2 * 86_400_000)), manufacturingWarehouseId: null, materialWarehouseId: null, finishedGoodsWarehouseId: null, sourceDemandType: "MANUAL",
  sourceDemandId: null, sourceReference: "", priority: "NORMAL", productionOwnerId: null, notes: "" });

// Choosing the product proposes its unit, its planning warehouses (else the company default) and a completion date after its lead time. Each
// stays editable; a warehouse already chosen by hand is kept unless the product names its own.
function withProduct(state: FormState, product: MoOptions["products"][number] | null, options: MoOptions): FormState {
  const fallback = options.warehouses.find((row) => row.isDefault)?.id ?? (options.warehouses.length === 1 ? options.warehouses[0].id : null);
  const material = product?.defaults.materialWarehouseId ?? state.materialWarehouseId ?? fallback;
  const manufacturing = product?.defaults.manufacturingWarehouseId ?? state.manufacturingWarehouseId ?? material ?? fallback;
  const start = state.plannedStartAt ? new Date(state.plannedStartAt) : new Date();
  const lead = product?.defaults.leadTimeDays;
  return { ...state, uomId: product ? product.uomId : state.uomId, materialWarehouseId: material, manufacturingWarehouseId: manufacturing,
    finishedGoodsWarehouseId: state.finishedGoodsWarehouseId ?? fallback ?? manufacturing,
    plannedEndAt: lead !== null && lead !== undefined && !Number.isNaN(start.getTime()) ? local(new Date(start.getTime() + Math.max(lead, 1) * 86_400_000)) : state.plannedEndAt };
}

function MoForm({ orderId, options, initial, version, number }: { orderId?: string; options: MoOptions; initial: FormState | null; version?: number; number?: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  // A new order: the company's default warehouse (the only one, when there is one) and the person creating it as owner, until a product brings its own.
  const [state, setState] = useState<FormState>(() => initial ?? withProduct({ ...blank(), productionOwnerId: options.currentUserId }, null, options));
  const [preview, setPreview] = useState<MoPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);
  const submitKey = useSubmitKey();
  const units = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "item-units", state.finishedItemId ?? ""), queryFn: () => itemUnits(state.finishedItemId!), enabled: Boolean(state.finishedItemId) });
  const set = <K extends keyof FormState>(field: K, value: FormState[K]) => { setState((current) => ({ ...current, [field]: value })); setPreview(null); };
  const product = options.products.find((row) => row.id === state.finishedItemId);
  const payload = () => ({ finishedItemId: state.finishedItemId ?? undefined, plannedQuantity: state.plannedQuantity, uomId: state.uomId ?? product?.uomId, plannedStartAt: iso(state.plannedStartAt),
    plannedEndAt: iso(state.plannedEndAt), manufacturingWarehouseId: state.manufacturingWarehouseId ?? undefined, materialWarehouseId: state.materialWarehouseId ?? undefined,
    finishedGoodsWarehouseId: state.finishedGoodsWarehouseId ?? undefined, sourceDemandType: state.sourceDemandType, sourceDemandId: state.sourceDemandType === "SALES_ORDER" ? state.sourceDemandId : null,
    sourceReference: state.sourceDemandType === "PLANNING" ? state.sourceReference.trim() || null : null, priority: state.priority, productionOwnerId: state.productionOwnerId, notes: state.notes.trim() || null });
  const calculate = async () => {
    setBusy(true); setError(null);
    try { setPreview(await previewOrder(payload())); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const order = await submitKey.run(async () => orderId ? await saveDraft(orderId, { ...payload(), finishedItemId: undefined, expectedVersion: version }) : await createOrder({ ...payload(), idempotencyKey: key }));
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
      router.replace(`${MO_BASE}/${order.id}`);
    } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  };
  const warehouses = options.warehouses.map((row) => ({ value: row.id, label: `${row.code} · ${row.name}` }));
  const ready = state.finishedItemId && state.materialWarehouseId && state.manufacturingWarehouseId && state.finishedGoodsWarehouseId && Number(state.plannedQuantity) > 0;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={orderId ? `Edit ${number ?? "draft"}` : "New manufacturing order"}
        description="A draft reserves and moves nothing. The BOM revision is the one effective on the planned start; it is frozen when the order is released." />
      {error && <Notice tone="danger">{error}</Notice>}
      <Panel title="What to make">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ComboBox label="Product" isRequired isDisabled={Boolean(orderId)} placeholder="Products with a BOM" selectedKey={state.finishedItemId}
            onSelectionChange={(value) => { const id = value ? String(value) : null; setState((current) => withProduct({ ...current, finishedItemId: id }, options.products.find((row) => row.id === id) ?? null, options)); setPreview(null); }}
            options={(options.products ?? []).map((row) => ({ value: row.id, label: `${row.code} · ${row.name}${row.effectiveRevision ? "" : " (no effective BOM)"}` }))} />
          <TextField label="Planned quantity" isRequired inputMode="decimal" value={state.plannedQuantity} onChange={(value) => set("plannedQuantity", value)} />
          <Select label="Unit" selectedKey={state.uomId ?? product?.uomId ?? null} onSelectionChange={(value) => set("uomId", String(value))}
            options={(units.data?.units ?? []).map((unit) => ({ value: unit.uomId, label: unit.code }))} />
        </div>
        {product && (
          <p className="text-xs text-text-muted">
            {product.effectiveRevision ? `BOM revision ${product.effectiveRevision.number} is in use now.` : "No BOM revision is in use now."}
            {product.scheduledRevision ? ` Revision ${product.scheduledRevision.number} takes over from ${formatDateTime(product.scheduledRevision.from)} — orders starting then use it.` : ""}
          </p>
        )}
      </Panel>
      <Panel title="Schedule and warehouses">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextField label="Planned start" isRequired type="datetime-local" value={state.plannedStartAt} onChange={(value) => set("plannedStartAt", value)} />
          <TextField label="Planned completion" isRequired type="datetime-local" value={state.plannedEndAt} onChange={(value) => set("plannedEndAt", value)} />
          <Select label="Manufacturing location" isRequired selectedKey={state.manufacturingWarehouseId} onSelectionChange={(value) => set("manufacturingWarehouseId", String(value))} options={warehouses} />
          <Select label="Material issue warehouse" isRequired selectedKey={state.materialWarehouseId} onSelectionChange={(value) => set("materialWarehouseId", String(value))} options={warehouses} />
          <Select label="Finished goods warehouse" isRequired selectedKey={state.finishedGoodsWarehouseId} onSelectionChange={(value) => set("finishedGoodsWarehouseId", String(value))} options={warehouses} />
        </div>
      </Panel>
      <Panel title="Demand and responsibility">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select label="Demand source" selectedKey={state.sourceDemandType} onSelectionChange={(value) => set("sourceDemandType", String(value))}
            options={[{ value: "MANUAL", label: "Manual" }, { value: "SALES_ORDER", label: "Sales order" }, { value: "PLANNING", label: "Planning requirement" }]} />
          {state.sourceDemandType === "SALES_ORDER" && (
            <ComboBox label="Sales order" placeholder="Open sales orders" selectedKey={state.sourceDemandId} onSelectionChange={(value) => set("sourceDemandId", value ? String(value) : null)}
              options={(options.salesOrders ?? []).map((row) => ({ value: row.id, label: row.number }))} />
          )}
          {state.sourceDemandType === "PLANNING" && <TextField label="Planning reference" value={state.sourceReference} onChange={(value) => set("sourceReference", value)} maxLength={200} />}
          <Select label="Priority" selectedKey={state.priority} onSelectionChange={(value) => set("priority", String(value))}
            options={[{ value: "LOW", label: "Low" }, { value: "NORMAL", label: "Normal" }, { value: "HIGH", label: "High" }]} />
          <ComboBox label="Production owner" placeholder="Optional" selectedKey={state.productionOwnerId} onSelectionChange={(value) => set("productionOwnerId", value ? String(value) : null)}
            options={(options.people ?? []).map((row) => ({ value: row.id, label: row.name }))} />
        </div>
        <TextArea label="Production notes" value={state.notes} onChange={(value) => set("notes", value)} maxLength={4000} />
      </Panel>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" isLoading={busy} isDisabled={!ready} onPress={calculate}>Calculate materials</Button>
        <Button variant="primary" isLoading={busy} isDisabled={!ready} onPress={save}>{orderId ? "Save draft" : "Create draft"}</Button>
      </div>
      {preview && (
        <Panel title={`Materials for ${qty(preview.plannedBaseQuantity)} ${preview.baseUom} · ${preview.bom.number} rev ${preview.bom.revisionNumber}`}
          description={preview.estimatedMaterialCost ? `Estimated material cost ${inr(preview.estimatedMaterialCost)} (labour and overhead not included).` : "A preview only: nothing is reserved."}>
          <ul className="list-disc pl-4 text-xs text-text-muted">{preview.assumptions.map((line) => <li key={line}>{line}</li>)}</ul>
          <LinesTable columns={["Material", { label: "Required", numeric: true }, "Unit", { label: "Free in warehouse", numeric: true }, { label: "Short", numeric: true }, "Type"]}>
            {preview.materials.map((row) => (
              <tr key={row.id}>
                <Cell>{row.code} · {row.name}</Cell><Cell numeric>{qty(row.required)}</Cell><Cell>{row.uom}</Cell><Cell numeric>{qty(row.availableToReserve)}</Cell>
                <Cell numeric>{Number(row.shortage) ? <StatusBadge tone="danger">{qty(row.shortage)}</StatusBadge> : ""}</Cell>
                <Cell>{row.kind === "SUBASSEMBLY" ? "Subassembly (from stock or its own order)" : "Material"}</Cell>
              </tr>
            ))}
          </LinesTable>
        </Panel>
      )}
    </div>
  );
}

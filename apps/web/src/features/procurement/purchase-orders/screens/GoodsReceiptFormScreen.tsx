"use client";

// Create (or finish) a goods receipt (GRN) for one confirmed purchase order,
// into one receiving warehouse. Opened from the order, or from Goods Receipts
// by choosing an order that still has something to receive. Every line still
// owed is proposed with its remaining quantity; enter what physically
// arrived, when and how (vehicle, carrier, tracking), who received it, the
// lot / serial / expiry details the product needs, how much is on inspection
// hold or damaged, and what was refused at the door. Saving keeps a draft (no
// stock moves, nothing is reserved); posting checks everything again on the
// server and moves the stock. A line may be received in another of the item's purchase units (30 PCS against an order in BOX of 20): the
// server converts it exactly into the order's unit and checks what is still owed in base units.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Checkbox, ErrorState, PageHeader, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { useSubmitKey } from "@/shared/http/submit-once";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { quantity } from "@/features/procurement/shared/format";
import { useFormChangesWarning } from "@/features/procurement/shared/navigation";

import {
  createGoodsReceipt, errorMessage, getGoodsReceipt, getPurchaseOrderOptions, getReceivable, issuesOf, listPurchaseOrders, receiptAction, updateGoodsReceipt, type GoodsReceiptDetail,
  REJECTION_REASON_OPTIONS, type PurchaseOrderOptions, type Receivable,
} from "../api/purchase-orders-api";
import { DocumentFormPage } from "@/shared/ui/DocumentFormPage";
import { FormSection } from "@/shared/ui/FormSection";
import { Facts, Notice, Panel } from "@/shared/ui/Panel";

// A lot of a lot-tracked line received in several lots: its number, how much of the line it is, and its dates.
type Lot = { batch: string; quantity: string; expiry: string; manufactured: string };
type Row = {
  include: boolean; presented: string; received: string; hold: string; damaged: string; refused: string; refusalCode: string; refusalReason: string; batch: string; expiry: string;
  manufactured: string; serials: string; notes: string; uomId: string; lots: Lot[];
};
const sumOf = (values: string[]) => values.reduce((total, value) => total + Number(value || 0), 0);
// quantity × factor ÷ orderFactor, for the "in the order's unit" hint (the server does the authoritative, exact conversion).
const inOrderUnit = (value: string, factor: string, orderFactor: string) => (Number(value || 0) * Number(factor || 1)) / Number(orderFactor || 1);
const trim = (value: string | null | undefined) => (value == null ? "" : String(Number(value)));
// <input type="datetime-local"> works in local time without a zone.
const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function GoodsReceiptFormScreen({ orderId, receiptId }: { orderId?: string; receiptId?: string }) {
  const workspace = useWorkspaceContext();
  const [pickedOrderId, setPickedOrderId] = useState<string | null>(null);
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "goods-receipt", receiptId), queryFn: () => getGoodsReceipt(receiptId!), enabled: Boolean(receiptId) });
  const purchaseOrderId = orderId ?? existing.data?.receipt.purchaseOrderId ?? pickedOrderId ?? undefined;
  const receivable = useQuery({
    queryKey: scopedQueryKey(workspace, "procurement", "receivable", purchaseOrderId, receiptId), queryFn: () => getReceivable(purchaseOrderId!, receiptId), enabled: Boolean(purchaseOrderId),
  });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "po-options"), queryFn: getPurchaseOrderOptions, staleTime: 60_000 });
  if (!purchaseOrderId && !receiptId) return <OrderPicker onPick={setPickedOrderId} />;
  if (existing.isLoading || receivable.isLoading || options.isLoading) return <LoadingState label="Loading goods receipt" />;
  if (!receivable.data || !options.data || (receiptId && !existing.data))
    return <ErrorState title="Could not load the goods receipt" description={errorMessage(receivable.error ?? existing.error)} action={{ label: "Retry", onPress: () => receivable.refetch() }} />;
  if (existing.data && existing.data.receipt.status !== "draft") return <ErrorState title="This goods receipt cannot be edited" description="Only a draft is edited. A posted receipt is reversed or corrected by a return." />;
  return <ReceiptForm key={receivable.data.order.id} receivable={receivable.data} options={options.data} existing={existing.data ?? null} />;
}

// A goods receipt starts from a confirmed order that still has goods to receive.
function OrderPicker({ onPick }: { onPick: (id: string) => void }) {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const orders = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "receivable-orders", search), queryFn: () => listPurchaseOrders({ view: "receivable", search, limit: 50 }) });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="New Goods Receipt" description="Choose the confirmed purchase order the goods arrived against. Only orders with something still to receive are listed." />
      <Panel title="Purchase order">
        <TextField label="Search" value={search} onChange={setSearch} placeholder="Order number, supplier or reference" />
        {orders.isLoading && <p className="text-sm text-text-secondary">Loading orders…</p>}
        {orders.error && <Notice>{errorMessage(orders.error)}</Notice>}
        {orders.data && !orders.data.rows.length && <p className="text-sm text-text-secondary">No confirmed purchase order is waiting for goods.</p>}
        <div className="flex flex-col divide-y divide-border">
          {orders.data?.rows.map((order) => (
            <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <div className="flex flex-col">
                <span className="font-medium">{order.purchaseOrderNumber} · {order.supplierName}</span>
                <span className="text-xs text-text-secondary">{order.receiptLabel}{order.expectedDeliveryDate ? ` · expected ${order.expectedDeliveryDate}` : ""}{order.overdueReceipt ? " · overdue" : ""}</span>
              </div>
              <Button variant="secondary" size="compact" onPress={() => onPick(order.id)}>Receive goods</Button>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function ReceiptForm({ receivable, options, existing }: { receivable: Receivable; options: PurchaseOrderOptions; existing: GoodsReceiptDetail | null }) {
  const router = useRouter();
  const goods = receivable.lines.filter((line) => line.receiptRequired);
  const saved = existing?.receipt;
  const [header, setHeader] = useState({
    warehouseId: saved?.warehouseId ?? receivable.order.defaultWarehouseId ?? "", receiptDate: saved?.receiptDate ?? "", arrivedAt: toLocalInput(saved?.physicalReceivedAt),
    receivedBy: saved?.receivedByUserId ?? "", vehicle: saved?.vehicleNumber ?? "", carrier: saved?.carrierName ?? "", tracking: saved?.trackingReference ?? "",
    challanNumber: saved?.supplierChallanNumber ?? "", challanDate: saved?.supplierChallanDate ?? "", notes: saved?.notes ?? "",
  });
  const setField = (key: keyof typeof header) => (value: string) => setHeader((current) => ({ ...current, [key]: value }));
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(goods.map((line) => {
    // A line saved in several lots is several receipt lines: they are shown as one line with its lots.
    const entries = existing?.lines.filter((item) => item.purchaseOrderLineId === line.purchaseOrderLineId) ?? [];
    const entry = entries[0];
    const sum = (pick: (item: (typeof entries)[number]) => string | null) => trim(String(sumOf(entries.map((item) => pick(item) ?? "0"))));
    return [line.purchaseOrderLineId, entry ? {
      include: true, presented: entries.some((item) => item.presentedQuantity) ? sum((item) => item.presentedQuantity) : "", received: sum((item) => item.receivedQuantity),
      hold: sum((item) => item.inspectionQuantity), damaged: sum((item) => item.damagedQuantity), refused: sum((item) => item.refusedQuantity),
      refusalCode: entry.refusalReasonCode ?? "damaged_goods", refusalReason: entry.refusalReason ?? "", batch: entry.batchNumber ?? "", expiry: entry.expiryDate ?? "", manufactured: entry.manufacturedDate ?? "",
      serials: entry.serialNumbers.join(", "), notes: entry.discrepancyNotes ?? "", uomId: line.uomId ?? "",
      lots: entries.length > 1 ? entries.map((item) => ({ batch: item.batchNumber ?? "", quantity: trim(item.receivedQuantity), expiry: item.expiryDate ?? "", manufactured: item.manufacturedDate ?? "" })) : [],
    } : { uomId: line.uomId ?? "", include: !existing && Number(line.remaining) > 0, presented: "", received: Number(line.remaining) > 0 ? trim(line.remaining) : "", hold: "", damaged: "", refused: "",
      refusalCode: "damaged_goods", refusalReason: "",
      batch: "", expiry: "", manufactured: "", serials: "", notes: "", lots: [] }];
  })));
  const set = (id: string, change: Partial<Row>) => setRows((current) => ({ ...current, [id]: { ...current[id], ...change } }));
  const payload = useMemo(() => ({
    warehouseId: header.warehouseId || undefined, receiptDate: header.receiptDate || undefined, physicalReceivedAt: header.arrivedAt ? new Date(header.arrivedAt).toISOString() : null,
    receivedByUserId: header.receivedBy || null, vehicleNumber: header.vehicle || null, carrierName: header.carrier || null, trackingReference: header.tracking || null,
    supplierChallanNumber: header.challanNumber || null, supplierChallanDate: header.challanDate || null, notes: header.notes || null,
    lines: goods.filter((line) => rows[line.purchaseOrderLineId]?.include).map((line) => {
      const row = rows[line.purchaseOrderLineId];
      return { purchaseOrderLineId: line.purchaseOrderLineId, productId: line.productId ?? undefined, uomId: row.uomId && row.uomId !== line.uomId ? row.uomId : undefined,
        receivedQuantity: row.received || "0", heldQuantity: row.hold || "0",
        damagedQuantity: row.damaged || "0", refusedQuantity: row.refused || "0", presentedQuantity: row.presented || undefined,
        refusalReasonCode: Number(row.refused) > 0 ? row.refusalCode : undefined, refusalReason: row.refusalReason || undefined, batchNumber: row.batch || undefined,
        expiryDate: row.expiry || undefined, manufacturedDate: row.manufactured || undefined, serialNumbers: row.serials || undefined, discrepancyNotes: row.notes || undefined,
        // Several lots: every unit received is allocated to one (the server refuses lots that do not add up).
        ...(row.lots.length > 1 ? { batches: row.lots.map((lot) => ({ batchNumber: lot.batch, quantity: lot.quantity || "0", expiryDate: lot.expiry || undefined, manufacturedDate: lot.manufactured || undefined })),
          batchNumber: undefined, expiryDate: undefined, manufacturedDate: undefined, heldQuantity: undefined, damagedQuantity: undefined } : {}) };
    }),
  }), [goods, rows, header]);
  const submit = useSubmitKey();
  useFormChangesWarning({ header, rows });
  const save = useMutation({
    mutationFn: (post: boolean) => submit.run(async () => {
      if (existing) {
        await updateGoodsReceipt(existing.receipt.id, { ...payload, expectedUpdatedAt: existing.receipt.updatedAt });
        if (post) await receiptAction(existing.receipt.id, "post");
        return existing.receipt.id;
      }
      return (await createGoodsReceipt(receivable.order.id, { ...payload, post })).id;
    }),
    onSuccess: (id) => router.push(`/procurement/goods-receipts/${id}`),
  });
  const issues = issuesOf(save.error);
  const selected = goods.filter((line) => rows[line.purchaseOrderLineId]?.include);

  return (
    <>
    <DocumentFormPage
      header={{
        title: existing ? `Edit ${existing.receipt.receiptNumber}` : "Create Goods Receipt",
        description: "Enter what physically arrived. Saving keeps a draft with no stock effect; posting checks the quantities again and moves the stock.",
      }}
      banner={<div className="flex flex-col gap-3">
        {Boolean(save.error) && <Notice>{errorMessage(save.error)}{issues.length > 1 && <ul className="mt-1 list-disc pl-5">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</Notice>}
      </div>}
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.push("/procurement/goods-receipts")}>Cancel</Button>
          <Button variant="secondary" isLoading={save.isPending && save.variables === false} isDisabled={!selected.length} onPress={() => save.mutate(false)}>Save draft</Button>
          <Button variant="primary" isLoading={save.isPending && save.variables === true} isDisabled={!selected.length} onPress={() => save.mutate(true)}>Post receipt</Button>
        </>
      }
    >
      <FormSection columns={1} title="Receipt">
        <Facts columns={3} items={[
          { label: "Purchase order", value: receivable.order.purchaseOrderNumber },
          { label: "Supplier", value: `${receivable.order.supplierName}${receivable.order.supplierNumber ? ` · ${receivable.order.supplierNumber}` : ""}` },
          { label: "Company", value: receivable.order.company ? `${receivable.order.company.legalName ?? receivable.order.company.name ?? ""}${receivable.order.company.gstin ? ` · GSTIN ${receivable.order.company.gstin}` : ""}` : "—" },
          { label: "Ships from", value: receivable.order.shipFrom ? [receivable.order.shipFrom.label, receivable.order.shipFrom.city].filter(Boolean).join(" · ") : "—" },
        ]} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select label="Receiving warehouse" selectedKey={header.warehouseId || null} onSelectionChange={(value) => setField("warehouseId")(String(value))}
            description="One warehouse per receipt." options={options.warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))} />
          <TextField label="Receipt date" type="date" value={header.receiptDate} onChange={setField("receiptDate")} description="The receipt's accounting date (today if empty)." />
          <TextField label="Goods arrived at" type="datetime-local" value={header.arrivedAt} onChange={setField("arrivedAt")} description="When the goods physically arrived. The posting time is recorded separately." />
          <Select label="Received by" selectedKey={header.receivedBy || "me"} onSelectionChange={(value) => setField("receivedBy")(value === "me" ? "" : String(value))}
            description="Who took the goods in. Defaults to whoever posts."
            options={[{ value: "me", label: "Whoever posts the receipt" }, ...options.buyers.map((user) => ({ value: user.id, label: user.name }))]} />
          <TextField label="Supplier challan no." value={header.challanNumber} onChange={setField("challanNumber")} />
          <TextField label="Challan date" type="date" value={header.challanDate} onChange={setField("challanDate")} />
          <TextField label="Vehicle number" value={header.vehicle} onChange={setField("vehicle")} />
          <TextField label="Carrier / transporter" value={header.carrier} onChange={setField("carrier")} />
          <TextField label="Tracking / LR / AWB no." value={header.tracking} onChange={setField("tracking")} />
        </div>
      </FormSection>
      <FormSection columns={1} title="Items" description="Select the lines that arrived. Each line receives only the product ordered. Quantities are checked again when posted; other open drafts reserve nothing.">
        <div className="flex flex-col gap-3">
          {goods.map((line) => {
            const row = rows[line.purchaseOrderLineId];
            const done = Number(line.remaining) <= 0;
            const entered = line.units.find((unit) => unit.uomId === row.uomId);
            const enteredCode = entered?.code ?? line.uom.code;
            const orderFactor = line.conversionFactor ?? "1";
            const orderQuantity = inOrderUnit(row.received, entered?.factor ?? orderFactor, orderFactor);
            return (
              <div key={line.purchaseOrderLineId} className={`flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3 ${done && !row.include ? "opacity-60" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <Checkbox isSelected={row.include} isDisabled={done && !row.include} onChange={(value) => set(line.purchaseOrderLineId, { include: value })}>
                    <span className="font-medium">{line.lineNumber}. {line.product.code ? `${line.product.code} · ` : ""}{line.description}</span>
                  </Checkbox>
                  <span className="text-sm tabular-nums text-text-secondary">Ordered {quantity(line.ordered)} · Received {quantity(line.received)}
                    {Number(line.cancelled) > 0 ? ` · Cancelled ${quantity(line.cancelled)}` : ""} · <span className="font-medium text-text">Remaining {quantity(line.remaining)} {line.uom.code}</span></span>
                </div>
                {Number(line.onOtherDrafts) > 0 && <p className="text-xs text-warning">{quantity(line.onOtherDrafts)} is also on draft {line.otherDrafts.map((entry) => entry.number).join(", ")} — whichever is posted first counts.</p>}
                {row.include && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                    {line.units.length > 1 && (
                      <Select label="Unit received" selectedKey={row.uomId || line.uomId} onSelectionChange={(value) => set(line.purchaseOrderLineId, { uomId: String(value) })}
                        options={line.units.map((unit) => ({ value: unit.uomId, label: unit.isBase ? `${unit.code} (base)` : `${unit.code} (1 = ${Number(unit.factor)} ${line.baseUom ?? ""})` }))}
                        description={`The order is in ${line.uom.code}.`} />
                    )}
                    <TextField label={`Receive now (${enteredCode})`} inputMode="decimal" value={row.received} onChange={(value) => set(line.purchaseOrderLineId, { received: value })}
                      description={entered && entered.uomId !== line.uomId ? `= ${quantity(orderQuantity)} ${line.uom.code} = ${quantity(Number(row.received || 0) * Number(entered.factor))} ${line.baseUom ?? ""}` : "Everything taken into custody."} />
                    {line.productType === "stock" && line.trackingType !== "serial" && row.lots.length <= 1 && (
                      <>
                        <TextField label="Of which on inspection hold" inputMode="decimal" value={row.hold} onChange={(value) => set(line.purchaseOrderLineId, { hold: value })} />
                        <TextField label="Of which damaged" inputMode="decimal" value={row.damaged} onChange={(value) => set(line.purchaseOrderLineId, { damaged: value })} />
                      </>
                    )}
                    <TextField label="Refused at the dock" inputMode="decimal" value={row.refused} onChange={(value) => set(line.purchaseOrderLineId, { refused: value })}
                      description="Not taken in; stays owed. A rejection case is opened when posted." />
                    {Number(row.refused) > 0 && (
                      <>
                        <Select label="Refusal reason" selectedKey={row.refusalCode} onSelectionChange={(value) => set(line.purchaseOrderLineId, { refusalCode: String(value) })}
                          options={REJECTION_REASON_OPTIONS} />
                        <TextField label="Explanation" isRequired={row.refusalCode === "other"} value={row.refusalReason} onChange={(value) => set(line.purchaseOrderLineId, { refusalReason: value })} />
                      </>
                    )}
                    <TextField label="Presented at the dock" inputMode="decimal" value={row.presented} onChange={(value) => set(line.purchaseOrderLineId, { presented: value })}
                      description="If counted: must equal taken in + refused." />
                    {line.trackingType === "batch" && row.lots.length <= 1 && (
                      <>
                        <TextField label="Lot / batch number" isRequired value={row.batch} onChange={(value) => set(line.purchaseOrderLineId, { batch: value })} />
                        <TextField label="Expiry date" type="date" isRequired={line.requiresExpiryDate} value={row.expiry} onChange={(value) => set(line.purchaseOrderLineId, { expiry: value })}
                          description={line.requiresExpiryDate ? "Required for this product. An expired lot cannot be accepted." : undefined} />
                        <TextField label="Manufacture date" type="date" value={row.manufactured} onChange={(value) => set(line.purchaseOrderLineId, { manufactured: value })} />
                        <div className="flex items-end"><Button size="compact" variant="ghost" onPress={() => set(line.purchaseOrderLineId, {
                          lots: [{ batch: row.batch, quantity: row.received, expiry: row.expiry, manufactured: row.manufactured }, { batch: "", quantity: "", expiry: "", manufactured: "" }],
                          hold: "", damaged: "" })}>Split into lots</Button></div>
                      </>
                    )}
                    {line.trackingType === "batch" && row.lots.length > 1 && (
                      <div className="flex flex-col gap-2 sm:col-span-4">
                        <p className="text-sm font-medium">Lots <span className="font-normal text-text-muted">· allocated {quantity(sumOf(row.lots.map((lot) => lot.quantity)))} of {quantity(Number(row.received || 0))} {enteredCode}
                          {sumOf(row.lots.map((lot) => lot.quantity)) !== Number(row.received || 0) && <span className="text-danger"> · every unit received must be in a lot</span>}</span></p>
                        {row.lots.map((lot, index) => {
                          const change = (patch: Partial<Lot>) => set(line.purchaseOrderLineId, { lots: row.lots.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)) });
                          return (
                            <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-5">
                              <TextField label={`Lot ${index + 1}`} isRequired value={lot.batch} onChange={(value) => change({ batch: value })} />
                              <TextField label={`Quantity (${enteredCode})`} inputMode="decimal" value={lot.quantity} onChange={(value) => change({ quantity: value })} />
                              <TextField label="Expiry date" type="date" isRequired={line.requiresExpiryDate} value={lot.expiry} onChange={(value) => change({ expiry: value })} />
                              <TextField label="Manufacture date" type="date" value={lot.manufactured} onChange={(value) => change({ manufactured: value })} />
                              <div className="flex items-end"><Button size="compact" variant="ghost" onPress={() => {
                                const rest = row.lots.filter((_, position) => position !== index);
                                set(line.purchaseOrderLineId, rest.length === 1 ? { lots: [], batch: rest[0].batch, expiry: rest[0].expiry, manufactured: rest[0].manufactured } : { lots: rest });
                              }}>Remove</Button></div>
                            </div>
                          );
                        })}
                        <div><Button size="compact" variant="secondary" onPress={() => set(line.purchaseOrderLineId, { lots: [...row.lots, { batch: "", quantity: "", expiry: "", manufactured: "" }] })}>Add lot</Button></div>
                        <p className="text-xs text-text-muted">Goods on inspection hold or damaged are received one lot per receipt.</p>
                      </div>
                    )}
                    {line.trackingType === "serial" && <TextField label="Serial numbers" isRequired value={row.serials} onChange={(value) => set(line.purchaseOrderLineId, { serials: value })} description="One per unit, comma separated; each must be new." />}
                    <TextField label="Discrepancy notes" value={row.notes} onChange={(value) => set(line.purchaseOrderLineId, { notes: value })} />
                    <p className="text-xs text-text-muted sm:col-span-4">Usable now: {quantity(Math.max(Number(row.received || 0) - Number(row.hold || 0) - Number(row.damaged || 0), 0))} {enteredCode} · after this receipt,
                      {" "}{quantity(Math.max(Number(line.remaining) - orderQuantity, 0))} {line.uom.code}{line.baseUom ? ` (${quantity(Math.max(Number(line.remainingBase ?? 0) - orderQuantity * Number(orderFactor), 0))} ${line.baseUom})` : ""} still to receive
                      {line.trackingType === "serial" && Number(row.received) > 0 ? ` · ${quantity(orderQuantity * Number(orderFactor))} serial numbers needed` : ""}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </FormSection>
      <FormSection columns={1} title="Receiving notes" description="Attach the challan, packing slips and photos from the receipt once it is saved; they can be cited as evidence on discrepancies.">
        <TextArea label="Notes" value={header.notes} onChange={setField("notes")} />
      </FormSection>
    </DocumentFormPage>
    
    </>
  );
}

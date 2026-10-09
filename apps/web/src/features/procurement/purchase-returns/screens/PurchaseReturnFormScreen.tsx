"use client";

// New (or draft) purchase return: the goods of one purchase order's posted receipts that go back to the supplier — from usable stock, goods
// on hold, or a rejection case — each with its reason. Saving keeps a draft (no stock moves); posting the dispatch happens on the return.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Checkbox, ErrorState, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { quantity } from "@/features/procurement/shared/format";
import { listPurchaseOrders } from "@/features/procurement/purchase-orders/api/purchase-orders-api";
import { useFormChangesWarning } from "@/features/procurement/shared/navigation";

import {
  createReturn, errorMessage, getEligible, getReturn, getReturnOptions, issuesOf, updateReturn, type EligibleLine, type ReturnDetail, type ReturnOptions,
} from "../api/purchase-returns-api";
import { DocumentFormPage } from "@/shared/ui/DocumentFormPage";
import { FormSection } from "@/shared/ui/FormSection";
import { Notice } from "@/shared/ui/Panel";

type Row = { include: boolean; source: string; quantity: string; reason: string; reasonNotes: string; serialNumbers: string; billingAllocation: string };

export function PurchaseReturnFormScreen({ orderId, receiptId, returnId }: { orderId?: string; receiptId?: string; returnId?: string }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "return-options"), queryFn: getReturnOptions, staleTime: 60_000 });
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "purchase-return", returnId), queryFn: () => getReturn(returnId!), enabled: Boolean(returnId) });
  if (options.isLoading || existing.isLoading) return <LoadingState label="Loading purchase return" />;
  if (!options.data || (returnId && !existing.data)) return <ErrorState title="Could not load the return form" description={errorMessage(options.error ?? existing.error)} />;
  if (existing.data && existing.data.purchaseReturn.status !== "draft") return <ErrorState title="This return cannot be edited" description="Only a draft is edited." />;
  return <ReturnForm options={options.data} existing={existing.data ?? null} presetOrderId={existing.data?.purchaseReturn.purchaseOrderId ?? orderId} receiptId={receiptId} />;
}

// What is physically here to send back (usable stock, held goods, open rejections): the supplier owing a return never makes up for stock that is not here.
const physicalOf = (line: EligibleLine) => Number(line.usable) + line.holds.reduce((sum, hold) => sum + Number(hold.open), 0) + line.rejections.reduce((sum, rejection) => sum + Number(rejection.open), 0);

function sourcesOf(line: EligibleLine) {
  return [
    ...(Number(line.usable) > 0 ? [{ value: "stock", label: `Usable stock (${quantity(line.usable)} returnable)` }] : []),
    ...line.holds.map((hold) => ({ value: `hold:${hold.id}`, label: `${hold.disposition === "inspection_hold" ? "Inspection hold" : "Damaged, held"} (${quantity(hold.open)})` })),
    ...line.rejections.map((rejection) => ({ value: `rejection:${rejection.id}`, label: `Rejection ${rejection.rejectionNumber} (${quantity(rejection.open)})` })),
  ];
}

function ReturnForm({ options, existing, presetOrderId, receiptId }: { options: ReturnOptions; existing: ReturnDetail | null; presetOrderId?: string; receiptId?: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const saved = existing?.purchaseReturn;
  const [orderId, setOrderId] = useState(presetOrderId ?? "");
  const orders = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "returnable-orders"), queryFn: () => listPurchaseOrders({ limit: 200 }), enabled: !presetOrderId && !receiptId });
  const eligible = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "return-eligible", orderId, receiptId, saved?.id),
    queryFn: () => getEligible({ order: orderId || undefined, receipt: !orderId ? receiptId : undefined, exclude: saved?.id }), enabled: Boolean(orderId || receiptId) });
  const [header, setHeader] = useState({
    returnDate: saved?.returnDate ?? "", expectedResolution: saved?.expectedResolution ?? "supplier_credit", supplierRmaReference: saved?.supplierRmaReference ?? "",
    carrierReference: saved?.carrierReference ?? "", trackingReference: saved?.trackingReference ?? "", dispatchReference: saved?.dispatchReference ?? "",
    internalNotes: saved?.internalNotes ?? "", reason: saved?.reason ?? "",
  });
  const set = (key: keyof typeof header) => (value: string) => setHeader((current) => ({ ...current, [key]: value }));
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries((existing?.lines ?? []).map((line) => [line.goodsReceiptLineId, {
    include: true, source: line.rejectionId ? `rejection:${line.rejectionId}` : line.dispositionId ? `hold:${line.dispositionId}` : "stock", quantity: String(Number(line.quantity)),
    reason: line.reason, reasonNotes: line.reasonNotes ?? "", serialNumbers: line.serialNumbers.join(", "), billingAllocation: line.billingAllocation ?? "auto",
  }])));
  const lines = useMemo(() => (eligible.data?.lines ?? []).filter((line) => !receiptId || line.goodsReceiptId === receiptId || rows[line.goodsReceiptLineId]?.include), [eligible.data, receiptId, rows]);
  const rowOf = (line: EligibleLine): Row => rows[line.goodsReceiptLineId] ?? { include: false, source: sourcesOf(line)[0]?.value ?? "stock", quantity: "", reason: "damaged_goods", reasonNotes: "",
    serialNumbers: "", billingAllocation: "auto" };
  const change = (line: EligibleLine, patch: Partial<Row>) => setRows((current) => ({ ...current, [line.goodsReceiptLineId]: { ...rowOf(line), ...patch } }));
  const payload = () => ({
    ...header, returnDate: header.returnDate || undefined, purchaseOrderId: eligible.data?.order.id,
    lines: (eligible.data?.lines ?? []).filter((line) => rowOf(line).include && Number(rowOf(line).quantity) > 0).map((line) => {
      const row = rowOf(line);
      return { goodsReceiptLineId: line.goodsReceiptLineId, quantity: row.quantity, reason: row.reason, reasonNotes: row.reasonNotes || undefined, serialNumbers: row.serialNumbers || undefined,
        billingAllocation: row.billingAllocation, dispositionId: row.source.startsWith("hold:") ? row.source.slice(5) : undefined,
        rejectionId: row.source.startsWith("rejection:") ? row.source.slice(10) : undefined };
    }),
  });
  useFormChangesWarning({ orderId, header, rows });
  const save = useMutation({
    mutationFn: async () => (saved ? (await updateReturn(saved.id, { ...payload(), expectedVersion: saved.version })).id : (await createReturn(payload())).id),
    onSuccess: (id) => router.push(`/procurement/purchase-returns/${id}`),
  });
  const issues = issuesOf(save.error);
  const anySelected = (eligible.data?.lines ?? []).some((line) => rowOf(line).include && Number(rowOf(line).quantity) > 0);
  return (
    <>
    <DocumentFormPage
      header={{
        title: saved ? `Edit ${saved.returnNumber}` : "Create Purchase Return",
        description: "Goods received on posted receipts going back to the supplier. Saving keeps a draft — no stock moves until the dispatch is posted.",
      }}
      banner={<div className="flex flex-col gap-3">
        {Boolean(save.error) && <Notice>{errorMessage(save.error)}{issues.length > 1 && <ul className="mt-1 list-disc pl-5">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</Notice>}
      </div>}
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.push(saved ? `/procurement/purchase-returns/${saved.id}` : "/procurement/purchase-returns")}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!anySelected} onPress={() => save.mutate()}>Save Draft</Button>
        </>
      }
    >
      {!presetOrderId && !receiptId && !saved && (
        <FormSection columns={1} title="Purchase order">
          <Select label="Purchase order" selectedKey={orderId || null} onSelectionChange={(value) => { setOrderId(String(value)); setRows({}); }}
            options={(orders.data?.rows ?? []).filter((order) => ["confirmed", "closed"].includes(order.status)).map((order) => ({ value: order.id, label: `${order.purchaseOrderNumber} · ${order.supplierName}` }))} />
        </FormSection>
      )}

      {eligible.isLoading && <LoadingState label="Loading what can be returned" />}
      {eligible.error && <Notice>{errorMessage(eligible.error)}</Notice>}
      {eligible.data && (
        <FormSection columns={1} title={`Return items — ${eligible.data.order.purchaseOrderNumber}`} description="Never more than a receipt line still has — received less what was already returned — and what is physically there.">
          {!lines.length && <p className="text-sm text-text-muted">No posted receipt of this order has goods left to return.</p>}
          <div className="flex flex-col gap-3">
            {lines.map((line) => {
              const row = rowOf(line);
              const sources = sourcesOf(line);
              return (
                <div key={line.goodsReceiptLineId} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <Checkbox isSelected={row.include} isDisabled={!sources.length} onChange={(value) => change(line, { include: value })}>
                      <span className="font-medium">{line.receiptNumber} line {line.lineNumber}: {line.description}</span>
                    </Checkbox>
                    <span className="text-sm tabular-nums text-text-secondary">Received {quantity(line.received)} · Returned {quantity(line.returned)} · Return entitlement {quantity(line.entitlement)} · Physical stock {quantity(physicalOf(line))} · <span className="font-medium text-text">Returnable now {quantity(Math.min(Number(line.entitlement), physicalOf(line)))} {line.uom ?? ""}</span>
                      {line.warehouseName ? ` · ${line.warehouseName}${line.locationCode ? ` / ${line.locationCode}` : ""}` : ""}</span>
                  </div>
                  {line.draftReturns.length > 0 && <p className="text-xs text-text-muted">{quantity(line.draftQuantity)} is also on draft return{line.draftReturns.length === 1 ? "" : "s"} {line.draftReturns.join(", ")}.</p>}
                  {row.include && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Select label="From" selectedKey={row.source} onSelectionChange={(value) => change(line, { source: String(value) })} options={sources} />
                      <TextField label={`Return now (${line.uom ?? "qty"})`} inputMode="decimal" value={row.quantity} onChange={(value) => change(line, { quantity: value })} />
                      <Select label="Reason" selectedKey={row.reason} onSelectionChange={(value) => change(line, { reason: String(value) })}
                        options={options.reasons.map((reason) => ({ value: reason.code, label: reason.label }))} />
                      <TextField label={row.reason === "other" ? "Explain the reason" : "Reason notes"} value={row.reasonNotes} onChange={(value) => change(line, { reasonNotes: value })} />
                      {line.trackingType === "serial" && <TextField label="Serial numbers (one per unit)" value={row.serialNumbers} onChange={(value) => change(line, { serialNumbers: value })} />}
                      <Select label="Billing" selectedKey={row.billingAllocation} onSelectionChange={(value) => change(line, { billingAllocation: String(value) })}
                        options={[{ value: "auto", label: "Unbilled goods first" }, { value: "unbilled", label: "Goods not billed yet" }, { value: "billed", label: "Goods already billed (vendor credit)" }]} />
                    </div>
                  )}
                  {row.include && ["excess_goods", "surplus_goods"].includes(row.reason) && row.source === "stock" && !options.capabilities.commercial &&
                    <p className="text-xs text-warning">A commercial return of good stock is posted by someone allowed to approve commercial returns.</p>}
                </div>
              );
            })}
          </div>
        </FormSection>
      )}

      <FormSection columns={1} title="Return details">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TextField label="Return date" type="date" value={header.returnDate} onChange={set("returnDate")} description="Today if empty." />
          <Select label="Expected resolution" selectedKey={header.expectedResolution} onSelectionChange={(value) => set("expectedResolution")(String(value))}
            options={options.expectedResolutions.map((entry) => ({ value: entry.code, label: entry.label }))} />
          <TextField label="Supplier RMA" value={header.supplierRmaReference} onChange={set("supplierRmaReference")} />
          <TextField label="Carrier" value={header.carrierReference} onChange={set("carrierReference")} />
          <TextField label="Tracking reference" value={header.trackingReference} onChange={set("trackingReference")} />
          <TextField label="Challan / dispatch reference" value={header.dispatchReference} onChange={set("dispatchReference")} />
        </div>
        <TextArea label="Summary (printed)" value={header.reason} onChange={set("reason")} description="Defaults to the lines' reasons." />
        <TextArea label="Internal notes (never printed)" value={header.internalNotes} onChange={set("internalNotes")} />
      </FormSection>
    </DocumentFormPage>
    
    </>
  );
}

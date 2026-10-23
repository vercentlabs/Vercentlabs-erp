"use client";

// Receive without a purchase order (Create-Where-You-Are PR3): goods that came with no order. The receipt raises and confirms a matching
// order (marked as created from the receipt, with the reason) and drafts the goods receipt against it; lots, serials and inspection are then
// entered on the draft, which is posted as usual. An order that needs approval waits as a draft and nothing is received yet.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useSubmitKey } from "@/shared/http/submit-once";
import { useApp } from "@/shell/workspace-context/useApp";
import { Notice, Panel } from "@/shared/ui/Panel";
import { ProcurementSearchPicker } from "@/features/procurement/shared/ProcurementSearchPicker";

import { errorMessage, receiveWithoutOrder, type PurchaseOrderOptions } from "../api/purchase-orders-api";

type Line = { key: string; productId: string; quantity: string; unitPrice: string };
const blankLine = (): Line => ({ key: crypto.randomUUID(), productId: "", quantity: "1", unitPrice: "" });

export function ReceiveWithoutOrderForm({ options, onCancel }: { options: PurchaseOrderOptions; onCancel: () => void }) {
  const router = useRouter();
  const stockOn = useApp("stock");
  const submit = useSubmitKey();
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState(options.settings.defaultWarehouseId ?? options.warehouses[0]?.id ?? "");
  const [receiptDate, setReceiptDate] = useState("");
  const [challan, setChallan] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const update = (key: string, patch: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const filled = lines.filter((line) => line.productId);
  const valid = supplierId && reason.trim() && filled.length > 0 && filled.every((line) => Number(line.quantity) > 0 && /^\d+(\.\d+)?$/.test(line.unitPrice.trim()))
    && (!stockOn || warehouseId);
  const save = useMutation({
    mutationFn: () => submit.run(() => receiveWithoutOrder({
      supplierId, reason: reason.trim(), ...(stockOn && warehouseId ? { warehouseId } : {}), ...(receiptDate ? { receiptDate } : {}),
      ...(challan.trim() ? { supplierChallanNumber: challan.trim() } : {}),
      lines: filled.map((line) => ({ productId: line.productId, quantity: line.quantity, unitPrice: line.unitPrice.trim() })),
    })),
    onSuccess: (result) => { if (result.receipt) router.replace(`/procurement/goods-receipts/${result.receipt.id}/edit`); },
  });
  const waiting = save.data && !save.data.receipt ? save.data : null;

  return (
    <Panel title="Receive without an order" description="For goods that arrived with no purchase order. A matching order is raised and confirmed with this receipt, so the supplier's bill still matches order, receipt and bill.">
      <div className="grid gap-3 sm:grid-cols-2">
        <ProcurementSearchPicker kind="suppliers" label="Supplier" isRequired activeOnly known={options.suppliers} value={supplierId || null} onPick={(id) => setSupplierId(id)} />
        {stockOn && (
          <Select label="Received into" isRequired selectedKey={warehouseId || null} onSelectionChange={(key) => setWarehouseId(String(key ?? ""))}
            options={options.warehouses.map((warehouse) => ({ value: warehouse.id, label: `${warehouse.code} · ${warehouse.name}` }))} />
        )}
        <TextField label="Receipt date" type="date" value={receiptDate} onChange={setReceiptDate} description="Today when left empty." />
        <TextField label="Supplier challan / delivery note" value={challan} onChange={setChallan} />
      </div>
      <TextArea label="Why there is no order" isRequired value={reason} onChange={setReason} rows={2}
        placeholder="For example: local supplier delivered against a phone order" />
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">What arrived</p>
        {lines.map((line, index) => (
          <div key={line.key} className="grid gap-2 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_auto] sm:items-end">
            <ProcurementSearchPicker kind="products" label={index === 0 ? "Product" : undefined} aria-label={`Line ${index + 1} product`} known={options.products}
              value={line.productId || null} supplierId={supplierId || null}
              onPick={(id, row) => update(line.key, { productId: id, unitPrice: line.unitPrice || String((row as { last_purchase_price?: string | null } | null)?.last_purchase_price ?? "") })} />
            <TextField label={index === 0 ? "Quantity" : undefined} aria-label={`Line ${index + 1} quantity`} inputMode="decimal" value={line.quantity}
              onChange={(value) => update(line.key, { quantity: value.replace(/[^0-9.]/g, "") })} />
            <TextField label={index === 0 ? "Price per unit" : undefined} aria-label={`Line ${index + 1} price`} inputMode="decimal" value={line.unitPrice}
              onChange={(value) => update(line.key, { unitPrice: value.replace(/[^0-9.]/g, "") })} />
            <Button variant="ghost" size="compact" isDisabled={lines.length === 1} onPress={() => setLines((current) => current.filter((candidate) => candidate.key !== line.key))}>Remove</Button>
          </div>
        ))}
        <Button variant="secondary" size="compact" className="w-fit" onPress={() => setLines((current) => [...current, blankLine()])}>
          <Plus className="size-4" aria-hidden="true" />Add line
        </Button>
      </div>
      {save.error && <Notice>{errorMessage(save.error)}</Notice>}
      {waiting && (
        <Notice tone="warning">
          Purchase order {waiting.purchaseOrderNumber} was raised but needs approval before the goods can be received.{" "}
          <Link className="font-medium underline" href={`/procurement/purchase-orders/${waiting.orderId}`}>Open the order</Link>
        </Notice>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onPress={onCancel}>Back to orders</Button>
        <Button variant="primary" isDisabled={!valid || Boolean(waiting)} isLoading={save.isPending} onPress={() => save.mutate()}>Receive goods</Button>
      </div>
    </Panel>
  );
}

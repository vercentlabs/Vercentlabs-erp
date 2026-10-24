"use client";

// Purchasing on an item's page (report Phase 3): its purchase warning, and what each supplier charges for it (Supplier Rates). Shown
// when Procurement is on.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, LinkButton, Select, StatusBadge } from "@vercentlabs/design-system";

import { listSupplierRates } from "@/features/procurement/supplier-rates/api";
import { money, quantity } from "@/features/procurement/shared/format";
import { post } from "@/features/procurement/shared/http";
import { PurchaseWarningDialog } from "./PurchaseWarningDialog";

export function ItemPurchasingCard({ item, canEdit, onChanged }: {
  item: { id: string; name: string; purchaseWarning?: string | null; purchaseWarningLevel?: string; purchaseBillBasis?: string | null }; canEdit: boolean; onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const basis = useMutation({
    mutationFn: (value: string) => post(`/items/${item.id}/bill-basis`, { basis: value === "default" ? null : value }),
    onSuccess: onChanged,
  });
  const rates = useQuery({ queryKey: ["procurement", "supplier-rates", "item", item.id], queryFn: () => listSupplierRates({ itemId: item.id, view: "active", limit: "20" }) });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className={item.purchaseWarning ? (item.purchaseWarningLevel === "block" ? "text-danger" : "text-warning") : "text-text-muted"}>
          {item.purchaseWarning ? `${item.purchaseWarningLevel === "block" ? "Not bought now" : "Purchase warning"}: ${item.purchaseWarning}` : "No purchase warning."}
        </span>
        {canEdit && <Button variant="ghost" size="compact" onPress={() => setOpen(true)}>{item.purchaseWarning ? "Change warning" : "Add purchase warning"}</Button>}
      </div>
      <div className="flex flex-col gap-1 border-t border-border pt-3 sm:max-w-sm">
        <Select label="Bill on" selectedKey={item.purchaseBillBasis ?? "default"} isDisabled={!canEdit || basis.isPending}
          onSelectionChange={(value) => basis.mutate(String(value))} description="Applies to order lines written from now on."
          options={[{ value: "default", label: "The order's rule" }, { value: "order", label: "Quantity ordered" }, { value: "receipt", label: "Quantity received" }]} />
        {basis.error && <p className="text-xs text-danger">{basis.error instanceof Error ? basis.error.message : "Could not save."}</p>}
      </div>
      <div className="flex flex-col gap-1 border-t border-border pt-3">
        <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">Supplier rates</span>
          <LinkButton variant="ghost" size="compact" href="/procurement/supplier-rates/new">Add rate</LinkButton></div>
        {!rates.data?.rows.length ? <p className="text-sm text-text-muted">No current supplier rate.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {rates.data.rows.map((rate) => (
              <li key={rate.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="flex flex-wrap items-center gap-1"><Link className="text-brand hover:underline" href={`/procurement/suppliers/${rate.supplierId}`}>{rate.supplierName}</Link>
                  {rate.preferred && <StatusBadge tone="success">Preferred</StatusBadge>}</span>
                <span className="tabular-nums">{money(rate.currencyCode, rate.rate)} / {rate.uomCode ?? "unit"}{Number(rate.minimumQuantity) > 1 ? ` from ${quantity(rate.minimumQuantity)}` : ""}
                  {rate.leadTimeDays !== null ? ` · ${rate.leadTimeDays} days` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {open && <PurchaseWarningDialog kind="item" id={item.id} name={item.name} level={item.purchaseWarningLevel ?? "warn"} message={item.purchaseWarning ?? null}
        onClose={() => setOpen(false)} onDone={() => { setOpen(false); void queryClient.invalidateQueries({ queryKey: ["procurement"] }); onChanged(); }} />}
    </div>
  );
}

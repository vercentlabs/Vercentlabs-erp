"use client";

// Short stock, shared fairly (Sales plan, Phase 4): a product whose free stock in a warehouse is less than confirmed orders still need
// there is shared in proportion to what each order line needs (whole units, the rest to the oldest orders), instead of the first order
// taking it all. Preview first; Reserve keeps each share aside for its order.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Select } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { Cell, LinesTable } from "@/shared/ui/record";
import { Notice, Panel } from "@/shared/ui/Panel";
import { SalesApiError, post } from "@/features/sales/shared/http";
import { getSalesOptions, type SalesOptions } from "@/features/sales/quotations/api/quotations-api";
import { SalesSearchPicker, mergeSalesOptions } from "@/features/sales/shared/SalesSearchPicker";

type Plan = { available: number; demand: number; preview: boolean; lines: Array<{ orderId: string; orderNumber: string; lineId: string; item: string; unit: string | null; needed: number; share: number; reserved: number }> };
const quantity = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 3 });

export function FairSharePanel() {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options"), queryFn: () => getSalesOptions().then((r) => r.options), staleTime: 60_000 });
  const [found, setFound] = useState<SalesOptions | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const run = useMutation({
    mutationFn: (preview: boolean) => post<{ result: Plan }>("/reservations/fair-share", { itemId, warehouseId, preview, ...(preview ? {} : { idempotencyKey: crypto.randomUUID() }) }),
    onSuccess: ({ result }) => setPlan(result),
  });
  const known = options.data ? (found ? mergeSalesOptions(options.data, found) : options.data) : null;
  const ready = Boolean(itemId && warehouseId);
  return (
    <Panel title="Short stock: share it fairly" description="When stock is short, share it across confirmed orders in proportion instead of first come, first served.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {known && <SalesSearchPicker creatable={false} kind="products" label="Product" value={itemId} known={known}
          onPick={(id, results) => { setFound((current) => mergeSalesOptions(current ?? known, results)); setItemId(id || null); setPlan(null); }} />}
        <Select label="Warehouse" selectedKey={warehouseId || null} onSelectionChange={(key) => { setWarehouseId(String(key ?? "")); setPlan(null); }}
          options={(options.data?.warehouses ?? []).map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))} />
        <div className="flex items-end gap-2">
          <Button variant="secondary" isDisabled={!ready} isLoading={run.isPending && run.variables === true} onPress={() => run.mutate(true)}>Preview</Button>
          {plan?.preview && plan.lines.some((line) => line.share > 0) && (
            <Button variant="primary" isLoading={run.isPending && run.variables === false} onPress={() => run.mutate(false)}>Keep the shares aside</Button>
          )}
        </div>
      </div>
      {run.isError && <Notice tone="danger">{run.error instanceof SalesApiError ? run.error.message : "The stock could not be shared."}</Notice>}
      {plan && (
        <>
          <p className="text-sm text-text-secondary">
            {quantity(plan.available)} free against {quantity(plan.demand)} still needed (in the product&apos;s base unit).
            {plan.available + 1e-6 >= plan.demand ? " There is enough for every order." : ""}{plan.preview ? "" : " Kept aside."}
          </p>
          <LinesTable columns={["Order", { label: "Still needed", numeric: true }, { label: "Share", numeric: true }, ...(plan.preview ? [] : [{ label: "Kept aside", numeric: true }])]}
            empty={plan.lines.length ? undefined : "No confirmed order needs this product from this warehouse."}>
            {plan.lines.map((line) => (
              <tr key={line.lineId}>
                <Cell><Link className="text-brand hover:underline" href={`/sales/orders/${line.orderId}`}>{line.orderNumber}</Link></Cell>
                <Cell numeric>{quantity(line.needed)} {line.unit ?? ""}</Cell>
                <Cell numeric>{quantity(line.share)} {line.unit ?? ""}</Cell>
                {!plan.preview && <Cell numeric>{quantity(line.reserved)}</Cell>}
              </tr>
            ))}
          </LinesTable>
        </>
      )}
    </Panel>
  );
}

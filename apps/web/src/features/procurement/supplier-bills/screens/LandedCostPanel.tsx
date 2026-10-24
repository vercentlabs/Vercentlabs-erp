"use client";

// Landed cost on a posted bill (Procurement plan Phase 3): its freight, loading or insurance shared over the goods receipt lines it was for,
// by value or by quantity. The part of the goods still in stock is revalued; what was already issued stays in the charge's account.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { post, request } from "@/features/procurement/shared/http";
import { calendarDate, money, quantity } from "@/features/procurement/shared/format";

type LandedCost = {
  available: boolean; stockOn: boolean;
  charges: Array<{ id: string; description: string | null; amount: string; allocated: string; left: string }>;
  receipts: Array<{ id: string; goodsReceiptId: string; receiptNumber: string; receiptDate: string; productId: string; productName: string; quantity: string; value: string; purchaseOrderNumber: string;
    supplierName: string | null; vehicleNumber: string | null; ewbNumber: string | null }>;
  anySupplier: boolean;
  allocated: Array<{ id: string; billLineId: string; basis: string; amount: string; stockAmount: string; createdAt: string; reversedAt: string | null;
    allocations: Array<{ receiptNumber: string; product: string; amount: string; stockAmount: string }> }>;
};

export function LandedCostPanel({ billId, currencyCode }: { billId: string; currencyCode: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const key = scopedQueryKey(workspace, "procurement", "landed-cost", billId);
  const query = useQuery({ queryKey: [...key, search], placeholderData: (previous) => previous,
    queryFn: () => request<{ landedCost: LandedCost }>(`/supplier-bills/${billId}/landed-cost${search ? `?search=${encodeURIComponent(search)}` : ""}`).then((result) => result.landedCost) });
  const [open, setOpen] = useState(false);
  const [charge, setCharge] = useState("");
  const [basis, setBasis] = useState("value");
  const [chosen, setChosen] = useState<string[]>([]);
  const run = useMutation({
    mutationFn: () => post<{ result: { amount: string; stockAmount: string; issuedAmount: string } }>(`/supplier-bills/${billId}/landed-cost`, { billLineId: charge, basis, receiptLineIds: chosen }).then((answer) => answer.result),
    onSuccess: () => { setOpen(false); setChosen([]); void queryClient.invalidateQueries({ queryKey: key }); },
  });
  const data = query.data;
  if (!data || !data.stockOn || (!data.available && !data.allocated.length)) return null;
  const c = (value: string) => money(currencyCode, value);
  const open_ = data.charges.filter((line) => Number(line.left) > 0);
  return (
    <Panel title="Freight added to item cost" description="Freight and other charges on this bill added to the value of the goods they brought."
      actions={data.available && !open ? <Button size="compact" variant="secondary" onPress={() => { setOpen(true); setCharge(open_[0]?.id ?? ""); }}>Share a charge over goods</Button> : undefined}>
      {run.error && <Notice>{run.error instanceof Error ? run.error.message : "Could not match."}</Notice>}
      {run.data && <Notice tone="success">{c(run.data.stockAmount)} added to stock value{Number(run.data.issuedAmount) > 0 ? `; ${c(run.data.issuedAmount)} was for goods already issued and stays an expense` : ""}.</Notice>}
      {open && (
        <div className="mb-3 flex flex-col gap-3 rounded-[var(--radius-control)] border border-border p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Select label="Charge" selectedKey={charge || null} onSelectionChange={(value) => setCharge(String(value))}
              options={open_.map((line) => ({ value: line.id, label: `${line.description ?? "Charge"} · ${c(line.left)} left` }))} />
            <Select label="Share by" selectedKey={basis} onSelectionChange={(value) => setBasis(String(value))}
              options={[{ value: "value", label: "Value of the goods" }, { value: "quantity", label: "Quantity" }]} />
          </div>
          {data.anySupplier && (
            <TextField label="Find the goods" value={search} onChange={setSearch} description="Receipt or order number, supplier, vehicle or e-way bill." />
          )}
          {data.receipts.length === 0 && <p className="text-sm text-text-muted">No goods receipts match.</p>}
          <div className="flex max-h-60 flex-col divide-y divide-border overflow-y-auto rounded-[var(--radius-control)] border border-border text-sm">
            {data.receipts.map((line) => (
              <label key={line.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <Checkbox isSelected={chosen.includes(line.id)} onChange={(on) => setChosen((state) => (on ? [...state, line.id] : state.filter((id) => id !== line.id)))}>
                  <span>{line.receiptNumber} · {line.productName}<span className="block text-xs text-text-muted">{[calendarDate(line.receiptDate), line.purchaseOrderNumber, data.anySupplier ? line.supplierName : null, line.vehicleNumber].filter(Boolean).join(" · ")}</span></span>
                </Checkbox>
                <span className="text-right tabular-nums">{quantity(line.quantity)}<span className="block text-xs text-text-muted">{c(line.value)}</span></span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2"><Button variant="secondary" onPress={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" isDisabled={!charge || !chosen.length} isLoading={run.isPending} onPress={() => run.mutate()}>Match</Button></div>
        </div>
      )}
      {data.allocated.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {data.allocated.map((row) => (
            <li key={row.id} className="py-2">
              <span className="flex flex-wrap items-center gap-2 font-medium">{c(row.amount)} by {row.basis}{row.reversedAt ? <StatusBadge tone="neutral">Taken off: bill cancelled</StatusBadge> : <StatusBadge tone="success">{`${c(row.stockAmount)} to stock`}</StatusBadge>}</span>
              <span className="text-xs text-text-muted">{row.allocations.map((entry) => `${entry.receiptNumber} ${entry.product}: ${c(entry.amount)}`).join(" · ")}</span>
            </li>
          ))}
        </ul>
      ) : !open && <p className="text-sm text-text-muted">Nothing shared yet.</p>}
    </Panel>
  );
}

"use client";

// A price list's rules (Sales report Phase 3): its prices worked out from cost or from another list, rounded. "Work out prices" first
// shows every change, then writes them; each change keeps the old price in the list's history.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button, Dialog, NumberField, Select } from "@vercentlabs/design-system";

import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { listCategories } from "@/features/items/api/items-api";
import { Cell, LinesTable } from "@/shared/ui/record";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { del, post, request } from "@/features/sales/shared/http";
import { SalesSearchPicker } from "@/features/sales/shared/SalesSearchPicker";
import { getSalesOptions } from "@/features/sales/quotations/api/quotations-api";
import { money } from "@/features/sales/shared/format";

type Formula = { id: string; appliesTo: "all" | "category" | "product"; categoryName: string | null; productName: string | null; description: string };
type Change = { itemId: string; name: string; from: number | null; to: number; rule: string };
type WorkOut = { changes: Change[]; skipped: Array<{ itemId: string; name: string; reason: string }>; applied: boolean };
const ROUNDING = [{ value: "none", label: "As worked out" }, { value: "whole", label: "Whole rupees" }, { value: "end_9", label: "Ending in 9" }, { value: "end_99", label: "Ending in .99" }];

export function PriceRulesPanel({ priceListId, currencyCode, canManage }: { priceListId: string; currencyCode: string; canManage: boolean }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "price-rules", priceListId), queryFn: () => request<{ formulas: Formula[] }>(`/price-lists/${priceListId}/formulas`) });
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<WorkOut | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const workOut = useMutation({
    mutationFn: (apply: boolean) => post<WorkOut>(`/price-lists/${priceListId}/formulas/work-out`, { apply }),
    onSuccess: (result) => {
      if (result.applied) { setPreview(null); setNotice(`${result.changes.length} ${result.changes.length === 1 ? "price" : "prices"} written.`); } else setPreview(result);
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => del(`/price-lists/${priceListId}/formulas/${id}`), onSuccess: () => void query.refetch() });
  const formulas = query.data?.formulas ?? [];
  const label = (formula: Formula) => (formula.appliesTo === "all" ? "All products" : formula.appliesTo === "category" ? `Category: ${formula.categoryName}` : `Product: ${formula.productName}`);
  return (
    <Panel title="Price rules" description="Work this list's prices out from cost or from another list."
      actions={canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button size="compact" variant="secondary" onPress={() => setAdding(true)}><Plus className="size-3.5" aria-hidden="true" />Add rule</Button>
          {formulas.length > 0 && <Button size="compact" variant="primary" isLoading={workOut.isPending && workOut.variables === false} onPress={() => workOut.mutate(false)}>Work out prices</Button>}
        </div>
      ) : undefined}>
      {notice && <Notice tone="success">{notice}</Notice>}
      {(workOut.isError || remove.isError) && <Notice tone="danger">{((workOut.error ?? remove.error) as Error).message}</Notice>}
      {formulas.length === 0 ? <p className="text-sm text-text-secondary">No rules: prices are typed or imported. A product rule comes before a category rule, which comes before all products.</p> : (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {formulas.map((formula) => (
            <li key={formula.id} className="flex items-center justify-between gap-3 py-2">
              <span className="flex min-w-0 flex-col"><span className="font-medium">{label(formula)}</span><span className="text-xs text-text-secondary">{formula.description}</span></span>
              {canManage && <MoreMenu label={`Actions for ${label(formula)}`} items={[{ id: "delete", label: "Delete rule", danger: true, onAction: () => remove.mutate(formula.id),
                confirm: { title: "Delete this rule?", description: "Prices already written stay as they are.", confirmLabel: "Delete rule" } }]} />}
            </li>
          ))}
        </ul>
      )}
      {adding && <RuleDialog priceListId={priceListId} currencyCode={currencyCode} onClose={() => setAdding(false)} onDone={() => { setAdding(false); void query.refetch(); }} />}
      {preview && (
        <Dialog isOpen onOpenChange={(open) => !open && setPreview(null)} size="lg" title="Prices the rules work out"
          description={preview.changes.length ? `${preview.changes.length} ${preview.changes.length === 1 ? "price changes" : "prices change"}. The old ones stay in the history.` : "Every price already matches its rule."}>
          <div className="flex flex-col gap-3">
            {preview.changes.length > 0 && (
              <div className="max-h-96 overflow-y-auto">
                <LinesTable columns={["Product", { label: "Now", numeric: true }, { label: "New", numeric: true }, "Rule"]}>
                  {preview.changes.map((change) => (
                    <tr key={change.itemId}>
                      <Cell>{change.name}</Cell>
                      <Cell numeric>{change.from === null ? "Not on the list" : money(currencyCode, change.from)}</Cell>
                      <Cell numeric>{money(currencyCode, change.to)}</Cell>
                      <Cell>{change.rule}</Cell>
                    </tr>
                  ))}
                </LinesTable>
              </div>
            )}
            {preview.skipped.length > 0 && <Notice tone="warning">{`Not priced: ${preview.skipped.map((entry) => `${entry.name} (${entry.reason.replace(/\.$/, "").toLowerCase()})`).join(", ")}.`}</Notice>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" className="w-full sm:w-auto" onPress={() => setPreview(null)}>Close</Button>
              {preview.changes.length > 0 && <Button variant="primary" className="w-full sm:w-auto" isLoading={workOut.isPending} onPress={() => workOut.mutate(true)}>Write these prices</Button>}
            </div>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}

function RuleDialog({ priceListId, currencyCode, onClose, onDone }: { priceListId: string; currencyCode: string; onClose: () => void; onDone: () => void }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options"), queryFn: () => getSalesOptions().then((result) => result.options), staleTime: 60_000 });
  const categories = useQuery({ queryKey: scopedQueryKey(workspace, "products", "categories", "active"), queryFn: () => listCategories({ status: "active" }) });
  const [appliesTo, setAppliesTo] = useState<"all" | "category" | "product">("all");
  const [categoryId, setCategoryId] = useState("");
  const [itemId, setItemId] = useState("");
  const [base, setBase] = useState<"cost" | "list">("cost");
  const [baseListId, setBaseListId] = useState("");
  const [percent, setPercent] = useState(25);
  const [rounding, setRounding] = useState("none");
  const lists = (options.data?.priceLists ?? []).filter((list) => list.id !== priceListId && list.currency_code.trim() === currencyCode);
  const save = useMutation({
    mutationFn: () => post(`/price-lists/${priceListId}/formulas`, { appliesTo, itemGroupId: appliesTo === "category" ? categoryId : null, itemId: appliesTo === "product" ? itemId : null,
      base, basePriceListId: base === "list" ? baseListId : null, percent, rounding }),
    onSuccess: onDone,
  });
  const ready = (appliesTo !== "category" || categoryId) && (appliesTo !== "product" || itemId) && (base !== "list" || baseListId) && Number.isFinite(percent);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Add a price rule" description="For example: cost + 25%, or the distributor list − 10%.">
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (ready) save.mutate(); }}>
        {save.isError && <Notice tone="danger">{(save.error as Error).message}</Notice>}
        <Select label="Prices" selectedKey={appliesTo} onSelectionChange={(key) => setAppliesTo(key === "category" ? "category" : key === "product" ? "product" : "all")}
          options={[{ value: "all", label: "All products" }, { value: "category", label: "One category" }, { value: "product", label: "One product" }]} />
        {appliesTo === "category" && <Select label="Category" selectedKey={categoryId || null} onSelectionChange={(key) => setCategoryId(String(key))}
          options={(categories.data ?? []).map((category) => ({ value: category.id, label: category.path || category.name }))} />}
        {appliesTo === "product" && options.data && <SalesSearchPicker kind="products" label="Product" known={options.data} value={itemId || null} onPick={(id) => setItemId(id)} />}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Starts from" selectedKey={base} onSelectionChange={(key) => setBase(key === "list" ? "list" : "cost")}
            options={[{ value: "cost", label: "The product's cost" }, { value: "list", label: "Another price list" }]} />
          {base === "list" && <Select label="Price list" selectedKey={baseListId || null} onSelectionChange={(key) => setBaseListId(String(key))}
            options={lists.map((list) => ({ value: list.id, label: list.name }))} />}
          <NumberField label="Change (%)" value={percent} onChange={(value) => setPercent(Number.isFinite(value) ? value : 0)} minValue={-99} maxValue={1000} step={0.5}
            description="Plus to add, minus to take off." />
          <Select label="Rounding" selectedKey={rounding} onSelectionChange={(key) => setRounding(String(key))} options={ROUNDING} />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="w-full sm:w-auto" onPress={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" className="w-full sm:w-auto" isLoading={save.isPending} isDisabled={!ready}>Add rule</Button>
        </div>
      </form>
    </Dialog>
  );
}

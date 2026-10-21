"use client";

// The scheme / special rate form (Sales audit M3): who it is for, what it is on, what it gives, from what quantity and when.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, ComboBox, Dialog, NumberField, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { listCategories } from "@/features/items/api/items-api";
import { errorMessage, fieldErrors, listPriceLists } from "@/features/sales/price-lists/api/price-lists-api";
import { searchSalesOptions } from "@/features/sales/quotations/api/quotations-api";

import { createPricingRule, updatePricingRule, type PricingRule, type PricingRuleInput, type PricingRuleType } from "../api/pricing-rules-api";

const TYPES: Array<{ value: PricingRuleType; label: string }> = [
  { value: "fixed_rate", label: "Special rate for a product" },
  { value: "discount_percent", label: "Discount % (a quantity slab when a minimum is set)" },
  { value: "discount_amount", label: "Amount off each unit" },
  { value: "free_goods", label: "Free goods (buy so many, get so many free)" },
];
const ANY = "any";

// A customer or product found by typing (the same search the document forms use).
function RecordPicker({ kind, label, value, valueLabel, onChange, description }: {
  kind: "customers" | "products"; label: string; value: string | null; valueLabel: string | null; onChange: (id: string | null, name: string | null) => void; description?: string;
}) {
  const workspace = useWorkspaceContext();
  const [text, setText] = useState("");
  const typed = text.trim() === (valueLabel ?? "") ? "" : text.trim();
  const search = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "options-search", kind, typed),
    queryFn: () => searchSalesOptions(kind, typed).then((r) => r.results),
    staleTime: 15_000,
  });
  const found = kind === "customers"
    ? (search.data?.parties ?? []).map((party) => ({ value: party.id, label: party.display_name }))
    : (search.data?.items ?? []).map((item) => ({ value: item.id, label: item.name }));
  const options = value && valueLabel && !found.some((option) => option.value === value) ? [{ value, label: valueLabel }, ...found] : found;
  return (
    <ComboBox label={label} description={description} options={options} selectedKey={value} onInputChange={setText} isLoading={search.isFetching} allowsEmptyCollection
      defaultFilter={() => true} placeholder={kind === "customers" ? "Search customers" : "Search products"}
      emptyMessage={kind === "customers" ? "No matching customers" : "No matching products"}
      onSelectionChange={(key) => { const id = key ? String(key) : null; onChange(id, options.find((option) => option.value === id)?.label ?? null); }} />
  );
}

export function PricingRuleDialog({ rule, onClose, onSaved }: { rule?: PricingRule; onClose: () => void; onSaved: (rule: PricingRule) => void }) {
  const workspace = useWorkspaceContext();
  const [values, setValues] = useState({
    name: rule?.name ?? "",
    adjustmentType: rule?.adjustmentType ?? ("discount_percent" as PricingRuleType),
    adjustmentValue: rule?.adjustmentValue ?? NaN,
    who: rule?.partyId ? "customer" : rule?.partyType === "customer" ? "customer_only" : ANY,
    partyId: rule?.partyId ?? null, partyName: rule?.partyName ?? null,
    on: rule?.itemGroupId ? "category" : rule?.itemId ? "product" : "all",
    itemId: rule?.itemId ?? null, itemName: rule?.itemName ?? null, itemGroupId: rule?.itemGroupId ?? "",
    priceListId: rule?.priceListId ?? ANY,
    minimumQuantity: rule?.minimumQuantity ?? 0,
    freeSame: !rule?.freeItemId, freeItemId: rule?.freeItemId ?? null, freeItemName: rule?.freeItemName ?? null, freeQuantity: rule?.freeQuantity ?? 1,
    validFrom: rule?.validFrom ?? "", validTo: rule?.validTo ?? "", priority: rule?.priority ?? NaN, reason: rule?.reason ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof values>(key: K) => (value: (typeof values)[K]) => { setValues((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: "" })); };
  const categories = useQuery({ queryKey: scopedQueryKey(workspace, "items", "categories", "rule-form"), queryFn: () => listCategories({}), staleTime: 60_000 });
  const priceLists = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "price-lists", { status: "active" }), queryFn: () => listPriceLists({ status: "active" }), staleTime: 60_000 });
  const free = values.adjustmentType === "free_goods";
  const save = useMutation({
    mutationFn: () => {
      const input: PricingRuleInput = {
        name: values.name.trim(), adjustmentType: values.adjustmentType, adjustmentValue: free ? 0 : values.adjustmentValue,
        partyId: values.who === "customer" ? values.partyId : null, partyType: values.who === "customer_only" ? "customer" : null,
        itemId: values.on === "product" ? values.itemId : null, itemGroupId: values.on === "category" ? values.itemGroupId || null : null,
        priceListId: values.priceListId === ANY ? null : values.priceListId, minimumQuantity: values.minimumQuantity || 0,
        freeItemId: free && !(values.freeSame && values.on === "product") ? values.freeItemId : null, freeQuantity: free ? values.freeQuantity : null,
        validFrom: values.validFrom || null, validTo: values.validTo || null, reason: values.reason.trim() || null,
        ...(Number.isFinite(values.priority) ? { priority: values.priority } : {}),
      };
      return rule ? updatePricingRule(rule.id, input) : createPricingRule(input);
    },
    onSuccess: onSaved,
    onError: (failure) => { setErrors(fieldErrors(failure)); setError(errorMessage(failure)); },
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={rule ? `Edit ${rule.name}` : "New scheme or rate"} size="lg"
      description="Applied when a quotation or order is priced, on top of the price list. Documents already priced keep their prices.">
      <div className="flex flex-col gap-4 overflow-y-auto pr-1">
        {error && <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField className="sm:col-span-2" label="Name" isRequired value={values.name} onChange={set("name")} errorMessage={errors.name} placeholder="Diwali scheme: buy 10 get 1" autoFocus />
          <Select className="sm:col-span-2" label="It gives" selectedKey={values.adjustmentType} onSelectionChange={(key) => set("adjustmentType")(String(key) as PricingRuleType)} options={TYPES}
            errorMessage={errors.adjustmentType} />
          <Select label="For" selectedKey={values.who} onSelectionChange={(key) => set("who")(String(key))}
            options={[{ value: ANY, label: "Everyone (customers and prospects)" }, { value: "customer", label: "One customer" }, { value: "customer_only", label: "Customers only (not prospects)" }]} />
          {values.who === "customer"
            ? <RecordPicker kind="customers" label="Customer" value={values.partyId} valueLabel={values.partyName} onChange={(id, name) => setValues((current) => ({ ...current, partyId: id, partyName: name }))} />
            : <span />}
          <Select label="On" selectedKey={values.on} onSelectionChange={(key) => set("on")(String(key))}
            options={[{ value: "product", label: "One product" }, { value: "category", label: "A category" }, ...(values.adjustmentType === "fixed_rate" ? [] : [{ value: "all", label: "Every product" }])]} />
          {values.on === "product" && (
            <RecordPicker kind="products" label="Product" value={values.itemId} valueLabel={values.itemName} onChange={(id, name) => setValues((current) => ({ ...current, itemId: id, itemName: name }))} />
          )}
          {values.on === "category" && (
            <Select label="Category" selectedKey={values.itemGroupId || null} onSelectionChange={(key) => set("itemGroupId")(String(key ?? ""))} errorMessage={errors.itemGroupId}
              options={(categories.data ?? []).map((category) => ({ value: category.id, label: category.path || category.name }))} />
          )}
          {values.on === "all" && <span />}
          {!free && (
            <NumberField label={values.adjustmentType === "fixed_rate" ? "Rate (per base unit)" : values.adjustmentType === "discount_percent" ? "Discount %" : "Amount off (per base unit)"}
              isRequired value={values.adjustmentValue} onChange={set("adjustmentValue")} minValue={0} maxValue={values.adjustmentType === "discount_percent" ? 100 : undefined} step={0.01}
              errorMessage={errors.adjustmentValue} />
          )}
          <NumberField label={free ? "Buy (base units)" : "From quantity (base units)"} description={free ? undefined : "0: any quantity. Slabs of one scheme share a priority; the highest slab reached applies."}
            value={values.minimumQuantity} onChange={set("minimumQuantity")} minValue={0} step={1} errorMessage={errors.minimumQuantity} />
          {free && (
            <>
              <NumberField label="Get free (base units)" isRequired value={values.freeQuantity ?? NaN} onChange={set("freeQuantity")} minValue={0} step={1} errorMessage={errors.freeQuantity} />
              {values.on === "product" && (
                <Select label="Free product" selectedKey={values.freeSame ? "same" : "other"} onSelectionChange={(key) => set("freeSame")(key === "same")}
                  options={[{ value: "same", label: "The same product" }, { value: "other", label: "Another product" }]} />
              )}
              {(!values.freeSame || values.on !== "product") && (
                <RecordPicker kind="products" label="Free product" value={values.freeItemId} valueLabel={values.freeItemName}
                  onChange={(id, name) => setValues((current) => ({ ...current, freeItemId: id, freeItemName: name }))} />
              )}
            </>
          )}
          <Select label="Price list" description="Only on documents priced from this list." selectedKey={values.priceListId} onSelectionChange={(key) => set("priceListId")(String(key))}
            options={[{ value: ANY, label: "Any price list" }, ...(priceLists.data?.priceLists ?? []).map((list) => ({ value: list.id, label: `${list.name} (${list.currencyCode})` }))]} />
          <NumberField label="Priority" description="Lower applies first. Empty: rates 100, discounts and schemes 200." value={values.priority} onChange={set("priority")} minValue={1} maxValue={10000} step={1}
            errorMessage={errors.priority} />
          <TextField label="Valid from" type="date" value={values.validFrom} onChange={set("validFrom")} errorMessage={errors.validFrom} />
          <TextField label="Valid until" type="date" value={values.validTo} onChange={set("validTo")} errorMessage={errors.validTo} />
          <TextArea className="sm:col-span-2" label="Note" rows={2} value={values.reason} onChange={set("reason")} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>{rule ? "Save" : "Create"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

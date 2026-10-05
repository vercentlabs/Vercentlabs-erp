"use client";

// The price list form (new, edit, copy) and the price form (add, edit).
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Checkbox, ComboBox, Dialog, NumberField, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { listProducts } from "@/features/sales/products/api/products-api";

import {
  addPrice, copyPriceList, createPriceList, errorMessage, fieldErrors, updatePrice, updatePriceList, type PriceEntry, type PriceList, type PriceListCapabilities,
} from "../api/price-lists-api";

const Banner = ({ message }: { message: string | null }) =>
  message ? <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{message}</p> : null;

// New price list, edit, or copy of an existing one.
export function PriceListFormDialog({ mode, priceList, currencies, capabilities, onClose, onSaved }: {
  mode: "new" | "edit" | "copy"; priceList?: PriceList; currencies: Array<{ code: string; name: string }>; capabilities: PriceListCapabilities;
  onClose: () => void; onSaved: (priceList: PriceList) => void;
}) {
  const [values, setValues] = useState({
    code: mode === "edit" ? priceList?.code ?? "" : "",
    name: mode === "edit" ? priceList?.name ?? "" : mode === "copy" ? `${priceList?.name ?? ""} (copy)` : "",
    description: priceList?.description ?? "",
    currencyCode: priceList?.currencyCode ?? currencies[0]?.code ?? "INR",
    taxInclusive: priceList?.taxInclusive ?? false,
    validFrom: priceList?.validFrom ?? "",
    validTo: priceList?.validTo ?? "",
    isDefault: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof values>(key: K) => (value: (typeof values)[K]) => { setValues((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: "" })); };
  const save = useMutation({
    mutationFn: () => {
      const input = { code: values.code.trim(), name: values.name.trim(), description: values.description.trim() || null, validFrom: values.validFrom || null, validTo: values.validTo || null };
      if (mode === "copy") return copyPriceList(priceList!.id, input);
      if (mode === "edit") {
        const changed: Record<string, unknown> = {};
        for (const [key, value] of Object.entries({ ...input, currencyCode: values.currencyCode, taxInclusive: values.taxInclusive }))
          if (String(value ?? "") !== String((priceList as unknown as Record<string, unknown>)[key] ?? "")) changed[key] = value;
        return updatePriceList(priceList!.id, changed);
      }
      return createPriceList({ ...input, currencyCode: values.currencyCode, taxInclusive: values.taxInclusive, ...(values.isDefault ? { isDefault: true } : {}) } as never);
    },
    onSuccess: onSaved,
    onError: (failure) => { setErrors(fieldErrors(failure)); setError(errorMessage(failure)); },
  });
  const title = mode === "copy" ? `Copy ${priceList?.name}` : mode === "edit" ? `Edit ${priceList?.name}` : "New price list";
  const description = mode === "copy" ? "A new list with the same currency, tax mode and current and future prices. Then change only what differs."
    : mode === "edit" ? "Documents already priced from this list keep their prices." : "One currency per list. Prices are entered after the list is created.";
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title} description={description} size="lg">
      <div className="flex flex-col gap-4 overflow-y-auto pr-1">
        <Banner message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Code" isRequired value={values.code} onChange={(value) => set("code")(value.toUpperCase())} placeholder="PL-STANDARD-INR" errorMessage={errors.code} autoFocus />
          <TextField label="Name" isRequired value={values.name} onChange={set("name")} errorMessage={errors.name} />
          <Select label="Currency" isRequired selectedKey={values.currencyCode} onSelectionChange={(key) => set("currencyCode")(String(key))} isDisabled={mode === "copy"}
            options={currencies.map((currency) => ({ value: currency.code, label: `${currency.code} – ${currency.name}` }))} errorMessage={errors.currencyCode}
            description={mode === "edit" ? "Cannot change once documents were priced from this list." : undefined} />
          <Select label="Prices are" selectedKey={values.taxInclusive ? "inclusive" : "exclusive"} onSelectionChange={(key) => set("taxInclusive")(key === "inclusive")}
            isDisabled={mode === "copy" || (mode === "edit" && !capabilities.changeTaxMode)}
            options={[{ value: "exclusive", label: "Tax exclusive (tax added on top)" }, { value: "inclusive", label: "Tax inclusive (tax inside the price)" }]} />
          <TextField label="Valid from" type="date" value={values.validFrom} onChange={set("validFrom")} errorMessage={errors.validFrom} />
          <TextField label="Valid until" type="date" value={values.validTo} onChange={set("validTo")} errorMessage={errors.validTo} />
          <TextArea className="sm:col-span-2" label="Description" rows={2} value={values.description} onChange={set("description")} />
        </div>
        {mode === "new" && capabilities.setDefault && (
          <Checkbox isSelected={values.isDefault} onChange={set("isDefault")}>Default price list for {values.currencyCode} (used when a customer has no price list)</Checkbox>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>{mode === "copy" ? "Create copy" : mode === "edit" ? "Save" : "Create price list"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// Add a price, or change the price or dates of one.
export function PriceDialog({ priceList, entry, onClose, onSaved }: { priceList: PriceList; entry?: PriceEntry; onClose: () => void; onSaved: () => void }) {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState<string | null>(entry?.productId ?? null);
  const [uomId, setUomId] = useState<string>(entry?.uomId ?? "");
  const [unitPrice, setUnitPrice] = useState<number>(entry?.unitPrice ?? 0);
  const [validFrom, setValidFrom] = useState(entry?.validFrom ?? "");
  const [validTo, setValidTo] = useState(entry?.validTo ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const products = useQuery({
    queryKey: scopedQueryKey(workspace, "products", "price-picker", search),
    queryFn: () => listProducts({ search: search || undefined, status: "active", sellable: "yes", limit: 30 }),
    enabled: !entry,
  });
  const chosen = products.data?.products.find((product) => product.id === productId);
  // The units a product can be priced in: its base unit and the units it converts to.
  const units = chosen
    ? [chosen.baseUom && { value: chosen.baseUomId, label: `${chosen.baseUom.name} (${chosen.baseUom.code}) – base unit` },
      chosen.salesUomId !== chosen.baseUomId && chosen.salesUom && { value: chosen.salesUomId, label: `${chosen.salesUom.name} (${chosen.salesUom.code}) = ${chosen.salesUomFactor} ${chosen.baseUom?.code}` }]
      .filter((entryOption): entryOption is { value: string; label: string } => Boolean(entryOption))
    : [];
  const save = useMutation({
    mutationFn: () => entry
      ? updatePrice(priceList.id, entry.id, { unitPrice, validFrom: validFrom || null, validTo: validTo || null })
      : addPrice(priceList.id, { productId: productId ?? undefined, uomId: uomId || null, unitPrice, validFrom: validFrom || null, validTo: validTo || null }),
    onSuccess: onSaved,
    onError: (failure) => { setErrors(fieldErrors(failure)); setError(errorMessage(failure)); },
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={entry ? `${entry.productName} (${entry.uomCode})` : "Add price"}
      description={entry ? "Change the price or its dates. A new price from a later date is better added as a separate price, so the history shows both." : `Prices on this list are in ${priceList.currencyCode}, ${priceList.taxInclusive ? "including" : "excluding"} tax.`}>
      <div className="flex flex-col gap-4">
        <Banner message={error} />
        {!entry && (
          <>
            <ComboBox label="Product or service" isRequired placeholder="Search by code, name or SKU" selectedKey={productId}
              onSelectionChange={(key) => { setProductId(key ? String(key) : null); setUomId(""); }} onInputChange={setSearch} isLoading={products.isFetching} emptyMessage="No sellable products match"
              options={(products.data?.products ?? []).map((product) => ({ value: product.id, label: `${product.name} (${product.code})` }))} errorMessage={errors.productId} />
            {chosen && units.length > 1 && (
              <Select label="Unit" selectedKey={uomId || chosen.baseUomId} onSelectionChange={(key) => setUomId(String(key))} options={units} errorMessage={errors.uomId} />
            )}
          </>
        )}
        <NumberField label={`Unit price (${priceList.currencyCode})`} isRequired value={unitPrice} onChange={setUnitPrice} minValue={0}
          formatOptions={{ style: "currency", currency: priceList.currencyCode }} errorMessage={errors.unitPrice} description="Zero is allowed, for samples or included services." />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Valid from" type="date" value={validFrom} onChange={setValidFrom} errorMessage={errors.validFrom} />
          <TextField label="Valid until" type="date" value={validTo} onChange={setValidTo} errorMessage={errors.validTo} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!entry && !productId} onPress={() => save.mutate()}>{entry ? "Save price" : "Add price"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

"use client";

// The product and service form: Basic Information, Commercial, Purchasing,
// Inventory, Tax and Status. Fields change with the type: a service has no
// inventory section and takes a SAC; a stock item tracks inventory and takes
// an HSN. Fields the user may not change are shown read-only.
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge, Button, Checkbox, NumberField, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  createProduct, errorMessage, fieldErrors, findDuplicateProducts, updateProduct, type Product, type ProductInput, type ProductOptions, type ProductType,
} from "../api/products-api";
import { ErrorBanner, NONE, orNull, withNone } from "../product-format";
import { useSubmitKey } from "@/shared/http/submit-once";

type Values = {
  type: ProductType; code: string; name: string; categoryId: string; description: string; salesDescription: string; purchaseDescription: string; sku: string; barcode: string;
  baseUomId: string; salesUomId: string; salesUomFactor: number; purchaseUomId: string; purchaseUomFactor: number; isSellable: boolean; isPurchasable: boolean; hsnSacCode: string;
  taxCategoryId: string; defaultSalesPrice: number; defaultPurchaseCost: number; standardCost: number; trackingType: string; allowNegativeStock: boolean; requiresExpiryDate: boolean; valuationMethod: string;
  status: string;
};

function initial(product?: Product): Values {
  return {
    type: product?.type ?? "stock", code: product?.code ?? "", name: product?.name ?? "", categoryId: product?.categoryId ?? NONE, description: product?.description ?? "",
    salesDescription: product?.salesDescription ?? "", purchaseDescription: product?.purchaseDescription ?? "", sku: product?.sku ?? "", barcode: product?.barcode ?? "",
    baseUomId: product?.baseUomId ?? "", salesUomId: product && product.salesUomId !== product.baseUomId ? product.salesUomId : NONE, salesUomFactor: product?.salesUomFactor ?? 1,
    purchaseUomId: product && product.purchaseUomId !== product.baseUomId ? product.purchaseUomId : NONE, purchaseUomFactor: product?.purchaseUomFactor ?? 1,
    isSellable: product?.isSellable ?? true, isPurchasable: product?.isPurchasable ?? true, hsnSacCode: product?.hsnSacCode ?? "", taxCategoryId: product?.taxCategoryId ?? NONE,
    defaultSalesPrice: product?.defaultSalesPrice ?? 0, defaultPurchaseCost: product?.defaultPurchaseCost ?? 0, standardCost: product?.standardCost ?? 0,
    trackingType: product?.trackingType ?? "none", allowNegativeStock: product?.allowNegativeStock ?? false, requiresExpiryDate: product?.requiresExpiryDate ?? false, valuationMethod: product?.valuationMethod ?? "moving_average", status: "active",
  };
}

function toInput(values: Values, creating: boolean): ProductInput {
  const service = values.type === "service";
  const input: ProductInput = {
    type: values.type, name: values.name.trim(), categoryId: orNull(values.categoryId), description: values.description.trim() || null, salesDescription: values.salesDescription.trim() || null,
    purchaseDescription: values.purchaseDescription.trim() || null, baseUomId: values.baseUomId, salesUomId: orNull(values.salesUomId),
    salesUomFactor: orNull(values.salesUomId) ? values.salesUomFactor : null, purchaseUomId: orNull(values.purchaseUomId), purchaseUomFactor: orNull(values.purchaseUomId) ? values.purchaseUomFactor : null,
    isSellable: values.isSellable, isPurchasable: values.isPurchasable, hsnSacCode: values.hsnSacCode.trim() || null, taxCategoryId: orNull(values.taxCategoryId),
    defaultSalesPrice: values.defaultSalesPrice, sku: service ? null : values.sku.trim() || null, barcode: service ? null : values.barcode.trim() || null,
  };
  if (values.code.trim()) input.code = values.code.trim();
  if (values.type === "stock") Object.assign(input, { trackingType: values.trackingType, allowNegativeStock: values.allowNegativeStock, requiresExpiryDate: values.trackingType === "batch" && values.requiresExpiryDate, valuationMethod: values.valuationMethod });
  if (creating) input.status = values.status;
  return input;
}

const COST_FIELDS = ["defaultPurchaseCost", "standardCost"] as const;

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        {description && <p className="text-xs text-text-muted">{description}</p>}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function ProductForm({ options, product, onSaved, onCancel }: { options: ProductOptions; product?: Product; onSaved: (product: Product) => void; onCancel: () => void }) {
  const workspace = useWorkspaceContext();
  const editing = Boolean(product);
  const can = options.capabilities;
  const [values, setValues] = useState<Values>(() => initial(product));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Values>(key: K) => (value: Values[K]) => { setValues((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: "" })); };
  const service = values.type === "service";
  const stock = values.type === "stock";
  // Who may change which group of fields; on a new product the creator sets
  // everything except cost.
  const may = {
    pricing: !editing || can.editPricing, tax: !editing || can.editTax, inventory: !editing || can.editInventory, cost: can.editCost && options.showsCost,
  };

  const [probe, setProbe] = useState({ code: "", name: "", sku: "", barcode: "" });
  useEffect(() => {
    const timer = setTimeout(() => setProbe({ code: values.code.trim(), name: values.name.trim(), sku: values.sku.trim(), barcode: values.barcode.trim() }), 450);
    return () => clearTimeout(timer);
  }, [values.code, values.name, values.sku, values.barcode]);
  const duplicates = useQuery({
    queryKey: scopedQueryKey(workspace, "products", "duplicates", probe, product?.id ?? null),
    queryFn: () => findDuplicateProducts({ ...probe, excludeId: product?.id ?? null }),
    enabled: probe.name.length >= 3 || Boolean(probe.code || probe.sku || probe.barcode),
    staleTime: 30_000,
  });
  const matches = duplicates.data?.matches ?? [];

  const submitKey = useSubmitKey();
  const save = useMutation({
    mutationFn: () => submitKey.run(async () => {
      const input = toInput(values, !editing);
      if (may.cost) for (const field of COST_FIELDS) input[field] = values[field];
      if (!product) return createProduct(input);
      const before = toInput(initial(product), false);
      if (may.cost) for (const field of COST_FIELDS) before[field] = product[field] ?? 0;
      const changed = Object.fromEntries(Object.entries(input).filter(([key, value]) => String(value ?? "") !== String((before as Record<string, unknown>)[key] ?? "")));
      return updateProduct(product.id, changed);
    }),
    onSuccess: onSaved,
    onError: (failure) => { setErrors(fieldErrors(failure)); setError(errorMessage(failure)); },
  });
  const submit = () => {
    const missing: Record<string, string> = {};
    if (!values.name.trim()) missing.name = "Enter the name.";
    if (!values.baseUomId) missing.baseUomId = service ? "Choose the unit the service is sold in, such as Hour." : "Choose the base unit.";
    if (Object.keys(missing).length) { setErrors(missing); return; }
    setError(null);
    save.mutate();
  };

  const uomOptions = options.uoms.map((uom) => ({ value: uom.id, label: `${uom.name} (${uom.code})` }));
  const baseCode = options.uoms.find((uom) => uom.id === values.baseUomId)?.code ?? "base units";
  const unitChoices = withNone(uomOptions.filter((entry) => entry.value !== values.baseUomId), "Same as base unit");
  const strong = matches.filter((match) => match.strength === "strong");

  return (
    <div className="flex flex-col gap-5">
      <ErrorBanner message={error} />

      <Section title="Basic information">
        <Select label="Type" isRequired selectedKey={values.type} isDisabled={!may.inventory} onSelectionChange={(key) => set("type")(String(key) as ProductType)}
          options={options.types.map((entry) => ({ value: entry.code, label: entry.label }))} errorMessage={errors.type}
          description={service ? "No inventory: no warehouse, stock or reservation." : stock ? "Inventory is tracked: stock, warehouses and reservations." : "A physical item whose quantity is not tracked."} />
        <TextField label="Code" value={values.code} onChange={(value) => set("code")(value.toUpperCase())} isDisabled={editing && !can.editInventory}
          description={editing ? "Changing the code is recorded in the history." : "Leave empty to number it automatically (PRD-00001)."} errorMessage={errors.code} />
        <TextField className="sm:col-span-2" label="Name" isRequired value={values.name} onChange={set("name")} errorMessage={errors.name} autoFocus={!editing} />
        <Select label="Category" selectedKey={values.categoryId} onSelectionChange={(key) => set("categoryId")(String(key))}
          options={withNone(options.categories.map((entry) => ({ value: entry.id, label: entry.name })), "No category")} errorMessage={errors.categoryId} />
        <Select label={service ? "Unit" : "Base unit"} isRequired isDisabled={editing && !can.editInventory} selectedKey={values.baseUomId || null} placeholder="Choose a unit"
          onSelectionChange={(key) => set("baseUomId")(String(key))} options={uomOptions} errorMessage={errors.baseUomId}
          description={service ? "Hour, Day, Month, License, Session…" : "The unit stock is counted in."} />
        <TextArea className="sm:col-span-2" label="Description" description="Internal." rows={2} value={values.description} onChange={set("description")} />
      </Section>

      {matches.length > 0 && (
        <div role={strong.length ? "alert" : "status"} className={`flex flex-col gap-1 rounded-[var(--radius-control)] border px-3 py-2 text-sm ${strong.length ? "border-warning-emphasis/40 bg-warning-soft" : "border-border bg-surface-muted"}`}>
          <p className="font-medium">{strong.length ? "Already in the catalogue" : "Similar products"}</p>
          {matches.map((match) => (
            <p key={`${match.id}-${match.reasons[0]?.signal}`} className="flex flex-wrap items-center gap-2">
              <Badge tone={match.strength === "strong" ? "warning" : "neutral"}>{match.reasons.map((reason) => reason.label).join(", ")}</Badge>
              <Link href={match.href} target="_blank" className="text-brand underline-offset-2 hover:underline">{match.name} ({match.code})</Link>
            </p>
          ))}
        </div>
      )}

      <Section title="Commercial">
        <div className="sm:col-span-2"><Checkbox isSelected={values.isSellable} onChange={set("isSellable")}>Can be sold</Checkbox></div>
        {values.isSellable && (
          <>
            <Select label="Sales unit" selectedKey={values.salesUomId} onSelectionChange={(key) => set("salesUomId")(String(key))} options={unitChoices} isDisabled={editing && !can.editInventory} errorMessage={errors.salesUomId} />
            {values.salesUomId !== NONE ? (
              <NumberField label={`${baseCode} per sales unit`} value={values.salesUomFactor} onChange={set("salesUomFactor")} minValue={0.000001} isDisabled={editing && !can.editInventory} errorMessage={errors.salesUomFactor} />
            ) : <span aria-hidden="true" />}
            <NumberField label="Default sales price" description="A reference. The customer's price list sets the actual price." value={values.defaultSalesPrice} onChange={set("defaultSalesPrice")} minValue={0}
              isDisabled={!may.pricing} formatOptions={{ style: "currency", currency: "INR" }} errorMessage={errors.defaultSalesPrice} />
            <TextArea className="sm:col-span-2" label="Sales description" description="Copied onto quotations, orders and invoices, where it can be changed per document." rows={3}
              value={values.salesDescription} onChange={set("salesDescription")} />
          </>
        )}
      </Section>

      <Section title="Purchasing">
        <div className="sm:col-span-2"><Checkbox isSelected={values.isPurchasable} onChange={set("isPurchasable")}>Can be purchased</Checkbox></div>
        {values.isPurchasable && (
          <>
            <Select label="Purchase unit" selectedKey={values.purchaseUomId} onSelectionChange={(key) => set("purchaseUomId")(String(key))} options={unitChoices} isDisabled={editing && !can.editInventory} errorMessage={errors.purchaseUomId} />
            {values.purchaseUomId !== NONE ? (
              <NumberField label={`${baseCode} per purchase unit`} value={values.purchaseUomFactor} onChange={set("purchaseUomFactor")} minValue={0.000001} isDisabled={editing && !can.editInventory} errorMessage={errors.purchaseUomFactor} />
            ) : <span aria-hidden="true" />}
            {options.showsCost && (
              <NumberField label="Default purchase cost" description="A reference. Purchase orders set the actual cost." value={values.defaultPurchaseCost} onChange={set("defaultPurchaseCost")} minValue={0}
                isDisabled={!may.cost} formatOptions={{ style: "currency", currency: "INR" }} errorMessage={errors.defaultPurchaseCost} />
            )}
            <TextArea className="sm:col-span-2" label="Purchase description" rows={2} value={values.purchaseDescription} onChange={set("purchaseDescription")} />
          </>
        )}
      </Section>

      {!service && (
        <Section title="Inventory" description={stock ? "Stock on hand, reservations and valuation are kept by Inventory, not here." : "Quantity is not tracked for a non-stock item."}>
          <TextField label="SKU" value={values.sku} onChange={(value) => set("sku")(value.toUpperCase())} isDisabled={!may.inventory} errorMessage={errors.sku} />
          <TextField label="Barcode" value={values.barcode} onChange={set("barcode")} isDisabled={!may.inventory} errorMessage={errors.barcode} description="Unique in your organisation. Used by POS scanning." />
          {stock && (
            <>
              <Select label="Lot / serial tracking" selectedKey={values.trackingType} isDisabled={!may.inventory} onSelectionChange={(key) => set("trackingType")(String(key))}
                options={[{ value: "none", label: "None" }, { value: "batch", label: "Lot / batch" }, { value: "serial", label: "Serial number" }]} errorMessage={errors.trackingType} />
              <Select label="Valuation method" selectedKey={values.valuationMethod} isDisabled={!may.inventory} onSelectionChange={(key) => set("valuationMethod")(String(key))}
                options={[{ value: "moving_average", label: "Moving average" }, { value: "fifo", label: "FIFO" }, { value: "standard", label: "Standard cost" }]} errorMessage={errors.valuationMethod} />
              {options.showsCost && (
                <NumberField label="Standard cost" value={values.standardCost} onChange={set("standardCost")} minValue={0} isDisabled={!may.cost} formatOptions={{ style: "currency", currency: "INR" }} errorMessage={errors.standardCost} />
              )}
              <div className="flex items-end"><Checkbox isSelected={values.allowNegativeStock} isDisabled={!may.inventory} onChange={set("allowNegativeStock")}>Allow negative stock</Checkbox></div>
              {values.trackingType === "batch" && (
                <div className="flex items-end"><Checkbox isSelected={values.requiresExpiryDate} isDisabled={!may.inventory} onChange={set("requiresExpiryDate")}>Every lot needs an expiry date</Checkbox></div>
              )}
            </>
          )}
        </Section>
      )}

      <Section title="Tax" description="The tax engine works out CGST, SGST or IGST from this, the customer and the place of supply.">
        <TextField label={service ? "SAC" : "HSN"} value={values.hsnSacCode} onChange={(value) => set("hsnSacCode")(value.replace(/\s/g, ""))} isDisabled={!may.tax}
          description={service ? "6 digits starting 99, such as 998313." : "4, 6 or 8 digits, such as 8471."} errorMessage={errors.hsnSacCode} />
        <Select label="Tax category" selectedKey={values.taxCategoryId} isDisabled={!may.tax} onSelectionChange={(key) => set("taxCategoryId")(String(key))}
          options={withNone(options.taxCategories.map((entry) => ({ value: entry.id, label: [entry.name, entry.gstRate !== null ? `GST ${entry.gstRate}%` : null, entry.cessRate ? `Cess ${entry.cessRate}%` : null].filter(Boolean).join(" · ") })))}
          errorMessage={errors.taxCategoryId} />
      </Section>

      {!editing && (
        <Section title="Status">
          <Select label="Status" selectedKey={values.status} onSelectionChange={(key) => set("status")(String(key))} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} />
        </Section>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onPress={onCancel}>Cancel</Button>
        <Button variant="primary" onPress={submit} isLoading={save.isPending || save.isSuccess} isDisabled={strong.length > 0}>{editing ? "Save changes" : service ? "Create service" : "Create product"}</Button>
      </div>
    </div>
  );
}

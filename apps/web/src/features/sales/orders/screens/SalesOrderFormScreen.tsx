"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button, ErrorState, IconButton, NumberField, PageHeader, Select, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { money } from "@/features/sales/shared/format";
import { SalesAlert, SalesFacts, SalesPanel } from "@/features/sales/shared/SalesUi";
import { getSalesOptions, previewSalesDocument, type SalesDocumentInput } from "@/features/sales/quotations/api/quotations-api";
import { amendSalesOrder, createSalesOrder, getSalesOrder, type SalesOrderDetail, type SalesOrderDocumentInput } from "@/features/sales/orders/api/orders-api";

type LineDraft = { key: number; itemId: string; variantId: string; uomId: string; quantity: number; discountPercent: number; warehouseId: string };
type ChargeDraft = { key: number; label: string; calculationType: "fixed" | "percentage"; value: number };

let draftKey = 0;
const nextKey = () => ++draftKey;
const isoInDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

// F042/F048 -- create a sales order, or amend a confirmed one into a new
// version (which goes back through approval). The totals on the right come from the server's own
// previewSalesDocument (the same pricing/tax/discount code that will run on
// save), debounced -- the browser never computes a price, so what you see is
// what is stored.
export function SalesOrderFormScreen({ orderId }: { orderId?: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const revising = Boolean(orderId);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options"), queryFn: () => getSalesOptions().then((r) => r.options) });
  const existingQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "order", orderId),
    queryFn: () => getSalesOrder(orderId!).then((r) => r.detail),
    enabled: revising,
  });

  if (optionsQuery.isLoading || (revising && existingQuery.isLoading)) return <p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>;
  if (optionsQuery.isError || !optionsQuery.data) return <ErrorState title="Could not load the form" action={{ label: "Retry", onPress: () => optionsQuery.refetch() }} />;
  if (revising && (existingQuery.isError || !existingQuery.data)) return <ErrorState title="Could not load this order" action={{ label: "Retry", onPress: () => existingQuery.refetch() }} />;

  return (
    <FormBody
      key={orderId ?? "new"}
      options={optionsQuery.data}
      existing={existingQuery.data ?? null}
      orderId={orderId}
      onDone={(id) => {
        queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "orders") });
        queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "order", id) });
        router.push(`/sales/orders/${id}`);
      }}
      onCancel={() => router.push(orderId ? `/sales/orders/${orderId}` : "/sales/orders")}
    />
  );
}

function FormBody({
  options,
  existing,
  orderId,
  onDone,
  onCancel,
}: {
  options: NonNullable<ReturnType<typeof getSalesOptions> extends Promise<infer R> ? (R extends { options: infer O } ? O : never) : never>;
  existing: SalesOrderDetail | null;
  orderId?: string;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const workspace = useWorkspaceContext();
  const revising = Boolean(orderId);
  const baseCurrency = options.currencies.find((currency) => currency.is_base)?.code ?? options.currencies[0]?.code ?? "INR";

  const [partyId, setPartyId] = useState(existing?.order.party_id ?? "");
  const [contactId, setContactId] = useState(existing?.order.contact_id ?? "");
  const [billingAddressId, setBillingAddressId] = useState(existing?.order.billing_address_id ?? "");
  const [shippingAddressId, setShippingAddressId] = useState(existing?.order.shipping_address_id ?? "");
  const [currencyCode, setCurrencyCode] = useState(existing?.order.currency_code ?? baseCurrency);
  const [priceListId, setPriceListId] = useState(existing?.order.price_list_id ?? "");
  const [paymentTermId, setPaymentTermId] = useState(existing?.order.payment_term_id ?? "");
  const [deliveryDate, setDeliveryDate] = useState(existing?.order.requested_delivery_date?.slice(0, 10) ?? isoInDays(14));
  const [poNumber, setPoNumber] = useState(existing?.order.customer_po_number ?? "");
  const [poDate, setPoDate] = useState(existing?.order.customer_po_date?.slice(0, 10) ?? "");
  const [headerDiscount, setHeaderDiscount] = useState(0);
  const [customerNotes, setCustomerNotes] = useState(existing?.order.customer_notes ?? "");
  const [internalNotes, setInternalNotes] = useState(existing?.order.internal_notes ?? "");
  const [terms, setTerms] = useState(existing?.order.terms_and_conditions ?? "");
  const [amendmentReason, setAmendmentReason] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(() =>
    existing?.lines.length
      ? existing.lines.map((line) => ({ key: nextKey(), itemId: line.item_id, variantId: line.variant_id ?? "", uomId: line.uom_id ?? "", quantity: Number(line.quantity), discountPercent: Number(line.discount_percent), warehouseId: line.warehouse_id ?? "" }))
      : [{ key: nextKey(), itemId: "", variantId: "", uomId: "", quantity: 1, discountPercent: 0, warehouseId: "" }],
  );
  const [charges, setCharges] = useState<ChargeDraft[]>(() =>
    existing && Number(existing.order.charge_total) > 0 ? [{ key: nextKey(), label: "Existing charges", calculationType: "fixed" as const, value: Number(existing.order.charge_total) }] : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const partyOptions: SelectOption[] = options.parties.map((party) => ({ value: party.id, label: `${party.display_name} (${party.code})` }));
  // Every top-ERP customer-master comparison (SAP's partner functions,
  // NetSuite's per-transaction ship-to/bill-to) resolves contact/address at
  // the document level, independent of which one the customer has marked
  // primary -- so these list every contact/address that belongs to the
  // chosen customer, not just its primary ones.
  const partyContacts = options.contacts.filter((contact) => contact.party_id === partyId);
  const partyAddresses = options.addresses.filter((address) => address.party_id === partyId);
  const contactOptions: SelectOption[] = [{ value: "", label: "None" }, ...partyContacts.map((contact) => ({ value: contact.id, label: `${contact.first_name} ${contact.last_name ?? ""}`.trim() + (contact.is_primary ? " (primary)" : "") }))];
  // Any of the customer's addresses can serve as billing or shipping for
  // THIS document, regardless of its own address_type label (the same
  // per-transaction role resolution SAP's partner functions and NetSuite's
  // ship-to/bill-to selectors provide) -- both pickers list every address.
  const addressOptions: SelectOption[] = [
    { value: "", label: "None" },
    ...partyAddresses.map((address) => ({ value: address.id, label: `${address.address_type} — ${address.line1}${address.city ? `, ${address.city}` : ""}` + (address.is_primary ? " (primary)" : "") })),
  ];
  const itemOptions: SelectOption[] = options.items.map((item) => ({ value: item.id, label: `${item.name} (${item.code})` }));
  // F033: expose a line's UOM and variant/SKU context, not just the item --
  // "sell 20 cartons of the Large/Brown box" needs both. The UOM list is
  // scoped to what the item can actually convert to (the server enforces the
  // same thing); the variant list is scoped to that item's own SKUs.
  const uomById = new Map(options.uoms.map((uom) => [uom.id, uom]));
  function uomOptionsFor(itemId: string): SelectOption[] {
    const item = options.items.find((candidate) => candidate.id === itemId);
    if (!item?.uom_id) return [];
    const reachable = new Set([item.uom_id]);
    for (const conversion of options.itemUomConversions) {
      if (conversion.item_id !== itemId) continue;
      reachable.add(conversion.from_uom_id);
      reachable.add(conversion.to_uom_id);
    }
    return Array.from(reachable)
      .map((id) => uomById.get(id))
      .filter((uom): uom is NonNullable<typeof uom> => Boolean(uom))
      .map((uom) => ({ value: uom.id, label: `${uom.name} (${uom.code})` }));
  }
  function variantOptionsFor(itemId: string): SelectOption[] {
    const variants = options.itemVariants.filter((variant) => variant.item_id === itemId);
    return [{ value: "", label: "Standard (no variant)" }, ...variants.map((variant) => ({ value: variant.id, label: `${variant.sku} — ${variant.name}` }))];
  }
  function selectLineItem(key: number, itemId: string) {
    const item = options.items.find((candidate) => candidate.id === itemId);
    updateLine(key, { itemId, variantId: "", uomId: item?.uom_id ?? "" });
  }
  const warehouseOptions: SelectOption[] = [{ value: "", label: "No warehouse yet" }, ...options.warehouses.map((warehouse) => ({ value: warehouse.id, label: `${warehouse.name} (${warehouse.code})` }))];
  const currencyOptions: SelectOption[] = options.currencies.map((currency) => ({ value: currency.code, label: `${currency.code} — ${currency.name}` }));
  const priceListOptions: SelectOption[] = [{ value: "", label: "No price list (item list price)" }, ...options.priceLists.filter((list) => list.currency_code === currencyCode).map((list) => ({ value: list.id, label: list.name }))];
  const paymentTermOptions: SelectOption[] = [{ value: "", label: "Customer default" }, ...options.paymentTerms.map((term) => ({ value: term.id, label: `${term.name} (${term.default_due_days} days)` }))];

  function selectParty(id: string) {
    setPartyId(id);
    const party = options.parties.find((candidate) => candidate.id === id);
    // A customer's own currency and terms are the natural starting point; the
    // user can still change either, and the server validates the combination.
    if (party?.currency_code) setCurrencyCode(party.currency_code);
    if (party?.payment_term_id) setPaymentTermId(party.payment_term_id);
    setPriceListId("");
    // Default to the new customer's primary contact/billing/shipping address
    // (still fully overridable below) -- the previous customer's selections
    // don't carry over.
    const contacts = options.contacts.filter((contact) => contact.party_id === id);
    const addresses = options.addresses.filter((address) => address.party_id === id);
    setContactId(contacts.find((contact) => contact.is_primary)?.id ?? "");
    setBillingAddressId(addresses.find((address) => address.address_type === "billing" && address.is_primary)?.id ?? "");
    setShippingAddressId(addresses.find((address) => address.address_type === "shipping" && address.is_primary)?.id ?? "");
  }

  const validLines = lines.filter((line) => line.itemId && line.quantity > 0);
  const input: SalesOrderDocumentInput | null = useMemo(() => {
    if (!partyId || !currencyCode || validLines.length === 0) return null;
    return {
      partyId,
      contactId: contactId || undefined,
      billingAddressId: billingAddressId || undefined,
      shippingAddressId: shippingAddressId || undefined,
      currencyCode,
      priceListId: priceListId || null,
      paymentTermId: paymentTermId || null,
      requestedDeliveryDate: deliveryDate || null,
      customerPoNumber: poNumber || undefined,
      customerPoDate: poDate || null,
      headerDiscountPercent: headerDiscount || undefined,
      customerNotes: customerNotes || undefined,
      internalNotes: internalNotes || undefined,
      termsAndConditions: terms || undefined,
      amendmentReason: amendmentReason || undefined,
      lines: validLines.map((line) => ({ itemId: line.itemId, variantId: line.variantId || undefined, uomId: line.uomId || undefined, quantity: line.quantity, discountPercent: line.discountPercent || undefined, warehouseId: line.warehouseId || undefined })),
      charges: charges.filter((charge) => charge.value > 0).map((charge) => ({ label: charge.label || "Charge", calculationType: charge.calculationType, value: charge.value })),
    };
  }, [partyId, contactId, billingAddressId, shippingAddressId, currencyCode, priceListId, paymentTermId, deliveryDate, poNumber, poDate, headerDiscount, customerNotes, internalNotes, terms, amendmentReason, validLines, charges]);

  // Debounce so typing a quantity doesn't fire a pricing request per keystroke.
  const inputJson = JSON.stringify(input);
  const [debouncedJson, setDebouncedJson] = useState(inputJson);
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedJson(inputJson), 400);
    return () => clearTimeout(handle);
  }, [inputJson]);
  const previewInput: SalesDocumentInput | null = debouncedJson === "null" ? null : (JSON.parse(debouncedJson) as SalesDocumentInput);

  const previewQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "preview", debouncedJson),
    queryFn: () => previewSalesDocument(previewInput!).then((r) => r.preview),
    enabled: Boolean(previewInput),
    retry: false,
    placeholderData: (previous) => previous,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!input) throw new SalesApiError("Choose a customer and add at least one item.", 400);
      if (orderId) {
        await amendSalesOrder(orderId, input);
        return orderId;
      }
      const result = await createSalesOrder({ ...input, idempotencyKey });
      return result.order.id;
    },
    onSuccess: (id) => onDone(id),
    onError: (err) => setError(err instanceof SalesApiError ? err.message : "The order could not be saved."),
  });

  const preview = previewQuery.data;
  const previewError = previewQuery.isError ? (previewQuery.error instanceof SalesApiError ? previewQuery.error.message : "Pricing could not be calculated.") : null;

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={revising ? `Amend ${existing?.order.sales_order_number}` : "New sales order"}
        description={revising ? "Saving creates a new version that must be approved by someone else before it takes effect. Until then the order keeps its current version." : "Record a customer order. Totals update as you edit and are calculated by the server."}
        secondaryActions={
          <Button variant="secondary" onPress={onCancel}>
            Cancel
          </Button>
        }
        primaryAction={
          <Button variant="primary" onPress={() => saveMutation.mutate()} isLoading={saveMutation.isPending} isDisabled={!input || Boolean(previewError) || (revising && !amendmentReason.trim())}>
            {revising ? "Submit amendment" : "Save order"}
          </Button>
        }
      />

      {error && <SalesAlert>{error}</SalesAlert>}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <SalesPanel title="Customer & terms">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select label="Customer" isRequired options={partyOptions} selectedKey={partyId || null} onSelectionChange={(key) => selectParty(String(key ?? ""))} placeholder="Select a customer" isDisabled={revising} />
              <Select label="Contact" options={contactOptions} selectedKey={contactId} onSelectionChange={(key) => setContactId(String(key ?? ""))} isDisabled={!partyId} />
              <Select label="Billing address" options={addressOptions} selectedKey={billingAddressId} onSelectionChange={(key) => setBillingAddressId(String(key ?? ""))} isDisabled={!partyId} />
              <Select label="Shipping address" options={addressOptions} selectedKey={shippingAddressId} onSelectionChange={(key) => setShippingAddressId(String(key ?? ""))} isDisabled={!partyId} />
              <TextField label="Requested delivery date" type="date" value={deliveryDate} onChange={setDeliveryDate} />
              <TextField label="Customer PO number" value={poNumber} onChange={setPoNumber} />
              <TextField label="Customer PO date" type="date" value={poDate} onChange={setPoDate} />
              <Select label="Currency" options={currencyOptions} selectedKey={currencyCode} onSelectionChange={(key) => { setCurrencyCode(String(key ?? baseCurrency)); setPriceListId(""); }} />
              <Select label="Price list" options={priceListOptions} selectedKey={priceListId} onSelectionChange={(key) => setPriceListId(String(key ?? ""))} />
              <Select label="Payment terms" options={paymentTermOptions} selectedKey={paymentTermId} onSelectionChange={(key) => setPaymentTermId(String(key ?? ""))} />
              {revising && <TextField label="Reason for this amendment" isRequired value={amendmentReason} onChange={setAmendmentReason} />}
            </div>
          </SalesPanel>

          <SalesPanel
            title="Items"
            actions={
              <Button variant="secondary" size="compact" onPress={() => setLines((current) => [...current, { key: nextKey(), itemId: "", variantId: "", uomId: "", quantity: 1, discountPercent: 0, warehouseId: "" }])}>
                <Plus className="size-3.5" aria-hidden="true" />
                Add item
              </Button>
            }
          >
            <div className="flex flex-col gap-3">
              {lines.map((line, index) => {
                const priced = preview?.lines.find((candidate) => candidate.sequence === validLines.findIndex((v) => v.key === line.key) + 1);
                const lineVariantOptions = variantOptionsFor(line.itemId);
                const lineUomOptions = uomOptionsFor(line.itemId);
                return (
                  <div key={line.key} className="grid grid-cols-1 items-end gap-2 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,0.6fr)_minmax(0,0.6fr)_minmax(0,1.2fr)_auto]">
                    <Select
                      aria-label={`Item ${index + 1}`}
                      label={index === 0 ? "Item" : undefined}
                      options={itemOptions}
                      selectedKey={line.itemId || null}
                      onSelectionChange={(key) => selectLineItem(line.key, String(key ?? ""))}
                      placeholder="Select an item"
                    />
                    <Select
                      aria-label={`Variant ${index + 1}`}
                      label={index === 0 ? "Variant" : undefined}
                      options={lineVariantOptions}
                      selectedKey={line.variantId}
                      onSelectionChange={(key) => updateLine(line.key, { variantId: String(key ?? "") })}
                      isDisabled={lineVariantOptions.length <= 1}
                    />
                    <Select
                      aria-label={`UOM ${index + 1}`}
                      label={index === 0 ? "UOM" : undefined}
                      options={lineUomOptions}
                      selectedKey={line.uomId || null}
                      onSelectionChange={(key) => updateLine(line.key, { uomId: String(key ?? "") })}
                      isDisabled={lineUomOptions.length <= 1}
                    />
                    <NumberField aria-label={`Quantity ${index + 1}`} label={index === 0 ? "Quantity" : undefined} value={line.quantity} onChange={(value) => updateLine(line.key, { quantity: value })} minValue={0} step={1} />
                    <NumberField aria-label={`Discount ${index + 1}`} label={index === 0 ? "Discount %" : undefined} value={line.discountPercent} onChange={(value) => updateLine(line.key, { discountPercent: value })} minValue={0} maxValue={100} step={1} />
                    <Select aria-label={`Warehouse ${index + 1}`} label={index === 0 ? "Warehouse" : undefined} options={warehouseOptions} selectedKey={line.warehouseId} onSelectionChange={(key) => updateLine(line.key, { warehouseId: String(key ?? "") })} />
                    <IconButton aria-label={`Remove item ${index + 1}`} variant="ghost" isDisabled={lines.length === 1} onPress={() => setLines((current) => current.filter((candidate) => candidate.key !== line.key))}>
                      <Trash2 className="size-4" aria-hidden="true" />
                    </IconButton>
                    {priced && (
                      <p className="text-xs text-text-muted sm:col-span-7">
                        {money(currencyCode, priced.unitPrice)} each · net {money(currencyCode, priced.netAmount)} · tax {money(currencyCode, priced.taxAmount)} · line total <span className="font-medium text-text">{money(currencyCode, priced.lineTotal)}</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </SalesPanel>

          <SalesPanel
            title="Charges & discount"
            description={revising ? "Orders keep only the charge total, so it is carried over as one line — adjust or itemise it here." : "Freight, handling, or a whole-document discount (which needs price-override permission)."}
            actions={
              <Button variant="secondary" size="compact" onPress={() => setCharges((current) => [...current, { key: nextKey(), label: "", calculationType: "fixed", value: 0 }])}>
                <Plus className="size-3.5" aria-hidden="true" />
                Add charge
              </Button>
            }
          >
            {charges.map((charge) => (
              <div key={charge.key} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                <TextField aria-label="Charge label" label="Label" value={charge.label} onChange={(value) => setCharges((current) => current.map((c) => (c.key === charge.key ? { ...c, label: value } : c)))} />
                <Select
                  aria-label="Charge type"
                  label="Type"
                  options={[
                    { value: "fixed", label: "Fixed amount" },
                    { value: "percentage", label: "% of subtotal" },
                  ]}
                  selectedKey={charge.calculationType}
                  onSelectionChange={(key) => setCharges((current) => current.map((c) => (c.key === charge.key ? { ...c, calculationType: key === "percentage" ? "percentage" : "fixed" } : c)))}
                />
                <NumberField aria-label="Charge value" label="Value" value={charge.value} onChange={(value) => setCharges((current) => current.map((c) => (c.key === charge.key ? { ...c, value } : c)))} minValue={0} step={0.01} />
                <IconButton aria-label="Remove charge" variant="ghost" onPress={() => setCharges((current) => current.filter((c) => c.key !== charge.key))}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              </div>
            ))}
            <NumberField label="Whole-document discount (%)" value={headerDiscount} onChange={setHeaderDiscount} minValue={0} maxValue={100} step={1} className="sm:max-w-xs" />
          </SalesPanel>

          <SalesPanel title="Notes & terms">
            <TextArea label="Notes for the customer" value={customerNotes} onChange={setCustomerNotes} />
            <TextArea label="Terms and conditions" value={terms} onChange={setTerms} />
            <TextArea label="Internal notes (never shown to the customer)" value={internalNotes} onChange={setInternalNotes} />
          </SalesPanel>
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-4">
          <SalesPanel title="Totals" description="Calculated by the server.">
            {previewError ? (
              <SalesAlert tone="warning">{previewError}</SalesAlert>
            ) : !preview ? (
              <p className="text-sm text-text-muted">Choose a customer and add an item to see pricing.</p>
            ) : (
              <>
                <SalesFacts
                  columns={2}
                  items={[
                    { label: "Subtotal", value: money(currencyCode, preview.totals.subtotal) },
                    { label: "Discounts", value: money(currencyCode, preview.totals.discountTotal) },
                    { label: "Charges", value: money(currencyCode, preview.totals.chargeTotal) },
                    { label: "Tax", value: money(currencyCode, preview.totals.taxTotal) },
                    { label: "Rounding", value: money(currencyCode, preview.totals.roundingAdjustment) },
                    ...(preview.totals.marginPercent !== undefined ? [{ label: "Margin", value: `${Number(preview.totals.marginPercent).toFixed(1)}%` }] : []),
                  ]}
                />
                <div className="flex items-center justify-between border-t border-border pt-3 text-lg font-semibold text-text">
                  <span>Grand total</span>
                  <span className="tabular-nums">{money(currencyCode, preview.totals.grandTotal)}</span>
                </div>
              </>
            )}
          </SalesPanel>
        </div>
      </div>
    </div>
  );
}

"use client";

// A new sales order, or changes to a Draft. Every total on the right comes
// from the server's own pricing (the same code that runs on save), so what
// you see is what is stored. An order made from a quotation executes what was
// agreed: its customer, currency, price list and additional discount stay,
// and each quoted line keeps its quoted price, discount and tax; quantities,
// warehouses, dates and addresses can still change while it is a draft.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { AlertDialog, Button, ErrorState, IconButton, NumberField, PageHeader, Select, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { money, statusLabel } from "@/features/sales/shared/format";
import {
  BILLING_ADDRESS_TYPES, SHIPPING_ADDRESS_TYPES, contactLabel, defaultAddress, defaultLineDescription, defaultLineUom, usableAddresses,
} from "@/features/sales/shared/document-defaults";
import { SalesAlert, SalesPanel } from "@/features/sales/shared/SalesUi";
import { getSalesOptions, previewSalesDocument, type SalesDocumentInput, type SalesOptions } from "@/features/sales/quotations/api/quotations-api";
import { AUTOMATIC_TAX, DocumentTaxPanel, taxDraftOf, taxInput, type DocumentTaxDraft } from "@/features/sales/shared/DocumentTax";
import {
  DocumentDiscountPanel, DocumentTotals, NO_DOCUMENT_DISCOUNT, defaultDiscountType, discountTypeOptions, type DocumentDiscountDraft,
} from "@/features/sales/shared/DocumentDiscounts";

import {
  createSalesOrder, getSalesOrder, getSalesOrderDefaults, previewSalesOrder, updateSalesOrder, type SalesOrderDefaults, type SalesOrderDetail, type SalesOrderDocumentInput,
} from "../api/orders-api";
import { useSubmitKey } from "@/shared/http/submit-once";

type LineDraft = {
  key: number;
  // The saved line this one is, when editing a draft.
  salesOrderLineId: string;
  // Came from the quotation: price and discount are the agreed ones.
  quoted: boolean;
  itemId: string;
  uomId: string;
  quantity: number;
  discountType: "percent" | "amount";
  discountValue: number;
  description: string;
  // "" means the price list price; anything else is a manual price.
  unitPrice: string;
  priceReason: string;
  warehouseId: string;
};
type ChargeDraft = { key: number; label: string; calculationType: "fixed" | "percentage"; value: number };

let draftKey = 0;
const nextKey = () => ++draftKey;

export function SalesOrderFormScreen({ orderId, initialPartyId }: { orderId?: string; initialPartyId?: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const editing = Boolean(orderId);
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options"), queryFn: () => getSalesOptions().then((r) => r.options) });
  const defaultsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "order-defaults"), queryFn: () => getSalesOrderDefaults().then((r) => r.defaults) });
  const existingQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "order", orderId),
    queryFn: () => getSalesOrder(orderId!).then((r) => r.order),
    enabled: editing,
  });

  if (optionsQuery.isLoading || defaultsQuery.isLoading || (editing && existingQuery.isLoading)) return <p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>;
  if (optionsQuery.isError || !optionsQuery.data || defaultsQuery.isError || !defaultsQuery.data)
    return <ErrorState title="Could not load the form" action={{ label: "Retry", onPress: () => { void optionsQuery.refetch(); void defaultsQuery.refetch(); } }} />;
  if (editing && (existingQuery.isError || !existingQuery.data))
    return <ErrorState title="Could not load this order" action={{ label: "Retry", onPress: () => existingQuery.refetch() }} />;
  if (existingQuery.data && existingQuery.data.order.status !== "draft")
    return <ErrorState title="Only a draft order can be edited" description="Reopen the order to draft first, while nothing has been delivered or invoiced."
      action={{ label: "Back to the order", onPress: () => router.push(`/sales/orders/${orderId}`) }} />;
  if (!editing && !defaultsQuery.data.directOrdersAllowed)
    return <ErrorState title="Orders without a quotation are switched off" description="Create a quotation, record the customer's acceptance and make the order from it."
      action={{ label: "Back to sales orders", onPress: () => router.push("/sales/orders") }} />;

  return (
    <FormBody
      key={orderId ?? `new-${initialPartyId ?? ""}`}
      options={optionsQuery.data}
      defaults={defaultsQuery.data}
      existing={existingQuery.data ?? null}
      orderId={orderId}
      initialPartyId={initialPartyId}
      onDone={(id) => {
        void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "orders") });
        void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "order", id) });
        router.push(`/sales/orders/${id}`);
      }}
      onCancel={() => router.push(orderId ? `/sales/orders/${orderId}` : "/sales/orders")}
    />
  );
}

function FormBody({ options, defaults, existing, orderId, initialPartyId, onDone, onCancel }: {
  options: SalesOptions; defaults: SalesOrderDefaults; existing: SalesOrderDetail | null; orderId?: string; initialPartyId?: string;
  onDone: (id: string) => void; onCancel: () => void;
}) {
  const workspace = useWorkspaceContext();
  const order = existing?.order;
  // An order made from a quotation keeps the agreed customer and commercial terms.
  const fromQuotation = Boolean(order?.source_quotation_id);
  const baseCurrency = options.currencies.find((currency) => currency.is_base)?.code ?? options.currencies[0]?.code ?? "INR";
  const seedParty = existing ? undefined : options.parties.find((party) => party.id === initialPartyId);
  const seedAddresses = options.addresses.filter((address) => address.party_id === seedParty?.id);
  const blank = (): LineDraft => ({
    key: nextKey(), salesOrderLineId: "", quoted: false, itemId: "", uomId: "", quantity: 1, discountType: defaultDiscountType(options.discounts),
    discountValue: 0, description: "", unitPrice: "", priceReason: "", warehouseId: "",
  });

  const [partyId, setPartyId] = useState(order?.party_id ?? seedParty?.id ?? "");
  const [contactId, setContactId] = useState(order?.contact_id ?? options.contacts.find((contact) => contact.party_id === seedParty?.id && contact.is_primary)?.id ?? "");
  const [billingAddressId, setBillingAddressId] = useState(order?.billing_address_id ?? defaultAddress(seedAddresses, BILLING_ADDRESS_TYPES));
  const [shippingAddressId, setShippingAddressId] = useState(order?.shipping_address_id ?? defaultAddress(seedAddresses, SHIPPING_ADDRESS_TYPES));
  const [currencyCode, setCurrencyCode] = useState(order?.currency_code ?? seedParty?.currency_code ?? baseCurrency);
  const [priceListId, setPriceListId] = useState(order?.price_list_id ?? "");
  // A price list change waiting for "re-price the lines?"
  const [pendingPriceList, setPendingPriceList] = useState<string | null>(null);
  const [paymentTermId, setPaymentTermId] = useState(order?.payment_term_id ?? seedParty?.payment_term_id ?? "");
  // Additional payment terms for this order only, printed with its terms.
  const [paymentTermsNote, setPaymentTermsNote] = useState(order?.payment_term_snapshot?.note ?? "");
  const [ownerUserId, setOwnerUserId] = useState(order?.owner_user_id ?? workspace.userId ?? "");
  const [orderDate, setOrderDate] = useState(order?.order_date?.slice(0, 10) ?? defaults.orderDate);
  const [deliveryDate, setDeliveryDate] = useState(order?.requested_delivery_date?.slice(0, 10) ?? "");
  const [poNumber, setPoNumber] = useState(order?.customer_po_number ?? "");
  const [poDate, setPoDate] = useState(order?.customer_po_date?.slice(0, 10) ?? "");
  const [customerReference, setCustomerReference] = useState(order?.customer_reference ?? "");
  const [defaultWarehouseId, setDefaultWarehouseId] = useState(order ? order.default_warehouse_id ?? "" : defaults.defaultWarehouseId ?? "");
  const [documentDiscount, setDocumentDiscount] = useState<DocumentDiscountDraft>(() => order
    ? { type: order.document_discount_type === "amount" ? "amount" : "percent", value: Number(order.document_discount_value ?? 0), reasonCode: order.discount_reason_code ?? "", reasonText: order.discount_reason_text ?? "" }
    : { ...NO_DOCUMENT_DISCOUNT, type: defaultDiscountType(options.discounts) });
  // Tax is worked out by the server; this holds only what the user overrides.
  const [documentTax, setDocumentTax] = useState<DocumentTaxDraft>(() => (order ? taxDraftOf(order) : AUTOMATIC_TAX));
  const [customerNotes, setCustomerNotes] = useState(order?.customer_notes ?? "");
  const [internalNotes, setInternalNotes] = useState(order?.internal_notes ?? "");
  const [terms, setTerms] = useState(order?.terms_and_conditions ?? "");
  const [lines, setLines] = useState<LineDraft[]>(() => existing?.lines.length
    ? existing.lines.map((line) => ({
        key: nextKey(), salesOrderLineId: line.id, quoted: line.is_quoted, itemId: line.item_id, uomId: line.uom_id ?? "",
        quantity: Number(line.quantity), discountType: line.discount_type === "amount" ? "amount" : "percent", discountValue: Number(line.discount_value),
        warehouseId: line.warehouse_id ?? "", description: line.description_snapshot ?? "",
        unitPrice: line.manual_price_override && !line.is_quoted ? String(Number(line.unit_price)) : "", priceReason: line.manual_price_reason ?? "",
      }))
    : [blank()]);
  // Orders keep only the charge total, so a saved draft's charges come back as one line.
  const [charges, setCharges] = useState<ChargeDraft[]>(() => order && Number(order.charge_total) > 0
    ? [{ key: nextKey(), label: "Charges", calculationType: "fixed", value: Number(order.charge_total) }] : []);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  // Whether an order can be placed for the chosen customer, and why not.
  const customerDefaults = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "order-defaults", partyId),
    queryFn: () => getSalesOrderDefaults(partyId).then((r) => r.defaults),
    enabled: Boolean(partyId),
  });
  const blocked = customerDefaults.data?.blocked ?? null;

  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const canOverridePrice = can("sales.price.override");
  const canDiscountLines = options.discounts.allowLine && options.discounts.canApplyLine;
  const partyOptions: SelectOption[] = options.parties.filter((party) => ["customer", "both"].includes(party.party_type))
    .map((party) => ({ value: party.id, label: `${party.display_name} (${party.code})` }));
  const partyContacts = options.contacts.filter((contact) => contact.party_id === partyId);
  const partyAddresses = options.addresses.filter((address) => address.party_id === partyId);
  const contactOptions: SelectOption[] = [{ value: "", label: "None" }, ...partyContacts.map((contact) => ({ value: contact.id, label: contactLabel(contact) }))];
  const addressOptionsFor = (types: string[]): SelectOption[] => [
    { value: "", label: "None" },
    ...usableAddresses(partyAddresses, types).map((address) => ({
      value: address.id,
      label: `${address.label || statusLabel(address.address_type)} — ${address.line1}${address.city ? `, ${address.city}` : ""}`
        + ((types === BILLING_ADDRESS_TYPES ? address.is_default_billing : address.is_default_shipping) ? " (default)" : ""),
    })),
  ];
  const itemOptions: SelectOption[] = options.items.map((item) => ({ value: item.id, label: `${item.name} (${item.code})` }));
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
    return Array.from(reachable).map((id) => uomById.get(id)).filter((uom): uom is NonNullable<typeof uom> => Boolean(uom))
      .map((uom) => ({ value: uom.id, label: `${uom.name} (${uom.code})` }));
  }
  const isService = (itemId: string) => options.items.find((item) => item.id === itemId)?.item_type === "service";
  const warehouseOptions: SelectOption[] = options.warehouses.map((warehouse) => ({ value: warehouse.id, label: `${warehouse.name} (${warehouse.code})` }));
  const lineWarehouseOptions: SelectOption[] = [{ value: "", label: defaultWarehouseId ? "Order default" : "No warehouse yet" }, ...warehouseOptions];
  const currencyOptions: SelectOption[] = options.currencies.map((currency) => ({ value: currency.code, label: `${currency.code} — ${currency.name}` }));
  const priceListOptions: SelectOption[] = [
    { value: "", label: "Customer's price list, else the default" },
    ...options.priceLists.filter((list) => list.currency_code.trim() === currencyCode).map((list) => ({ value: list.id, label: `${list.name}${list.is_default ? " (default)" : ""}` })),
  ];
  // The order's own terms (the accepted quotation's, when it came from one) stay selectable even if the term has since been deactivated.
  const keptTerm = order?.payment_term_snapshot;
  const paymentTermOptions: SelectOption[] = [
    { value: "", label: "Customer's terms, else the company default" },
    ...options.paymentTerms.map((term) => ({ value: term.id, label: `${term.name}${term.calculation_type === "net_days" ? ` (${term.days} days)` : term.calculation_type === "custom" ? " (due date entered on the invoice)" : ""}${term.is_default ? " · company default" : ""}` })),
    ...(keptTerm?.id && !options.paymentTerms.some((term) => term.id === keptTerm.id) ? [{ value: keptTerm.id, label: `${keptTerm.name ?? "Payment terms"} (as agreed; no longer offered)` }] : []),
  ];
  const ownerOptions: SelectOption[] = options.users.map((user) => ({ value: user.id, label: user.full_name }));

  function selectParty(id: string) {
    setPartyId(id);
    const party = options.parties.find((candidate) => candidate.id === id);
    if (party?.currency_code) setCurrencyCode(party.currency_code);
    setPaymentTermId(party?.payment_term_id && options.paymentTerms.some((term) => term.id === party.payment_term_id) ? party.payment_term_id : "");
    setPriceListId("");
    const addresses = options.addresses.filter((address) => address.party_id === id);
    setContactId(options.contacts.find((contact) => contact.party_id === id && contact.is_primary)?.id ?? "");
    setBillingAddressId(defaultAddress(addresses, BILLING_ADDRESS_TYPES));
    setShippingAddressId(defaultAddress(addresses, SHIPPING_ADDRESS_TYPES));
  }
  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }
  function selectLineItem(key: number, itemId: string) {
    const item = options.items.find((candidate) => candidate.id === itemId);
    // Another product is a new line: it is priced from today's price list, not from the quotation.
    updateLine(key, { itemId, quoted: false, salesOrderLineId: "", uomId: defaultLineUom(item, options.itemUomConversions), description: defaultLineDescription(item) });
  }

  const validLines = lines.filter((line) => line.itemId && line.quantity > 0);
  const input: SalesOrderDocumentInput | null = useMemo(() => {
    if (!partyId || !currencyCode || validLines.length === 0) return null;
    return {
      partyId,
      contactId: contactId || null,
      ownerUserId: ownerUserId || undefined,
      billingAddressId: billingAddressId || null,
      shippingAddressId: shippingAddressId || null,
      currencyCode,
      priceListId: priceListId || null,
      paymentTermId: paymentTermId || null,
      paymentTermsNote: paymentTermsNote.trim() || null,
      orderDate: orderDate || null,
      requestedDeliveryDate: deliveryDate || null,
      customerPoNumber: poNumber.trim() || null,
      customerPoDate: poDate || null,
      customerReference: customerReference.trim() || null,
      defaultWarehouseId: defaultWarehouseId || null,
      documentDiscountType: documentDiscount.type,
      documentDiscountValue: documentDiscount.value || undefined,
      discountReasonCode: documentDiscount.reasonCode || null,
      discountReasonText: documentDiscount.reasonText.trim() || null,
      customerNotes: customerNotes || undefined,
      internalNotes: internalNotes || undefined,
      ...taxInput(documentTax),
      termsAndConditions: terms || null,
      expectedVersionNumber: order?.version_number,
      lines: validLines.map((line) => ({
        ...(line.salesOrderLineId ? { salesOrderLineId: line.salesOrderLineId } : {}),
        itemId: line.itemId,
        uomId: line.uomId || undefined,
        description: line.description.trim() || undefined,
        ...(!line.quoted && line.unitPrice.trim() !== "" && Number.isFinite(Number(line.unitPrice))
          ? { unitPrice: Number(line.unitPrice), manualPriceReason: line.priceReason.trim() || undefined } : {}),
        quantity: line.quantity,
        ...(!line.quoted && line.discountValue ? { discountType: line.discountType, discountValue: line.discountValue } : {}),
        warehouseId: line.warehouseId || undefined,
      })),
      charges: charges.filter((charge) => charge.value > 0).map((charge) => ({ label: charge.label || "Charge", calculationType: charge.calculationType, value: charge.value })),
    };
  }, [partyId, contactId, ownerUserId, billingAddressId, shippingAddressId, currencyCode, priceListId, paymentTermId, paymentTermsNote, orderDate, deliveryDate, poNumber, poDate, customerReference,
    defaultWarehouseId, documentDiscount, customerNotes, internalNotes, documentTax, terms, order?.version_number, validLines, charges]);

  // Debounce so typing a quantity doesn't fire a pricing request per keystroke.
  const inputJson = JSON.stringify(input);
  const [debouncedJson, setDebouncedJson] = useState(inputJson);
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedJson(inputJson), 400);
    return () => clearTimeout(handle);
  }, [inputJson]);
  const previewInput = debouncedJson === "null" ? null : (JSON.parse(debouncedJson) as SalesOrderDocumentInput);
  const previewQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "order-preview", orderId ?? "new", debouncedJson),
    // A saved draft is previewed as its save would price it, so quoted lines keep their quoted price.
    queryFn: () => (orderId ? previewSalesOrder(orderId, previewInput!) : previewSalesDocument(previewInput as unknown as SalesDocumentInput)).then((r) => r.preview),
    enabled: Boolean(previewInput),
    retry: false,
    placeholderData: (previous) => previous,
  });
  const preview = previewQuery.data;
  const previewError = previewQuery.isError ? (previewQuery.error instanceof SalesApiError ? previewQuery.error.message : "Pricing could not be calculated.") : null;

  const submit = useSubmitKey();
  const save = useMutation({
    mutationFn: () => submit.run(async () => {
      if (!input) throw new SalesApiError("Choose a customer and add at least one item.", 400);
      if (orderId) {
        await updateSalesOrder(orderId, input);
        return orderId;
      }
      return (await createSalesOrder({ ...input, idempotencyKey })).order.id;
    }),
    onSuccess: (id) => onDone(id),
    onError: (failure) => setError(failure instanceof SalesApiError ? failure.message : "The order could not be saved."),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={existing ? `Edit ${order?.sales_order_number}` : "New Sales Order"}
        description={fromQuotation
          ? `Made from quotation ${order?.source_quotation_number}: quoted prices, discounts and tax are kept as agreed.`
          : "Saved as a draft. Totals update as you edit and are calculated by the server; confirm the order when it is ready."}
        secondaryActions={<Button variant="secondary" onPress={onCancel}>Cancel</Button>}
        primaryAction={
          <Button variant="primary" onPress={() => save.mutate()} isLoading={save.isPending || save.isSuccess} isDisabled={!input || Boolean(previewError) || Boolean(blocked)}>
            {existing ? "Save Draft" : "Save as Draft"}
          </Button>
        }
      />
      {error && <SalesAlert>{error}</SalesAlert>}
      {blocked && <SalesAlert>{blocked} An order cannot be placed for this customer.</SalesAlert>}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <SalesPanel title="Customer">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select label="Customer" isRequired options={partyOptions} selectedKey={partyId || null} onSelectionChange={(key) => selectParty(String(key ?? ""))}
                placeholder="Select a customer" isDisabled={fromQuotation} description={fromQuotation ? "An order made from a quotation keeps the quotation's customer." : undefined} />
              <Select label="Contact" options={contactOptions} selectedKey={contactId} onSelectionChange={(key) => setContactId(String(key ?? ""))} isDisabled={!partyId} />
              <Select label="Billing address" options={addressOptionsFor(BILLING_ADDRESS_TYPES)} selectedKey={billingAddressId} onSelectionChange={(key) => setBillingAddressId(String(key ?? ""))} isDisabled={!partyId} />
              <Select label="Shipping address" options={addressOptionsFor(SHIPPING_ADDRESS_TYPES)} selectedKey={shippingAddressId} onSelectionChange={(key) => setShippingAddressId(String(key ?? ""))} isDisabled={!partyId} />
            </div>
          </SalesPanel>

          <SalesPanel title="Order">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField label="Order date" type="date" isRequired value={orderDate} onChange={setOrderDate} />
              <TextField label="Requested delivery date" type="date" value={deliveryDate} onChange={setDeliveryDate} />
              <TextField label="Customer PO number" description="Warned when another order of this customer has the same PO." value={poNumber} onChange={setPoNumber} />
              <TextField label="Customer PO date" type="date" value={poDate} onChange={setPoDate} />
              <TextField label="Customer reference" value={customerReference} onChange={setCustomerReference} />
              <Select label="Salesperson" options={ownerOptions} selectedKey={ownerUserId || null} onSelectionChange={(key) => setOwnerUserId(String(key ?? ""))} />
              <Select label="Default warehouse" description="Used for goods lines without their own warehouse."
                options={[{ value: "", label: "None" }, ...warehouseOptions]} selectedKey={defaultWarehouseId} onSelectionChange={(key) => setDefaultWarehouseId(String(key ?? ""))} />
            </div>
          </SalesPanel>

          <SalesPanel title="Commercial terms" description={fromQuotation ? "Kept from the quotation." : undefined}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select label="Currency" options={currencyOptions} selectedKey={currencyCode} isDisabled={fromQuotation}
                onSelectionChange={(key) => { setCurrencyCode(String(key ?? baseCurrency)); setPriceListId(""); }} />
              <Select label="Price list" options={priceListOptions} selectedKey={priceListId} isDisabled={fromQuotation}
                description={preview?.priceList
                  ? `Pricing from ${preview.priceList.name}${preview.priceList.basis === "customer" ? " (the customer's list)" : preview.priceList.basis === "default" ? " (the default list)" : ""}, ${preview.priceList.taxInclusive ? "tax inclusive" : "tax exclusive"}.`
                  : partyId ? "No price list for this currency: products use their default price." : undefined}
                onSelectionChange={(key) => {
                  const next = String(key ?? "");
                  if (next === priceListId) return;
                  if (validLines.length) setPendingPriceList(next);
                  else setPriceListId(next);
                }} />
              <Select label="Payment terms" options={paymentTermOptions} selectedKey={paymentTermId} onSelectionChange={(key) => setPaymentTermId(String(key ?? ""))}
                description={options.paymentTerms.find((term) => term.id === paymentTermId)?.description ?? "When payment is due. Each invoice of the order gets its own due date."} />
              <TextField label="Additional payment terms" description="Optional, for this order only. Printed with the payment terms." value={paymentTermsNote} onChange={setPaymentTermsNote} />
            </div>
          </SalesPanel>

          <DocumentTaxPanel tax={options.tax} value={documentTax} onChange={setDocumentTax} preview={preview} />

          <SalesPanel title="Items" actions={<Button variant="secondary" size="compact" onPress={() => setLines((current) => [...current, blank()])}><Plus className="size-3.5" aria-hidden="true" />Add item</Button>}>
            <div className="flex flex-col gap-3">
              {lines.map((line, index) => {
                const priced = preview?.lines.find((candidate) => candidate.sequence === validLines.findIndex((valid) => valid.key === line.key) + 1);
                const uoms = uomOptionsFor(line.itemId);
                const service = isService(line.itemId);
                return (
                  <div key={line.key} className="grid grid-cols-1 items-end gap-2 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-[minmax(0,2.7fr)_minmax(0,0.8fr)_minmax(0,0.6fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_auto]">
                    <Select aria-label={`Item ${index + 1}`} label={index === 0 ? "Item" : undefined} options={itemOptions} selectedKey={line.itemId || null}
                      onSelectionChange={(key) => selectLineItem(line.key, String(key ?? ""))} placeholder="Select an item" />
                    <Select aria-label={`Unit ${index + 1}`} label={index === 0 ? "Unit" : undefined} options={uoms} selectedKey={line.uomId || null}
                      onSelectionChange={(key) => updateLine(line.key, { uomId: String(key ?? "") })} isDisabled={line.quoted || uoms.length <= 1} />
                    <NumberField aria-label={`Quantity ${index + 1}`} label={index === 0 ? "Quantity" : undefined} value={line.quantity}
                      onChange={(value) => updateLine(line.key, { quantity: value })} minValue={0} step={1} />
                    <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-end gap-1">
                      <NumberField aria-label={`Discount ${index + 1}`} label={index === 0 ? "Discount" : undefined} value={line.discountValue}
                        onChange={(value) => updateLine(line.key, { discountValue: Number.isFinite(value) ? value : 0 })} minValue={0}
                        maxValue={line.discountType === "percent" ? 100 : undefined} step={line.discountType === "percent" ? 0.5 : 0.01} isDisabled={line.quoted || !canDiscountLines} />
                      <Select aria-label={`Discount type ${index + 1}`} options={discountTypeOptions(options.discounts, currencyCode)} selectedKey={line.discountType}
                        onSelectionChange={(key) => updateLine(line.key, { discountType: key === "amount" ? "amount" : "percent", discountValue: 0 })} isDisabled={line.quoted || !canDiscountLines} />
                    </div>
                    <Select aria-label={`Warehouse ${index + 1}`} label={index === 0 ? "Warehouse" : undefined} options={lineWarehouseOptions} selectedKey={line.warehouseId}
                      onSelectionChange={(key) => updateLine(line.key, { warehouseId: String(key ?? "") })} isDisabled={service} />
                    <IconButton aria-label={`Remove item ${index + 1}`} variant="ghost" isDisabled={lines.length === 1}
                      onPress={() => setLines((current) => current.filter((candidate) => candidate.key !== line.key))}>
                      <Trash2 className="size-4" aria-hidden="true" />
                    </IconButton>
                    {line.itemId && (
                      <TextField className="sm:col-span-7" aria-label={`Description ${index + 1}`} placeholder="Description on the document" value={line.description}
                        onChange={(value) => updateLine(line.key, { description: value })} />
                    )}
                    {line.quoted && <p className="text-xs text-text-muted sm:col-span-7">From the quotation: the agreed price, discount and tax are kept. A service is not delivered or reserved.</p>}
                    {priced?.priceMissing && (
                      <p role="alert" className="rounded-[var(--radius-control)] border border-warning-emphasis/40 bg-warning-soft px-2 py-1 text-xs text-warning sm:col-span-7">
                        {priced.priceMessage}{" "}{canOverridePrice ? "Enter a price below, or choose another price list." : "Choose another price list, or ask someone who may set prices."}
                      </p>
                    )}
                    {line.itemId && !line.quoted && canOverridePrice && (
                      <div className="grid grid-cols-1 gap-2 sm:col-span-7 sm:grid-cols-[12rem_minmax(0,1fr)]">
                        <TextField aria-label={`Unit price ${index + 1}`} inputMode="decimal" value={line.unitPrice}
                          placeholder={priced && !priced.priceMissing ? `List price ${money(currencyCode, priced.listUnitPrice)}` : "Unit price"}
                          onChange={(value) => updateLine(line.key, { unitPrice: value.replace(/[^0-9.]/g, "") })} />
                        {line.unitPrice.trim() !== "" && (
                          <TextField aria-label={`Reason for the price ${index + 1}`} placeholder="Why this price? (required)" value={line.priceReason}
                            onChange={(value) => updateLine(line.key, { priceReason: value })} />
                        )}
                      </div>
                    )}
                    {priced && (
                      <p className="text-xs text-text-muted sm:col-span-7">
                        {money(currencyCode, priced.unitPrice)} each
                        {Number(priced.discountAmount) > 0 ? ` · discount ${priced.discountType === "percent" ? `${Number(priced.discountValue)}% = ` : ""}${money(currencyCode, priced.discountAmount)}` : ""}
                        {Number(priced.documentDiscountAmount) > 0 ? ` · additional discount ${money(currencyCode, priced.documentDiscountAmount)}` : ""}
                        {" · tax "}{money(currencyCode, priced.taxAmount)} · line total <span className="font-medium text-text">{money(currencyCode, priced.lineTotal)}</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </SalesPanel>

          <SalesPanel title="Charges" description="Freight, packing or handling, added to the order total."
            actions={<Button variant="secondary" size="compact" onPress={() => setCharges((current) => [...current, { key: nextKey(), label: "", calculationType: "fixed", value: 0 }])}><Plus className="size-3.5" aria-hidden="true" />Add charge</Button>}>
            {charges.length === 0 && <p className="text-sm text-text-muted">No charges.</p>}
            {charges.map((charge) => (
              <div key={charge.key} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                <TextField label="Label" value={charge.label} onChange={(value) => setCharges((current) => current.map((c) => (c.key === charge.key ? { ...c, label: value } : c)))} />
                <Select label="Type" options={[{ value: "fixed", label: "Fixed amount" }, { value: "percentage", label: "% of subtotal" }]} selectedKey={charge.calculationType}
                  onSelectionChange={(key) => setCharges((current) => current.map((c) => (c.key === charge.key ? { ...c, calculationType: key === "percentage" ? "percentage" : "fixed" } : c)))} />
                <NumberField label="Value" value={charge.value} minValue={0} step={0.01}
                  onChange={(value) => setCharges((current) => current.map((c) => (c.key === charge.key ? { ...c, value } : c)))} />
                <IconButton aria-label="Remove charge" variant="ghost" onPress={() => setCharges((current) => current.filter((c) => c.key !== charge.key))}><Trash2 className="size-4" aria-hidden="true" /></IconButton>
              </div>
            ))}
          </SalesPanel>

          {fromQuotation ? (
            <SalesPanel title="Additional discount" description="Kept from the quotation.">
              <p className="text-sm">{Number(order?.document_discount_amount) ? `${order?.document_discount_type === "percent" ? `${Number(order?.document_discount_value)}% · ` : ""}${money(currencyCode, order?.document_discount_amount)}` : "None"}</p>
            </SalesPanel>
          ) : (
            <DocumentDiscountPanel discounts={options.discounts} currencyCode={currencyCode} value={documentDiscount} onChange={setDocumentDiscount} preview={preview}
              hasAnyDiscount={documentDiscount.value > 0 || lines.some((line) => line.discountValue > 0)} />
          )}

          <SalesPanel title="Notes & terms">
            <TextArea label="Notes for the customer" description="Printed on the order confirmation." value={customerNotes} onChange={setCustomerNotes} />
            <TextArea label="Terms and conditions" description="Printed on the order confirmation." value={terms} onChange={setTerms} />
            <TextArea label="Internal notes" description="Never printed or sent to the customer." value={internalNotes} onChange={setInternalNotes} />
          </SalesPanel>
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-4">
          <SalesPanel title="Totals" description="Calculated by the server.">
            {previewError ? <SalesAlert tone="warning">{previewError}</SalesAlert>
              : !preview ? <p className="text-sm text-text-muted">Choose a customer and add an item to see pricing.</p>
                : <DocumentTotals currencyCode={currencyCode} preview={preview} />}
          </SalesPanel>
        </div>
      </div>
      <AlertDialog isOpen={pendingPriceList !== null} onOpenChange={(open) => !open && setPendingPriceList(null)} tone="primary"
        title="Re-price the lines with the new price list?" description="Every line without a manual price takes its price from the new list. Choose Cancel to keep the current price list."
        confirmLabel="Re-price lines" onConfirm={() => { setPriceListId(pendingPriceList ?? ""); setPendingPriceList(null); }} />
    </div>
  );
}

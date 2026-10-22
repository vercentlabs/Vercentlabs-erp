"use client";

// A new sales order, or changes to a Draft. Every total on the right comes
// from the server's own pricing (the same code that runs on save), so what
// you see is what is stored. An order made from a quotation executes what was
// agreed: its customer, currency, price list and additional discount stay,
// and each quoted line keeps its quoted price, discount and tax; quantities,
// warehouses, dates and addresses can still change while it is a draft.
import { useEffect, useMemo, useState } from "react";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { AlertDialog, Button, ErrorState, IconButton, NumberField, Select, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { useApp } from "@/shell/workspace-context/useApp";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { money, statusLabel } from "@/features/sales/shared/format";
import {
  BILLING_ADDRESS_TYPES, SHIPPING_ADDRESS_TYPES, contactLabel, defaultAddress, defaultLineDescription, defaultLineUom, usableAddresses,
} from "@/features/sales/shared/document-defaults";
import { getSalesOptions, previewSalesDocument, type SalesDocumentInput, type SalesDocumentScheme, type SalesOptions, type SalesSearchResults } from "@/features/sales/quotations/api/quotations-api";
import { SchemeOffers } from "@/features/sales/shared/SchemeOffers";
import { mrpNote } from "@/features/sales/shared/mrp";
import { mergeSalesOptions, SalesSearchPicker } from "@/features/sales/shared/SalesSearchPicker";
import { AUTOMATIC_TAX, DocumentTaxPanel, taxDraftOf, taxInput, type DocumentTaxDraft } from "@/features/sales/shared/DocumentTax";
import {
  DocumentDiscountPanel, DocumentTotals, NO_DOCUMENT_DISCOUNT, defaultDiscountType, discountTypeOptions, type DocumentDiscountDraft,
} from "@/features/sales/shared/DocumentDiscounts";

import {
  createSalesOrder, getSalesOrder, getSalesOrderDefaults, previewSalesOrder, updateSalesOrder, type SalesOrderDefaults, type SalesOrderDetail, type SalesOrderDocumentInput,
} from "../api/orders-api";
import { useSubmitKey } from "@/shared/http/submit-once";
import { DocumentFormPage } from "@/shared/ui/DocumentFormPage";
import { CustomerOrderCard } from "../components/CustomerOrderCard";
import { listSalesOrders } from "../api/orders-api";
import { FormSection } from "@/shared/ui/FormSection";
import { Notice, Panel } from "@/shared/ui/Panel";
import { ChargeRows, chargeDraftOf, chargesInput, type ChargeDraft } from "@/features/sales/shared/ChargeRows";

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
  // A free line of a scheme: no price, no discount (Sales audit M3).
  schemeRuleId: string;
};

let draftKey = 0;
const nextKey = () => ++draftKey;

export function SalesOrderFormScreen({ orderId, initialPartyId }: { orderId?: string; initialPartyId?: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const editing = Boolean(orderId);
  const defaultsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "order-defaults"), queryFn: () => getSalesOrderDefaults().then((r) => r.defaults) });
  const existingQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "order", orderId),
    queryFn: () => getSalesOrder(orderId!).then((r) => r.order),
    enabled: editing,
  });
  // The form's options carry the order's own customer and products (and that customer's contacts and addresses); any other is found by
  // searching (Sales audit B4).
  const optionParty = editing ? existingQuery.data?.order.party_id : initialPartyId;
  const optionItems = [...new Set((existingQuery.data?.lines ?? []).map((line) => line.item_id).filter(Boolean))] as string[];
  const optionsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "options", optionParty ?? "", optionItems.join(",")),
    queryFn: () => getSalesOptions(optionParty ?? undefined, optionItems).then((r) => r.options),
    enabled: !editing || Boolean(existingQuery.data),
  });

  if (editing && existingQuery.isError)
    return <ErrorState title="Could not load this order" action={{ label: "Retry", onPress: () => existingQuery.refetch() }} />;
  if (optionsQuery.isPending || defaultsQuery.isLoading || (editing && existingQuery.isLoading)) return <p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>;
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
      onDone={(id, andConfirm) => {
        void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "orders") });
        void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "order", id) });
        // Save & Confirm (Sales plan): the order opens with its confirmation, where credit and stock are checked.
        router.replace(`/sales/orders/${id}${andConfirm ? "?create=confirm" : ""}`);
      }}
      onCancel={() => router.replace(orderId ? `/sales/orders/${orderId}` : "/sales/orders")}
    />
  );
}

function FormBody({ options: initialOptions, defaults, existing, orderId, initialPartyId, onDone, onCancel }: {
  options: SalesOptions; defaults: SalesOrderDefaults; existing: SalesOrderDetail | null; orderId?: string; initialPartyId?: string;
  onDone: (id: string, andConfirm?: boolean) => void; onCancel: () => void;
}) {
  const workspace = useWorkspaceContext();
  // What the form holds grows as customers and products are found by search (Sales audit B4).
  const [options, setOptions] = useState(initialOptions);
  // Warehouses are asked for only when the business keeps stock.
  const stockOn = useApp("stock");
  const order = existing?.order;
  // An order made from a quotation keeps the agreed customer and commercial terms.
  const fromQuotation = Boolean(order?.source_quotation_id);
  const baseCurrency = options.currencies.find((currency) => currency.is_base)?.code ?? options.currencies[0]?.code ?? "INR";
  const seedParty = existing ? undefined : options.parties.find((party) => party.id === initialPartyId);
  const seedAddresses = options.addresses.filter((address) => address.party_id === seedParty?.id);
  const blank = (): LineDraft => ({
    key: nextKey(), salesOrderLineId: "", quoted: false, itemId: "", uomId: "", quantity: 1, discountType: defaultDiscountType(options.discounts),
    discountValue: 0, description: "", unitPrice: "", priceReason: "", warehouseId: "", schemeRuleId: "",
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
        schemeRuleId: line.scheme_rule_id ?? "",
      }))
    : [blank()]);
  // A saved draft's charges one by one (an older order's: their total, as one charge).
  const [charges, setCharges] = useState<ChargeDraft[]>(() => existing?.charges?.length ? existing.charges.map((charge) => chargeDraftOf(charge, nextKey()))
    : order && Number(order.charge_total) > 0 ? [{ key: nextKey(), chargeType: "other", label: "Charges", calculationType: "fixed", value: Number(order.charge_total), taxable: true }] : []);
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

  // The rest of what a scheme earns, as a free line of its free product (loaded into the options when the form does not have it yet).
  async function addFreeLine(scheme: SalesDocumentScheme) {
    let from = options;
    if (!from.items.some((item) => item.id === scheme.freeItemId)) {
      from = mergeSalesOptions(from, (await getSalesOptions(partyId || undefined, [scheme.freeItemId])).options);
      setOptions(from);
    }
    const item = from.items.find((candidate) => candidate.id === scheme.freeItemId);
    setLines((current) => [...current, {
      ...blank(), itemId: scheme.freeItemId, uomId: scheme.freeUomId ?? item?.uom_id ?? "", quantity: scheme.earned, schemeRuleId: scheme.ruleId,
      description: `${item?.name ?? scheme.freeItemName} (free: ${scheme.name})`,
    }]);
  }
  // Repeat last order (Sales plan, Flow 1): the customer's latest order's products and quantities, priced at today's prices and rules.
  const [repeating, setRepeating] = useState(false);
  async function repeatLastOrder() {
    setRepeating(true);
    try {
      const last = (await listSalesOrders({ partyId, sort: "date", direction: "desc", limit: 5 })).rows.find((row) => row.id !== orderId && row.status !== "cancelled");
      if (!last) { setError("This customer has no earlier order to repeat."); return; }
      const source = (await getSalesOrder(last.id)).order;
      const copied = source.lines.filter((line) => line.item_id && !line.scheme_rule_id);
      const itemIds = copied.map((line) => line.item_id).filter((id) => !options.items.some((item) => item.id === id));
      if (itemIds.length) setOptions(mergeSalesOptions(options, (await getSalesOptions(partyId || undefined, itemIds)).options));
      setLines([...lines.filter((line) => line.itemId), ...copied.map((line) => ({ ...blank(), itemId: line.item_id, uomId: line.uom_id ?? "", quantity: Number(line.quantity),
        warehouseId: line.warehouse_id ?? "", description: line.description_snapshot ?? "" }))]);
      setError(null);
    } catch (failure) {
      setError(failure instanceof SalesApiError ? failure.message : "The last order could not be copied.");
    } finally {
      setRepeating(false);
    }
  }
  // A picked customer brings its contacts and addresses (loaded now), then the form defaults from it.
  const [loadingParty, setLoadingParty] = useState(false);
  async function pickParty(id: string, found: SalesSearchResults) {
    let next = mergeSalesOptions(options, found);
    setPartyId(id);
    setLoadingParty(true);
    try {
      next = mergeSalesOptions(next, (await getSalesOptions(id)).options);
    } catch {
      setError("The customer's contacts and addresses could not be loaded. Try choosing the customer again.");
    } finally {
      setLoadingParty(false);
    }
    setOptions(next);
    selectParty(id, next);
  }
  function selectParty(id: string, from: SalesOptions = options) {
    setPartyId(id);
    const party = from.parties.find((candidate) => candidate.id === id);
    if (party?.currency_code) setCurrencyCode(party.currency_code);
    setPaymentTermId(party?.payment_term_id && from.paymentTerms.some((term) => term.id === party.payment_term_id) ? party.payment_term_id : "");
    setPriceListId("");
    // The customer's salesperson owns their documents; with none, whoever is creating it.
    if (party?.owner_user_id && from.users.some((user) => user.id === party.owner_user_id)) setOwnerUserId(party.owner_user_id);
    const addresses = from.addresses.filter((address) => address.party_id === id);
    setContactId(from.contacts.find((contact) => contact.party_id === id && contact.is_primary)?.id ?? "");
    setBillingAddressId(defaultAddress(addresses, BILLING_ADDRESS_TYPES));
    setShippingAddressId(defaultAddress(addresses, SHIPPING_ADDRESS_TYPES));
  }
  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }
  // A picked product joins the form's options with its unit conversions.
  function selectLineItem(key: number, itemId: string, found: SalesSearchResults) {
    const next = mergeSalesOptions(options, found);
    setOptions(next);
    const item = next.items.find((candidate) => candidate.id === itemId);
    // Another product is a new line: it is priced from today's price list, not from the quotation.
    updateLine(key, { itemId, quoted: false, salesOrderLineId: "", uomId: defaultLineUom(item, next.itemUomConversions), description: defaultLineDescription(item) });
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
        ...(line.schemeRuleId ? { schemeRuleId: line.schemeRuleId } : {}),
        ...(!line.quoted && !line.schemeRuleId && line.unitPrice.trim() !== "" && Number.isFinite(Number(line.unitPrice))
          ? { unitPrice: Number(line.unitPrice), manualPriceReason: line.priceReason.trim() || undefined } : {}),
        quantity: line.quantity,
        ...(!line.quoted && !line.schemeRuleId && line.discountValue ? { discountType: line.discountType, discountValue: line.discountValue } : {}),
        warehouseId: line.warehouseId || undefined,
      })),
      charges: chargesInput(charges),
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
  const canConfirm = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("sales.order.confirm");
  const save = useMutation({
    // The flag is read by onSuccess (Save & Confirm opens the confirmation).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    mutationFn: (_andConfirm: boolean) => submit.run(async () => {
      if (!input) throw new SalesApiError("Choose a customer and add at least one item.", 400);
      if (orderId) {
        await updateSalesOrder(orderId, input);
        return orderId;
      }
      return (await createSalesOrder({ ...input, idempotencyKey })).order.id;
    }),
    onSuccess: (id, andConfirm) => onDone(id, andConfirm),
    onError: (failure) => setError(failure instanceof SalesApiError ? failure.message : "The order could not be saved."),
  });

  return (
    <>
    <DocumentFormPage
      header={{
        title: existing ? `Edit ${order?.sales_order_number}` : "New Sales Order",
        description: fromQuotation
          ? `Made from quotation ${order?.source_quotation_number}: quoted prices, discounts and tax are kept as agreed.`
          : "Saved as a draft. Totals update as you edit and are calculated by the server; confirm the order when it is ready.",
      }}
      banner={<div className="flex flex-col gap-3">
        {error && <Notice>{error}</Notice>}
      {blocked && <Notice>{blocked} An order cannot be placed for this customer.</Notice>}
      </div>}
      formActions={
        <>
          <Button variant="secondary" onPress={onCancel}>Cancel</Button>
          <Button variant={canConfirm ? "secondary" : "primary"} onPress={() => save.mutate(false)} isLoading={(save.isPending || save.isSuccess) && save.variables === false} isDisabled={!input || Boolean(previewError) || Boolean(blocked) || save.isPending || save.isSuccess}>
            {existing ? "Save Draft" : "Save as Draft"}
          </Button>
          {canConfirm && (
            <Button variant="primary" onPress={() => save.mutate(true)} isLoading={(save.isPending || save.isSuccess) && save.variables === true} isDisabled={!input || Boolean(previewError) || Boolean(blocked) || save.isPending || save.isSuccess}>
              Save &amp; Confirm
            </Button>
          )}
        </>
      }
      aside={<>
        <Panel title="Totals" description="Calculated by the server.">
            {previewError ? <Notice tone="warning">{previewError}</Notice>
              : !preview ? <p className="text-sm text-text-muted">Choose a customer and add an item to see pricing.</p>
                : <DocumentTotals currencyCode={currencyCode} preview={preview} />}
          </Panel>
          <SchemeOffers schemes={preview?.schemes} onAdd={(scheme) => void addFreeLine(scheme)} />
          {partyId && <CustomerOrderCard partyId={partyId} />}
      </>}
    >

          <FormSection columns={1} title="Customer">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SalesSearchPicker kind="customers" customersOnly label="Customer" isRequired known={options} value={partyId || null} onPick={(id, found) => void pickParty(id, found)}
                placeholder={loadingParty ? "Loading the customer…" : "Search customers by name, code, GSTIN or phone"} isDisabled={fromQuotation} description={fromQuotation ? "An order made from a quotation keeps the quotation's customer." : undefined} />
              <Select label="Contact" options={contactOptions} selectedKey={contactId} onSelectionChange={(key) => setContactId(String(key ?? ""))} isDisabled={!partyId} />
            </div>
          </FormSection>

          <FormSection columns={1} title="Order">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField label="Order date" type="date" isRequired value={orderDate} onChange={setOrderDate} />
              <TextField label="Requested delivery date" type="date" value={deliveryDate} onChange={setDeliveryDate} />
              <TextField label="Customer PO number" description="Warned when another order of this customer has the same PO." value={poNumber} onChange={setPoNumber} />
            </div>
          </FormSection>

          <FormSection columns={1} title="Items" actions={<>
            {partyId && !fromQuotation && <Button variant="ghost" size="compact" isLoading={repeating} onPress={() => void repeatLastOrder()}>Repeat last order</Button>}
            <Button variant="secondary" size="compact" onPress={() => setLines((current) => [...current, blank()])}><Plus className="size-3.5" aria-hidden="true" />Add item</Button>
          </>}>
            <div className="flex flex-col gap-3">
              {lines.map((line, index) => {
                const priced = preview?.lines.find((candidate) => candidate.sequence === validLines.findIndex((valid) => valid.key === line.key) + 1);
                const uoms = uomOptionsFor(line.itemId);
                const service = isService(line.itemId);
                return (
                  <div key={line.key} className="grid grid-cols-1 items-end gap-2 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-[minmax(0,2.7fr)_minmax(0,0.8fr)_minmax(0,0.6fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_auto]">
                    <SalesSearchPicker kind="products" aria-label={`Item ${index + 1}`} label={index === 0 ? "Item" : undefined} known={options} value={line.itemId || null}
                      onPick={(id, found) => selectLineItem(line.key, id, found)} placeholder="Search products by name, code, HSN or barcode" />
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
                    {stockOn ? <Select aria-label={`Warehouse ${index + 1}`} label={index === 0 ? "Warehouse" : undefined} options={lineWarehouseOptions} selectedKey={line.warehouseId}
                      onSelectionChange={(key) => updateLine(line.key, { warehouseId: String(key ?? "") })} isDisabled={service} /> : <span aria-hidden="true" />}
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
                    {line.schemeRuleId && <p className="text-xs text-success sm:col-span-7">Free under a scheme: no price and no discount.</p>}
                    {line.itemId && !line.quoted && !line.schemeRuleId && canOverridePrice && (
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
                        {money(currencyCode, priced.unitPrice)} each{mrpNote(priced, currencyCode)}
                        {Number(priced.discountAmount) > 0 ? ` · discount ${priced.discountType === "percent" ? `${Number(priced.discountValue)}% = ` : ""}${money(currencyCode, priced.discountAmount)}` : ""}
                        {Number(priced.documentDiscountAmount) > 0 ? ` · additional discount ${money(currencyCode, priced.documentDiscountAmount)}` : ""}
                        {" · tax "}{money(currencyCode, priced.taxAmount)} · line total <span className="font-medium text-text">{money(currencyCode, priced.lineTotal)}</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </FormSection>

          <FormSection columns={1} title="Charges" description="Freight, packing or handling, added to the order total."
            actions={<Button variant="secondary" size="compact" onPress={() => setCharges((current) => [...current, { key: nextKey(), chargeType: "freight", label: "", calculationType: "fixed", value: 0, taxable: true }])}><Plus className="size-3.5" aria-hidden="true" />Add charge</Button>}>
            {charges.length === 0 && <p className="text-sm text-text-muted">No charges.</p>}
            <ChargeRows charges={charges} onChange={setCharges} />
          </FormSection>

          {fromQuotation ? (
            <FormSection columns={1} title="Additional discount" description="Kept from the quotation.">
              <p className="text-sm">{Number(order?.document_discount_amount) ? `${order?.document_discount_type === "percent" ? `${Number(order?.document_discount_value)}% · ` : ""}${money(currencyCode, order?.document_discount_amount)}` : "None"}</p>
            </FormSection>
          ) : (
            <DocumentDiscountPanel discounts={options.discounts} currencyCode={currencyCode} value={documentDiscount} onChange={setDocumentDiscount} preview={preview}
              hasAnyDiscount={documentDiscount.value > 0 || lines.some((line) => line.discountValue > 0)} />
          )}

          {/* Everything but the customer, dates, PO and items, out of the way until wanted (Line-by-line audit). Open when editing. */}
          <details className="group rounded-[var(--radius-card)] border border-border bg-surface" open={Boolean(orderId) || undefined}>
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-text">
              More details <span className="font-normal text-text-secondary">— addresses, PO date, reference, salesperson, warehouse, currency and price list, payment terms and tax</span>
            </summary>
            <div className="flex flex-col gap-4 border-t border-border p-4">
              <FormSection columns={1} title="Addresses & order details">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select label="Billing address" options={addressOptionsFor(BILLING_ADDRESS_TYPES)} selectedKey={billingAddressId} onSelectionChange={(key) => setBillingAddressId(String(key ?? ""))} isDisabled={!partyId} />
              <Select label="Shipping address" options={addressOptionsFor(SHIPPING_ADDRESS_TYPES)} selectedKey={shippingAddressId} onSelectionChange={(key) => setShippingAddressId(String(key ?? ""))} isDisabled={!partyId} />
              <TextField label="Customer PO date" type="date" value={poDate} onChange={setPoDate} />
              <TextField label="Customer reference" value={customerReference} onChange={setCustomerReference} />
              <Select label="Salesperson" options={ownerOptions} selectedKey={ownerUserId || null} onSelectionChange={(key) => setOwnerUserId(String(key ?? ""))} />
              {stockOn && <Select label="Default warehouse" description="Used for goods lines without their own warehouse."
                options={[{ value: "", label: "None" }, ...warehouseOptions]} selectedKey={defaultWarehouseId} onSelectionChange={(key) => setDefaultWarehouseId(String(key ?? ""))} />}
                </div>
              </FormSection>
          <FormSection columns={1} title="Commercial terms" description={fromQuotation ? "Kept from the quotation." : undefined}>
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
          </FormSection>

          <DocumentTaxPanel tax={options.tax} value={documentTax} onChange={setDocumentTax} preview={preview} />

            </div>
          </details>

          <FormSection columns={1} title="Notes & terms">
            <TextArea label="Notes for the customer" description="Printed on the order confirmation." value={customerNotes} onChange={setCustomerNotes} />
            <TextArea label="Terms and conditions" description="Printed on the order confirmation." value={terms} onChange={setTerms} />
            <TextArea label="Internal notes" description="Never printed or sent to the customer." value={internalNotes} onChange={setInternalNotes} />
          </FormSection>
    </DocumentFormPage>
    <AlertDialog isOpen={pendingPriceList !== null} onOpenChange={(open) => !open && setPendingPriceList(null)} tone="primary"
        title="Re-price the lines with the new price list?" description="Every line without a manual price takes its price from the new list. Choose Cancel to keep the current price list."
        confirmLabel="Re-price lines" onConfirm={() => { setPriceListId(pendingPriceList ?? ""); setPendingPriceList(null); }} />
    </>
  );
}

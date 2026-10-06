"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import {
  AlertDialog,
  Button,
  ErrorState,
  IconButton,
  NumberField,
  PageHeader,
  Select,
  TextArea,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { CustomerQuickCreateDialog } from "@/features/sales/customers/components/CustomerDialogs";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { money, statusLabel } from "@/features/sales/shared/format";
import {
  BILLING_ADDRESS_TYPES,
  defaultAddress,
  SHIPPING_ADDRESS_TYPES,
  contactLabel,
  usableAddresses,
  defaultLineDescription,
  defaultLineUom,
} from "@/features/sales/shared/document-defaults";
import {
  SalesAlert,
  SalesPanel,
} from "@/features/sales/shared/SalesUi";
import { AUTOMATIC_TAX, DocumentTaxPanel, taxDraftOf, taxInput, type DocumentTaxDraft } from "@/features/sales/shared/DocumentTax";
import {
  DocumentDiscountPanel,
  DocumentTotals,
  NO_DOCUMENT_DISCOUNT,
  defaultDiscountType,
  discountTypeOptions,
  type DocumentDiscountDraft,
} from "@/features/sales/shared/DocumentDiscounts";
import {
  createSalesQuotation,
  getQuotationDefaults,
  getSalesOptions,
  getSalesQuotation,
  previewSalesDocument,
  updateSalesQuotation,
  type QuotationDefaults,
  type SalesDocumentInput,
  type SalesQuotationDetail,
} from "@/features/sales/quotations/api/quotations-api";
import { useSubmitKey } from "@/shared/http/submit-once";

type LineDraft = {
  key: number;
  itemId: string;
  variantId: string;
  uomId: string;
  quantity: number;
  discountType: "percent" | "amount";
  discountValue: number;
  description: string;
  // "" means the price list price; anything else is a manual price.
  unitPrice: string;
  priceReason: string;
};
type ChargeDraft = {
  key: number;
  label: string;
  calculationType: "fixed" | "percentage";
  value: number;
};

let draftKey = 0;
const nextKey = () => ++draftKey;

const emptyLine = (): LineDraft => ({
  key: nextKey(), itemId: "", variantId: "", uomId: "", quantity: 1, discountType: "percent", discountValue: 0, description: "", unitPrice: "", priceReason: "",
});

// Create a quotation (Sales → Quotations → New), or edit a Draft. Each save
// of a draft is kept as a version; a confirmed quotation is changed through
// a revision. The totals on the right come from the server's own
// previewSalesDocument (the same pricing/tax/discount code that runs on
// save), debounced -- the browser never computes a price, so what you see is
// what is stored.
export function SalesQuotationFormScreen({
  quotationId,
  initialPartyId,
  initialContactId,
}: {
  quotationId?: string;
  initialPartyId?: string;
  initialContactId?: string;
}) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const editing = Boolean(quotationId);

  const optionsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "options"),
    queryFn: () => getSalesOptions().then((r) => r.options),
  });
  const existingQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "quotation", quotationId),
    queryFn: () => getSalesQuotation(quotationId!).then((r) => r.quotation),
    enabled: editing,
  });
  const defaultsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "quotation-defaults"),
    queryFn: () => getQuotationDefaults().then((r) => r.defaults),
  });

  if (optionsQuery.isLoading || defaultsQuery.isLoading || (editing && existingQuery.isLoading))
    return <p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>;
  if (optionsQuery.isError || !optionsQuery.data)
    return (
      <ErrorState
        title="Could not load the form"
        action={{ label: "Retry", onPress: () => optionsQuery.refetch() }}
      />
    );
  if (defaultsQuery.isError || !defaultsQuery.data)
    return (
      <ErrorState
        title="Could not load the form"
        action={{ label: "Retry", onPress: () => defaultsQuery.refetch() }}
      />
    );
  if (editing && (existingQuery.isError || !existingQuery.data))
    return (
      <ErrorState
        title="Could not load this quotation"
        action={{ label: "Retry", onPress: () => existingQuery.refetch() }}
      />
    );

  return (
    <FormBody
      key={quotationId ?? `new-${initialPartyId ?? ""}`}
      options={optionsQuery.data}
      defaults={defaultsQuery.data}
      existing={existingQuery.data ?? null}
      quotationId={quotationId}
      initialPartyId={initialPartyId}
      initialContactId={initialContactId}
      onDone={(id) => {
        queryClient.invalidateQueries({
          queryKey: scopedQueryKey(workspace, "sales", "quotations"),
        });
        queryClient.invalidateQueries({
          queryKey: scopedQueryKey(workspace, "sales", "quotation", id),
        });
        router.push(`/sales/quotations/${id}`);
      }}
      onCancel={() =>
        router.push(
          quotationId
            ? `/sales/quotations/${quotationId}`
            : "/sales/quotations",
        )
      }
      onCustomerCreated={async (customerId) => {
        // The new customer joins the options, then the form restarts with it
        // chosen so its terms, contact and addresses are defaulted.
        await optionsQuery.refetch();
        router.replace(`/sales/quotations/new?customer=${customerId}`);
      }}
    />
  );
}

function FormBody({
  options,
  defaults,
  existing,
  quotationId,
  initialPartyId,
  initialContactId,
  onDone,
  onCancel,
  onCustomerCreated,
}: {
  options: NonNullable<
    ReturnType<typeof getSalesOptions> extends Promise<infer R>
      ? R extends { options: infer O }
        ? O
        : never
      : never
  >;
  defaults: QuotationDefaults;
  existing: SalesQuotationDetail | null;
  quotationId?: string;
  initialPartyId?: string;
  initialContactId?: string;
  onDone: (id: string) => void;
  onCancel: () => void;
  onCustomerCreated: (customerId: string) => void;
}) {
  const workspace = useWorkspaceContext();
  const editing = Boolean(quotationId);
  // A revision stays an offer to the same customer.
  const customerLocked = Boolean(existing && existing.quotation.revision_number > 0);
  const canCreateCustomer =
    workspace.roleSlugs.includes("organization_owner") ||
    workspace.permissions.includes("sales.customers.create");
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const baseCurrency =
    options.currencies.find((currency) => currency.is_base)?.code ??
    options.currencies[0]?.code ??
    "INR";

  const [partyId, setPartyId] = useState(
    existing?.quotation.party_id ??
      (options.parties.some((p) => p.id === initialPartyId)
        ? (initialPartyId ?? "")
        : ""),
  );
  // On a fresh quotation opened with a customer already chosen (e.g. "New
  // quotation" from that customer's detail page), partyId is seeded directly
  // above rather than through selectParty() below -- so the same
  // primary-contact/address defaulting has to run here too, not just there.
  const [contactId, setContactId] = useState(() => {
    if (existing) return existing.quotation.contact_id ?? "";
    if (
      options.contacts.some(
        (c) => c.id === initialContactId && c.party_id === partyId,
      )
    )
      return initialContactId!;
    return (
      options.contacts.find((c) => c.party_id === partyId && c.is_primary)
        ?.id ?? ""
    );
  });
  const [billingAddressId, setBillingAddressId] = useState(
    existing?.quotation.billing_address_id ??
      defaultAddress(
        options.addresses.filter((a) => a.party_id === partyId),
        BILLING_ADDRESS_TYPES,
      ),
  );
  const [shippingAddressId, setShippingAddressId] = useState(
    existing?.quotation.shipping_address_id ??
      defaultAddress(
        options.addresses.filter((a) => a.party_id === partyId),
        SHIPPING_ADDRESS_TYPES,
      ),
  );
  const [currencyCode, setCurrencyCode] = useState(
    existing?.quotation.currency_code ?? baseCurrency,
  );
  const [priceListId, setPriceListId] = useState(
    existing?.quotation.price_list_id ?? "",
  );
  // A price list change waiting for "re-price the lines?"
  const [pendingPriceList, setPendingPriceList] = useState<string | null>(null);
  const canOverridePrice =
    workspace.roleSlugs.includes("organization_owner") ||
    workspace.permissions.includes("sales.price.override");
  const [paymentTermId, setPaymentTermId] = useState(
    existing?.quotation.payment_term_id ?? "",
  );
  // Additional payment terms for this quotation only, printed with its terms.
  const [paymentTermsNote, setPaymentTermsNote] = useState(existing?.quotation.payment_term_snapshot?.note ?? "");
  const [quotationDate, setQuotationDate] = useState(
    existing?.quotation.quotation_date?.slice(0, 10) ?? defaults.quotationDate,
  );
  const [validUntil, setValidUntil] = useState(
    existing?.quotation.valid_until?.slice(0, 10) ?? defaults.validUntil,
  );
  const [ownerUserId, setOwnerUserId] = useState(
    existing?.quotation.owner_user_id ?? workspace.userId ?? "",
  );
  const [customerReference, setCustomerReference] = useState(
    existing?.quotation.customer_reference ?? "",
  );
  const [documentDiscount, setDocumentDiscount] = useState<DocumentDiscountDraft>(() => existing
    ? {
        type: existing.quotation.document_discount_type === "amount" ? "amount" : "percent",
        value: Number(existing.quotation.document_discount_value ?? 0),
        reasonCode: existing.quotation.discount_reason_code ?? "",
        reasonText: existing.quotation.discount_reason_text ?? "",
      }
    : { ...NO_DOCUMENT_DISCOUNT, type: defaultDiscountType(options.discounts) });
  const canDiscountLines = options.discounts.allowLine && options.discounts.canApplyLine;
  const [customerNotes, setCustomerNotes] = useState(
    existing?.quotation.customer_notes ?? "",
  );
  const [internalNotes, setInternalNotes] = useState(
    existing?.quotation.internal_notes ?? "",
  );
  // A new quotation starts with the company's standard terms.
  const [terms, setTerms] = useState(
    existing ? existing.quotation.terms_and_conditions ?? "" : defaults.termsAndConditions ?? "",
  );
  const initialParty = options.parties.find((party) => party.id === partyId);
  const [shippingMethod, setShippingMethod] = useState(
    existing?.quotation.shipping_method ??
      initialParty?.default_shipping_method ??
      "",
  );
  const [deliveryTerms, setDeliveryTerms] = useState(
    existing?.quotation.delivery_terms ??
      initialParty?.default_delivery_terms ??
      "",
  );
  const [incoterm, setIncoterm] = useState(
    existing?.quotation.incoterm ?? initialParty?.default_incoterm ?? "",
  );
  // Tax is worked out by the server; this holds only what the user overrides.
  const [documentTax, setDocumentTax] = useState<DocumentTaxDraft>(() => (existing ? taxDraftOf(existing.quotation) : AUTOMATIC_TAX));
  const [lines, setLines] = useState<LineDraft[]>(() =>
    existing?.lines.length
      ? existing.lines.map((line) => ({
          key: nextKey(),
          itemId: line.item_id,
          variantId: line.variant_id ?? "",
          uomId: line.uom_id ?? "",
          quantity: Number(line.quantity),
          discountType: line.discount_type === "amount" ? "amount" : "percent",
          discountValue: Number(line.discount_type === "amount" ? line.discount_value : line.discount_percent),
          description: line.description_snapshot ?? "",
          unitPrice: line.manual_price_override ? String(Number(line.unit_price)) : "",
          priceReason: line.manual_price_reason ?? "",
        }))
      : [{ ...emptyLine(), discountType: defaultDiscountType(options.discounts) }],
  );
  const [charges, setCharges] = useState<ChargeDraft[]>(() =>
    (existing?.charges ?? []).map((charge) => ({
      key: nextKey(),
      label: charge.label,
      calculationType: charge.calculation_type as "fixed" | "percentage",
      value: Number(charge.value),
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const partyOptions: SelectOption[] = options.parties.map((party) => ({
    value: party.id,
    label: `${party.display_name} (${party.code})`,
  }));
  // Every top-ERP customer-master comparison (SAP's partner functions,
  // NetSuite's per-transaction ship-to/bill-to) resolves contact/address at
  // the document level, independent of which one the customer has marked
  // primary -- so these list every contact/address that belongs to the
  // chosen customer, not just its primary ones.
  const partyContacts = options.contacts.filter(
    (contact) => contact.party_id === partyId,
  );
  const partyAddresses = options.addresses.filter(
    (address) => address.party_id === partyId,
  );
  const contactOptions: SelectOption[] = [
    { value: "", label: "None" },
    ...partyContacts.map((contact) => ({
      value: contact.id,
      label: contactLabel(contact),
    })),
  ];
  const addressOptionsFor = (types: string[]): SelectOption[] => [
    { value: "", label: "None" },
    ...usableAddresses(partyAddresses, types).map((address) => ({
      value: address.id,
      label:
        `${address.label || statusLabel(address.address_type)} — ${address.line1}${address.city ? `, ${address.city}` : ""}` +
        ((types === BILLING_ADDRESS_TYPES
          ? address.is_default_billing
          : address.is_default_shipping)
          ? " (default)"
          : ""),
    })),
  ];
  const billingAddressOptions = addressOptionsFor(BILLING_ADDRESS_TYPES);
  const shippingAddressOptions = addressOptionsFor(SHIPPING_ADDRESS_TYPES);
  const itemOptions: SelectOption[] = options.items.map((item) => ({
    value: item.id,
    label: `${item.name} (${item.code})`,
  }));
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
    const variants = options.itemVariants.filter(
      (variant) => variant.item_id === itemId,
    );
    return [
      { value: "", label: "Standard (no variant)" },
      ...variants.map((variant) => ({
        value: variant.id,
        label: `${variant.sku} — ${variant.name}`,
      })),
    ];
  }
  function selectLineItem(key: number, itemId: string) {
    const item = options.items.find((candidate) => candidate.id === itemId);
    updateLine(key, { itemId, variantId: "", uomId: defaultLineUom(item, options.itemUomConversions), description: defaultLineDescription(item) });
  }
  const currencyOptions: SelectOption[] = options.currencies.map(
    (currency) => ({
      value: currency.code,
      label: `${currency.code} — ${currency.name}`,
    }),
  );
  const priceListOptions: SelectOption[] = [
    { value: "", label: "Customer's price list, else the default" },
    ...options.priceLists
      .filter((list) => list.currency_code.trim() === currencyCode)
      .map((list) => ({ value: list.id, label: `${list.name}${list.is_default ? " (default)" : ""}` })),
  ];
  const ownerOptions: SelectOption[] = options.users.map((user) => ({ value: user.id, label: user.full_name }));
  // The quotation's own terms stay selectable even if the term has since been deactivated.
  const keptTerm = existing?.quotation.payment_term_snapshot;
  const paymentTermOptions: SelectOption[] = [
    { value: "", label: "Customer's terms, else the company default" },
    ...options.paymentTerms.map((term) => ({ value: term.id, label: `${term.name}${term.calculation_type === "net_days" ? ` (${term.days} days)` : term.calculation_type === "custom" ? " (due date entered on the invoice)" : ""}${term.is_default ? " · company default" : ""}` })),
    ...(keptTerm?.id && !options.paymentTerms.some((term) => term.id === keptTerm.id) ? [{ value: keptTerm.id, label: `${keptTerm.name ?? "Payment terms"} (as agreed; no longer offered)` }] : []),
  ];

  function selectParty(id: string) {
    setPartyId(id);
    const party = options.parties.find((candidate) => candidate.id === id);
    // A customer's own currency and terms are the natural starting point; the
    // user can still change either, and the server validates the combination.
    if (party?.currency_code) setCurrencyCode(party.currency_code);
    // The customer's terms, else the company default.
    setPaymentTermId(party?.payment_term_id && options.paymentTerms.some((term) => term.id === party.payment_term_id) ? party.payment_term_id : "");
    setPriceListId("");
    setShippingMethod(party?.default_shipping_method ?? "");
    setDeliveryTerms(party?.default_delivery_terms ?? "");
    setIncoterm(party?.default_incoterm ?? "");
    setDocumentTax((current) => ({ ...AUTOMATIC_TAX, sellerRegistrationId: current.sellerRegistrationId }));
    // Default to the new customer's primary contact/billing/shipping address
    // (still fully overridable below) -- the previous customer's selections
    // don't carry over.
    const contacts = options.contacts.filter(
      (contact) => contact.party_id === id,
    );
    const addresses = options.addresses.filter(
      (address) => address.party_id === id,
    );
    setContactId(contacts.find((contact) => contact.is_primary)?.id ?? "");
    setBillingAddressId(defaultAddress(addresses, BILLING_ADDRESS_TYPES));
    setShippingAddressId(defaultAddress(addresses, SHIPPING_ADDRESS_TYPES));
  }

  const validLines = lines.filter((line) => line.itemId && line.quantity > 0);
  const input: SalesDocumentInput | null = useMemo(() => {
    if (!partyId || !currencyCode || validLines.length === 0) return null;
    return {
      partyId,
      contactId: contactId || null,
      ownerUserId: ownerUserId || undefined,
      quotationDate: quotationDate || null,
      customerReference: customerReference.trim() || null,
      billingAddressId: billingAddressId || undefined,
      shippingAddressId: shippingAddressId || undefined,
      currencyCode,
      priceListId: priceListId || null,
      paymentTermId: paymentTermId || null,
      paymentTermsNote: paymentTermsNote.trim() || null,
      validUntil: validUntil || null,
      documentDiscountType: documentDiscount.type,
      documentDiscountValue: documentDiscount.value || undefined,
      discountReasonCode: documentDiscount.reasonCode || null,
      discountReasonText: documentDiscount.reasonText.trim() || null,
      customerNotes: customerNotes || undefined,
      internalNotes: internalNotes || undefined,
      termsAndConditions: terms,
      shippingMethod: shippingMethod || undefined,
      deliveryTerms: deliveryTerms || undefined,
      incoterm: incoterm || undefined,
      ...taxInput(documentTax),
      lines: validLines.map((line) => ({
        itemId: line.itemId,
        variantId: line.variantId || undefined,
        uomId: line.uomId || undefined,
        description: line.description.trim() || undefined,
        ...(line.unitPrice.trim() !== "" && Number.isFinite(Number(line.unitPrice))
          ? { unitPrice: Number(line.unitPrice), manualPriceReason: line.priceReason.trim() || undefined }
          : {}),
        quantity: line.quantity,
        ...(line.discountValue ? { discountType: line.discountType, discountValue: line.discountValue } : {}),
      })),
      charges: charges
        .filter((charge) => charge.value > 0)
        .map((charge) => ({
          label: charge.label || "Charge",
          calculationType: charge.calculationType,
          value: charge.value,
        })),
    };
  }, [
    partyId,
    contactId,
    billingAddressId,
    shippingAddressId,
    currencyCode,
    priceListId,
    paymentTermId,
    paymentTermsNote,
    ownerUserId,
    quotationDate,
    customerReference,
    validUntil,
    documentDiscount,
    customerNotes,
    internalNotes,
    terms,
    shippingMethod,
    deliveryTerms,
    incoterm,
    documentTax,
    validLines,
    charges,
  ]);

  // Debounce so typing a quantity doesn't fire a pricing request per keystroke.
  const inputJson = JSON.stringify(input);
  const [debouncedJson, setDebouncedJson] = useState(inputJson);
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedJson(inputJson), 400);
    return () => clearTimeout(handle);
  }, [inputJson]);
  const previewInput: SalesDocumentInput | null =
    debouncedJson === "null"
      ? null
      : (JSON.parse(debouncedJson) as SalesDocumentInput);

  const previewQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "preview", debouncedJson),
    queryFn: () => previewSalesDocument(previewInput!).then((r) => r.preview),
    enabled: Boolean(previewInput),
    retry: false,
    placeholderData: (previous) => previous,
  });

  const submit = useSubmitKey();
  const saveMutation = useMutation({
    mutationFn: () => submit.run(async () => {
      if (!input)
        throw new SalesApiError(
          "Choose a customer and add at least one item.",
          400,
        );
      if (quotationId && existing) {
        await updateSalesQuotation(quotationId, { ...input, expectedVersionNumber: existing.quotation.version_number });
        return quotationId;
      }
      const result = await createSalesQuotation({ ...input, idempotencyKey });
      return result.quotation.id;
    }),
    onSuccess: (id) => onDone(id),
    onError: (err) =>
      setError(
        err instanceof SalesApiError
          ? err.message
          : "The quotation could not be saved.",
      ),
  });

  const preview = previewQuery.data;
  const previewError = previewQuery.isError
    ? previewQuery.error instanceof SalesApiError
      ? previewQuery.error.message
      : "Pricing could not be calculated."
    : null;

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          editing
            ? `Edit ${existing?.quotation.quotation_number}`
            : "New quotation"
        }
        description={
          editing
            ? "A draft can be changed until it is confirmed. Each save is kept in the quotation's history."
            : "Build a priced offer for a customer. Totals update as you edit and are calculated by the server."
        }
        secondaryActions={
          <Button variant="secondary" onPress={onCancel}>
            Cancel
          </Button>
        }
        primaryAction={
          <Button
            variant="primary"
            onPress={() => saveMutation.mutate()}
            isLoading={saveMutation.isPending || saveMutation.isSuccess}
            isDisabled={!input || Boolean(previewError)}
          >
            {editing ? "Save changes" : "Save draft"}
          </Button>
        }
      />

      {error && <SalesAlert>{error}</SalesAlert>}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <SalesPanel title="Customer & terms">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label="Customer"
                isRequired
                options={partyOptions}
                selectedKey={partyId || null}
                onSelectionChange={(key) => selectParty(String(key ?? ""))}
                placeholder="Select a customer"
                isDisabled={customerLocked}
                description={
                  !editing && canCreateCustomer ? (
                    <button
                      type="button"
                      className="text-brand underline-offset-2 hover:underline"
                      onClick={() => setCreatingCustomer(true)}
                    >
                      New customer
                    </button>
                  ) : undefined
                }
              />
              <Select
                label="Contact"
                options={contactOptions}
                selectedKey={contactId}
                onSelectionChange={(key) => setContactId(String(key ?? ""))}
                isDisabled={!partyId}
              />
              <Select
                label="Billing address"
                options={billingAddressOptions}
                selectedKey={billingAddressId}
                onSelectionChange={(key) =>
                  setBillingAddressId(String(key ?? ""))
                }
                isDisabled={!partyId}
              />
              <Select
                label="Shipping address"
                options={shippingAddressOptions}
                selectedKey={shippingAddressId}
                onSelectionChange={(key) =>
                  setShippingAddressId(String(key ?? ""))
                }
                isDisabled={!partyId}
              />
              <TextField
                label="Quotation date"
                type="date"
                isRequired
                value={quotationDate}
                onChange={setQuotationDate}
                isDisabled={!defaults.canChangeDate}
                description={defaults.canChangeDate ? undefined : "Today. Only an authorised user can change it."}
              />
              <TextField
                label="Valid until"
                type="date"
                isRequired
                value={validUntil}
                onChange={setValidUntil}
              />
              <Select
                label="Currency"
                options={currencyOptions}
                selectedKey={currencyCode}
                onSelectionChange={(key) => {
                  setCurrencyCode(String(key ?? baseCurrency));
                  setPriceListId("");
                }}
              />
              <Select
                label="Price list"
                options={priceListOptions}
                selectedKey={priceListId}
                description={
                  preview?.priceList
                    ? `Pricing from ${preview.priceList.name}${preview.priceList.basis === "customer" ? " (the customer's list)" : preview.priceList.basis === "default" ? " (the default list)" : ""}, ${preview.priceList.taxInclusive ? "tax inclusive" : "tax exclusive"}.`
                    : partyId ? "No price list for this currency: products use their default price." : undefined
                }
                onSelectionChange={(key) => {
                  const next = String(key ?? "");
                  if (next === priceListId) return;
                  if (validLines.length) setPendingPriceList(next);
                  else setPriceListId(next);
                }}
              />
              <Select
                label="Payment terms"
                options={paymentTermOptions}
                selectedKey={paymentTermId}
                description={options.paymentTerms.find((term) => term.id === paymentTermId)?.description ?? "When payment is due. The due date itself is set on each invoice."}
                onSelectionChange={(key) => setPaymentTermId(String(key ?? ""))}
              />
              <TextField
                label="Additional payment terms"
                description="Optional, for this quotation only. Printed with the payment terms."
                value={paymentTermsNote}
                onChange={setPaymentTermsNote}
              />
              <Select
                label="Owner"
                options={ownerOptions}
                selectedKey={ownerUserId || null}
                onSelectionChange={(key) => setOwnerUserId(String(key ?? ""))}
              />
              <TextField
                label="Customer reference"
                description="The customer's enquiry or RFQ number."
                value={customerReference}
                onChange={setCustomerReference}
              />
              {existing?.quotation.source_opportunity_name && (
                <TextField
                  label="Opportunity"
                  value={`${existing.quotation.source_opportunity_code ?? ""} ${existing.quotation.source_opportunity_name}`.trim()}
                  isReadOnly
                />
              )}
            </div>
          </SalesPanel>

          <SalesPanel title="Delivery">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField
                label="Shipping method"
                value={shippingMethod}
                onChange={setShippingMethod}
              />
              <TextField
                label="Delivery terms"
                value={deliveryTerms}
                onChange={setDeliveryTerms}
              />
              <TextField
                label="Incoterm"
                value={incoterm}
                onChange={setIncoterm}
              />
            </div>
          </SalesPanel>

          <DocumentTaxPanel tax={options.tax} value={documentTax} onChange={setDocumentTax} preview={preview} />

          <SalesPanel
            title="Items"
            actions={
              <Button
                variant="secondary"
                size="compact"
                onPress={() =>
                  setLines((current) => [...current, { ...emptyLine(), discountType: defaultDiscountType(options.discounts) }])
                }
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Add item
              </Button>
            }
          >
            <div className="flex flex-col gap-3">
              {lines.map((line, index) => {
                const priced = preview?.lines.find(
                  (candidate) =>
                    candidate.sequence ===
                    validLines.findIndex((v) => v.key === line.key) + 1,
                );
                const lineVariantOptions = variantOptionsFor(line.itemId);
                const lineUomOptions = uomOptionsFor(line.itemId);
                return (
                  <div
                    key={line.key}
                    className="grid grid-cols-1 items-end gap-2 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_auto]"
                  >
                    <Select
                      aria-label={`Item ${index + 1}`}
                      label={index === 0 ? "Item" : undefined}
                      options={itemOptions}
                      selectedKey={line.itemId || null}
                      onSelectionChange={(key) =>
                        selectLineItem(line.key, String(key ?? ""))
                      }
                      placeholder="Select an item"
                    />
                    <Select
                      aria-label={`Variant ${index + 1}`}
                      label={index === 0 ? "Variant" : undefined}
                      options={lineVariantOptions}
                      selectedKey={line.variantId}
                      onSelectionChange={(key) =>
                        updateLine(line.key, { variantId: String(key ?? "") })
                      }
                      isDisabled={lineVariantOptions.length <= 1}
                    />
                    <Select
                      aria-label={`UOM ${index + 1}`}
                      label={index === 0 ? "UOM" : undefined}
                      options={lineUomOptions}
                      selectedKey={line.uomId || null}
                      onSelectionChange={(key) =>
                        updateLine(line.key, { uomId: String(key ?? "") })
                      }
                      isDisabled={lineUomOptions.length <= 1}
                    />
                    <NumberField
                      aria-label={`Quantity ${index + 1}`}
                      label={index === 0 ? "Quantity" : undefined}
                      value={line.quantity}
                      onChange={(value) =>
                        updateLine(line.key, { quantity: value })
                      }
                      minValue={0}
                      step={1}
                    />
                    <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-end gap-1">
                      <NumberField
                        aria-label={`Discount ${index + 1}`}
                        label={index === 0 ? "Discount" : undefined}
                        value={line.discountValue}
                        onChange={(value) =>
                          updateLine(line.key, { discountValue: Number.isFinite(value) ? value : 0 })
                        }
                        minValue={0}
                        maxValue={line.discountType === "percent" ? 100 : undefined}
                        step={line.discountType === "percent" ? 0.5 : 0.01}
                        isDisabled={!canDiscountLines}
                      />
                      <Select
                        aria-label={`Discount type ${index + 1}`}
                        options={discountTypeOptions(options.discounts, currencyCode)}
                        selectedKey={line.discountType}
                        // The value entered for the other type is not carried over.
                        onSelectionChange={(key) =>
                          updateLine(line.key, { discountType: key === "amount" ? "amount" : "percent", discountValue: 0 })
                        }
                        isDisabled={!canDiscountLines}
                      />
                    </div>
                    <IconButton
                      aria-label={`Remove item ${index + 1}`}
                      variant="ghost"
                      isDisabled={lines.length === 1}
                      onPress={() =>
                        setLines((current) =>
                          current.filter(
                            (candidate) => candidate.key !== line.key,
                          ),
                        )
                      }
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </IconButton>
                    {line.itemId && (
                      <TextField
                        className="sm:col-span-6"
                        aria-label={`Description ${index + 1}`}
                        placeholder="Description on the document"
                        value={line.description}
                        onChange={(value) => updateLine(line.key, { description: value })}
                      />
                    )}
                    {priced?.priceMissing && (
                      <p role="alert" className="rounded-[var(--radius-control)] border border-warning-emphasis/40 bg-warning-soft px-2 py-1 text-xs text-warning sm:col-span-6">
                        {priced.priceMessage}{" "}
                        {canOverridePrice ? "Enter a price below, or choose another price list." : "Choose another price list, or ask someone who may set prices."}
                      </p>
                    )}
                    {line.itemId && canOverridePrice && (
                      <div className="grid grid-cols-1 gap-2 sm:col-span-6 sm:grid-cols-[12rem_minmax(0,1fr)]">
                        <TextField
                          aria-label={`Unit price ${index + 1}`}
                          placeholder={priced && !priced.priceMissing ? `List price ${money(currencyCode, priced.listUnitPrice)}` : "Unit price"}
                          inputMode="decimal"
                          value={line.unitPrice}
                          onChange={(value) => updateLine(line.key, { unitPrice: value.replace(/[^0-9.]/g, "") })}
                        />
                        {line.unitPrice.trim() !== "" && (
                          <TextField
                            aria-label={`Reason for the price ${index + 1}`}
                            placeholder="Why this price? (required)"
                            value={line.priceReason}
                            onChange={(value) => updateLine(line.key, { priceReason: value })}
                          />
                        )}
                      </div>
                    )}
                    {priced && (
                      <p className="text-xs text-text-muted sm:col-span-6">
                        {priced.manualPriceOverride ? `List ${money(currencyCode, priced.listUnitPrice)} · overridden to ` : ""}
                        {money(currencyCode, priced.unitPrice)} each
                        {Number(priced.discountAmount) > 0
                          ? ` · gross ${money(currencyCode, priced.grossAmount)} · discount ${priced.discountType === "percent" ? `${Number(priced.discountValue)}% = ` : ""}${money(currencyCode, priced.discountAmount)}`
                          : ""}
                        {" · net "}
                        {money(currencyCode, priced.netAmount)}
                        {Number(priced.documentDiscountAmount) > 0 ? ` · additional discount ${money(currencyCode, priced.documentDiscountAmount)} · taxable ${money(currencyCode, priced.taxableAmount)}` : ""}
                        {" · tax "}
                        {money(currencyCode, priced.taxAmount)} · line total{" "}
                        <span className="font-medium text-text">
                          {money(currencyCode, priced.lineTotal)}
                        </span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </SalesPanel>

          <SalesPanel
            title="Charges"
            description="Freight, handling and other charges."
            actions={
              <Button
                variant="secondary"
                size="compact"
                onPress={() =>
                  setCharges((current) => [
                    ...current,
                    {
                      key: nextKey(),
                      label: "",
                      calculationType: "fixed",
                      value: 0,
                    },
                  ])
                }
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Add charge
              </Button>
            }
          >
            {charges.map((charge) => (
              <div
                key={charge.key}
                className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
              >
                <TextField
                  aria-label="Charge label"
                  label="Label"
                  value={charge.label}
                  onChange={(value) =>
                    setCharges((current) =>
                      current.map((c) =>
                        c.key === charge.key ? { ...c, label: value } : c,
                      ),
                    )
                  }
                />
                <Select
                  aria-label="Charge type"
                  label="Type"
                  options={[
                    { value: "fixed", label: "Fixed amount" },
                    { value: "percentage", label: "% of subtotal" },
                  ]}
                  selectedKey={charge.calculationType}
                  onSelectionChange={(key) =>
                    setCharges((current) =>
                      current.map((c) =>
                        c.key === charge.key
                          ? {
                              ...c,
                              calculationType:
                                key === "percentage" ? "percentage" : "fixed",
                            }
                          : c,
                      ),
                    )
                  }
                />
                <NumberField
                  aria-label="Charge value"
                  label="Value"
                  value={charge.value}
                  onChange={(value) =>
                    setCharges((current) =>
                      current.map((c) =>
                        c.key === charge.key ? { ...c, value } : c,
                      ),
                    )
                  }
                  minValue={0}
                  step={0.01}
                />
                <IconButton
                  aria-label="Remove charge"
                  variant="ghost"
                  onPress={() =>
                    setCharges((current) =>
                      current.filter((c) => c.key !== charge.key),
                    )
                  }
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              </div>
            ))}
          </SalesPanel>

          <DocumentDiscountPanel
            discounts={options.discounts}
            currencyCode={currencyCode}
            value={documentDiscount}
            onChange={setDocumentDiscount}
            preview={preview}
            hasAnyDiscount={documentDiscount.value > 0 || lines.some((line) => line.discountValue > 0)}
          />

          <SalesPanel title="Notes & terms">
            <TextArea
              label="Notes for the customer"
              value={customerNotes}
              onChange={setCustomerNotes}
            />
            <TextArea
              label="Terms and conditions"
              value={terms}
              onChange={setTerms}
            />
            <TextArea
              label="Internal notes (never shown to the customer)"
              value={internalNotes}
              onChange={setInternalNotes}
            />
          </SalesPanel>
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-4">
          <SalesPanel title="Totals" description="Calculated by the server.">
            {previewError ? (
              <SalesAlert tone="warning">{previewError}</SalesAlert>
            ) : !preview ? (
              <p className="text-sm text-text-muted">
                Choose a customer and add an item to see pricing.
              </p>
            ) : (
              <DocumentTotals currencyCode={currencyCode} preview={preview} />
            )}
          </SalesPanel>
        </div>
      </div>
      <CustomerQuickCreateDialog
        isOpen={creatingCustomer}
        onClose={() => setCreatingCustomer(false)}
        onCreated={(customer) => {
          setCreatingCustomer(false);
          onCustomerCreated(customer.id);
        }}
      />
      <AlertDialog
        isOpen={pendingPriceList !== null}
        onOpenChange={(open) => !open && setPendingPriceList(null)}
        tone="primary"
        title="Re-price the lines with the new price list?"
        description="Every line without a manual price takes its price from the new list. Choose Cancel to keep the current price list."
        confirmLabel="Re-price lines"
        onConfirm={() => {
          setPriceListId(pendingPriceList ?? "");
          setPendingPriceList(null);
        }}
      />
    </div>
  );
}

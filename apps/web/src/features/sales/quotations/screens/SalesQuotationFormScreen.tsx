"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import {
  AlertDialog,
  Button,
  ErrorState,
  IconButton,
  NumberField,
  Select,
  TextArea,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { RecordPicker } from "@/shell/pickers/RecordPicker";
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
import { AUTOMATIC_TAX, DocumentTaxPanel, taxDraftOf, taxInput, type DocumentTaxDraft } from "@/features/sales/shared/DocumentTax";
import { AddSectionButtons, SectionLineRow, sectionsAt, useSectionLines } from "@/features/sales/shared/SectionLines";
import { getQuotationTemplate, listQuotationTemplates } from "../api/templates-api";
import { DocumentWarnings } from "@/features/sales/shared/SalesWarningDialog";
import { VariantGridDialog } from "@/features/sales/shared/VariantGridDialog";
import { DeliveryMethodSelect } from "@/features/sales/shared/DeliveryMethodSelect";
import { CouponField } from "@/features/sales/shared/CouponField";
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
import { DocumentFormPage } from "@/shared/ui/DocumentFormPage";
import { FormSection } from "@/shared/ui/FormSection";
import { Notice, Panel } from "@/shared/ui/Panel";
import { ChargeRows, chargeDraftOf, chargesInput, type ChargeDraft } from "@/features/sales/shared/ChargeRows";
import { mergeSalesOptions, SalesSearchPicker } from "@/features/sales/shared/SalesSearchPicker";
import type { SalesDocumentScheme, SalesOptions, SalesSearchResults } from "@/features/sales/quotations/api/quotations-api";
import { searchSalesOptions } from "@/features/sales/quotations/api/quotations-api";
import { TypedLineFields } from "@/features/sales/shared/TypedLineFields";
import { SchemeOffers } from "@/features/sales/shared/SchemeOffers";
import { mrpNote } from "@/features/sales/shared/mrp";

type LineDraft = {
  key: number;
  itemId: string;
  uomId: string;
  quantity: number;
  discountType: "percent" | "amount";
  discountValue: number;
  description: string;
  // "" means the price list price; anything else is a manual price.
  unitPrice: string;
  priceReason: string;
  // A free line of a scheme: no price, no discount (Sales audit M3).
  schemeRuleId: string;
  // A line without a catalogue product (Create-Where-You-Are): what is sold, its HSN/SAC and GST are typed; unitPrice is its price.
  typed: boolean;
  itemName: string;
  hsnSac: string;
  taxCategoryId: string;
};

let draftKey = 0;
const nextKey = () => ++draftKey;

const emptyLine = (): LineDraft => ({
  key: nextKey(), itemId: "", uomId: "", quantity: 1, discountType: "percent", discountValue: 0, description: "", unitPrice: "", priceReason: "", schemeRuleId: "",
  typed: false, itemName: "", hsnSac: "", taxCategoryId: "",
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

  const existingQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "quotation", quotationId),
    queryFn: () => getSalesQuotation(quotationId!).then((r) => r.quotation),
    enabled: editing,
  });
  // The form's options carry the quotation's own customer and products (and that customer's contacts and addresses); any other is
  // found by searching (Sales audit B4).
  const optionParty = editing ? existingQuery.data?.quotation.party_id : initialPartyId;
  const optionItems = [...new Set((existingQuery.data?.lines ?? []).map((line) => line.item_id).filter(Boolean))] as string[];
  const optionsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "options", optionParty ?? "", optionItems.join(",")),
    queryFn: () => getSalesOptions(optionParty ?? undefined, optionItems).then((r) => r.options),
    enabled: !editing || Boolean(existingQuery.data),
  });
  const defaultsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "quotation-defaults"),
    queryFn: () => getQuotationDefaults().then((r) => r.defaults),
  });

  if (editing && existingQuery.isError)
    return (
      <ErrorState
        title="Could not load this quotation"
        action={{ label: "Retry", onPress: () => existingQuery.refetch() }}
      />
    );
  if (optionsQuery.isPending || defaultsQuery.isLoading || (editing && existingQuery.isLoading))
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
        router.replace(`/sales/quotations/${id}`);
      }}
      onCancel={() =>
        router.replace(
          quotationId
            ? `/sales/quotations/${quotationId}`
            : "/sales/quotations",
        )
      }
    />
  );
}

function FormBody({
  options: initialOptions,
  defaults,
  existing,
  quotationId,
  initialPartyId,
  initialContactId,
  onDone,
  onCancel,
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
}) {
  const workspace = useWorkspaceContext();
  const editing = Boolean(quotationId);
  // What the form holds grows as customers and products are found by search (Sales audit B4).
  const [options, setOptions] = useState(initialOptions);
  // A saved line on the system "Unlisted item" is a typed line (Create-Where-You-Are); the setting allows new ones.
  const isTyped = (itemId: string | null | undefined) => Boolean(options.unlistedItemId && itemId === options.unlistedItemId);
  const typedAllowed = options.settings?.allow_lines_without_item !== false;
  // A revision stays an offer to the same customer.
  const customerLocked = Boolean(existing && existing.quotation.revision_number > 0);
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
          uomId: line.uom_id ?? "",
          quantity: Number(line.quantity),
          discountType: line.discount_type === "amount" ? "amount" : "percent",
          discountValue: Number(line.discount_type === "amount" ? line.discount_value : line.discount_percent),
          description: line.description_snapshot ?? "",
          unitPrice: line.manual_price_override || isTyped(line.item_id) ? String(Number(line.unit_price)) : "",
          priceReason: line.manual_price_reason ?? "",
          schemeRuleId: line.scheme_rule_id ?? "",
          typed: isTyped(line.item_id),
          itemName: String((line as Record<string, unknown>).item_name_snapshot ?? ""),
          hsnSac: String((line as Record<string, unknown>).hsn_sac_snapshot ?? ""),
          taxCategoryId: String((line as Record<string, unknown>).tax_category_id ?? ""),
        }))
      : [{ ...emptyLine(), discountType: defaultDiscountType(options.discounts) }],
  );
  const [charges, setCharges] = useState<ChargeDraft[]>(() =>
    (existing?.charges ?? []).map((charge) => chargeDraftOf(charge, nextKey())),
  );
  const [deliveryMethodId, setDeliveryMethodId] = useState(existing?.quotation.delivery_method_id ?? "");
  const [couponCode, setCouponCode] = useState(existing?.quotation.coupon_code ?? "");
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

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
  // A line's unit is chosen from what the item converts to (the server
  // enforces the same thing). A variant (Large / Brown) is an item of its own.
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
  function selectLineItem(key: number, itemId: string, from: SalesOptions = options) {
    const item = from.items.find((candidate) => candidate.id === itemId);
    updateLine(key, { itemId, uomId: defaultLineUom(item, from.itemUomConversions), description: defaultLineDescription(item) });
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

  // A picked product joins the form's options with its unit conversions.
  // A typed line saved as a product: it becomes a catalogue line, keeping the price typed (with its reason).
  async function saveTypedAsProduct(line: LineDraft, itemId: string) {
    const found = (await searchSalesOptions("products", line.itemName.trim()).catch(() => ({ results: {} as SalesSearchResults }))).results;
    pickLineItem(line.key, itemId, found);
    updateLine(line.key, { typed: false, itemName: "", unitPrice: line.unitPrice, priceReason: "Price agreed before the product was added" });
  }
  function pickLineItem(key: number, itemId: string, found: SalesSearchResults) {
    const next = mergeSalesOptions(options, found);
    setOptions(next);
    selectLineItem(key, itemId, next);
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

  // Start from template (Sales report Phase 2): the template's products, headings, terms and validity fill the form. Prices come from
  // the price list as for any line; everything can be changed before saving.
  const templatesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "quotation-templates", "active"), queryFn: () => listQuotationTemplates(), enabled: !existing, staleTime: 60_000,
  });
  const [templateId, setTemplateId] = useState("");
  // The variant grid (Sales report Phase 3): each filled cell becomes a line.
  const [grid, setGrid] = useState(false);
  async function addVariantLines(picked: Array<{ itemId: string; quantity: number }>) {
    setGrid(false);
    const next = mergeSalesOptions(options, (await getSalesOptions(undefined, picked.map((line) => line.itemId))).options);
    setOptions(next);
    setLines((current) => [...current.filter((line) => line.itemId || line.typed), ...picked.map((line) => {
      const item = next.items.find((candidate) => candidate.id === line.itemId);
      return { ...emptyLine(), itemId: line.itemId, quantity: line.quantity, uomId: defaultLineUom(item, next.itemUomConversions), description: defaultLineDescription(item),
        discountType: defaultDiscountType(options.discounts) };
    })]);
  }
  async function startFromTemplate(id: string) {
    setTemplateId(id);
    if (!id) return;
    try {
      const template = await getQuotationTemplate(id);
      const next = mergeSalesOptions(options, (await getSalesOptions(undefined, template.lines.map((line) => line.itemId))).options);
      setOptions(next);
      setLines(template.lines.map((line) => {
        const item = next.items.find((candidate) => candidate.id === line.itemId);
        return { ...emptyLine(), itemId: line.itemId, quantity: line.quantity, uomId: line.uomId ?? defaultLineUom(item, next.itemUomConversions),
          description: line.description ?? defaultLineDescription(item), discountType: line.discountType ?? "percent", discountValue: line.discountValue ?? 0 };
      }));
      sectionLines.replace(template.sectionLines);
      if (template.validityDays) {
        const until = new Date(`${quotationDate || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
        until.setUTCDate(until.getUTCDate() + template.validityDays);
        setValidUntil(until.toISOString().slice(0, 10));
      }
      if (template.paymentTermId) setPaymentTermId(template.paymentTermId);
      if (template.termsAndConditions) setTerms(template.termsAndConditions);
      if (template.customerNotes) setCustomerNotes(template.customerNotes);
    } catch {
      setError("The template could not be loaded. Try again.");
    }
  }

  // The rest of what a scheme earns, as a free line of its free product (loaded into the options when the form does not have it yet).
  async function addFreeLine(scheme: SalesDocumentScheme) {
    let from = options;
    if (!from.items.some((item) => item.id === scheme.freeItemId)) {
      from = mergeSalesOptions(from, (await getSalesOptions(partyId || undefined, [scheme.freeItemId])).options);
      setOptions(from);
    }
    const item = from.items.find((candidate) => candidate.id === scheme.freeItemId);
    setLines((current) => [...current, {
      ...emptyLine(), itemId: scheme.freeItemId, uomId: scheme.freeUomId ?? item?.uom_id ?? "", quantity: scheme.earned, schemeRuleId: scheme.ruleId,
      description: `${item?.name ?? scheme.freeItemName} (free: ${scheme.name})`,
    }]);
  }

  function selectParty(id: string, from: SalesOptions = options) {
    setPartyId(id);
    const party = from.parties.find((candidate) => candidate.id === id);
    // A customer's own currency and terms are the natural starting point; the
    // user can still change either, and the server validates the combination.
    if (party?.currency_code) setCurrencyCode(party.currency_code);
    // The customer's terms, else the company default.
    setPaymentTermId(party?.payment_term_id && options.paymentTerms.some((term) => term.id === party.payment_term_id) ? party.payment_term_id : "");
    setPriceListId("");
    // The customer's salesperson owns their documents; with none, whoever is creating it.
    if (party?.owner_user_id && options.users.some((user) => user.id === party.owner_user_id)) setOwnerUserId(party.owner_user_id);
    setShippingMethod(party?.default_shipping_method ?? "");
    setDeliveryTerms(party?.default_delivery_terms ?? "");
    setIncoterm(party?.default_incoterm ?? "");
    setDocumentTax((current) => ({ ...AUTOMATIC_TAX, sellerRegistrationId: current.sellerRegistrationId }));
    // Default to the new customer's primary contact/billing/shipping address
    // (still fully overridable below) -- the previous customer's selections
    // don't carry over.
    const contacts = from.contacts.filter(
      (contact) => contact.party_id === id,
    );
    const addresses = from.addresses.filter(
      (address) => address.party_id === id,
    );
    setContactId(contacts.find((contact) => contact.is_primary)?.id ?? "");
    setBillingAddressId(defaultAddress(addresses, BILLING_ADDRESS_TYPES));
    setShippingAddressId(defaultAddress(addresses, SHIPPING_ADDRESS_TYPES));
  }

  const isFilled = (line: LineDraft) => Boolean((line.typed ? line.itemName.trim() : line.itemId) && line.quantity > 0);
  const validLines = lines.filter(isFilled);
  const sectionLines = useSectionLines(existing?.quotation.section_lines);
  // Optional products (Sales report Phase 3): offered beside the lines, priced but not in the total.
  const [optional, setOptional] = useState<Array<{ key: number; itemId: string; quantity: number; description: string }>>(() =>
    (existing?.quotation.optional_lines ?? []).map((line) => ({ key: nextKey(), itemId: line.itemId, quantity: line.quantity, description: line.description ?? "" })));
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
        itemId: line.itemId || undefined,
        ...(line.typed ? { itemName: line.itemName.trim(), hsnSac: line.hsnSac || undefined, taxCategoryId: line.taxCategoryId || undefined } : {}),
        uomId: line.typed ? undefined : line.uomId || undefined,
        description: line.description.trim() || undefined,
        ...(line.schemeRuleId ? { schemeRuleId: line.schemeRuleId } : {}),
        ...(!line.schemeRuleId && line.unitPrice.trim() !== "" && Number.isFinite(Number(line.unitPrice))
          ? { unitPrice: Number(line.unitPrice), ...(line.typed ? {} : { manualPriceReason: line.priceReason.trim() || undefined }) }
          : {}),
        quantity: line.quantity,
        ...(!line.schemeRuleId && line.discountValue ? { discountType: line.discountType, discountValue: line.discountValue } : {}),
      })),
      charges: chargesInput(charges),
      deliveryMethodId: deliveryMethodId || null,
      couponCode: couponCode || null,
      sectionLines: sectionLines.toSaved(lines.map(isFilled)),
      optionalLines: optional.filter((line) => line.itemId && line.quantity > 0)
        .map((line) => ({ itemId: line.itemId, quantity: line.quantity, description: line.description.trim() || null })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the blocks are read through sectionLines.sections
  }, [
    sectionLines.sections,
    optional,
    deliveryMethodId,
    couponCode,
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
    <>
    <DocumentFormPage
      header={{
        title: 
          editing
            ? `Edit ${existing?.quotation.quotation_number}`
            : "New quotation"
        ,
        description: 
          editing
            ? "A draft can be changed until it is confirmed. Each save is kept in the quotation's history."
            : "Build a priced offer for a customer. Totals update as you edit and are calculated by the server."
        ,
      }}
      banner={<div className="flex flex-col gap-3">
        {error && <Notice>{error}</Notice>}
      </div>}
      formActions={
        <>
          {
          <Button variant="secondary" onPress={onCancel}>
            Cancel
          </Button>
        }
          {
          <Button
            variant="primary"
            onPress={() => saveMutation.mutate()}
            isLoading={saveMutation.isPending || saveMutation.isSuccess}
            isDisabled={!input || Boolean(previewError)}
          >
            {editing ? "Save changes" : "Save draft"}
          </Button>
        }
        </>
      }
      aside={<>
        <Panel title="Totals" description="Calculated by the server.">
            {previewError ? (
              <Notice tone="warning">{previewError}</Notice>
            ) : !preview ? (
              <p className="text-sm text-text-muted">
                Choose a customer and add an item to see pricing.
              </p>
            ) : (
              <DocumentTotals currencyCode={currencyCode} preview={preview} />
            )}
          </Panel>
          <SchemeOffers schemes={preview?.schemes} onAdd={(scheme) => void addFreeLine(scheme)} />
      </>}
    >

          <FormSection columns={1} title="Customer">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SalesSearchPicker
                kind="customers"
                label="Customer"
                isRequired
                known={options}
                value={partyId || null}
                onPick={(id, found) => void pickParty(id, found)}
                placeholder={loadingParty ? "Loading the customer…" : "Search customers by name, code, GSTIN or phone"}
                isDisabled={customerLocked}
                creatable={!editing}
              />
              <RecordPicker kind="customerContact" label="Contact" value={contactId || null} onChange={(id) => setContactId(id ?? "")}
                filters={{ partyId }} createPrefill={{ partyId, partyName: options.parties.find((party) => party.id === partyId)?.display_name }}
                selected={contactId ? { id: contactId, label: contactOptions.find((option) => option.value === contactId)?.label ?? "Contact" } : null}
                isDisabled={!partyId} placeholder={partyId ? "No contact" : "Choose the customer first"} />
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
            </div>
          </FormSection>

          <FormSection columns={1}
            title="Items"
            actions={<>
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
              {typedAllowed && (
                <Button variant="ghost" size="compact"
                  onPress={() => setLines((current) => [...current, { ...emptyLine(), discountType: defaultDiscountType(options.discounts), typed: true }])}>
                  <Plus className="size-3.5" aria-hidden="true" />
                  Line without a product
                </Button>
              )}
              <Button variant="ghost" size="compact" onPress={() => setGrid(true)}>Add by size and colour</Button>
              <AddSectionButtons onAdd={(kind) => sectionLines.add(kind, lines.length)} />
              {grid && <VariantGridDialog onClose={() => setGrid(false)} onAdd={(picked) => void addVariantLines(picked)} />}
            </>}
          >
            <div className="flex flex-col gap-3">
              <DocumentWarnings warnings={preview?.warnings} />
              {!existing && (templatesQuery.data?.length ?? 0) > 0 && (
                <Select label="Start from template" description="Fills the products, headings, terms and validity. Change anything before saving." className="w-full sm:max-w-sm"
                  selectedKey={templateId || "none"} onSelectionChange={(key) => void startFromTemplate(key === "none" ? "" : String(key))}
                  options={[{ value: "none", label: "No template" }, ...(templatesQuery.data ?? []).map((template) => ({ value: template.id, label: template.name }))]} />
              )}
              {lines.map((line, index) => {
                const blocks = sectionsAt(sectionLines.sections, index).map((block) => (
                  <SectionLineRow key={`s${block.key}`} block={block} lineCount={lines.length} onChange={(text) => sectionLines.update(block.key, text)}
                    onMove={(by) => sectionLines.move(block.key, by, lines.length)} onRemove={() => sectionLines.remove(block.key)} />
                ));
                const priced = preview?.lines.find(
                  (candidate) =>
                    candidate.sequence ===
                    validLines.findIndex((v) => v.key === line.key) + 1,
                );
                const lineUomOptions = uomOptionsFor(line.itemId);
                return (
                  <Fragment key={line.key}>
                  {blocks}
                  <div
                    className="grid grid-cols-1 items-end gap-2 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_auto]"
                  >
                    {line.typed ? (
                      <TypedLineFields index={index} line={line} taxCategories={options.taxCategories ?? []} onChange={(patch) => updateLine(line.key, patch)}
                        onSavedAsProduct={(id) => void saveTypedAsProduct(line, id)} />
                    ) : (<>
                    <SalesSearchPicker
                      kind="products"
                      aria-label={`Item ${index + 1}`}
                      label={index === 0 ? "Item" : undefined}
                      known={options}
                      value={line.itemId || null}
                      onPick={(id, found) => pickLineItem(line.key, id, found)}
                      placeholder="Search products by name, code, HSN or barcode"
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
                    </>)}
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
                      onPress={() => {
                        sectionLines.lineRemoved(index);
                        setLines((current) =>
                          current.filter(
                            (candidate) => candidate.key !== line.key,
                          ),
                        );
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </IconButton>
                    {(line.itemId || line.typed) && (
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
                    {line.schemeRuleId && <p className="text-xs text-success sm:col-span-6">Free under a scheme: no price and no discount.</p>}
                    {line.itemId && !line.typed && canOverridePrice && !line.schemeRuleId && (
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
                        {priced.manualPriceOverride ? `List ${money(currencyCode, priced.listUnitPrice)} · changed to ` : ""}
                        {money(currencyCode, priced.unitPrice)} each{mrpNote(priced, currencyCode)}
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
                  </Fragment>
                );
              })}
              {sectionsAt(sectionLines.sections, lines.length).map((block) => (
                <SectionLineRow key={`s${block.key}`} block={block} lineCount={lines.length} onChange={(text) => sectionLines.update(block.key, text)}
                  onMove={(by) => sectionLines.move(block.key, by, lines.length)} onRemove={() => sectionLines.remove(block.key)} />
              ))}
            </div>
          </FormSection>

          <FormSection columns={1}
            title="Optional products"
            description="Extras the customer can add when accepting online. Not in the total."
            actions={<Button variant="secondary" size="compact" onPress={() => setOptional((current) => [...current, { key: nextKey(), itemId: "", quantity: 1, description: "" }])}>
              <Plus className="size-3.5" aria-hidden="true" />Add optional product
            </Button>}
          >
            {optional.length === 0 ? <p className="text-sm text-text-muted">None offered.</p> : (
              <div className="flex flex-col gap-3">
                {optional.map((line, index) => {
                  return (
                    <div key={line.key} className="grid grid-cols-1 items-end gap-2 rounded-[var(--radius-control)] border border-dashed border-border p-3 sm:grid-cols-[minmax(0,2fr)_7rem_minmax(0,1.5fr)_auto]">
                      <SalesSearchPicker kind="products" aria-label={`Optional product ${index + 1}`} label={index === 0 ? "Product" : undefined} known={options} value={line.itemId || null}
                        onPick={(id, found) => { setOptions(mergeSalesOptions(options, found)); setOptional((current) => current.map((entry) => (entry.key === line.key ? { ...entry, itemId: id } : entry))); }} />
                      <NumberField aria-label={`Optional quantity ${index + 1}`} label={index === 0 ? "Quantity" : undefined} value={line.quantity} minValue={0} step={1}
                        onChange={(value) => setOptional((current) => current.map((entry) => (entry.key === line.key ? { ...entry, quantity: Number.isFinite(value) ? value : 0 } : entry)))} />
                      <TextField aria-label={`Optional description ${index + 1}`} label={index === 0 ? "Shown as" : undefined} placeholder="For example: Extended warranty" value={line.description}
                        onChange={(value) => setOptional((current) => current.map((entry) => (entry.key === line.key ? { ...entry, description: value } : entry)))} />
                      <Button variant="ghost" size="compact" aria-label={`Remove optional product ${index + 1}`}
                        onPress={() => setOptional((current) => current.filter((entry) => entry.key !== line.key))}>
                        <Trash2 className="size-4" aria-hidden="true" />Remove
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </FormSection>

          <FormSection columns={1}
            title="Charges"
            description="Freight, handling and other charges."
            actions={
              <Button
                variant="secondary"
                size="compact"
                onPress={() =>
                  setCharges((current) => [
                    ...current,
                    { key: nextKey(), chargeType: "freight", label: "", calculationType: "fixed", value: 0, taxable: true },
                  ])
                }
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Add charge
              </Button>
            }
          >
            <DeliveryMethodSelect value={deliveryMethodId} onChange={setDeliveryMethodId} />
            <ChargeRows charges={charges} onChange={setCharges} />
          </FormSection>

          <CouponField value={couponCode} onChange={setCouponCode} preview={preview} previewError={previewQuery.error} currencyCode={currencyCode} />

          <DocumentDiscountPanel
            discounts={options.discounts}
            currencyCode={currencyCode}
            value={documentDiscount}
            onChange={setDocumentDiscount}
            preview={preview}
            hasAnyDiscount={documentDiscount.value > 0 || lines.some((line) => line.discountValue > 0)}
          />

          {/* Everything but the customer, dates and items, out of the way until wanted (Line-by-line audit): an order-taker needs the
              customer, then the items, fast. Open when editing. */}
          <details className="group rounded-[var(--radius-card)] border border-border bg-surface" open={editing || undefined}>
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-text">
              More details <span className="font-normal text-text-secondary">— addresses, currency and price list, payment terms, salesperson, reference, delivery and tax</span>
            </summary>
            <div className="flex flex-col gap-4 border-t border-border p-4">
              <FormSection columns={1} title="Addresses & terms">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              </FormSection>
          <FormSection columns={1} title="Delivery">
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
          </FormSection>

          <DocumentTaxPanel tax={options.tax} value={documentTax} onChange={setDocumentTax} preview={preview} />

            </div>
          </details>

          <FormSection columns={1} title="Notes & terms">
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
          </FormSection>
    </DocumentFormPage>
      <AlertDialog
        isOpen={pendingPriceList !== null}
        onOpenChange={(open) => !open && setPendingPriceList(null)}
        tone="primary"
        title="Re-price the lines with the new price list?"
        description="Lines without a changed price take their price from the new list. Choose Cancel to keep the current list."
        confirmLabel="Re-price lines"
        onConfirm={() => {
          setPriceListId(pendingPriceList ?? "");
          setPendingPriceList(null);
        }}
      />
    </>
  );
}

"use client";

// Create a quotation from a deal, on its own page: the form on the left, a summary column (customer, lines, estimate, what is still
// missing, and Create) on the right. One request: the server resolves the customer, prices the lines through Sales (price list, rules,
// tax) and creates the Draft quotation with the deal as its source, or changes nothing. Afterwards it offers (never forces) a move to
// Proposal.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TypedLineFields } from "@/features/sales/shared/TypedLineFields";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Plus, Trash2, X } from "lucide-react";
import { ComboBox, Button, Checkbox, IconButton, PageHeader, Radio, RadioGroup, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { changeOpportunityStage, searchOpportunityProducts } from "@/features/crm/opportunities/api/opportunities-api";
import { GST_STATES, gstStateByName } from "@/features/crm/shared/gst-states";
import { CountrySelect } from "@/features/crm/shared/ui/CountrySelect";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { formatDate, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  QuotationApiError, createQuotationFromOpportunity, errorMessage, getQuotationReadiness,
  type CreateQuotationInput, type CreateQuotationResult, type CustomerMatch, type QuotationReadiness,
} from "../api/quotations-api";

const NONE = "__none__";
const CREATE = "__create__";

type Line = {
  key: string; itemId: string; name: string; description: string; quantity: string; discountPercent: string;
  estimate: number | null; useEstimate: boolean; reason: string; fromOpportunity: boolean;
  // A line without a catalogue product (Create-Where-You-Are C6): name, HSN/SAC, GST and price typed.
  typed: boolean; hsnSac: string; taxCategoryId: string; price: string;
};

// The quotation link for a deal (the deal page, its Quotes tab and the pipeline card all open it).
export const createQuotationHref = (opportunityId: string) => `/crm/opportunities/${opportunityId}/quotation`;

export function CreateQuotationScreen({ opportunityId }: { opportunityId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const dealHref = `/crm/opportunities/${opportunityId}`;
  return (
    <div className="flex flex-col gap-5">
      <Link href={dealHref} className="inline-flex w-fit items-center gap-1 text-sm text-text-secondary hover:text-text focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none">
        <ArrowLeft aria-hidden="true" className="size-4" />Deal
      </Link>
      <PageHeader title="Create quotation" description="A Draft quotation for this deal. Sales prices it from the price list and applies tax; nothing is created until you click Create draft quotation." />
      <Flow opportunityId={opportunityId} onClose={() => router.push(`${dealHref}?tab=quotes`)}
        onCreated={() => {
          void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunity", opportunityId) });
          void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunities") });
        }} />
    </div>
  );
}

function Flow({ opportunityId, onClose, onCreated }: { opportunityId: string; onClose: () => void; onCreated: () => void }) {
  const workspace = useWorkspaceContext();
  const [created, setCreated] = useState<CreateQuotationResult | null>(null);
  const readiness = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunity", opportunityId, "quotation-readiness"),
    queryFn: () => getQuotationReadiness(opportunityId),
    enabled: !created,
  });
  if (created) return <Result opportunityId={opportunityId} result={created} onClose={onClose} onChanged={onCreated} />;
  if (readiness.isLoading || !readiness.data)
    return readiness.isError ? <Banner tone="danger" message={errorMessage(readiness.error)} /> : <LoadingState label="Checking the deal" rows={4} />;
  return <QuotationForm opportunityId={opportunityId} readiness={readiness.data} onClose={onClose} onCreated={(result) => { setCreated(result); onCreated(); }} />;
}

function QuotationForm({ opportunityId, readiness, onClose, onCreated }: {
  opportunityId: string; readiness: QuotationReadiness; onClose: () => void; onCreated: (result: CreateQuotationResult) => void;
}) {
  const can = readiness.capabilities;
  const account = readiness.account;
  const defaults = readiness.defaults;
  // One key for this quotation: a double-click or a retry returns the first one.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const visibleMatches = readiness.customerMatches.filter((match) => match.canOpen);
  const strongMatch = readiness.customerMatches.some((match) => match.strength === "exact");
  const [customerChoice, setCustomerChoice] = useState<string>(visibleMatches.find((match) => match.strength === "exact")?.id ?? CREATE);
  const [confirmNoMatch, setConfirmNoMatch] = useState(false);
  const [gstin, setGstin] = useState(account?.gstin ?? "");
  const [customerTerms, setCustomerTerms] = useState(account?.paymentTermId ?? defaults.paymentTermId ?? NONE);
  const [address, setAddress] = useState({ line1: "", line2: "", city: "", state: "", stateCode: "", postalCode: "", countryCode: "IN" });

  const [contactId, setContactId] = useState(defaults.contactId ?? NONE);
  const [billingAddressId, setBillingAddressId] = useState(defaults.billingAddressId ?? NONE);
  const [shippingAddressId, setShippingAddressId] = useState(defaults.shippingAddressId ?? NONE);
  const [validUntil, setValidUntil] = useState(defaults.validUntil);
  const [currencyCode, setCurrencyCode] = useState(defaults.currencyCode);
  const [priceListId, setPriceListId] = useState(defaults.priceListId ?? NONE);
  const [paymentTermId, setPaymentTermId] = useState(defaults.paymentTermId ?? NONE);
  const [customerReference, setCustomerReference] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [lines, setLines] = useState<Line[]>(() => readiness.lines.filter((line) => line.active).map((line) => ({
    key: line.id, itemId: line.itemId, name: line.unlisted ? line.itemName : `${line.itemName} (${line.itemCode})`, description: line.description ?? "", quantity: String(line.quantity),
    discountPercent: line.estimatedDiscountPercent ? String(line.estimatedDiscountPercent) : "", estimate: line.estimatedUnitPrice, useEstimate: false, reason: "", fromOpportunity: true,
    typed: Boolean(line.unlisted), hsnSac: "", taxCategoryId: "", price: line.unlisted ? String(line.estimatedUnitPrice) : "",
  })));
  const [search, setSearch] = useState("");
  const products = useQuery({ queryKey: ["quotation-product-search", search], queryFn: () => searchOpportunityProducts(search), enabled: search.trim().length >= 2 });

  const isCustomer = Boolean(account?.isCustomer);
  // Someone who may not create customers quotes the company as a prospect; its customer is opened with the order (Create-Where-You-Are C7).
  const asProspect = Boolean(account) && !isCustomer && !can.createCustomer;
  const linking = !isCustomer && !asProspect && customerChoice !== CREATE;
  const creatingCustomer = !isCustomer && !asProspect && customerChoice === CREATE;
  // A person (B2C) needs no billing address or GSTIN: GST treats them as a consumer. They may still give an address for the invoice.
  const individual = Boolean(account?.isIndividual);
  const offersAddress = creatingCustomer && !account?.hasBillingAddress;
  const needsAddress = offersAddress && !individual;
  const addressComplete = Boolean(address.line1 && address.city && address.state && address.postalCode && address.countryCode);
  const sendAddress = needsAddress || (offersAddress && addressComplete);
  const priceLists = readiness.priceLists.filter((list) => list.currencyCode === currencyCode);
  const inactiveLines = readiness.lines.filter((line) => !line.active);

  const problems = [
    ...readiness.checks.filter((check) => check.blocking && !check.met).map((check) => `${check.label}: ${check.value ?? "missing"}`),
    creatingCustomer && strongMatch && "This company is already a customer: link it to the existing customer.",
    creatingCustomer && !strongMatch && visibleMatches.length > 0 && !confirmNoMatch && "Confirm that none of the matching customers is this company.",
    needsAddress && !addressComplete && "Enter the customer's billing address.",
    offersAddress && !needsAddress && address.line1 && !addressComplete && "Complete the billing address, or leave it empty.",
    !validUntil && "Choose the date the quotation is valid until.",
    lines.length === 0 && "Add at least one product or service.",
    ...lines.map((line, index) => (!(Number(line.quantity) > 0) ? `Line ${index + 1}: enter a quantity greater than zero.`
      : line.useEstimate && !line.reason.trim() ? `Line ${index + 1}: give the reason for using the estimated price.` : null)),
  ].filter((entry): entry is string => Boolean(entry));

  const input = (): CreateQuotationInput => ({
    idempotencyKey,
    ...(isCustomer ? {} : asProspect ? { customer: { mode: "prospect" as const } } : linking
      ? { customer: { mode: "link" as const, customerId: customerChoice } }
      : { customer: {
        mode: "create" as const, gstin: individual ? undefined : gstin.trim() || undefined, paymentTermId: customerTerms === NONE ? undefined : customerTerms, currencyCode,
        confirmNoMatch, ...(sendAddress ? { billingAddress: { ...address, line2: address.line2 || undefined, stateCode: address.stateCode || undefined } } : {}),
      } }),
    contactId: contactId === NONE ? undefined : contactId,
    billingAddressId: billingAddressId === NONE || linking ? undefined : billingAddressId,
    shippingAddressId: shippingAddressId === NONE || linking ? undefined : shippingAddressId,
    validUntil, currencyCode,
    priceListId: priceListId === NONE ? undefined : priceListId,
    paymentTermId: paymentTermId === NONE ? undefined : paymentTermId,
    customerReference: customerReference.trim() || undefined,
    customerNotes: customerNotes.trim() || undefined,
    termsAndConditions: terms.trim() || undefined,
    internalNotes: internalNotes.trim() || undefined,
    lines: lines.map((line) => ({
      ...(line.typed ? { ...(line.itemId ? { itemId: line.itemId } : {}), itemName: line.name.trim(), hsnSac: line.hsnSac || undefined, taxCategoryId: line.taxCategoryId || undefined,
        unitPrice: Number(line.price) } : { itemId: line.itemId }),
      description: line.description.trim() || undefined, quantity: Number(line.quantity),
      discountPercent: line.discountPercent.trim() ? Number(line.discountPercent) : undefined,
      ...(!line.typed && line.useEstimate && line.estimate !== null ? { unitPrice: line.estimate, manualPriceReason: line.reason.trim() } : {}),
    })),
  });
  const create = useMutation({ mutationFn: () => createQuotationFromOpportunity(opportunityId, input()), onSuccess: onCreated });
  const update = (key: string, patch: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const addressOptions = useMemo(() => readiness.addresses.map((entry) => ({ value: entry.id, label: `${entry.type[0].toUpperCase()}${entry.type.slice(1)}: ${entry.label}` })), [readiness.addresses]);

  const chosenContact = readiness.contacts.find((contact) => contact.id === contactId);
  const customerName = isCustomer ? account?.name : linking ? visibleMatches.find((match) => match.id === customerChoice)?.name : account?.name;
  const customerState = isCustomer ? "Customer" : asProspect ? "Quoted as a prospect; the customer is opened with the order" : linking ? "Links to this existing customer" : "Customer created from the company";
  // The deal's own estimate for the lines it knows a price for; Sales prices the quotation when it is saved.
  const estimate = lines.reduce((sum, line) => (line.estimate === null ? sum
    : sum + line.estimate * (Number(line.quantity) || 0) * (1 - (Number(line.discountPercent) || 0) / 100)), 0);
  const priced = lines.filter((line) => line.estimate !== null).length;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
    <div className="flex min-w-0 flex-col gap-5">
      {/* Said before the form, so nobody fills it in only to find Create disabled. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">{readiness.opportunity.code} · {readiness.opportunity.name}</h2>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {[...readiness.checks, ...readiness.recommended.map((check) => ({ ...check, recommended: true }))].map((check) => (
            <li key={check.key} className="flex items-start gap-2">
              {check.met ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" /> : <X className={`mt-0.5 size-4 shrink-0 ${check.blocking ? "text-danger" : "text-warning"}`} aria-hidden="true" />}
              <span><span className="font-medium">{check.label}</span><span className="text-text-secondary"> · {checkValue(check)}</span>{"recommended" in check && !check.met ? <span className="text-text-muted"> (recommended)</span> : null}</span>
            </li>
          ))}
        </ul>
      </section>

      {account && !isCustomer && (
        <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border p-3">
          <h2 className="text-sm font-semibold">Customer</h2>
          <p className="text-sm text-text-secondary">{asProspect
            ? `${account.name} is still a prospect. The quotation goes to it as a prospect; its customer master is opened when the accepted quotation becomes a sales order.`
            : `${account.name} is still a prospect: create its customer master, or link it to a customer that already exists (the company and this deal move to that customer).`}</p>
          {can.createCustomer ? (
            <RadioGroup label="Customer for this quotation" value={customerChoice} onChange={setCustomerChoice}>
              {visibleMatches.map((match) => <Radio key={match.id} value={match.id}><CustomerMatchLabel match={match} /></Radio>)}
              <Radio value={CREATE} isDisabled={strongMatch}>Create the customer from {account.name}</Radio>
            </RadioGroup>
          ) : null}
          {readiness.customerMatches.some((match) => !match.canOpen) && <Banner tone="warning" message="A customer you cannot open matches this company. Ask a manager before creating a new customer." />}
          {creatingCustomer && can.createCustomer && (
            <div className="grid gap-3 sm:grid-cols-2">
              {!individual && <TextField label="GSTIN" description="Optional. Used for GST and checked for duplicates." value={gstin} onChange={setGstin} />}
              <Select label="Payment terms" selectedKey={customerTerms} onSelectionChange={(key) => setCustomerTerms(String(key))}
                options={[{ value: NONE, label: "Not set" }, ...readiness.paymentTerms.map((term) => ({ value: term.id, label: term.name }))]} />
              {visibleMatches.length > 0 && !strongMatch && <Checkbox isSelected={confirmNoMatch} onChange={setConfirmNoMatch}>None of the customers above is this company</Checkbox>}
              {offersAddress && (
                <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
                  <legend className="mb-1 text-sm font-medium">{individual ? "Billing address (optional for a person)" : "Billing address (the company has none yet)"}</legend>
                  <TextField label="Address line 1" isRequired={needsAddress} value={address.line1} onChange={(line1) => setAddress({ ...address, line1 })} />
                  <TextField label="Address line 2" value={address.line2} onChange={(line2) => setAddress({ ...address, line2 })} />
                  <TextField label="City" isRequired={needsAddress} value={address.city} onChange={(city) => setAddress({ ...address, city })} />
                  {/* In India the state comes from the GST list, with its code beside it; choosing one fills the GST state code. */}
                  {address.countryCode === "IN" ? (
                    <Select label="State" isRequired={needsAddress} selectedKey={address.state || null}
                      options={GST_STATES.map((state) => ({ value: state.name, label: `${state.name} (${state.code})` }))}
                      onSelectionChange={(key) => setAddress({ ...address, state: String(key ?? ""), stateCode: gstStateByName(String(key ?? ""))?.code ?? "" })} />
                  ) : (
                    <TextField label="State" isRequired={needsAddress} value={address.state} onChange={(state) => setAddress({ ...address, state, stateCode: "" })} />
                  )}
                  <TextField label="Postal code" isRequired={needsAddress} value={address.postalCode} onChange={(postalCode) => setAddress({ ...address, postalCode })} />
                  <CountrySelect value={address.countryCode} onChange={(countryCode) => setAddress({ ...address, countryCode, state: "", stateCode: "" })} />
                </fieldset>
              )}
            </div>
          )}
        </section>
      )}
      {account && isCustomer && <p className="text-sm">Customer: <span className="font-medium">{account.name}</span>{account.customerNumber ? ` (${account.customerNumber})` : ""}</p>}

      <section className="grid gap-3 sm:grid-cols-2">
        <ComboBox label="Contact person" selectedKey={contactId} onSelectionChange={(key) => setContactId(String(key))}
          options={[{ value: NONE, label: "No contact" }, ...readiness.contacts.map((contact) => ({ value: contact.id, label: [contact.name, contact.jobTitle].filter(Boolean).join(" · ") }))]} />
        {!linking && (
          <>
            <Select label="Billing address" selectedKey={billingAddressId} onSelectionChange={(key) => setBillingAddressId(String(key))}
              options={[{ value: NONE, label: sendAddress ? "The new billing address" : "Customer's default" }, ...addressOptions]} />
            <Select label="Shipping address" description="Optional at quotation stage." selectedKey={shippingAddressId} onSelectionChange={(key) => setShippingAddressId(String(key))}
              options={[{ value: NONE, label: "None" }, ...addressOptions]} />
          </>
        )}
        <TextField label="Quotation date" value={formatDate(defaults.quotationDate)} isReadOnly />
        <DateInput label="Valid until" isRequired value={validUntil} onChange={setValidUntil} />
        <Select label="Currency" isRequired selectedKey={currencyCode} onSelectionChange={(key) => { setCurrencyCode(String(key)); setPriceListId(NONE); }}
          options={readiness.currencies.map((code) => ({ value: code, label: code }))} />
        <Select label="Price list" selectedKey={priceListId} onSelectionChange={(key) => setPriceListId(String(key))}
          options={[{ value: NONE, label: "Item prices (no price list)" }, ...priceLists.map((list) => ({ value: list.id, label: `${list.name}${list.taxInclusive ? " (tax inclusive)" : ""}` }))]} />
        <Select label="Payment terms" selectedKey={paymentTermId} onSelectionChange={(key) => setPaymentTermId(String(key))}
          options={[{ value: NONE, label: "Customer's terms" }, ...readiness.paymentTerms.map((term) => ({ value: term.id, label: term.name }))]} />
        <TextField label="Customer reference" description="Optional, for example the customer's enquiry number." value={customerReference} onChange={setCustomerReference} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Products and services</h2>
        <p className="text-xs text-text-muted">Prices come from the price list and pricing rules; the deal&apos;s estimate is only a starting point. Tax and totals are calculated by Sales when the quotation is saved.</p>
        {inactiveLines.length > 0 && <Banner tone="warning" message={`Left out (inactive products): ${inactiveLines.map((line) => line.itemName).join(", ")}.`} />}
        <ul className="flex flex-col gap-2">
          {lines.map((line, index) => (
            <li key={line.key} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium">{index + 1}. {line.name}{line.fromOpportunity ? "" : " (added)"}</span>
                <IconButton aria-label={`Remove ${line.name}`} size="compact" variant="ghost" onPress={() => setLines(lines.filter((entry) => entry.key !== line.key))}><Trash2 className="size-4" aria-hidden="true" /></IconButton>
              </div>
              {line.typed && (
                <TypedLineFields index={1} line={{ itemName: line.name, hsnSac: line.hsnSac, taxCategoryId: line.taxCategoryId, unitPrice: line.price }}
                  taxCategories={readiness.taxCategories ?? []}
                  onChange={(patch) => update(line.key, { ...(patch.itemName !== undefined ? { name: patch.itemName } : {}), ...(patch.hsnSac !== undefined ? { hsnSac: patch.hsnSac } : {}),
                    ...(patch.taxCategoryId !== undefined ? { taxCategoryId: patch.taxCategoryId } : {}), ...(patch.unitPrice !== undefined ? { price: patch.unitPrice } : {}) })} />
              )}
              <div className="grid gap-2 sm:grid-cols-4">
                <TextField className="sm:col-span-2" label="Description" value={line.description} onChange={(description) => update(line.key, { description })} />
                <TextField label="Quantity" inputMode="decimal" isRequired value={line.quantity} onChange={(quantity) => update(line.key, { quantity })} />
                <TextField label="Discount %" inputMode="decimal" isDisabled={!can.applyDiscount} description={can.applyDiscount ? undefined : "No discount permission."}
                  value={line.discountPercent} onChange={(discountPercent) => update(line.key, { discountPercent })} />
              </div>
              {!line.typed && line.estimate !== null && can.overridePrice && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Checkbox isSelected={line.useEstimate} onChange={(useEstimate) => update(line.key, { useEstimate })}>
                    Use the estimated price ({formatMoney(currencyCode, line.estimate)}) instead of the price list
                  </Checkbox>
                  {line.useEstimate && <TextField label="Reason for the price" isRequired value={line.reason} onChange={(reason) => update(line.key, { reason })} />}
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-dashed border-border p-3">
          <TextField label="Add a product or service" description="For example implementation, training or support." value={search} onChange={setSearch} placeholder="Type at least 2 letters" />
          {(products.data ?? []).length > 0 && (
            <ul className="flex flex-col gap-1">
              {(products.data ?? []).slice(0, 8).map((product) => (
                <li key={product.id}>
                  <Button variant="ghost" size="compact" onPress={() => {
                    setLines([...lines, { key: crypto.randomUUID(), itemId: product.id, name: `${product.name} (${product.code})`, description: "", quantity: "1", discountPercent: "", estimate: null, useEstimate: false, reason: "", fromOpportunity: false,
                      typed: false, hsnSac: "", taxCategoryId: "", price: "" }]);
                    setSearch("");
                  }}><Plus className="size-4" aria-hidden="true" />{product.name} ({product.code})</Button>
                </li>
              ))}
            </ul>
          )}
          {/* Not in the catalogue: a line with just a name, HSN/SAC, GST and price (Create-Where-You-Are C6). */}
          {search.trim().length >= 2 && !products.isFetching && (
            <Button variant="outline" size="compact" className="w-fit" onPress={() => {
              setLines([...lines, { key: crypto.randomUUID(), itemId: "", name: search.trim(), description: "", quantity: "1", discountPercent: "", estimate: null, useEstimate: false, reason: "",
                fromOpportunity: false, typed: true, hsnSac: "", taxCategoryId: "", price: "" }]);
              setSearch("");
            }}><Plus className="size-4" aria-hidden="true" />{`Add "${search.trim()}" without a product`}</Button>
          )}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <TextArea label="Notes for the customer" description="Printed on the quotation." value={customerNotes} onChange={setCustomerNotes} />
        <TextArea label="Terms and conditions" description="Printed on the quotation." value={terms} onChange={setTerms} />
        <TextArea className="sm:col-span-2" label="Internal notes" description="Never printed or sent to the customer." value={internalNotes} onChange={setInternalNotes} />
        {readiness.opportunity.internalContext && (
          <div className="rounded-[var(--radius-control)] border border-border bg-surface-muted p-3 text-sm sm:col-span-2">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">From the deal (internal, not copied to the quotation)</p>
            <p className="mt-1 whitespace-pre-wrap text-text-secondary">{readiness.opportunity.internalContext}</p>
          </div>
        )}
      </section>

    </div>

    <aside aria-label="Quotation summary" className="flex flex-col gap-4 self-start rounded-[var(--radius-card)] border border-border bg-surface p-4 lg:sticky lg:top-4">
      <h2 className="text-sm font-semibold">Summary</h2>
      <dl className="flex flex-col gap-2 text-sm">
        <SummaryRow label={customerState} value={customerName ?? "—"} />
        <SummaryRow label="Contact" value={chosenContact?.name ?? "No contact"} />
        <SummaryRow label="Valid until" value={validUntil ? formatDate(validUntil) : "Not set"} />
        <SummaryRow label="Lines" value={lines.length === 0 ? "None yet" : `${lines.length} ${lines.length === 1 ? "line" : "lines"}`} />
      </dl>
      {lines.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-border pt-3 text-xs text-text-secondary">
          {lines.map((line) => <li key={line.key} className="flex justify-between gap-2"><span className="truncate">{line.name}</span><span className="shrink-0 tabular-nums">× {line.quantity || "?"}</span></li>)}
        </ul>
      )}
      <div className="border-t border-border pt-3">
        <p className="text-xs text-text-muted">Estimate from the deal{priced < lines.length ? ` (${priced} of ${lines.length} lines)` : ""}</p>
        <p className="text-xl font-semibold tabular-nums">{priced ? formatMoney(currencyCode, estimate) : "—"}</p>
        <p className="text-xs text-text-muted">Sales prices the lines and adds tax when the quotation is saved.</p>
      </div>
      {create.isError && (
        <Banner tone="danger" message={`The quotation was not created. Nothing was changed. ${errorMessage(create.error)}`}
          detail={create.error instanceof QuotationApiError && /CUSTOMER/.test(create.error.code ?? "") ? "Review the customer section." : undefined} />
      )}
      {problems.length > 0 && <p className="text-sm text-text-secondary">{problems[0]}</p>}
      <div className="flex flex-col gap-2">
        <Button variant="primary" isDisabled={problems.length > 0} isLoading={create.isPending} onPress={() => create.mutate()}>Create draft quotation</Button>
        <Button variant="secondary" onPress={onClose}>Cancel</Button>
      </div>
    </aside>
    </div>
  );
}

// A check's value as the page shows it: money and dates arrive raw and are formatted here.
function checkValue(check: { value: string | null; format?: "money" | "date"; currencyCode?: string }) {
  if (check.value === null) return "";
  if (check.format === "money") return formatMoney(check.currencyCode, Number(check.value));
  if (check.format === "date") return formatDate(check.value);
  return check.value;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-col"><dt className="text-xs text-text-muted">{label}</dt><dd className="font-medium">{value}</dd></div>;
}

function CustomerMatchLabel({ match }: { match: CustomerMatch }) {
  return (
    <span className="flex flex-col">
      <span className="font-medium">Link to existing customer: {match.name}{match.customerNumber ? ` (${match.customerNumber})` : ""}{match.strength === "exact" ? " · strong match" : " · possible match"}</span>
      <span className="text-xs text-text-secondary">{[match.legalName, match.website, match.city, match.ownerName && `Owner: ${match.ownerName}`].filter(Boolean).join(" · ")}</span>
    </span>
  );
}

function Banner({ tone, message, detail }: { tone: "danger" | "warning"; message: string; detail?: string }) {
  const style = tone === "danger" ? "border-danger-emphasis/30 bg-danger-soft text-danger" : "border-warning/40 bg-warning-soft text-text";
  return (
    <div role="alert" className={`rounded-[var(--radius-control)] border px-3 py-2 text-sm ${style}`}>
      <p>{message}</p>
      {detail && <p className="mt-1 text-text-secondary">{detail}</p>}
    </div>
  );
}

// After creation: the Draft quotation, where to continue, and the optional Proposal move.
function Result({ opportunityId, result, onClose, onChanged }: { opportunityId: string; result: CreateQuotationResult; onClose: () => void; onChanged: () => void }) {
  const router = useRouter();
  const [moved, setMoved] = useState(false);
  const move = useMutation({
    mutationFn: () => changeOpportunityStage(opportunityId, { stageId: result.stageSuggestion!.stageId, note: `Quotation ${result.quotationNumber} created` }),
    onSuccess: () => { setMoved(true); onChanged(); },
  });
  return (
    <div className="flex max-w-3xl flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-5">
      <div className="flex items-center gap-2"><Check className="size-5 text-success" aria-hidden="true" /><h2 className="text-base font-semibold">Quotation {result.quotationNumber} created as a Draft</h2></div>
      <p className="text-sm text-text-secondary">
        {result.customerDecision === "created" ? "The company's customer master was created. " : result.customerDecision === "linked" ? "The company was linked to the existing customer. " : ""}
        {result.primary ? "It is the deal's primary quotation. " : ""}The deal stays open: a quotation does not win it.
      </p>
      {result.stageSuggestion && !moved && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-muted p-3 text-sm">
          <span className="flex-1">Move the deal to <span className="font-medium">{result.stageSuggestion.stageName}</span>?</span>
          <Button variant="secondary" size="compact" isLoading={move.isPending} onPress={() => move.mutate()}>Move to {result.stageSuggestion.stageName}</Button>
          <Button variant="ghost" size="compact" onPress={() => setMoved(true)}>Not now</Button>
        </div>
      )}
      {move.isError && <Banner tone="danger" message={errorMessage(move.error, "The stage could not be changed.")} />}
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="secondary" onPress={onClose}>Back to the deal</Button>
        <Button variant="primary" onPress={() => router.push(`/sales/quotations/${result.quotationId}`)}>Open quotation</Button>
      </div>
    </div>
  );
}

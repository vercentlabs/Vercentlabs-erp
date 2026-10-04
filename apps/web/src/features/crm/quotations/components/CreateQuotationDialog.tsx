"use client";

// Create Quotation from an opportunity: one form, one request. The server
// resolves the customer, prices the lines through Sales (price list, rules,
// tax) and creates the Draft quotation with the opportunity as its source, or
// changes nothing. Afterwards it offers (never forces) a move to Proposal.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Plus, Trash2, X } from "lucide-react";
import { Button, Checkbox, Dialog, IconButton, Radio, RadioGroup, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { changeOpportunityStage, searchOpportunityProducts } from "@/features/crm/opportunities/api/opportunities-api";
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
};

export function CreateQuotationDialog({ opportunityId, isOpen, onOpenChange, onCreated }: {
  opportunityId: string; isOpen: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void;
}) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Create quotation" description="A Draft quotation for this opportunity. Sales prices it from the price list and applies tax; nothing is created until you confirm." size="lg">
      {isOpen && <Flow opportunityId={opportunityId} onClose={() => onOpenChange(false)} onCreated={onCreated} />}
    </Dialog>
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
    return readiness.isError ? <Banner tone="danger" message={errorMessage(readiness.error)} /> : <LoadingState label="Checking the opportunity" rows={4} />;
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
    key: line.id, itemId: line.itemId, name: `${line.itemName} (${line.itemCode})`, description: line.description ?? "", quantity: String(line.quantity),
    discountPercent: line.estimatedDiscountPercent ? String(line.estimatedDiscountPercent) : "", estimate: line.estimatedUnitPrice, useEstimate: false, reason: "", fromOpportunity: true,
  })));
  const [search, setSearch] = useState("");
  const products = useQuery({ queryKey: ["quotation-product-search", search], queryFn: () => searchOpportunityProducts(search), enabled: search.trim().length >= 2 });

  const isCustomer = Boolean(account?.isCustomer);
  const linking = !isCustomer && customerChoice !== CREATE;
  const creatingCustomer = !isCustomer && customerChoice === CREATE;
  const needsAddress = creatingCustomer && !account?.hasBillingAddress;
  const priceLists = readiness.priceLists.filter((list) => list.currencyCode === currencyCode);
  const inactiveLines = readiness.lines.filter((line) => !line.active);

  const problems = [
    ...readiness.checks.filter((check) => check.blocking && !check.met).map((check) => `${check.label}: ${check.value ?? "missing"}`),
    !isCustomer && !can.createCustomer && "This account is not a customer yet, and you cannot create or link customers. Ask a manager to create its customer first.",
    creatingCustomer && strongMatch && "This company is already a customer: link the account to the existing customer.",
    creatingCustomer && !strongMatch && visibleMatches.length > 0 && !confirmNoMatch && "Confirm that none of the matching customers is this company.",
    needsAddress && !(address.line1 && address.city && address.state && address.postalCode && address.countryCode) && "Enter the customer's billing address.",
    !validUntil && "Choose the date the quotation is valid until.",
    lines.length === 0 && "Add at least one product or service.",
    ...lines.map((line, index) => (!(Number(line.quantity) > 0) ? `Line ${index + 1}: enter a quantity greater than zero.`
      : line.useEstimate && !line.reason.trim() ? `Line ${index + 1}: give the reason for using the estimated price.` : null)),
  ].filter((entry): entry is string => Boolean(entry));

  const input = (): CreateQuotationInput => ({
    idempotencyKey,
    ...(isCustomer ? {} : linking
      ? { customer: { mode: "link" as const, customerId: customerChoice } }
      : { customer: {
        mode: "create" as const, gstin: gstin.trim() || undefined, paymentTermId: customerTerms === NONE ? undefined : customerTerms, currencyCode,
        confirmNoMatch, ...(needsAddress ? { billingAddress: { ...address, line2: address.line2 || undefined, stateCode: address.stateCode || undefined } } : {}),
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
      itemId: line.itemId, description: line.description.trim() || undefined, quantity: Number(line.quantity),
      discountPercent: line.discountPercent.trim() ? Number(line.discountPercent) : undefined,
      ...(line.useEstimate && line.estimate !== null ? { unitPrice: line.estimate, manualPriceReason: line.reason.trim() } : {}),
    })),
  });
  const create = useMutation({ mutationFn: () => createQuotationFromOpportunity(opportunityId, input()), onSuccess: onCreated });
  const update = (key: string, patch: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const addressOptions = useMemo(() => readiness.addresses.map((entry) => ({ value: entry.id, label: `${entry.type[0].toUpperCase()}${entry.type.slice(1)}: ${entry.label}` })), [readiness.addresses]);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{readiness.opportunity.code} · {readiness.opportunity.name}</h3>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {[...readiness.checks, ...readiness.recommended.map((check) => ({ ...check, recommended: true }))].map((check) => (
            <li key={check.key} className="flex items-start gap-2">
              {check.met ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" /> : <X className={`mt-0.5 size-4 shrink-0 ${check.blocking ? "text-danger" : "text-warning"}`} aria-hidden="true" />}
              <span><span className="font-medium">{check.label}</span><span className="text-text-secondary"> · {check.value}</span>{"recommended" in check && !check.met ? <span className="text-text-muted"> (recommended)</span> : null}</span>
            </li>
          ))}
        </ul>
      </section>

      {account && !isCustomer && (
        <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border p-3">
          <h3 className="text-sm font-semibold">Customer</h3>
          <p className="text-sm text-text-secondary">Sales quotes a customer. {account.name} is still a prospect: create its customer master, or link it to a customer that already exists (the account and this opportunity move to that customer).</p>
          {can.createCustomer ? (
            <RadioGroup label="Customer for this quotation" value={customerChoice} onChange={setCustomerChoice}>
              {visibleMatches.map((match) => <Radio key={match.id} value={match.id}><CustomerMatchLabel match={match} /></Radio>)}
              <Radio value={CREATE} isDisabled={strongMatch}>Create the customer from {account.name}</Radio>
            </RadioGroup>
          ) : null}
          {readiness.customerMatches.some((match) => !match.canOpen) && <Banner tone="warning" message="A customer you cannot open matches this company. Ask a manager before creating a new customer." />}
          {creatingCustomer && can.createCustomer && (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="GSTIN" description="Optional. Used for GST and checked for duplicates." value={gstin} onChange={setGstin} />
              <Select label="Payment terms" selectedKey={customerTerms} onSelectionChange={(key) => setCustomerTerms(String(key))}
                options={[{ value: NONE, label: "Not set" }, ...readiness.paymentTerms.map((term) => ({ value: term.id, label: term.name }))]} />
              {visibleMatches.length > 0 && !strongMatch && <Checkbox isSelected={confirmNoMatch} onChange={setConfirmNoMatch}>None of the customers above is this company</Checkbox>}
              {needsAddress && (
                <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
                  <legend className="mb-1 text-sm font-medium">Billing address (the account has none yet)</legend>
                  <TextField label="Address line 1" isRequired value={address.line1} onChange={(line1) => setAddress({ ...address, line1 })} />
                  <TextField label="Address line 2" value={address.line2} onChange={(line2) => setAddress({ ...address, line2 })} />
                  <TextField label="City" isRequired value={address.city} onChange={(city) => setAddress({ ...address, city })} />
                  <TextField label="State" isRequired value={address.state} onChange={(state) => setAddress({ ...address, state })} />
                  <TextField label="GST state code" description="For example 27 for Maharashtra." value={address.stateCode} onChange={(stateCode) => setAddress({ ...address, stateCode })} />
                  <TextField label="Postal code" isRequired value={address.postalCode} onChange={(postalCode) => setAddress({ ...address, postalCode })} />
                  <TextField label="Country code" isRequired value={address.countryCode} onChange={(countryCode) => setAddress({ ...address, countryCode: countryCode.toUpperCase() })} />
                </fieldset>
              )}
            </div>
          )}
        </section>
      )}
      {account && isCustomer && <p className="text-sm">Customer: <span className="font-medium">{account.name}</span>{account.customerNumber ? ` (${account.customerNumber})` : ""}</p>}

      <section className="grid gap-3 sm:grid-cols-2">
        <Select label="Contact person" selectedKey={contactId} onSelectionChange={(key) => setContactId(String(key))}
          options={[{ value: NONE, label: "No contact" }, ...readiness.contacts.map((contact) => ({ value: contact.id, label: [contact.name, contact.jobTitle].filter(Boolean).join(" · ") }))]} />
        {!linking && (
          <>
            <Select label="Billing address" selectedKey={billingAddressId} onSelectionChange={(key) => setBillingAddressId(String(key))}
              options={[{ value: NONE, label: needsAddress ? "The new billing address" : "Customer's default" }, ...addressOptions]} />
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
        <h3 className="text-sm font-semibold">Products and services</h3>
        <p className="text-xs text-text-muted">Prices come from the price list and pricing rules; the opportunity&apos;s estimate is only a starting point. Tax and totals are calculated by Sales when the quotation is saved.</p>
        {inactiveLines.length > 0 && <Banner tone="warning" message={`Left out (inactive products): ${inactiveLines.map((line) => line.itemName).join(", ")}.`} />}
        <ul className="flex flex-col gap-2">
          {lines.map((line, index) => (
            <li key={line.key} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium">{index + 1}. {line.name}{line.fromOpportunity ? "" : " (added)"}</span>
                <IconButton aria-label={`Remove ${line.name}`} size="compact" variant="ghost" onPress={() => setLines(lines.filter((entry) => entry.key !== line.key))}><Trash2 className="size-4" aria-hidden="true" /></IconButton>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                <TextField className="sm:col-span-2" label="Description" value={line.description} onChange={(description) => update(line.key, { description })} />
                <TextField label="Quantity" inputMode="decimal" isRequired value={line.quantity} onChange={(quantity) => update(line.key, { quantity })} />
                <TextField label="Discount %" inputMode="decimal" isDisabled={!can.applyDiscount} description={can.applyDiscount ? undefined : "No discount permission."}
                  value={line.discountPercent} onChange={(discountPercent) => update(line.key, { discountPercent })} />
              </div>
              {line.estimate !== null && can.overridePrice && (
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
                    setLines([...lines, { key: crypto.randomUUID(), itemId: product.id, name: `${product.name} (${product.code})`, description: "", quantity: "1", discountPercent: "", estimate: null, useEstimate: false, reason: "", fromOpportunity: false }]);
                    setSearch("");
                  }}><Plus className="size-4" aria-hidden="true" />{product.name} ({product.code})</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <TextArea label="Notes for the customer" description="Printed on the quotation." value={customerNotes} onChange={setCustomerNotes} />
        <TextArea label="Terms and conditions" description="Printed on the quotation." value={terms} onChange={setTerms} />
        <TextArea className="sm:col-span-2" label="Internal notes" description="Never printed or sent to the customer." value={internalNotes} onChange={setInternalNotes} />
        {readiness.opportunity.internalContext && (
          <div className="rounded-[var(--radius-control)] border border-border bg-surface-muted p-3 text-sm sm:col-span-2">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">From the opportunity (internal, not copied to the quotation)</p>
            <p className="mt-1 whitespace-pre-wrap text-text-secondary">{readiness.opportunity.internalContext}</p>
          </div>
        )}
      </section>

      {create.isError && (
        <Banner tone="danger" message={`The quotation was not created. Nothing was changed. ${errorMessage(create.error)}`}
          detail={create.error instanceof QuotationApiError && /CUSTOMER/.test(create.error.code ?? "") ? "Review the customer section above." : undefined} />
      )}
      {problems.length > 0 && <p className="text-sm text-text-secondary">{problems[0]}</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="secondary" onPress={onClose}>Cancel</Button>
        <Button variant="primary" isDisabled={problems.length > 0} isLoading={create.isPending} onPress={() => create.mutate()}>Create draft quotation</Button>
      </div>
    </div>
  );
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2"><Check className="size-5 text-success" aria-hidden="true" /><h3 className="text-base font-semibold">Quotation {result.quotationNumber} created as a Draft</h3></div>
      <p className="text-sm text-text-secondary">
        {result.customerDecision === "created" ? "The account's customer master was created. " : result.customerDecision === "linked" ? "The account was linked to the existing customer. " : ""}
        {result.primary ? "It is the opportunity's primary quotation. " : ""}The opportunity stays open: a quotation does not win the deal.
      </p>
      {result.stageSuggestion && !moved && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-muted p-3 text-sm">
          <span className="flex-1">Move the opportunity to <span className="font-medium">{result.stageSuggestion.stageName}</span>?</span>
          <Button variant="secondary" size="compact" isLoading={move.isPending} onPress={() => move.mutate()}>Move to {result.stageSuggestion.stageName}</Button>
          <Button variant="ghost" size="compact" onPress={() => setMoved(true)}>Not now</Button>
        </div>
      )}
      {move.isError && <Banner tone="danger" message={errorMessage(move.error, "The stage could not be changed.")} />}
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="secondary" onPress={onClose}>Close</Button>
        <Button variant="primary" onPress={() => router.push(`/sales/quotations/${result.quotationId}`)}>Open quotation</Button>
      </div>
    </div>
  );
}

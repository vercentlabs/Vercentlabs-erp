"use client";

// A customer added at the counter, in the shared Customer Master (needs Create a customer): an individual (a name; phone and email optional)
// or a business (a name, GSTIN and billing address when it wants a GST invoice). Customers that look the same — same phone, email, GSTIN or a
// like name — are shown first: the cashier uses the existing one, or confirms this is a different customer. Nothing existing is merged or
// changed. The request key stays the same for this dialog, so a retry after a timeout never makes a second customer; if the customer is made
// but cannot be put on the bill, that is said plainly and only the selection is retried.
import { useRef, useState } from "react";
import { Building2, UserRound } from "lucide-react";
import { Button, Dialog, StatusBadge, TextField } from "@vercentlabs/design-system";

import { PosApiError } from "@/features/pos/shared/http";

import { quickCreatePosCustomer, type PosDuplicateMatch } from "../api/checkout-api";
import { INDIAN_STATES } from "./CustomerPanel";

type Kind = "individual" | "business";

export function NewCustomerDialog({ cartId, onClose, onSelect }: { cartId: string; onClose: () => void; onSelect: (customerId: string) => Promise<boolean> }) {
  const key = useRef(crypto.randomUUID());
  const [kind, setKind] = useState<Kind>("individual");
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [gstin, setGstin] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [matches, setMatches] = useState<PosDuplicateMatch[] | null>(null);
  const [created, setCreated] = useState<{ id: string; name: string; warnings: string[] } | null>(null);
  const edited = () => { setMatches(null); setError(null); setIssues({}); };

  async function select(customerId: string, customerName: string, warnings: string[] = []) {
    setBusy(true);
    const done = await onSelect(customerId);
    setBusy(false);
    if (done) onClose();
    else setCreated({ id: customerId, name: customerName, warnings });
  }

  async function create(confirmNotDuplicate = false) {
    setBusy(true);
    setError(null);
    setIssues({});
    try {
      const address = line1.trim() || city.trim() || stateCode || postalCode ? { line1: line1.trim() || null, city: city.trim() || null, stateCode: stateCode || null, postalCode: postalCode || null } : null;
      const result = await quickCreatePosCustomer({
        kind, name: name.trim(), legalName: kind === "business" ? legalName.trim() || null : null, phone: phone.trim() || null, email: email.trim() || null,
        gstin: kind === "business" ? gstin.trim() || null : null, billingAddress: address, contactPerson: kind === "business" ? contactPerson.trim() || null : null,
        cartId, idempotencyKey: key.current, confirmNotDuplicate,
      });
      setBusy(false);
      await select(result.customer.id, result.customer.name, result.warnings);
    } catch (failure) {
      setBusy(false);
      if (failure instanceof PosApiError && failure.code === "POS_CUSTOMER_POSSIBLE_DUPLICATE") {
        const details = failure.details as { matches?: PosDuplicateMatch[] } | undefined;
        setMatches(details?.matches ?? []);
        setError(failure.message);
        return;
      }
      const fieldIssues = (failure instanceof PosApiError ? (failure.details as { issues?: Array<{ field: string; message: string }> } | undefined)?.issues : undefined) ?? [];
      setIssues(Object.fromEntries(fieldIssues.map((issue) => [issue.field, issue.message])));
      setError(failure instanceof PosApiError ? failure.message : "The customer could not be created.");
    }
  }

  if (created) {
    return (
      <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Customer created">
        <div className="flex flex-col gap-3 text-sm">
          <p><strong>{created.name}</strong> was added to the customer list, but could not be put on this bill yet.</p>
          <p className="text-text-secondary">Try again, or find them with customer search. They will not be created twice.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onPress={onClose}>Close</Button>
            <Button variant="primary" isLoading={busy} onPress={() => void select(created.id, created.name, created.warnings)}>Put on this bill</Button>
          </div>
        </div>
      </Dialog>
    );
  }

  const noContact = !phone.trim() && !email.trim();
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Add new customer" size="lg"
      description="Saved in the customer list for every module. Only the name is required.">
      <div className="flex flex-col gap-3">
        <div role="radiogroup" aria-label="Customer type" className="grid grid-cols-2 gap-2">
          {([["individual", "Individual", UserRound], ["business", "Business", Building2]] as const).map(([value, label, Icon]) => (
            <button key={value} type="button" role="radio" aria-checked={kind === value} onClick={() => { setKind(value); edited(); }}
              className={`flex items-center justify-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-sm font-medium ${kind === value ? "border-brand bg-brand-soft text-brand" : "border-border text-text-secondary hover:bg-surface-muted"}`}>
              <Icon className="size-4" aria-hidden="true" />{label}
            </button>
          ))}
        </div>
        <TextField label={kind === "business" ? "Business name" : "Customer name"} value={name} onChange={(value) => { setName(value); edited(); }} isRequired autoFocus
          errorMessage={issues.name} />
        {kind === "business" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField label="Legal name (if different)" value={legalName} onChange={(value) => { setLegalName(value); edited(); }} />
            <TextField label="GSTIN" description="Needed for a GST invoice. Its format is checked; it is not verified with the GST portal."
              value={gstin} onChange={(value) => { setGstin(value.toUpperCase().replace(/\s/g, "").slice(0, 15)); edited(); }} errorMessage={issues.gstin} />
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Mobile number" value={phone} onChange={(value) => { setPhone(value); edited(); }} inputMode="tel" errorMessage={issues.phone} />
          <TextField label="Email" value={email} onChange={(value) => { setEmail(value); edited(); }} inputMode="email" errorMessage={issues.email} />
        </div>
        {kind === "business" && <TextField label="Contact person" value={contactPerson} onChange={setContactPerson} />}
        <fieldset className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3">
          <legend className="px-1 text-xs font-medium text-text-secondary">Billing address {kind === "business" ? "(needed for a GST invoice)" : "(optional)"}</legend>
          <TextField label="Address" value={line1} onChange={(value) => { setLine1(value); edited(); }} errorMessage={issues["billingAddress.line1"]} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <TextField label="City" value={city} onChange={(value) => { setCity(value); edited(); }} errorMessage={issues["billingAddress.city"]} />
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-text">State</span>
              <select className="h-9 rounded-[var(--radius-control)] border border-border bg-surface px-2 text-sm" value={stateCode} onChange={(event) => { setStateCode(event.target.value); edited(); }}>
                <option value="">Choose…</option>
                {INDIAN_STATES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
              {issues["billingAddress.stateCode"] && <span className="text-xs text-danger">{issues["billingAddress.stateCode"]}</span>}
            </label>
            <TextField label="PIN code" value={postalCode} onChange={(value) => { setPostalCode(value.replace(/\D/g, "").slice(0, 6)); edited(); }} inputMode="numeric"
              errorMessage={issues["billingAddress.postalCode"]} />
          </div>
        </fieldset>
        {noContact && name.trim() && <p className="text-xs text-warning">Without a phone or email this customer may be hard to find on a later visit.</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {matches && matches.length > 0 && (
          <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft p-3">
            <p className="text-sm font-medium text-warning">A customer with similar details already exists. Use them, or create a different customer.</p>
            <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-control)] bg-surface">
              {matches.map((match) => (
                <li key={match.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{match.name ?? "Customer"}</span>
                    <span className="block truncate text-xs text-text-muted">{[match.code, match.city, ...match.reasons].filter(Boolean).join(" · ")}</span>
                  </span>
                  {match.notCustomer ? <StatusBadge tone="neutral">CRM account</StatusBadge>
                    : match.status && match.status !== "active" ? <StatusBadge tone="danger">Inactive</StatusBadge>
                      : <Button variant="secondary" size="compact" isDisabled={busy} onPress={() => void select(match.id, match.name ?? "Customer")}>Use this customer</Button>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          {matches && matches.length > 0 ? (
            <Button variant="primary" isLoading={busy} onPress={() => void create(true)}>It&apos;s a different customer — create</Button>
          ) : (
            <Button variant="primary" isLoading={busy} isDisabled={!name.trim()} onPress={() => void create(false)}>Create and use</Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

"use client";

// The bill's customer: Walk-In Customer by default (no registration, no name, phone or email needed), or a Named Customer — a Customer
// Master customer found by name, customer number, phone, email or GSTIN, or added on the spot. A walk-in bill may carry an optional buyer
// name and address for the invoice and, with the customer's agreement, a phone or email for a digital receipt — neither ever creates a
// customer. A named customer's bill is invoiced to one of their billing addresses and priced from their price list where they have one.
// Changing customer keeps the items; prices, tax and approvals are worked out again and what changed is shown.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, History, Search, UserRound, X } from "lucide-react";
import { Badge, Button, Checkbox, IconButton, SearchField, StatusBadge, TextField } from "@vercentlabs/design-system";
import type { PosCart } from "@vercentlabs/api";

import { PosApiError } from "@/features/pos/shared/http";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  getPosCustomerContext, getPosCustomerPreview, searchPosCustomers, selectPosRegisteredCustomer, setPosBillingAddress, setPosReceiptContact, setPosWalkIn,
  updatePosBuyerDetails, type PosCustomerMatch,
} from "../api/checkout-api";
import { CustomerHistoryDialog } from "./CustomerHistoryDialog";
import { NewCustomerDialog } from "./NewCustomerDialog";

type Change = { code: string; message: string };

export function CustomerPanel({ cart, editable, onCart }: { cart: PosCart; editable: boolean; onCart: (cart: PosCart) => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const contextQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "customer-context", cart.id, cart.version), queryFn: () => getPosCustomerContext(cart.id) });
  const info = contextQuery.data;
  const [finding, setFinding] = useState(false);
  const [adding, setAdding] = useState(false);
  const [history, setHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An error that needs a named customer offers to add one right there (Create-Where-You-Are POS3).
  const [needsCustomer, setNeedsCustomer] = useState(false);
  const [changes, setChanges] = useState<Change[]>([]);
  const [showBuyer, setShowBuyer] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);

  async function apply(action: () => Promise<{ cart: PosCart }>) {
    try {
      const result = await action();
      onCart(result.cart);
      setChanges((result.cart as PosCart & { customerChanges?: Change[] }).customerChanges ?? []);
      setError(null);
      setNeedsCustomer(false);
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "customer-context", cart.id) });
      return true;
    } catch (failure) {
      setError(failure instanceof PosApiError ? failure.message : "The customer could not be changed.");
      setNeedsCustomer(failure instanceof PosApiError && failure.code === "POS_CUSTOMER_BILLING_ADDRESS_INVALID");
      return false;
    }
  }

  const registered = info?.mode === "REGISTERED" || Boolean(cart.customer_id);
  const named = info?.customer ?? null;
  const addresses = named?.billingAddresses ?? [];
  const invoiceAddress = named ? addresses.find((entry) => entry.id === named.billingAddressId) ?? null : null;
  return (
    <div className="flex flex-col gap-3">
      {registered ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {named?.type === "business"
                ? <Building2 className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                : <UserRound className="size-4 shrink-0 text-text-muted" aria-hidden="true" />}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-text">{named?.name ?? cart.customer_name ?? "Customer"}</p>
                <p className="truncate text-xs text-text-muted">{named?.code ? `Customer: ${named.code}` : "Named customer"}{named?.legalName ? ` · ${named.legalName}` : ""}</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1">
              <Badge tone="neutral">{named?.type === "individual" ? "Individual" : "Business"}</Badge>
              {named && named.status !== "active" && <StatusBadge tone="danger">{named.status === "blocked" ? "Blocked" : "Inactive"}</StatusBadge>}
            </div>
          </div>
          {named && (
            <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-xs sm:grid-cols-2">
              <div className="flex gap-1"><dt className="text-text-muted">GST:</dt><dd>{named.gstRegistered ? `Registered · ${named.gstin ?? "on file"}` : "Not registered"}</dd></div>
              <div className="flex min-w-0 gap-1"><dt className="text-text-muted">Price list:</dt>
                <dd className="truncate">{named.priceList ? `${named.priceList.name}${named.priceList.isCustomerList ? " (customer's)" : ""}` : "Store prices"}</dd></div>
              {named.phone && <div className="flex gap-1"><dt className="text-text-muted">Phone:</dt><dd>{named.phone}</dd></div>}
            </dl>
          )}
          {named && (addresses.length > 1 && editable ? (
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-text-muted">Billing address</span>
              <select className="h-9 rounded-[var(--radius-control)] border border-border bg-surface px-2 text-sm" value={named.billingAddressId ?? ""}
                onChange={(event) => { const value = event.target.value; if (value) void apply(() => setPosBillingAddress(cart.id, value, cart.version)); }}>
                {addresses.map((address) => (
                  <option key={address.id} value={address.id}>{[address.label, address.line1, address.city, address.state].filter(Boolean).join(", ")}{address.isDefault ? " (default)" : ""}</option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-xs"><span className="text-text-muted">Billing address: </span>
              {invoiceAddress ? [invoiceAddress.line1, invoiceAddress.city, invoiceAddress.state].filter(Boolean).join(", ") : "None on file"}
            </p>
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <UserRound className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-text">Walk-In Customer</p>
              <p className="truncate text-xs text-text-muted">No customer registration required</p>
            </div>
          </div>
          <StatusBadge tone="neutral">Walk-in</StatusBadge>
        </div>
      )}

      {error && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
          {error}
          {needsCustomer && <Button variant="outline" size="compact" onPress={() => { setError(null); setNeedsCustomer(false); setAdding(true); }}>Add new customer</Button>}
        </p>
      )}
      {changes.length > 0 && (
        <div className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-xs text-warning">
          <p className="font-medium">The bill was recalculated for this customer:</p>
          <ul className="mt-1 list-disc pl-4">{changes.map((change, index) => <li key={index}>{change.message}</li>)}</ul>
        </div>
      )}
      {info && !info.policy.allowWalkIn && !registered && (
        <p className="text-xs text-warning">This store does not take walk-in sales: select or add a customer before payment.</p>
      )}

      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="compact" onPress={() => setFinding((value) => !value)}>
            <Search className="size-4" aria-hidden="true" />{registered ? "Change customer" : "Find customer"}
          </Button>
          <Button variant="ghost" size="compact" onPress={() => setAdding(true)}>Add new customer</Button>
          {registered && (
            <Button variant="ghost" size="compact" isDisabled={info ? !info.policy.allowWalkIn : false} onPress={() => void apply(() => setPosWalkIn(cart.id, cart.version))}>
              Switch to Walk-In
            </Button>
          )}
        </div>
      )}
      {registered && cart.customer_id && (
        <button type="button" className="flex items-center gap-1 self-start text-xs font-medium text-brand hover:underline" onClick={() => setHistory(true)}>
          <History className="size-3.5" aria-hidden="true" />Purchase history
        </button>
      )}
      {editable && finding && (
        <CustomerFinder cartId={cart.id} currentId={cart.customer_id} onClose={() => setFinding(false)}
          onUse={(customerId, billingAddressId) => apply(() => selectPosRegisteredCustomer(cart.id, customerId, cart.version, billingAddressId))
            .then((done) => { if (done) setFinding(false); return done; })} />
      )}

      {info && !registered && (
        <div className="flex flex-col gap-2 border-t border-border pt-2">
          {info.buyerDetailsRequired && !info.buyerDetailsComplete && (
            <p className="text-xs font-medium text-warning">A bill of this amount needs the buyer&apos;s name, address and state on the invoice.</p>
          )}
          {(info.policy.allowBuyerName || info.buyerDetailsRequired) && (
            <button type="button" className="self-start text-xs font-medium text-brand hover:underline" onClick={() => setShowBuyer((value) => !value)}>
              {info.buyerDetails?.name ? `Invoice name: ${info.buyerDetails.name}` : "Add a name or address for the invoice (optional)"}
            </button>
          )}
          {showBuyer && editable && (
            <BuyerForm initial={info.buyerDetails} onSave={(input) => apply(() => updatePosBuyerDetails(cart.id, input, cart.version)).then((done) => done && setShowBuyer(false))} />
          )}
        </div>
      )}
      {info && info.policy.allowReceiptContact && (
        <div className="flex flex-col gap-2">
          <button type="button" className="self-start text-xs font-medium text-brand hover:underline" onClick={() => setShowReceipt((value) => !value)}>
            {info.receiptContact.phone || info.receiptContact.email
              ? `Digital receipt to ${[info.receiptContact.phone, info.receiptContact.email].filter(Boolean).join(" and ")}`
              : "Send a digital receipt (optional)"}
          </button>
          {showReceipt && editable && (
            <ReceiptForm masked={info.receiptContact.masked && Boolean(info.receiptContact.phone || info.receiptContact.email)}
              onSave={(input) => apply(() => setPosReceiptContact(cart.id, input, cart.version)).then((done) => done && setShowReceipt(false))} />
          )}
        </div>
      )}

      {adding && (
        <NewCustomerDialog cartId={cart.id} onClose={() => setAdding(false)}
          onSelect={(customerId) => apply(() => selectPosRegisteredCustomer(cart.id, customerId, cart.version))} />
      )}
      {history && cart.customer_id && (
        <CustomerHistoryDialog customerId={cart.customer_id} customerName={named?.name ?? cart.customer_name ?? "Customer"} cartId={cart.id} onClose={() => setHistory(false)} />
      )}
    </div>
  );
}

// Search the Customer Master from the counter: results say enough to tell similar customers apart (number, type, city, phone ending, GST)
// without showing their full details; choosing one opens a short preview before it is put on the bill.
function CustomerFinder({ cartId, currentId, onClose, onUse }: {
  cartId: string; currentId: string | null; onClose: () => void; onUse: (customerId: string, billingAddressId: string | null) => Promise<boolean>;
}) {
  const workspace = useWorkspaceContext();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [pages, setPages] = useState(1);
  const [previewId, setPreviewId] = useState<string | null>(null);
  useEffect(() => { const handle = setTimeout(() => { setDebounced(term.trim()); setPages(1); }, 250); return () => clearTimeout(handle); }, [term]);
  const results = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "customer-search", cartId, debounced, pages),
    queryFn: async ({ signal }) => {
      const all: PosCustomerMatch[] = [];
      let total = 0;
      for (let page = 0; page < pages; page += 1) {
        const response = await searchPosCustomers(debounced, { cartId, offset: page * 10, signal });
        all.push(...response.rows);
        total = response.total;
      }
      return { rows: all, total };
    },
    enabled: debounced.length > 0,
  });
  if (previewId) return <CustomerPreviewCard customerId={previewId} cartId={cartId} isCurrent={previewId === currentId} onBack={() => setPreviewId(null)} onUse={onUse} />;
  const rows = results.data?.rows ?? [];
  const total = results.data?.total ?? 0;
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-2">
      <div className="flex items-center gap-2">
        <SearchField aria-label="Search customers" placeholder="Name, phone, customer code, email or GSTIN" value={term} onChange={setTerm} className="flex-1" autoFocus />
        <IconButton variant="ghost" aria-label="Close customer search" onPress={onClose}><X className="size-4" aria-hidden="true" /></IconButton>
      </div>
      {!debounced ? <p className="px-1 text-xs text-text-muted">Type a name, a phone number, a customer code, an email or a GSTIN.</p>
        : results.isError ? <p className="px-1 text-xs text-danger">{results.error instanceof PosApiError ? results.error.message : "Search failed. Try again."}</p>
          : results.isLoading ? <p className="px-1 text-xs text-text-muted">Searching…</p>
            : rows.length === 0 ? <p className="px-1 text-xs text-text-muted">No matching customers. Add a new customer instead.</p> : (
              <ul className="flex max-h-72 flex-col divide-y divide-border overflow-y-auto">
                {rows.map((row) => (
                  <li key={row.id}>
                    <button type="button" onClick={() => setPreviewId(row.id)}
                      className="flex w-full items-start justify-between gap-2 rounded-[var(--radius-control)] px-2 py-2 text-left hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium text-text">{row.name}</span>
                        <span className="truncate text-xs text-text-muted">
                          {[row.code, row.type === "business" ? "Business" : "Individual", row.gstRegistered ? "GST registered" : null,
                            row.phone ?? (row.phoneEnding ? `Phone ending ${row.phoneEnding}` : null), row.city].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {row.status !== "active" && <StatusBadge tone="danger">{row.status === "blocked" ? "Blocked" : "Inactive"}</StatusBadge>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
      {rows.length > 0 && rows.length < total && (
        <Button variant="ghost" size="compact" className="self-center" onPress={() => setPages((value) => value + 1)}>Show more ({total - rows.length} more)</Button>
      )}
    </div>
  );
}

// The customer about to be put on the bill: enough to be sure it is the right one, and the billing address to invoice.
function CustomerPreviewCard({ customerId, cartId, isCurrent, onBack, onUse }: {
  customerId: string; cartId: string; isCurrent: boolean; onBack: () => void; onUse: (customerId: string, billingAddressId: string | null) => Promise<boolean>;
}) {
  const workspace = useWorkspaceContext();
  const preview = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "customer-preview", cartId, customerId), queryFn: () => getPosCustomerPreview(customerId, cartId) });
  const [addressId, setAddressId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const customer = preview.data;
  const chosenAddress = addressId ?? customer?.billingAddresses.find((address) => address.isDefault)?.id ?? customer?.billingAddresses[0]?.id ?? null;
  const only = customer?.billingAddresses[0];
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3">
      {preview.isLoading ? <p className="text-xs text-text-muted">Loading customer…</p>
        : preview.isError || !customer ? <p className="text-xs text-danger">{preview.error instanceof PosApiError ? preview.error.message : "The customer could not be loaded."}</p> : (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{customer.name}</p>
                <p className="truncate text-xs text-text-muted">{customer.code} · {customer.type === "business" ? "Business" : "Individual"}{customer.legalName ? ` · ${customer.legalName}` : ""}</p>
              </div>
              {customer.status !== "active" && <StatusBadge tone="danger">{customer.status === "blocked" ? "Blocked" : "Inactive"}</StatusBadge>}
            </div>
            <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-xs sm:grid-cols-2">
              <div className="flex gap-1"><dt className="text-text-muted">GST:</dt><dd>{customer.gstRegistered ? `Registered · ${customer.gstin ?? "on file"}` : "Not registered"}</dd></div>
              <div className="flex min-w-0 gap-1"><dt className="text-text-muted">Price list:</dt><dd className="truncate">{customer.priceList?.name ?? "Store prices"}</dd></div>
              <div className="flex gap-1"><dt className="text-text-muted">Contact:</dt>
                <dd>{customer.phone ?? (customer.phoneEnding ? `Phone ending ${customer.phoneEnding}` : customer.email ?? "None")}</dd></div>
              <div className="flex gap-1"><dt className="text-text-muted">Purchases here:</dt><dd>{customer.purchases.total}</dd></div>
            </dl>
            {customer.billingAddresses.length > 1 ? (
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-text-muted">Billing address</span>
                <select className="h-9 rounded-[var(--radius-control)] border border-border bg-surface px-2 text-sm" value={chosenAddress ?? ""} onChange={(event) => setAddressId(event.target.value)}>
                  {customer.billingAddresses.map((address) => (
                    <option key={address.id} value={address.id}>{[address.label, address.line1, address.city, address.state].filter(Boolean).join(", ")}{address.isDefault ? " (default)" : ""}</option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="text-xs"><span className="text-text-muted">Billing address: </span>{only ? [only.line1, only.city, only.state].filter(Boolean).join(", ") : "None on file"}</p>
            )}
            {!customer.eligible && <p className="text-xs font-medium text-danger">{customer.ineligibleReason ?? "This customer cannot be used for a sale."}</p>}
          </>
        )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="compact" onPress={onBack}>Back to results</Button>
        <Button variant="primary" size="compact" isLoading={busy} isDisabled={!customer?.eligible || isCurrent}
          onPress={async () => { setBusy(true); await onUse(customerId, chosenAddress); setBusy(false); }}>
          {isCurrent ? "Already on this bill" : "Use this customer"}
        </Button>
      </div>
    </div>
  );
}

export const INDIAN_STATES: Array<[string, string]> = [
  ["01", "Jammu and Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"], ["05", "Uttarakhand"], ["06", "Haryana"], ["07", "Delhi"], ["08", "Rajasthan"],
  ["09", "Uttar Pradesh"], ["10", "Bihar"], ["11", "Sikkim"], ["12", "Arunachal Pradesh"], ["13", "Nagaland"], ["14", "Manipur"], ["15", "Mizoram"], ["16", "Tripura"],
  ["17", "Meghalaya"], ["18", "Assam"], ["19", "West Bengal"], ["20", "Jharkhand"], ["21", "Odisha"], ["22", "Chhattisgarh"], ["23", "Madhya Pradesh"], ["24", "Gujarat"],
  ["26", "Dadra and Nagar Haveli and Daman and Diu"], ["27", "Maharashtra"], ["29", "Karnataka"], ["30", "Goa"], ["31", "Lakshadweep"], ["32", "Kerala"], ["33", "Tamil Nadu"],
  ["34", "Puducherry"], ["35", "Andaman and Nicobar Islands"], ["36", "Telangana"], ["37", "Andhra Pradesh"], ["38", "Ladakh"],
];

// The walk-in buyer's name and address for the invoice. A GSTIN is not taken here: a business invoice needs a registered business customer.
function BuyerForm({ initial, onSave }: {
  initial: { name: string | null; address: Record<string, string | undefined> } | null; onSave: (input: { name: string | null; address: Record<string, string | null> }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [line1, setLine1] = useState(initial?.address?.line1 ?? "");
  const [city, setCity] = useState(initial?.address?.city ?? "");
  const [stateCode, setStateCode] = useState(initial?.address?.stateCode ?? "");
  const [postalCode, setPostalCode] = useState(initial?.address?.postalCode ?? "");
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-2">
      <TextField label="Buyer name" value={name} onChange={setName} />
      <TextField label="Address" value={line1} onChange={setLine1} />
      <div className="grid grid-cols-2 gap-2">
        <TextField label="City" value={city} onChange={setCity} />
        <TextField label="PIN code" value={postalCode} onChange={(value) => setPostalCode(value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" />
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text">State</span>
        <select className="h-9 rounded-[var(--radius-control)] border border-border bg-surface px-2 text-sm" value={stateCode} onChange={(event) => setStateCode(event.target.value)}>
          <option value="">Choose…</option>
          {INDIAN_STATES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
      </label>
      <p className="text-xs text-text-muted">For a GST (business) invoice, add the buyer as a customer instead — their GSTIN is checked there.</p>
      <Button variant="secondary" size="compact" className="self-end"
        onPress={() => onSave({ name: name.trim() || null, address: { line1: line1.trim() || null, city: city.trim() || null, stateCode: stateCode || null, postalCode: postalCode || null } })}>
        Save buyer details
      </Button>
    </div>
  );
}

// Phone and / or email for the digital receipt, only with the customer's agreement (receipt only — never marketing).
function ReceiptForm({ masked, onSave }: { masked: boolean; onSave: (input: { phone: string | null; email: string | null; consent: boolean }) => void }) {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const empty = !phone.trim() && !email.trim();
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-2">
      {masked && <p className="text-xs text-text-muted">A contact is saved (hidden). Enter a new one to replace it, or save empty to remove it.</p>}
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Mobile number" value={phone} onChange={setPhone} inputMode="tel" />
        <TextField label="Email" value={email} onChange={setEmail} inputMode="email" />
      </div>
      <Checkbox isSelected={consent} onChange={setConsent} isDisabled={empty}>The customer agreed to receive this receipt there</Checkbox>
      <Button variant="secondary" size="compact" className="self-end" isDisabled={!empty && !consent}
        onPress={() => onSave({ phone: phone.trim() || null, email: email.trim() || null, consent: !empty && consent })}>
        {empty ? "Remove contact" : "Save contact"}
      </Button>
    </div>
  );
}

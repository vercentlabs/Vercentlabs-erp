"use client";

// The bill's customer: Walk-In Customer by default (no registration, no name, phone or email needed), or a Customer Master customer chosen
// by search or added on the spot. A walk-in bill may carry an optional buyer name and address for the invoice and, with the customer's
// agreement, a phone or email for a digital receipt — neither ever creates a customer. Switching customer keeps the items; prices, tax and
// approvals are worked out again and what changed is shown.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserRound, X } from "lucide-react";
import { Button, Checkbox, ComboBox, IconButton, StatusBadge, TextField } from "@vercentlabs/design-system";
import type { PosCart } from "@vercentlabs/api";

import { PosApiError } from "@/features/pos/shared/http";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  getPosCustomerContext, searchPosCustomers, selectPosRegisteredCustomer, setPosReceiptContact, setPosWalkIn, updatePosBuyerDetails,
} from "../api/checkout-api";

type Change = { code: string; message: string };

export function CustomerPanel({ cart, editable, onCart, onNewCustomer }: {
  cart: PosCart; editable: boolean; onCart: (cart: PosCart) => void; onNewCustomer: () => void;
}) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const contextKey = scopedQueryKey(workspace, "pos", "customer-context", cart.id, cart.version);
  const contextQuery = useQuery({ queryKey: contextKey, queryFn: () => getPosCustomerContext(cart.id) });
  const info = contextQuery.data;
  const [searching, setSearching] = useState(false);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [showBuyer, setShowBuyer] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  useEffect(() => { const handle = setTimeout(() => setDebounced(term), 250); return () => clearTimeout(handle); }, [term]);
  const results = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "customer-search", debounced),
    queryFn: ({ signal }) => searchPosCustomers(debounced, { signal }),
    enabled: searching && debounced.trim().length > 0,
  });

  async function apply(action: () => Promise<{ cart: PosCart }>) {
    try {
      const result = await action();
      onCart(result.cart);
      setChanges((result.cart as PosCart & { customerChanges?: Change[] }).customerChanges ?? []);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "customer-context", cart.id) });
      return true;
    } catch (failure) {
      setError(failure instanceof PosApiError ? failure.message : "The customer could not be changed.");
      return false;
    }
  }

  const registered = info?.mode === "REGISTERED" || Boolean(cart.customer_id);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <UserRound className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-text">{registered ? info?.displayName ?? cart.customer_name ?? "Customer" : "Walk-In Customer"}</p>
            <p className="truncate text-xs text-text-muted">
              {registered ? [info?.customer?.phone, info?.customer?.gstin ? `GSTIN ${info.customer.gstin}` : null].filter(Boolean).join(" · ") || "Registered customer" : "No customer registration required"}
            </p>
          </div>
        </div>
        <StatusBadge tone={registered ? "info" : "neutral"}>{registered ? "Registered" : "Walk-in"}</StatusBadge>
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
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
          {registered ? (
            <Button variant="secondary" size="compact" isDisabled={info ? !info.policy.allowWalkIn : false} onPress={() => void apply(() => setPosWalkIn(cart.id, cart.version))}>
              Switch to walk-in
            </Button>
          ) : null}
          <Button variant="secondary" size="compact" onPress={() => setSearching((value) => !value)}>{registered ? "Change customer" : "Select existing customer"}</Button>
          <Button variant="ghost" size="compact" onPress={onNewCustomer}>Add new customer</Button>
        </div>
      )}
      {editable && searching && (
        <div className="flex items-end gap-2">
          <ComboBox
            label="Find a customer"
            placeholder="Name, customer code or phone"
            inputValue={term}
            onInputChange={setTerm}
            className="flex-1"
            options={(results.data?.rows ?? []).map((row) => ({ value: row.id, label: row.phone || row.email ? `${row.displayName} · ${row.phone || row.email}` : row.displayName }))}
            isLoading={results.isFetching}
            emptyMessage={debounced.trim() ? "No matching customers" : "Type to search customers"}
            allowsEmptyCollection
            onSelectionChange={(key) => {
              if (key == null) return;
              void apply(() => selectPosRegisteredCustomer(cart.id, String(key), cart.version)).then((done) => { if (done) { setSearching(false); setTerm(""); } });
            }}
          />
          <IconButton variant="ghost" aria-label="Close customer search" onPress={() => { setSearching(false); setTerm(""); }}><X className="size-4" aria-hidden="true" /></IconButton>
        </div>
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
    </div>
  );
}

const STATES: Array<[string, string]> = [
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
          {STATES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
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

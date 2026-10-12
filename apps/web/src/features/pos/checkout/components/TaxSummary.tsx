"use client";

// The bill's totals and tax, as the shared tax engine works them out: whether prices include or exclude GST, the taxable value, the tax
// (with its CGST / SGST / UTGST / IGST / cess breakdown on demand), any rounding and the total — plus where the goods are supplied (handed
// over here, or delivered to a state) and which document the sale will be. When the tax cannot be calculated (a product without a tax
// category, a registration that needs attention, a missing delivery state) that is said plainly and checkout stays blocked; a cashier
// never picks a rate.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@vercentlabs/design-system";
import type { PosCart } from "@vercentlabs/api";

import { money } from "@/features/pos/shared/format";
import { PosApiError } from "@/features/pos/shared/http";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getPosCartTaxes, setPosCartSupply } from "../api/checkout-api";
import { INDIAN_STATES } from "./CustomerPanel";

const DOCUMENT: Record<string, string> = {
  tax_invoice: "Tax invoice", bill_of_supply: "Bill of supply", invoice_cum_bill_of_supply: "Tax invoice and bill of supply",
};
const stateName = (code: string | null | undefined) => INDIAN_STATES.find(([value]) => value === code)?.[1] ?? code ?? "";

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? "text-text" : muted ? "text-text-muted" : "text-text-secondary"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export function TaxSummary({ cart, currency, editable, onCart }: { cart: PosCart | null; currency: string; editable: boolean; onCart: (cart: PosCart) => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "cart-taxes", cart?.id ?? "none", cart?.version ?? 0),
    queryFn: () => getPosCartTaxes(cart!.id),
    enabled: Boolean(cart?.id),
  });
  const taxes = query.data;
  const valid = taxes?.status === "VALID" ? taxes : null;

  async function supply(mode: "in_store" | "delivery", state: string | null) {
    if (!cart) return;
    try {
      const result = await setPosCartSupply(cart.id, { supplyMode: mode, deliveryStateCode: state }, cart.version);
      onCart(result.cart);
      setError(null);
      setChanging(false);
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "cart-taxes", cart.id) });
    } catch (failure) {
      setError(failure instanceof PosApiError ? failure.message : "The supply could not be changed.");
    }
  }

  const includes = valid?.pricesIncludeTax === true;
  const otherDiscounts = Number(cart?.discount_total ?? 0) - Number(cart?.manual_discount_total ?? 0) - Number(cart?.promotion_discount_total ?? 0) - Number(cart?.cart_discount_total ?? 0);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <Row label={includes ? "Items (prices include GST)" : "Items"} value={money(currency, cart?.subtotal)} />
      {/* Each kind of discount apart: the cashier's item discounts, automatic offers, the cart discount, and anything else (coupons, points). */}
      {Number(cart?.manual_discount_total ?? 0) > 0 && <Row label="Item discounts" value={`−${money(currency, cart?.manual_discount_total)}`} />}
      {Number(cart?.promotion_discount_total ?? 0) > 0 && <Row label="Offers" value={`−${money(currency, cart?.promotion_discount_total)}`} />}
      {Number(cart?.cart_discount_total ?? 0) > 0 && (
        <Row label={`Cart discount${cart?.cart_discount_type === "percent" ? ` (${Number(cart.cart_discount_value)}%)` : ""}`} value={`−${money(currency, cart?.cart_discount_total)}`} />
      )}
      {otherDiscounts > 0.004 && <Row label="Other discounts" value={`−${money(currency, otherDiscounts)}`} />}
      {valid && <Row label="Taxable value" value={money(currency, valid.taxableTotal)} />}
      <button type="button" className="flex items-center justify-between text-text-secondary hover:text-text disabled:hover:text-text-secondary"
        onClick={() => setOpen((value) => !value)} disabled={!valid || !valid.breakdown.length} aria-expanded={open}>
        <span className="flex items-center gap-1">
          {includes ? "GST included" : "GST"}
          {valid && valid.breakdown.length > 0 && (open ? <ChevronUp className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />)}
        </span>
        <span className="tabular-nums">{money(currency, valid?.taxTotal ?? cart?.tax_total)}</span>
      </button>
      {open && valid && (
        <ul className="ml-3 flex flex-col gap-0.5 border-l border-border pl-2 text-xs text-text-muted">
          {valid.breakdown.map((entry) => (
            <li key={`${entry.type}-${entry.rate}`} className="flex justify-between gap-2">
              <span>{entry.label} {Number(entry.rate)}% on {money(currency, entry.taxableAmount)}</span>
              <span className="tabular-nums">{money(currency, entry.taxAmount)}</span>
            </li>
          ))}
        </ul>
      )}
      {valid && Number(valid.roundingAdjustment) !== 0 && <Row label="Rounding" value={money(currency, valid.roundingAdjustment)} muted />}
      <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-lg font-semibold text-text">
        <span>Total</span>
        <span className="tabular-nums">{money(currency, valid?.grandTotal ?? cart?.grand_total)}</span>
      </div>

      {taxes?.status === "INVALID" && (
        <div role="alert" className="mt-1 flex gap-2 rounded-[var(--radius-control)] border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span><span className="font-medium">Tax cannot be calculated.</span> {taxes.message} Payment is blocked until this is fixed.</span>
        </div>
      )}
      {valid?.stale && <p className="text-xs text-warning">Taxes changed since the bill was last priced. Please review the bill.</p>}

      {valid && (
        <div className="mt-1 flex flex-col gap-1 text-xs text-text-muted">
          <p>
            {valid.supplyMode === "delivery" ? `Delivered to ${stateName(valid.deliveryStateCode)}` : "Handed over at the counter"}
            {valid.placeOfSupply ? ` · Place of supply ${stateName(valid.placeOfSupply)} (${valid.placeOfSupply})` : ""}
            {editable && (
              <button type="button" className="ml-1 font-medium text-brand hover:underline" onClick={() => setChanging((value) => !value)}>Change</button>
            )}
          </p>
          {changing && editable && (
            <SupplyForm initialMode={valid.supplyMode} initialState={valid.deliveryStateCode} onSave={supply} onCancel={() => setChanging(false)} />
          )}
          {error && <p className="text-danger">{error}</p>}
          <p>
            {DOCUMENT[valid.documentType] ?? valid.documentType}
            {valid.seller?.gstin ? ` · Seller GSTIN ${valid.seller.gstin}` : ""}
            {!valid.taxEnabled ? " · GST not charged (no registration)" : ""}
            {" · "}{valid.pricesIncludeTax === null ? "Some prices include GST" : includes ? "Prices include GST" : "Prices exclude GST — added at the bill"}
          </p>
        </div>
      )}
    </div>
  );
}

// Handed over here (the store's state is the place of supply), or delivered to a state (that state is).
function SupplyForm({ initialMode, initialState, onSave, onCancel }: {
  initialMode: "in_store" | "delivery"; initialState: string | null; onSave: (mode: "in_store" | "delivery", state: string | null) => void; onCancel: () => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [state, setState] = useState(initialState ?? "");
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-2 text-sm text-text">
      <div role="radiogroup" aria-label="How the goods leave the store" className="grid grid-cols-2 gap-2">
        {([["in_store", "Handed over here"], ["delivery", "Delivered"]] as const).map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => setMode(value)}
            className={`rounded-[var(--radius-control)] border px-2 py-1.5 text-xs font-medium ${mode === value ? "border-brand bg-brand-soft text-brand" : "border-border text-text-secondary"}`}>
            {label}
          </button>
        ))}
      </div>
      {mode === "delivery" && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-text-muted">Delivery state</span>
          <select className="h-9 rounded-[var(--radius-control)] border border-border bg-surface px-2 text-sm" value={state} onChange={(event) => setState(event.target.value)}>
            <option value="">Choose…</option>
            {INDIAN_STATES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="compact" onPress={onCancel}>Cancel</Button>
        <Button variant="secondary" size="compact" isDisabled={mode === "delivery" && !state} onPress={() => onSave(mode, mode === "delivery" ? state : null)}>Save</Button>
      </div>
    </div>
  );
}

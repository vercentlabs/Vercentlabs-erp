"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus, Trash2, X } from "lucide-react";
import { Button, ComboBox, NumberField, SearchField, StatusBadge, TextField } from "@vercentlabs/design-system";
import type { PosCart } from "@vercentlabs/api";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  addPosCartLine,
  applyPosCoupon,
  cancelPosCart,
  completePosCart,
  createPosCart,
  getPosCart,
  lookupPosBarcode,
  listPosShifts,
  listPosStores,
  listPosTerminals,
  PosApiError,
  removePosCartLine,
  removePosCoupon,
  searchPosCustomers,
  searchPosProducts,
  setPosCartCustomer,
  setPosCartDiscount,
  updatePosCartLineQuantity,
  type PosCustomerMatch,
  type PosProductMatch,
} from "@/features/pos/shared/pos-api";
import { money } from "@/features/pos/shared/format";

// A single `cart` state variable is deliberately NOT a TanStack Query
// cache entry: every mutation (add line, change quantity, apply coupon,
// ...) returns the ENTIRE freshly-repriced cart as its response, so the
// simplest and most correct source of truth is "the last server response
// we received," updated imperatively after each call — not an
// invalidate-and-refetch cycle that would introduce a race between the
// optimistic UI and the server's own authoritative recompute.
export function PosCheckoutScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const canDiscount = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.discountApply);

  const [cart, setCart] = useState<PosCart | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<PosCustomerMatch | null>(null);
  const [customerSearchInput, setCustomerSearchInput] = useState("");
  const [debouncedCustomerSearch, setDebouncedCustomerSearch] = useState("");
  const [cartDiscountValue, setCartDiscountValue] = useState(0);
  const [cartDiscountReason, setCartDiscountReason] = useState("");
  const [cashTendered, setCashTendered] = useState(0);
  const [completing, setCompleting] = useState(false);
  const [confirmation, setConfirmation] = useState<{ receiptNumber: string; grandTotal: string; changeTotal: string } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const storesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "stores"), queryFn: listPosStores });
  const terminalsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "terminals"), queryFn: listPosTerminals });
  const shiftsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "shifts"), queryFn: () => listPosShifts() });
  void terminalsQuery;

  const myOpenShift = useMemo(
    () =>
      shiftsQuery.data?.rows.find(
        (row) => (row as { status: string; cashier_user_id?: string }).status === "open" && (row as { cashier_user_id?: string }).cashier_user_id === workspace.userId,
      ) as { id: string; store_id: string; terminal_id: string } | undefined,
    [shiftsQuery.data, workspace.userId],
  );
  const store = storesQuery.data?.rows.find((s) => s.id === myOpenShift?.store_id);

  useEffect(() => {
    if (!myOpenShift || cart) return;
    let cancelled = false;
    createPosCart({ storeId: myOpenShift.store_id, terminalId: myOpenShift.terminal_id, shiftId: myOpenShift.id })
      .then((result) => !cancelled && setCart(result.cart))
      .catch((err) => !cancelled && setError(err instanceof PosApiError ? err.message : "The cart could not be started."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myOpenShift?.id]);

  const searchQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "search", store?.id, searchTerm),
    queryFn: () => searchPosProducts(store!.id, searchTerm),
    enabled: Boolean(store?.id && searchTerm.trim().length > 0),
  });

  // F276: debounce the customer search-as-you-type so every keystroke
  // doesn't fire a request — 250ms of no typing before the query updates.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedCustomerSearch(customerSearchInput), 250);
    return () => clearTimeout(handle);
  }, [customerSearchInput]);

  const customerSearchQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "customer-search", debouncedCustomerSearch),
    queryFn: ({ signal }) => searchPosCustomers(debouncedCustomerSearch, { signal }),
    enabled: debouncedCustomerSearch.trim().length > 0,
  });
  const customerOptions = (customerSearchQuery.data?.rows ?? []).map((customer) => ({
    value: customer.id,
    label: customer.phone || customer.email ? `${customer.displayName} · ${customer.phone || customer.email}` : customer.displayName,
  }));

  async function run(action: () => Promise<{ cart: PosCart }>) {
    setLoading(true);
    try {
      const result = await action();
      setCart(result.cart);
      setError(null);
      setConflict(null);
    } catch (err) {
      if (err instanceof PosApiError && (err.code === "POS_CART_VERSION_CONFLICT" || err.code === "POS_PRICE_CONFLICT")) {
        setConflict(err.message);
        if (cart) getPosCart(cart.id).then((result) => setCart(result.cart));
      } else {
        setError(err instanceof PosApiError ? err.message : "The action could not be completed.");
      }
    } finally {
      setLoading(false);
    }
  }

  const addLine = (itemId: string, variantId: string | null) => cart && run(() => addPosCartLine(cart.id, { itemId, variantId, quantity: 1 }));

  function scanBarcode() {
    if (!barcodeInput.trim() || !store?.id) return;
    lookupPosBarcode(store.id, barcodeInput.trim())
      .then((product: PosProductMatch) => {
        setBarcodeInput("");
        addLine(product.itemId, product.variantId);
      })
      .catch((err) => setError(err instanceof PosApiError ? err.message : "No product matches this barcode."));
  }

  const changeQuantity = (lineId: string, quantity: number) =>
    cart && run(() => (quantity <= 0 ? removePosCartLine(cart.id, lineId, cart.version) : updatePosCartLineQuantity(cart.id, lineId, quantity, cart.version)));

  const applyCoupon = () => cart && couponCode.trim() && run(() => applyPosCoupon(cart.id, couponCode.trim(), cart.version));
  const removeCoupon = () => cart && run(() => removePosCoupon(cart.id, cart.version));
  const applyCartDiscount = () =>
    cart &&
    cartDiscountValue > 0 &&
    cartDiscountReason.trim() &&
    run(() => setPosCartDiscount(cart.id, { type: "percent", value: cartDiscountValue, reason: cartDiscountReason, expectedVersion: cart.version }));
  function selectCustomer(customer: PosCustomerMatch | null) {
    if (!cart) return;
    setSelectedCustomer(customer);
    setCustomerSearchInput("");
    setDebouncedCustomerSearch("");
    run(() => setPosCartCustomer(cart.id, customer?.id ?? null, cart.version));
  }

  async function completeSale() {
    if (!cart) return;
    setCompleting(true);
    try {
      const result = await completePosCart(cart.id, {
        payments: [{ method: "cash", amount: cashTendered }],
        idempotencyKey,
        expectedVersion: cart.version,
        expectedGrandTotal: cart.grand_total,
      });
      const sale = result.sale as { receipt_number: string; grand_total: string; change_total: string };
      setConfirmation({ receiptNumber: sale.receipt_number, grandTotal: sale.grand_total, changeTotal: sale.change_total });
      setError(null);
    } catch (err) {
      if (err instanceof PosApiError && (err.code === "POS_CART_VERSION_CONFLICT" || err.code === "POS_PRICE_CONFLICT")) {
        setConflict(err.message);
        getPosCart(cart.id).then((result) => setCart(result.cart));
      } else {
        setError(err instanceof PosApiError ? err.message : "The sale could not be completed.");
      }
    } finally {
      setCompleting(false);
    }
  }

  function startNewSale() {
    setConfirmation(null);
    setCashTendered(0);
    setSelectedCustomer(null);
    setCustomerSearchInput("");
    setDebouncedCustomerSearch("");
    setCouponCode("");
    setIdempotencyKey(crypto.randomUUID());
    setCart(null);
  }

  if (!myOpenShift) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
        <p className="text-sm text-text-secondary">No open shift found. Open a shift before starting checkout.</p>
        <Button variant="primary" onPress={() => router.push("/pos")}>
          Go to Point of Sale
        </Button>
      </div>
    );
  }

  if (confirmation) {
    const currency = store?.currencyCode ?? store?.currency_code ?? "";
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
        <StatusBadge tone="success">Sale complete</StatusBadge>
        <h1 className="text-2xl font-semibold text-text">Receipt {confirmation.receiptNumber}</h1>
        <p className="text-lg text-text">Total: {money(currency, confirmation.grandTotal)}</p>
        <p className="text-lg text-text">Change due: {money(currency, confirmation.changeTotal)}</p>
        <Button variant="primary" onPress={startNewSale}>
          New sale
        </Button>
      </div>
    );
  }

  const currency = store?.currencyCode ?? store?.currency_code ?? "";

  return (
    <div className="flex h-full flex-col gap-4 p-4 lg:flex-row">
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <SearchField label="Search products" placeholder="Search by name, code, barcode…" value={searchTerm} onChange={setSearchTerm} className="flex-1" />
          <div className="flex items-end gap-2">
            <TextField label="Scan / enter barcode" value={barcodeInput} onChange={setBarcodeInput} onKeyDown={(event) => event.key === "Enter" && scanBarcode()} />
            <Button variant="secondary" onPress={scanBarcode}>
              Add
            </Button>
          </div>
        </div>

        {searchTerm.trim() && (
          <div className="max-h-48 overflow-y-auto rounded-[var(--radius-panel)] border border-border-strong">
            {(searchQuery.data?.rows ?? []).map((product) => (
              <button
                key={`${product.itemId}-${product.variantId ?? ""}`}
                type="button"
                onClick={() => addLine(product.itemId, product.variantId)}
                className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-surface-muted"
              >
                <span>
                  {product.name} <span className="text-text-muted">({product.code})</span>
                </span>
                <span className="tabular-nums">
                  {money(currency, product.salesPrice)} · {product.availableQuantity} avail.
                </span>
              </button>
            ))}
            {searchQuery.isFetched && !(searchQuery.data?.rows ?? []).length && <p className="px-3 py-2 text-sm text-text-muted">No matches.</p>}
          </div>
        )}

        <div className="flex-1 overflow-y-auto rounded-[var(--radius-panel)] border border-border-strong">
          {!cart?.lines?.length ? (
            <p className="p-6 text-center text-sm text-text-muted">{loading ? "Loading…" : "Cart is empty — search or scan a product to begin."}</p>
          ) : (
            cart.lines.map((line) => (
              <div key={line.id} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-0">
                <div className="flex-1">
                  <p className="text-sm font-medium text-text">{line.description}</p>
                  <p className="text-xs text-text-muted">
                    {money(currency, line.unit_price)} each
                    {Number(line.manual_discount_amount) > 0 && <> · manual −{money(currency, line.manual_discount_amount)}</>}
                    {Number(line.promotion_discount_amount) > 0 && <> · promo −{money(currency, line.promotion_discount_amount)}</>}
                    {Number(line.coupon_discount_amount) > 0 && <> · coupon −{money(currency, line.coupon_discount_amount)}</>}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="compact" onPress={() => changeQuantity(line.id, Number(line.quantity) - 1)} aria-label="Decrease quantity">
                    <Minus className="size-3.5" aria-hidden="true" />
                  </Button>
                  <span className="w-8 text-center tabular-nums">{Number(line.quantity)}</span>
                  <Button variant="outline" size="compact" onPress={() => changeQuantity(line.id, Number(line.quantity) + 1)} aria-label="Increase quantity">
                    <Plus className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
                <span className="w-24 text-right tabular-nums">{money(currency, line.line_total)}</span>
                <Button variant="ghost" size="compact" onPress={() => cart && run(() => removePosCartLine(cart.id, line.id, cart.version))} aria-label="Remove line">
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex w-full flex-col gap-4 lg:w-96">
        {error && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        {conflict && (
          <p role="alert" className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm text-warning">
            <span>{conflict} — the cart was refreshed with current server totals.</span>
            <button type="button" onClick={() => setConflict(null)} aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </p>
        )}

        {selectedCustomer ? (
          <div className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2">
            <div>
              <p className="text-sm font-medium text-text">{selectedCustomer.displayName}</p>
              {(selectedCustomer.phone || selectedCustomer.email) && (
                <p className="text-xs text-text-muted">{selectedCustomer.phone || selectedCustomer.email}</p>
              )}
            </div>
            <Button variant="ghost" size="compact" onPress={() => selectCustomer(null)} aria-label="Clear selected customer">
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <ComboBox
            label="Customer (blank = walk-in)"
            placeholder="Search by name, code or phone…"
            inputValue={customerSearchInput}
            onInputChange={setCustomerSearchInput}
            options={customerOptions}
            isLoading={customerSearchQuery.isFetching}
            emptyMessage={debouncedCustomerSearch.trim() ? "No matching customers" : "Type to search customers"}
            allowsEmptyCollection
            onSelectionChange={(key) => {
              if (key == null) return;
              const match = customerSearchQuery.data?.rows.find((row) => row.id === key);
              if (match) selectCustomer(match);
            }}
          />
        )}

        <div className="flex items-end gap-2">
          <TextField label="Coupon code" value={couponCode} onChange={setCouponCode} className="flex-1" />
          {cart?.coupon_code ? (
            <Button variant="secondary" onPress={removeCoupon}>
              Remove
            </Button>
          ) : (
            <Button variant="secondary" onPress={applyCoupon}>
              Apply
            </Button>
          )}
        </div>

        {canDiscount && (
          <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border-strong p-3">
            <p className="text-sm font-medium text-text">Cart discount (%)</p>
            <NumberField label="Percent off" value={cartDiscountValue} onChange={setCartDiscountValue} minValue={0} maxValue={100} />
            <TextField label="Reason" value={cartDiscountReason} onChange={setCartDiscountReason} />
            <Button variant="secondary" onPress={applyCartDiscount}>
              Apply cart discount
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-1 rounded-[var(--radius-panel)] border border-border-strong bg-surface p-4 text-sm">
          <Row label="Subtotal" value={money(currency, cart?.subtotal)} />
          <Row label="Discounts" value={`−${money(currency, cart?.discount_total)}`} />
          <Row label="Tax" value={money(currency, cart?.tax_total)} />
          <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-base font-semibold text-text">
            <span>Total</span>
            <span className="tabular-nums">{money(currency, cart?.grand_total)}</span>
          </div>
        </div>

        <NumberField label="Cash tendered" value={cashTendered} onChange={setCashTendered} minValue={0} step={0.01} />
        <p className="text-sm text-text-secondary">Change: {money(currency, Math.max(0, cashTendered - Number(cart?.grand_total ?? 0)))}</p>

        <Button
          variant="primary"
          onPress={completeSale}
          isDisabled={!cart?.lines?.length || cashTendered < Number(cart?.grand_total ?? 0)}
          isLoading={completing}
        >
          Complete cash sale
        </Button>
        <Button variant="ghost" onPress={() => cart && run(() => cancelPosCart(cart.id).then((r) => ({ cart: r.cart })))}>
          Cancel sale
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-text-secondary">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

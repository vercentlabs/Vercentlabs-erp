"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus, Trash2, X } from "lucide-react";
import { Button, NumberField, SearchField, Select, StatusBadge, TextField } from "@vercentlabs/design-system";
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
  getPosPayment,
  initiatePosPayment,
  lookupPosBarcode,
  listPosShifts,
  listPosStores,
  listPosTerminals,
  PosApiError,
  removePosCartLine,
  removePosCoupon,
  searchPosProducts,
  setPosCartCustomer,
  setPosCartDiscount,
  updatePosCartLineQuantity,
  type PosPaymentLeg,
  type PosProductMatch,
} from "@/features/pos/shared/pos-api";
import { money } from "@/features/pos/shared/format";

// F283 (card) / F284 (UPI/digital) / F285 (split tender) / F286 (multiple
// payment methods): one tender line per payment leg. A 'cash' line is
// final the moment its amount is entered (unchanged from before -- a
// physical exchange). Any other method must be independently "charged"
// (initiatePosPayment) and reach a server-confirmed 'captured' status
// before Complete Sale will accept it -- there is no client-side "mark as
// paid."
type TenderMethod = "cash" | "card" | "upi" | "wallet" | "bank_transfer";
type TenderLine = {
  id: string;
  method: TenderMethod;
  amount: number;
  paymentId?: string;
  status?: string;
  error?: string;
  charging?: boolean;
};
const NON_CASH_METHOD_OPTIONS = [
  { value: "card" as const, label: "Card" },
  { value: "upi" as const, label: "UPI" },
  { value: "wallet" as const, label: "Wallet" },
  { value: "bank_transfer" as const, label: "Bank transfer" },
];
// This environment has no live merchant/gateway credentials -- only the
// deterministic sandbox adapter is registered (see
// services/api/src/modules/point-of-sale/payments/sandbox-adapter.js).
// This selector is a SANDBOX TEST-SCRIPTING INSTRUCTION only: it is never
// read as a truth claim about payment state, and a real adapter would
// ignore it entirely.
const SANDBOX_OUTCOME_OPTIONS = [
  { value: "immediate_success" as const, label: "Simulate: succeeds immediately" },
  { value: "immediate_decline" as const, label: "Simulate: declines immediately" },
];

function newTenderLineId() {
  return crypto.randomUUID();
}

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
  const [customerId, setCustomerId] = useState("");
  const [cartDiscountValue, setCartDiscountValue] = useState(0);
  const [cartDiscountReason, setCartDiscountReason] = useState("");
  const [tenderLines, setTenderLines] = useState<TenderLine[]>([{ id: newTenderLineId(), method: "cash", amount: 0 }]);
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

  // Poll a non-cash leg while its outcome is still pending/authorized --
  // there is no client-side "it succeeded," only what the server reports
  // (an adapter's own synchronous response already resolved the sandbox
  // outcomes this UI offers, but polling is what a real async provider's
  // webhook-driven capture would need).
  useEffect(() => {
    const pendingLines = tenderLines.filter((line) => line.paymentId && (line.status === "pending" || line.status === "authorized" || line.status === "initiated"));
    if (!pendingLines.length) return;
    const timer = setInterval(() => {
      pendingLines.forEach((line) => {
        getPosPayment(line.paymentId!)
          .then((result) => {
            setTenderLines((lines) => lines.map((l) => (l.id === line.id ? { ...l, status: result.payment.status, error: result.payment.failure_reason || undefined } : l)));
          })
          .catch(() => undefined);
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [tenderLines]);

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
  const applyCustomer = () => cart && run(() => setPosCartCustomer(cart.id, customerId.trim() || null, cart.version));

  // F283/F284/F285/F286 tender-line helpers.
  const tenderTotal = tenderLines.reduce((sum, line) => sum + (Number.isFinite(line.amount) ? line.amount : 0), 0);
  const grandTotalNumber = Number(cart?.grand_total ?? 0);
  const remainingToAllocate = Math.round((grandTotalNumber - tenderTotal) * 100) / 100;
  const isSingleCashTender = tenderLines.length === 1 && tenderLines[0].method === "cash";
  const allNonCashCaptured = tenderLines.every((line) => line.method === "cash" || line.status === "captured");
  const canComplete =
    Boolean(cart?.lines?.length) &&
    tenderLines.every((line) => line.amount > 0) &&
    allNonCashCaptured &&
    (isSingleCashTender ? tenderTotal >= grandTotalNumber : remainingToAllocate === 0);

  function updateTenderLine(id: string, patch: Partial<TenderLine>) {
    setTenderLines((lines) => lines.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }
  function addTenderLine() {
    setTenderLines((lines) => [...lines, { id: newTenderLineId(), method: "card", amount: Math.max(0, remainingToAllocate) }]);
  }
  function removeTenderLine(id: string) {
    setTenderLines((lines) => (lines.length > 1 ? lines.filter((line) => line.id !== id) : lines));
  }
  const [tenderOutcome, setTenderOutcome] = useState<Record<string, string>>({});

  async function chargeTenderLine(line: TenderLine) {
    if (!cart || line.method === "cash" || line.amount <= 0) return;
    updateTenderLine(line.id, { charging: true, error: undefined });
    try {
      const result = await initiatePosPayment({
        cartId: cart.id,
        method: line.method,
        amount: line.amount,
        idempotencyKey: line.id,
        outcome: tenderOutcome[line.id] || "immediate_success",
      });
      updateTenderLine(line.id, { paymentId: result.payment.id, status: result.payment.status, charging: false, error: result.payment.failure_reason || undefined });
    } catch (err) {
      updateTenderLine(line.id, { charging: false, error: err instanceof PosApiError ? err.message : "The payment could not be started." });
    }
  }

  async function completeSale() {
    if (!cart) return;
    setCompleting(true);
    try {
      const payments: PosPaymentLeg[] = tenderLines.map((line) =>
        line.method === "cash" ? { method: "cash", amount: line.amount } : { method: line.method, paymentId: line.paymentId! },
      );
      const result = await completePosCart(cart.id, {
        payments,
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
    setTenderLines([{ id: newTenderLineId(), method: "cash", amount: 0 }]);
    setTenderOutcome({});
    setCustomerId("");
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

        <div className="flex items-end gap-2">
          <TextField label="Customer ID (blank = walk-in)" value={customerId} onChange={setCustomerId} className="flex-1" />
          <Button variant="secondary" onPress={applyCustomer}>
            Set
          </Button>
        </div>

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

        <div className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border-strong p-3">
          <p className="text-sm font-medium text-text">Tender</p>
          {tenderLines.map((line) => (
            <div key={line.id} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-2">
              <div className="flex items-end gap-2">
                {line.method === "cash" ? (
                  <span className="flex-1 text-sm font-medium text-text">Cash</span>
                ) : (
                  <Select
                    label="Method"
                    className="flex-1"
                    options={NON_CASH_METHOD_OPTIONS}
                    selectedKey={line.method}
                    onSelectionChange={(key) => updateTenderLine(line.id, { method: key as TenderMethod })}
                    isDisabled={Boolean(line.paymentId)}
                  />
                )}
                <NumberField
                  label="Amount"
                  value={line.amount}
                  onChange={(value) => updateTenderLine(line.id, { amount: value })}
                  minValue={0}
                  step={0.01}
                  isDisabled={Boolean(line.paymentId)}
                  className="w-32"
                />
                {tenderLines.length > 1 && !line.paymentId && (
                  <Button variant="ghost" size="compact" onPress={() => removeTenderLine(line.id)} aria-label="Remove tender line">
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                )}
              </div>
              {line.method !== "cash" && (
                <div className="flex items-center gap-2">
                  {!line.paymentId && (
                    <Select
                      label="Sandbox outcome"
                      className="flex-1"
                      options={SANDBOX_OUTCOME_OPTIONS}
                      selectedKey={(tenderOutcome[line.id] || "immediate_success") as (typeof SANDBOX_OUTCOME_OPTIONS)[number]["value"]}
                      onSelectionChange={(key) => setTenderOutcome((prev) => ({ ...prev, [line.id]: String(key) }))}
                    />
                  )}
                  {!line.paymentId ? (
                    <Button variant="secondary" onPress={() => chargeTenderLine(line)} isLoading={line.charging} isDisabled={line.amount <= 0}>
                      Charge {line.method}
                    </Button>
                  ) : (
                    <StatusBadge tone={line.status === "captured" ? "success" : line.status === "failed" ? "danger" : "warning"}>
                      {line.status === "captured" ? "Captured" : line.status === "failed" ? "Declined" : "Processing…"}
                    </StatusBadge>
                  )}
                </div>
              )}
              {line.error && <p className="text-xs text-danger">{line.error}</p>}
            </div>
          ))}
          <Button variant="ghost" size="compact" onPress={addTenderLine}>
            + Add tender line (split payment)
          </Button>
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">Remaining to allocate</span>
            <span className={`tabular-nums font-medium ${remainingToAllocate === 0 ? "text-success" : "text-text"}`}>{money(currency, remainingToAllocate)}</span>
          </div>
          {isSingleCashTender && (
            <p className="text-sm text-text-secondary">Change: {money(currency, Math.max(0, tenderTotal - grandTotalNumber))}</p>
          )}
        </div>

        <Button variant="primary" onPress={completeSale} isDisabled={!canComplete} isLoading={completing}>
          Complete sale
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

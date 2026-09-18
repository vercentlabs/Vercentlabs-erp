"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Pause, Plus, Trash2, X } from "lucide-react";
import { Button, ComboBox, Dialog, NumberField, SearchField, Select, StatusBadge, TextField } from "@vercentlabs/design-system";
import type { PosCart } from "@vercentlabs/api";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { listPosShifts } from "@/features/pos/overview/api/overview-api";
import { listPosStores } from "@/features/pos/stores/api/stores-api";
import { listPosTerminals } from "@/features/pos/terminals/api/terminals-api";
import {
  addPosCartLine,
  applyPosCoupon,
  cancelPosCart,
  completePosCart,
  completePosExchange,
  createPosCart,
  getPosCart,
  holdPosCart,
  listHeldPosCarts,
  getPosPayment,
  initiatePosPayment,
  lookupPosBarcode,
  removePosCartLine,
  removePosCoupon,
  resumePosCart,
  searchPosCustomers,
  searchPosProducts,
  setPosCartCustomer,
  setPosCartDiscount,
  setPosCartLineTracking,
  updatePosCartLineQuantity,
  type PosCustomerMatch,
  type PosPaymentLeg,
  type PosProductMatch,
} from "@/features/pos/checkout/api/checkout-api";
import { money } from "@/features/pos/shared/format";
import { getPosOfflineSnapshot } from "@/features/pos/offline/api/offline-api";
import { OfflineCheckoutPanel } from "@/features/pos/offline/OfflineCheckoutPanel";
import { useOnlineStatus } from "@/features/pos/offline/useOnlineStatus";
import { saveOfflineContext, saveSnapshot } from "@/features/pos/offline/db";
import { runOfflineSyncPass } from "@/features/pos/offline/sync-runner";
import {
  getPosCustomerLoyaltyBalance,
  redeemPosCartLoyaltyPoints,
  removePosCartLoyaltyRedemption,
} from "@/features/pos/loyalty/api/loyalty-api";

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
// services/api/src/modules/point-of-sale/tender-and-payment-execution/sandbox-adapter.js).
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
  const searchParams = useSearchParams();
  // F293: arriving here from the Returns screen's "Exchange" action --
  // build a normal cart with the replacement item(s), then completing it
  // finishes BOTH the return and this sale as one linked exchange
  // (completePosExchange) instead of an ordinary sale.
  const exchangeReturnId = searchParams.get("exchangeReturnId");
  const canDiscount = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.discountApply);
  const canRedeemLoyalty = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.loyaltyRedeem);
  const online = useOnlineStatus();

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
  const [redeemPointsInput, setRedeemPointsInput] = useState(0);
  const [tenderLines, setTenderLines] = useState<TenderLine[]>([{ id: newTenderLineId(), method: "cash", amount: 0 }]);
  const [completing, setCompleting] = useState(false);
  const [confirmation, setConfirmation] = useState<{ saleId: string; receiptNumber: string; grandTotal: string; changeTotal: string } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [heldCartsOpen, setHeldCartsOpen] = useState(false);
  // F295 -- one free-text input per tracked cart line, keyed by line id,
  // for the serial/batch number the cashier scans or types before the
  // sale can complete. Not committed until "Set" is pressed (setPosCartLineTracking).
  const [trackingInputs, setTrackingInputs] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();

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

  // F297: while online with an open shift, keep this device's bounded
  // offline snapshot + context fresh so the offline checkout path below
  // never depends on any online-only query succeeding once the network
  // actually drops. "Periodically" here is "every time this effect's
  // dependencies change" (store/shift changing, or a fresh mount) --
  // sufficient for a real cashier session without a separate polling
  // timer.
  useEffect(() => {
    if (!online || !myOpenShift || !store) return;
    let cancelled = false;
    getPosOfflineSnapshot(store.id)
      .then(async (result) => {
        if (cancelled) return;
        await saveSnapshot(result.snapshot);
        await saveOfflineContext({
          storeId: store.id,
          terminalId: myOpenShift.terminal_id,
          shiftId: myOpenShift.id,
          cashierUserId: workspace.userId,
        });
      })
      .catch(() => undefined); // best-effort refresh; a stale-but-present snapshot is still usable offline
    return () => {
      cancelled = true;
    };
    // Only the identifying fields, not full object reference equality,
    // should retrigger this refresh -- same rationale as the cart-creation
    // effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, myOpenShift?.id, myOpenShift?.terminal_id, store?.id, workspace.userId]);

  // F298: as soon as the device comes back online, drain the local
  // offline queue automatically rather than waiting for the cashier to
  // notice and click something.
  useEffect(() => {
    if (!online) return;
    runOfflineSyncPass().catch(() => undefined);
  }, [online]);

  // BUG FIX (found via real E2E testing, apps/web/e2e/pos-checkout.spec.ts
  // et al, under the app's actual next.config.ts reactStrictMode: true):
  // React 18/19 dev-mode StrictMode deliberately mounts, unmounts, then
  // remounts every component once, double-invoking effects to surface
  // exactly this class of bug. The `cancelled` flag here only ever guarded
  // the STATE UPDATE, not the createPosCart(...) network call itself -- so
  // StrictMode's double-invoke fired two REAL POST /api/pos/carts requests
  // for the same shift, creating two live draft carts on the same
  // terminal. Whichever response happened to resolve first won the race
  // to become `cart` in state; the other became an orphaned draft cart in
  // the database, invisible to the UI -- and under real load (many
  // requests in flight), that race could resolve either way. This ref
  // guard, keyed by shift id, ensures createPosCart is only ever actually
  // dispatched once per shift, independent of how many times StrictMode
  // (re)invokes this effect for the same shift.
  const cartCreationStartedForShiftIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!myOpenShift || cart) return;
    if (cartCreationStartedForShiftIdRef.current === myOpenShift.id) return;
    cartCreationStartedForShiftIdRef.current = myOpenShift.id;
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

  // F306: real points balance for the cart's customer, used both to gate
  // redemption (can't redeem more than is on the ledger) and to show the
  // balance/earn preview the cashier and customer both see before completion.
  const loyaltyBalanceQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "loyalty", "balance", cart?.customer_id),
    queryFn: () => getPosCustomerLoyaltyBalance(cart!.customer_id!),
    enabled: Boolean(cart?.customer_id),
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

  // F295 -- commit the scanned/typed serial or batch number onto a tracked
  // cart line. Which field (batchId vs serialId) depends on the line's own
  // tracking_type, surfaced by the server (cart-pricing.js/cart.js).
  function setLineTracking(lineId: string, trackingType: "batch" | "serial") {
    if (!cart) return;
    const value = trackingInputs[lineId]?.trim();
    if (!value) return;
    run(() => setPosCartLineTracking(cart.id, lineId, trackingType === "serial" ? { serialId: value, expectedVersion: cart.version } : { batchId: value, expectedVersion: cart.version }));
  }

  const applyCoupon = () => cart && couponCode.trim() && run(() => applyPosCoupon(cart.id, couponCode.trim(), cart.version));
  const removeCoupon = () => cart && run(() => removePosCoupon(cart.id, cart.version));
  async function redeemLoyalty() {
    if (!cart || redeemPointsInput <= 0) return;
    await run(() => redeemPosCartLoyaltyPoints(cart.id, redeemPointsInput, cart.version));
    setRedeemPointsInput(0);
  }
  const removeLoyaltyRedemption = () => cart && run(() => removePosCartLoyaltyRedemption(cart.id, cart.version));
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

  // F287: hold releases this terminal's active-cart slot (the checkout
  // effect above re-creates/resumes a cart on this terminal the next time
  // it mounts with nothing else active), so a cashier can start a new sale
  // immediately after holding this one.
  async function holdCurrentCart() {
    if (!cart) return;
    setLoading(true);
    try {
      await holdPosCart(cart.id, cart.version);
      setError(null);
      setCart(null);
      setSelectedCustomer(null);
      setCouponCode("");
      setIdempotencyKey(crypto.randomUUID());
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "held-carts") });
      await startFreshCart();
    } catch (err) {
      setError(err instanceof PosApiError ? err.message : "The sale could not be held.");
    } finally {
      setLoading(false);
    }
  }

  // F288: resuming while a different cart is already active on this
  // terminal is rejected server-side (POS_TERMINAL_CART_CONFLICT) -- the
  // cashier must hold or complete that one first, surfaced as an ordinary
  // error rather than silently overwriting anything.
  async function resumeHeldCart(heldCartId: string) {
    setLoading(true);
    try {
      const result = await resumePosCart(heldCartId);
      setCart(result.cart);
      setSelectedCustomer(null);
      setError(null);
      setHeldCartsOpen(false);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "held-carts") });
    } catch (err) {
      setError(err instanceof PosApiError ? err.message : "This held sale could not be resumed.");
    } finally {
      setLoading(false);
    }
  }

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
      // completePosExchange's contract only accepts cash legs (see
      // pos-api.ts) -- the tender UI already hides "add tender line" while
      // exchangeReturnId is set, so this filter is a belt-and-suspenders
      // guarantee against ever sending a non-cash leg to that endpoint.
      const result = exchangeReturnId
        ? await completePosExchange(exchangeReturnId, {
            cartId: cart.id,
            payments: payments.filter((p): p is { method: "cash"; amount: number } => p.method === "cash"),
            idempotencyKey,
            expectedVersion: cart.version,
            expectedGrandTotal: cart.grand_total,
          })
        : await completePosCart(cart.id, {
            payments,
            idempotencyKey,
            expectedVersion: cart.version,
            expectedGrandTotal: cart.grand_total,
          });
      const sale = result.sale as { id: string; receipt_number: string; grand_total: string; change_total: string };
      setConfirmation({ saleId: sale.id, receiptNumber: sale.receipt_number, grandTotal: sale.grand_total, changeTotal: sale.change_total });
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

  // Extracted because the mount effect above only fires on myOpenShift.id
  // changing, not on `cart` becoming null again -- without this, both
  // "New sale" and "Hold sale" would clear the cart and then leave the
  // screen with nothing to add lines to until a full page reload (a
  // pre-existing gap in "New sale" this pass also fixes while adding
  // hold's identical need for it).
  async function startFreshCart() {
    if (!myOpenShift) return;
    try {
      const result = await createPosCart({ storeId: myOpenShift.store_id, terminalId: myOpenShift.terminal_id, shiftId: myOpenShift.id });
      setCart(result.cart);
    } catch (err) {
      setError(err instanceof PosApiError ? err.message : "The cart could not be started.");
    }
  }

  function startNewSale() {
    setConfirmation(null);
    setTenderLines([{ id: newTenderLineId(), method: "cash", amount: 0 }]);
    setTenderOutcome({});
    setSelectedCustomer(null);
    setCustomerSearchInput("");
    setDebouncedCustomerSearch("");
    setCouponCode("");
    setIdempotencyKey(crypto.randomUUID());
    setCart(null);
    startFreshCart();
  }

  // F297: the offline checkout path is fully independent of the online
  // queries above (it reads its own cached context/snapshot from
  // IndexedDB) -- checked before the "no open shift" guard below, which
  // depends on an online-only query that would just be stale/empty
  // offline rather than a meaningful signal.
  if (!online) {
    return <OfflineCheckoutPanel />;
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
        <div className="flex gap-2">
          <Button variant="secondary" onPress={() => router.push(`/pos/receipts/${confirmation.saleId}?original=1`)}>
            View / print receipt
          </Button>
          <Button variant="primary" onPress={startNewSale}>
            New sale
          </Button>
        </div>
      </div>
    );
  }

  const currency = store?.currencyCode ?? store?.currency_code ?? "";

  return (
    <div className="flex h-full flex-col gap-4 p-4 lg:flex-row">
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-text">Checkout</h1>
          <Button variant="secondary" size="compact" onPress={() => setHeldCartsOpen(true)}>
            <Pause className="size-4" aria-hidden="true" />
            Held sales
          </Button>
        </div>
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
            cart.lines.map((line) => {
              // F295 -- requires a serial/batch to be set before this line
              // can actually be sold (enforced authoritatively at checkout
              // by Stock's postStockMovement); this is only the UI nudge to
              // capture it earlier, at the counter, rather than let the
              // cashier discover the requirement from a failed checkout.
              const needsSerial = line.tracking_type === "serial" && !line.serial_id;
              const needsBatch = line.tracking_type === "batch" && !line.batch_id;
              return (
                <div key={line.id} className="flex flex-col gap-1.5 border-b border-border px-3 py-2 last:border-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-text">{line.description}</p>
                      <p className="text-xs text-text-muted">
                        {money(currency, line.unit_price)} each
                        {Number(line.manual_discount_amount) > 0 && <> · manual −{money(currency, line.manual_discount_amount)}</>}
                        {Number(line.promotion_discount_amount) > 0 && <> · promo −{money(currency, line.promotion_discount_amount)}</>}
                        {Number(line.coupon_discount_amount) > 0 && <> · coupon −{money(currency, line.coupon_discount_amount)}</>}
                        {line.serial_id && <> · serial set</>}
                        {line.batch_id && <> · batch set</>}
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
                  {(needsSerial || needsBatch) && (
                    <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-2 py-1.5">
                      <TextField
                        label={needsSerial ? "Serial number required" : "Batch required"}
                        placeholder={needsSerial ? "Scan or enter serial" : "Scan or enter batch"}
                        value={trackingInputs[line.id] ?? ""}
                        onChange={(value) => setTrackingInputs((prev) => ({ ...prev, [line.id]: value }))}
                        className="flex-1"
                      />
                      <Button variant="secondary" size="compact" onPress={() => setLineTracking(line.id, needsSerial ? "serial" : "batch")}>
                        Set
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="flex w-full flex-col gap-4 lg:w-96">
        <StatusBadge tone="success" className="self-start">
          Online
        </StatusBadge>
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

        {cart?.customer_id && (
          <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border-strong p-3">
            <p className="text-sm font-medium text-text">Loyalty points</p>
            {loyaltyBalanceQuery.data && (
              <p className="text-sm text-text-secondary">
                Balance: <span className="tabular-nums">{loyaltyBalanceQuery.data.balance.balance}</span> pts
                {cart.loyalty?.pointsToEarn && Number(cart.loyalty.pointsToEarn) > 0 && (
                  <> · will earn <span className="tabular-nums">{cart.loyalty.pointsToEarn}</span> pts on completion</>
                )}
              </p>
            )}
            {canRedeemLoyalty &&
              (Number(cart.loyalty_redeem_points ?? 0) > 0 ? (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-text-secondary">
                    Redeeming <span className="tabular-nums">{cart.loyalty_redeem_points}</span> pts
                    {cart.loyalty?.redeemAmount && <> (−{money(currency, cart.loyalty.redeemAmount)})</>}
                  </p>
                  <Button variant="secondary" onPress={removeLoyaltyRedemption}>
                    Remove
                  </Button>
                </div>
              ) : (
                <div className="flex items-end gap-2">
                  <NumberField label="Points to redeem" value={redeemPointsInput} onChange={setRedeemPointsInput} minValue={0} step={1} className="flex-1" />
                  <Button variant="secondary" onPress={redeemLoyalty} isDisabled={redeemPointsInput <= 0}>
                    Redeem
                  </Button>
                </div>
              ))}
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

        {exchangeReturnId && (
          <p className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm text-warning">
            Exchange mode — completing this sale also completes the linked return. Only cash tender is supported for exchanges.
          </p>
        )}

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
          {!exchangeReturnId && (
            <Button variant="ghost" size="compact" onPress={addTenderLine}>
              + Add tender line (split payment)
            </Button>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">Remaining to allocate</span>
            <span className={`tabular-nums font-medium ${remainingToAllocate === 0 ? "text-success" : "text-text"}`}>{money(currency, remainingToAllocate)}</span>
          </div>
          {isSingleCashTender && (
            <p className="text-sm text-text-secondary">Change: {money(currency, Math.max(0, tenderTotal - grandTotalNumber))}</p>
          )}
        </div>

        <Button
          variant="primary"
          onPress={completeSale}
          isDisabled={!canComplete || (cart?.lines ?? []).some((line) => (line.tracking_type === "serial" && !line.serial_id) || (line.tracking_type === "batch" && !line.batch_id))}
          isLoading={completing}
        >
          {exchangeReturnId ? "Complete exchange" : "Complete sale"}
        </Button>
        <Button variant="secondary" onPress={holdCurrentCart} isDisabled={!cart?.lines?.length} isLoading={loading}>
          <Pause className="size-4" aria-hidden="true" />
          Hold sale
        </Button>
        <Button variant="ghost" onPress={() => cart && run(() => cancelPosCart(cart.id).then((r) => ({ cart: r.cart })))}>
          Cancel sale
        </Button>
      </div>

      {heldCartsOpen && <HeldCartsDialog onClose={() => setHeldCartsOpen(false)} onResume={resumeHeldCart} currency={currency} />}
    </div>
  );
}

function HeldCartsDialog({ onClose, onResume, currency }: { onClose: () => void; onResume: (id: string) => void; currency: string }) {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "held-carts", search),
    queryFn: () => listHeldPosCarts(search || undefined),
    refetchInterval: 15000,
  });
  const rows = query.data?.rows ?? [];

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Held sales">
      <div className="flex flex-col gap-3">
        <SearchField label="Search held sales" placeholder="Store, terminal, or customer…" value={search} onChange={setSearch} />
        {query.isLoading ? (
          <p className="p-4 text-center text-sm text-text-secondary">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-center text-sm text-text-muted">No held sales right now.</p>
        ) : (
          <ul className="flex max-h-96 flex-col divide-y divide-border overflow-y-auto rounded-[var(--radius-panel)] border border-border">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-text">
                    {row.customer_name ?? "Walk-in"} · {row.line_count} item{row.line_count === 1 ? "" : "s"}
                  </p>
                  <p className="text-xs text-text-muted">
                    {row.store_name} / {row.terminal_name} · held {new Date(row.held_at).toLocaleTimeString()} · {money(currency, row.grand_total)}
                  </p>
                </div>
                <Button variant="secondary" size="compact" onPress={() => onResume(row.id)}>
                  Resume
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button variant="ghost" onPress={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
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

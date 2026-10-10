"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { BadgePercent, Minus, Pause, Plus, Trash2, X } from "lucide-react";
import {
  Button,
  Dialog,
  IconButton,
  NumberField,
  PageHeader,
  SearchField,
  Select,
  StatusBadge,
  TextArea,
  TextField,
} from "@vercentlabs/design-system";
import type { PosCart } from "@vercentlabs/api";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { listPosShifts } from "@/features/pos/overview/api/overview-api";
import { listPosStores } from "@/features/pos/shared/stores";
import { listPosTerminals } from "@/features/pos/shared/terminals";
import {
  cancelPosCart,
  completePosCart,
  createPosCart,
  getPosCart,
  holdPosCart,
  listHeldPosCarts,
  getPosPayment,
  initiatePosPayment,
  removePosCartLine,
  resumePosCart,
  setPosCartCustomer,
  setPosCartDiscount,
  setPosCartLineTracking,
  updatePosCartLineQuantity,
  applyPosLineDiscount,
  removePosLineDiscount,
  beginPosCheckout,
  releasePosCheckout,
  setPosCartNotes,
  overridePosLinePrice,
  quickCreatePosCustomer,
  type PosCartIssue,
  type PosCustomerMatch,
  type PosPaymentLeg,
} from "@/features/pos/checkout/api/checkout-api";
import { money, statusLabel, statusTone } from "@/features/pos/shared/format";
import { PosAlert, PosLoading, PosPanel } from "@/features/pos/shared/PosUi";
import { PosProductFinder } from "@/features/pos/products/components/PosProductFinder";
import { CustomerPanel } from "@/features/pos/checkout/components/CustomerPanel";
import { DigitalReceipts } from "@/features/pos/checkout/components/DigitalReceipts";
import { approvalNeeded, getApproval, requestApproval, type Approval } from "@/features/pos/permission-profiles/api/profiles-api";

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
  {
    value: "immediate_success" as const,
    label: "Simulate: succeeds immediately",
  },
  {
    value: "immediate_decline" as const,
    label: "Simulate: declines immediately",
  },
];

const LIFECYCLE_LABEL: Record<string, string> = {
  DRAFT: "Open bill", CHECKOUT_PENDING: "In checkout", HELD: "On hold", COMPLETED: "Completed", CANCELLED: "Cancelled", EXPIRED: "Expired",
};

function newTenderLineId() {
  return crypto.randomUUID();
}

// Hydration-safe "has this rendered on the client yet" flag, same
// useSyncExternalStore pattern SecondarySidebarState.tsx already uses for
// an analogous server/client divergence. There's nothing to actually
// subscribe to (mounting only ever happens once), so subscribe is a no-op;
// what matters is getServerSnapshot/getClientSnapshot disagreeing, which is
// exactly the signal React uses to schedule the client-only re-render
// after hydration -- unlike a plain `useEffect(() => setState(true), [])`,
// this never risks a hydration-mismatch warning on the flag itself.
function subscribeNever() {
  return () => {};
}
function getMountedClientSnapshot() {
  return true;
}
function getMountedServerSnapshot() {
  return false;
}

// A single `cart` state variable is deliberately NOT a TanStack Query
// cache entry: every mutation (add line, change quantity, apply discount,
// ...) returns the ENTIRE freshly-repriced cart as its response, so the
// simplest and most correct source of truth is "the last server response
// we received," updated imperatively after each call — not an
// invalidate-and-refetch cycle that would introduce a race between the
// optimistic UI and the server's own authoritative recompute.
export function PosCheckoutScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const canDiscount =
    workspace.roleSlugs.includes("organization_owner") ||
    workspace.permissions.includes(POS_PERMISSIONS.discountApply);
  const canApproveDiscounts =
    workspace.roleSlugs.includes("organization_owner") ||
    workspace.permissions.includes(POS_PERMISSIONS.discountApprove);

  const [cart, setCart] = useState<PosCart | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  // A discount above the cashier's limit: what was asked, and how to apply it once a supervisor approves (Cashier Permissions).
  const [exception, setException] = useState<{
    message: string; permission: string; amount: string | null; percentage: string | null; reason: string; cartVersion: number;
    apply: (approvalId: string) => Promise<{ cart: PosCart }>;
  } | null>(null);
  const [exceptionApproval, setExceptionApproval] = useState<Approval | null>(null);
  const approvalStatus = useQuery({
    queryKey: ["pos-approval", exceptionApproval?.id],
    queryFn: () => getApproval(exceptionApproval!.id),
    enabled: Boolean(exceptionApproval && exceptionApproval.status === "pending"),
    refetchInterval: 5_000,
  });
  const liveApproval = approvalStatus.data ?? exceptionApproval;
  const [cartDiscountOpen, setCartDiscountOpen] = useState(false);
  const [lineDiscountLine, setLineDiscountLine] = useState<
    PosCart["lines"][number] | null
  >(null);
  const [tenderLines, setTenderLines] = useState<TenderLine[]>([
    { id: newTenderLineId(), method: "cash", amount: 0 },
  ]);
  const [completing, setCompleting] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    saleId: string;
    receiptNumber: string;
    grandTotal: string;
    changeTotal: string;
  } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [heldCartsOpen, setHeldCartsOpen] = useState(false);
  // Cart (POS Cart MVP): what checkout found to fix, what changed while a resumed bill was held, and the open dialogs.
  const [checkoutIssues, setCheckoutIssues] = useState<PosCartIssue[]>([]);
  const [resumeChanges, setResumeChanges] = useState<PosCartIssue[]>([]);
  const [holdOpen, setHoldOpen] = useState(false);
  const [priceLine, setPriceLine] = useState<PosCart["lines"][number] | null>(null);
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  // This app has no TanStack Query SSR hydration boundary (no dehydrate/
  // HydrationBoundary anywhere), so shiftsQuery.isLoading is not
  // hydration-safe on its own -- the server never dispatches the fetch at
  // all, while the client starts it immediately, and the two can disagree
  // on the very first paint (a real hydration mismatch, not a fluke).
  // !myOpenShift alone IS hydration-safe (data is undefined on both the
  // server's only pass and the client's pre-hydration pass), so that stays
  // the server-matching branch below; isLoading only takes over a tick
  // later, once hasMounted flips true post-hydration -- late enough to
  // never mismatch, early enough that a real in-flight fetch (the original
  // bug this replaced: a lingering false "no open shift" on slow first
  // loads) is caught well before a user could read it.
  const hasMounted = useSyncExternalStore(
    subscribeNever,
    getMountedClientSnapshot,
    getMountedServerSnapshot,
  );
  // F295 -- one free-text input per tracked cart line, keyed by line id,
  // for the serial/batch number the cashier scans or types before the
  // sale can complete. Not committed until "Set" is pressed (setPosCartLineTracking).
  const [trackingInputs, setTrackingInputs] = useState<Record<string, string>>(
    {},
  );
  const queryClient = useQueryClient();

  const storesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "stores"),
    queryFn: listPosStores,
  });
  const terminalsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "terminals"),
    queryFn: listPosTerminals,
  });
  const shiftsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "shifts"),
    queryFn: () => listPosShifts(),
  });

  const myOpenShift = useMemo(
    () =>
      shiftsQuery.data?.rows.find(
        (row) =>
          (row as { status: string; cashier_user_id?: string }).status ===
            "open" &&
          (row as { cashier_user_id?: string }).cashier_user_id ===
            workspace.userId,
      ) as { id: string; store_id: string; terminal_id: string } | undefined,
    [shiftsQuery.data, workspace.userId],
  );
  const store = storesQuery.data?.rows.find(
    (s) => s.id === myOpenShift?.store_id,
  );

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
    createPosCart({
      storeId: myOpenShift.store_id,
      terminalId: myOpenShift.terminal_id,
      shiftId: myOpenShift.id,
    })
      .then((result) => !cancelled && setCart(result.cart))
      .catch(
        (err) =>
          !cancelled &&
          setError(
            err instanceof PosApiError
              ? err.message
              : "The cart could not be started.",
          ),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myOpenShift?.id]);

  // Poll a non-cash leg while its outcome is still pending/authorized --
  // there is no client-side "it succeeded," only what the server reports
  // (an adapter's own synchronous response already resolved the sandbox
  // outcomes this UI offers, but polling is what a real async provider's
  // webhook-driven capture would need).
  useEffect(() => {
    const pendingLines = tenderLines.filter(
      (line) =>
        line.paymentId &&
        (line.status === "pending" ||
          line.status === "authorized" ||
          line.status === "initiated"),
    );
    if (!pendingLines.length) return;
    const timer = setInterval(() => {
      pendingLines.forEach((line) => {
        getPosPayment(line.paymentId!)
          .then((result) => {
            setTenderLines((lines) =>
              lines.map((l) =>
                l.id === line.id
                  ? {
                      ...l,
                      status: result.payment.status,
                      error: result.payment.failure_reason || undefined,
                    }
                  : l,
              ),
            );
          })
          .catch(() => undefined);
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [tenderLines]);

  // F279-APP-001: while a discount is waiting on a supervisor, re-read the
  // cart (read-only -- getPosCart never bumps the version) so the cashier sees
  // "approved"/"rejected" the moment it is decided, instead of having to
  // guess and press Complete to find out.
  const hasPendingDiscountApproval = (cart?.discountApprovals ?? []).some(
    (approval) => approval.status === "pending",
  );
  useEffect(() => {
    if (!cart?.id || !hasPendingDiscountApproval) return;
    const cartId = cart.id;
    const timer = setInterval(() => {
      getPosCart(cartId)
        .then((result) => setCart(result.cart))
        .catch(() => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [cart?.id, hasPendingDiscountApproval]);

  async function run(action: () => Promise<{ cart: PosCart }>, onApproval?: (err: PosApiError) => void) {
    setLoading(true);
    try {
      const result = await action();
      setCart(result.cart);
      setError(null);
      setConflict(null);
    } catch (err) {
      if (onApproval && err instanceof PosApiError && approvalNeeded(err)) {
        onApproval(err);
      } else if (
        err instanceof PosApiError &&
        (err.code === "POS_CART_VERSION_CONFLICT" ||
          err.code === "POS_PRICE_CONFLICT")
      ) {
        setConflict(err.message);
        if (cart) getPosCart(cart.id).then((result) => setCart(result.cart));
      } else {
        setError(
          err instanceof PosApiError
            ? err.message
            : "The action could not be completed.",
        );
      }
    } finally {
      setLoading(false);
    }
  }

  const changeQuantity = (lineId: string, quantity: number) =>
    cart &&
    run(() =>
      quantity <= 0
        ? removePosCartLine(cart.id, lineId, cart.version)
        : updatePosCartLineQuantity(cart.id, lineId, quantity, cart.version),
    );

  // F295 -- commit the scanned/typed serial or batch number onto a tracked
  // cart line. Which field (batchId vs serialId) depends on the line's own
  // tracking_type, surfaced by the server (cart-pricing.js/cart.js).
  function setLineTracking(lineId: string, trackingType: "batch" | "serial") {
    if (!cart) return;
    const value = trackingInputs[lineId]?.trim();
    if (!value) return;
    run(() =>
      setPosCartLineTracking(
        cart.id,
        lineId,
        trackingType === "serial"
          ? { serialNumber: value, expectedVersion: cart.version }
          : { batchNumber: value, expectedVersion: cart.version },
      ),
    );
  }

  // Keep what was asked when it needs a supervisor, so the same discount can be applied with the approval.
  const askApproval = (input: { reason: string }, apply: (approvalId: string, version: number) => Promise<{ cart: PosCart }>) => (err: PosApiError) => {
    const needed = approvalNeeded(err)!;
    if (!cart) return;
    const version = cart.version;
    setExceptionApproval(null);
    setException({ message: err.message, permission: needed.permission, amount: needed.amount, percentage: needed.percentage, reason: input.reason, cartVersion: version,
      apply: (approvalId) => apply(approvalId, version) });
  };
  const applyCartDiscount = (input: {
    type: "percent" | "amount";
    value: number;
    reason: string;
  }) =>
    cart &&
    run(
      () => setPosCartDiscount(cart.id, { ...input, expectedVersion: cart.version }),
      askApproval(input, (approvalId, version) => setPosCartDiscount(cart.id, { ...input, expectedVersion: version, approvalId })),
    );
  const removeCartDiscount = () =>
    cart &&
    run(() =>
      setPosCartDiscount(cart.id, {
        type: null,
        expectedVersion: cart.version,
      }),
    );
  const applyLineDiscount = (
    lineId: string,
    input: { type: "percent" | "amount"; value: number; reason: string },
  ) =>
    cart &&
    run(
      () => applyPosLineDiscount(cart.id, lineId, { ...input, expectedVersion: cart.version }),
      askApproval(input, (approvalId, version) => applyPosLineDiscount(cart.id, lineId, { ...input, expectedVersion: version, approvalId })),
    );
  const removeLineDiscount = (lineId: string) =>
    cart && run(() => removePosLineDiscount(cart.id, lineId, cart.version));
  function selectCustomer(customer: PosCustomerMatch | null) {
    if (!cart) return;
    run(() => setPosCartCustomer(cart.id, customer?.id ?? null, cart.version));
  }

  // F287: hold releases this terminal's active-cart slot (the checkout
  // effect above re-creates/resumes a cart on this terminal the next time
  // it mounts with nothing else active), so a cashier can start a new sale
  // immediately after holding this one.
  async function holdCurrentCart(note?: string) {
    if (!cart) return;
    setLoading(true);
    try {
      await holdPosCart(cart.id, cart.version, note);
      setHoldOpen(false);
      setCheckoutIssues([]);
      setResumeChanges([]);
      setError(null);
      setCart(null);
      setIdempotencyKey(crypto.randomUUID());
      queryClient.invalidateQueries({
        queryKey: scopedQueryKey(workspace, "pos", "held-carts"),
      });
      await startFreshCart();
    } catch (err) {
      setError(
        err instanceof PosApiError
          ? err.message
          : "The sale could not be held.",
      );
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
      setResumeChanges(result.cart.resumeChanges ?? []);
      setCheckoutIssues([]);
      setError(null);
      setHeldCartsOpen(false);
      queryClient.invalidateQueries({
        queryKey: scopedQueryKey(workspace, "pos", "held-carts"),
      });
    } catch (err) {
      setError(
        err instanceof PosApiError
          ? err.message
          : "This held sale could not be resumed.",
      );
    } finally {
      setLoading(false);
    }
  }

  // Proceed to checkout: the server checks everything (products, stock, tracking, prices, tax, discounts, permission, session) and locks the
  // bill for payment, or lists what to fix — a changed total is shown before anyone pays it.
  async function proceedToCheckout() {
    if (!cart) return;
    setLoading(true);
    try {
      const result = await beginPosCheckout(cart.id, cart.version);
      setCart(result.cart);
      setCheckoutIssues(result.ready ? [] : result.issues);
      setResumeChanges([]);
      setError(null);
    } catch (err) {
      setError(err instanceof PosApiError ? err.message : "Checkout could not start.");
      if (err instanceof PosApiError && err.code === "POS_CART_VERSION_CONFLICT") getPosCart(cart.id).then((result) => setCart(result.cart));
    } finally {
      setLoading(false);
    }
  }
  async function backToBill() {
    if (!cart) return;
    setLoading(true);
    try {
      const result = await releasePosCheckout(cart.id);
      setCart(result.cart);
      setError(null);
    } catch (err) {
      setError(err instanceof PosApiError ? err.message : "The bill could not be reopened.");
    } finally {
      setLoading(false);
    }
  }
  const saveNote = () => {
    if (!cart || noteDraft === null || noteDraft === (cart.notes ?? "")) { setNoteDraft(null); return; }
    const value = noteDraft;
    setNoteDraft(null);
    run(() => setPosCartNotes(cart.id, value.trim() || null, cart.version));
  };
  const overridePrice = (lineId: string, input: { unitPrice: string | null; reason: string }) =>
    cart && run(
      () => overridePosLinePrice(cart.id, lineId, { ...input, expectedVersion: cart.version }),
      askApproval({ reason: input.reason }, (approvalId, version) => overridePosLinePrice(cart.id, lineId, { ...input, approvalId, expectedVersion: version })),
    );
  async function createCustomerHere(input: { name: string; phone: string; gstin: string }) {
    if (!cart) return;
    try {
      const customer = await quickCreatePosCustomer({ name: input.name, phone: input.phone || null, gstin: input.gstin || null, cartId: cart.id });
      setNewCustomerOpen(false);
      selectCustomer({ id: customer.id, code: customer.code ?? "", displayName: customer.displayName, phone: customer.phone, email: customer.email });
    } catch (err) {
      setError(err instanceof PosApiError ? err.message : "The customer could not be created.");
    }
  }

  // F283/F284/F285/F286 tender-line helpers.
  const tenderTotal = tenderLines.reduce(
    (sum, line) => sum + (Number.isFinite(line.amount) ? line.amount : 0),
    0,
  );
  const grandTotalNumber = Number(cart?.grand_total ?? 0);
  const remainingToAllocate =
    Math.round((grandTotalNumber - tenderTotal) * 100) / 100;
  const isSingleCashTender =
    tenderLines.length === 1 && tenderLines[0].method === "cash";
  const allNonCashCaptured = tenderLines.every(
    (line) => line.method === "cash" || line.status === "captured",
  );
  const canComplete =
    Boolean(cart?.lines?.length) &&
    tenderLines.every((line) => line.amount > 0) &&
    allNonCashCaptured &&
    (isSingleCashTender
      ? tenderTotal >= grandTotalNumber
      : remainingToAllocate === 0);

  function updateTenderLine(id: string, patch: Partial<TenderLine>) {
    setTenderLines((lines) =>
      lines.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    );
  }
  function addTenderLine() {
    setTenderLines((lines) => [
      ...lines,
      {
        id: newTenderLineId(),
        method: "card",
        amount: Math.max(0, remainingToAllocate),
      },
    ]);
  }
  function removeTenderLine(id: string) {
    setTenderLines((lines) =>
      lines.length > 1 ? lines.filter((line) => line.id !== id) : lines,
    );
  }
  const [tenderOutcome, setTenderOutcome] = useState<Record<string, string>>(
    {},
  );

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
      updateTenderLine(line.id, {
        paymentId: result.payment.id,
        status: result.payment.status,
        charging: false,
        error: result.payment.failure_reason || undefined,
      });
      // Taking a card / UPI payment locks the bill for checkout on the server: show it locked.
      getPosCart(cart.id).then((fresh) => setCart(fresh.cart)).catch(() => undefined);
    } catch (err) {
      updateTenderLine(line.id, {
        charging: false,
        error:
          err instanceof PosApiError
            ? err.message
            : "The payment could not be started.",
      });
    }
  }

  async function completeSale() {
    if (!cart) return;
    setCompleting(true);
    try {
      const payments: PosPaymentLeg[] = tenderLines.map((line) =>
        line.method === "cash"
          ? { method: "cash", amount: line.amount }
          : { method: line.method, paymentId: line.paymentId! },
      );
      const result = await completePosCart(cart.id, {
        payments,
        idempotencyKey,
        expectedVersion: cart.version,
        expectedGrandTotal: cart.grand_total,
      });
      const sale = result.sale as {
        id: string;
        receipt_number: string;
        grand_total: string;
        change_total: string;
      };
      setConfirmation({
        saleId: sale.id,
        receiptNumber: sale.receipt_number,
        grandTotal: sale.grand_total,
        changeTotal: sale.change_total,
      });
      setError(null);
    } catch (err) {
      if (
        err instanceof PosApiError &&
        (err.code === "POS_CART_VERSION_CONFLICT" ||
          err.code === "POS_PRICE_CONFLICT")
      ) {
        setConflict(err.message);
        getPosCart(cart.id).then((result) => setCart(result.cart));
      } else {
        setError(
          err instanceof PosApiError
            ? err.message
            : "The sale could not be completed.",
        );
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
      const result = await createPosCart({
        storeId: myOpenShift.store_id,
        terminalId: myOpenShift.terminal_id,
        shiftId: myOpenShift.id,
      });
      setCart(result.cart);
    } catch (err) {
      setError(
        err instanceof PosApiError
          ? err.message
          : "The cart could not be started.",
      );
    }
  }

  function startNewSale() {
    setConfirmation(null);
    setTenderLines([{ id: newTenderLineId(), method: "cash", amount: 0 }]);
    setTenderOutcome({});
    setIdempotencyKey(crypto.randomUUID());
    setCart(null);
    startFreshCart();
  }

  if (hasMounted && shiftsQuery.isLoading) {
    return <PosLoading />;
  }

  if (!myOpenShift) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
        <p className="text-sm text-text-secondary">
          No open shift found. Open a shift before starting checkout.
        </p>
        <Button variant="primary" onPress={() => router.push("/pos")}>
          Go to Point of Sale
        </Button>
      </div>
    );
  }

  if (confirmation) {
    const currency = store?.currencyCode ?? store?.currency_code ?? "";
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 pt-8">
        <PosPanel padding="lg" className="items-center text-center">
          <StatusBadge tone="success">Sale complete</StatusBadge>
          <h1 className="text-2xl font-semibold text-text">
            Receipt {confirmation.receiptNumber}
          </h1>
          <dl className="grid w-full grid-cols-2 gap-3 rounded-[var(--radius-control)] bg-surface-muted p-4">
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium text-text-muted">Total</dt>
              <dd className="text-xl font-semibold tabular-nums text-text">
                {money(currency, confirmation.grandTotal)}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium text-text-muted">
                Change due
              </dt>
              <dd className="text-xl font-semibold tabular-nums text-text">
                {money(currency, confirmation.changeTotal)}
              </dd>
            </div>
          </dl>
          <DigitalReceipts saleId={confirmation.saleId} />
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Button
              variant="secondary"
              size="large"
              onPress={() =>
                router.push(`/pos/receipts/${confirmation.saleId}`)
              }
            >
              View / print receipt
            </Button>
            <Button variant="primary" size="large" onPress={startNewSale}>
              New sale
            </Button>
          </div>
        </PosPanel>
      </div>
    );
  }

  const currency = store?.currencyCode ?? store?.currency_code ?? "";
  const terminal = terminalsQuery.data?.rows.find(
    (candidate) => candidate.id === myOpenShift.terminal_id,
  );
  const shiftNumber = (myOpenShift as { shift_number?: string }).shift_number;
  const discountApprovals = cart?.discountApprovals ?? [];
  const pendingApproval = discountApprovals.some(
    (approval) => approval.status === "pending",
  );
  const rejectedApproval = discountApprovals.some(
    (approval) => approval.status === "rejected",
  );
  const approvedApproval =
    discountApprovals.length > 0 &&
    discountApprovals.every((approval) => approval.status === "approved");
  const itemCount = (cart?.lines ?? []).reduce(
    (count, line) => count + Number(line.quantity),
    0,
  );
  const trackingIncomplete = (cart?.lines ?? []).some(
    (line) =>
      (line.tracking_type === "serial" && !line.serial_id) ||
      (line.tracking_type === "batch" && !line.batch_id),
  );
  const lifecycle = cart ? (cart.lifecycle ?? (["draft", "priced"].includes(cart.status) ? "DRAFT" : cart.status.toUpperCase())) : null;
  const editable = lifecycle === "DRAFT";
  const inCheckout = lifecycle === "CHECKOUT_PENDING";
  const completeBlockedReason = !inCheckout
    ? "Proceed to checkout first: the bill is checked and locked for payment."
    : pendingApproval
    ? "Waiting for supervisor approval of the discount."
    : rejectedApproval
      ? "The discount was rejected — remove it to continue."
      : trackingIncomplete
        ? "Enter the required serial or batch numbers."
        : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Checkout"
        description={
          [
            store?.name,
            terminal?.name,
            shiftNumber ? `Shift ${shiftNumber}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        secondaryActions={
          <div className="flex items-center gap-2">
            {cart?.cart_reference && <span className="text-sm font-medium tabular-nums text-text-secondary">{cart.cart_reference}</span>}
            {lifecycle && <StatusBadge tone={lifecycle === "CHECKOUT_PENDING" ? "warning" : lifecycle === "DRAFT" ? "success" : "neutral"}>{LIFECYCLE_LABEL[lifecycle] ?? lifecycle}</StatusBadge>}
            <Button variant="secondary" onPress={() => setHeldCartsOpen(true)}>
              <Pause className="size-4" aria-hidden="true" />
              Held sales
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <PosPanel
            title="Add items"
            description="Scan a barcode, type a name or SKU, or pick from the categories."
          >
            <PosProductFinder
              cartId={cart?.id ?? null}
              terminalId={cart?.terminal_id ?? null}
              disabled={!editable}
              // A card or UPI payment in progress: no product is added by a stray scan.
              paused={completing || tenderLines.some((line) => line.charging || (line.paymentId && ["pending", "authorized", "initiated"].includes(line.status ?? "")))}
              onCart={(next) => { setCart(next); setError(null); setConflict(null); }}
            />
          </PosPanel>

          <PosPanel
            title="Cart"
            description={
              cart?.lines?.length
                ? `${itemCount} item${itemCount === 1 ? "" : "s"}`
                : undefined
            }
            padding="none"
            className="gap-0 lg:min-h-[22rem]"
          >
            {!cart?.lines?.length ? (
              <p className="p-8 text-center text-sm text-text-muted">
                {loading
                  ? "Loading…"
                  : "Cart is empty — search or scan a product to begin."}
              </p>
            ) : (
              <div className="flex flex-col">
                {cart.lines.map((line) => {
                  // F295 -- requires a serial/batch to be set before this line
                  // can actually be sold (enforced authoritatively at checkout
                  // by Stock's postStockMovement); this is only the UI nudge to
                  // capture it earlier, at the counter, rather than let the
                  // cashier discover the requirement from a failed checkout.
                  const needsSerial =
                    line.tracking_type === "serial" && !line.serial_id;
                  const needsBatch =
                    line.tracking_type === "batch" && !line.batch_id;
                  const lineApproval = discountApprovals.find(
                    (approval) => approval.cart_line_id === line.id,
                  );
                  const hasManualDiscount =
                    Number(line.manual_discount_amount) > 0;
                  return (
                    <div
                      key={line.id}
                      className="flex flex-col gap-2 border-t border-border px-4 py-3 first:border-t-0"
                    >
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-text">
                            {line.description}
                          </p>
                          <p className="text-xs text-text-muted">
                            {money(currency, line.unit_price)} per {(line as { uom_code?: string | null }).uom_code ?? "unit"}
                            {Number(line.manual_discount_amount) > 0 && (
                              <>
                                {" "}
                                · manual −
                                {money(currency, line.manual_discount_amount)}
                              </>
                            )}
                            {Number(line.promotion_discount_amount) > 0 && (
                              <>
                                {" "}
                                · promo −
                                {money(
                                  currency,
                                  line.promotion_discount_amount,
                                )}
                              </>
                            )}
                            {line.serial_id && <> · serial set</>}
                            {line.batch_id && <> · batch set</>}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <IconButton
                            variant="outline"
                            size="large"
                            isDisabled={!editable}
                            onPress={() =>
                              Number(line.quantity) - 1 <= 0
                                ? window.confirm(`Remove ${line.description} from the bill?`) && changeQuantity(line.id, 0)
                                : changeQuantity(line.id, Number(line.quantity) - 1)
                            }
                            aria-label="Decrease quantity"
                          >
                            <Minus className="size-4" aria-hidden="true" />
                          </IconButton>
                          <QuantityInput
                            key={`${line.id}:${line.quantity}`}
                            value={Number(line.quantity)}
                            unit={(line as { uom_code?: string | null }).uom_code ?? null}
                            isDisabled={!editable}
                            onCommit={(quantity) =>
                              quantity <= 0
                                ? window.confirm(`Remove ${line.description} from the bill?`) && changeQuantity(line.id, 0)
                                : changeQuantity(line.id, quantity)
                            }
                          />
                          <IconButton
                            variant="outline"
                            size="large"
                            isDisabled={!editable}
                            onPress={() =>
                              changeQuantity(line.id, Number(line.quantity) + 1)
                            }
                            aria-label="Increase quantity"
                          >
                            <Plus className="size-4" aria-hidden="true" />
                          </IconButton>
                        </div>
                        <span className="w-24 text-right text-base font-semibold tabular-nums text-text">
                          {money(currency, line.line_total)}
                        </span>
                        <IconButton
                          variant="ghost"
                          size="large"
                          isDisabled={!editable}
                          onPress={() =>
                            cart &&
                            run(() =>
                              removePosCartLine(cart.id, line.id, cart.version),
                            )
                          }
                          aria-label="Remove line"
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </IconButton>
                      </div>

                      {editable && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button variant="ghost" size="compact" onPress={() => setPriceLine(line)}>
                            {line.price_override ? "Price changed — edit" : "Change price"}
                          </Button>
                        </div>
                      )}
                      {canDiscount && editable && (
                        <div className="flex flex-wrap items-center gap-2">
                          {hasManualDiscount ? (
                            <>
                              <StatusBadge tone="warning">{`Discount −${money(currency, line.manual_discount_amount)}`}</StatusBadge>
                              {lineApproval && (
                                <StatusBadge
                                  tone={statusTone(lineApproval.status)}
                                >
                                  {lineApproval.status === "pending"
                                    ? "Awaiting approval"
                                    : statusLabel(lineApproval.status)}
                                </StatusBadge>
                              )}
                              <Button
                                variant="ghost"
                                size="compact"
                                onPress={() => removeLineDiscount(line.id)}
                              >
                                Remove discount
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="ghost"
                              size="compact"
                              onPress={() => setLineDiscountLine(line)}
                            >
                              <BadgePercent
                                className="size-3.5"
                                aria-hidden="true"
                              />
                              Add discount
                            </Button>
                          )}
                        </div>
                      )}

                      {(needsSerial || needsBatch) && (
                        <div className="flex items-end gap-2 rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2">
                          <TextField
                            label={
                              needsSerial
                                ? "Serial number required"
                                : "Batch required"
                            }
                            placeholder={
                              needsSerial
                                ? "Scan or enter serial"
                                : "Scan or enter batch"
                            }
                            value={trackingInputs[line.id] ?? ""}
                            onChange={(value) =>
                              setTrackingInputs((prev) => ({
                                ...prev,
                                [line.id]: value,
                              }))
                            }
                            // A scanner aimed here fills this box (it has the focus) and its Enter sets the number — never a product lookup.
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                setLineTracking(line.id, needsSerial ? "serial" : "batch");
                              }
                            }}
                            className="flex-1"
                          />
                          <Button
                            variant="secondary"
                            onPress={() =>
                              setLineTracking(
                                line.id,
                                needsSerial ? "serial" : "batch",
                              )
                            }
                          >
                            Set
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </PosPanel>
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:pr-1">
          {error && <PosAlert>{error}</PosAlert>}
          {exception && cart && (
            <PosAlert tone="warning">
              <p className="font-medium">{exception.message}</p>
              {!liveApproval && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="font-medium underline" disabled={loading} onClick={() => {
                    requestApproval({ permission: exception.permission, resource: { type: "pos_cart", id: cart.id }, amount: exception.amount, percentage: exception.percentage,
                      reason: exception.reason, idempotencyKey: `${cart.id}:${exception.cartVersion}:${exception.permission}` })
                      .then(setExceptionApproval).catch((err) => setError(err instanceof PosApiError ? err.message : "The approval could not be requested."));
                  }}>Request supervisor approval</button>
                  <button type="button" className="underline" onClick={() => setException(null)}>Cancel</button>
                </div>
              )}
              {liveApproval?.status === "pending" && (
                <p className="mt-1 text-xs">Waiting for a supervisor (Supervisor Approvals). Leave the cart as it is — a change cancels the approval. <Link className="font-medium underline" href="/pos/approvals">Open approvals</Link></p>
              )}
              {liveApproval?.status === "approved" && (
                <p className="mt-2 text-xs">Approved by {liveApproval.approver}.{" "}
                  <button type="button" className="font-medium underline" disabled={loading} onClick={() => {
                    const approvalId = liveApproval.id;
                    run(() => exception.apply(approvalId)).then(() => { setException(null); setExceptionApproval(null); });
                  }}>Apply the discount</button>
                </p>
              )}
              {(liveApproval?.status === "rejected" || liveApproval?.status === "expired") && (
                <p className="mt-1 text-xs">The request was {liveApproval.status}. <button type="button" className="underline" onClick={() => { setException(null); setExceptionApproval(null); }}>Dismiss</button></p>
              )}
            </PosAlert>
          )}
          {resumeChanges.length > 0 && (
            <PosAlert tone="warning" className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">This bill was on hold — review what changed:</p>
                <ul className="mt-1 list-disc pl-5 text-xs">{resumeChanges.map((change, index) => <li key={index}>{change.message}</li>)}</ul>
              </div>
              <button type="button" onClick={() => setResumeChanges([])} aria-label="Dismiss"><X className="size-4" /></button>
            </PosAlert>
          )}
          {conflict && (
            <PosAlert
              tone="warning"
              className="flex items-center justify-between gap-2"
            >
              <span>
                {conflict} — the cart was refreshed with current server totals.
              </span>
              <button
                type="button"
                onClick={() => setConflict(null)}
                aria-label="Dismiss"
              >
                <X className="size-4" />
              </button>
            </PosAlert>
          )}
          {pendingApproval && (
            <PosAlert tone="warning">
              <p className="font-medium">
                Waiting for a supervisor to approve the discount.
              </p>
              <p className="text-xs">
                Leave the cart as it is — any change restarts the approval.{" "}
                {canApproveDiscounts && (
                  <Link
                    href="/pos/approvals"
                    className="font-medium underline"
                  >
                    Open the approvals queue
                  </Link>
                )}
              </p>
            </PosAlert>
          )}
          {rejectedApproval && (
            <PosAlert>
              A supervisor rejected the discount. Remove it to complete this
              sale.
            </PosAlert>
          )}
          {approvedApproval && (
            <PosAlert tone="success">
              Discount approved by a supervisor.
            </PosAlert>
          )}

          <PosPanel title="Customer & discount" scanZone="off">
            {cart && (
              <CustomerPanel cart={cart} editable={editable} onCart={(next) => { setCart(next); setError(null); }} onNewCustomer={() => setNewCustomerOpen(true)} />
            )}

            {canDiscount && (
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <p className="text-sm font-medium text-text">Cart discount</p>
                {cart?.cart_discount_type ? (
                  <div className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">
                    <span className="text-text">
                      {cart.cart_discount_type === "percent"
                        ? `${Number(cart.cart_discount_value)}% off`
                        : `${money(currency, cart.cart_discount_value)} off`}
                      {cart.cart_discount_reason ? (
                        <span className="text-text-muted">
                          {" "}
                          — {cart.cart_discount_reason}
                        </span>
                      ) : null}
                    </span>
                    <Button
                      variant="ghost"
                      size="compact"
                      onPress={removeCartDiscount}
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <div>
                    <Button
                      variant="secondary"
                      onPress={() => setCartDiscountOpen(true)}
                      isDisabled={!cart?.lines?.length}
                    >
                      <BadgePercent className="size-4" aria-hidden="true" />
                      Add cart discount
                    </Button>
                  </div>
                )}
              </div>
            )}
          </PosPanel>

          <PosPanel title="Payment" scanZone="off">
            {cart && (
              <TextArea label="Sale note (optional)" rows={2} value={noteDraft ?? cart.notes ?? ""} isDisabled={!editable}
                onChange={setNoteDraft} onBlur={saveNote} />
            )}
            <div className="flex flex-col gap-1 text-sm">
              <Row label="Subtotal" value={money(currency, cart?.subtotal)} />
              <Row
                label="Discounts"
                value={`−${money(currency, cart?.discount_total)}`}
              />
              <Row label="Tax" value={money(currency, cart?.tax_total)} />
              <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-lg font-semibold text-text">
                <span>Total</span>
                <span className="tabular-nums">
                  {money(currency, cart?.grand_total)}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-3">
              <p className="text-sm font-medium text-text">Tender</p>
              {tenderLines.map((line) => (
                <div
                  key={line.id}
                  className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3"
                >
                  <div className="flex items-end gap-2">
                    {line.method === "cash" ? (
                      <span className="flex-1 pb-2 text-sm font-medium text-text">
                        Cash
                      </span>
                    ) : (
                      <Select
                        label="Method"
                        className="flex-1"
                        options={NON_CASH_METHOD_OPTIONS}
                        selectedKey={line.method}
                        onSelectionChange={(key) =>
                          updateTenderLine(line.id, {
                            method: key as TenderMethod,
                          })
                        }
                        isDisabled={Boolean(line.paymentId)}
                      />
                    )}
                    <NumberField
                      label="Amount"
                      value={line.amount}
                      onChange={(value) =>
                        updateTenderLine(line.id, { amount: value })
                      }
                      minValue={0}
                      step={0.01}
                      isDisabled={Boolean(line.paymentId)}
                      className="w-32"
                    />
                    {tenderLines.length > 1 && !line.paymentId && (
                      <IconButton
                        variant="ghost"
                        onPress={() => removeTenderLine(line.id)}
                        aria-label="Remove tender line"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </IconButton>
                    )}
                  </div>
                  {line.method !== "cash" && (
                    <div className="flex items-end gap-2">
                      {!line.paymentId && (
                        <Select
                          label="Sandbox outcome"
                          className="flex-1"
                          options={SANDBOX_OUTCOME_OPTIONS}
                          selectedKey={
                            (tenderOutcome[line.id] ||
                              "immediate_success") as (typeof SANDBOX_OUTCOME_OPTIONS)[number]["value"]
                          }
                          onSelectionChange={(key) =>
                            setTenderOutcome((prev) => ({
                              ...prev,
                              [line.id]: String(key),
                            }))
                          }
                        />
                      )}
                      {!line.paymentId ? (
                        <Button
                          variant="secondary"
                          onPress={() => chargeTenderLine(line)}
                          isLoading={line.charging}
                          isDisabled={line.amount <= 0}
                        >
                          Charge {line.method}
                        </Button>
                      ) : (
                        <StatusBadge
                          tone={
                            line.status === "captured"
                              ? "success"
                              : line.status === "failed"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {line.status === "captured"
                            ? "Captured"
                            : line.status === "failed"
                              ? "Declined"
                              : "Processing…"}
                        </StatusBadge>
                      )}
                    </div>
                  )}
                  {line.error && (
                    <p className="text-xs text-danger">{line.error}</p>
                  )}
                </div>
              ))}
              <div>
                <Button variant="ghost" size="compact" onPress={addTenderLine}>
                  <Plus className="size-3.5" aria-hidden="true" />
                  Add tender line (split payment)
                </Button>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">
                  Remaining to allocate
                </span>
                <span
                  className={`font-medium tabular-nums ${remainingToAllocate === 0 ? "text-success" : "text-text"}`}
                >
                  {money(currency, remainingToAllocate)}
                </span>
              </div>
              {isSingleCashTender && (
                <p className="text-sm text-text-secondary">
                  Change:{" "}
                  {money(currency, Math.max(0, tenderTotal - grandTotalNumber))}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-border pt-3">
              {checkoutIssues.length > 0 && (
                <PosAlert tone="warning">
                  <p className="font-medium">Review before payment:</p>
                  <ul className="mt-1 list-disc pl-5 text-xs">{checkoutIssues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>
                </PosAlert>
              )}
              {editable ? (
                <Button variant="primary" size="large" onPress={proceedToCheckout} isDisabled={!cart?.lines?.length} isLoading={loading}>
                  Proceed to checkout
                </Button>
              ) : (
                <>
                  <Button
                    variant="primary"
                    size="large"
                    onPress={completeSale}
                    isDisabled={!canComplete || Boolean(completeBlockedReason)}
                    isLoading={completing}
                  >
                    Complete sale
                  </Button>
                  {inCheckout && <Button variant="ghost" onPress={backToBill} isLoading={loading}>Back to the bill</Button>}
                </>
              )}
              {completeBlockedReason && (
                <p className="text-center text-xs text-text-muted">
                  {completeBlockedReason}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  onPress={() => setHoldOpen(true)}
                  isDisabled={!cart?.lines?.length || !editable}
                  isLoading={loading}
                >
                  <Pause className="size-4" aria-hidden="true" />
                  Hold sale
                </Button>
                <Button
                  variant="ghost"
                  isDisabled={!editable}
                  onPress={() => {
                    if (!cart) return;
                    if (cart.lines?.length && !window.confirm("Cancel this unpaid bill? It is kept in the history but cannot be resumed.")) return;
                    run(() => cancelPosCart(cart.id).then((r) => ({ cart: r.cart }))).then(() => startNewSale());
                  }}
                >
                  Cancel sale
                </Button>
              </div>
            </div>
          </PosPanel>
        </div>
      </div>

      {holdOpen && <HoldDialog onClose={() => setHoldOpen(false)} onHold={(note) => holdCurrentCart(note)} busy={loading} />}
      {priceLine && (
        <PriceDialog line={priceLine} currency={currency} onClose={() => setPriceLine(null)}
          onApply={(input) => { overridePrice(priceLine.id, input); setPriceLine(null); }} />
      )}
      {newCustomerOpen && <NewCustomerDialog onClose={() => setNewCustomerOpen(false)} onCreate={createCustomerHere} />}
      {heldCartsOpen && (
        <HeldCartsDialog
          onClose={() => setHeldCartsOpen(false)}
          onResume={resumeHeldCart}
          currency={currency}
        />
      )}
      {lineDiscountLine && (
        <DiscountDialog
          title={`Discount — ${lineDiscountLine.description}`}
          baseLabel="Line total before discount"
          baseAmount={money(
            currency,
            lineDiscountLine.gross_amount ?? lineDiscountLine.line_total,
          )}
          onClose={() => setLineDiscountLine(null)}
          onApply={(input) => {
            applyLineDiscount(lineDiscountLine.id, input);
            setLineDiscountLine(null);
          }}
        />
      )}
      {cartDiscountOpen && (
        <DiscountDialog
          title="Cart discount"
          baseLabel="Cart subtotal"
          baseAmount={money(currency, cart?.subtotal)}
          onClose={() => setCartDiscountOpen(false)}
          onApply={(input) => {
            applyCartDiscount(input);
            setCartDiscountOpen(false);
          }}
        />
      )}
    </div>
  );
}

// F279: manual discount, line- or cart-level. Type/value/reason go to the
// same applyPosCartLineDiscount / setPosCartDiscount the API has always
// exposed; the server decides whether the resulting percentage needs a
// supervisor (the threshold is organization policy -- pos_settings -- not
// something the client should second-guess), so this only explains that
// possibility rather than trying to predict it.
function DiscountDialog({
  title,
  baseLabel,
  baseAmount,
  onClose,
  onApply,
}: {
  title: string;
  baseLabel: string;
  baseAmount: string;
  onClose: () => void;
  onApply: (input: {
    type: "percent" | "amount";
    value: number;
    reason: string;
  }) => void;
}) {
  const [type, setType] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState(0);
  const [reason, setReason] = useState("");
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          {baseLabel}:{" "}
          <span className="tabular-nums text-text">{baseAmount}</span>. A larger
          discount needs a supervisor&apos;s approval before the sale can be
          completed.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Type"
            options={[
              { value: "percent", label: "Percent (%)" },
              { value: "amount", label: "Amount" },
            ]}
            selectedKey={type}
            onSelectionChange={(key) =>
              setType(key === "amount" ? "amount" : "percent")
            }
          />
          <NumberField
            label={type === "percent" ? "Percent off" : "Amount off"}
            value={value}
            onChange={setValue}
            minValue={0}
            maxValue={type === "percent" ? 100 : undefined}
            step={type === "percent" ? 1 : 0.01}
          />
        </div>
        <TextField
          label="Reason"
          isRequired
          value={reason}
          onChange={setReason}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            isDisabled={value <= 0 || !reason.trim()}
            onPress={() => onApply({ type, value, reason: reason.trim() })}
          >
            Apply discount
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// Held bills at the outlets the person works at: their own or everyone's, by reference, customer, terminal or note, and held date. Prices
// and stock are checked again on resume (nothing was reserved while held).
function HeldCartsDialog({
  onClose,
  onResume,
  currency,
}: {
  onClose: () => void;
  onResume: (id: string) => void;
  currency: string;
}) {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [from, setFrom] = useState("");
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "held-carts", search, scope, from),
    queryFn: () => listHeldPosCarts({ search: search || undefined, scope, from: from || undefined }),
    refetchInterval: 15000,
  });
  const rows = query.data?.rows ?? [];

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Held bills">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-text-muted">Prices and stock may have changed while a bill was on hold; they are checked again when you resume it.</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_9rem_10rem]">
          <SearchField label="Search" placeholder="Reference, customer, terminal or note" value={search} onChange={setSearch} />
          <Select label="Show" selectedKey={scope} onSelectionChange={(value) => setScope(value === "all" ? "all" : "mine")}
            options={[{ value: "mine", label: "My bills" }, { value: "all", label: "Everyone's" }]} />
          <TextField label="Held on or after" type="date" value={from} onChange={setFrom} />
        </div>
        {query.isLoading ? (
          <p className="p-4 text-center text-sm text-text-secondary">Loading…</p>
        ) : query.isError ? (
          <p className="p-4 text-center text-sm text-danger">{query.error instanceof Error ? query.error.message : "Held bills could not be loaded."}</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-center text-sm text-text-muted">No held bills here.</p>
        ) : (
          <ul className="flex max-h-96 flex-col divide-y divide-border overflow-y-auto rounded-[var(--radius-control)] border border-border">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">
                    {row.cart_reference ?? "Bill"} · {row.customer_name ?? "Walk-in"} · {row.line_count} item{row.line_count === 1 ? "" : "s"} ·{" "}
                    <span className="tabular-nums">{money(row.currency_code ?? currency, row.grand_total)}</span>
                  </p>
                  <p className="text-xs text-text-muted">
                    {row.cashier_name ?? "—"} · {row.store_name} / {row.terminal_name} · started {new Date(row.created_at).toLocaleString()} · held{" "}
                    {new Date(row.held_at).toLocaleTimeString()}
                  </p>
                  {row.hold_note && <p className="truncate text-xs text-text-secondary">“{row.hold_note}”</p>}
                </div>
                <Button variant="secondary" size="compact" onPress={() => onResume(row.id)}>Resume</Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button variant="ghost" onPress={onClose}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}

// Hold the bill with an optional short note for whoever resumes it.
function HoldDialog({ onClose, onHold, busy }: { onClose: () => void; onHold: (note: string) => void; busy: boolean }) {
  const [note, setNote] = useState("");
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Hold this bill">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">The bill keeps its items. Nothing is reserved meanwhile, so prices and stock are checked again when it is resumed.</p>
        <TextField label="Note (optional)" placeholder="e.g. Gone to fetch wallet" value={note} onChange={(value) => setNote(value.slice(0, 200))} autoFocus />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} onPress={() => onHold(note.trim())}>Hold bill</Button>
        </div>
      </div>
    </Dialog>
  );
}

// A different price for one line: within the cashier's limit with a reason, above it with a supervisor's approval. Clearing goes back to the
// price list's price. The item and the price list are never changed.
function PriceDialog({ line, currency, onClose, onApply }: {
  line: PosCart["lines"][number]; currency: string; onClose: () => void; onApply: (input: { unitPrice: string | null; reason: string }) => void;
}) {
  const [price, setPrice] = useState(String(Number(line.unit_price)));
  const [reason, setReason] = useState("");
  const valid = /^\d{1,12}(\.\d{1,6})?$/.test(price.trim());
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Price — ${line.description}`}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">List price {money(currency, line.list_price)} per unit. Tax is worked out again from the new price.</p>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="New unit price" value={price} onChange={setPrice} inputMode="decimal" />
          <TextField label="Reason" value={reason} onChange={setReason} isRequired />
        </div>
        <div className="flex justify-between gap-2">
          {line.price_override ? <Button variant="ghost" onPress={() => onApply({ unitPrice: null, reason: reason || "Back to list price" })}>Use the list price</Button> : <span />}
          <span className="flex gap-2">
            <Button variant="ghost" onPress={onClose}>Cancel</Button>
            <Button variant="primary" isDisabled={!valid || !reason.trim()} onPress={() => onApply({ unitPrice: price.trim(), reason: reason.trim() })}>Apply</Button>
          </span>
        </div>
      </div>
    </Dialog>
  );
}

// A customer created at the counter, in the shared Customer Master (needs the quick-create permission).
function NewCustomerDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (input: { name: string; phone: string; gstin: string }) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [gstin, setGstin] = useState("");
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="New customer">
      <div className="flex flex-col gap-3">
        <TextField label="Name" value={name} onChange={setName} isRequired autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Phone" value={phone} onChange={setPhone} inputMode="tel" />
          <TextField label="GSTIN (business customers)" value={gstin} onChange={(value) => setGstin(value.toUpperCase().slice(0, 15))} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isDisabled={!name.trim()} onPress={() => onCreate({ name: name.trim(), phone: phone.trim(), gstin: gstin.trim() })}>Create and select</Button>
        </div>
      </div>
    </Dialog>
  );
}

// A quantity typed in the line's unit, saved when the field is left or Enter is pressed (decimals only where the unit allows; the server
// checks).
function QuantityInput({ value, unit, isDisabled, onCommit }: { value: number; unit: string | null; isDisabled: boolean; onCommit: (quantity: number) => void }) {
  const [text, setText] = useState(String(value));
  const commit = () => {
    const next = Number(text.trim());
    if (!Number.isFinite(next) || next === value) { setText(String(value)); return; }
    onCommit(next);
  };
  return (
    <input
      aria-label={`Quantity${unit ? ` (${unit})` : ""}`}
      className="h-10 w-14 rounded-[var(--radius-control)] border border-border bg-surface text-center text-base font-medium tabular-nums disabled:opacity-60"
      inputMode="decimal"
      value={text}
      disabled={isDisabled}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } }}
    />
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

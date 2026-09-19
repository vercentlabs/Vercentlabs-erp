"use client";

// F297 — the offline-aware checkout path. Rendered by PosCheckoutScreen
// in place of the normal online cart UI whenever useOnlineStatus() reports
// offline. Everything here reads/writes ONLY the local, encrypted
// IndexedDB snapshot/queue (db.ts) -- no /api/pos/* call is ever attempted
// while offline (the online path's own network calls would simply fail
// and surface a confusing generic error, which is exactly what this
// component exists to avoid).
//
// Pricing here is a deliberately simplified, disclosed subset of the real
// engine (services/api/src/modules/point-of-sale/features/cart-pricing.js):
// unit price -> manual discount (permission-gated against the cashier's
// own last-synced permission snapshot) -> one flat tax rate per item's tax
// category from the snapshot. No promotions, no coupons, no price
// override, no customer, no non-cash tender -- see OFFLINE_UNSUPPORTED_
// OPERATIONS below, rendered verbatim so nothing half-works silently. The
// server re-derives every figure fresh (price, tax, stock, discount
// permission, shift-open) via the SAME completePointOfSale pipeline at
// sync time (syncOfflinePosSale) -- this screen's totals are a receipt
// ESTIMATE for the cashier and customer, never treated as authoritative.
import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Button, NumberField, SearchField, StatusBadge, TextField } from "@vercentlabs/design-system";

import { money } from "@/features/pos/shared/format";
import { countQueuedOfflineSales, loadOfflineContext, loadSnapshot, enqueueOfflineSale } from "./db";
import type { PosOfflineLine, PosOfflineQueuedSale, PosOfflineSnapshot } from "./types";

type LocalLine = PosOfflineLine;

function computeTotals(lines: LocalLine[], snapshot: PosOfflineSnapshot | null) {
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  for (const line of lines) {
    const lineSubtotal = line.quantity * line.capturedUnitPrice;
    const discount = Math.min(line.discountAmount || 0, lineSubtotal);
    const taxable = Math.max(0, lineSubtotal - discount);
    const rateRow = snapshot?.taxRatesByCategory.find((row) => row.taxCategoryId === line.taxCategoryId);
    const taxAmount = rateRow ? Math.round(taxable * (rateRow.rate / 100) * 100) / 100 : 0;
    subtotal += lineSubtotal;
    discountTotal += discount;
    taxTotal += taxAmount;
  }
  const grandTotal = Math.round((subtotal - discountTotal + taxTotal) * 100) / 100;
  return { subtotal, discountTotal, taxTotal, grandTotal };
}

export function OfflineCheckoutPanel() {
  const [snapshot, setSnapshot] = useState<PosOfflineSnapshot | null>(null);
  const [context, setContext] = useState<{ storeId: string; terminalId: string | null; shiftId: string; cashierUserId: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [lines, setLines] = useState<LocalLine[]>([]);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [discountReason, setDiscountReason] = useState("");
  const [cashTendered, setCashTendered] = useState(0);
  const [committing, setCommitting] = useState(false);
  const [confirmation, setConfirmation] = useState<{ localTransactionId: string; grandTotal: number } | null>(null);
  const [queueCounts, setQueueCounts] = useState({ queued: 0, conflict: 0 });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const savedContext = await loadOfflineContext();
        if (!savedContext) {
          if (!cancelled) setLoadError("No offline snapshot has been captured on this device yet. Connect once online at this terminal before going offline.");
          return;
        }
        const savedSnapshot = await loadSnapshot(savedContext.storeId);
        if (!savedSnapshot) {
          if (!cancelled) setLoadError("No offline catalog snapshot is available for this store on this device yet.");
          return;
        }
        if (!cancelled) {
          setContext(savedContext);
          setSnapshot(savedSnapshot);
        }
      } catch {
        if (!cancelled) setLoadError("The offline snapshot could not be read from this device (it may be corrupted or the encryption key changed).");
      }
    }
    load();
    countQueuedOfflineSales().then((counts) => !cancelled && setQueueCounts(counts));
    return () => {
      cancelled = true;
    };
  }, []);

  const canDiscount = Boolean(snapshot?.cashierPermissions.includes("pos.discount.apply"));

  const filteredItems = useMemo(() => {
    if (!snapshot || !searchTerm.trim()) return [];
    const term = searchTerm.trim().toLowerCase();
    return snapshot.items.filter((item) => item.name.toLowerCase().includes(term) || item.code.toLowerCase().includes(term) || item.barcode?.toLowerCase() === term).slice(0, 20);
  }, [snapshot, searchTerm]);

  function addLine(itemId: string) {
    const item = snapshot?.items.find((row) => row.itemId === itemId);
    if (!item) return;
    setLines((prev) => {
      const existing = prev.find((line) => line.itemId === itemId);
      if (existing) {
        return prev.map((line) => (line.itemId === itemId ? boundQuantity(line, item.lastKnownQuantity, line.quantity + 1) : line));
      }
      return [
        ...prev,
        { itemId: item.itemId, code: item.code, name: item.name, quantity: 1, capturedUnitPrice: item.unitPrice, taxCategoryId: item.taxCategoryId, description: item.name },
      ];
    });
    setSearchTerm("");
  }

  function boundQuantity(line: LocalLine, lastKnownQuantity: number, requested: number): LocalLine {
    // LIVE_STOCK_TRUTH (unsupported-while-offline): never let the offline
    // UI accept a quantity beyond the snapshot's last-known figure --
    // the server re-validates true current stock again at sync
    // regardless, but there is no reason to let a cashier queue a sale
    // that is already known-impossible against the snapshot itself.
    const bounded = Math.max(0, Math.min(requested, Math.max(lastKnownQuantity, 0)));
    return { ...line, quantity: bounded };
  }

  function changeQuantity(itemId: string, delta: number) {
    const item = snapshot?.items.find((row) => row.itemId === itemId);
    setLines((prev) =>
      prev
        .map((line) => (line.itemId === itemId ? boundQuantity(line, item?.lastKnownQuantity ?? 0, line.quantity + delta) : line))
        .filter((line) => line.quantity > 0),
    );
  }

  function removeLine(itemId: string) {
    setLines((prev) => prev.filter((line) => line.itemId !== itemId));
  }

  const perLineDiscount = lines.length > 0 ? discountAmount / lines.length : 0;
  const linesWithDiscount = lines.map((line) => ({ ...line, discountAmount: canDiscount ? perLineDiscount : 0, discountReason: canDiscount ? discountReason : null }));
  const totalsWithDiscount = computeTotals(linesWithDiscount, snapshot);

  async function commitOfflineSale() {
    if (!snapshot || !context || lines.length === 0) return;
    setCommitting(true);
    try {
      const localTransactionId = crypto.randomUUID();
      const sale: PosOfflineQueuedSale = {
        localTransactionId,
        storeId: context.storeId,
        terminalId: context.terminalId,
        shiftId: context.shiftId,
        cashierUserId: context.cashierUserId,
        currencyCode: snapshot.store.currencyCode,
        lines: linesWithDiscount,
        payments: [{ method: "cash", amount: cashTendered }],
        capturedAt: new Date().toISOString(),
        snapshotVersion: snapshot.version,
        status: "queued",
        lastSyncError: null,
        serverSaleId: null,
        conflictType: null,
        capturedTotals: totalsWithDiscount,
      };
      await enqueueOfflineSale(sale);
      setConfirmation({ localTransactionId, grandTotal: totalsWithDiscount.grandTotal });
      setLines([]);
      setDiscountAmount(0);
      setDiscountReason("");
      setCashTendered(0);
      const counts = await countQueuedOfflineSales();
      setQueueCounts(counts);
    } finally {
      setCommitting(false);
    }
  }

  function startNewOfflineSale() {
    setConfirmation(null);
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
        <StatusBadge tone="warning">Offline</StatusBadge>
        <p className="max-w-md text-sm text-text-secondary">{loadError}</p>
      </div>
    );
  }

  if (!snapshot || !context) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
        <StatusBadge tone="warning">Offline</StatusBadge>
        <p className="text-sm text-text-muted">Loading the offline catalog snapshot…</p>
      </div>
    );
  }

  if (confirmation) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
        <StatusBadge tone="warning">Sale queued (offline)</StatusBadge>
        <h1 className="text-2xl font-semibold text-text">Queued transaction {confirmation.localTransactionId.slice(0, 8)}</h1>
        <p className="text-lg text-text">Estimated total: {money(snapshot.store.currencyCode, String(confirmation.grandTotal))}</p>
        <p className="max-w-md text-sm text-text-secondary">
          This sale will sync to a real server sale automatically once this device is back online. It is not final until sync confirms it.
        </p>
        <Button variant="primary" onPress={startNewOfflineSale}>
          New offline sale
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 lg:flex-row">
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <StatusBadge tone="warning">{`Offline — ${snapshot.store.name}`}</StatusBadge>
          <p className="text-xs text-text-muted">
            {queueCounts.queued} queued{queueCounts.conflict > 0 ? `, ${queueCounts.conflict} needs review` : ""}
          </p>
        </div>

        <SearchField label="Search offline catalog" placeholder="Search by name, code or barcode…" value={searchTerm} onChange={setSearchTerm} />
        {searchTerm.trim() && (
          <div className="max-h-48 overflow-y-auto rounded-[var(--radius-panel)] border border-border-strong">
            {filteredItems.map((item) => (
              <button
                key={item.itemId}
                type="button"
                onClick={() => addLine(item.itemId)}
                disabled={item.lastKnownQuantity <= 0}
                className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-surface-muted disabled:opacity-40"
              >
                <span>
                  {item.name} <span className="text-text-muted">({item.code})</span>
                </span>
                <span className="tabular-nums">
                  {money(snapshot.store.currencyCode, String(item.unitPrice))} · {item.lastKnownQuantity} last known
                </span>
              </button>
            ))}
            {filteredItems.length === 0 && <p className="px-3 py-2 text-sm text-text-muted">No matches in the offline snapshot.</p>}
          </div>
        )}

        <div className="flex-1 overflow-y-auto rounded-[var(--radius-panel)] border border-border-strong">
          {lines.length === 0 ? (
            <p className="p-6 text-center text-sm text-text-muted">Cart is empty — search the offline catalog to begin.</p>
          ) : (
            lines.map((line) => (
              <div key={line.itemId} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-0">
                <div className="flex-1">
                  <p className="text-sm font-medium text-text">{line.name}</p>
                  <p className="text-xs text-text-muted">{money(snapshot.store.currencyCode, String(line.capturedUnitPrice))} each (snapshot price)</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="compact" onPress={() => changeQuantity(line.itemId, -1)} aria-label="Decrease quantity">
                    <Minus className="size-3.5" aria-hidden="true" />
                  </Button>
                  <span className="w-8 text-center tabular-nums">{line.quantity}</span>
                  <Button variant="outline" size="compact" onPress={() => changeQuantity(line.itemId, 1)} aria-label="Increase quantity">
                    <Plus className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
                <span className="w-24 text-right tabular-nums">{money(snapshot.store.currencyCode, String(line.quantity * line.capturedUnitPrice))}</span>
                <Button variant="ghost" size="compact" onPress={() => removeLine(line.itemId)} aria-label="Remove line">
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex w-full flex-col gap-4 lg:w-96">
        <div className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-xs text-warning">
          <p className="font-medium">Unsupported while offline:</p>
          <ul className="ml-4 list-disc">
            {snapshot.unsupportedOperations.map((operation) => (
              <li key={operation.code}>{operation.label}</li>
            ))}
          </ul>
        </div>

        {canDiscount && (
          <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border-strong p-3">
            <p className="text-sm font-medium text-text">Manual discount (amount, split across lines)</p>
            <NumberField label="Discount amount" value={discountAmount} onChange={setDiscountAmount} minValue={0} step={0.01} />
            <TextField label="Reason" value={discountReason} onChange={setDiscountReason} />
          </div>
        )}

        <div className="flex flex-col gap-1 rounded-[var(--radius-panel)] border border-border-strong bg-surface p-4 text-sm">
          <div className="flex items-center justify-between text-text-secondary">
            <span>Subtotal (estimate)</span>
            <span className="tabular-nums">{money(snapshot.store.currencyCode, String(totalsWithDiscount.subtotal))}</span>
          </div>
          <div className="flex items-center justify-between text-text-secondary">
            <span>Tax (estimate)</span>
            <span className="tabular-nums">{money(snapshot.store.currencyCode, String(totalsWithDiscount.taxTotal))}</span>
          </div>
          <div className="mt-1 flex items-center justify-between border-t border-border pt-2 text-base font-semibold text-text">
            <span>Total (estimate)</span>
            <span className="tabular-nums">{money(snapshot.store.currencyCode, String(totalsWithDiscount.grandTotal))}</span>
          </div>
        </div>

        <NumberField label="Cash tendered" value={cashTendered} onChange={setCashTendered} minValue={0} step={0.01} />
        <p className="text-sm text-text-secondary">Change (estimate): {money(snapshot.store.currencyCode, String(Math.max(0, cashTendered - totalsWithDiscount.grandTotal)))}</p>

        <Button
          variant="primary"
          onPress={commitOfflineSale}
          isDisabled={lines.length === 0 || cashTendered < totalsWithDiscount.grandTotal}
          isLoading={committing}
        >
          Queue cash sale (offline)
        </Button>
      </div>
    </div>
  );
}

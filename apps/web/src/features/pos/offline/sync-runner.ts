"use client";

// F298 — drains the local offline queue against POST /api/pos/offline/sync
// and updates each local record's state (queued -> syncing ->
// accepted/conflict/error). A record is only ever removed from local
// storage once the server has confirmed it `accepted` or an operator has
// explicitly resolved its conflict as `voided` (see resolvePosOfflineSync
// Conflict) -- never on a bare network success/failure of the batch call
// itself, and a conflict is kept locally (status 'conflict') so the
// cashier can see it is not silently lost, even though resolving it
// happens on the server-side conflict queue (apps/web/src/features/pos/
// offline/screens/PosOfflineSyncConflictsScreen.tsx), which any authorized
// device can act on, not necessarily the one that captured the sale.
import { listOfflineQueue, removeOfflineSale, updateOfflineSale } from "./db";
import { syncOfflinePosSales, type PosOfflineSyncTransaction } from "@/features/pos/offline/api/offline-api";
import type { PosOfflineQueuedSale } from "./types";

function toSyncTransaction(sale: PosOfflineQueuedSale): PosOfflineSyncTransaction {
  return {
    localTransactionId: sale.localTransactionId,
    storeId: sale.storeId,
    terminalId: sale.terminalId,
    shiftId: sale.shiftId,
    lines: sale.lines.map((line) => ({
      itemId: line.itemId,
      variantId: line.variantId,
      quantity: line.quantity,
      capturedUnitPrice: line.capturedUnitPrice,
      discountAmount: line.discountAmount,
      discountReason: line.discountReason,
      description: line.description,
    })),
    payments: sale.payments,
    capturedAt: sale.capturedAt,
  };
}

export type OfflineSyncPassResult = { synced: number; conflicts: number; errors: number; total: number };

export async function runOfflineSyncPass(): Promise<OfflineSyncPassResult> {
  const queue = await listOfflineQueue();
  // Interrupted-sync recovery (found via real-browser testing): a sale is
  // marked "syncing" BEFORE the network call is sent, and only reverted
  // back to "queued" in this function's own catch block below if that
  // call rejects cleanly. A tab close, browser crash, or a request
  // aborted by the browser itself mid-flight (observed here as a real
  // net::ERR_ABORTED) never reaches that catch -- the record was
  // permanently stuck at "syncing" forever, since this function's own
  // pending filter never included it again on any later pass. Retrying a
  // "syncing" record is safe: the server's own sync endpoint is
  // idempotent per localTransactionId (F298's own "replaying the SAME
  // local transaction id is a safe no-op" guarantee), so there is no
  // double-submission risk in treating a leftover "syncing" status the
  // same as "queued"/"error".
  const pending = queue.filter((sale) => sale.status === "queued" || sale.status === "error" || sale.status === "syncing");
  if (pending.length === 0) return { synced: 0, conflicts: 0, errors: 0, total: 0 };

  await Promise.all(pending.map((sale) => updateOfflineSale(sale.localTransactionId, { status: "syncing" })));

  let results;
  try {
    const response = await syncOfflinePosSales(pending.map(toSyncTransaction));
    results = response.results;
  } catch (error) {
    // The batch request itself failed (still offline, or a real server
    // error) -- revert to queued so the next pass retries, rather than
    // stranding these in "syncing" forever.
    await Promise.all(pending.map((sale) => updateOfflineSale(sale.localTransactionId, { status: "queued" })));
    throw error;
  }

  let synced = 0;
  let conflicts = 0;
  let errors = 0;
  for (const result of results) {
    if (result.outcome === "accepted") {
      await removeOfflineSale(result.localTransactionId);
      synced += 1;
    } else if (result.outcome === "voided") {
      await removeOfflineSale(result.localTransactionId);
    } else if (result.outcome === "conflict") {
      await updateOfflineSale(result.localTransactionId, { status: "conflict", conflictType: result.conflictType, lastSyncError: result.detail });
      conflicts += 1;
    } else {
      await updateOfflineSale(result.localTransactionId, { status: "error", lastSyncError: result.detail });
      errors += 1;
    }
  }
  return { synced, conflicts, errors, total: pending.length };
}

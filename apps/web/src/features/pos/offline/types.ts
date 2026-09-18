// F297/F298 — offline POS workspace + offline-to-online sync. Shared
// client-side types. Field names intentionally mirror the server's own
// PosOfflineSnapshot/PosOfflineSyncInput shapes (services/api/src/modules/
// point-of-sale/index.d.ts) so the payload sent to /api/pos/offline/sync
// needs no field renaming/translation layer.

export type PosOfflineUnsupportedOperation = { code: string; label: string; reason: string };

export type PosOfflineSnapshotItem = {
  itemId: string;
  code: string;
  name: string;
  barcode: string | null;
  taxCategoryId: string | null;
  unitPrice: number;
  minimumQuantity: number;
  lastKnownQuantity: number;
};

export type PosOfflineSnapshot = {
  version: string;
  generatedAt: string;
  store: { id: string; code: string; name: string; warehouseId: string; currencyCode: string; priceListId: string | null };
  policy: { allowNegativeStock: boolean; maxLineDiscountPercent: number };
  items: PosOfflineSnapshotItem[];
  itemLimit: number;
  itemLimitReached: boolean;
  taxRatesByCategory: Array<{ taxCategoryId: string; rate: number }>;
  cashierPermissions: string[];
  unsupportedOperations: PosOfflineUnsupportedOperation[];
  encryptionSeed: string;
};

export type PosOfflineLine = {
  itemId: string;
  variantId?: string | null;
  code: string;
  name: string;
  quantity: number;
  capturedUnitPrice: number;
  taxCategoryId: string | null;
  discountAmount?: number | null;
  discountReason?: string | null;
  description?: string | null;
};

export type PosOfflineSyncOutcome = "accepted" | "conflict" | "voided" | "error";

// The full local queue record. `status` mirrors the task brief's lifecycle:
// queued -> syncing -> accepted/conflict/rejected -> reconciled. "rejected"
// and "reconciled" are represented here as terminal `conflict`/`voided`
// states once a human has resolved them server-side (see sync-runner.ts).
export type PosOfflineQueuedSale = {
  localTransactionId: string; // globally-unique client-generated UUID -- see crypto.randomUUID() usage in useOfflineCheckout.ts
  storeId: string;
  terminalId: string | null;
  shiftId: string;
  cashierUserId: string;
  currencyCode: string;
  lines: PosOfflineLine[];
  payments: Array<{ method: "cash"; amount: number }>;
  capturedAt: string;
  snapshotVersion: string;
  status: "queued" | "syncing" | "accepted" | "conflict" | "voided" | "error";
  lastSyncError: string | null;
  serverSaleId: string | null;
  conflictType: string | null;
  // Frozen client-side totals, for the offline receipt ONLY -- never sent
  // as a trusted total to the server (see canonicalOfflineSyncPayload in
  // services/api/src/modules/point-of-sale/index.js, which recomputes
  // every figure fresh from current Postgres state at sync time).
  capturedTotals: { subtotal: number; taxTotal: number; discountTotal: number; grandTotal: number };
};

export type PosOfflineSyncResult =
  | { outcome: "accepted"; localTransactionId: string; sale: { id: string; receipt_number?: string; grand_total?: string }; replayed: boolean }
  | { outcome: "conflict"; localTransactionId: string; conflictId: string; conflictType: string; detail: string | null; replayed: boolean }
  | { outcome: "voided"; localTransactionId: string; conflictId: string; detail: string | null; replayed: boolean }
  | { outcome: "error"; localTransactionId: string; status: number; code: string; detail: string };

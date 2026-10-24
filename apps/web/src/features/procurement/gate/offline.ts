"use client";

// Receiving at the gate, offline (report Phase 4): what the phone needs when the network drops, kept in this browser's IndexedDB per
// company — today's expected orders and their lines (refreshed whenever online), and receipts finished while offline, waiting to be sent.
// A waiting receipt carries its own request key, so sending it twice records it once; its photos are shrunk before they are kept.
import type { PurchaseOrderRow, Receivable } from "@/features/procurement/purchase-orders/api/purchase-orders-api";

export type QueuedPhoto = { name: string; type: string; data: Blob };
export type QueuedReceipt = {
  key: string; organizationId: string; orderId: string; orderNumber: string; supplierName: string; payload: Record<string, unknown>; photos: QueuedPhoto[];
  createdAt: string; receiptId?: string; receiptNumber?: string; error?: string;
};
export type GateCache = { savedAt: string; orders: PurchaseOrderRow[]; receivables: Record<string, Receivable> };

const DB = "vercent-gate";
const QUEUE = "queue";
const CACHE = "cache";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: "key" });
        if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, work: (objects: IDBObjectStore) => IDBRequest<T> | null): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(store, mode);
      const request = work(transaction.objectStore(store));
      transaction.oncomplete = () => { db.close(); resolve(request ? (request.result as T) : null); };
      transaction.onerror = () => { db.close(); resolve(null); };
      transaction.onabort = () => { db.close(); resolve(null); };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export const saveCache = (organizationId: string, cache: GateCache) => run(CACHE, "readwrite", (objects) => objects.put(cache, organizationId));
export const readCache = (organizationId: string) => run<GateCache>(CACHE, "readonly", (objects) => objects.get(organizationId));
export const queueReceipt = (entry: QueuedReceipt) => run(QUEUE, "readwrite", (objects) => objects.put(entry));
export const dropQueued = (key: string) => run(QUEUE, "readwrite", (objects) => objects.delete(key));
export async function listQueued(organizationId: string): Promise<QueuedReceipt[]> {
  const all = (await run<QueuedReceipt[]>(QUEUE, "readonly", (objects) => objects.getAll())) ?? [];
  return all.filter((entry) => entry.organizationId === organizationId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// A photo at most 1600 px on its longer side, as JPEG: enough to show damage, small enough to keep and send from the gate.
export async function shrinkPhoto(file: File): Promise<QueuedPhoto> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.75));
    if (blob) return { name: file.name.replace(/\.[^.]+$/, "") + ".jpg", type: "image/jpeg", data: blob };
  } catch {
    // Not an image the browser can draw: kept as it is.
  }
  return { name: file.name, type: file.type || "application/octet-stream", data: file };
}

// A network failure (offline, the server unreachable), as opposed to the server refusing the receipt.
export const isNetworkError = (error: unknown) => (typeof navigator !== "undefined" && !navigator.onLine) || error instanceof TypeError;

// A GS1 barcode on a carton (GS1-128 or DataMatrix): its batch (AI 10) and expiry (AI 17, YYMMDD), with or without the brackets.
// Anything else is taken as the batch number itself.
export function readBatchCode(raw: string): { batch: string | null; expiry: string | null } {
  const text = raw.trim().replace(/^\]([CdQe][0-9])/, "");
  const separator = "\u001d";
  const fields: Record<string, string> = {};
  if (/^\(\d{2,4}\)/.test(text)) {
    for (const match of text.matchAll(/\((\d{2,4})\)([^(]*)/g)) fields[match[1]] = match[2];
  } else if (/^(01|10|17|11|21)\d/.test(text)) {
    const fixed: Record<string, number> = { "01": 14, "11": 6, "15": 6, "17": 6 };
    let rest = text;
    while (rest.length > 2) {
      const ai = rest.slice(0, 2);
      if (fixed[ai]) { fields[ai] = rest.slice(2, 2 + fixed[ai]); rest = rest.slice(2 + fixed[ai]); continue; }
      if (ai === "10" || ai === "21") { const end = rest.indexOf(separator, 2); fields[ai] = rest.slice(2, end < 0 ? undefined : end); rest = end < 0 ? "" : rest.slice(end + 1); continue; }
      break;
    }
  }
  const expiry = fields["17"] && /^\d{6}$/.test(fields["17"])
    ? (() => {
      const [yy, mm, dd] = [fields["17"].slice(0, 2), fields["17"].slice(2, 4), fields["17"].slice(4, 6)];
      const day = dd === "00" ? String(new Date(Date.UTC(2000 + Number(yy), Number(mm), 0)).getUTCDate()).padStart(2, "0") : dd;
      return `20${yy}-${mm}-${day}`;
    })()
    : null;
  if (fields["10"] || expiry) return { batch: fields["10"]?.replace(new RegExp(separator, "g"), "") || null, expiry };
  return { batch: text || null, expiry: null };
}

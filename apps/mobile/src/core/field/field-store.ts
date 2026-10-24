// Field sales on the phone (Sales report Phase 4): the day's beat cached for offline use, and orders and collections that go straight
// to the server when there is a connection, else wait in the offline queue until Sync. Each carries the phone's own key, so a sync that
// sends one twice is saved once on the server.
import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import { VercentlabsApiError } from "@vercentlabs/shared-sdk";

import { mobileApi } from "@/core/api/client";
import {
  enqueueMutation,
  failMutation,
  markMutationSending,
  pendingMutations,
  readCache,
  resolveMutation,
  writeCache,
} from "@/core/database/database";

export type FieldProduct = { id: string; code: string; name: string; uomId: string | null; unit: string | null; price: number | null; mrp: number | null };
export type FieldRetailer = { id: string; name: string; number: string | null; phone: string | null; beatId: string | null; due: number; orderedToday: boolean;
  lastOrder: { itemId: string; quantity: number; uomId: string | null }[] };
export type FieldDay = { date: string; beats: { id: string; code: string; name: string }[]; retailers: FieldRetailer[]; products: FieldProduct[] };
export type FieldOrderInput = { partyId: string; lines: { itemId: string; quantity: number; uomId?: string }[]; note?: string; orderDate: string };
export type FieldCollectionInput = { partyId: string; amount: number; method: "cash" | "cheque" | "upi"; chequeNumber?: string; chequeDate?: string; reference?: string };
export type FieldOrderResult = { orderNumber: string; total: number; confirmed: boolean; problems: string[]; freeGoods: { name: string; quantity: number }[] };
export type FieldCollectionResult = { receiptNumber: string | null; postDated: boolean; amount: number; whatsappUrl: string; whatsappText: string };
export type FieldSummary = { date: string; orders: { count: number; total: number }; collected: { total: number; byMethod: { method: string; label: string; count: number; total: number }[] };
  retailers: { onBeat: number; seen: number } };

const DAY_CACHE = "sales.field.day";
const ORDER = "sales.field.order";
const COLLECTION = "sales.field.collection";

export async function online() {
  const state = await Network.getNetworkStateAsync().catch(() => null);
  return Boolean(state?.isConnected && state.isInternetReachable !== false);
}

export const todayOnPhone = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

// The day: fresh when online (and cached), else the last one cached. { day, cachedAt, offline }.
export async function loadFieldDay(): Promise<{ day: FieldDay | null; cachedAt: number | null; offline: boolean }> {
  if (await online()) {
    try {
      const day = await mobileApi.apiRequest<FieldDay & { ok?: boolean }>("/sales/field/day");
      await writeCache(DAY_CACHE, "sales.field", day);
      return { day, cachedAt: Date.now(), offline: false };
    } catch (error) {
      if (!(error instanceof VercentlabsApiError) || error.retryable === false) throw error;
    }
  }
  const cached = await readCache<FieldDay>(DAY_CACHE);
  return { day: cached?.data ?? null, cachedAt: cached?.cachedAt ?? null, offline: true };
}

const post = <T>(path: string, body: unknown, idempotencyKey: string) =>
  mobileApi.apiRequest<T>(path, { method: "POST", body: JSON.stringify(body) }, { idempotencyKey });

// Saves now when online, else queues. { sent: true, result } or { sent: false } (waiting for Sync).
async function sendOrQueue<T>(resource: string, path: string, input: Record<string, unknown>) {
  const key = `phone-${Crypto.randomUUID()}`;
  const body = { ...input, idempotencyKey: key };
  if (await online()) {
    try {
      return { sent: true as const, result: await post<T>(path, body, key) };
    } catch (error) {
      // A refusal (no permission, a bad amount) is shown now; a lost connection waits in the queue.
      if (error instanceof VercentlabsApiError && error.status >= 400 && error.status < 500) throw error;
    }
  }
  await enqueueMutation({ id: key, operation: "create", resource, payload: { path, body }, idempotencyKey: key });
  return { sent: false as const };
}

export const takeOrder = (input: FieldOrderInput) => sendOrQueue<FieldOrderResult>(ORDER, "/sales/field/orders", input);
export const collectPayment = (input: FieldCollectionInput) => sendOrQueue<FieldCollectionResult>(COLLECTION, "/sales/field/collections", input);

// What is waiting to be sent, by kind.
export async function waiting() {
  const rows = (await pendingMutations()).filter((row) => row.resource === ORDER || row.resource === COLLECTION);
  return { orders: rows.filter((row) => row.resource === ORDER).length, collections: rows.filter((row) => row.resource === COLLECTION).length };
}

// Sends what is waiting. Returns { sent, failed, receipts } — receipts: collections now saved, to send on WhatsApp.
export async function syncField() {
  const rows = (await pendingMutations()).filter((row) => row.resource === ORDER || row.resource === COLLECTION);
  let sent = 0;
  let failed = 0;
  const receipts: FieldCollectionResult[] = [];
  for (const row of rows) {
    const { path, body } = JSON.parse(row.payload) as { path: string; body: unknown };
    await markMutationSending(row.id);
    try {
      const result = await post<FieldOrderResult | FieldCollectionResult>(path, body, row.idempotencyKey);
      await resolveMutation(row.id);
      if (row.resource === COLLECTION) receipts.push(result as FieldCollectionResult);
      sent += 1;
    } catch (error) {
      failed += 1;
      const status = error instanceof VercentlabsApiError ? error.status : undefined;
      await failMutation(row.id, (error as Error).message ?? "Not sent", { retryable: !(status && status >= 400 && status < 500 && status !== 409 && status !== 429), httpStatus: status });
    }
  }
  return { sent, failed, receipts };
}

export const loadFieldSummary = () => mobileApi.apiRequest<FieldSummary>("/sales/field/summary");

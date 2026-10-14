"use client";

// Material Availability: the client of /api/manufacturing/orders/[id]/{material-availability, reservation-preview, material-shortage-requests,
// issue-readiness}, /api/manufacturing/material-shortages, /api/manufacturing/material-reports and a BOM revision's availability.
import { call, orderAction, qs } from "@/features/manufacturing/orders/api/mo-api";

export type Readiness = "READY" | "PARTIALLY_READY" | "SHORTAGE" | "AWAITING_RECEIPT" | "BLOCKED" | "UNKNOWN";
export type LineStatus = "READY" | "RESERVABLE" | "AWAITING_RECEIPT" | "SHORTAGE" | "BLOCKED";
export type IncomingSource = { source: "PURCHASE_ORDER" | "TRANSFER" | "CHILD_ORDER"; reference: string; id: string; quantity: string; expected: string | null };
export type AvailabilityLine = {
  materialId: string; lineNumber: number; itemId: string; code: string; name: string; uom: string; kind: "MATERIAL" | "SUBASSEMBLY"; origin: "RECIPE" | "EXTRA"; trackingType: string;
  required: string; consumed: string; remaining: string; inProduction: string; reserved: string; newlyAvailable: string; shortage: string; incoming: string; expectedAt: string | null;
  incomingSources: IncomingSource[]; requested: Array<{ number: string; status: string; quantity: string }>; status: LineStatus; statusLabel: string; blockers: string[];
  eligibility: { excluded: Array<{ reason: string; quantity: string }>; batches?: unknown; serials?: { usable: string } | null };
  alternates: Array<{ warehouseId: string; warehouse: string; available: string }> | null;
  covered: { allocated: string; feasible: string };
};
export type Availability = {
  orderId: string; orderNumber: string; orderStatus: string; orderStatusLabel: string; warehouse: { id: string; code: string; name: string };
  plannedOutput: string; acceptedOutput: string; remainingOutput: string; maximumFeasibleOutput: string; allocatedFeasibleOutput: string; unfeasibleOutput: string; limiting: string[];
  readiness: Readiness; readinessLabel: string; allocation: "FULLY_ALLOCATED" | "PARTIALLY_ALLOCATED" | "NOT_ALLOCATED"; availabilityAuthoritative: boolean; failure: string | null; nextAction: string;
  partialProduction: { allowed: boolean; note: string }; shortages: number; calculatedAt: string; inventory: { version: number; changedAt: string | null; cursor: number }; changedSince: boolean | null;
  materials: AvailabilityLine[]; can: { reserve: boolean; requestShortages: boolean; seeAlternates: boolean; export: boolean };
};
export type ReservationPreview = { orderId: string; complete: boolean; previewOnly: true;
  lines: Array<{ itemId: string; code: string; uom: string; wanted: string; reservable: string; short: string; note: string | null }> };
export type ShortageRequestResult = { orderId: string; created: Array<{ number: string; code: string; quantity: string; alreadyRequested: string; incoming: string }>;
  existing: Array<{ code: string; requested: string; demands: string[] }>; message?: string };
export type ShortageRow = {
  orderId: string; orderNumber: string; orderStatus: string; orderStatusLabel: string; warehouseId: string; warehouse: string; materialId: string; itemId: string; code: string; name: string; uom: string;
  kind: string; remaining: string; covered: string; shortage: string; incoming: string; expectedAt: string | null; requested: Array<{ number: string; status: string; quantity: string }>;
  status: LineStatus; statusLabel: string; requiredBy: string; ageDays: number;
};
export type BomAvailability = { revisionId: string; warehouseId: string; plannedQuantity: string; plannedUom: string; maximumFeasible: string; shortages: number; previewOnly: true;
  lines: Array<{ itemId: string; code: string; name: string; uom: string; kind: string; required: string; available: string; shortage: string }>; assumptions: string[] };

export const READINESS_TONE: Record<Readiness, "success" | "warning" | "danger" | "neutral" | "info"> = {
  READY: "success", PARTIALLY_READY: "warning", AWAITING_RECEIPT: "info", SHORTAGE: "danger", BLOCKED: "danger", UNKNOWN: "neutral",
};
export const LINE_TONE: Record<LineStatus, "success" | "warning" | "danger" | "neutral" | "info"> = {
  READY: "success", RESERVABLE: "info", AWAITING_RECEIPT: "warning", SHORTAGE: "danger", BLOCKED: "danger",
};
export const SOURCE_LABEL: Record<IncomingSource["source"], string> = { PURCHASE_ORDER: "Purchase order", TRANSFER: "Transfer", CHILD_ORDER: "Subassembly order" };
export const EXCLUDED_LABEL: Record<string, string> = {
  quality_hold: "on quality hold", quarantine: "quarantined", damaged: "damaged", expired: "expired", blocked: "blocked", inactive_location: "in an inactive location",
};

export const getAvailability = (orderId: string, since?: number) =>
  call<{ availability: Availability }>(`/orders/${orderId}/material-availability${qs({ since: since === undefined ? undefined : String(since) })}`).then((r) => r.availability);
export const previewReservation = (orderId: string) => call<{ preview: ReservationPreview }>(`/orders/${orderId}/reservation-preview`).then((r) => r.preview);
export const requestShortages = (orderId: string, input: { materialIds?: string[]; idempotencyKey?: string } = {}) =>
  orderAction<ShortageRequestResult>(orderId, "material-shortage-requests", input);
export const listShortages = (filters: { warehouseId?: string; itemId?: string; status?: string }) =>
  call<{ shortages: ShortageRow[] }>(`/material-shortages${qs(filters)}`).then((r) => r.shortages);
export const materialReport = <T = Record<string, unknown>>(kind: string) => call<{ rows: T[] }>(`/material-reports${qs({ kind })}`).then((r) => r.rows);
export const bomAvailability = (bomId: string, revisionId: string, input: { plannedQuantity: string; warehouseId: string; policy?: string }) =>
  call<{ availability: BomAvailability }>(`/boms/${bomId}/revisions/${revisionId}/availability${qs(input)}`).then((r) => r.availability);

export const SHORTAGES_PATH = "/manufacturing/material-shortages";
export const REPORTS_PATH = "/manufacturing/material-reports";

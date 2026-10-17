"use client";

import { AssetApiError, qs } from "../register/register-api";

// Assets — the client of /api/assets/locations.
export const LOCATIONS_BASE = "/assets/locations";
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/assets/locations${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AssetApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload as T;
}
const send = <T = Record<string, unknown>>(path: string, body: unknown = {}, method = "POST") => call<T>(path, { method, body: JSON.stringify(body) });

export type Location = { id: string; code: string; name: string; path: string; kind: string; kindLabel: string; parentId: string | null; siteId: string; site: string | null; depth: number;
  description: string | null; floorRoom: string | null; address: string | null; managerUserId: string | null; manager: string | null; externalPartyId: string | null; externalParty: string | null;
  external: boolean; isAssetStore: boolean; active: boolean; directAssets: number; subtreeAssets: number; children: number; version: number; createdAt: string; href: string };
export type LocationCan = { create: boolean; edit: boolean; deactivate: boolean; hierarchy: boolean; history: boolean; review: boolean; export: boolean };
export type LocationDetail = Location & { parent: { id: string; path: string; active: boolean } | null; childLocations: Location[]; can: LocationCan };
export type DeactivationPreview = { directAssets: number; subtreeAssets: number; activeChildren: number; pendingTransfers: number; openMaintenance: number; openDiscrepancies: number; historicalAssets: number;
  blocking: string[]; canDeactivate: boolean; warnings: string[] };
export type Discrepancy = { id: string; number: string; assetId: string; asset: string; expected: string; observed: string | null; observedLocationId: string | null; source: string; status: string; statusLabel: string;
  reportedBy: string | null; reportedAt: string; resolvedBy: string | null; resolution: string | null; href: string };
export type Observation = { id: string; kind: string; kindLabel: string; location: string | null; at: string; until: string | null; ended: string | null; reason: string | null; by: string | null; differs: boolean };
export type AssetLocationView = { assetId: string; version: number; registeredLocationId: string | null; registeredLocation: string | null; custodian: string | null; department: string | null; lifecycle: string; lifecycleLabel: string;
  pendingDestination: { transfer: string; to: string | null; since: string; status: string } | null; currentWhereabouts: Observation | null; lastSighting: Observation | null; lastVerifiedAt: string | null;
  discrepancy: { id: string; number: string; expected: string | null; observed: string | null; reportedAt: string; source: string } | null; observations: Observation[];
  history: Array<{ id: string; from: string | null; to: string | null; event: string; eventLabel: string; reason: string | null; by: string | null; at: string; effective: string | null }>;
  note: string; can: { observe: boolean; review: boolean; correct: boolean; transfer: boolean } };
export type BulkLocationResult = { succeeded: number; failed: number; results: Array<{ assetId: string; assetNumber: string | null; ok: boolean; errorCode?: string; message?: string }> };

export const listLocations = (filters: Record<string, string | undefined>) => call<{ rows: Location[]; can: LocationCan }>(qs(filters));
export const getLocation = (id: string) => call<{ location: LocationDetail }>(`/${id}`).then((r) => r.location);
export const getLocationChanges = (id: string) => call<{ changes: Array<{ id: string; action: string; changes: Record<string, unknown>; reason: string | null; by: string | null; at: string }>;
  movements: Array<{ id: string; asset: string; assetId: string; direction: "IN" | "OUT"; event: string; by: string | null; at: string }> }>(`/${id}/history`);
export const getChoices = () => call<{ rows: Array<{ id: string; code: string; name: string; shortName: string; kind: string }> }>("/actions/choices").then((r) => r.rows);
export const getDiscrepancies = (status: string) => call<{ rows: Discrepancy[]; can: { review: boolean } }>(`/actions/discrepancies${qs({ status })}`);
export const getLocationReport = <T = Record<string, unknown>>(kind: string) => call<{ rows: T[] }>(`/actions/report${qs({ kind })}`).then((r) => r.rows);
export const createLocation = (input: Record<string, unknown>) => send<{ locationId: string; code: string }>("", input);
export const updateLocation = (id: string, input: Record<string, unknown>) => send<{ version: number; changed: string[] }>(`/${id}`, input, "PATCH");
export const locationAction = <T = Record<string, unknown>>(id: string, action: string, input: Record<string, unknown> = {}) => send<T>(`/${id}/${action}`, input);
export const resolveDiscrepancy = (input: Record<string, unknown>) => send<{ status: string }>("/actions/resolve-discrepancy", input);
export const bulkLocation = (action: "initial-location" | "bulk-transfer", input: Record<string, unknown>) => send<BulkLocationResult>(`/actions/${action}`, input);
export const locationsExportHref = "/api/assets/locations/export";
export const KINDS: Record<string, string> = { OFFICE: "Office", FACTORY: "Factory", WAREHOUSE: "Warehouse / storage", ROOM_OR_AREA: "Room or area", CUSTOMER_SITE: "Customer site", REPAIR_FACILITY: "Repair facility", OTHER: "Other" };

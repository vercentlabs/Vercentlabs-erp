import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
type Lookup = { refresh?: boolean; fetchImpl?: typeof fetch; env?: Record<string, string | undefined> };
export type GstinCheck = {
  gstin: string; status: "active" | "cancelled" | "suspended" | "inactive" | "not_found" | "unknown"; statusLabel: string; legalName: string | null; tradeName: string | null;
  registeredOn: string | null; cancelledOn: string | null; taxpayerType: string | null; address: Record<string, string | null>; provider: string; checkedAt: string;
};
export const GSTIN_STATUS_LABELS: Readonly<Record<string, string>>;
export function gstLookupConfigured(env?: Record<string, string | undefined>): boolean;
export function readRegisterAnswer(body: unknown, gstin: string): Record<string, any> | null;
export function latestGstinCheck(client: QueryClient, organizationId: string, gstin: string): Promise<GstinCheck | null>;
export function verifyGstin(client: QueryClient, context: CrmContext, gstin: string, options?: Lookup): Promise<{ gstin: string; valid: boolean; formatError?: string; configured: boolean; check: GstinCheck | null; cached?: boolean }>;
export function lookupCompanyByGstin(client: QueryClient, context: CrmContext, gstin: string, options?: Lookup): Promise<{
  gstin: string; configured: boolean; status: string; statusLabel: string; displayName: string | null; legalName: string | null; pan: string | null; address: Record<string, string | null>;
}>;
export function verifyAccountGstin(client: QueryClient, context: CrmContext, partyId: string, options?: Lookup): Promise<{
  gstin: string; valid: boolean; configured: boolean; check: GstinCheck | null; warnings: Array<{ code: string; message: string }>;
}>;
// A company's own GST lookup provider (CRM audit).
export type CrmGstLookupSettings = { own: boolean; url: string | null; keyHeader: string; keySet: boolean; platform: boolean; recent: Array<Record<string, any>> };
export function gstLookupConfiguredFor(client: QueryClient, organizationId: string, env?: Record<string, string | undefined>): Promise<boolean>;
export function getGstLookupSettings(client: QueryClient, context: CrmContext, runtime?: { env?: Record<string, string | undefined> }): Promise<CrmGstLookupSettings>;
export function testGstLookup(client: QueryClient, context: CrmContext, input: Record<string, unknown>, runtime?: { fetchImpl?: typeof fetch; env?: Record<string, string | undefined> }): Promise<{ gstin: string; status: string; statusLabel: string; legalName: string | null; tradeName: string | null; registeredOn: string | null; address: Record<string, string | null> }>;
export function saveGstLookupSettings(client: QueryClient, context: CrmContext, input: Record<string, unknown>, runtime?: { env?: Record<string, string | undefined> }): Promise<CrmGstLookupSettings>;

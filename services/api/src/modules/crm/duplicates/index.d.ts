import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};

export type DuplicateRecordType = "lead" | "contact" | "account";
export type DuplicateMatchReason = { signal: string; label: string; strong: boolean };
export type DuplicateMatch = {
  kind?: DuplicateRecordType; id: string; signals: string[]; strength: "exact" | "possible"; matchStrength: "strong" | "possible"; score: number;
  reasons: DuplicateMatchReason[]; canOpen: boolean; name?: string | null; code?: string | null; [detail: string]: unknown;
};
export type DuplicateResult = { matches: DuplicateMatch[]; hasBlockingMatch: boolean; override?: { reason: string; matches: DuplicateMatch[] } };
export type DuplicateQueueType = "lead_lead" | "lead_contact" | "contact_contact" | "account_account";
export type DuplicateQueueRecord = {
  type: DuplicateRecordType; id: string; code: string | null; name: string | null; detail: string | null; email: string | null; ownerName: string | null; createdAt: string;
};
export type DuplicateQueuePair = {
  type: DuplicateQueueType; a: DuplicateQueueRecord; b: DuplicateQueueRecord; signals: string[]; matchStrength: "strong" | "possible"; score: number;
  reasons: DuplicateMatchReason[]; canMerge: boolean;
};

export const DUPLICATE_PERMISSIONS: Readonly<{ override: "crm.duplicates.override"; review: "crm.duplicates.review" }>;
export const DUPLICATE_RECORD_TYPES: ReadonlyArray<DuplicateRecordType>;
export const DUPLICATE_QUEUE_TYPES: ReadonlyArray<{ code: DuplicateQueueType; label: string }>;
export const DUPLICATE_SIGNALS: Readonly<Record<DuplicateRecordType, Record<string, { label: string; weight: number; strong: boolean }>>>;

export function normalizeEmail(value: unknown): string | null;
export function normalizePhone(value: unknown): string | null;
export function normalizeCompanyName(value: unknown): string | null;
export function normalizeDomain(value: unknown): string | null;
export function normalizeGstin(value: unknown): string | null;
export function gradeMatch(kind: DuplicateRecordType, signals: string[]): Pick<DuplicateMatch, "strength" | "matchStrength" | "score" | "reasons">;
export function canOverrideDuplicates(context: CrmContext): boolean;

export function findDuplicates(client: QueryClient, context: CrmContext, type: DuplicateRecordType, input: Record<string, unknown>, options?: { excludeId?: string | null; limit?: number }): Promise<DuplicateResult>;
export function checkBeforeCreate(client: QueryClient, context: CrmContext, type: DuplicateRecordType, input: Record<string, unknown>, options?: { excludeId?: string | null; allowDuplicate?: boolean; reason?: string | null }): Promise<DuplicateResult>;
export function checkBeforeConversion(client: QueryClient, context: CrmContext, lead: Record<string, unknown>): Promise<{ account: DuplicateResult; contact: DuplicateResult }>;
export function checkImportRow(client: QueryClient, context: CrmContext, type: DuplicateRecordType, input: Record<string, unknown>): Promise<{ outcome: "create" | "possible" | "strong"; match: DuplicateMatch | null; matchingRecord: string | null; matchField: string | null }>;
export function importDuplicateColumns(match: DuplicateMatch | null): { matchingRecord: string | null; matchField: string | null };
export function recordDuplicateOverride(client: QueryClient, context: CrmContext, recordType: DuplicateRecordType, recordId: string, result: DuplicateResult): Promise<void>;
export function markNotDuplicate(client: QueryClient, context: CrmContext, input: { recordTypeA: string; recordIdA: string; recordTypeB: string; recordIdB: string; reason?: string }): Promise<{ marked: boolean }>;
export function unmarkNotDuplicate(client: QueryClient, context: CrmContext, input: { recordTypeA: string; recordIdA: string; recordTypeB: string; recordIdB: string }): Promise<{ removed: boolean }>;
export function listDuplicateQueue(client: QueryClient, context: CrmContext, input?: { type?: string }): Promise<{ pairs: DuplicateQueuePair[]; counts: Record<DuplicateQueueType, number>; limit: number }>;

// Data Quality: what was already decided, and the rules in plain words.
type ReviewedRecord = { type: string; id: string; name: string; href: string };
export function listMergedRecords(client: QueryClient, context: CrmContext, options?: { limit?: number }):
  Promise<Array<{ id: string; type: string; merged: ReviewedRecord; kept: ReviewedRecord; mergedAt: string | null; mergedByName: string | null }>>;
export function listNotDuplicates(client: QueryClient, context: CrmContext, options?: { limit?: number }):
  Promise<Array<{ id: string; a: ReviewedRecord; b: ReviewedRecord; reason: string | null; decidedAt: string; decidedByName: string | null }>>;
export function getDuplicateRules(): {
  people: { label: string; rules: Array<{ signal: string; label: string; strength: "strong" | "possible" }> };
  companies: { label: string; rules: Array<{ signal: string; label: string; strength: "strong" | "possible" }> };
  behaviour: { strong: string; possible: string };
};

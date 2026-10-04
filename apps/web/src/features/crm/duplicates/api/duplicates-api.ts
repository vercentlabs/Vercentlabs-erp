"use client";

// Browser client for the duplicate review queue under /api/crm/duplicates.
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

import type { DuplicateReason } from "../DuplicateParts";

export class DuplicatesApiError extends CrmApiErrorWithBody {}

const { request } = crmApiClient(DuplicatesApiError, "body");

export type DuplicateRecordType = "lead" | "contact" | "account";
export type DuplicateQueueType = "lead_lead" | "lead_contact" | "contact_contact" | "account_account";

export type DuplicateQueueRecord = {
  type: DuplicateRecordType;
  id: string;
  code: string | null;
  name: string | null;
  detail: string | null;
  email: string | null;
  ownerName: string | null;
  createdAt: string;
};

export type DuplicateQueuePair = {
  type: DuplicateQueueType;
  a: DuplicateQueueRecord;
  b: DuplicateQueueRecord;
  signals: string[];
  matchStrength: "strong" | "possible";
  score: number;
  reasons: DuplicateReason[];
  canMerge: boolean;
};

export type DuplicateQueue = { pairs: DuplicateQueuePair[]; counts: Record<DuplicateQueueType, number>; limit: number };

const BASE = "/api/crm/duplicates";

export const listDuplicateQueue = (type?: DuplicateQueueType) =>
  request<{ queue: DuplicateQueue }>(`${BASE}${type ? `?type=${type}` : ""}`).then((result) => result.queue);

export const markNotDuplicate = (pair: DuplicateQueuePair, reason: string) =>
  request<{ marked: boolean }>(`${BASE}/not-duplicate`, {
    method: "POST",
    json: { recordTypeA: pair.a.type, recordIdA: pair.a.id, recordTypeB: pair.b.type, recordIdB: pair.b.id, reason },
  });

export function duplicatesErrorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}

// ---- Data Quality: what was already decided, and the rules
export type ReviewedRecord = { type: DuplicateRecordType; id: string; name: string; href: string };
export type MergedRecord = { id: string; type: DuplicateRecordType; merged: ReviewedRecord; kept: ReviewedRecord; mergedAt: string | null; mergedByName: string | null };
export type NotDuplicatePair = { id: string; a: ReviewedRecord; b: ReviewedRecord; reason: string | null; decidedAt: string; decidedByName: string | null };
export type DuplicateRule = { signal: string; label: string; strength: "strong" | "possible" };
export type DuplicateRules = {
  people: { label: string; rules: DuplicateRule[] };
  companies: { label: string; rules: DuplicateRule[] };
  behaviour: { strong: string; possible: string };
};

export const listMergedRecords = () => request<{ merged: MergedRecord[] }>(`${BASE}/merged`).then((result) => result.merged);
export const listNotDuplicates = () => request<{ pairs: NotDuplicatePair[] }>(`${BASE}/not-duplicate`).then((result) => result.pairs);
// Puts a cleared pair back, so it is reported as a possible duplicate again.
export const unmarkNotDuplicate = (pair: NotDuplicatePair) =>
  request<{ removed: boolean }>(`${BASE}/not-duplicate`, {
    method: "DELETE",
    json: { recordTypeA: pair.a.type, recordIdA: pair.a.id, recordTypeB: pair.b.type, recordIdB: pair.b.id },
  });
export const getDuplicateRules = () => request<{ rules: DuplicateRules }>(`${BASE}/rules`).then((result) => result.rules);

import type { CrmFoundationContext, QueryClient } from "../../../index.js";

export function findAccountDuplicates(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>>;
export function findContactDuplicates(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>>;
export function findLeadContactCrossMatches(
  client: QueryClient,
  context: CrmFoundationContext,
  input?: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>>;
export function dismissAccountDuplicateMatch(
  client: QueryClient,
  context: CrmFoundationContext,
  partyId: string,
  matchedPartyIds: string[],
  reason: string,
): Promise<{ id: string }>;
export function dismissContactDuplicateMatch(
  client: QueryClient,
  context: CrmFoundationContext,
  contactId: string,
  matchedContactIds: string[],
  reason: string,
): Promise<{ id: string }>;
export function recordAccountDuplicateOverride(
  client: QueryClient,
  context: CrmFoundationContext,
  partyId: string,
  matchedPartyIds: string[],
  operation: "create" | "update" | "dismiss",
  reason: string,
  sourceModule?: "crm" | "sales",
): Promise<{ id: string }>;
export function recordContactDuplicateOverride(
  client: QueryClient,
  context: CrmFoundationContext,
  contactId: string,
  matchedContactIds: string[],
  operation: "create" | "update" | "dismiss",
  reason: string,
): Promise<{ id: string }>;

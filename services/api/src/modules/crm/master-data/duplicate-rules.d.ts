import type { CrmFoundationContext, QueryClient } from "../../../index.js";

export const DUPLICATE_ENTITY_TYPES: readonly string[];
export const DUPLICATE_METHODS: readonly string[];
export const DUPLICATE_SIGNAL_CATALOG: Record<
  string,
  Array<{ signal: string; method: string; label: string }>
>;

export function listDuplicateRules(
  client: QueryClient,
  context: CrmFoundationContext,
  entityType?: string | null,
): Promise<Array<Record<string, unknown>>>;
export function getActiveDuplicateRules(
  client: QueryClient,
  context: CrmFoundationContext,
  entityType: string,
): Promise<Array<Record<string, unknown>>>;
export function upsertDuplicateRule(
  client: QueryClient,
  context: CrmFoundationContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>>;
export function setDuplicateRuleEnabled(
  client: QueryClient,
  context: CrmFoundationContext,
  id: string,
  enabled: boolean,
): Promise<Record<string, unknown>>;
export function activeRuleSetTimestamp(
  client: QueryClient,
  context: CrmFoundationContext,
  entityType: string,
): Promise<Date>;

import type { CrmFoundationContext, QueryClient } from "../../../index.js";

export const OPPORTUNITY_CONTACT_ROLES: readonly string[];

export function listOpportunityContactRoles(
  client: QueryClient,
  context: CrmFoundationContext,
  opportunityId: string,
): Promise<Record<string, unknown>[]>;

export function addOpportunityContactRole(
  client: QueryClient,
  context: CrmFoundationContext,
  opportunityId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>[]>;

export function updateOpportunityContactRole(
  client: QueryClient,
  context: CrmFoundationContext,
  opportunityId: string,
  roleId: string,
  input?: Record<string, unknown>,
): Promise<Record<string, unknown>[]>;

export function setPrimaryOpportunityContactRole(
  client: QueryClient,
  context: CrmFoundationContext,
  opportunityId: string,
  roleId: string,
): Promise<Record<string, unknown>[]>;

export function removeOpportunityContactRole(
  client: QueryClient,
  context: CrmFoundationContext,
  opportunityId: string,
  roleId: string,
  options?: { promoteRoleId?: string },
): Promise<Record<string, unknown>[]>;

export function ensurePrimaryContactRoleFromLegacyField(
  client: QueryClient,
  context: CrmFoundationContext,
  opportunityId: string,
  contactId: string | null,
): Promise<void>;

export function listContactOpportunityRoles(
  client: QueryClient,
  context: CrmFoundationContext,
  contactId: string,
): Promise<Record<string, unknown>[]>;

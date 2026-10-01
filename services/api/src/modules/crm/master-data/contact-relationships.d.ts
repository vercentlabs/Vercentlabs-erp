import type { CrmFoundationContext, QueryClient } from "../../../index.js";

export const RELATIONSHIP_TYPES: readonly string[];
export const STAKEHOLDER_ROLES: readonly string[];

export function listContactAccountRelationships(
  client: QueryClient,
  context: CrmFoundationContext,
  contactId: string,
): Promise<Array<Record<string, unknown>>>;
export function listAccountContactRelationships(
  client: QueryClient,
  context: CrmFoundationContext,
  partyId: string,
): Promise<Array<Record<string, unknown>>>;
export function addContactAccountRelationship(
  client: QueryClient,
  context: CrmFoundationContext,
  contactId: string,
  input: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>>;
export function updateContactAccountRelationship(
  client: QueryClient,
  context: CrmFoundationContext,
  contactId: string,
  relationshipId: string,
  input: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>>;
export function setPrimaryContactAccountRelationship(
  client: QueryClient,
  context: CrmFoundationContext,
  contactId: string,
  relationshipId: string,
): Promise<Array<Record<string, unknown>>>;
export function removeContactAccountRelationship(
  client: QueryClient,
  context: CrmFoundationContext,
  contactId: string,
  relationshipId: string,
  options?: { promoteRelationshipId?: string },
): Promise<Array<Record<string, unknown>>>;
export function syncPrimaryContactPointer(
  client: QueryClient,
  context: CrmFoundationContext,
  contactId: string,
): Promise<void>;
export function ensurePrimaryRelationshipFromLegacyFields(
  client: QueryClient,
  context: CrmFoundationContext,
  contactId: string,
  accountId: string | null,
  isPrimary: boolean,
): Promise<void>;
export function clearPrimaryRelationshipFromLegacyFields(
  client: QueryClient,
  context: CrmFoundationContext,
  contactId: string,
): Promise<void>;
export function reconcileRelationshipsOnContactMerge(
  client: QueryClient,
  context: CrmFoundationContext,
  sourceContactId: string,
  survivorContactId: string,
): Promise<void>;
export function reconcileRelationshipsOnAccountMerge(
  client: QueryClient,
  context: CrmFoundationContext,
  sourcePartyId: string,
  survivorPartyId: string,
): Promise<void>;

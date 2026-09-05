import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
};

export function listCrmContacts(
  client: QueryClient,
  context: CrmContext,
  options?: Record<string, unknown>,
): Promise<{ rows: any[]; total: number; limit: number; offset: number }>;
export function getCrmContact(
  client: QueryClient,
  context: CrmContext,
  id: string,
): Promise<any>;
export function getCrmContactForCaller(
  client: QueryClient,
  context: CrmContext,
  id: string,
): Promise<any>;
export function createCrmContact(
  client: QueryClient,
  context: CrmContext,
  input?: Record<string, unknown>,
): Promise<any>;
export function updateCrmContact(
  client: QueryClient,
  context: CrmContext,
  id: string,
  input?: Record<string, unknown>,
): Promise<any>;
export function archiveCrmContact(
  client: QueryClient,
  context: CrmContext,
  id: string,
): Promise<any>;
export function reactivateCrmContact(
  client: QueryClient,
  context: CrmContext,
  id: string,
): Promise<any>;

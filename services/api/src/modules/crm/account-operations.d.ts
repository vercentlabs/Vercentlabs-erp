import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, any>>; rowCount?: number | null }>;
};

export function listCrmAccounts(
  client: QueryClient,
  context: CrmContext,
  options?: {
    search?: string;
    status?: "active" | "inactive" | "all";
    industry?: string;
    country?: string;
    limit?: number;
    offset?: number;
  },
): Promise<{
  rows: Array<Record<string, any>>;
  total: number;
  limit: number;
  offset: number;
  filters: { industries: string[]; countries: string[] };
}>;

export function getCrmAccount(
  client: QueryClient,
  context: CrmContext,
  id: string,
): Promise<Record<string, any>>;

export function createCrmAccount(
  client: QueryClient,
  context: CrmContext,
  input: Record<string, unknown>,
): Promise<Record<string, any>>;

export function updateCrmAccount(
  client: QueryClient,
  context: CrmContext,
  id: string,
  input: Record<string, unknown>,
): Promise<Record<string, any>>;

export function archiveCrmAccount(
  client: QueryClient,
  context: CrmContext,
  id: string,
): Promise<Record<string, any>>;

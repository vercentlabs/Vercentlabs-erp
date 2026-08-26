import type { CrmContext, QueryClient } from "./index.js";

export type CrmLeadSource = Record<string, unknown> & {
  id: string;
  name: string;
  code: string;
  status: "active" | "inactive";
  leadCount: number;
};
export function listCrmLeadSources(
  client: QueryClient,
  context: CrmContext,
  options?: Record<string, unknown>,
): Promise<{
  rows: CrmLeadSource[];
  total: number;
  limit: number;
  offset: number;
}>;
export function getCrmLeadSource(
  client: QueryClient,
  context: CrmContext,
  id: string,
): Promise<CrmLeadSource>;
export function createCrmLeadSource(
  client: QueryClient,
  context: CrmContext,
  input?: Record<string, unknown>,
): Promise<CrmLeadSource>;
export function updateCrmLeadSource(
  client: QueryClient,
  context: CrmContext,
  id: string,
  input?: Record<string, unknown>,
): Promise<CrmLeadSource>;
export function setCrmLeadSourceActive(
  client: QueryClient,
  context: CrmContext,
  id: string,
  active: boolean,
): Promise<CrmLeadSource>;

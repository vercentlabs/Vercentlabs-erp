import type {
  BusinessDataListResponse,
  BusinessDataMutationResponse,
  BusinessDataResourceKey,
} from "@vercentlabs/shared-types";

export type BusinessDataClient = {
  list<T = Record<string, unknown>>(
    resource: BusinessDataResourceKey,
    parameters?: {
      search?: string;
      status?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<BusinessDataListResponse<T>>;
  create(
    resource: BusinessDataResourceKey,
    input: Record<string, unknown>,
  ): Promise<BusinessDataMutationResponse>;
  update(
    resource: BusinessDataResourceKey,
    id: string,
    input: Record<string, unknown>,
  ): Promise<BusinessDataMutationResponse>;
  archive(
    resource: BusinessDataResourceKey,
    id: string,
  ): Promise<BusinessDataMutationResponse>;
  importRows(
    resource: BusinessDataResourceKey,
    rows: Array<Record<string, unknown>>,
    fileName?: string,
  ): Promise<Record<string, unknown>>;
  exportUrl(resource: BusinessDataResourceKey): string;
};

export function createBusinessDataClient(options?: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): BusinessDataClient;
export * from "./crm.js";
export * from "./billing.js";
export * from "./mobile.js";

export * from "./accounting.js";

export * from "./procurement.js";
export * from "./stock.js";

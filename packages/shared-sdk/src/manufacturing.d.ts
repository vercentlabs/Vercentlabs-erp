export type ManufacturingClient = {
  dashboard(): Promise<unknown>;
  list(resource: string, filters?: Record<string, unknown>): Promise<unknown>;
  create(resource: string, input: Record<string, unknown>): Promise<unknown>;
  releaseWorkOrder(id: string): Promise<unknown>;
  startWorkOrder(id: string): Promise<unknown>;
  postProduction(id: string, input: Record<string, unknown>): Promise<unknown>;
};

export declare function createManufacturingClient(options?: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): ManufacturingClient;

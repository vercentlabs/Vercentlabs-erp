export declare function createQualityClient(options?: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): {
  dashboard(): Promise<unknown>;
  list(resource: string, query?: Record<string, unknown>): Promise<unknown>;
  create(resource: string, input: Record<string, unknown>): Promise<unknown>;
  inspectionAction(id: string, action: string, input?: Record<string, unknown>): Promise<unknown>;
  nonconformanceAction(id: string, action: string, input?: Record<string, unknown>): Promise<unknown>;
};

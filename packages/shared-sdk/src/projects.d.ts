export declare function createProjectsClient(options?: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): {
  dashboard(): Promise<unknown>;
  list(resource: string, query?: Record<string, unknown>): Promise<unknown>;
  create(resource: string, input: Record<string, unknown>): Promise<unknown>;
  transition(id: string, action: string, input?: Record<string, unknown>): Promise<unknown>;
  profitability(id: string): Promise<unknown>;
};

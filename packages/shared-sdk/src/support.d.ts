export declare function createSupportClient(options?: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): {
  dashboard(): Promise<unknown>;
  list(resource: string, query?: Record<string, unknown>): Promise<unknown>;
  create(resource: string, input: Record<string, unknown>): Promise<unknown>;
  ticketAction(id: string, action: string, input?: Record<string, unknown>): Promise<unknown>;
  addCommunication(id: string, input: Record<string, unknown>): Promise<unknown>;
};

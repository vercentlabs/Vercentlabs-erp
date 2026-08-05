export declare function createHrPayrollClient(options?: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): {
  dashboard(): Promise<unknown>;
  list(resource: string, query?: Record<string, unknown>): Promise<unknown>;
  create(resource: string, input: Record<string, unknown>): Promise<unknown>;
  leaveAction(id: string, action: string, input?: Record<string, unknown>): Promise<unknown>;
  payrollAction(id: string, action: string, input?: Record<string, unknown>): Promise<unknown>;
};

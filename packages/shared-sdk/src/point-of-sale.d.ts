export declare function createPointOfSaleClient(options?: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): {
  dashboard(): Promise<unknown>;
  list(resource: string, query?: Record<string, unknown>): Promise<unknown>;
  create(resource: string, input: Record<string, unknown>): Promise<unknown>;
  shiftAction(id: string, action: string, input?: Record<string, unknown>): Promise<unknown>;
  completeSale(input: Record<string, unknown>): Promise<unknown>;
  createReturn(input: Record<string, unknown>): Promise<unknown>;
  // F283/F284/F285/F286 payment tender subsystem.
  initiatePayment(input: Record<string, unknown>): Promise<unknown>;
  getPayment(id: string): Promise<unknown>;
  refundPayment(id: string, input: Record<string, unknown>): Promise<unknown>;
  requestPaymentOverride(id: string, reason: string): Promise<unknown>;
};

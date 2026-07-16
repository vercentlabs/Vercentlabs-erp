export type CrmClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};
export type CrmClient = {
  list(resource: string, filters?: Record<string, unknown>): Promise<unknown>;
  get(resource: string, id: string): Promise<unknown>;
  create(resource: string, input: Record<string, unknown>): Promise<unknown>;
  update(
    resource: string,
    id: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  archive(resource: string, id: string): Promise<unknown>;
  convertLead(id: string, input?: Record<string, unknown>): Promise<unknown>;
  mergeLead(id: string, targetLeadId: string): Promise<unknown>;
  moveOpportunity(id: string, stageId: string, note?: string): Promise<unknown>;
  completeActivity(id: string, outcome?: string): Promise<unknown>;
  dashboard(): Promise<unknown>;
  report(name: string, filters?: Record<string, unknown>): Promise<unknown>;
};
export function createCrmClient(options?: CrmClientOptions): CrmClient;

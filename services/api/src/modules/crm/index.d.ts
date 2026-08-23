import type {
  CrmContext,
  CrmListRequest,
  CrmResourceKey,
} from "@vercentlabs/shared-types";
type QueryClient = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: any[]; rowCount?: number | null }>;
};
export class CrmError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code?: string);
}
export function isCrmResource(value: string): value is CrmResourceKey;
export function listCrmRecords(
  client: QueryClient,
  context: CrmContext,
  resource: CrmResourceKey,
  filters?: CrmListRequest,
): Promise<{ rows: any[]; total: number; limit: number; offset: number }>;
export function getCrmRecord(
  client: QueryClient,
  context: CrmContext,
  resource: CrmResourceKey,
  id: string,
): Promise<any>;
export function createCrmRecord(
  client: QueryClient,
  context: CrmContext,
  resource: CrmResourceKey,
  input: Record<string, unknown>,
): Promise<any>;
export function updateCrmRecord(
  client: QueryClient,
  context: CrmContext,
  resource: CrmResourceKey,
  id: string,
  input: Record<string, unknown>,
): Promise<any>;
export function archiveCrmRecord(
  client: QueryClient,
  context: CrmContext,
  resource: CrmResourceKey,
  id: string,
): Promise<any>;
export function convertCrmLead(
  client: QueryClient,
  context: CrmContext,
  leadId: string,
  input?: Record<string, unknown>,
): Promise<any>;
export function mergeCrmLead(
  client: QueryClient,
  context: CrmContext,
  sourceId: string,
  targetId: string,
): Promise<any>;
export function moveOpportunityStage(
  client: QueryClient,
  context: CrmContext,
  opportunityId: string,
  stageId: string,
  note?: string | null,
  expectations?: { expectedUpdatedAt?: string; expectedStageId?: string | null },
): Promise<any>;
export function completeCrmActivity(
  client: QueryClient,
  context: CrmContext,
  activityId: string,
  outcome?: string | null,
  expectations?: { expectedUpdatedAt?: string; expectedStatus?: string },
): Promise<any>;
export function getCrmOptions(
  client: QueryClient,
  context: CrmContext,
): Promise<Record<string, any[]>>;
export function getCrmDashboard(
  client: QueryClient,
  context: CrmContext,
): Promise<any>;
export function getCrmReport(
  client: QueryClient,
  context: CrmContext,
  report: string,
  filters?: Record<string, unknown>,
): Promise<any>;
export function findCrmDuplicates(
  client: QueryClient,
  context: CrmContext,
  input: Record<string, unknown>,
  excludeId?: string | null,
): Promise<any[]>;
export function captureCrmLead(
  client: QueryClient,
  formKey: string,
  input: Record<string, unknown>,
  requestContext?: Record<string, unknown>,
): Promise<any>;
export function calculateLeadScore(
  client: QueryClient,
  organizationId: string,
  lead: Record<string, unknown>,
): Promise<number>;
export function runCrmAutomation(
  client: QueryClient,
  context: CrmContext,
  eventType: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
): Promise<any[]>;

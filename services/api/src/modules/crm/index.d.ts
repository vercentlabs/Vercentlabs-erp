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
// Context accepted by the CRM foundation APIs (lead assignment policies,
// fallback and availability): a business-data context.
export type CrmFoundationContext = {
  organizationId: string;
  userId: string;
};
export class CrmError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;
  constructor(
    status: number,
    message: string,
    code?: string,
    details?: Record<string, unknown>,
  );
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
  expectations?: { expectedUpdatedAt?: string; requireVersion?: boolean },
): Promise<any>;
export function archiveCrmRecord(
  client: QueryClient,
  context: CrmContext,
  resource: CrmResourceKey,
  id: string,
  expectations?: { expectedUpdatedAt?: string; requireVersion?: boolean },
): Promise<any>;
export function getCrmOptions(
  client: QueryClient,
  context: CrmContext,
): Promise<Record<string, any[]>>;
export type CrmAnalyticsFilters = {
  from?: string; to?: string; asOf?: string; scope?: string; pipelineId?: string; stageId?: string; teamId?: string;
  ownerId?: string; sourceId?: string; forecastCategory?: string;
};
export function analyticsFiltersFromSearchParams(searchParams: URLSearchParams): CrmAnalyticsFilters;
export function normalizeAnalyticsFilters(input?: CrmAnalyticsFilters): Required<CrmAnalyticsFilters>;
export const METRIC_VERSION: string;
export const PIPELINE_METRICS: Record<string, { label: string; unit: string; population: string; measure: string; timeBasis: string }>;
export const BREAKDOWN_DIMENSIONS: Record<string, { label: string }>;
export function listMetricDefinitions(): Array<Record<string, any>>;
export function getPipelineMetrics(client: QueryClient, context: CrmContext, filters?: CrmAnalyticsFilters): Promise<any>;
export function getPipelineDashboard(client: QueryClient, context: CrmContext, filters?: CrmAnalyticsFilters): Promise<any>;
export function getPipelineBreakdown(client: QueryClient, context: CrmContext, input: { metric: string; dimension: string; filters?: CrmAnalyticsFilters }): Promise<any>;
export function getMetricRollup(client: QueryClient, context: CrmContext, input: { dimension: string; metrics: string[]; filters?: CrmAnalyticsFilters }): Promise<any>;
export function getMetricDrilldown(client: QueryClient, context: CrmContext, input: { metric: string; filters?: CrmAnalyticsFilters; cursor?: string | null; limit?: number }): Promise<any>;
export function resolvePublicCaptureOrganization(queryable: QueryClient, formKey: string): Promise<string | null>;
export function captureCrmLead(
  client: QueryClient,
  formKey: string,
  input: Record<string, unknown>,
  requestContext?: Record<string, unknown>,
): Promise<any>;

// Declarations for the commands and queries added to the boundary for package
// consumers (@vercentlabs/api/crm); most are re-exported from their owning
// file's declarations.

// Declarations previously written inline in services/api/src/index.d.ts.
// F005 — hand-written signature for a runtime export reached through
// lead-governance.js's re-export of assignment/index.js.
// The canonical overdue rule for activities.
export function taskOverdueSql(alias?: string): string;
// The shared reminder mechanism (reminders/index.js).
export function createRemindersForActivity(client: QueryClient, context: any, activityId: string, dueAt: string | Date, options?: { offsets?: number[]; channel?: "in_app" | "email"; workingHours?: boolean }): Promise<any[]>;
export function cancelPendingRemindersForActivity(client: QueryClient, context: any, activityId: string): Promise<void>;
export function replaceActivityReminder(client: QueryClient, context: any, activityId: string, dueAt: string | Date, offsetMinutes: number | null): Promise<any | null>;
export function snoozeActivityReminder(client: QueryClient, context: any, activityId: string, until: string | Date): Promise<any>;
export function claimDueReminders(client: QueryClient, context: any, options?: { limit?: number }): Promise<any[]>;
export function markReminderOutcome(client: QueryClient, context: any, reminderId: string, options: { status: "sent" | "failed"; failureReason?: string | null }): Promise<void>;
export function resetStuckDispatchingReminders(client: QueryClient, context: any, options?: { olderThanMinutes?: number }): Promise<number>;
export function getCrmRecordTimelinePage(
  client: QueryClient,
  context: any,
  entityType: "lead" | "opportunity" | "party" | "contact",
  entityId: string,
  options?: { cursor?: string | null; limit?: number; kinds?: Array<"activity" | "note" | "attachment"> },
): Promise<{ rows: Array<Record<string, unknown>>; hasMore: boolean; nextCursor: string | null }>;
export function getCrmTimelinePageBySource(
  client: QueryClient,
  context: any,
  entityType: "lead" | "opportunity" | "party" | "contact",
  entityId: string,
  options: { source: "activity" | "note" | "attachment"; offset?: number; limit?: number },
): Promise<{ rows: Array<Record<string, unknown>>; hasMore: boolean }>;
export function resolveCrmEntityAccess(
  client: QueryClient,
  context: any,
  entityType: "lead" | "opportunity" | "party" | "contact",
  entityId: string,
): Promise<boolean>;

// Declarations kept with the F014/F018 and account-intelligence compatibility
// boundary (activities/communications.d.ts).

// Record kernel: access scope, outbox and communication access.
export function canViewAllCrmRecords(context: CrmContext): boolean;
export function recordScope(
  definition: { table: string; ownerField?: string; [key: string]: unknown },
  context: CrmContext,
  parameters: unknown[],
  alias?: string,
): string;
export const resources: Readonly<Record<CrmResourceKey, { table: string; ownerField?: string; fields: Record<string, unknown>; [key: string]: unknown }>>;
export function queueOutboxEvent(
  client: QueryClient,
  context: CrmContext,
  eventType: string,
  entityType: string,
  entityId: string,
  payload?: Record<string, unknown>,
): Promise<unknown>;

// Worker entry points (nurture notifications, scheduled calendar sync).
export function claimCalendarSyncAccounts(
  client: QueryClient,
  context: CrmContext,
  options?: { limit?: number },
): Promise<Array<Record<string, unknown>>>;
export function completeCalendarSync(
  client: QueryClient,
  context: CrmContext,
  account: Record<string, unknown>,
  page: Record<string, unknown>,
): Promise<unknown>;
export function failCalendarSync(
  client: QueryClient,
  context: CrmContext,
  account: Record<string, unknown>,
  error: unknown,
): Promise<{ failed: true; code: string }>;
export * from "./leads/index.js";
export * from "./opportunities/index.js";
export * from "./pipeline/index.js";
export * from "./sales-stages/index.js";
export * from "./tasks/index.js";
export * from "./follow-ups/index.js";
export * from "./notes/index.js";
export * from "./attachments/index.js";
export * from "./conversion/index.js";
export * from "./quotations/index.js";
export * from "./close-reasons/index.js";
export * from "./workspace/index.js";
export * from "./accounts/index.js";
export * from "./contacts/index.js";
export * from "./duplicates/index.js";

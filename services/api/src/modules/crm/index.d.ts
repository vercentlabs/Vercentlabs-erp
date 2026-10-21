import type {
  CrmContext,
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
// Sales teams and members (Settings › Teams; sales-organization/teams.js).
export type SalesTeamListFilters = { status?: string; search?: string; teamId?: string; limit?: number; offset?: number };
export type CrmPage<T> = { rows: T[]; total: number; limit: number; offset: number };
export const SALES_TEAM_MEMBER_ROLES: readonly ["seller", "manager", "sales_ops", "overlay", "observer"];
export function listSalesTeams(client: QueryClient, context: CrmContext, filters?: SalesTeamListFilters): Promise<CrmPage<Record<string, any>>>;
export function getSalesTeam(client: QueryClient, context: CrmContext, id: string): Promise<Record<string, any>>;
export function createSalesTeam(client: QueryClient, context: CrmContext, input: Record<string, unknown>): Promise<Record<string, any>>;
export function updateSalesTeam(client: QueryClient, context: CrmContext, id: string, input: Record<string, unknown>, expectations?: { expectedUpdatedAt?: string }): Promise<Record<string, any>>;
export function archiveSalesTeam(client: QueryClient, context: CrmContext, id: string, expectations?: { expectedUpdatedAt?: string }): Promise<Record<string, any>>;
export function listSalesTeamMembers(client: QueryClient, context: CrmContext, filters: SalesTeamListFilters & { teamId: string }): Promise<CrmPage<Record<string, any>>>;
export function addSalesTeamMember(client: QueryClient, context: CrmContext, input: Record<string, unknown>): Promise<Record<string, any>>;
export function archiveSalesTeamMember(client: QueryClient, context: CrmContext, id: string, expectations?: { expectedUpdatedAt?: string }): Promise<Record<string, any>>;
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
export const resources: Readonly<Record<"leads" | "opportunities" | "activities", { table: string; ownerField?: string; fields: Record<string, unknown>; [key: string]: unknown }>>;
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
export * from "./data-jobs/index.js";
export * from "./capture-forms/index.js";
export * from "./connectors/index.js";
export * from "./campaigns/index.js";
export * from "./tags/index.js";
export * from "./reports/index.js";
export * from "./whatsapp/index.js";
export * from "./channels/index.js";
export * from "./meetings/index.js";
export * from "./followers/index.js";
export * from "./activity-types/index.js";
export * from "./custom-fields/index.js";
export * from "./recurring/index.js";
export * from "./images/index.js";
export * from "./saved-views/index.js";
export * from "./gst/index.js";
export * from "./holidays/index.js";
export * from "./access-levels/index.js";
export * from "./mailings/index.js";
export * from "./chat/index.js";
// The leads switch, past-history import and moving in from other tools (CRM plan 5.7).
export function leadsEnabled(client: QueryClient, organizationId: string): Promise<boolean>;
export function setLeadsEnabled(client: QueryClient, context: CrmContext, enabled: boolean): Promise<{ leadsEnabled: boolean }>;
export function convertArrivingLead(client: QueryClient, organizationId: string, leadId: string): Promise<Record<string, any> | null>;
export const HISTORY_IMPORT_COLUMNS: ReadonlyArray<{ key: string; label: string; aliases: string[]; sample: string }>;
export function buildHistoryImportTemplate(): string;
export function analyzeHistoryImport(input: { bytes: Uint8Array; fileName: string }): { headers: string[]; mapping: Record<string, string>; rowCount: number; preview: Array<Record<string, string>> };
export function importRecordHistory(client: QueryClient, context: CrmContext, input: { bytes: Uint8Array; fileName: string; mapping?: Record<string, string> }):
  Promise<{ created: number; notes: number; skipped: number; failed: number; errors: Array<{ row: number; message: string }> }>;
export const MIGRATION_SOURCES: ReadonlyArray<{ key: string; label: string; howTo: string }>;
export { SCORING_FIELDS, createLeadScoringRule, deleteLeadScoringRule, getLeadScoring, rescoreLead, rescoreOpenLeads, saveLeadScoringSettings, updateLeadScoringRule } from "./leads/scoring.js";
// The consent ledger, opt-out list and personal-data lookup (CRM plan 4.3).
export const CONSENT_LOCK_DAYS: number;
export type ConsentEvent = { id: string; channel: string; action: "opt_in" | "opt_out" | "consent_withdrawn" | "opt_out_lifted"; source: string; evidence: string | null; recordedAt: string; recordedByName: string | null };
export type OptOut = { kind: "email" | "phone"; value: string; channels: string[]; source: string; reason: string | null; createdAt: string; createdByName: string | null };
export function withConsentSource<T>(client: QueryClient, source: string, evidence: string | null, work: () => Promise<T>): Promise<T>;
export function assertConsentRequestAllowed(client: QueryClient, context: CrmContext, subjectType: "lead" | "contact", subjectId: string, channels: string[], options?: { source?: string }): Promise<void>;
export function optOutOf(client: QueryClient, organizationId: string, target: { email?: string | null; phone?: string | null }, channel: string): Promise<{ kind: string; value: string } | null>;
export function listConsentHistory(client: QueryClient, context: CrmContext, subjectType: "lead" | "contact", subjectId: string): Promise<ConsentEvent[]>;
export function listOptOuts(client: QueryClient, context: CrmContext, options?: { search?: string }): Promise<OptOut[]>;
export function addOptOut(client: QueryClient, context: CrmContext, input: { email?: string; phone?: string; channels?: string[]; reason?: string | null }): Promise<OptOut[]>;
export function removeOptOut(client: QueryClient, context: CrmContext, input: { kind: "email" | "phone"; value: string; personAsked?: boolean; reason?: string | null }): Promise<{ removed: true }>;
export function findPersonalData(client: QueryClient, context: CrmContext, input: { email?: string | null; phone?: string | null }): Promise<Record<string, any>>;
export const EMAIL_PLACEHOLDERS: ReadonlyArray<{ key: string; label: string }>;
export type CrmEmailRecordType = "lead" | "opportunity" | "party" | "contact";
export type CrmRecordEmail = { id: string; direction: "inbound" | "outbound"; status: string; subject: string; body: string | null; from: string | null; fromName: string | null;
  to: string[]; cc: string[]; sentByName: string | null; createdAt: string; threaded: boolean };
export type CrmEmailTemplate = { id: string; name: string; appliesTo: "any" | CrmEmailRecordType; subject: string; body: string; status: "active" | "inactive"; useCount: number; updatedAt: string; updatedByName: string | null };
export function fillPlaceholders(template: string, values: Record<string, unknown>): string;
export function prepareRecordEmail(client: QueryClient, context: CrmContext, entityType: CrmEmailRecordType, entityId: string, options?: { templateId?: string | null }): Promise<{
  to: string; subject: string; body: string; signature: string | null; reference: string | null; replyTo: string | null; refused: string | null; canSend: boolean; templates: Array<{ id: string; name: string }>;
}>;
export function sendRecordEmail(client: QueryClient, context: CrmContext, entityType: CrmEmailRecordType, entityId: string, input: Record<string, unknown>, env?: NodeJS.ProcessEnv): Promise<{ emailId: string; status: string; messageId: string }>;
export function listRecordEmails(client: QueryClient, context: CrmContext, entityType: CrmEmailRecordType, entityId: string, options?: { limit?: number }): Promise<CrmRecordEmail[]>;
export function recordQuotationEmailOnDeal(client: QueryClient, context: CrmContext, input: Record<string, unknown>): Promise<string | null>;
export function listEmailTemplates(client: QueryClient, context: CrmContext, options?: { includeInactive?: boolean }): Promise<CrmEmailTemplate[]>;
export function createEmailTemplate(client: QueryClient, context: CrmContext, input: Record<string, unknown>): Promise<CrmEmailTemplate>;
export function updateEmailTemplate(client: QueryClient, context: CrmContext, templateId: string, input: Record<string, unknown>): Promise<CrmEmailTemplate>;
export function getCrmEmailSettings(client: QueryClient, context: CrmContext): Promise<{ replyToAddress: string | null; signature: string | null; placeholders: ReadonlyArray<{ key: string; label: string }> }>;
export function saveCrmEmailSettings(client: QueryClient, context: CrmContext, input: Record<string, unknown>): Promise<{ replyToAddress: string | null; signature: string | null; placeholders: ReadonlyArray<{ key: string; label: string }> }>;
export function deliverInboundEmailToCrm(client: QueryClient, route: Record<string, any>, message: Record<string, any>, prepared?: unknown[], options?: { inboundEventId?: string | null; storage?: unknown }): Promise<{ outcome: string; recordType: string; recordId: string; emailId: string }>;
export * from "./pipeline/index.js";
export * from "./sales-stages/index.js";
export * from "./tasks/index.js";
export * from "./follow-ups/index.js";
export * from "./notes/index.js";
export * from "./attachments/index.js";
export * from "./conversion/index.js";
export * from "./quotations/index.js";
export * from "./quotes/index.js";
export * from "./close-reasons/index.js";
export * from "./workspace/index.js";
export * from "./accounts/index.js";
export * from "./contacts/index.js";
export * from "./duplicates/index.js";

import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};
type Input = Record<string, unknown>;
type CodeLabel<Code extends string = string> = { code: Code; label: string };

export type FollowUpStatus = "scheduled" | "completed" | "cancelled";
export type FollowUpType = "call" | "email" | "meeting" | "demo" | "other";
export type FollowUpOutcome = "connected" | "no_response" | "interested" | "not_interested" | "meeting_scheduled" | "other";
export type FollowUpCapabilities = Record<
  "view" | "viewTeam" | "viewAll" | "create" | "edit" | "complete" | "reschedule" | "cancel" | "reassign" | "delete" | "export",
  boolean
>;
export type FollowUp = Record<string, any> & {
  id: string; number: string | null; subject: string; type: FollowUpType; status: FollowUpStatus; assignedTo: string | null; scheduledDate: string | null;
  scheduledTime: string | null; isOverdue: boolean; updatedAt: string;
};
export type FollowUpBulkResult = { results: Array<{ followUpId: string; ok: boolean; message?: string }>; succeeded: number; failed: number };

export const FOLLOW_UP_STATUSES: ReadonlyArray<CodeLabel<FollowUpStatus>>;
export const FOLLOW_UP_TYPES: ReadonlyArray<CodeLabel<FollowUpType>>;
export const FOLLOW_UP_OUTCOMES: ReadonlyArray<CodeLabel<FollowUpOutcome>>;
export const FOLLOW_UP_RELATED_TYPES: ReadonlyArray<CodeLabel>;
export const FOLLOW_UP_REMINDER_OPTIONS: ReadonlyArray<{ minutes: number; label: string }>;
export const FOLLOW_UP_VIEWS: ReadonlyArray<{ key: string; label: string }>;
export const FOLLOW_UP_PERMISSIONS: Readonly<Record<keyof FollowUpCapabilities, string>>;
export const FOLLOW_UP_NUMBER_DOCUMENT_TYPE: string;
export const OPEN_STORED_STATUSES: ReadonlyArray<string>;
export const CHANNEL_OF_TYPE: Readonly<Record<FollowUpType, string>>;
export const ACTIVITY_OF_TYPE: Readonly<Partial<Record<FollowUpType, string>>>;

export function followUpCan(context: CrmContext, permission: string): boolean;
export function canViewAllFollowUps(context: CrmContext): boolean;
export function followUpScopeSql(context: CrmContext, values: unknown[], alias?: string): string;
export function followUpCapabilities(context: CrmContext): FollowUpCapabilities;

export function listFollowUps(client: QueryClient, context: CrmContext, filters?: Input): Promise<{ followUps: FollowUp[]; total: number; limit: number; offset: number; capabilities: FollowUpCapabilities }>;
export function getFollowUp(client: QueryClient, context: CrmContext, followUpId: string): Promise<FollowUp>;
export function getFollowUpSummary(client: QueryClient, context: CrmContext): Promise<{ dueToday: number; overdue: number; upcoming: number; open: number; teamOverdue: number | null }>;
export function getFollowUpOptions(client: QueryClient, context: CrmContext): Promise<Record<string, any>>;
export function scheduleFollowUp(client: QueryClient, context: CrmContext, input?: Input): Promise<FollowUp>;
export function scheduleNextFollowUp(client: QueryClient, context: CrmContext, input?: Input): Promise<FollowUp>;
export function updateFollowUp(client: QueryClient, context: CrmContext, followUpId: string, input?: Input): Promise<FollowUp>;
export function deleteFollowUp(client: QueryClient, context: CrmContext, followUpId: string): Promise<{ deleted: boolean }>;
export function rescheduleFollowUp(client: QueryClient, context: CrmContext, followUpId: string, input?: Input): Promise<{ changed: boolean }>;
export function reassignFollowUp(client: QueryClient, context: CrmContext, followUpId: string, input?: Input, options?: { notify?: boolean }): Promise<{ changed: boolean }>;
export function completeFollowUp(client: QueryClient, context: CrmContext, followUpId: string, input?: Input): Promise<{ changed: boolean; followUpId: string | null; taskId: string | null; activityId: string | null }>;
export function cancelFollowUp(client: QueryClient, context: CrmContext, followUpId: string, input?: Input): Promise<{ changed: boolean }>;
export function snoozeFollowUpReminder(client: QueryClient, context: CrmContext, followUpId: string, input?: Input): Promise<{ changed: boolean; remindAt: string }>;
export function listFollowUpHistory(client: QueryClient, context: CrmContext, followUpId: string): Promise<Array<{ id: string; eventType: string; summary: string; changes: Record<string, unknown>; createdAt: string; actorName: string | null }>>;
export function bulkUpdateFollowUps(client: QueryClient, context: CrmContext, input?: Input): Promise<FollowUpBulkResult>;
export function transferOpenFollowUps(client: QueryClient, context: CrmContext, input: { entityType: string; entityId: string; fromUserId: string | null; toUserId: string | null }): Promise<{ transferred: number }>;
export function settleOpenFollowUps(client: QueryClient, context: CrmContext, entityType: string, entityId: string, options?: { action?: "keep" | "cancel"; reason?: string | null }): Promise<{ cancelled: number }>;
export function exportFollowUps(client: QueryClient, context: CrmContext, filters?: Input): Promise<{ fileName: string; rowCount: number; csv: string }>;

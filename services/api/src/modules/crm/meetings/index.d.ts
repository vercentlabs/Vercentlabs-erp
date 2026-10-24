import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
type Runtime = { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch };

export function buildIcs(input: { method: "REQUEST" | "CANCEL"; uid: string; sequence: number; start: Date; end: Date; summary: string; description?: string; location?: string | null;
  organizer: { name?: string | null; email: string }; attendees: Array<{ email: string; name?: string | null }> }): string;
export function getMeetingInvitation(client: QueryClient, context: CrmContext, activityId: string): Promise<{ attendees: Array<{ email: string; name: string | null }>; location: string | null; durationMinutes: number; status: string; sequence: number; sentAt: string } | null>;
export function sendMeetingInvitation(client: QueryClient, context: CrmContext, activityId: string, input: { attendees: Array<{ email: string; name?: string }>; location?: string; durationMinutes?: number; message?: string }, env?: NodeJS.ProcessEnv): Promise<{ uid: string; sequence: number; attendees: number; updated: boolean }>;
export function cancelMeetingInvitation(client: QueryClient, context: CrmContext, activityId: string, input?: { message?: string | null }, env?: NodeJS.ProcessEnv): Promise<{ cancelled: true }>;
export type CalendarConnection = { provider: "google" | "microsoft"; label: string; available: boolean; connected: boolean; accountEmail: string | null; status: string | null; lastSyncAt: string | null; lastError: string | null };
export function listCalendarConnections(client: QueryClient, context: CrmContext, runtime?: Runtime): Promise<CalendarConnection[]>;
export function calendarAuthorizeUrl(context: CrmContext, provider: string, runtime?: Runtime): Promise<string>;
export function readCalendarState(state: string, env?: NodeJS.ProcessEnv): Promise<{ organizationId: string; userId: string; provider: "google" | "microsoft" }>;
export function completeCalendarConnection(client: QueryClient, payload: { organizationId: string; userId: string; provider: string }, code: string, runtime?: Runtime): Promise<{ provider: string; accountEmail: string | null }>;
export function disconnectCalendar(client: QueryClient, context: CrmContext, provider: string): Promise<{ disconnected: true }>;
export function syncCalendars(client: QueryClient, organizationId: string, runtime?: Runtime): Promise<{ connections: number; created: number; updated: number; removed: number; failed: number; pulledMoved: number; pulledCancelled: number; zoom: number }>;
export function syncMyCalendar(client: QueryClient, context: { organizationId: string; userId: string }, runtime?: Runtime & { pastDays?: number }): Promise<{ connections: number; created: number; updated: number; removed: number; failed: number; pulledMoved: number; pulledCancelled: number; zoom: number }>;
export function hasCalendarConnections(client: QueryClient, organizationId: string): Promise<boolean>;
// Two-way sync and video calls (CRM audit).
export function syncMeetingNow(client: QueryClient, organizationId: string, activityId: string, runtime?: Runtime): Promise<string | null>;
export type MeetingVideoProvider = "google_meet" | "teams" | "zoom" | "link";
export type MeetingVideo = { provider: MeetingVideoProvider | null; link: string | null; available: Record<MeetingVideoProvider, boolean> };
export function getMeetingVideo(client: QueryClient, context: CrmContext, activityId: string, runtime?: Runtime): Promise<MeetingVideo>;
export function setMeetingVideo(client: QueryClient, context: CrmContext, activityId: string, input: { provider?: string | null; link?: string | null }, runtime?: Runtime): Promise<{ provider: MeetingVideoProvider | null; link: string | null; pending: boolean }>;
export type CrmZoomSettings = { connected: boolean; accountId: string | null; clientId: string | null; hostEmail: string | null; hostName: string | null; linksMade: number; linksWaiting: number };
export function getZoomSettings(client: QueryClient, context: CrmContext, runtime?: Runtime): Promise<CrmZoomSettings>;
export function saveZoomSettings(client: QueryClient, context: CrmContext, input: Record<string, unknown>, runtime?: Runtime): Promise<CrmZoomSettings>;
export function checkZoomConnection(client: QueryClient, context: CrmContext, runtime?: Runtime): Promise<CrmZoomSettings>;
export function makeZoomLinks(client: QueryClient, organizationId: string, options?: Runtime & { activityId?: string | null }): Promise<{ made: number; failed: number }>;

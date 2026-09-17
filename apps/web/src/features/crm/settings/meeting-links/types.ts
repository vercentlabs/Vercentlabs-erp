// tenant.crm_meeting_links rows via the generic /api/crm/[resource]
// boundary — see resource-registry.js's "meeting-links" definition for
// the authoritative field map. publicToken is not in that map (it is
// DB-generated, never client-settable) but IS returned on reads because
// the generic query service does SELECT record.* — see resource-query-
// service.js's getCrmRecord/listCrmRecords.
export type AvailabilityWindow = { start: string; end: string };
export type MeetingLinkAvailability = Partial<
  Record<"monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday", AvailabilityWindow[]>
>;

export type MeetingLink = {
  id: string;
  companyId: string | null;
  ownerUserId: string;
  name: string;
  slug: string | null;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  timezone: string;
  availability: MeetingLinkAvailability;
  meetingProvider: string;
  locationTemplate: string | null;
  publicToken: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
};

export type CrmListResponse<T> = { rows: T[]; total: number; limit: number; offset: number };

export const WEEKDAYS: Array<{ key: keyof MeetingLinkAvailability; label: string }> = [
  { key: "monday", label: "Mon" },
  { key: "tuesday", label: "Tue" },
  { key: "wednesday", label: "Wed" },
  { key: "thursday", label: "Thu" },
  { key: "friday", label: "Fri" },
  { key: "saturday", label: "Sat" },
  { key: "sunday", label: "Sun" },
];

"use client";

import { CrmApiError } from "./http/crm-api-error.ts";
import { crmApiClient } from "./http/crm-request.ts";

// F019 — shared client for every 360 that embeds a RecordTimelinePanel.
export type TimelineKind =
  | "activity"
  | "communication"
  | "note"
  | "attachment"
  | "stage"
  | "history";

export type RecordTimelineRow = {
  id: string;
  kind: TimelineKind;
  subtype: string | null;
  title: string | null;
  occurredAt: string;
  status: string | null;
  actorUserId: string | null;
  actorName: string | null;
  createdBy: string | null;
};

export type RecordTimelinePage = {
  rows: RecordTimelineRow[];
  hasMore: boolean;
  nextCursor: string | null;
};

class TimelineApiError extends CrmApiError {}

const { request } = crmApiClient(TimelineApiError);

export async function getRecordTimeline(
  entityType: string,
  entityId: string,
  options: { cursor?: string; kinds?: TimelineKind[] } = {},
): Promise<{ page: RecordTimelinePage }> {
  const params = new URLSearchParams({ entityType, entityId });
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.kinds?.length) params.set("kinds", options.kinds.join(","));
  return request(`/api/crm/timeline?${params.toString()}`);
}

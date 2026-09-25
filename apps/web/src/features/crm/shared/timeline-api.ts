"use client";

// F019 — shared client for every 360 that embeds a RecordTimelinePanel.
export type TimelineKind = "activity" | "communication" | "note" | "attachment" | "stage" | "assignment" | "qualification";

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

export type RecordTimelinePage = { rows: RecordTimelineRow[]; hasMore: boolean; nextCursor: string | null };

export class TimelineApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export async function getRecordTimeline(entityType: string, entityId: string, options: { cursor?: string; kinds?: TimelineKind[] } = {}): Promise<{ page: RecordTimelinePage }> {
  const params = new URLSearchParams({ entityType, entityId });
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.kinds?.length) params.set("kinds", options.kinds.join(","));
  const response = await fetch(`/api/crm/timeline?${params.toString()}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new TimelineApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

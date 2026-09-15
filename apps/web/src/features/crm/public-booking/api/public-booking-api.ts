"use client";

export class PublicBookingApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new PublicBookingApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export type PublicMeetingLinkInfo = {
  name: string;
  ownerName: string | null;
  durationMinutes: number;
  timezone: string;
  meetingProvider: string;
  locationTemplate: string | null;
  minimumNoticeMinutes: number;
  maximumDaysAhead: number;
};

export type PublicMeetingSlot = { startsAt: string; endsAt: string };

export async function getPublicMeetingLink(token: string): Promise<{ link: PublicMeetingLinkInfo }> {
  const response = await fetch(`/api/crm/public/meetings/links/${token}`);
  return parseResponse(response);
}

export async function getPublicMeetingAvailability(token: string, date: string): Promise<{ slots: PublicMeetingSlot[] }> {
  const response = await fetch(`/api/crm/public/meetings/links/${token}/availability?date=${date}`);
  return parseResponse(response);
}

export async function bookPublicMeeting(
  token: string,
  input: { startsAt: string; guestName: string; guestEmail: string; guestTimezone: string; notes?: string },
): Promise<{ booking: Record<string, unknown> }> {
  const response = await fetch(`/api/crm/public/meetings/links/${token}/book`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export type PublicMeetingBookingDetail = {
  startsAt: string;
  endsAt: string;
  status: string;
  meetingName: string;
  durationMinutes: number;
  timezone: string;
  canCancel: boolean;
  canReschedule: boolean;
};

export async function getPublicMeetingBooking(token: string): Promise<{ booking: PublicMeetingBookingDetail }> {
  const response = await fetch(`/api/crm/public/meetings/bookings/${token}`);
  return parseResponse(response);
}

export async function cancelPublicMeetingBooking(token: string, reason?: string): Promise<{ booking: Record<string, unknown> }> {
  const response = await fetch(`/api/crm/public/meetings/bookings/${token}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: reason || "" }),
  });
  return parseResponse(response);
}

export async function reschedulePublicMeetingBooking(token: string, startsAt: string, guestTimezone: string): Promise<{ booking: Record<string, unknown> }> {
  const response = await fetch(`/api/crm/public/meetings/bookings/${token}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startsAt, guestTimezone }),
  });
  return parseResponse(response);
}

"use client";

import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

export class PublicBookingApiError extends CrmApiError {}

const { request } = crmApiClient(PublicBookingApiError);

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

export async function getPublicMeetingLink(
  token: string,
): Promise<{ link: PublicMeetingLinkInfo }> {
  return request(`/api/crm/public/meetings/links/${token}`);
}

export async function getPublicMeetingAvailability(
  token: string,
  date: string,
): Promise<{ slots: PublicMeetingSlot[] }> {
  return request(
    `/api/crm/public/meetings/links/${token}/availability?date=${date}`,
  );
}

export async function bookPublicMeeting(
  token: string,
  input: {
    startsAt: string;
    guestName: string;
    guestEmail: string;
    guestTimezone: string;
    notes?: string;
  },
): Promise<{ booking: Record<string, unknown> }> {
  return request(`/api/crm/public/meetings/links/${token}/book`, {
    method: "POST",
    json: input,
  });
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

export async function getPublicMeetingBooking(
  token: string,
): Promise<{ booking: PublicMeetingBookingDetail }> {
  return request(`/api/crm/public/meetings/bookings/${token}`);
}

export async function cancelPublicMeetingBooking(
  token: string,
  reason?: string,
): Promise<{ booking: Record<string, unknown> }> {
  return request(`/api/crm/public/meetings/bookings/${token}`, {
    method: "PATCH",
    json: { reason: reason || "" },
  });
}

export async function reschedulePublicMeetingBooking(
  token: string,
  startsAt: string,
  guestTimezone: string,
): Promise<{ booking: Record<string, unknown> }> {
  return request(`/api/crm/public/meetings/bookings/${token}`, {
    method: "PATCH",
    json: { startsAt, guestTimezone },
  });
}

export async function getRescheduleAvailability(
  token: string,
  date: string,
): Promise<{ slots: PublicMeetingSlot[] }> {
  return request(
    `/api/crm/public/meetings/bookings/${token}/availability?date=${date}`,
  );
}

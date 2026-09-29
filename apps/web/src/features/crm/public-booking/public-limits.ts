import type { PublicRateLimit } from "@/core/public-rate-limit";

// F014 public meeting endpoints: durable per-IP and per-token limits
// (auth_rate_limits, shared by every replica). Reads are generous enough for
// a guest paging through a month of slots; writes are tight, and a single
// link or booking token is capped regardless of how many IPs a caller uses,
// so a host's calendar cannot be flooded.
export const publicMeetingLimits = {
  view: (): PublicRateLimit[] => [
    { bucket: "crm-meeting-view", maximum: 120, windowSeconds: 300 },
  ],
  slots: (): PublicRateLimit[] => [
    { bucket: "crm-meeting-slots", maximum: 180, windowSeconds: 300 },
  ],
  book: (linkToken: string): PublicRateLimit[] => [
    { bucket: "crm-meeting-book", maximum: 10, windowSeconds: 3600 },
    {
      bucket: "crm-meeting-book-link",
      maximum: 60,
      windowSeconds: 3600,
      subject: linkToken,
    },
  ],
  manage: (bookingToken: string): PublicRateLimit[] => [
    { bucket: "crm-meeting-manage", maximum: 20, windowSeconds: 3600 },
    {
      bucket: "crm-meeting-manage-booking",
      maximum: 10,
      windowSeconds: 3600,
      subject: bookingToken,
    },
  ],
};

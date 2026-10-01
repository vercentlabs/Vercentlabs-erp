// Compatibility boundary for the CRM communications and meeting-booking
// services. This file holds no implementation: it re-exports the public
// names that used to be defined here, from the files that now own them, so
// @vercentlabs/api (services/api/src/index.js) and existing importers keep
// working unchanged. Add new behaviour to the owning file, not here; CRM
// implementation code imports the owning file directly.

// F018 email: composition, consent, suppression, send decision, queuing,
// mailbox ingestion, engagement events, email history / thread / dashboard
export {
  outboundSendDecision,
  upsertEmailSignature,
  listEmailSignatures,
  ingestMailboxDelta,
  recordEmailEngagementEvent,
  assertEmailConsent,
  queueOutboundEmail,
  getCommunicationTimeline,
  getCrmEmailHistory,
  getCrmEmailThread,
  getCommunicationsDashboard,
} from "./communications/email-service.js";

// F018 shared inbox (membership-gated thread operations)
export {
  createSharedInbox,
  upsertSharedInboxMember,
  claimSharedInboxThread,
  listThreadMessages,
  updateSharedInboxThreadStatus,
} from "./communications/shared-inbox-service.js";

// Gmail / Microsoft 365 integration shared by email and calendar
export {
  normalizeProviderMessage,
  normalizeProviderCalendarEvent,
  verifyCrmProviderWebhookSignature,
  createProviderOAuthState,
  consumeProviderOAuthState,
  resolveProviderCredential,
  PROVIDER_REQUEST_TIMEOUT_MS,
  assertTrustedProviderUrl,
  fetchProviderMailboxDelta,
  fetchProviderCalendarDelta,
  pushProviderCalendarEvent,
} from "./communications/provider-integrations.js";

// On-demand provider account synchronisation
export {
  synchronizeProviderAccount,
} from "./communications/provider-sync.js";

// F014 meeting booking: slot engine, availability, book / cancel / reschedule
export {
  zonedWallTimeToUtc,
  calendarDateInZone,
  calculateMeetingSlots,
  getMeetingAvailability,
  isBookableDate,
  normalizeMeetingGuestInput,
  bookMeeting,
  cancelMeetingBooking,
  rescheduleMeetingBooking,
} from "./meetings/meeting-booking.js";

// F014 calendar sync (inbound) and Meeting calendar push (outbound)
export {
  ingestCalendarDelta,
  prepareMeetingCalendarPush,
  recordMeetingCalendarPushResult,
  meetingCalendarParentColumns,
  upsertMeetingCalendarEvent,
  markMeetingCalendarEventCancelling,
  enqueueCalendarPushJob,
  CALENDAR_SYNC_INTERVAL_MINUTES,
  claimCalendarSyncAccounts,
  completeCalendarSync,
  failCalendarSync,
} from "./meetings/meeting-calendar.js";

// Stable content hash
export {
  crmCommunicationsHash,
} from "./communications/content-hash.js";

// Email address validation
export {
  normalizeEmailAddress,
} from "./communications/email-address.js";

// Error type
export {
  CrmCommunicationsError,
} from "./communications/communications-error.js";

// Dormant acceptance evidence (kept for the export contract)
export {
  CRM_COMMUNICATION_CAPABILITY_IDS,
  recordCrmCommunicationsAcceptance,
  getCrmCommunicationsReadiness,
} from "./communications/communications-acceptance.js";

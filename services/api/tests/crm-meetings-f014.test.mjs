import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const service = () => read("services/api/src/modules/crm/seller-activity-and-follow-up-workspace/meeting-operations.js");
const communications = () => read("services/api/src/modules/crm/seller-activity-and-follow-up-workspace/communications.js");

test("F014: governed Meeting lifecycle stays on canonical crm_activities and reuses crm_activity_attendees", () => {
  const source = service();
  assert.match(source, /activity_type='meeting'/);
  assert.match(source, /INSERT INTO tenant\.crm_activities/);
  assert.match(source, /INSERT INTO tenant\.crm_activity_attendees/);
  assert.match(source, /DELETE FROM tenant\.crm_activity_attendees/);
  assert.doesNotMatch(source, /CREATE TABLE/);
});

test("F014: Contact attendees resolve against the real first_name\/last_name schema, not a nonexistent full_name column", () => {
  const source = service();
  assert.match(source, /trim\(concat_ws\(' ',contact\.first_name,contact\.last_name\)\) AS full_name/);
  assert.doesNotMatch(source, /SELECT[^`]*contact\.full_name/);
});

test("F014: attendee Contact scope follows the Meeting's resolved company even for all-company administrators", () => {
  const source = service();
  assert.match(source, /normalizeAttendees\(client, context, input, \{ companyId = null \} = \{\}\)/);
  assert.match(source, /const attendeeCompanyId = companyId \|\| context\.activeCompanyId \|\| null/);
  assert.match(source, /CRM_MEETING_ATTENDEE_SCOPE_INVALID/);
  assert.match(source, /normalizeAttendees\(client, context, prepared\.attendees, \{ companyId: effective\.companyId \|\| null \}\)/);
});

test("F014: all-company creation inherits company\/branch from the related CRM record", () => {
  const source = service();
  assert.match(source, /if \(!effective\.companyId && related\?\.company_id\)/);
  assert.match(source, /prepared\.companyId = related\.company_id/);
  assert.match(source, /if \(!effective\.branchId && related\?\.branch_id\)/);
  assert.match(source, /prepared\.branchId = related\.branch_id/);
});

test("F014: generic Activity create/update/archive/complete cannot bypass governed Meetings", () => {
  const source = [
    read("services/api/src/modules/crm/crm-data-operations-and-customization/resource-mutation-service.js"),
    read("services/api/src/modules/crm/seller-activity-and-follow-up-workspace/activity-commands.js"),
  ].join("\n");
  assert.match(source, /activityType === "meeting"[\s\S]{0,160}CRM_MEETING_API_MOVED/);
  assert.match(source, /before\.activityType === "meeting" \|\| requestedActivityType === "meeting"/);
  assert.match(source, /Use the governed Meetings operations/);
  assert.match(source, /Use the governed Meeting completion action/);
});

test("F014: legacy server offline-sync cannot directly insert or complete Meetings", () => {
  const source = read("services/api/src/modules/crm/crm-data-operations-and-customization/offline-sync.js");
  assert.match(source, /governed Meetings mobile endpoint for offline Meeting creation/);
  assert.match(source, /governed Meetings mobile endpoint for offline Meeting completion/);
});

test("F014: Lead follow-up Meetings bridge into the governed Meeting service without claiming F016", () => {
  const source = read("apps/web/src/app/api/crm/leads/[id]/follow-up/route.ts");
  assert.match(source, /createCrmMeeting/);
  assert.match(source, /input\.activityType === "meeting"/);
  assert.match(source, /startAt: input\.dueAt/);
  assert.match(source, /30 \* 60_000/);
  assert.match(source, /crmMeetingAuditSnapshot/);
});

test("F014: public booking serializes on its meeting link and exact lost-response retries are mutation-free", () => {
  const source = communications();
  const block = source.match(/export async function bookMeeting[\s\S]*?\n\}/)?.[0] || "";
  assert.match(block, /crm_meeting_links[\s\S]*FOR UPDATE/);
  assert.match(block, /booking\.guest_email=\$3 AND booking\.starts_at=\$4 AND booking\.status='confirmed'/);
  assert.match(block, /if \(existing\.rows\[0\]\) return \{ \.\.\.existing\.rows\[0\], replayed: true \}/);
  assert.match(block, /meeting_activity_id/);
});

test("F014: public bookings bridge to a Meeting activity and booking reschedule\/cancel keep that activity synchronized", () => {
  const source = communications();
  const bookBlock = source.match(/export async function bookMeeting[\s\S]*?\n\}/)?.[0] || "";
  assert.match(bookBlock, /meeting_booking_id,created_by,updated_by\)/);
  // The public-booking flow shares the SAME canonical calendar-sync-intent
  // helper ordinary Meeting create\/update\/cancel use (meeting-operations.js)
  // — no separate raw crm_calendar_events INSERT for this path.
  assert.match(bookBlock, /upsertMeetingCalendarEvent\(client, context, \{/);
  assert.match(bookBlock, /UPDATE tenant\.crm_activities SET meeting_calendar_event_id=\$3/);
  assert.match(source, /INSERT INTO tenant\.crm_meeting_events[\s\S]*'booked'/);
  const cancelBlock = source.match(/export async function cancelMeetingBooking[\s\S]*?export async function rescheduleMeetingBooking/)?.[0] || "";
  assert.match(cancelBlock, /UPDATE tenant\.crm_activities/);
  assert.match(cancelBlock, /meeting_booking_id=\$2/);
  assert.match(cancelBlock, /SET status='cancelled'/);
  assert.match(source, /UPDATE tenant\.crm_activities[\s\S]*start_at=\$3,due_at=\$3,end_at=\$4/);
  assert.match(source, /event_type,previous_status,next_status[\s\S]*'rescheduled'/);
});

test("F014: booking and Meeting evidence excludes attendee email, meeting URL and free-text notes from outbox\/history", () => {
  const source = service();
  const safePayload = source.match(/function safeEventPayload\(meeting, attendeeCount = 0\) \{([\s\S]*?)\n\}/)?.[1] || "";
  const eventInsert = source.match(/INSERT INTO tenant\.crm_meeting_events\(([\s\S]*?)\)\n\s*VALUES/)?.[1] || "";
  const audit = read("apps/web/src/features/crm/shared/audit-events.ts");
  const auditSnapshot = audit.match(/export function crmMeetingAuditSnapshot[\s\S]*?\n\}/)?.[0] || "";
  for (const value of [safePayload, eventInsert, auditSnapshot]) {
    assert.doesNotMatch(value, /meetingUrl|meeting_url|description|attendee.*email|guestEmail|outcome\s*:/i);
  }
  const bookingBlock = communications().match(/INSERT INTO tenant\.crm_outbox_events[\s\S]{0,700}crm\.meeting\.booked[\s\S]{0,700}?\);/)?.[0] || "";
  assert.doesNotMatch(bookingBlock, /guestEmail/);
});

test("F014 migration 070 specializes Meetings and creates immutable forced-RLS lifecycle history", () => {
  const migration = read("database/tenant/migrations/070_crm_meetings_f014.sql");
  for (const column of ["meeting_location_type", "meeting_url", "meeting_outcome_code", "meeting_started_at", "meeting_ended_at", "meeting_duration_seconds", "meeting_booking_id", "meeting_calendar_event_id"])
    assert.match(migration, new RegExp(column));
  assert.match(migration, /CREATE TABLE IF NOT EXISTS tenant\.crm_meeting_events/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON tenant\.crm_meeting_events/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /tenant_organization_isolation/);
  assert.match(migration, /crm_activities_meeting_booking_f014_uidx/);
  assert.match(migration, /REFERENCES tenant\.crm_meeting_bookings\(organization_id,id\) ON DELETE RESTRICT/);
  assert.match(migration, /REFERENCES tenant\.crm_calendar_events\(organization_id,id\) ON DELETE RESTRICT/);
  assert.doesNotMatch(migration, /FOREIGN KEY \(organization_id,meeting_(?:booking|calendar_event)_id\)[\s\S]{0,160}ON DELETE SET NULL/);
});

test("F014 lifecycle uses desired-state replay before stale rejection and parent touch is completion-only", () => {
  const source = service();
  assert.match(source, /CRM_MEETING_STALE_WRITE/);
  assert.match(source, /before\.status === "in_progress"[\s\S]{0,120}replayed: true/);
  assert.match(source, /before\.status === "completed"[\s\S]{0,300}replayed: true/);
  assert.match(source, /before\.status === "cancelled"[\s\S]{0,120}replayed: true/);
  assert.match(source, /if \(mode === "log"\) await touchParentOnCompletion/);
  assert.match(source, /await touchParentOnCompletion\(client, context, after\)/);
});

test("F014: booking-managed completion terminalizes the booking so a public cancellation cannot revert a completed Meeting", () => {
  const meeting = service();
  const communication = communications();
  assert.match(meeting, /before\.bookingId[\s\S]*bookingStatus = normalizedOutcome\.code === "no_show" \? "no_show" : "completed"/);
  assert.match(meeting, /UPDATE tenant\.crm_meeting_bookings[\s\S]*status=\$3[\s\S]*status='confirmed'/);
  const cancelBlock = communication.match(/export async function cancelMeetingBooking[\s\S]*?export async function rescheduleMeetingBooking/)?.[0] || "";
  assert.match(cancelBlock, /linkedActivity[\s\S]*status === "completed"/);
  assert.match(cancelBlock, /CRM_MEETING_BOOKING_COMPLETED/);
});

test("F014: booking reschedule serializes on the Meeting Link and refuses non-editable linked Meeting states", () => {
  const block = communications().match(/export async function rescheduleMeetingBooking[\s\S]*?export async function getCommunicationTimeline/)?.[0] || "";
  assert.match(block, /FOR UPDATE OF booking,link/);
  assert.match(block, /excludeBookingId: id/);
  const availability = communications().match(/export async function getMeetingAvailability[\s\S]*?export async function bookMeeting/)?.[0] || "";
  assert.match(availability, /meeting_booking_id IS DISTINCT FROM \$4::uuid/);
  assert.match(availability, /id <> \$4::uuid/);
  assert.match(block, /linkedActivity/);
  assert.match(block, /\["planned", "overdue"\]\.includes/);
  assert.match(block, /CRM_MEETING_BOOKING_RESCHEDULE_INVALID/);
});

// F014 Stage A2 closeout: reminders were dossier-named ("reminders" in
// F014-CAP-002) but not wired to any Meeting lifecycle path. Meetings now
// join the SAME shared crm_activity_reminders engine Follow-ups (F016)
// already uses, imported from follow-up-operations.js, not a second
// reminder system.
test("F014: scheduled/booked Meetings join the shared reminder engine on schedule, reschedule and cancel/complete", () => {
  const meeting = service();
  const communication = communications();
  assert.match(meeting, /import \{ createRemindersForActivity, cancelPendingRemindersForActivity \} from "\.\/follow-ups\/follow-up-operations\.js"/);
  const createBlock = meeting.match(/export async function createCrmMeeting[\s\S]*?\n\}\n\nexport async function updateCrmMeeting/)?.[0] || "";
  assert.match(createBlock, /if \(mode === "schedule"\) \{[\s\S]*await createRemindersForActivity\(client, context, meeting\.id, startAt\);[\s\S]*\n  \}/);
  const updateBlock = meeting.match(/export async function updateCrmMeeting[\s\S]*?\n\}\n\nexport async function startCrmMeeting/)?.[0] || "";
  assert.match(updateBlock, /if \(rescheduled && after\.startAt\) \{\s*\n\s*await cancelPendingRemindersForActivity\(client, context, id\);\s*\n\s*await createRemindersForActivity\(client, context, id, after\.startAt\);/);
  const completeBlock = meeting.match(/export async function completeCrmMeeting[\s\S]*?\n\}\n\nexport async function cancelCrmMeeting/)?.[0] || "";
  assert.match(completeBlock, /await cancelPendingRemindersForActivity\(client, context, id\);/);
  const cancelBlock = meeting.match(/export async function cancelCrmMeeting[\s\S]*$/)?.[0] || "";
  assert.match(cancelBlock, /await cancelPendingRemindersForActivity\(client, context, id\);/);

  assert.match(communication, /import \{ createRemindersForActivity, cancelPendingRemindersForActivity \} from "\.\/follow-ups\/follow-up-operations\.js"/);
  const bookBlock = communication.match(/export async function bookMeeting[\s\S]*?\n\}/)?.[0] || "";
  assert.match(bookBlock, /await createRemindersForActivity\(client, context, meetingActivity\.rows\[0\]\.id, desiredStart\);/);
  const cancelBookingBlock = communication.match(/export async function cancelMeetingBooking[\s\S]*?export async function rescheduleMeetingBooking/)?.[0] || "";
  assert.match(cancelBookingBlock, /await cancelPendingRemindersForActivity\(client, context, activity\.rows\[0\]\.id\);/);
  const rescheduleBookingBlock = communication.match(/export async function rescheduleMeetingBooking[\s\S]*?export async function getCommunicationTimeline/)?.[0] || "";
  assert.match(rescheduleBookingBlock, /await cancelPendingRemindersForActivity\(client, context, activity\.rows\[0\]\.id\);/);
  assert.match(rescheduleBookingBlock, /await createRemindersForActivity\(client, context, activity\.rows\[0\]\.id, desiredStart\);/);
});

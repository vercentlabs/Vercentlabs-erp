import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";
import pg from "pg";

import { createCrmRecord } from "../../services/api/src/modules/crm/index.js";
import {
  cancelCrmMeeting,
  completeCrmMeeting,
  createCrmMeeting,
  getCrmMeeting,
  listCrmMeetingEvents,
  startCrmMeeting,
  updateCrmMeeting,
} from "../../services/api/src/modules/crm/seller-activity-and-follow-up-workspace/meeting-operations.js";
import {
  bookMeeting,
  cancelMeetingBooking,
  getMeetingAvailability,
  rescheduleMeetingBooking,
} from "../../services/api/src/modules/crm/seller-activity-and-follow-up-workspace/communications.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [
  path.join(root, "apps/web/.env.local"),
  path.join(root, "apps/web/.env"),
  path.join(root, ".env"),
]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false });
}

const connectionString = String(
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || "",
).trim();
if (!connectionString) {
  throw new Error(
    "MIGRATION_DATABASE_URL or DATABASE_URL is required for F014 live verification. " +
      "The verifier loads apps/web/.env.local, apps/web/.env and .env automatically.",
  );
}

const client = new pg.Client({
  connectionString,
  application_name: "vercentlabs-f014-live-verifier",
});

const result = {
  meetingColumnsPresent: false,
  historyTablePresent: false,
  historyRlsForced: false,
  scheduledMeetingCreated: false,
  attendeeStored: false,
  genericCreateBlocked: false,
  updateApplied: false,
  updateReplayMutationFree: false,
  staleUpdateBlocked: false,
  staleUpdateMutationFree: false,
  startApplied: false,
  startReplayMutationFree: false,
  completionApplied: false,
  completionReplayMutationFree: false,
  parentTouchedOnHeldCompletion: false,
  cancelApplied: false,
  cancelReplayMutationFree: false,
  historyWritten: false,
  outboxWritten: false,
  piiExcludedFromOutbox: false,
  publicBookingCreatedMeeting: false,
  publicBookingReplayMutationFree: false,
  publicBookingRescheduleSynchronized: false,
  publicBookingCancelSynchronized: false,
  publicBookingCompletionSynchronized: false,
  completedPublicBookingCannotRevert: false,
  rolledBack: false,
};

let transactionOpen = false;
let organizationId = null;
let manualMeetingId = null;
let publicMeetingId = null;

function weekdayAvailability() {
  const window = [{ start: "00:00", end: "23:45" }];
  return {
    sunday: window,
    monday: window,
    tuesday: window,
    wednesday: window,
    thursday: window,
    friday: window,
    saturday: window,
  };
}

function futureDate(days) {
  const value = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return value.toISOString().slice(0, 10);
}

await client.connect();
try {
  await client.query("BEGIN");
  transactionOpen = true;

  const columns = await client.query(`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema='tenant'
       AND table_name='crm_activities'
       AND column_name IN (
         'meeting_location_type','meeting_url','meeting_outcome_code',
         'meeting_started_at','meeting_ended_at','meeting_duration_seconds',
         'meeting_booking_id','meeting_calendar_event_id'
       )`);
  result.meetingColumnsPresent = columns.rowCount === 8;
  result.historyTablePresent = Boolean(
    (await client.query(`SELECT to_regclass('tenant.crm_meeting_events') AS table_name`))
      .rows[0]?.table_name,
  );
  const rel = (
    await client.query(
      `SELECT relrowsecurity,relforcerowsecurity
         FROM pg_class
        WHERE oid='tenant.crm_meeting_events'::regclass`,
    )
  ).rows[0];
  result.historyRlsForced = Boolean(rel?.relrowsecurity && rel?.relforcerowsecurity);

  const base = (
    await client.query(`
      SELECT organization.id AS organization_id,company.id AS company_id
        FROM public.organizations organization
        JOIN public.companies company
          ON company.organization_id=organization.id AND company.status='active'
       WHERE organization.status='active'
       ORDER BY company.is_primary DESC,organization.created_at,company.created_at
       LIMIT 1`)
  ).rows[0];
  if (!base) throw new Error("F014 live verification requires an active organization/company.");
  organizationId = base.organization_id;
  await client.query("SELECT set_config('app.current_organization_id',$1,true)", [organizationId]);

  const seller = (
    await client.query(
      `SELECT membership.user_id
         FROM public.organization_memberships membership
         JOIN public.users user_account
           ON user_account.id=membership.user_id AND user_account.status='active'
        WHERE membership.organization_id=$1
          AND membership.status='active'
          AND EXISTS (
            SELECT 1
              FROM public.user_role_assignments assignment
              JOIN public.roles role
                ON role.organization_id=assignment.organization_id
               AND role.id=assignment.role_id
               AND role.status='active'
              LEFT JOIN public.role_permissions permission
                ON permission.role_id=role.id AND permission.permission_key='crm.view'
             WHERE assignment.organization_id=membership.organization_id
               AND assignment.user_id=membership.user_id
               AND assignment.status='active'
               AND assignment.starts_at<=now()
               AND (assignment.expires_at IS NULL OR assignment.expires_at>now())
               AND (role.slug='organization_owner' OR permission.permission_key IS NOT NULL)
          )
        ORDER BY membership.created_at,membership.user_id
        LIMIT 1`,
      [organizationId],
    )
  ).rows[0];
  if (!seller) throw new Error("F014 verification organization has no active CRM-eligible member.");

  const initialStage = (
    await client.query(
      `SELECT code
         FROM tenant.crm_lead_stages
        WHERE organization_id=$1 AND status='active'
        ORDER BY is_initial DESC,sort_order,id LIMIT 1`,
      [organizationId],
    )
  ).rows[0];
  if (!initialStage) throw new Error("F014 verification organization has no active Lead lifecycle stage.");

  const context = {
    organizationId,
    userId: seller.user_id,
    activeCompanyId: base.company_id,
    activeBranchId: null,
    allowAllCompanies: true,
    roleSlugs: ["organization_owner"],
    permissions: ["crm.view", "crm.activities.manage", "crm.records.view_all"],
  };

  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const leadId = randomUUID();
  await client.query(
    `INSERT INTO tenant.crm_leads(
       id,organization_id,company_id,branch_id,code,first_name,email,status,
       record_status,owner_user_id,created_by,updated_by)
     VALUES($1,$2,$3,NULL,$4,$5,$6,$7,'active',$8,$8,$8)`,
    [
      leadId,
      organizationId,
      base.company_id,
      `F014-${suffix}`,
      `F014 Verify ${suffix}`,
      `f014-${suffix}@example.invalid`,
      initialStage.code,
      seller.user_id,
    ],
  );

  const initialEventCount = Number(
    (
      await client.query(
        `SELECT count(*)::int AS count FROM tenant.crm_meeting_events WHERE organization_id=$1`,
        [organizationId],
      )
    ).rows[0]?.count || 0,
  );
  const initialOutboxCount = Number(
    (
      await client.query(
        `SELECT count(*)::int AS count
           FROM tenant.platform_events
          WHERE organization_id=$1 AND event_type LIKE 'crm.meeting.%'`,
        [organizationId],
      )
    ).rows[0]?.count || 0,
  );

  const startAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const endAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const privateGuest = `private-${suffix}@example.invalid`;
  const privateUrl = `https://meet.example.invalid/${suffix}`;
  const scheduled = await createCrmMeeting(client, context, {
    mode: "schedule",
    entityType: "lead",
    entityId: leadId,
    subject: `F014 scheduled ${suffix}`,
    startAt,
    endAt,
    locationType: "online",
    meetingUrl: privateUrl,
    attendees: [{ email: privateGuest, name: "Private verifier guest" }],
  });
  manualMeetingId = scheduled.id;
  result.scheduledMeetingCreated =
    scheduled.status === "planned" && scheduled.activityType === "meeting";
  const attendeeRows = await client.query(
    `SELECT email FROM tenant.crm_activity_attendees
      WHERE organization_id=$1 AND activity_id=$2`,
    [organizationId, manualMeetingId],
  );
  result.attendeeStored =
    attendeeRows.rowCount === 1 && attendeeRows.rows[0]?.email === privateGuest;

  try {
    await createCrmRecord(client, context, "activities", {
      activityType: "meeting",
      subject: "F014 bypass",
    });
  } catch (error) {
    result.genericCreateBlocked = error?.code === "CRM_MEETING_API_MOVED";
  }

  const current = await getCrmMeeting(client, context, manualMeetingId);
  const updated = await updateCrmMeeting(client, context, manualMeetingId, {
    subject: `${current.subject} updated`,
    expectedUpdatedAt: new Date(current.updatedAt).toISOString(),
    expectedStatus: current.status,
  });
  result.updateApplied = updated.subject.endsWith(" updated");

  const beforeUpdateReplay = (
    await client.query(
      `SELECT
         (SELECT count(*)::int FROM tenant.crm_meeting_events WHERE organization_id=$1 AND activity_id=$2) AS events,
         (SELECT count(*)::int FROM tenant.platform_events WHERE organization_id=$1 AND entity_type='meeting' AND entity_id=$2) AS outbox`,
      [organizationId, manualMeetingId],
    )
  ).rows[0];
  const updateReplay = await updateCrmMeeting(client, context, manualMeetingId, {
    subject: updated.subject,
    expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    expectedStatus: "planned",
  });
  const afterUpdateReplay = (
    await client.query(
      `SELECT
         (SELECT count(*)::int FROM tenant.crm_meeting_events WHERE organization_id=$1 AND activity_id=$2) AS events,
         (SELECT count(*)::int FROM tenant.platform_events WHERE organization_id=$1 AND entity_type='meeting' AND entity_id=$2) AS outbox`,
      [organizationId, manualMeetingId],
    )
  ).rows[0];
  result.updateReplayMutationFree =
    updateReplay.replayed === true &&
    Number(afterUpdateReplay.events) === Number(beforeUpdateReplay.events) &&
    Number(afterUpdateReplay.outbox) === Number(beforeUpdateReplay.outbox);

  const beforeStale = await getCrmMeeting(client, context, manualMeetingId);
  try {
    await updateCrmMeeting(client, context, manualMeetingId, {
      subject: "F014 stale mutation",
      expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
      expectedStatus: beforeStale.status,
    });
  } catch (error) {
    result.staleUpdateBlocked = error?.code === "CRM_MEETING_STALE_WRITE";
  }
  const afterStale = await getCrmMeeting(client, context, manualMeetingId);
  result.staleUpdateMutationFree =
    afterStale.subject === beforeStale.subject &&
    new Date(afterStale.updatedAt).toISOString() ===
      new Date(beforeStale.updatedAt).toISOString();

  const beforeStartEvents = Number(
    (
      await client.query(
        `SELECT count(*)::int AS count
           FROM tenant.crm_meeting_events
          WHERE organization_id=$1 AND activity_id=$2`,
        [organizationId, manualMeetingId],
      )
    ).rows[0]?.count || 0,
  );
  const started = await startCrmMeeting(client, context, manualMeetingId, {
    expectedUpdatedAt: new Date(afterStale.updatedAt).toISOString(),
    expectedStatus: afterStale.status,
  });
  result.startApplied = started.status === "in_progress" && Boolean(started.actualStartedAt);
  const startReplay = await startCrmMeeting(client, context, manualMeetingId, {
    expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    expectedStatus: "planned",
  });
  const afterStartEvents = Number(
    (
      await client.query(
        `SELECT count(*)::int AS count
           FROM tenant.crm_meeting_events
          WHERE organization_id=$1 AND activity_id=$2`,
        [organizationId, manualMeetingId],
      )
    ).rows[0]?.count || 0,
  );
  result.startReplayMutationFree =
    startReplay.replayed === true && afterStartEvents === beforeStartEvents + 1;

  const beforeCompletion = (
    await client.query(
      `SELECT
         (SELECT count(*)::int FROM tenant.crm_meeting_events WHERE organization_id=$1 AND activity_id=$2) AS events,
         (SELECT count(*)::int FROM tenant.platform_events WHERE organization_id=$1 AND entity_type='meeting' AND entity_id=$2) AS outbox`,
      [organizationId, manualMeetingId],
    )
  ).rows[0];
  const completed = await completeCrmMeeting(client, context, manualMeetingId, {
    outcomeCode: "held",
    outcome: "private F014 verifier outcome note",
    expectedUpdatedAt: new Date(started.updatedAt).toISOString(),
    expectedStatus: "in_progress",
  });
  result.completionApplied =
    completed.status === "completed" &&
    completed.outcomeCode === "held" &&
    Number(completed.durationSeconds) >= 0;
  const completionReplay = await completeCrmMeeting(client, context, manualMeetingId, {
    outcomeCode: "held",
    outcome: "private F014 verifier outcome note",
    expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    expectedStatus: "planned",
  });
  const afterCompletion = (
    await client.query(
      `SELECT
         (SELECT count(*)::int FROM tenant.crm_meeting_events WHERE organization_id=$1 AND activity_id=$2) AS events,
         (SELECT count(*)::int FROM tenant.platform_events WHERE organization_id=$1 AND entity_type='meeting' AND entity_id=$2) AS outbox`,
      [organizationId, manualMeetingId],
    )
  ).rows[0];
  result.completionReplayMutationFree =
    completionReplay.replayed === true &&
    Number(afterCompletion.events) === Number(beforeCompletion.events) + 1 &&
    Number(afterCompletion.outbox) === Number(beforeCompletion.outbox) + 1;
  const leadAfter = (
    await client.query(
      `SELECT last_contacted_at,first_responded_at
         FROM tenant.crm_leads WHERE organization_id=$1 AND id=$2`,
      [organizationId, leadId],
    )
  ).rows[0];
  result.parentTouchedOnHeldCompletion = Boolean(
    leadAfter?.last_contacted_at && leadAfter?.first_responded_at,
  );

  const cancellable = await createCrmMeeting(client, context, {
    mode: "schedule",
    entityType: "lead",
    entityId: leadId,
    subject: `F014 cancel ${suffix}`,
    startAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    endAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
    locationType: "other",
  });
  const beforeCancelEvents = Number(
    (
      await client.query(
        `SELECT count(*)::int AS count
           FROM tenant.crm_meeting_events
          WHERE organization_id=$1 AND activity_id=$2`,
        [organizationId, cancellable.id],
      )
    ).rows[0]?.count || 0,
  );
  const cancelled = await cancelCrmMeeting(client, context, cancellable.id, {
    expectedUpdatedAt: new Date(cancellable.updatedAt).toISOString(),
    expectedStatus: "planned",
  });
  result.cancelApplied = cancelled.status === "cancelled";
  const cancelReplay = await cancelCrmMeeting(client, context, cancellable.id, {
    expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    expectedStatus: "planned",
  });
  const afterCancelEvents = Number(
    (
      await client.query(
        `SELECT count(*)::int AS count
           FROM tenant.crm_meeting_events
          WHERE organization_id=$1 AND activity_id=$2`,
        [organizationId, cancellable.id],
      )
    ).rows[0]?.count || 0,
  );
  result.cancelReplayMutationFree =
    cancelReplay.replayed === true && afterCancelEvents === beforeCancelEvents + 1;

  const history = await listCrmMeetingEvents(client, context, manualMeetingId, 50);
  result.historyWritten =
    history.some((event) => event.eventType === "scheduled") &&
    history.some((event) => event.eventType === "started") &&
    history.some((event) => event.eventType === "completed");

  const currentEventCount = Number(
    (
      await client.query(
        `SELECT count(*)::int AS count FROM tenant.crm_meeting_events WHERE organization_id=$1`,
        [organizationId],
      )
    ).rows[0]?.count || 0,
  );
  const currentOutboxCount = Number(
    (
      await client.query(
        `SELECT count(*)::int AS count
           FROM tenant.platform_events
          WHERE organization_id=$1 AND event_type LIKE 'crm.meeting.%'`,
        [organizationId],
      )
    ).rows[0]?.count || 0,
  );
  result.historyWritten = result.historyWritten && currentEventCount >= initialEventCount + 6;
  result.outboxWritten = currentOutboxCount >= initialOutboxCount + 6;
  const leakedManual = Number(
    (
      await client.query(
        `SELECT count(*)::int AS count
           FROM tenant.platform_events
          WHERE organization_id=$1 AND entity_type='meeting'
            AND (payload::text LIKE $2 OR payload::text LIKE $3 OR payload::text LIKE $4)`,
        [
          organizationId,
          `%${privateGuest}%`,
          `%${suffix}%`,
          "%private F014 verifier outcome note%",
        ],
      )
    ).rows[0]?.count || 0,
  );
  // suffix appears in the subject and join URL; safe meeting outbox payload intentionally
  // contains neither, so suffix is a strong leak sentinel in addition to email/note.
  result.piiExcludedFromOutbox = leakedManual === 0;

  // Public booking bridge. Use a synthetic link with broad availability and choose
  // slots from the real availability service so no assumption is made about current time.
  const meetingLinkId = randomUUID();
  await client.query(
    `INSERT INTO tenant.crm_meeting_links(
       id,organization_id,company_id,owner_user_id,name,slug,duration_minutes,
       buffer_before_minutes,buffer_after_minutes,timezone,availability,
       meeting_provider,location_template,status,minimum_notice_minutes,maximum_days_ahead,
       created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,30,0,0,'UTC',$7,'manual',$8,'active',0,60,$4,$4)`,
    [
      meetingLinkId,
      organizationId,
      base.company_id,
      seller.user_id,
      `F014 public ${suffix}`,
      `f014-${suffix}`,
      JSON.stringify(weekdayAvailability()),
      "Verifier meeting room",
    ],
  );

  const bookingDate = futureDate(10);
  const slots = await getMeetingAvailability(client, context, meetingLinkId, bookingDate, {
    now: new Date(),
  });
  if (slots.length < 2) {
    throw new Error("F014 live verifier could not obtain two public booking slots 10 days ahead.");
  }
  const guestEmail = `booking-${suffix}@example.invalid`;
  const booking = await bookMeeting(client, context, meetingLinkId, {
    startsAt: slots[0].startsAt,
    guestName: "F014 Public Guest",
    guestEmail,
    guestTimezone: "UTC",
    notes: "private public booking note",
  });
  publicMeetingId = booking.meeting_activity_id;
  const bridged = await client.query(
    `SELECT activity.status,activity.start_at,activity.end_at,activity.meeting_booking_id,
            (SELECT count(*)::int FROM tenant.crm_activity_attendees attendee
              WHERE attendee.organization_id=activity.organization_id AND attendee.activity_id=activity.id) AS attendees
       FROM tenant.crm_activities activity
      WHERE activity.organization_id=$1 AND activity.id=$2 AND activity.activity_type='meeting'`,
    [organizationId, publicMeetingId],
  );
  result.publicBookingCreatedMeeting =
    bridged.rowCount === 1 &&
    bridged.rows[0].meeting_booking_id === booking.id &&
    Number(bridged.rows[0].attendees) === 1;

  const beforeBookingReplay = (
    await client.query(
      `SELECT
         (SELECT count(*)::int FROM tenant.crm_meeting_bookings WHERE organization_id=$1 AND meeting_link_id=$2) AS bookings,
         (SELECT count(*)::int FROM tenant.crm_activities WHERE organization_id=$1 AND meeting_booking_id=$3) AS activities,
         (SELECT count(*)::int FROM tenant.crm_meeting_events WHERE organization_id=$1 AND activity_id=$4) AS events`,
      [organizationId, meetingLinkId, booking.id, publicMeetingId],
    )
  ).rows[0];
  const bookingReplay = await bookMeeting(client, context, meetingLinkId, {
    startsAt: slots[0].startsAt,
    guestName: "F014 Public Guest",
    guestEmail,
    guestTimezone: "UTC",
    notes: "private public booking note",
  });
  const afterBookingReplay = (
    await client.query(
      `SELECT
         (SELECT count(*)::int FROM tenant.crm_meeting_bookings WHERE organization_id=$1 AND meeting_link_id=$2) AS bookings,
         (SELECT count(*)::int FROM tenant.crm_activities WHERE organization_id=$1 AND meeting_booking_id=$3) AS activities,
         (SELECT count(*)::int FROM tenant.crm_meeting_events WHERE organization_id=$1 AND activity_id=$4) AS events`,
      [organizationId, meetingLinkId, booking.id, publicMeetingId],
    )
  ).rows[0];
  result.publicBookingReplayMutationFree =
    bookingReplay.replayed === true &&
    bookingReplay.id === booking.id &&
    bookingReplay.meeting_activity_id === publicMeetingId &&
    ["bookings", "activities", "events"].every(
      (key) => Number(afterBookingReplay[key]) === Number(beforeBookingReplay[key]),
    );

  const slotsAfterBooking = await getMeetingAvailability(
    client,
    context,
    meetingLinkId,
    bookingDate,
    { now: new Date() },
  );
  const replacementSlot = slotsAfterBooking.find((slot) => slot.startsAt !== slots[0].startsAt);
  if (!replacementSlot) throw new Error("F014 verifier could not obtain a reschedule slot.");
  const rescheduled = await rescheduleMeetingBooking(client, context, booking.id, {
    startsAt: replacementSlot.startsAt,
    guestTimezone: "UTC",
    now: new Date(),
  });
  const afterReschedule = (
    await client.query(
      `SELECT start_at,end_at,status FROM tenant.crm_activities
        WHERE organization_id=$1 AND id=$2`,
      [organizationId, publicMeetingId],
    )
  ).rows[0];
  result.publicBookingRescheduleSynchronized =
    new Date(rescheduled.starts_at).toISOString() === replacementSlot.startsAt &&
    new Date(afterReschedule.start_at).toISOString() === replacementSlot.startsAt &&
    ["planned", "overdue"].includes(afterReschedule.status);

  const bookingCancelled = await cancelMeetingBooking(
    client,
    context,
    booking.id,
    "F014 verifier cancellation",
  );
  const afterBookingCancel = (
    await client.query(
      `SELECT activity.status,event.provider_status
         FROM tenant.crm_activities activity
         JOIN tenant.crm_calendar_events event
           ON event.organization_id=activity.organization_id
          AND event.id=activity.meeting_calendar_event_id
        WHERE activity.organization_id=$1 AND activity.id=$2`,
      [organizationId, publicMeetingId],
    )
  ).rows[0];
  result.publicBookingCancelSynchronized =
    bookingCancelled.status === "cancelled" &&
    afterBookingCancel?.status === "cancelled" &&
    afterBookingCancel?.provider_status === "cancelled";

  // A second public booking is completed through the governed Meeting lifecycle.
  // Completion must terminalize the underlying booking so a later public cancel
  // token cannot revert the completed CRM Meeting back to cancelled.
  const completionSlots = await getMeetingAvailability(
    client,
    context,
    meetingLinkId,
    bookingDate,
    { now: new Date() },
  );
  const completionSlot = completionSlots[0];
  if (!completionSlot) throw new Error("F014 verifier could not obtain a public completion slot.");
  const completionBooking = await bookMeeting(client, context, meetingLinkId, {
    startsAt: completionSlot.startsAt,
    guestName: "F014 Completion Guest",
    guestEmail: `complete-${suffix}@example.invalid`,
    guestTimezone: "UTC",
  });
  const completionMeeting = await getCrmMeeting(
    client,
    context,
    completionBooking.meeting_activity_id,
  );
  const publicStarted = await startCrmMeeting(
    client,
    context,
    completionMeeting.id,
    {
      expectedUpdatedAt: new Date(completionMeeting.updatedAt).toISOString(),
      expectedStatus: completionMeeting.status,
    },
  );
  const publicCompleted = await completeCrmMeeting(
    client,
    context,
    completionMeeting.id,
    {
      outcomeCode: "held",
      expectedUpdatedAt: new Date(publicStarted.updatedAt).toISOString(),
      expectedStatus: "in_progress",
    },
  );
  const terminalBooking = (
    await client.query(
      `SELECT status FROM tenant.crm_meeting_bookings WHERE organization_id=$1 AND id=$2`,
      [organizationId, completionBooking.id],
    )
  ).rows[0];
  result.publicBookingCompletionSynchronized =
    publicCompleted.status === "completed" && terminalBooking?.status === "completed";
  try {
    await cancelMeetingBooking(
      client,
      context,
      completionBooking.id,
      "must not revert completed Meeting",
    );
  } catch (error) {
    const stillCompleted = (
      await client.query(
        `SELECT status FROM tenant.crm_activities WHERE organization_id=$1 AND id=$2`,
        [organizationId, completionMeeting.id],
      )
    ).rows[0];
    result.completedPublicBookingCannotRevert =
      Number(error?.status) === 409 && stillCompleted?.status === "completed";
  }

  const leakedBooking = Number(
    (
      await client.query(
        `SELECT count(*)::int AS count
           FROM tenant.platform_events
          WHERE organization_id=$1 AND event_type='crm.meeting.booked'
            AND payload::text LIKE $2`,
        [organizationId, `%${guestEmail}%`],
      )
    ).rows[0]?.count || 0,
  );
  result.piiExcludedFromOutbox = result.piiExcludedFromOutbox && leakedBooking === 0;

  await client.query("ROLLBACK");
  transactionOpen = false;
  await client.query("SELECT set_config('app.current_organization_id',$1,false)", [organizationId]);
  const afterRollback = await client.query(
    `SELECT count(*)::int AS count
       FROM tenant.crm_activities
      WHERE organization_id=$1 AND id = ANY($2::uuid[])`,
    [organizationId, [manualMeetingId, publicMeetingId].filter(Boolean)],
  );
  result.rolledBack = Number(afterRollback.rows[0]?.count || 0) === 0;

  if (Object.values(result).some((value) => value !== true)) {
    throw new Error(`F014 live verification failed: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result));
} catch (error) {
  if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}

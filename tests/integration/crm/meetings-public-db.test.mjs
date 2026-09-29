// F014 public booking against real PostgreSQL on the restricted runtime role:
// host-scoped availability, booking horizon, bounded guest input, concurrent
// double-booking, replay, and the durable (multi-replica) rate limiter.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { enforceRateLimit } from "../../../services/api/src/core/security/request-security.js";
import {
  bookMeeting,
  cancelMeetingBooking,
  getMeetingAvailability,
  rescheduleMeetingBooking,
} from "../../../services/api/src/modules/crm/seller-activity-and-follow-up-workspace/communications.js";
import { publicMeetingContext } from "../../../services/api/src/modules/crm/seller-activity-and-follow-up-workspace/public-meetings.js";
import { createRuntimeKit, expectCode } from "../shared-runtime/runtime-kit.mjs";

const ALL_DAY = Object.fromEntries(
  ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => [day, [{ start: "09:00", end: "17:00" }]]),
);
const isoDay = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function meetingLink(kit, org, hostId, { maximumDaysAhead = 30 } = {}) {
  const id = randomUUID();
  await kit.owner.query(
    `INSERT INTO tenant.crm_meeting_links(id,organization_id,company_id,owner_user_id,name,slug,duration_minutes,timezone,availability,minimum_notice_minutes,maximum_days_ahead,status)
     VALUES($1,$2,$3,$4,'Intro call',$5,30,'UTC',$6::jsonb,0,$7,'active')`,
    [id, org.organizationId, org.companyId, hostId, `intro-${id.slice(0, 8)}`, JSON.stringify(ALL_DAY), maximumDaysAhead],
  );
  return id;
}

async function hostMeeting(kit, org, hostId, startsAt, minutes = 60) {
  await kit.owner.query(
    `INSERT INTO tenant.crm_activities(organization_id,company_id,entity_type,activity_type,subject,status,priority,assigned_to,start_at,due_at,end_at,created_by)
     VALUES($1,$2,'general','meeting','Existing meeting','planned','medium',$3,$4,$4,$5,$3)`,
    [org.organizationId, org.companyId, hostId, startsAt, new Date(Date.parse(startsAt) + minutes * 60000).toISOString()],
  );
}

test("F014 public booking on the runtime role", async (t) => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["alice", "bob"]);
    const alice = org.ids.alice;
    const bob = org.ids.bob;
    const linkId = await meetingLink(kit, org, alice);
    const host = publicMeetingContext({ organizationId: org.organizationId, hostUserId: alice });
    const day = isoDay(3);
    const slots = (date = day, extra = {}) => kit.tenant(org.organizationId, (client) => getMeetingAvailability(client, host, linkId, date, extra));
    const book = (input) => kit.tenant(org.organizationId, (client) => bookMeeting(client, host, linkId, input));

    await t.test("another host's meetings never block this host's slots", async () => {
      const before = await slots();
      assert.equal(before.length, 31, "09:00 to 16:30 starts in 15-minute steps for a 30-minute meeting");
      await hostMeeting(kit, org, bob, `${day}T10:00:00.000Z`);
      assert.equal((await slots()).length, before.length, "Bob's meeting does not touch Alice's page");
      // Calendar rows as upsertMeetingCalendarEvent / provider sync write them:
      // Bob's internal meeting mirror and an event on Bob's connected calendar.
      const syncAccount = async (userId) => {
        const id = randomUUID();
        await kit.owner.query(
          `INSERT INTO tenant.crm_sync_accounts(id,organization_id,company_id,user_id,provider,display_name,credential_reference,status)
           VALUES($1,$2,$3,$4,'calendar','Calendar','env:TEST_TOKEN','connected')`,
          [id, org.organizationId, org.companyId, userId],
        );
        return id;
      };
      const calendarEvent = async (startsAt, { createdBy, syncAccountId = null }) =>
        kit.owner.query(
          `INSERT INTO tenant.crm_calendar_events(organization_id,company_id,sync_account_id,provider,external_event_id,title,starts_at,ends_at,provider_status,created_by)
           VALUES($1,$2,$3,'internal',$4,'Busy',$5,$6,'confirmed',$7)`,
          [org.organizationId, org.companyId, syncAccountId, `evt-${randomUUID()}`, startsAt, new Date(Date.parse(startsAt) + 3600000).toISOString(), createdBy],
        );
      await calendarEvent(`${day}T11:00:00.000Z`, { createdBy: bob });
      await calendarEvent(`${day}T12:00:00.000Z`, { createdBy: bob, syncAccountId: await syncAccount(bob) });
      assert.equal((await slots()).length, before.length, "Bob's calendar (internal mirror and connected account) does not touch Alice's page");

      await hostMeeting(kit, org, alice, `${day}T10:00:00.000Z`);
      await calendarEvent(`${day}T12:00:00.000Z`, { createdBy: alice, syncAccountId: await syncAccount(alice) });
      const after = await slots();
      assert.ok(!after.some((slot) => slot.startsAt === `${day}T10:00:00.000Z`), "Alice's own meeting blocks her slot");
      assert.ok(!after.some((slot) => slot.startsAt === `${day}T12:00:00.000Z`), "an event on Alice's connected calendar blocks her slot");
      assert.ok(after.some((slot) => slot.startsAt === `${day}T11:00:00.000Z`), "Bob's 11:00 does not");
    });

    await t.test("the booking horizon is enforced: past days and days beyond maximum_days_ahead have no slots", async () => {
      assert.deepEqual(await slots(isoDay(-1)), []);
      assert.deepEqual(await slots(isoDay(31)), []);
      assert.ok((await slots(isoDay(30))).length > 0, "the last day inside the horizon is bookable");
      await assert.rejects(
        book({ startsAt: `${isoDay(45)}T09:00:00.000Z`, guestName: "Far Future", guestEmail: "far@example.test" }),
        expectCode("CRM_MEETING_SLOT_UNAVAILABLE"),
      );
    });

    await t.test("guest input is bounded and validated before anything is written", async () => {
      const startsAt = `${day}T13:00:00.000Z`;
      await assert.rejects(book({ startsAt, guestName: "x".repeat(201), guestEmail: "g@example.test" }), expectCode("CRM_MEETING_GUEST_NAME_INVALID"));
      await assert.rejects(book({ startsAt, guestName: "", guestEmail: "g@example.test" }), expectCode("CRM_MEETING_GUEST_NAME_INVALID"));
      await assert.rejects(book({ startsAt, guestName: "G", guestEmail: "not-an-email" }), expectCode("CRM_EMAIL_INVALID"));
      await assert.rejects(book({ startsAt, guestName: "G", guestEmail: `${"a".repeat(250)}@example.test` }), expectCode("CRM_EMAIL_INVALID"));
      await assert.rejects(book({ startsAt, guestName: "G", guestEmail: "g@example.test", guestTimezone: "Mars/Olympus" }), expectCode("CRM_MEETING_TIMEZONE_INVALID"));
      await assert.rejects(book({ startsAt, guestName: "G", guestEmail: "g@example.test", notes: "n".repeat(2001) }), expectCode("CRM_MEETING_NOTES_TOO_LONG"));
      const count = await kit.owner.query(`SELECT count(*)::int AS n FROM tenant.crm_meeting_bookings WHERE organization_id=$1`, [org.organizationId]);
      assert.equal(count.rows[0].n, 0);
    });

    await t.test("two guests racing for one slot: exactly one booking wins, the other gets a clean 409", async () => {
      const startsAt = `${day}T14:00:00.000Z`;
      const results = await Promise.allSettled([
        book({ startsAt, guestName: "Racer One", guestEmail: "one@example.test", guestTimezone: "Asia/Kolkata" }),
        book({ startsAt, guestName: "Racer Two", guestEmail: "two@example.test" }),
      ]);
      const won = results.filter((result) => result.status === "fulfilled");
      const lost = results.filter((result) => result.status === "rejected");
      assert.equal(won.length, 1);
      assert.equal(lost.length, 1);
      assert.equal(lost[0].reason.code, "CRM_MEETING_SLOT_UNAVAILABLE");
      const rows = await kit.owner.query(`SELECT count(*)::int AS n FROM tenant.crm_meeting_bookings WHERE organization_id=$1 AND starts_at=$2 AND status='confirmed'`, [org.organizationId, startsAt]);
      assert.equal(rows.rows[0].n, 1);
    });

    await t.test("an exact lost-response retry replays the committed booking without a second activity", async () => {
      const input = { startsAt: `${day}T15:00:00.000Z`, guestName: "Retry Guest", guestEmail: "retry@example.test" };
      const first = await book(input);
      const second = await book(input);
      assert.equal(second.id, first.id);
      assert.equal(second.replayed, true);
      const activities = await kit.owner.query(`SELECT count(*)::int AS n FROM tenant.crm_activities WHERE organization_id=$1 AND meeting_booking_id=$2`, [org.organizationId, first.id]);
      assert.equal(activities.rows[0].n, 1);
      const jobs = await kit.owner.query(`SELECT count(*)::int AS n FROM tenant.background_jobs WHERE organization_id=$1 AND job_type='crm.meetings.calendar_push'`, [org.organizationId]);
      assert.ok(jobs.rows[0].n >= 1, "calendar push intent is queued durably");
    });

    await t.test("reschedule validates the time zone and the horizon; cancel bounds the reason and is idempotent", async () => {
      const booking = await book({ startsAt: `${day}T16:00:00.000Z`, guestName: "Mover", guestEmail: "mover@example.test" });
      await assert.rejects(
        kit.tenant(org.organizationId, (client) => rescheduleMeetingBooking(client, host, booking.id, { startsAt: `${day}T09:00:00.000Z`, guestTimezone: "Nowhere/Zone" })),
        expectCode("CRM_MEETING_TIMEZONE_INVALID"),
      );
      await assert.rejects(
        kit.tenant(org.organizationId, (client) => rescheduleMeetingBooking(client, host, booking.id, { startsAt: `${isoDay(60)}T09:00:00.000Z` })),
        expectCode("CRM_MEETING_SLOT_UNAVAILABLE"),
      );
      const moved = await kit.tenant(org.organizationId, (client) => rescheduleMeetingBooking(client, host, booking.id, { startsAt: `${day}T09:00:00.000Z` }));
      assert.equal(new Date(moved.starts_at).toISOString(), `${day}T09:00:00.000Z`);
      await assert.rejects(
        kit.tenant(org.organizationId, (client) => cancelMeetingBooking(client, host, booking.id, "r".repeat(1001))),
        expectCode("CRM_MEETING_CANCEL_REASON_TOO_LONG"),
      );
      const cancelled = await kit.tenant(org.organizationId, (client) => cancelMeetingBooking(client, host, booking.id, "Changed plans"));
      assert.equal(cancelled.status, "cancelled");
      const again = await kit.tenant(org.organizationId, (client) => cancelMeetingBooking(client, host, booking.id, "Changed plans"));
      assert.equal(again.replayed, true);
      const meeting = await kit.owner.query(`SELECT status FROM tenant.crm_activities WHERE organization_id=$1 AND meeting_booking_id=$2`, [org.organizationId, booking.id]);
      assert.equal(meeting.rows[0].status, "cancelled", "the linked CRM meeting follows the booking");
    });

    await t.test("another organisation cannot book against this link", async () => {
      const other = await kit.organization(["mallory"]);
      const foreign = publicMeetingContext({ organizationId: other.organizationId, hostUserId: other.ids.mallory });
      await assert.rejects(
        kit.tenant(other.organizationId, (client) => bookMeeting(client, foreign, linkId, { startsAt: `${day}T11:00:00.000Z`, guestName: "X", guestEmail: "x@example.test" })),
        (error) => error.status === 404,
      );
    });

    await t.test("the rate limiter is durable: counts are shared by every connection (replica) and refuse over the limit", async () => {
      const key = `crm-meeting-book:ip:test-${randomUUID()}`;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        // Alternate pool connections: two "replicas" share one counter.
        await kit.runtime((client) => enforceRateLimit(client, key, 5, 3600, { random: () => 1 }));
      }
      await assert.rejects(kit.runtime((client) => enforceRateLimit(client, key, 5, 3600, { random: () => 1 })), (error) => error.status === 429);
      await kit.runtime((client) => enforceRateLimit(client, `${key}-other`, 5, 3600, { random: () => 1 }));
      await kit.owner.query(`DELETE FROM auth_rate_limits WHERE key LIKE $1`, [`${key}%`]);
    });
  } finally {
    await kit.close();
  }
});

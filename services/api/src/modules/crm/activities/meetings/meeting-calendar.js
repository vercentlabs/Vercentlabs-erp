// F014 calendar integration: inbound calendar delta ingestion and the
// scheduled sync claim/complete/fail steps, the canonical Meeting ->
// crm_calendar_events sync-intent row, and outbound push preparation,
// result recording and job enqueueing. Provider HTTP lives in
// communications/provider-integrations.js.

import { loadSyncAccount, normalizeProviderCalendarEvent } from "../communications/provider-integrations.js";

const text = (value) => String(value ?? "").trim();
const array = (value) => (Array.isArray(value) ? value : []);

export async function ingestCalendarDelta(
  client,
  context,
  syncAccountId,
  input = {},
) {
  const account = await loadSyncAccount(client, context, syncAccountId);
  const provider = text(input.provider || account.provider).toLowerCase();
  const normalized = array(input.events).map((row) =>
    normalizeProviderCalendarEvent(provider, row),
  );
  // Deleted/cancelled provider events (Google sends a bare id with
  // status=cancelled, Microsoft sends @removed) close the matching row;
  // events without usable times are skipped and counted, never allowed to
  // abort the whole page.
  const cancelledIds = [
    ...array(input.removedEventIds).map(text),
    ...normalized.filter((event) => event.providerStatus === "cancelled").map((event) => event.externalEventId),
  ].filter(Boolean);
  let cancelled = 0;
  if (cancelledIds.length) {
    const closed = await client.query(
      `UPDATE tenant.crm_calendar_events SET provider_status='cancelled',updated_at=now()
        WHERE organization_id=$1 AND provider=$2 AND external_event_id = ANY($3::text[]) AND provider_status<>'cancelled'`,
      [context.organizationId, provider === "google_calendar" ? "gmail" : provider, [...new Set(cancelledIds)]],
    );
    cancelled = closed.rowCount || 0;
  }
  const validTime = (value) => Boolean(value) && Number.isFinite(Date.parse(value));
  const events = normalized.filter(
    (event) => event.providerStatus !== "cancelled" && event.externalEventId && validTime(event.startsAt) && validTime(event.endsAt) && Date.parse(event.endsAt) > Date.parse(event.startsAt),
  );
  const skipped = normalized.length - events.length - normalized.filter((event) => event.providerStatus === "cancelled").length;
  let processed = 0;
  for (const event of events) {
    const result = await client.query(
      `INSERT INTO tenant.crm_calendar_events(organization_id,sync_account_id,provider,external_event_id,etag,title,description,starts_at,ends_at,timezone,all_day,location,organizer_email,online_meeting_url,visibility,provider_status,lead_id,opportunity_id,party_id,contact_id,metadata,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22)
       ON CONFLICT (organization_id,provider,external_event_id) DO UPDATE SET etag=EXCLUDED.etag,title=EXCLUDED.title,description=EXCLUDED.description,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,timezone=EXCLUDED.timezone,all_day=EXCLUDED.all_day,location=EXCLUDED.location,organizer_email=EXCLUDED.organizer_email,online_meeting_url=EXCLUDED.online_meeting_url,visibility=EXCLUDED.visibility,provider_status=EXCLUDED.provider_status,metadata=EXCLUDED.metadata,updated_at=now()
       RETURNING id`,
      [
        context.organizationId,
        account.id,
        provider,
        event.externalEventId,
        event.etag,
        event.title,
        event.description,
        event.startsAt,
        event.endsAt,
        event.timezone,
        event.allDay,
        event.location,
        event.organizerEmail,
        event.onlineMeetingUrl,
        event.visibility,
        event.providerStatus,
        input.leadId || null,
        input.opportunityId || null,
        input.partyId || null,
        input.contactId || null,
        JSON.stringify(event.metadata),
        context.userId,
      ],
    );
    await client.query(
      `DELETE FROM tenant.crm_calendar_attendees WHERE organization_id=$1 AND calendar_event_id=$2`,
      [context.organizationId, result.rows[0].id],
    );
    for (const attendee of event.attendees) {
      await client.query(
        `INSERT INTO tenant.crm_calendar_attendees(organization_id,calendar_event_id,email_address,display_name,attendee_type,response_status,is_organizer)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (organization_id,calendar_event_id,email_address) DO UPDATE SET display_name=EXCLUDED.display_name,attendee_type=EXCLUDED.attendee_type,response_status=EXCLUDED.response_status,is_organizer=EXCLUDED.is_organizer`,
        [
          context.organizationId,
          result.rows[0].id,
          attendee.emailAddress,
          attendee.displayName || null,
          attendee.attendeeType || "required",
          ["accepted", "declined", "tentative", "needs_action"].includes(
            attendee.responseStatus,
          )
            ? attendee.responseStatus
            : "needs_action",
          Boolean(attendee.isOrganizer),
        ],
      );
    }
    processed += 1;
  }
  await client.query(
    `UPDATE tenant.crm_sync_accounts SET calendar_cursor=$3,last_synced_at=now(),last_error=NULL,status='connected',sync_lock_until=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [
      context.organizationId,
      account.id,
      text(input.nextCursor) || account.calendar_cursor || null,
    ],
  );
  return {
    processed,
    cancelled,
    skipped,
    nextCursor: text(input.nextCursor) || account.calendar_cursor || null,
  };
}

// Resolves everything a calendar-push worker tick needs for one Meeting
// activity in a single short read: the host's connected sync account (if
// any — most Meetings will have none, and that is a legitimate, silent
// no-op, not an error) and the internal crm_calendar_events row shaped
// into pushProviderCalendarEvent's plain event input. Returns null when
// there is nothing to push (no host, no meeting activity, no connected
// outbound-capable account) so the worker can skip cleanly.
export async function prepareMeetingCalendarPush(client, context, activityId) {
  const activity = await client.query(
    `SELECT activity.*,calendar.id AS calendar_event_id,calendar.provider AS calendar_provider,calendar.external_event_id
       FROM tenant.crm_activities activity
       LEFT JOIN tenant.crm_calendar_events calendar ON calendar.organization_id=activity.organization_id AND calendar.id=activity.meeting_calendar_event_id
      WHERE activity.organization_id=$1 AND activity.id=$2 AND activity.activity_type='meeting'`,
    [context.organizationId, activityId],
  );
  const meeting = activity.rows[0];
  if (!meeting || !meeting.assigned_to) return null;
  const account = await client.query(
    `SELECT * FROM tenant.crm_sync_accounts
      WHERE organization_id=$1 AND user_id=$2 AND provider IN ('gmail','microsoft365')
        AND status='connected' AND sync_direction IN ('outbound','two_way')
      ORDER BY updated_at DESC LIMIT 1`,
    [context.organizationId, meeting.assigned_to],
  );
  if (!account.rows[0]) return null;
  const attendeesResult = await client.query(
    `SELECT name,email FROM tenant.crm_activity_attendees WHERE organization_id=$1 AND activity_id=$2`,
    [context.organizationId, activityId],
  );
  return {
    account: account.rows[0],
    event: {
      externalEventId: meeting.calendar_provider && !["vercentlabs", "internal"].includes(meeting.calendar_provider) ? meeting.external_event_id : null,
      title: meeting.subject,
      description: meeting.description || null,
      startsAt: (meeting.start_at || meeting.due_at) ? new Date(meeting.start_at || meeting.due_at).toISOString() : null,
      endsAt: meeting.end_at ? new Date(meeting.end_at).toISOString() : null,
      timezone: "UTC",
      location: meeting.location || null,
      onlineMeetingUrl: meeting.meeting_url || null,
      attendees: attendeesResult.rows,
    },
    calendarEventId: meeting.calendar_event_id || null,
  };
}

// Persists a push result back onto the SAME internal crm_calendar_events
// row bookMeeting/meeting-operations.js already create (never a second,
// parallel calendar-event table) — replacing the previously-hardcoded
// provider='vercentlabs' with the real provider once a push actually
// succeeds, so "this Meeting is genuinely synced" becomes a true fact
// instead of a label. A cancel result clears provider linkage rather than
// deleting the row, preserving the Meeting's own audit history.
export async function recordMeetingCalendarPushResult(client, context, calendarEventId, provider, result) {
  if (!calendarEventId) return;
  await client.query(
    `UPDATE tenant.crm_calendar_events
        SET provider=$3,external_event_id=$4,etag=$5,provider_status=$6,updated_at=now()
      WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, calendarEventId, provider, result.externalEventId, result.etag, result.providerStatus],
  );
}

// Canonical Meeting -> calendar-sync-intent step (final self-closing
// pass): create/update/cancel Meeting -> commit CRM Meeting state ->
// [this function] create/update the ONE canonical calendar-sync-intent
// row (crm_calendar_events, the same table bookMeeting already used, not
// a second representation) -> enqueue provider job -> provider adapter ->
// record provider result -> reconcile. This is the single function every
// Meeting-mutating path (bookMeeting's public-booking flow AND ordinary
// createCrmMeeting/updateCrmMeeting/cancelCrmMeeting) now goes through, so
// there is one place — not three bolted-on call sites — that decides how
// a Meeting's calendar-sync-intent row is shaped.
//
// provider='internal' (not the old 'vercentlabs' placeholder) means
// "exists only in our own DB, no real external provider has been
// contacted yet" — prepareMeetingCalendarPush treats both values
// identically as "not yet synced," but 'internal' is the honest label a
// UI should show as "Pending sync" / "Not connected", never claiming a
// sync that hasn't happened.
export function meetingCalendarParentColumns(entityType, entityId) {
  const columns = { leadId: null, opportunityId: null, partyId: null, contactId: null };
  if (!entityId) return columns;
  if (entityType === "lead") columns.leadId = entityId;
  else if (entityType === "opportunity") columns.opportunityId = entityId;
  else if (entityType === "party") columns.partyId = entityId;
  else if (entityType === "contact") columns.contactId = entityId;
  return columns;
}

export async function upsertMeetingCalendarEvent(client, context, meeting) {
  if (!meeting.startAt || !meeting.endAt) return null; // a "log" (already-happened) Meeting has nothing forward to sync
  const parents = meetingCalendarParentColumns(meeting.entityType, meeting.entityId);
  if (meeting.calendarEventId) {
    const updated = await client.query(
      `UPDATE tenant.crm_calendar_events
          SET title=$3,description=$4,starts_at=$5,ends_at=$6,location=$7,online_meeting_url=$8,
              lead_id=$9,opportunity_id=$10,party_id=$11,contact_id=$12,updated_at=now()
        WHERE organization_id=$1 AND id=$2 RETURNING id`,
      [
        context.organizationId, meeting.calendarEventId, meeting.subject, meeting.description || null,
        meeting.startAt, meeting.endAt, meeting.location || null, meeting.meetingUrl || null,
        parents.leadId, parents.opportunityId, parents.partyId, parents.contactId,
      ],
    );
    if (updated.rows[0]) return updated.rows[0].id;
  }
  const inserted = await client.query(
    `INSERT INTO tenant.crm_calendar_events(
       organization_id,provider,external_event_id,title,description,starts_at,ends_at,location,online_meeting_url,
       provider_status,lead_id,opportunity_id,party_id,contact_id,created_by,updated_by)
     VALUES($1,'internal',$2,$3,$4,$5,$6,$7,$8,'pending_sync',$9,$10,$11,$12,$13,$13) RETURNING id`,
    [
      context.organizationId, `meeting-${meeting.id}`, meeting.subject, meeting.description || null,
      meeting.startAt, meeting.endAt, meeting.location || null, meeting.meetingUrl || null,
      parents.leadId, parents.opportunityId, parents.partyId, parents.contactId, context.userId,
    ],
  );
  return inserted.rows[0].id;
}

// Marks the calendar-sync-intent row as pending cancellation — the actual
// provider DELETE happens in the worker via pushProviderCalendarEvent
// (action='cancel'), which is idempotent against an event the provider
// already deleted (see providerRequest's allowNotFound). This function
// only records CRM-side intent so a UI can show "Cancelling…" honestly
// before the async job completes.
export async function markMeetingCalendarEventCancelling(client, context, calendarEventId) {
  if (!calendarEventId) return;
  await client.query(
    `UPDATE tenant.crm_calendar_events SET provider_status='cancelling',updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, calendarEventId],
  );
}

// Enqueues one crm.meetings.calendar_push background job for this Meeting.
// A plain INSERT into tenant.background_jobs (the same table/shape
// services/worker's queue.js#enqueueJob writes) rather than importing the
// worker package from services/api — the two are separate deployable
// services with no existing cross-service import path (see
// the shared platform mail transport's (core/platform/mail) own precedent for this exact
// constraint). ON CONFLICT DO NOTHING against the idempotency key means a
// retried request that already enqueued a push for this exact
// meeting+action+moment can never double-enqueue.
export async function enqueueCalendarPushJob(client, context, activityId, action, momentKey) {
  await client.query(
    `INSERT INTO tenant.background_jobs(organization_id,job_type,payload,idempotency_key)
     VALUES($1,'crm.meetings.calendar_push',$2::jsonb,$3)
     ON CONFLICT (organization_id,idempotency_key) DO NOTHING`,
    [
      context.organizationId,
      JSON.stringify({ activityId, action }),
      `crm.meetings.calendar_push:${activityId}:${action}:${momentKey}`,
    ],
  );
}

// F014 scheduled inbound calendar sync, in three short steps so a provider
// HTTP call never runs while a tenant transaction is open (same shape as the
// outbound push): claim due accounts (SKIP LOCKED + a lease), fetch the delta
// outside any transaction, then ingest or record the failure.
export const CALENDAR_SYNC_INTERVAL_MINUTES = 10;

export async function claimCalendarSyncAccounts(client, context, { limit = 25 } = {}) {
  const { rows } = await client.query(
    `WITH due AS (
       SELECT id FROM tenant.crm_sync_accounts
        WHERE organization_id=$1 AND provider IN ('gmail','microsoft365')
          AND sync_direction IN ('inbound','two_way') AND status IN ('connected','error','syncing')
          AND (sync_lock_until IS NULL OR sync_lock_until < now())
          AND (last_synced_at IS NULL OR last_synced_at < now() - ($2 * interval '1 minute'))
        ORDER BY last_synced_at NULLS FIRST, id
        LIMIT $3
        FOR UPDATE SKIP LOCKED)
     UPDATE tenant.crm_sync_accounts account
        SET status='syncing', sync_lock_until=now()+interval '10 minutes', updated_at=now()
       FROM due WHERE account.organization_id=$1 AND account.id=due.id
     RETURNING account.*`,
    [context.organizationId, CALENDAR_SYNC_INTERVAL_MINUTES, Math.max(1, Math.min(100, Number(limit) || 25))],
  );
  return rows;
}

export async function completeCalendarSync(client, context, account, page) {
  const result = await ingestCalendarDelta(client, { ...context, userId: account.user_id }, account.id, page);
  await client.query(
    `INSERT INTO tenant.crm_provider_sync_jobs(organization_id,sync_account_id,sync_type,cursor_before,cursor_after,status,attempted_count,processed_count,started_at,completed_at,metadata)
     VALUES($1,$2,'calendar',$3,$4,'completed',1,$5,now(),now(),$6::jsonb)`,
    [context.organizationId, account.id, account.calendar_cursor || null, result.nextCursor, result.processed, JSON.stringify({ cancelled: result.cancelled, skipped: result.skipped, source: "scheduled" })],
  );
  return result;
}

export async function failCalendarSync(client, context, account, error) {
  const message = String(error?.message || "Provider sync failed.").slice(0, 500);
  await client.query(
    `INSERT INTO tenant.crm_provider_sync_jobs(organization_id,sync_account_id,sync_type,cursor_before,status,attempted_count,failure_count,last_error,next_attempt_at,started_at,completed_at,metadata)
     VALUES($1,$2,'calendar',$3,'failed',1,1,$4,now()+interval '10 minutes',now(),now(),$5::jsonb)`,
    [context.organizationId, account.id, account.calendar_cursor || null, message, JSON.stringify({ code: error?.code || null, source: "scheduled" })],
  );
  await client.query(
    `UPDATE tenant.crm_sync_accounts SET status='error',last_error=$3,sync_lock_until=NULL,last_synced_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, account.id, message],
  );
  return { failed: true, code: error?.code || "CRM_PROVIDER_SYNC_FAILED" };
}

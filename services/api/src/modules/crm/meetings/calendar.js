// Google and Outlook calendar sync (CRM plan 4.5). A salesperson connects their own calendar (OAuth); everything scheduled for them in CRM —
// meetings, follow-ups of every kind (call, visit, demo, email, WhatsApp), tasks and planned calls — is then kept in it by the worker (and
// at once by "Sync now"): added when planned, moved when rescheduled, marked done when completed, removed when cancelled. A task due on a
// day without a time is an all-day event. Each event remembers
// its CRM activity, so nothing is added twice. The sync is two-way (CRM audit): a meeting moved or deleted in the calendar is moved or
// cancelled in CRM, unless CRM changed it since the last sync (then CRM's version wins). A meeting can ask for a Meet or Teams link,
// which the calendar makes (video.js).
//
// The organization's OAuth apps come from the environment: GOOGLE_CALENDAR_CLIENT_ID / _SECRET and MICROSOFT_CALENDAR_CLIENT_ID /
// _SECRET — else the same provider's sign-in app (GOOGLE_OAUTH_CLIENT_ID / _SECRET, MICROSOFT_OAUTH_…), so one OAuth client serves both —
// with APP_URL for the return address (/api/crm/calendar/callback/{provider}).
import { createHash, randomBytes } from "node:crypto";

import { decryptSecret, encryptSecret } from "../../../core/platform/secrets/index.js";
import { CrmError } from "../data-management/errors.js";
import { cancelPendingRemindersForActivity, replaceActivityReminder } from "../reminders/index.js";
import { makeZoomLinks } from "./video.js";

const PROVIDERS = Object.freeze({
  google: {
    label: "Google Calendar",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email https://www.googleapis.com/auth/calendar.events",
    env: ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET"],
    fallbackEnv: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
    extra: { access_type: "offline", prompt: "consent" },
  },
  microsoft: {
    label: "Outlook (Microsoft 365)",
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "offline_access openid email Calendars.ReadWrite User.Read",
    env: ["MICROSOFT_CALENDAR_CLIENT_ID", "MICROSOFT_CALENDAR_CLIENT_SECRET"],
    fallbackEnv: ["MICROSOFT_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_SECRET"],
    extra: { response_mode: "query" },
  },
});
const SYNC_DAYS_BACK = 1;
const SYNC_DAYS_AHEAD = 180;

function providerOf(key) {
  const provider = PROVIDERS[key];
  if (!provider) throw new CrmError(400, "Choose Google or Microsoft.", "CRM_CALENDAR_PROVIDER");
  return provider;
}

function appConfig(key, env) {
  const provider = providerOf(key);
  const own = Boolean(env[provider.env[0]] && env[provider.env[1]]);
  const clientId = own ? env[provider.env[0]] : env[provider.fallbackEnv[0]];
  const clientSecret = own ? env[provider.env[1]] : env[provider.fallbackEnv[1]];
  const appUrl = env.APP_URL;
  if (!clientId || !clientSecret || !appUrl) return null;
  return { provider, clientId, clientSecret, redirectUri: `${String(appUrl).replace(/\/+$/, "")}/api/crm/calendar/callback/${key}` };
}

// Which calendars this deployment can connect (the OAuth app is set), and which the person has connected.
export async function listCalendarConnections(client, context, { env = process.env } = {}) {
  const { rows } = await client.query("SELECT * FROM tenant.crm_calendar_connections WHERE organization_id = $1 AND user_id = $2", [context.organizationId, context.userId]);
  return Object.entries(PROVIDERS).map(([key, provider]) => {
    const row = rows.find((entry) => entry.provider === key);
    return { provider: key, label: provider.label, available: Boolean(appConfig(key, env)), connected: Boolean(row && row.status !== "disconnected"),
      accountEmail: row?.account_email ?? null, status: row?.status ?? null, lastSyncAt: row?.last_sync_at ?? null, lastError: row?.last_error ?? null };
  });
}

// The address to send the person to, to allow access. The state (who, which organization, which provider) is encrypted.
export async function calendarAuthorizeUrl(context, key, { env = process.env } = {}) {
  const config = appConfig(key, env);
  if (!config) throw new CrmError(409, `${providerOf(key).label} is not set up for this workspace yet. Ask your administrator.`, "CRM_CALENDAR_NOT_CONFIGURED");
  const state = Buffer.from(JSON.stringify(await encryptSecret({ organizationId: context.organizationId, userId: context.userId, provider: key, nonce: randomBytes(8).toString("hex"),
    expires: Date.now() + 10 * 60000 }, env))).toString("base64url");
  const query = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", scope: config.provider.scope, state, ...config.provider.extra });
  return `${config.provider.authorize}?${query}`;
}

// The return from the provider: checks the state, trades the code for tokens, reads the account's address. Returns { organizationId, provider }.
export async function readCalendarState(state, env = process.env) {
  let payload;
  try { payload = await decryptSecret(JSON.parse(Buffer.from(String(state ?? ""), "base64url").toString("utf8")), env); } catch { payload = null; }
  if (!payload?.organizationId || !payload.userId || !PROVIDERS[payload.provider] || payload.expires < Date.now()) throw new CrmError(400, "The calendar link expired. Connect again.", "CRM_CALENDAR_STATE");
  return payload;
}

async function tokenRequest(fetchImpl, config, form) {
  const response = await fetchImpl(config.provider.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...form }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new CrmError(502, `The calendar refused access: ${body.error_description ?? body.error ?? response.status}.`, "CRM_CALENDAR_TOKEN");
  return body;
}

export async function completeCalendarConnection(client, payload, code, { fetchImpl = fetch, env = process.env } = {}) {
  const config = appConfig(payload.provider, env);
  if (!config) throw new CrmError(409, "This calendar is not set up.", "CRM_CALENDAR_NOT_CONFIGURED");
  const tokens = await tokenRequest(fetchImpl, config, { grant_type: "authorization_code", code: String(code ?? ""), redirect_uri: config.redirectUri });
  let accountEmail = null;
  try {
    const profileUrl = payload.provider === "google" ? "https://openidconnect.googleapis.com/v1/userinfo" : "https://graph.microsoft.com/v1.0/me";
    const profile = await (await fetchImpl(profileUrl, { headers: { authorization: `Bearer ${tokens.access_token}` } })).json();
    accountEmail = profile.email ?? profile.mail ?? profile.userPrincipalName ?? null;
  } catch { accountEmail = null; }
  const stored = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? null, expiresAt: Date.now() + Number(tokens.expires_in ?? 3600) * 1000 };
  await client.query(
    `INSERT INTO tenant.crm_calendar_connections (organization_id, user_id, provider, account_email, encrypted_tokens, status, last_error, connected_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'active', NULL, now())
     ON CONFLICT (organization_id, user_id, provider) DO UPDATE SET account_email = EXCLUDED.account_email, encrypted_tokens = EXCLUDED.encrypted_tokens, status = 'active',
       last_error = NULL, connected_at = now()`,
    [payload.organizationId, payload.userId, payload.provider, accountEmail, JSON.stringify(await encryptSecret(stored, env))]);
  return { provider: payload.provider, accountEmail };
}

export async function disconnectCalendar(client, context, key) {
  providerOf(key);
  await client.query("DELETE FROM tenant.crm_calendar_events WHERE organization_id = $1 AND user_id = $2 AND provider = $3", [context.organizationId, context.userId, key]);
  await client.query("DELETE FROM tenant.crm_calendar_connections WHERE organization_id = $1 AND user_id = $2 AND provider = $3", [context.organizationId, context.userId, key]);
  return { disconnected: true };
}

// ------------------------------------------------------------------ sync (worker)

async function accessToken(client, connection, { fetchImpl, env }) {
  const tokens = await decryptSecret(connection.encrypted_tokens, env);
  if (tokens.expiresAt > Date.now() + 60000) return tokens.accessToken;
  if (!tokens.refreshToken) throw new CrmError(401, "The calendar connection expired. Connect it again.", "CRM_CALENDAR_EXPIRED");
  const config = appConfig(connection.provider, env);
  if (!config) throw new CrmError(409, "This calendar is not set up.", "CRM_CALENDAR_NOT_CONFIGURED");
  const fresh = await tokenRequest(fetchImpl, config, { grant_type: "refresh_token", refresh_token: tokens.refreshToken });
  const stored = { accessToken: fresh.access_token, refreshToken: fresh.refresh_token ?? tokens.refreshToken, expiresAt: Date.now() + Number(fresh.expires_in ?? 3600) * 1000 };
  await client.query("UPDATE tenant.crm_calendar_connections SET encrypted_tokens = $4::jsonb WHERE organization_id = $1 AND user_id = $2 AND provider = $3",
    [connection.organization_id, connection.user_id, connection.provider, JSON.stringify(await encryptSecret(stored, env))]);
  return stored.accessToken;
}

// What the calendar shows of a meeting. A different version from the one last synced means CRM changed it (pushed); the calendar's
// own changes are read back only for a meeting CRM has not changed since (CRM wins a clash).
const versionOf = (meeting) => createHash("sha256")
  .update([meeting.subject, meeting.start_iso, meeting.end_iso, meeting.location ?? "", meeting.status, meeting.video_provider ?? "", meeting.video_link ?? "",
    meeting.all_day ? `day:${meeting.day}` : ""].join("|")).digest("hex").slice(0, 24);

// The event's title: what it is (a meeting is just its subject), and "Done" once completed in CRM.
const KIND = Object.freeze({ task: "Task", follow_up: "Follow-up", call: "Call", email: "Email", whatsapp: "WhatsApp", other: "To-do" });
function titleOf(meeting) {
  const subject = meeting.subject || (meeting.follow_up_type ? `${meeting.follow_up_type[0].toUpperCase()}${meeting.follow_up_type.slice(1)}` : "CRM to-do");
  const kind = KIND[meeting.activity_type];
  const title = kind && !subject.toLowerCase().startsWith(kind.toLowerCase()) ? `${kind}: ${subject}` : subject;
  return meeting.status === "completed" ? `Done – ${title}` : title;
}
const nextDay = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const HREF = Object.freeze({ lead: "/crm/leads/", opportunity: "/crm/opportunities/", party: "/crm/accounts/", contact: "/crm/contacts/" });
const PULL_EVERY_MINUTES = 10;
const utc = (at) => new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z");

function eventBody(provider, meeting, appUrl) {
  const link = appUrl && meeting.entity_id && HREF[meeting.entity_type] ? `${String(appUrl).replace(/\/+$/, "")}${HREF[meeting.entity_type]}${meeting.entity_id}` : null;
  const notes = [meeting.video_link ? `Join: ${meeting.video_link}` : null, meeting.description, link ? `CRM: ${link}` : null].filter(Boolean).join("\n\n");
  const title = titleOf(meeting);
  if (provider === "google") {
    const when = meeting.all_day ? { start: { date: meeting.day }, end: { date: nextDay(meeting.day) } } : { start: { dateTime: meeting.start_iso }, end: { dateTime: meeting.end_iso } };
    const body = { summary: title, description: notes || undefined, location: meeting.location ?? undefined, ...when,
      extendedProperties: { private: { crmActivityId: meeting.id } } };
    // Google Meet: Google makes the link (the request carries conferenceDataVersion=1).
    if (meeting.video_provider === "google_meet" && !meeting.video_link)
      body.conferenceData = { createRequest: { requestId: `crm-${meeting.id}-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } };
    return body;
  }
  const body = { subject: title, body: { contentType: "text", content: notes }, location: meeting.location ? { displayName: meeting.location } : undefined,
    ...(meeting.all_day
      ? { isAllDay: true, start: { dateTime: `${meeting.day}T00:00:00`, timeZone: "UTC" }, end: { dateTime: `${nextDay(meeting.day)}T00:00:00`, timeZone: "UTC" } }
      : { start: { dateTime: meeting.start_iso.replace("Z", ""), timeZone: "UTC" }, end: { dateTime: meeting.end_iso.replace("Z", ""), timeZone: "UTC" } }) };
  // Microsoft Teams: Outlook makes the link.
  if (meeting.video_provider === "teams") Object.assign(body, { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" });
  return body;
}

// The join link the calendar made for the meeting (Meet or Teams), if any.
const madeLink = (provider, event) => (provider === "google"
  ? event?.hangoutLink ?? event?.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri ?? null
  : event?.onlineMeeting?.joinUrl ?? null);

async function remote(fetchImpl, method, url, token, body) {
  const response = await fetchImpl(url, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (method === "DELETE" && (response.status === 404 || response.status === 410)) return {};
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(parsed?.error?.message ?? response.status);
    // Google's calendar service is off for the workspace's OAuth project: something only the administrator can turn on.
    if (/has not been used in project|accessNotConfigured|SERVICE_DISABLED|is disabled/i.test(`${message} ${JSON.stringify(parsed?.error?.details ?? parsed?.error?.errors ?? "")}`))
      throw new CrmError(502, "Google Calendar is not switched on for this workspace yet. Ask your administrator to enable the Google Calendar API in Google Cloud, then click Sync now.",
        "CRM_CALENDAR_API_DISABLED");
    throw new CrmError(502, `The calendar refused the change: ${message}.`, "CRM_CALENDAR_REFUSED");
  }
  return parsed;
}

const eventsUrl = (connection) => (connection.provider === "google"
  ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.calendar_id)}/events` : "https://graph.microsoft.com/v1.0/me/events");

// Everything scheduled for the person (meetings, follow-ups, tasks, planned calls…), with what the calendar needs. A task or follow-up
// due on a day without a time is all-day (its date in the company's timezone). `where` narrows them (SQL on activity / event).
const meetingsOf = (client, organizationId, connection, where, extra = []) => client.query(
  `SELECT activity.id, activity.entity_type, activity.entity_id, activity.subject, activity.description, activity.location, activity.status,
          activity.activity_type, activity.follow_up_type,
          (activity.start_at IS NULL AND activity.due_time_set IS FALSE) AS all_day,
          to_char((activity.due_at AT TIME ZONE COALESCE((SELECT org.timezone FROM public.organizations org WHERE org.id = activity.organization_id), 'Asia/Kolkata'))::date, 'YYYY-MM-DD') AS day,
          activity.video_provider, activity.video_link, activity.reminder_offset_minutes, activity.start_at IS NOT NULL AS has_start,
          to_char(COALESCE(activity.start_at, activity.due_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_iso,
          to_char(COALESCE(activity.end_at, COALESCE(activity.start_at, activity.due_at) + make_interval(mins => COALESCE(invitation.duration_minutes, 30))) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS end_iso,
          event.external_id, event.synced_version
     FROM tenant.crm_activities activity
     LEFT JOIN tenant.crm_meeting_invitations invitation ON invitation.organization_id = activity.organization_id AND invitation.activity_id = activity.id
     LEFT JOIN tenant.crm_calendar_events event ON event.organization_id = activity.organization_id AND event.activity_id = activity.id AND event.user_id = $2 AND event.provider = $3
    WHERE activity.organization_id = $1 AND activity.assigned_to = $2
      AND COALESCE(activity.start_at, activity.due_at) IS NOT NULL AND ${where}
    LIMIT 500`, [organizationId, connection.user_id, connection.provider, ...extra]);
const IN_WINDOW = `COALESCE(activity.start_at, activity.due_at) BETWEEN now() - make_interval(days => ${SYNC_DAYS_BACK}) AND now() + make_interval(days => ${SYNC_DAYS_AHEAD})`;
const OPEN = "activity.status IN ('planned', 'in_progress', 'overdue')";
// Past items added on request ("Add past items"): meetings, calls, follow-ups and tasks of the last days, done or not; logged emails and
// WhatsApp messages are records of messages, not appointments, so they stay out. Once added they are kept like any other event.
const MAX_PAST_DAYS = 365;
const pastItems = (days) => `(activity.status <> 'cancelled' AND activity.activity_type NOT IN ('email', 'whatsapp')
  AND COALESCE(activity.start_at, activity.due_at) BETWEEN now() - make_interval(days => ${days}) AND now() + make_interval(days => ${SYNC_DAYS_AHEAD}))`;

// Puts one meeting in one calendar as CRM has it. Returns "created", "updated", "removed" or null (nothing to do).
async function pushMeeting(client, organizationId, connection, token, meeting, { fetchImpl, env }) {
  const base = eventsUrl(connection);
  if (meeting.status === "cancelled") {
    if (!meeting.external_id) return null;
    await remote(fetchImpl, "DELETE", `${base}/${encodeURIComponent(meeting.external_id)}`, token);
    await client.query("DELETE FROM tenant.crm_calendar_events WHERE organization_id = $1 AND activity_id = $2 AND user_id = $3 AND provider = $4", [organizationId, meeting.id, connection.user_id, connection.provider]);
    return "removed";
  }
  if (meeting.external_id && meeting.synced_version === versionOf(meeting)) return null;
  const conference = connection.provider === "google" ? "?conferenceDataVersion=1" : "";
  const body = eventBody(connection.provider, meeting, env.APP_URL);
  const event = meeting.external_id
    ? await remote(fetchImpl, "PATCH", `${base}/${encodeURIComponent(meeting.external_id)}${conference}`, token, body)
    : await remote(fetchImpl, "POST", `${base}${conference}`, token, body);
  const wanted = (connection.provider === "google" && meeting.video_provider === "google_meet") || (connection.provider === "microsoft" && meeting.video_provider === "teams");
  const link = wanted && !meeting.video_link ? madeLink(connection.provider, event) : null;
  if (link) {
    await client.query("UPDATE tenant.crm_activities SET video_link = $3 WHERE organization_id = $1 AND id = $2", [organizationId, meeting.id, link]);
    meeting.video_link = link;
  }
  await client.query(
    `INSERT INTO tenant.crm_calendar_events (organization_id, activity_id, user_id, provider, external_id, synced_version) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (organization_id, activity_id, user_id, provider) DO UPDATE SET external_id = EXCLUDED.external_id, synced_version = EXCLUDED.synced_version, synced_at = now()`,
    [organizationId, meeting.id, connection.user_id, connection.provider, String(event.id ?? meeting.external_id), versionOf(meeting)]);
  return meeting.external_id ? "updated" : "created";
}

// The time of a calendar event (UTC), or null.
function eventTimes(provider, event) {
  const read = (part) => {
    if (!part?.dateTime) return null;
    const at = provider === "google" ? new Date(part.dateTime) : new Date(`${part.dateTime.replace(/\.\d+$/, "")}${/^utc$/i.test(part.timeZone ?? "UTC") ? "Z" : ""}`);
    return Number.isNaN(at.getTime()) ? null : at;
  };
  const start = read(event?.start);
  const end = read(event?.end);
  return start && end && end >= start ? { start, end } : null;
}

// Two-way (CRM audit): what changed in the calendar comes back. A meeting moved there moves in CRM (its reminder with it); one deleted
// there is cancelled in CRM. Only meetings CRM has not changed since the last sync — otherwise CRM's version goes out instead.
async function pullChanges(client, organizationId, connection, token, counts, { fetchImpl }) {
  const base = eventsUrl(connection);
  const { rows } = await meetingsOf(client, organizationId, connection, `event.external_id IS NOT NULL AND ${OPEN} AND ${IN_WINDOW}`);
  const worker = { organizationId, userId: null, permissions: [], roleSlugs: ["system_worker"] };
  for (const meeting of rows.slice(0, 100)) {
    if (meeting.synced_version !== versionOf(meeting)) continue;
    // An all-day task keeps its day in CRM; a deleted event still cancels it (below), a moved one is not read back.
    const response = await fetchImpl(`${base}/${encodeURIComponent(meeting.external_id)}`, { headers: { authorization: `Bearer ${token}` } });
    const gone = response.status === 404 || response.status === 410;
    const event = gone ? null : await response.json().catch(() => null);
    if (!gone && !response.ok) continue;
    if (gone || event?.status === "cancelled" || event?.isCancelled) {
      await client.query("UPDATE tenant.crm_activities SET status = 'cancelled', updated_at = now() WHERE organization_id = $1 AND id = $2", [organizationId, meeting.id]);
      await cancelPendingRemindersForActivity(client, worker, meeting.id);
      await client.query("DELETE FROM tenant.crm_calendar_events WHERE organization_id = $1 AND activity_id = $2 AND user_id = $3 AND provider = $4", [organizationId, meeting.id, connection.user_id, connection.provider]);
      counts.pulledCancelled += 1;
      continue;
    }
    if (meeting.all_day) continue;
    const times = eventTimes(connection.provider, event);
    if (!times || (utc(times.start) === meeting.start_iso && utc(times.end) === meeting.end_iso)) continue;
    await client.query(meeting.has_start
      ? "UPDATE tenant.crm_activities SET start_at = $3, end_at = $4, updated_at = now() WHERE organization_id = $1 AND id = $2"
      : "UPDATE tenant.crm_activities SET due_at = $3, end_at = $4, updated_at = now() WHERE organization_id = $1 AND id = $2",
    [organizationId, meeting.id, times.start, times.end]);
    if (meeting.reminder_offset_minutes !== null && meeting.reminder_offset_minutes !== undefined)
      await replaceActivityReminder(client, worker, meeting.id, times.start, meeting.reminder_offset_minutes);
    await client.query("UPDATE tenant.crm_calendar_events SET synced_version = $5, synced_at = now() WHERE organization_id = $1 AND activity_id = $2 AND user_id = $3 AND provider = $4",
      [organizationId, meeting.id, connection.user_id, connection.provider, versionOf({ ...meeting, start_iso: utc(times.start), end_iso: utc(times.end) })]);
    counts.pulledMoved += 1;
  }
  await client.query("UPDATE tenant.crm_calendar_connections SET last_pull_at = now() WHERE organization_id = $1 AND user_id = $2 AND provider = $3", [organizationId, connection.user_id, connection.provider]);
}

// Brings every connected calendar of the organization up to date, both ways, and makes the Zoom links meetings asked for.
// Returns { connections, created, updated, removed, failed, pulledMoved, pulledCancelled, zoom }.
// userId: only that person's calendars ("Sync now"); pastDays: also add their past items of that many days ("Add past items").
export async function syncCalendars(client, organizationId, { fetchImpl = fetch, env = process.env, userId = null, pastDays = 0 } = {}) {
  const past = Math.min(MAX_PAST_DAYS, Math.max(0, Math.trunc(Number(pastDays) || 0)));
  const counts = { connections: 0, created: 0, updated: 0, removed: 0, failed: 0, pulledMoved: 0, pulledCancelled: 0, zoom: 0 };
  if (!userId) counts.zoom = (await makeZoomLinks(client, organizationId, { fetchImpl, env })).made;
  const { rows: connections } = await client.query(
    "SELECT * FROM tenant.crm_calendar_connections WHERE organization_id = $1 AND status IN ('active', 'error') AND ($2::uuid IS NULL OR user_id = $2)", [organizationId, userId]);
  for (const connection of connections) {
    counts.connections += 1;
    try {
      const token = await accessToken(client, connection, { fetchImpl, env });
      // Read back first, so a meeting moved in the calendar is not pushed back over.
      if (!connection.last_pull_at || Date.now() - new Date(connection.last_pull_at).getTime() >= PULL_EVERY_MINUTES * 60000)
        await pullChanges(client, organizationId, connection, token, counts, { fetchImpl });
      const { rows: meetings } = await meetingsOf(client, organizationId, connection,
        `(event.external_id IS NOT NULL OR (${OPEN} AND ${IN_WINDOW})${past ? ` OR ${pastItems(past)}` : ""})`);
      for (const meeting of meetings) {
        const done = await pushMeeting(client, organizationId, connection, token, meeting, { fetchImpl, env });
        if (done) counts[done] += 1;
      }
      await client.query("UPDATE tenant.crm_calendar_connections SET status = 'active', last_sync_at = now(), last_error = NULL WHERE organization_id = $1 AND user_id = $2 AND provider = $3",
        [organizationId, connection.user_id, connection.provider]);
    } catch (error) {
      counts.failed += 1;
      await client.query("UPDATE tenant.crm_calendar_connections SET status = 'error', last_error = $4, last_sync_at = now() WHERE organization_id = $1 AND user_id = $2 AND provider = $3",
        [organizationId, connection.user_id, connection.provider, String(error?.message ?? error).slice(0, 500)]);
    }
  }
  return counts;
}

// Pushes one meeting to its organizer's calendar now (so a Meet or Teams link exists before the invitation goes). Returns the link or null.
export async function syncMeetingNow(client, organizationId, activityId, { fetchImpl = fetch, env = process.env } = {}) {
  const owner = (await client.query("SELECT assigned_to, video_provider FROM tenant.crm_activities WHERE organization_id = $1 AND id = $2", [organizationId, activityId])).rows[0];
  const provider = { google_meet: "google", teams: "microsoft" }[owner?.video_provider];
  if (!owner?.assigned_to || !provider) return null;
  const connection = (await client.query("SELECT * FROM tenant.crm_calendar_connections WHERE organization_id = $1 AND user_id = $2 AND provider = $3 AND status IN ('active', 'error')",
    [organizationId, owner.assigned_to, provider])).rows[0];
  if (!connection) return null;
  const token = await accessToken(client, connection, { fetchImpl, env });
  const meeting = (await meetingsOf(client, organizationId, connection, "activity.id = $4", [activityId])).rows[0];
  if (!meeting) return null;
  await pushMeeting(client, organizationId, connection, token, meeting, { fetchImpl, env });
  return meeting.video_link ?? null;
}

// "Sync now" from My calendar: the signed-in person's calendars, both ways, at once.
export async function syncMyCalendar(client, context, options = {}) {
  return syncCalendars(client, context.organizationId, { ...options, userId: context.userId });
}

export async function hasCalendarConnections(client, organizationId) {
  return Boolean((await client.query(
    `SELECT 1 FROM tenant.crm_calendar_connections WHERE organization_id = $1 AND status IN ('active', 'error')
     UNION ALL SELECT 1 FROM tenant.crm_activities WHERE organization_id = $1 AND video_provider = 'zoom' AND video_link IS NULL AND status IN ('planned', 'in_progress', 'overdue')
     LIMIT 1`, [organizationId])).rows[0]);
}

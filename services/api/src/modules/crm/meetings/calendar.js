// Google and Outlook calendar sync (CRM plan 4.5). A salesperson connects their own calendar (OAuth); their CRM meetings and follow-up
// meetings are then kept in it by the worker: added when planned, moved when rescheduled, removed when cancelled. The sync is one way —
// CRM is where the meeting is planned — and each event remembers its CRM activity, so nothing is added twice.
//
// The organization's OAuth apps come from the environment: GOOGLE_CALENDAR_CLIENT_ID / _SECRET and MICROSOFT_CALENDAR_CLIENT_ID /
// _SECRET, with APP_URL for the return address (/api/crm/calendar/callback/{provider}).
import { createHash, randomBytes } from "node:crypto";

import { decryptSecret, encryptSecret } from "../../../core/platform/secrets/index.js";
import { CrmError } from "../data-management/errors.js";

const PROVIDERS = Object.freeze({
  google: {
    label: "Google Calendar",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email https://www.googleapis.com/auth/calendar.events",
    env: ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET"],
    extra: { access_type: "offline", prompt: "consent" },
  },
  microsoft: {
    label: "Outlook (Microsoft 365)",
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "offline_access openid email Calendars.ReadWrite User.Read",
    env: ["MICROSOFT_CALENDAR_CLIENT_ID", "MICROSOFT_CALENDAR_CLIENT_SECRET"],
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
  const clientId = env[provider.env[0]];
  const clientSecret = env[provider.env[1]];
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

const versionOf = (meeting) => createHash("sha256").update([meeting.subject, meeting.start_iso, meeting.end_iso, meeting.location ?? "", meeting.status].join("|")).digest("hex").slice(0, 24);
const HREF = Object.freeze({ lead: "/crm/leads/", opportunity: "/crm/opportunities/", party: "/crm/accounts/", contact: "/crm/contacts/" });

function eventBody(provider, meeting, appUrl) {
  const link = appUrl && meeting.entity_id && HREF[meeting.entity_type] ? `${String(appUrl).replace(/\/+$/, "")}${HREF[meeting.entity_type]}${meeting.entity_id}` : null;
  const notes = [meeting.description, link ? `CRM: ${link}` : null].filter(Boolean).join("\n\n");
  if (provider === "google")
    return { summary: meeting.subject, description: notes || undefined, location: meeting.location ?? undefined, start: { dateTime: meeting.start_iso }, end: { dateTime: meeting.end_iso },
      extendedProperties: { private: { crmActivityId: meeting.id } } };
  return { subject: meeting.subject, body: { contentType: "text", content: notes }, location: meeting.location ? { displayName: meeting.location } : undefined,
    start: { dateTime: meeting.start_iso.replace("Z", ""), timeZone: "UTC" }, end: { dateTime: meeting.end_iso.replace("Z", ""), timeZone: "UTC" } };
}

async function remote(fetchImpl, method, url, token, body) {
  const response = await fetchImpl(url, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (method === "DELETE" && (response.status === 404 || response.status === 410)) return {};
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) throw new CrmError(502, `The calendar refused the change: ${parsed?.error?.message ?? response.status}.`, "CRM_CALENDAR_REFUSED");
  return parsed;
}

// Brings every connected calendar of the organization up to date. Returns { connections, created, updated, removed, failed }.
export async function syncCalendars(client, organizationId, { fetchImpl = fetch, env = process.env } = {}) {
  const counts = { connections: 0, created: 0, updated: 0, removed: 0, failed: 0 };
  const { rows: connections } = await client.query("SELECT * FROM tenant.crm_calendar_connections WHERE organization_id = $1 AND status IN ('active', 'error')", [organizationId]);
  for (const connection of connections) {
    counts.connections += 1;
    try {
      const token = await accessToken(client, connection, { fetchImpl, env });
      const base = connection.provider === "google" ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.calendar_id)}/events` : "https://graph.microsoft.com/v1.0/me/events";
      const { rows: meetings } = await client.query(
        `SELECT activity.id, activity.entity_type, activity.entity_id, activity.subject, activity.description, activity.location, activity.status,
                to_char(COALESCE(activity.start_at, activity.due_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_iso,
                to_char(COALESCE(activity.end_at, COALESCE(activity.start_at, activity.due_at) + make_interval(mins => COALESCE(invitation.duration_minutes, 30))) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS end_iso,
                event.external_id, event.synced_version
           FROM tenant.crm_activities activity
           LEFT JOIN tenant.crm_meeting_invitations invitation ON invitation.organization_id = activity.organization_id AND invitation.activity_id = activity.id
           LEFT JOIN tenant.crm_calendar_events event ON event.organization_id = activity.organization_id AND event.activity_id = activity.id AND event.user_id = $2 AND event.provider = $3
          WHERE activity.organization_id = $1 AND activity.assigned_to = $2
            AND (activity.activity_type = 'meeting' OR (activity.activity_type = 'follow_up' AND (activity.follow_up_type = 'meeting' OR activity.follow_up_channel = 'meeting')))
            AND COALESCE(activity.start_at, activity.due_at) IS NOT NULL
            AND (event.external_id IS NOT NULL OR (activity.status IN ('planned', 'in_progress', 'overdue')
                 AND COALESCE(activity.start_at, activity.due_at) BETWEEN now() - make_interval(days => ${SYNC_DAYS_BACK}) AND now() + make_interval(days => ${SYNC_DAYS_AHEAD})))
          LIMIT 500`, [organizationId, connection.user_id, connection.provider]);
      for (const meeting of meetings) {
        const version = versionOf(meeting);
        if (meeting.status === "cancelled") {
          if (meeting.external_id) {
            await remote(fetchImpl, "DELETE", `${base}/${encodeURIComponent(meeting.external_id)}`, token);
            await client.query("DELETE FROM tenant.crm_calendar_events WHERE organization_id = $1 AND activity_id = $2 AND user_id = $3 AND provider = $4", [organizationId, meeting.id, connection.user_id, connection.provider]);
            counts.removed += 1;
          }
          continue;
        }
        if (meeting.external_id && meeting.synced_version === version) continue;
        const body = eventBody(connection.provider, meeting, env.APP_URL);
        if (meeting.external_id) {
          await remote(fetchImpl, "PATCH", `${base}/${encodeURIComponent(meeting.external_id)}`, token, body);
          await client.query("UPDATE tenant.crm_calendar_events SET synced_version = $5, synced_at = now() WHERE organization_id = $1 AND activity_id = $2 AND user_id = $3 AND provider = $4",
            [organizationId, meeting.id, connection.user_id, connection.provider, version]);
          counts.updated += 1;
        } else {
          const created = await remote(fetchImpl, "POST", base, token, body);
          await client.query(
            `INSERT INTO tenant.crm_calendar_events (organization_id, activity_id, user_id, provider, external_id, synced_version) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (organization_id, activity_id, user_id, provider) DO UPDATE SET external_id = EXCLUDED.external_id, synced_version = EXCLUDED.synced_version, synced_at = now()`,
            [organizationId, meeting.id, connection.user_id, connection.provider, String(created.id), version]);
          counts.created += 1;
        }
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

export async function hasCalendarConnections(client, organizationId) {
  return Boolean((await client.query("SELECT 1 FROM tenant.crm_calendar_connections WHERE organization_id = $1 AND status IN ('active', 'error') LIMIT 1", [organizationId])).rows[0]);
}
